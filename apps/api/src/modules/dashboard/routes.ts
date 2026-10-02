import type { FastifyInstance } from 'fastify';
import {
  dashboardQuerySchema,
  DASHBOARD_RANGE_LABELS,
  type DashboardPayload,
  type NamedValue,
  type TimeSeriesPoint,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildStockAlerts } from '../stock/alerts.js';
import type { AuthUser } from '../../plugins/auth.js';

interface Range {
  from: Date;
  to: Date;
  label: string;
  previousFrom: Date;
  previousTo: Date;
}

/** Teto do intervalo personalizado, em dias. */
export const MAX_RANGE_DAYS = 400;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Desloca meses preservando o dia 1.
 *
 * `setMonth` com dia > 28 estouraria para o mes seguinte ("31 de janeiro"
 * virando 2 ou 3 de marco). Como so é usado para achar primeiros dias de
 * mes, o dia 1 elimina o problema.
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months, 1);
  return d;
}

function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfPreviousMonth(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - 1, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Resolve o intervalo a partir do parametro `range` do dashboard. */
export function resolveRange(
  kind: string,
  from: Date | undefined,
  to: Date | undefined,
  now = new Date(),
): Range {
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);

  switch (kind) {
    case 'HOJE':
      return {
        from: today,
        to: endOfDay(now),
        label: DASHBOARD_RANGE_LABELS.HOJE,
        previousFrom: yesterday,
        previousTo: endOfDay(yesterday),
      };
    case 'ONTEM':
      return {
        from: yesterday,
        to: endOfDay(yesterday),
        label: DASHBOARD_RANGE_LABELS.ONTEM,
        previousFrom: addDays(yesterday, -1),
        previousTo: endOfDay(addDays(yesterday, -1)),
      };
    case 'ULTIMOS_7':
      return {
        from: startOfDay(addDays(today, -6)),
        to: endOfDay(now),
        label: DASHBOARD_RANGE_LABELS.ULTIMOS_7,
        previousFrom: startOfDay(addDays(today, -13)),
        previousTo: endOfDay(addDays(today, -7)),
      };
    case 'ULTIMOS_30':
      return {
        from: startOfDay(addDays(today, -29)),
        to: endOfDay(now),
        label: DASHBOARD_RANGE_LABELS.ULTIMOS_30,
        previousFrom: startOfDay(addDays(today, -59)),
        previousTo: endOfDay(addDays(today, -30)),
      };
    case 'MES_ATUAL':
      return {
        from: startOfMonth(now),
        to: endOfDay(now),
        label: DASHBOARD_RANGE_LABELS.MES_ATUAL,
        previousFrom: startOfPreviousMonth(now),
        previousTo: endOfDay(addDays(startOfMonth(now), -1)),
      };
    case 'MES_ANTERIOR': {
      const prevStart = startOfPreviousMonth(now);
      return {
        from: prevStart,
        to: endOfDay(addDays(startOfMonth(now), -1)),
        label: DASHBOARD_RANGE_LABELS.MES_ANTERIOR,
        // O periodo anterior de "mes anterior" e o mes que vem antes dele,
        // inteiro. Antes comparava do ultimo dia do mes antepenultimo ate o
        // primeiro dia do anterior, uma janela de ~1 ms que nunca tinha
        // venda: a variacao aparecia sempre como queda para zero.
        previousFrom: addMonths(prevStart, -1),
        previousTo: endOfDay(addDays(prevStart, -1)),
      };
    }
    case 'PERSONALIZADO': {
      if (!from || !to) {
        throw new AppError('VALIDATION_ERROR', 'Informe as datas inicial e final do periodo.');
      }
      const start = startOfDay(from) < startOfDay(to) ? startOfDay(from) : startOfDay(to);
      const end = endOfDay(from) > endOfDay(to) ? endOfDay(from) : endOfDay(to);
      const spanDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);

      // A serie diaria e uma entrada por dia e as vendas sao carregadas uma
      // a uma para agrupar. Sem teto, um intervalo de 5 anos derrubaria a
      // API e nao caberia em grafico nenhum.
      if (spanDays > MAX_RANGE_DAYS) {
        throw new AppError(
          'VALIDATION_ERROR',
          `O periodo nao pode passar de ${MAX_RANGE_DAYS} dias. Escolha uma janela menor.`,
        );
      }

      return {
        from: start,
        to: end,
        label: `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`,
        previousFrom: new Date(start.getTime() - spanDays * 86_400_000),
        previousTo: new Date(start.getTime() - 1),
      };
    }
    default:
      return {
        from: today,
        to: endOfDay(now),
        label: DASHBOARD_RANGE_LABELS.HOJE,
        previousFrom: yesterday,
        previousTo: endOfDay(yesterday),
      };
  }
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('dashboard:read')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const query = dashboardQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const range = resolveRange(query.range, query.from, query.to, now);

    // Vendedor sem visao geral ve apenas os proprios numeros.
    const sellerFilter =
      actor.role === 'ADMIN' || actor.permissions.includes('sales:read-all') ? {} : { sellerId: actor.id };

    const salesWhere = { ...sellerFilter, status: 'CONCLUIDA' };

    /* ---------------- Consultas paralelas ---------------- */
    const [
      salesRows,
      canceledCount,
      sellerRows,
      itemRows,
      categoryRows,
      previousAgg,
      stockAgg,
      itemsAgg,
    ] = await Promise.all([
      // Colunas minimas: agrupar por dia no servidor exigiria funcao de data
      // especifica do banco. Com filtro de periodo, agrupar em JS e mais
      // portavel (SQLite/Postgres) e barato.
      prisma.sale.findMany({
        where: { ...salesWhere, createdAt: { gte: range.from, lte: range.to } },
        select: { createdAt: true, total: true, costTotal: true, paymentMethod: true, sellerId: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.sale.count({
        where: { ...sellerFilter, status: 'CANCELADA', createdAt: { gte: range.from, lte: range.to } },
      }),
      prisma.sale.groupBy({
        by: ['sellerId'],
        where: { ...salesWhere, createdAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { ...salesWhere, createdAt: { gte: range.from, lte: range.to } } },
        _sum: { quantity: true, subtotal: true },
        _count: { _all: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      /**
       * Um agrupamento por produto, sem `take`.
       *
       * O resultado e limitado pelo tamanho do catalogo (um produto por
       * linha), nao pelo volume de vendas. Um teto aqui cortaria produtos
       * reais e o faturamento de uma categoria sumiria do grafico sem
       * nenhuma indicacao.
       */
      prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { ...salesWhere, createdAt: { gte: range.from, lte: range.to } } },
        _sum: { quantity: true, subtotal: true },
      }),
      prisma.sale.aggregate({
        where: {
          ...salesWhere,
          createdAt: { gte: range.previousFrom, lte: range.previousTo },
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.product.aggregate({
        where: { status: 'ATIVO' },
        _count: { _all: true },
      }),
      /**
       * Total de itens vendidos no periodo, sem `take`.
       *
       * `itemRows` abaixo e o top 10 e serve so para o grafico. Somar as
       * quantidades dele aqui fazia o KPI "itens vendidos" contar apenas os
       * 10 produtos mais vendidos, e o "itens por venda" que vem desse total
       * saia baixo demais.
       */
      prisma.saleItem.aggregate({
        where: { sale: { ...salesWhere, createdAt: { gte: range.from, lte: range.to } } },
        _sum: { quantity: true },
      }),
    ]);

    /* ---------------- Serie diaria ---------------- */
    const byDay = new Map<string, TimeSeriesPoint>();
    const cursor = new Date(range.from);
    // Limite de seguranca contra intervalo(customizado) abused.
    if (cursor <= range.to) {
      while (cursor <= range.to && byDay.size < 400) {
        const key = dayKey(cursor);
        byDay.set(key, {
          date: key,
          label: cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          salesCount: 0,
          revenueCents: 0,
          profitCents: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    let revenueCents = 0;
    let costCents = 0;

    for (const sale of salesRows) {
      revenueCents += sale.total;
      costCents += sale.costTotal;
      const point = byDay.get(dayKey(sale.createdAt));
      if (point) {
        point.salesCount += 1;
        point.revenueCents += sale.total;
        point.profitCents += sale.total - sale.costTotal;
      }
    }

    const itemsSold = itemsAgg._sum.quantity ?? 0;

    /* ---------------- Formas de pagamento ---------------- */
    const paymentMap = new Map<string, number>();
    for (const sale of salesRows) {
      paymentMap.set(sale.paymentMethod, (paymentMap.get(sale.paymentMethod) ?? 0) + sale.total);
    }
    const byPaymentMethod: NamedValue[] = [...paymentMap.entries()]
      .map(([method, value]) => ({ id: method, label: method, value }))
      .sort((a, b) => b.value - a.value);

    /* ---------------- Vendedores ---------------- */
    const sellerIds = sellerRows.map((r) => r.sellerId);
    const sellerNames = await prisma.user.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(sellerNames.map((s) => [s.id, s.name]));
    const bySeller: NamedValue[] = sellerRows
      .map((r) => ({
        id: r.sellerId,
        label: nameById.get(r.sellerId) ?? `Vendedor #${r.sellerId}`,
        value: r._sum.total ?? 0,
        count: r._count._all,
      }))
      .sort((a, b) => b.value - a.value);

    /* ---------------- Produtos mais vendidos ---------------- */

    /**
     * Catalogo de referencia para as duas consultas agrupadas.
     *
     * Precisa cobrir `itemRows` (top 10) E `categoryRows` (ate 200): o mapa
     * era montado so com o top 10, entao todo produto fora dele era tratado
     * como "sem categoria" e a receita aparecia na categoria errada.
     */
    const lookupIds = [...new Set([...itemRows.map((r) => r.productId), ...categoryRows.map((r) => r.productId)])];
    const products = await prisma.product.findMany({
      where: { id: { in: lookupIds } },
      select: { id: true, name: true, categoryId: true, unit: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const topProducts: NamedValue[] = itemRows
      .map((r) => ({
        id: r.productId,
        label: productById.get(r.productId)?.name ?? `Produto #${r.productId}`,
        value: r._sum.quantity ?? 0,
        secondaryValue: r._sum.subtotal ?? 0,
        count: r._count._all,
      }))
      .sort((a, b) => b.value - a.value);

    /* ---------------- Vendas por categoria ---------------- */
    const categoryMap = new Map<number, { quantity: number; revenue: number }>();
    for (const row of categoryRows) {
      const categoryId = productById.get(row.productId)?.categoryId;
      const key = categoryId ?? 0;
      const current = categoryMap.get(key) ?? { quantity: 0, revenue: 0 };
      current.quantity += row._sum.quantity ?? 0;
      current.revenue += row._sum.subtotal ?? 0;
      categoryMap.set(key, current);
    }
    const categoryIds = [...categoryMap.keys()].filter((id) => id !== 0);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    const byCategory: NamedValue[] = [...categoryMap.entries()]
      .map(([id, acc]) => ({
        id,
        label: id === 0 ? 'Sem categoria' : categoryNameById.get(id) ?? `Categoria #${id}`,
        value: acc.quantity,
        secondaryValue: acc.revenue,
      }))
      .sort((a, b) => (b.secondaryValue ?? 0) - (a.secondaryValue ?? 0));

    /* ---------------- Alertas e valor de estoque ---------------- */

    // Reaproveita o modulo de alertas em vez de recalcular aqui: o card de
    // estoque do dashboard e a tela /alertas mostravam numeros diferentes
    // porque cada uma tinha sua propria copia da regra.
    const alerts = (await buildStockAlerts({ noLimit: true })).data;

    // Valorizacao do estoque: soma de quantidade x preco, em uma unica varredura.
    const stockValueRows = await prisma.product.findMany({
      where: { status: 'ATIVO' },
      select: { stock: true, costPrice: true, salePrice: true },
    });
    let stockValueCents = 0;
    let retailValueCents = 0;
    for (const p of stockValueRows) {
      stockValueCents += p.stock * p.costPrice;
      retailValueCents += p.stock * p.salePrice;
    }

    const salesCount = salesRows.length;
    const payload: DashboardPayload = {
      range: {
        kind: query.range,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        label: range.label,
      },
      kpi: {
        salesCount,
        revenueCents,
        itemsSold,
        ticketAverageCents: salesCount > 0 ? Math.round(revenueCents / salesCount) : 0,
        profitCents: revenueCents - costCents,
        canceledCount,
        averageSaleItems: salesCount > 0 ? Number((itemsSold / salesCount).toFixed(2)) : 0,
      },
      comparison: {
        previousFrom: range.previousFrom.toISOString(),
        previousTo: range.previousTo.toISOString(),
        salesCount: previousAgg._count._all,
        revenueCents: previousAgg._sum.total ?? 0,
        // Periodo ainda em andamento (HOJE, MES_ATUAL, ULTIMOS_N): comparar
        // 5 dias com 7 ou o mes corrente com o mes inteiro faz o indicador
        // cair sozinho. A tela usa isto para avisar em vez de mostrar uma
        // queda que parece desempenho.
        partial: range.to.getTime() > now.getTime(),
      },
      series: {
        daily: [...byDay.values()],
        byPaymentMethod,
        bySeller,
        topProducts,
        byCategory,
      },
      stock: {
        alerts: alerts.slice(0, 20),
        totalProducts: stockAgg._count._all,
        outOfStock: alerts.filter((a) => a.alertLevel === 'ZERADO').length,
        lowStock: alerts.filter((a) => a.alertLevel !== 'ZERADO').length,
        stockValueCents,
        retailValueCents,
      },
    };

    return payload;
  });
}
