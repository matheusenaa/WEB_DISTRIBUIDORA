import type { SeasonalityPeriod, SeasonalityRow } from '@webdist/shared';

/**
 * NUCLEO PURO DA ANALISE DE SAZONALIDADE
 *
 * Separado do `service.ts` de proposito: aqui nao ha Prisma nem acesso ao
 * banco, sao funcoes puras sobre listas em memoria. E o que permite
 * testar as regras de comparacao (que e onde a analise erra) sem subir um
 * banco nem semear vendas.
 *
 * REGRA DO PROJETO: nenhuma comparacao e inventada. Se o periodo anterior
 * nao existe na base, `variationPercent` e `null` e a interface diz "sem
 * base de comparacao". Mostrar 0% seria afirmar estabilidade sem evidencia.
 */

/** Quantos meses cada periodo agrupa. */
export const PERIOD_MONTHS: Record<SeasonalityPeriod, number> = {
  MENSAL: 1,
  TRIMESTRAL: 3,
  ANUAL: 12,
};

/**
 * Meses deslocados para achar o "mesmo periodo do ano passado".
 *
 * A comparacao de sazonalidade e sempre contra 12 meses atras. Expresso na
 * unidade do periodo: 12 meses = 12 baldes mensais, 4 trimestrais, 1 anual.
 */
export function comparisonShift(period: SeasonalityPeriod): number {
  return 12 / PERIOD_MONTHS[period];
}

/**
 * Indice sequencial do mes, para ordenar e deslocar sem depender de Date.
 * Janeiro de 2026 = 2026 * 12 + 0. Monotonico e sem buracos.
 */
export function monthOrdinal(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * O balde temporal que contem um mes, no periodo pedido.
 *
 * `key` e o indice do balde (permite deslocar para o ano anterior somando
 * `comparisonShift`); `label` e o que o usuario le.
 */
export function periodBucket(
  ordinal: number,
  period: SeasonalityPeriod,
): { key: number; label: string } {
  if (period === 'MENSAL') {
    const year = Math.floor(ordinal / 12);
    const month = ordinal % 12;
    return { key: ordinal, label: `${year}-${String(month + 1).padStart(2, '0')}` };
  }
  if (period === 'TRIMESTRAL') {
    // Um balde trimestral = 3 meses. O indice do balde conta trimestres
    // desde o inicio da serie, entao o ano e o balde dividido por 4.
    const bucket = Math.floor(ordinal / 3);
    const year = Math.floor(bucket / 4);
    return { key: bucket, label: `${year}-T${(bucket % 4) + 1}` };
  }
  const bucket = Math.floor(ordinal / 12);
  return { key: bucket, label: String(bucket) };
}

/** Primeiro dia do mes `monthsBack` meses antes de `now`. */
export function windowStart(now: Date, monthsBack: number): Date {
  // Constroi por componentes em vez de subtrair milissegundos: subtrair
  // 30 dias de um mes de fevereiro levaria para o mes anterior, o que
  // cortaria um mes inteiro de vendas.
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
}

/** Meses de historico necessarios para o limite pedido + um periodo de comparacao. */
export function historyMonths(period: SeasonalityPeriod, limit: number): number {
  return (limit + comparisonShift(period)) * PERIOD_MONTHS[period];
}

export interface SeriesSale {
  createdAt: Date;
  total: number;
  itemsSold: number;
}

/**
 * Serie temporal: uma linha por balde do periodo, com variacao contra o
 * mesmo balde 12 meses atras.
 */
export function buildSeasonalitySeries(
  sales: SeriesSale[],
  period: SeasonalityPeriod,
  limit: number,
): { rows: SeasonalityRow[]; hasComparison: boolean } {
  interface Bucket {
    key: number;
    label: string;
    salesCount: number;
    revenueCents: number;
    itemsSold: number;
  }

  const buckets = new Map<number, Bucket>();
  for (const sale of sales) {
    const { key, label } = periodBucket(monthOrdinal(sale.createdAt), period);
    const bucket = buckets.get(key) ?? { key, label, salesCount: 0, revenueCents: 0, itemsSold: 0 };
    bucket.salesCount += 1;
    bucket.revenueCents += sale.total;
    bucket.itemsSold += sale.itemsSold;
    buckets.set(key, bucket);
  }

  const shift = comparisonShift(period);

  const rows = [...buckets.values()]
    // Mais recentes primeiro para aplicar o limite, depois em ordem
    // cronologica: uma serie temporal que salta de marco para janeiro
    // nao e uma serie temporal.
    .sort((a, b) => b.key - a.key)
    .slice(0, limit)
    .sort((a, b) => a.key - b.key)
    .map((bucket): SeasonalityRow => {
      const previous = buckets.get(bucket.key - shift);
      const previousRevenue = previous && previous.revenueCents > 0 ? previous.revenueCents : null;
      return {
        period: bucket.label,
        label: bucket.label,
        salesCount: bucket.salesCount,
        revenueCents: bucket.revenueCents,
        itemsSold: bucket.itemsSold,
        ticketAverageCents: bucket.salesCount > 0 ? Math.round(bucket.revenueCents / bucket.salesCount) : 0,
        variationPercent:
          previousRevenue === null
            ? null
            : Number((((bucket.revenueCents - previousRevenue) / previousRevenue) * 100).toFixed(1)),
      };
    });

  return { rows, hasComparison: rows.some((r) => r.variationPercent !== null) };
}

export interface EntitySale {
  createdAt: Date;
  entityKey: string;
  entityLabel: string;
  /** Receita atribuida a entidade nesta venda (proporcional ao item). */
  revenueCents: number;
  quantity: number;
  /** Quantas vendas tocaram a entidade (a venda e contada uma vez). */
  salesCount: number;
}

export interface EntityBreakdownOptions {
  limit: number;
  /** Ano corrente da analise; o anterior e derivado dele. */
  currentYear: number;
}

/**
 * Quebra por entidade (categoria, produto ou vendedor).
 *
 * A linha mostra o ano corrente inteiro. A variacao compara **apenas os
 * meses que existem nos dois anos**: comparar o ano corrente parcial contra
 * um ano anterior completo produziria uma queda artificial no mes de janeiro
 * de todo ano. Mes sem base fica fora da conta em vez de virar 0%.
 */
export function buildEntityBreakdown(
  sales: EntitySale[],
  options: EntityBreakdownOptions,
): { rows: SeasonalityRow[]; hasComparison: boolean } {
  const { limit, currentYear } = options;
  const previousYear = currentYear - 1;

  interface MonthCell {
    revenueCents: number;
    quantity: number;
    salesCount: number;
  }
  // entidade -> ano -> mes(0-11) -> agregado
  const cells = new Map<string, { label: string; years: Map<number, Map<number, MonthCell>> }>();

  for (const sale of sales) {
    const date = sale.createdAt;
    let entity = cells.get(sale.entityKey);
    if (!entity) {
      entity = { label: sale.entityLabel, years: new Map() };
      cells.set(sale.entityKey, entity);
    }
    let months = entity.years.get(date.getFullYear());
    if (!months) {
      months = new Map();
      entity.years.set(date.getFullYear(), months);
    }
    const month = date.getMonth();
    const cell = months.get(month) ?? { revenueCents: 0, quantity: 0, salesCount: 0 };
    cell.revenueCents += sale.revenueCents;
    cell.quantity += sale.quantity;
    cell.salesCount += sale.salesCount;
    months.set(month, cell);
  }

  const sum = (
    entity: { years: Map<number, Map<number, MonthCell>> },
    year: number,
    monthSet: Set<number>,
    field: keyof MonthCell,
  ) => {
    let total = 0;
    for (const month of monthSet) {
      const cell = entity.years.get(year)?.get(month);
      if (cell) total += cell[field] as number;
    }
    return total;
  };

  const rows: SeasonalityRow[] = [];
  for (const [key, entity] of cells) {
    const currentMonths = new Set(entity.years.get(currentYear)?.keys() ?? []);
    // Entidade que nao vendeu nada no ano corrente nao pertence ao
    // relatorio desta janela. Categoria que sumiu do mapa e informacao de
    // produto parado, nao de sazonalidade.
    if (currentMonths.size === 0) continue;

    const previousMonths = new Set(entity.years.get(previousYear)?.keys() ?? []);
    // Meses presentes nos dois anos: a unica comparacao defensavel.
    const common = new Set([...currentMonths].filter((m) => previousMonths.has(m)));

    const revenueCents = sum(entity, currentYear, currentMonths, 'revenueCents');
    const salesCount = sum(entity, currentYear, currentMonths, 'salesCount');
    const itemsSold = sum(entity, currentYear, currentMonths, 'quantity');

    const currentComparable = sum(entity, currentYear, common, 'revenueCents');
    const previousComparable = sum(entity, previousYear, common, 'revenueCents');

    rows.push({
      period: key,
      label: entity.label,
      salesCount,
      revenueCents,
      itemsSold,
      ticketAverageCents: salesCount > 0 ? Math.round(revenueCents / salesCount) : 0,
      variationPercent:
        common.size === 0 || previousComparable <= 0
          ? null
          : Number((((currentComparable - previousComparable) / previousComparable) * 100).toFixed(1)),
    });
  }

  const hasComparison = rows.some((r) => r.variationPercent !== null);

  return {
    rows: rows.sort((a, b) => b.revenueCents - a.revenueCents).slice(0, limit),
    hasComparison,
  };
}