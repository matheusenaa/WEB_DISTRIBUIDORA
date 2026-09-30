import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cashOpenSchema,
  cashEntrySchema,
  cashExitSchema,
  cashCloseSchema,
  paginationSchema,
  CASH_EXIT_LABELS,
  type CashSessionDTO,
  type CashMovementDTO,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { config } from '../../env.js';
import type { AuthUser } from '../../plugins/auth.js';

const sessionInclude = {
  user: { select: { name: true } },
} as const;

type SessionRow = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

async function loadSession(id: number) {
  return prisma.cashSession.findUnique({ where: { id }, include: sessionInclude });
}

/** Soma de entradas e saidas de uma sessao, calculada no banco. */
async function computeTotals(cashSessionId: number) {
  const [entries, exits, salesTotal] = await Promise.all([
    prisma.cashMovement.aggregate({
      where: { cashSessionId, type: 'ENTRADA' },
      _sum: { amountCents: true },
    }),
    prisma.cashMovement.aggregate({
      where: { cashSessionId, type: 'SAIDA' },
      _sum: { amountCents: true },
    }),
    prisma.sale.aggregate({
      where: { cashSessionId, status: 'CONCLUIDA' },
      _sum: { total: true },
    }),
  ]);

  return {
    entriesTotalCents: entries._sum.amountCents ?? 0,
    exitsTotalCents: exits._sum.amountCents ?? 0,
    salesTotalCents: salesTotal._sum.total ?? 0,
  };
}

function toSessionDTO(row: SessionRow, totals?: {
  entriesTotalCents: number;
  exitsTotalCents: number;
  salesTotalCents: number;
}): CashSessionDTO {
  const expected =
    row.initialAmountCents +
    (totals?.entriesTotalCents ?? 0) -
    (totals?.exitsTotalCents ?? 0);

  return {
    id: row.id,
    status: row.status as CashSessionDTO['status'],
    userId: row.userId,
    userName: row.user?.name ?? 'Removido',
    initialAmountCents: row.initialAmountCents,
    expectedAmountCents: row.expectedAmountCents ?? expected,
    reportedAmountCents: row.reportedAmountCents,
    differenceCents: row.differenceCents,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    notes: row.notes,
    ...(totals ?? {}),
  };
}

export async function registerCashRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/cash/current - sessao aberta                            */
  /* ---------------------------------------------------------------- */
  app.get('/current', { preHandler: [app.requirePermission('cash:read')] }, async (request) => {
    const actor = request.currentUser as AuthUser;

    const open = await prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
      include: sessionInclude,
    });
    if (!open) return { session: null, message: 'Nenhum caixa aberto.' };

    // Qualquer usuario autenticado pode consultar o caixa aberto; o
    // historico completo e restrito a quem tem a permissao.
    const totals = await computeTotals(open.id);
    void actor;

    return {
      session: toSessionDTO(open, totals),
      expectedAmountCents:
        open.initialAmountCents + totals.entriesTotalCents - totals.exitsTotalCents,
    };
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/cash/open                                              */
  /* ---------------------------------------------------------------- */
  app.post('/open', { preHandler: [app.requirePermission('cash:open')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { initialAmountCents } = cashOpenSchema.parse(request.body);

    const existing = await prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      select: { id: true, user: { select: { name: true } } },
    });
    if (existing) {
      throw new AppError(
        'CASH_ALREADY_OPEN',
        `Ja existe um caixa aberto por ${existing.user?.name ?? 'outro usuario'}. Feche-o antes de abrir outro.`,
        { cashSessionId: existing.id },
      );
    }

    const session = await prisma.cashSession.create({
      data: { userId: actor.id, status: 'ABERTO', initialAmountCents },
      include: sessionInclude,
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CASH_OPEN',
      entity: 'CashSession',
      entityId: session.id,
      description: `${actor.name} abriu o caixa com saldo inicial de ${(initialAmountCents / 100).toFixed(2)}`,
      after: toSessionDTO(session),
      request,
    });

    return reply.status(201).send({
      session: toSessionDTO(session, {
        entriesTotalCents: 0,
        exitsTotalCents: 0,
        salesTotalCents: 0,
      }),
      message: 'Caixa aberto com sucesso.',
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/cash/sessions - historico                                */
  /* ---------------------------------------------------------------- */
  app.get('/sessions', { preHandler: [app.requirePermission('cash:read')] }, async (request) => {
    const query = paginationSchema
      .extend({
        status: z.enum(['ABERTO', 'FECHADO']).optional(),
        userId: z.coerce.number().int().positive().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.openedAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.cashSession.count({ where }),
      prisma.cashSession.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: sessionInclude,
      }),
    ]);

    const data = await Promise.all(
      rows.map(async (row) => toSessionDTO(row, await computeTotals(row.id))),
    );

    return {
      data,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/cash/sessions/:id - detalhe com movimentacoes             */
  /* ---------------------------------------------------------------- */
  app.get('/sessions/:id', { preHandler: [app.requirePermission('cash:read')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const session = await prisma.cashSession.findUnique({
      where: { id },
      include: {
        ...sessionInclude,
        movements: {
          orderBy: { createdAt: 'asc' },
          include: { sale: { select: { number: true } }, user: { select: { name: true } } },
        },
      },
    });
    if (!session) throw new AppError('CASH_NOT_FOUND', 'Sessao de caixa nao encontrada.');

    const totals = await computeTotals(session.id);
    const base = toSessionDTO(session, totals);

    const movements: CashMovementDTO[] = session.movements.map((m) => ({
      id: m.id,
      type: m.type as CashMovementDTO['type'],
      kind: m.kind,
      amountCents: m.amountCents,
      description: m.description,
      saleId: m.saleId,
      saleNumber: m.sale?.number ?? null,
      userId: m.userId,
      userName: m.user?.name ?? 'Removido',
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      ...base,
      movements,
      totals: {
        ...totals,
        expectedAmountCents: session.initialAmountCents + totals.entriesTotalCents - totals.exitsTotalCents,
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/cash/entries - entrada avulsa                           */
  /* ---------------------------------------------------------------- */
  app.post('/entries', { preHandler: [app.requirePermission('cash:read')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = cashEntrySchema.parse(request.body);

    const open = await prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    if (!open) throw new AppError('CASH_NOT_OPEN', 'Nao ha caixa aberto. Abra o caixa primeiro.');

    const movement = await prisma.cashMovement.create({
      data: {
        cashSessionId: open.id,
        type: 'ENTRADA',
        kind: body.kind,
        amountCents: body.amountCents,
        description: body.description,
        userId: actor.id,
      },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CASH_ENTRY',
      entity: 'CashMovement',
      entityId: movement.id,
      description: `${actor.name} registrou entrada manual de ${(body.amountCents / 100).toFixed(2)} - ${body.description}`,
      request,
    });

    return reply.status(201).send({ ok: true, movementId: movement.id, message: 'Entrada registrada.' });
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/cash/exits - saida (despesa, retirada, sangria...)       */
  /* ---------------------------------------------------------------- */
  app.post('/exits', { preHandler: [app.requirePermission('cash:withdraw')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = cashExitSchema.parse(request.body);

    const open = await prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
      select: { id: true, initialAmountCents: true },
    });
    if (!open) throw new AppError('CASH_NOT_OPEN', 'Nao ha caixa aberto. Abra o caixa primeiro.');

    // Sangria e suprimento sao operacoes que mexem no dinheiro fisico do
    // caixa: ficam restritas ao administrador no backend, independentemente
    // do que o frontend exibir.
    if (body.kind === 'SANGRIA' || body.kind === 'SUPRIMENTO') {
      if (actor.role !== 'ADMIN') {
        throw new AppError(
          'FORBIDDEN',
          'Apenas administradores podem registrar sangrias e suprimentos.',
        );
      }
    }

    const totals = await computeTotals(open.id);
    const available = open.initialAmountCents + totals.entriesTotalCents - totals.exitsTotalCents;
    const remaining = available - body.amountCents;

    if (body.kind !== 'SANGRIA' && body.kind === 'RETIRADA' && remaining < 0) {
      throw new AppError(
        'CONFLICT',
        `Saldo insuficiente no caixa. Disponivel: ${(available / 100).toFixed(2)}.`,
        { available, requested: body.amountCents },
      );
    }

    const movement = await prisma.cashMovement.create({
      data: {
        cashSessionId: open.id,
        type: 'SAIDA',
        kind: body.kind,
        amountCents: body.amountCents,
        description: `${CASH_EXIT_LABELS[body.kind] ?? body.kind}: ${body.description}`,
        userId: actor.id,
      },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CASH_EXIT',
      entity: 'CashMovement',
      entityId: movement.id,
      description: `${actor.name} registrou ${CASH_EXIT_LABELS[body.kind] ?? body.kind} de ${(
        body.amountCents / 100
      ).toFixed(2)} - ${body.description}`,
      request,
    });

    return reply.status(201).send({
      ok: true,
      movementId: movement.id,
      availableAfterCents: available - body.amountCents,
      message: 'Saida registrada.',
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/cash/close                                             */
  /* ---------------------------------------------------------------- */
  app.post('/close', { preHandler: [app.requirePermission('cash:close')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { reportedAmountCents, notes } = cashCloseSchema.parse(request.body);

    const result = await prisma.$transaction(async (tx) => {
      const open = await tx.cashSession.findFirst({
        where: { status: 'ABERTO' },
        orderBy: { openedAt: 'desc' },
        include: sessionInclude,
      });
      if (!open) throw new AppError('CASH_NOT_OPEN', 'Nao ha caixa aberto para fechar.');

      const [entries, exits] = await Promise.all([
        tx.cashMovement.aggregate({
          where: { cashSessionId: open.id, type: 'ENTRADA' },
          _sum: { amountCents: true },
        }),
        tx.cashMovement.aggregate({
          where: { cashSessionId: open.id, type: 'SAIDA' },
          _sum: { amountCents: true },
        }),
      ]);

      const entriesTotalCents = entries._sum.amountCents ?? 0;
      const exitsTotalCents = exits._sum.amountCents ?? 0;
      const expected = open.initialAmountCents + entriesTotalCents - exitsTotalCents;
      const difference = reportedAmountCents - expected;

      const closed = await tx.cashSession.update({
        where: { id: open.id },
        data: {
          status: 'FECHADO',
          expectedAmountCents: expected,
          reportedAmountCents,
          differenceCents: difference,
          closedAt: new Date(),
          notes: notes || null,
        },
        include: sessionInclude,
      });

      return {
        session: closed,
        expected,
        reported: reportedAmountCents,
        difference,
        entriesTotalCents,
        exitsTotalCents,
      };
    });

    const difference = result.difference;
    const withinTolerance = Math.abs(difference) <= config.cashToleranceCents;

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CASH_CLOSE',
      entity: 'CashSession',
      entityId: result.session.id,
      description: `${actor.name} fechou o caixa: esperado ${(result.expected / 100).toFixed(2)}, informado ${(
        result.reported / 100
      ).toFixed(2)}, diferenca ${(difference / 100).toFixed(2)}${withinTolerance ? ' (dentro da tolerancia)' : ' (DIVERGENCIA)'}`,
      after: toSessionDTO(result.session),
      request,
    });

    return {
      ok: true,
      session: toSessionDTO(result.session),
      summary: {
        initialAmountCents: result.session.initialAmountCents,
        entriesTotalCents: result.entriesTotalCents,
        exitsTotalCents: result.exitsTotalCents,
        expectedAmountCents: result.expected,
        reportedAmountCents: result.reported,
        differenceCents: difference,
        toleranceCents: config.cashToleranceCents,
        withinTolerance,
      },
      message:
        difference === 0
          ? 'Caixa fechado sem divergencia.'
          : difference > 0
            ? `Caixa fechado com sobra de ${(difference / 100).toFixed(2)}.`
            : `Caixa fechado com falta de ${(Math.abs(difference) / 100).toFixed(2)}.`,
    };
  });
}
