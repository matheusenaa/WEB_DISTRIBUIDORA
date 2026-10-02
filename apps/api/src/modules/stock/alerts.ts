import { prisma } from '../../lib/prisma.js';
import { computeAlertLevel, suggestRestock } from '../../lib/product-mapper.js';
import type {
  RestockGroupDTO,
  StockAlertDTO,
  StockAlertLevel,
  StockAlertsReport,
} from '@webdist/shared';

/**
 * ALERTAS DE ESTOQUE
 *
 * Fonte unica dos alertas. O dashboard, a tela de alertas e os relatorios
 * consomem ESTE modulo: quando a regra de alerta muda (ou quando entra a
 * estimativa de custo e a cobertura em dias), as tres telas mudam juntas.
 * Uma implementacao paralela por tela foi a causa de numeros divergentes
 * entre o card do dashboard e a lista de alertas.
 *
 * A regra em si e simples e vive em `computeAlertLevel`; aqui fica apenas
 * a carga dos dados e o enriquecimento (custo, fornecedor, cobertura).
 */

/** Janela, em dias, usada para estimar o ritmo de venda. */
const COVERAGE_WINDOW_DAYS = 30;

/**
 * Media diaria de venda dos ultimos `windowDays`, por produto.
 *
 * Calculado em SQL (um unico GROUP BY) em vez de buscar as vendas e
 * agregar em JS: o numero de itens de venda cresce rapido e a tela de
 * alertas e aberta varias vezes ao dia.
 *
 * Só o total e usado. Um `COUNT(DISTINCT ...)` por dia foi removido daqui:
 * rodava sobre a tabela inteira e nunca era lido.
 */
async function averageDailySales(
  windowDays: number,
): Promise<Map<number, { total: number }>> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const rows = await prisma.$queryRaw<{ productId: number; total: number }[]>`
    SELECT
      si.productId      AS productId,
      SUM(si.quantity)  AS total
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.status = 'CONCLUIDA'
      AND s.createdAt >= ${since}
    GROUP BY si.productId
  `;

  return new Map(rows.map((r) => [Number(r.productId), { total: Number(r.total) }]));
}

export interface BuildAlertsOptions {
  /** Filtra por nivel exato. Ausente = todos os niveis. */
  level?: StockAlertLevel | 'TODOS';
  limit?: number;
  /** Ignora o limite de `limit` (usado para calcular o resumo). */
  noLimit?: boolean;
}

/** Mais urgente primeiro: zerado, depois critico, depois baixo. */
export function sortAlerts(alerts: StockAlertDTO[]): StockAlertDTO[] {
  const order: Record<StockAlertLevel, number> = { ZERADO: 0, CRITICO: 1, BAIXO: 2 };
  return [...alerts].sort(
    (a, b) =>
      order[a.alertLevel] - order[b.alertLevel] ||
      // Dentro do nivel, quem tem menos dias de cobertura e mais urgente.
      // Sem historico de venda vai para o fim: nao da para afirmar que
      // acaba antes, mas tambem nao e o caso mais critico.
      (a.daysOfCoverage ?? Number.POSITIVE_INFINITY) -
        (b.daysOfCoverage ?? Number.POSITIVE_INFINITY),
  );
}

export type StockAlertsSummary = StockAlertsReport['summary'];

/**
 * Totais do cabecalho.
 *
 * `estimatedTotalCents` volta `null` quando algum produto nao tem custo
 * conhecido: um total menor que o real seria pior do que nenhuma
 * estimativa, porque o operador usa esse numero para dimensionar a compra.
 * `productsWithoutCost` diz quantos ficaram de fora.
 */
export function summarizeAlerts(alerts: StockAlertDTO[]): StockAlertsSummary {
  const byLevel: Record<StockAlertLevel, number> = { ZERADO: 0, CRITICO: 0, BAIXO: 0 };
  let totalUnitsToRestock = 0;
  let knownCents = 0;
  let productsWithoutCost = 0;

  for (const alert of alerts) {
    byLevel[alert.alertLevel] += 1;
    totalUnitsToRestock += alert.suggestedRestock;
    if (alert.estimatedCostCents === null) {
      // So conta como "sem custo" quando ha mesmo algo a comprar: um
      // produto zerado e sem custo nao gera pendencia de desembolso.
      if (alert.suggestedRestock > 0) productsWithoutCost += 1;
    } else {
      knownCents += alert.estimatedCostCents;
    }
  }

  return {
    byLevel,
    totalUnitsToRestock,
    estimatedTotalCents: productsWithoutCost > 0 ? null : knownCents,
    productsWithoutCost,
  };
}

/**
 * Agrupa por fornecedor.
 *
 * E assim que a compra acontece na pratica: um pedido por fornecedor. Um
 * pedido unico com tudo daria um total sem cotacao possivel e o
 * recebimento misturaria notas de origem diferente.
 */
export function groupAlertsBySupplier(alerts: StockAlertDTO[]): RestockGroupDTO[] {
  const groups = new Map<string, RestockGroupDTO>();

  for (const alert of alerts) {
    const key = alert.supplierId === null ? 'sem-fornecedor' : String(alert.supplierId);
    let group = groups.get(key);
    if (!group) {
      group = {
        supplierId: alert.supplierId,
        supplierName: alert.supplierName ?? 'Sem fornecedor definido',
        productCount: 0,
        totalUnits: 0,
        totalCents: 0,
        withoutSupplier: 0,
      };
      groups.set(key, group);
    }
    group.productCount += 1;
    group.totalUnits += alert.suggestedRestock;
    group.totalCents += alert.estimatedCostCents ?? 0;
    if (alert.supplierId === null) group.withoutSupplier += 1;
  }

  return [...groups.values()].sort(
    (a, b) => b.totalUnits - a.totalUnits || a.supplierName.localeCompare(b.supplierName),
  );
}

export async function buildStockAlerts(options: BuildAlertsOptions = {}): Promise<StockAlertsReport> {
  const { level = 'TODOS', limit = 100, noLimit = false } = options;

  const products = await prisma.product.findMany({
    where: { status: 'ATIVO', minStock: { gt: 0 } },
    select: {
      id: true,
      internalCode: true,
      name: true,
      unit: true,
      stock: true,
      minStock: true,
      maxStock: true,
      costPrice: true,
      supplierId: true,
      supplier: { select: { name: true } },
    },
  });

  const salesMap = await averageDailySales(COVERAGE_WINDOW_DAYS);

  const alerts: StockAlertDTO[] = [];
  for (const p of products) {
    const alertLevel = computeAlertLevel(p);
    if (!alertLevel) continue;
    if (level !== 'TODOS' && alertLevel !== level) continue;

    const suggestedRestock = suggestRestock(p);
    const stats = salesMap.get(p.id);
    const averageDaily = stats ? stats.total / COVERAGE_WINDOW_DAYS : 0;

    alerts.push({
      productId: p.id,
      code: p.internalCode ?? `#${p.id}`,
      name: p.name,
      unit: p.unit,
      stock: p.stock,
      minStock: p.minStock,
      maxStock: p.maxStock,
      alertLevel,
      suggestedRestock,
      costPrice: p.costPrice,
      estimatedCostCents: p.costPrice > 0 ? p.costPrice * suggestedRestock : null,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? null,
      // Estoque negativo ja estourou o limite: cobertura nao se aplica.
      daysOfCoverage: averageDaily > 0 && p.stock >= 0 ? Number((p.stock / averageDaily).toFixed(1)) : null,
    });
  }

  const sorted = sortAlerts(alerts);

  return {
    data: noLimit ? sorted : sorted.slice(0, limit),
    total: sorted.length,
    summary: summarizeAlerts(sorted),
    groups: groupAlertsBySupplier(sorted),
  };
}