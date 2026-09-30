import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stockMovementSchema, stockQuerySchema, type StockMovementDTO, type StockAlertDTO } from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { applyStockMovement, describeMovement } from './service.js';
import { suggestRestock, computeAlertLevel } from '../../lib/product-mapper.js';
import type { AuthUser } from '../../plugins/auth.js';

export async function registerStockRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/stock/movements - registrar movimentacao                */
  /* ---------------------------------------------------------------- */
  app.post('/movements', { preHandler: [app.requirePermission('stock:adjust')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = stockMovementSchema.parse(request.body);

    // Saida/Perda sao operacoes de baixa deliberada; entrada exige permissao de recebimento.
    if (input.type === 'ENTRADA' || input.type === 'DEVOLUCAO') {
      await app.requirePermission('stock:receive')(request, reply);
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const before = await tx.product.findUnique({
          where: { id: input.productId },
          select: { name: true },
        });
        if (!before) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');

        return applyStockMovement(tx, {
          type: input.type,
          productId: input.productId,
          quantity: input.quantity,
          reason: input.reason,
          documentNumber: input.documentNumber || null,
          unitCost: input.unitCost ?? null,
          userId: actor.id,
          allowNegative: false,
        });
      },
      { timeout: 10_000 },
    );

    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { name: true },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'STOCK_ADJUST',
      entity: 'Product',
      entityId: input.productId,
      description: describeMovement(
        input.type,
        product?.name ?? `produto #${input.productId}`,
        input.quantity,
        result.previousStock,
        result.resultingStock,
      ) + ` - motivo: ${input.reason}`,
      after: { stock: result.resultingStock, type: input.type, reason: input.reason },
      request,
    });

    return reply.status(201).send({
      ok: true,
      movementId: result.movementId,
      previousStock: result.previousStock,
      resultingStock: result.resultingStock,
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/stock/adjust - ajuste para estoque alvo                */
  /* ---------------------------------------------------------------- */
  app.post('/adjust', { preHandler: [app.requirePermission('stock:adjust')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = z
      .object({
        productId: z.coerce.number().int().positive(),
        targetStock: z.coerce.number().int().min(0, 'Estoque final invalido'),
        reason: z.string().trim().min(3, 'Informe o motivo').max(300),
      })
      .parse(request.body);

    const result = await prisma.$transaction(
      (tx) =>
        applyStockMovement(tx, {
          type: 'AJUSTE',
          productId: input.productId,
          quantity: Math.abs(input.targetStock),
          targetStock: input.targetStock,
          reason: input.reason,
          userId: actor.id,
          allowNegative: false,
        }),
      { timeout: 10_000 },
    );

    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { name: true },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'STOCK_ADJUST',
      entity: 'Product',
      entityId: input.productId,
      description: `Ajuste manual de estoque em "${product?.name ?? input.productId}" de ${
        result.previousStock
      } para ${result.resultingStock} - motivo: ${input.reason}`,
      after: { previous: result.previousStock, target: input.targetStock, reason: input.reason },
      request,
    });

    return reply.send({
      ok: true,
      movementId: result.movementId,
      previousStock: result.previousStock,
      resultingStock: result.resultingStock,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/stock/movements - historico                             */
  /* ---------------------------------------------------------------- */
  app.get('/movements', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = stockQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: {
          product: { select: { name: true, unit: true } },
          user: { select: { name: true } },
        },
      }),
    ]);

    const data: StockMovementDTO[] = rows.map((row) => ({
      id: row.id,
      type: row.type as StockMovementDTO['type'],
      productId: row.productId,
      productName: row.product?.name ?? 'Produto removido',
      productUnit: row.product?.unit ?? 'UN',
      quantity: row.quantity,
      previousStock: row.previousStock,
      resultingStock: row.resultingStock,
      reason: row.reason,
      documentNumber: row.documentNumber,
      unitCost: row.unitCost,
      userId: row.userId,
      userName: row.user?.name ?? 'Usuario removido',
      createdAt: row.createdAt.toISOString(),
    }));

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
  /* GET /api/stock/alerts - alertas de estoque                       */
  /* ---------------------------------------------------------------- */
  app.get('/alerts', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = z
      .object({
        level: z.enum(['TODOS', 'ZERADO', 'CRITICO', 'BAIXO']).default('TODOS'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(request.query ?? {});

    const products = await prisma.product.findMany({
      where: { status: 'ATIVO', minStock: { gt: 0 } },
      select: { id: true, internalCode: true, name: true, unit: true, stock: true, minStock: true, maxStock: true },
    });

    const alerts: StockAlertDTO[] = [];
    for (const p of products) {
      const level = computeAlertLevel(p);
      if (!level) continue;
      if (query.level !== 'TODOS' && level !== query.level) continue;
      alerts.push({
        productId: p.id,
        code: p.internalCode ?? `#${p.id}`,
        name: p.name,
        unit: p.unit,
        stock: p.stock,
        minStock: p.minStock,
        alertLevel: level,
        suggestedRestock: suggestRestock(p),
      });
    }

    const order = { ZERADO: 0, CRITICO: 1, BAIXO: 2 } as const;
    alerts.sort((a, b) => order[a.alertLevel] - order[b.alertLevel] || a.stock - b.stock);

    return { data: alerts.slice(0, query.limit), total: alerts.length };
  });
}
