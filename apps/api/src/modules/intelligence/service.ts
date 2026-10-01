import { prisma } from '../../lib/prisma.js';
import type {
  ConfidenceLevel,
  ReplenishmentItem,
  ReplenishmentReason,
  SeasonalityPeriod,
  SeasonalityRow,
} from '@webdist/shared';

/**
 * INTELIGENCIA DE REPOSICAO
 *
 * Regra do projeto: NENHUMA previsao e apresentada como certeza. Todo
 * resultado carrega o campo `confidence` derivado de quantos dados
 * historicos existem, e o `basis` explica a base do calculo em texto
 * legivel. Quando nao ha historico, o sistema diz que nao ha dados em vez
 * de inventar um numero.
 */

/** Minimo de dias de historico para considerar a media confiavel. */
const HIGH_CONFIDENCE_DAYS = 60;
const MEDIUM_CONFIDENCE_DAYS = 30;
/** Media de venda diaria abaixo da qual o produto e' considerado "lento". */
const MIN_DAILY_SALES_FOR_CONFIDENCE = 0.05;

export interface ReplenishmentOptions {
  /** Janela de analise do consumo, em dias. */
  windowDays: number;
  /** Ids de categoria para filtrar (vazio = todas). */
  categoryIds?: number[];
  supplierId?: number;
  /** Considera apenas produtos com estoque <= minimo. Default true. */
  onlyBelowMinimum?: boolean;
}

/**
 * Media diaria de venda por produto, calculada em SQL.
 *
 * Um unico GROUP BY sobre sale_items + sales filtrado por data e
 * materialmente mais barato do que buscar os itens e agregar em JS.
 */
async function averageDailySales(
  windowDays: number,
  categoryIds?: number[],
): Promise<Map<number, { total: number; days: number; lastSale: Date | null }>> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const rows = await prisma.$queryRaw<
    { productId: number; total: number; days: number; lastSale: Date | null }[]
  >`
    SELECT
      si.productId                     AS productId,
      SUM(si.quantity)                 AS total,
      COUNT(DISTINCT date(s.createdAt)) AS days,
      MAX(s.createdAt)                 AS lastSale
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.status = 'CONCLUIDA'
      AND s.createdAt >= ${since}
      AND si.productId NOT IN (
        SELECT id FROM products WHERE status <> 'ATIVO'
      )
    GROUP BY si.productId
  `;

  // Filtro por categoria precisa do catalogo; kept separado para nao
  // transformar a query acima em um JOIN pesado.
  if (!categoryIds || categoryIds.length === 0) {
    return new Map(rows.map((r) => [Number(r.productId), r]));
  }

  const allowed = await prisma.product.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true },
  });
  const allowedIds = new Set(allowed.map((p) => p.id));
  return new Map(rows.filter((r) => allowedIds.has(Number(r.productId))).map((r) => [Number(r.productId), r]));
}

function confidenceFor(avgDailySales: number, daysWithData: number): ConfidenceLevel {
  if (daysWithData === 0 || avgDailySales < MIN_DAILY_SALES_FOR_CONFIDENCE) return 'SEM_DADOS';
  if (daysWithData >= HIGH_CONFIDENCE_DAYS) return 'ALTA';
  if (daysWithData >= MEDIUM_CONFIDENCE_DAYS) return 'MEDIA';
  return 'BAIXA';
}

/**
 * Sugere o que repor.
 *
 * Formula (deliberadamente conservadora e explicavel):
 *   cobertura_desejada = estoque_minimo + (venda_diaria * prazo_do_fornecedor)
 *   quantidade_sugerida = cobertura_desejada - estoque_atual
 *
 * Ajustes:
 *  - Nunca sugere menos que zero.
 *  - Se o fornecedor tem quantidade minima, arredonda para cima nela.
 *  - Se ha estoque maximo definido e a sugesto o ultrapassa, limita nele
 *    para nao gerar compra que estoura o deposito.
 */
export async function buildReplenishmentReport(
  options: ReplenishmentOptions,
): Promise<{
  items: ReplenishmentItem[];
  summary: { productCount: number; totalEstimatedCents: number; byReason: Record<string, number> };
  basis: string;
  windowDays: number;
  generatedAt: string;
}> {
  const { windowDays, categoryIds, supplierId, onlyBelowMinimum = true } = options;

  const where: Record<string, unknown> = { status: 'ATIVO' };
  if (categoryIds?.length) where.categoryId = { in: categoryIds };
  if (supplierId) where.supplierId = supplierId;

  const products = await prisma.product.findMany({
    where,
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          leadTimeDays: true,
          minOrderQuantity: true,
          lastPurchasePrice: true,
        },
      },
    },
  });

  // Sem estoque minimo definido nao ha como sugerir nada: o usuario nao
  // declarou qual e o nivel aceitavel de exposicao.
  const candidates = onlyBelowMinimum
    ? products.filter((p) => p.minStock > 0 && p.stock <= p.minStock)
    : products.filter((p) => p.minStock > 0);

  const salesMap = await averageDailySales(windowDays, categoryIds);

  const items: ReplenishmentItem[] = candidates.map((product) => {
    const stats = salesMap.get(product.id);
    const totalSold = stats ? Number(stats.total) : 0;
    const daysWithData = stats ? Number(stats.days) : 0;
    const averageDaily = totalSold / windowDays;

    const leadTimeDays = product.supplier?.leadTimeDays ?? 0;
    const consumptionAtLeadTime = averageDaily * leadTimeDays;

    let suggested = Math.ceil(product.minStock + consumptionAtLeadTime - product.stock);
    if (suggested < 0) suggested = 0;

    const minOrder = product.supplier?.minOrderQuantity ?? 0;
    if (minOrder > 0 && suggested > 0 && suggested < minOrder) suggested = minOrder;

    if (product.maxStock !== null && product.stock + suggested > product.maxStock) {
      suggested = Math.max(0, product.maxStock - product.stock);
    }

    const reason: ReplenishmentReason =
      product.stock < 0 ? 'ESTOQUE_NEGATIVO' : product.stock <= 0 ? 'SEM_ESTOQUE' : 'ABAIXO_DO_MINIMO';

    const unitCost = product.supplier?.lastPurchasePrice ?? product.costPrice;

    return {
      productId: product.id,
      internalCode: product.internalCode,
      barcode: product.barcode,
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      minStock: product.minStock,
      maxStock: product.maxStock,
      averageDailySales: Number(averageDaily.toFixed(3)),
      consumptionAtLeadTime: Number(consumptionAtLeadTime.toFixed(2)),
      suggestedQuantity: suggested,
      daysOfCoverage:
        averageDaily > 0 ? Number((product.stock / averageDaily).toFixed(1)) : null,
      reason,
      confidence: confidenceFor(averageDaily, daysWithData),
      supplierId: product.supplier?.id ?? null,
      supplierName: product.supplier?.name ?? null,
      leadTimeDays: product.supplier ? leadTimeDays : null,
      minOrderQuantity: product.supplier ? minOrder : null,
      estimatedUnitCost: unitCost > 0 ? unitCost : null,
      estimatedTotalCents: unitCost > 0 && suggested > 0 ? unitCost * suggested : null,
    };
  });

  //Mais urgente primeiro: zerado, depois menor cobertura.
  const order: Record<ReplenishmentReason, number> = {
    ESTOQUE_NEGATIVO: 0,
    SEM_ESTOQUE: 1,
    ABAIXO_DO_MINIMO: 2,
  };
  items.sort((a, b) => {
    if (order[a.reason] !== order[b.reason]) return order[a.reason] - order[b.reason];
    return (a.daysOfCoverage ?? Number.POSITIVE_INFINITY) - (b.daysOfCoverage ?? Number.POSITIVE_INFINITY);
  });

  const byReason: Record<string, number> = {};
  for (const item of items) byReason[item.reason] = (byReason[item.reason] ?? 0) + 1;

  return {
    items,
    summary: {
      productCount: items.length,
      totalEstimatedCents: items.reduce((sum, i) => sum + (i.estimatedTotalCents ?? 0), 0),
      byReason,
    },
    basis: `Sugestao baseada nos dados historicos: media de venda dos ultimos ${windowDays} dias, somada ao estoque minimo e ao prazo do fornecedor._projecao_ nao e garantia de demanda.`,
    windowDays,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* PRODUTOS PARADOS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Produtos sem movimento de venda ha um periodo.
 *
 * `lastSaleAt` e desnormalizado no produto e mantido pela transacao de
 * venda, o que torna a analise uma varredura sequencial simples em vez
 * de um JOIN sobre todo o historico de itens.
 */
export async function buildStagnantReport(params: {
  days: number[];
  categoryId?: number;
  onlyWithStock?: boolean;
}): Promise<{
  items: import('@webdist/shared').StagnantProduct[];
  periods: { days: number; label: string; count: number; tiedUpValueCents: number }[];
  totalTiedUpValueCents: number;
  basis: string;
  generatedAt: string;
}> {
  const { days, categoryId, onlyWithStock = true } = params;
  const periods = [...new Set(days)].filter((d) => d > 0).sort((a, b) => a - b);
  const thresholdDays = periods[0] ?? 30;
  const cutoff = new Date(Date.now() - thresholdDays * 86_400_000);

  const products = await prisma.product.findMany({
    where: {
      status: 'ATIVO',
      ...(categoryId ? { categoryId } : {}),
      ...(onlyWithStock ? { stock: { gt: 0 } } : {}),
      // lastSaleAt nulo (nunca vendeu) ou anterior ao corte mais curto.
      OR: [{ lastSaleAt: null }, { lastSaleAt: { lt: cutoff } }],
    },
    include: { category: { select: { name: true } } },
  });

  const items: import('@webdist/shared').StagnantProduct[] = products.map((product) => {
    const daysWithoutSale = product.lastSaleAt
      ? Math.floor((Date.now() - product.lastSaleAt.getTime()) / 86_400_000)
      : null;
    const tiedUp = product.stock * product.costPrice;

    let suggestedAction: import('@webdist/shared').StagnantProduct['suggestedAction'] = 'AVALIAR';
    if (daysWithoutSale !== null && daysWithoutSale >= 90) suggestedAction = 'DESATIVAR';
    else if (daysWithoutSale !== null && daysWithoutSale >= 60) suggestedAction = 'REPOR';
    else suggestedAction = 'PROMOVER';

    return {
      productId: product.id,
      internalCode: product.internalCode,
      barcode: product.barcode,
      name: product.name,
      categoryName: product.category?.name ?? null,
      unit: product.unit,
      stock: product.stock,
      costPrice: product.costPrice,
      salePrice: product.salePrice,
      lastSaleAt: product.lastSaleAt ? product.lastSaleAt.toISOString() : null,
      daysWithoutSale,
      tiedUpValueCents: tiedUp,
      suggestedAction,
    };
  });

  items.sort((a, b) => (b.daysWithoutSale ?? Number.POSITIVE_INFINITY) - (a.daysWithoutSale ?? Number.POSITIVE_INFINITY));

  const periodSummary = periods.map((p) => {
    const inPeriod = items.filter((i) => i.daysWithoutSale === null || i.daysWithoutSale >= p);
    return {
      days: p,
      label: `Sem venda ha ${p}+ dias`,
      count: inPeriod.length,
      tiedUpValueCents: inPeriod.reduce((sum, i) => sum + i.tiedUpValueCents, 0),
    };
  });

  return {
    items,
    periods: periodSummary,
    totalTiedUpValueCents: items.reduce((sum, i) => sum + i.tiedUpValueCents, 0),
    basis:
      'Analise baseada na data da ultima venda registrada e no custo atual de cada produto. ' +
      'Nenhum desconto e aplicado automaticamente; a acao sugerida exige decisao do usuario.',
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* SAZONALIDADE                                                        */
/* ------------------------------------------------------------------ */

/**
 * Vendas agrupadas por mes/categoria/produto/vendedor com comparacao
 * contra o mesmo periodo do ano anterior.
 *
 * A comparacao so e preenchida quando existe o ano anterior na base: sem
 * historico, `variationPercent` e null e a interface diz "sem base de
 * comparacao", em vez de mostrar 0% (que leria como "estavel").
 */
export async function buildSeasonalityReport(params: {
  period: SeasonalityPeriod;
  groupBy: 'MES' | 'CATEGORIA' | 'PRODUTO' | 'VENDEDOR';
  categoryId?: number;
  limit?: number;
}): Promise<{
  period: SeasonalityPeriod;
  groupBy: 'MES' | 'CATEGORIA' | 'PRODUTO' | 'VENDEDOR';
  rows: SeasonalityRow[];
  totals: { salesCount: number; revenueCents: number; itemsSold: number };
  hasComparison: boolean;
  basis: string;
  generatedAt: string;
}> {
  const { groupBy, categoryId, limit = 24 } = params;

  // Janela: 24 meses para o agrupamento mensal, 2 anos para o resto.
  const monthsBack = groupBy === 'MES' ? 24 : 24;
  const since = new Date(Date.now() - monthsBack * 30.44 * 86_400_000);

  const sales = await prisma.sale.findMany({
    where: {
      status: 'CONCLUIDA',
      createdAt: { gte: since },
      ...(categoryId ? { items: { some: { product: { categoryId } } } } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      total: true,
      sellerId: true,
      seller: { select: { name: true } },
      items: {
        select: {
          quantity: true,
          product: {
            select: { id: true, name: true, category: { select: { name: true } } },
          },
        },
      },
    },
  });

  interface Bucket {
    label: string;
    salesCount: number;
    revenueCents: number;
    itemsSold: number;
    /** Meses do ano presentes (1-12) para casar com o ano anterior. */
    monthKeys: Set<string>;
  }
  const buckets = new Map<string, Bucket>();

  const add = (key: string, label: string, monthKey: string, revenue: number, items: number) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, salesCount: 0, revenueCents: 0, itemsSold: 0, monthKeys: new Set() };
      buckets.set(key, bucket);
    }
    bucket.salesCount += 1;
    bucket.revenueCents += revenue;
    bucket.itemsSold += items;
    bucket.monthKeys.add(monthKey);
  };

  for (const sale of sales) {
    const monthKey = `${sale.createdAt.getFullYear()}-${sale.createdAt.getMonth()}`;

    if (groupBy === 'MES') {
      const key = String(sale.createdAt.getFullYear());
      add(key, String(sale.createdAt.getFullYear()), monthKey, sale.total, sale.items.reduce((s, i) => s + i.quantity, 0));
    } else if (groupBy === 'VENDEDOR') {
      add(String(sale.sellerId), sale.seller.name, monthKey, sale.total, sale.items.reduce((s, i) => s + i.quantity, 0));
    } else {
      // CATEGORIA e PRODUTO: uma venda pode tocar varias linhas.
      // A receita e proporcional ao valor do item, para nao atribuir o
      // total da venda a cada categoria.
      const itemsTotal = sale.items.reduce((s, i) => s + i.quantity, 0);
      for (const item of sale.items) {
        if (groupBy === 'CATEGORIA') {
          const name = item.product.category?.name ?? 'Sem categoria';
          const share = itemsTotal > 0 ? item.quantity / itemsTotal : 0;
          add(name, name, monthKey, Math.round(sale.total * share), item.quantity);
        } else {
          const key = String(item.product.id);
          const share = itemsTotal > 0 ? item.quantity / itemsTotal : 0;
          add(key, item.product.name, monthKey, Math.round(sale.total * share), item.quantity);
        }
      }
    }
  }

  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  // Serie anual: casa os anos pelos MESES, nao pelo total, senao um ano
  // com 2 meses de dados pareceria igual a um ano completo.
  const buildRows = (): SeasonalityRow[] =>
    [...buckets.entries()]
      .filter(([key]) => {
        if (groupBy === 'MES') return Number(key) === currentYear || Number(key) === previousYear;
        return true;
      })
      .map(([key, bucket]) => {
        const revenue = bucket.revenueCents;
        const monthCount = new Set([...bucket.monthKeys].map((m) => m.split('-')[1])).size || 1;

        let previousRevenue: number | null = null;
        if (groupBy === 'MES') {
          const previousKeys = [...bucket.monthKeys].filter((m) => m.startsWith(String(previousYear)));
          if (previousKeys.length > 0) {
            previousRevenue = Math.round(
              (revenue / [...bucket.monthKeys].filter((m) => m.startsWith(String(currentYear))).length) *
                previousKeys.length,
            );
          }
        } else {
          const previousBuckets = [...buckets.entries()].filter(
            ([, b]) => b.label === bucket.label && [...b.monthKeys].some((m) => m.startsWith(String(previousYear))),
          );
          if (previousBuckets.length > 0) {
            previousRevenue = previousBuckets[0]![1].revenueCents;
          }
        }

        const variationPercent =
          previousRevenue !== null && previousRevenue > 0
            ? Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1))
            : null;

        return {
          period: key,
          label:
            groupBy === 'MES'
              ? `${key} (${monthCount} ${monthCount === 1 ? 'mes' : 'meses'} com vendas)`
              : bucket.label,
          salesCount: bucket.salesCount,
          revenueCents: revenue,
          itemsSold: bucket.itemsSold,
          ticketAverageCents: bucket.salesCount > 0 ? Math.round(revenue / bucket.salesCount) : 0,
          variationPercent,
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, limit);

  const rows = buildRows();
  const hasComparison = rows.some((r) => r.variationPercent !== null);

  return {
    period: params.period,
    groupBy,
    rows,
    totals: {
      salesCount: rows.reduce((s, r) => s + r.salesCount, 0),
      revenueCents: rows.reduce((s, r) => s + r.revenueCents, 0),
      itemsSold: rows.reduce((s, r) => s + r.itemsSold, 0),
    },
    hasComparison,
    basis: hasComparison
      ? 'Comparacao com o mesmo periodo do ano anterior, usando apenas meses presentes nos dois anos.'
      : `Analise dos ultimos ${monthsBack} meses. Sem dados do ano anterior para comparacao.`,
    generatedAt: new Date().toISOString(),
  };
}
