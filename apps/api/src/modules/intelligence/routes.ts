import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SEASONALITY_PERIODS } from '@webdist/shared';
import { recordAudit } from '../../lib/audit.js';
import {
  buildCashForecast,
} from './cash-forecast.js';
import {
  buildReplenishmentReport,
  buildSeasonalityReport,
  buildStagnantReport,
} from './service.js';

/**
 * Rotas de inteligencia comercial.
 *
 * Todas sao somente LEITURA e sempre declaram a base do calculo no campo
 * `basis`. Nenhuma delas altera dados: sugestão e indicacao, decisao e do
 * usuario.
 */
export async function registerIntelligenceRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/intelligence/replenishment - sugestao de recompra         */
  /* ---------------------------------------------------------------- */
  app.get('/replenishment', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = z
      .object({
        windowDays: z.coerce.number().int().min(7).max(365).default(30),
        categoryId: z.coerce.number().int().positive().optional(),
        supplierId: z.coerce.number().int().positive().optional(),
        onlyBelowMinimum: z
          .union([z.boolean(), z.string()])
          .optional()
          .transform((v) => v !== 'false' && v !== '0'),
      })
      .parse(request.query ?? {});

    return buildReplenishmentReport({
      windowDays: query.windowDays,
      categoryIds: query.categoryId ? [query.categoryId] : undefined,
      supplierId: query.supplierId,
      onlyBelowMinimum: query.onlyBelowMinimum,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/intelligence/stagnant - produtos parados                  */
  /* ---------------------------------------------------------------- */
  app.get('/stagnant', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = z
      .object({
        /** Periodos configuraveis; default 30/60/90. */
        days: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .transform((v) => {
            if (v === undefined) return [30, 60, 90];
            const list = Array.isArray(v) ? v : v.split(',');
            const parsed = list
              .map((d) => Number.parseInt(d.trim(), 10))
              .filter((d) => Number.isFinite(d) && d > 0 && d <= 3650);
            return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : [30, 60, 90];
          }),
        categoryId: z.coerce.number().int().positive().optional(),
        onlyWithStock: z
          .union([z.boolean(), z.string()])
          .optional()
          .transform((v) => v !== 'false' && v !== '0'),
      })
      .parse(request.query ?? {});

    return buildStagnantReport({
      days: query.days,
      categoryId: query.categoryId,
      onlyWithStock: query.onlyWithStock,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/intelligence/seasonality - sazonalidade                    */
  /* ---------------------------------------------------------------- */
  app.get('/seasonality', { preHandler: [app.requirePermission('reports:read')] }, async (request) => {
    const query = z
      .object({
        period: z.enum(SEASONALITY_PERIODS).default('MENSAL'),
        groupBy: z.enum(['MES', 'CATEGORIA', 'PRODUTO', 'VENDEDOR']).default('MES'),
        categoryId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(request.query ?? {});

    return buildSeasonalityReport({
      period: query.period,
      groupBy: query.groupBy,
      categoryId: query.categoryId,
      limit: query.limit,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/intelligence/cash-forecast - previsao de caixa            */
  /* ---------------------------------------------------------------- */
  app.get('/cash-forecast', { preHandler: [app.requirePermission('cash:read')] }, async (request) => {
    const query = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(14) })
      .parse(request.query ?? {});
    return buildCashForecast(query.days);
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/intelligence/summary - painel resumido                     */
  /* ---------------------------------------------------------------- */
  app.get('/summary', { preHandler: [app.requirePermission('dashboard:read')] }, async (request, reply) => {
    const actor = request.currentUser;

    const [replenishment, stagnant, forecast] = await Promise.all([
      buildReplenishmentReport({ windowDays: 30 }),
      buildStagnantReport({ days: [30, 60, 90] }),
      buildCashForecast(14),
    ]);

    await recordAudit({
      userId: actor?.id ?? null,
      userName: actor?.username,
      action: 'EXPORT',
      entity: 'Intelligence',
      description: `${actor?.name ?? 'Sistema'} consultou o resumo inteligente`,
      request,
    });

    return reply.send({
      replenishment: {
        count: replenishment.summary.productCount,
        estimatedCents: replenishment.summary.totalEstimatedCents,
        basis: replenishment.basis,
      },
      stagnant: {
        count: stagnant.items.length,
        tiedUpValueCents: stagnant.totalTiedUpValueCents,
        basis: stagnant.basis,
      },
      cashForecast: {
        currentBalanceCents: forecast.currentBalanceCents,
        confidence: forecast.confidence,
        basis: forecast.basis,
      },
      generatedAt: new Date().toISOString(),
    });
  });
}
