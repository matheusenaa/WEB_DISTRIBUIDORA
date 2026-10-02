import { prisma } from '../../lib/prisma.js';
import type {
  ConfidenceLevel,
  ReplenishmentItem,
  ReplenishmentReason,
  SeasonalityPeriod,
  SeasonalityRow,
} from '@webdist/shared';
import {
  buildEntityBreakdown,
  buildSeasonalitySeries,
  historyMonths,
  windowStart,
  type EntitySale,
} from './seasonality.js';

/**
 * INTELIGENCIA DE REPOSICAO
 *
 * Regra do projeto: NENHUMA previsao e apresentada como certeza. Todo
 * resultado carrega o campo `confidence` derivado de quantos dados
 * historicos existem, e o `basis` explica a base do calculo em texto
 * legivel. Quando nao ha historico, o sistema diz que nao ha dados em vez
 * de inventar um numero.
 */

/**
 * Amostra minima (em unidades vendidas) para considerar o ritmo de venda
 * confiavel.
 *
 * Medido em volume, nao em dias: uma janela de 7 dias com 40 unidades
 * vendidas e' um bom estimador, enquanto 90 dias com 2 unidades nao dizem
 * nada sobre o ritmo. O criterio e independente da janela, entao comparar
 * uma janela curta com uma longa continua fazendo sentido.
 */
const HIGH_CONFIDENCE_UNITS = 30;
const MEDIUM_CONFIDENCE_UNITS = 10;
const HIGH_CONFIDENCE_DAYS = 30;
const MEDIUM_CONFIDENCE_DAYS = 12;

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
 *
 * `days` conta DIAS DE VENDA distintos, e nao vendas. Precisa ser o dia
 * civil: e ele que diz se o produto vende todo dia ou so uma vez por
 * mes. Ver `dayIndexSql` no fim do arquivo para o porque de nao usar
 * `date()`.
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
      si.productId                        AS productId,
      SUM(si.quantity)                    AS total,
      COUNT(DISTINCT ${dayIndexSql('s.createdAt')}) AS days,
      MAX(s.createdAt)                    AS lastSale
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

/**
 * Indice do dia civil (UTC) de uma coluna DateTime do Prisma.
 *
 * NAO usar `date(coluna)`: o Prisma grava DateTime no SQLite como INTEGER
 * de milissegundos desde a epoch, nao como texto ISO. `date()` recebe um
 * numero, devolve NULL, e um `COUNT(DISTINCT date(coluna))` conta zero
 * dias em qualquer consulta. Verificado contra o dev.db:
 * `typeof(createdAt) = 'integer'`.
 *
 * Dividir por 86400000 com divisao inteira da o dia civil em UTC. O fuso
 * do negocio e aplicado na borda, entao agrupar por dia UTC mantem a
 * soma do dia igual a soma do dia em qualquer fuso inteiro.
 */
const MS_PER_DAY = 86_400_000;
function dayIndexSql(column: string): string {
  return `CAST(${column} / ${MS_PER_DAY} AS INTEGER)`;
}

/**
 * Confianca no ritmo de venda.
 *
 * Baseada no volume observado e na quantidade de dias com venda, e nao em
 * um prazo fixo: um limiar em dias nao pode funcionar para uma janela de 7
 * e para uma de 365 ao mesmo tempo (com 7 dias, nenhum produto poderia
 * jamais alcancar a faixa alta).
 */
function confidenceFor(totalUnits: number, daysWithData: number): ConfidenceLevel {
  if (daysWithData === 0 || totalUnits <= 0) return 'SEM_DADOS';
  if (totalUnits >= HIGH_CONFIDENCE_UNITS || daysWithData >= HIGH_CONFIDENCE_DAYS) return 'ALTA';
  if (totalUnits >= MEDIUM_CONFIDENCE_UNITS || daysWithData >= MEDIUM_CONFIDENCE_DAYS) return 'MEDIA';
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
        // Estoque negativo nao tem "dias de cobertura": o estourou ja.
        // Reportar -3 dias seria ruido; a urgencia vem do `reason`.
        averageDaily > 0 && product.stock >= 0
          ? Number((product.stock / averageDaily).toFixed(1))
          : null,
      reason,
      confidence: confidenceFor(totalSold, daysWithData),
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
 * Vendas agrupadas no periodo pedido, com comparacao contra o mesmo
 * periodo do ano anterior.
 *
 * Duas formas, porque as perguntas sao diferentes:
 *  - `groupBy: 'MES'` e uma serie temporal: uma linha por mes/trimestre/ano,
 *    dependendo do `period`, cada uma comparada com o balde 12 meses atras.
 *  - Os demais `groupBy` sao uma quebra por entidade (categoria, produto,
 *    vendedor) dentro da janela, comparada contra o ano anterior usando
 *    apenas os meses que existem nos dois anos.
 *
 * A comparacao so e preenchida quando existe base no ano anterior: sem
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
  const { period, groupBy, categoryId, limit = 24 } = params;

  // Meses de historico: o limite pedido mais um periodo de comparacao,
  // para que a ultima linha ainda tenha com quem ser comparada.
  const monthsBack =
    groupBy === 'MES'
      ? historyMonths(period, limit)
      : Math.max(24, 12 * 2);
  const since = windowStart(new Date(), monthsBack);

  const sales = await prisma.sale.findMany({
    where: {
      status: 'CONCLUIDA',
      createdAt: { gte: since },
      ...(categoryId ? { items: { some: { product: { categoryId } } } } : {}),
    },
    select: {
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

  let rows: SeasonalityRow[];
  let hasComparison: boolean;

  if (groupBy === 'MES') {
    const series = buildSeasonalitySeries(
      sales.map((sale) => ({
        createdAt: sale.createdAt,
        total: sale.total,
        itemsSold: sale.items.reduce((sum, item) => sum + item.quantity, 0),
      })),
      period,
      limit,
    );
    rows = series.rows;
    hasComparison = series.hasComparison;
  } else {
    // Uma venda pode tocar varias linhas. A receita e proporcional a
    // quantidade de cada item, para nao atribuir o total da venda a cada
    // entidade e inflar o total da quebra.
    const attributed: EntitySale[] = [];
    for (const sale of sales) {
      const itemsTotal = sale.items.reduce((sum, item) => sum + item.quantity, 0);

      for (const item of sale.items) {
        const share = itemsTotal > 0 ? item.quantity / itemsTotal : 0;
        const isSeller = groupBy === 'VENDEDOR';
        const entityKey = isSeller
          ? String(sale.sellerId)
          : groupBy === 'PRODUTO'
            ? String(item.product.id)
            : (item.product.category?.name ?? 'Sem categoria');
        const entityLabel = isSeller
          ? sale.seller.name
          : groupBy === 'PRODUTO'
            ? item.product.name
            : (item.product.category?.name ?? 'Sem categoria');

        attributed.push({
          createdAt: sale.createdAt,
          entityKey,
          entityLabel,
          revenueCents: Math.round(sale.total * share),
          quantity: item.quantity,
          salesCount: 1,
        });
      }
    }

    const breakdown = buildEntityBreakdown(attributed, {
      limit,
      currentYear: new Date().getFullYear(),
    });
    rows = breakdown.rows;
    hasComparison = breakdown.hasComparison;
  }

  return {
    period,
    groupBy,
    rows,
    totals: {
      salesCount: rows.reduce((s, r) => s + r.salesCount, 0),
      revenueCents: rows.reduce((s, r) => s + r.revenueCents, 0),
      itemsSold: rows.reduce((s, r) => s + r.itemsSold, 0),
    },
    hasComparison,
    basis: hasComparison
      ? groupBy === 'MES'
        ? `Comparacao com o mesmo periodo 12 meses antes, balde a balde (${period.toLowerCase()}).`
        : 'Comparacao com o ano anterior, considerando apenas os meses que existem nos dois anos.'
      : `Analise dos ultimos ${monthsBack} meses. Sem dados do ano anterior para comparacao.`,
    generatedAt: new Date().toISOString(),
  };
}
