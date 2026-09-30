import type { FastifyInstance } from 'fastify';
import { auditQuerySchema, type AuditLogDTO } from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../../lib/audit.js';
import type { AuthUser } from '../../plugins/auth.js';

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('audit:read')] }, async (request) => {
    const query = auditQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.entity) where.entity = query.entity;
    if (query.search) where.description = { contains: query.search };
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    const data: AuditLogDTO[] = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      description: row.description,
      before: safeParseJson(row.before),
      after: safeParseJson(row.after),
      ip: row.ip,
      userAgent: row.userAgent,
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

  app.get('/actions', { preHandler: [app.requirePermission('audit:read')] }, async () => {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { action: 'asc' },
    });
    return { data: rows.map((r) => ({ action: r.action, count: r._count._all })) };
  });

  /** Exporta o historico de auditoria em CSV. */
  app.get('/export/csv', { preHandler: [app.requirePermission('audit:read')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const query = auditQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });

    const header = 'id;data;usuario;acao;entidade;id_entidade;descricao;ip';
    const body = rows
      .map((r) =>
        [
          r.id,
          r.createdAt.toLocaleString('pt-BR'),
          r.userName ?? '',
          r.action,
          r.entity ?? '',
          r.entityId ?? '',
          `"${(r.description ?? '').replace(/"/g, '""')}"`,
          r.ip ?? '',
        ].join(';'),
      )
      .join('\n');

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'EXPORT',
      entity: 'AuditLog',
      description: `${actor.name} exportou o historico de auditoria (${rows.length} registros)`,
      request,
    });

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="auditoria-${Date.now()}.csv"`)
      .send(`\uFEFF${header}\n${body}`);
  });
}
