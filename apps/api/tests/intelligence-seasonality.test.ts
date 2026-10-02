import { describe, expect, it } from 'vitest';
import {
  buildEntityBreakdown,
  buildSeasonalitySeries,
  comparisonShift,
  historyMonths,
  monthOrdinal,
  PERIOD_MONTHS,
  periodBucket,
  windowStart,
  type EntitySale,
} from '../src/modules/intelligence/seasonality.js';

/**
 * Nucleo da analise de sazonalidade.
 *
 * O que se protege aqui e a honestidade da comparacao. Uma variacao
 * inventada (tipicamente 0%, que le como "estavel") e pior do que uma
 * variacao ausente: o operador compra com base no numero.
 */

const sale = (createdAt: Date, total: number, itemsSold = 1) => ({ createdAt, total, itemsSold });

describe('baldes de periodo', () => {
  it('mensal rotula pelo mes e ordena sequencialmente', () => {
    expect(periodBucket(monthOrdinal(new Date(2026, 0, 15)), 'MENSAL')).toEqual({
      key: monthOrdinal(new Date(2026, 0, 15)),
      label: '2026-01',
    });
    expect(periodBucket(monthOrdinal(new Date(2026, 11, 31)), 'MENSAL').label).toBe('2026-12');
  });

  it('mensal cruza a virada de ano sem colidir', () => {
    const december = monthOrdinal(new Date(2025, 11, 20));
    const january = monthOrdinal(new Date(2026, 0, 5));
    expect(january).toBe(december + 1);
    expect(periodBucket(december, 'MENSAL').label).toBe('2025-12');
    expect(periodBucket(january, 'MENSAL').label).toBe('2026-01');
  });

  it('trimestral agrupa 3 meses e o ano bate com o do calendario', () => {
    // T1 = jan, fev, mar.
    for (const month of [0, 1, 2]) {
      expect(periodBucket(monthOrdinal(new Date(2026, month, 10)), 'TRIMESTRAL')).toEqual({
        key: Math.floor(monthOrdinal(new Date(2026, 0, 1)) / 3),
        label: '2026-T1',
      });
    }
    expect(periodBucket(monthOrdinal(new Date(2026, 3, 1)), 'TRIMESTRAL').label).toBe('2026-T2');
    expect(periodBucket(monthOrdinal(new Date(2026, 11, 1)), 'TRIMESTRAL').label).toBe('2026-T4');
  });

  it('anual agrupa 12 meses e rotula pelo ano', () => {
    expect(periodBucket(monthOrdinal(new Date(2026, 0, 1)), 'ANUAL').label).toBe('2026');
    expect(periodBucket(monthOrdinal(new Date(2026, 11, 31)), 'ANUAL').label).toBe('2026');
    expect(periodBucket(monthOrdinal(new Date(2027, 0, 1)), 'ANUAL').label).toBe('2027');
  });

  it('o deslocamento de comparacao e sempre 12 meses na unidade do periodo', () => {
    expect(comparisonShift('MENSAL')).toBe(12);
    expect(comparisonShift('TRIMESTRAL')).toBe(4);
    expect(comparisonShift('ANUAL')).toBe(1);

    for (const period of ['MENSAL', 'TRIMESTRAL', 'ANUAL'] as const) {
      expect(comparisonShift(period) * PERIOD_MONTHS[period]).toBe(12);
    }
  });

  it('o historico pedido cobre o limite mais um periodo de comparacao', () => {
    // 24 linhas mensais precisam de 24 + 12 meses para a ultima ter com
    // quem se comparar.
    expect(historyMonths('MENSAL', 24)).toBe(36);
    expect(historyMonths('TRIMESTRAL', 8)).toBe(36);
    expect(historyMonths('ANUAL', 3)).toBe(48);
  });

  it('a janela comeca no primeiro dia do mes, sem perder o mes corrente', () => {
    const now = new Date(2026, 2, 15, 23, 50, 0);
    expect(windowStart(now, 1)).toEqual(new Date(2026, 1, 1));
    expect(windowStart(now, 12)).toEqual(new Date(2025, 2, 1));
    expect(windowStart(new Date(2026, 0, 5), 1)).toEqual(new Date(2025, 11, 1));
  });
});

describe('serie temporal', () => {
  const jan26 = new Date(2026, 0, 10);
  const jan25 = new Date(2025, 0, 10);

  it('calcula a variacao contra o mesmo mes do ano anterior', () => {
    const { rows, hasComparison } = buildSeasonalitySeries(
      [sale(jan25, 1000), sale(jan26, 1500)],
      'MENSAL',
      24,
    );

    expect(hasComparison).toBe(true);
    const current = rows.find((r) => r.label === '2026-01');
    expect(current?.revenueCents).toBe(1500);
    expect(current?.variationPercent).toBe(50);
  });

  it('sem o ano anterior a variacao e null, nunca 0', () => {
    const { rows, hasComparison } = buildSeasonalitySeries([sale(jan26, 1500)], 'MENSAL', 24);

    expect(hasComparison).toBe(false);
    expect(rows[0]?.variationPercent).toBeNull();
  });

  it('ano anterior sem receita nao vira variacao infinita nem -100', () => {
    // Sem venda no ano passado nao ha base de comparacao. Reportar -100%
    // sugeriria que a categoria acabou de sumir, o que nao se sabe.
    const { rows } = buildSeasonalitySeries(
      [sale(jan25, 0), sale(jan26, 1500)],
      'MENSAL',
      24,
    );
    expect(rows.find((r) => r.label === '2026-01')?.variationPercent).toBeNull();
  });

  it('uma queda real e negativa e reportada como negativa', () => {
    const { rows } = buildSeasonalitySeries([sale(jan25, 2000), sale(jan26, 500)], 'MENSAL', 24);
    expect(rows.find((r) => r.label === '2026-01')?.variationPercent).toBe(-75);
  });

  it('nao compara o mes corrente com um mes incompleto do ano anterior', () => {
    // Fevereiro de 2025 (parcial, 3 dias) nao pode ser a base de marco.
    const { rows } = buildSeasonalitySeries(
      [sale(new Date(2025, 1, 2), 900), sale(new Date(2026, 1, 3), 900)],
      'MENSAL',
      24,
    );
    // Fevereiro e' o mesmo mes nos dois anos: a comparacao vale.
    expect(rows.find((r) => r.label === '2026-02')?.variationPercent).toBe(0);
  });

  it('os periodos mudam de fato o agrupamento', () => {
    const sales = [
      sale(new Date(2025, 0, 10), 100),
      sale(new Date(2025, 1, 10), 200),
      sale(new Date(2025, 2, 10), 400),
      sale(new Date(2025, 3, 10), 800),
    ];

    expect(buildSeasonalitySeries(sales, 'MENSAL', 24).rows).toHaveLength(4);
    expect(buildSeasonalitySeries(sales, 'TRIMESTRAL', 24).rows).toHaveLength(2);
    expect(buildSeasonalitySeries(sales, 'ANUAL', 24).rows).toHaveLength(1);
  });

  it('trimestral compara com o trimestre do ano anterior, nao com o anterior', () => {
    const { rows } = buildSeasonalitySeries(
      [sale(new Date(2025, 0, 10), 500), sale(new Date(2026, 0, 10), 1000)],
      'TRIMESTRAL',
      24,
    );
    const t1_26 = rows.find((r) => r.label === '2026-T1');
    const t1_25 = rows.find((r) => r.label === '2025-T1');

    expect(t1_26?.revenueCents).toBe(1000);
    expect(t1_25?.revenueCents).toBe(500);
    expect(t1_26?.variationPercent).toBe(100);
  });

  it('soma vendas e itens dentro do balde', () => {
    const { rows } = buildSeasonalitySeries(
      [sale(new Date(2026, 0, 1), 1000, 2), sale(new Date(2026, 0, 20), 500, 1)],
      'MENSAL',
      24,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salesCount: 2,
      revenueCents: 1500,
      itemsSold: 3,
      ticketAverageCents: 750,
    });
  });

  it('limita as linhas mais recentes e as entrega em ordem cronologica', () => {
    // 30 meses seguidos: janeiro/2025 ate junho/2027.
    const sales = Array.from({ length: 30 }, (_, i) => sale(new Date(2025, i, 10), 100));
    const { rows } = buildSeasonalitySeries(sales, 'MENSAL', 3);

    expect(rows).toHaveLength(3);
    // Os tres meses mais recentes, em ordem cronologica.
    expect(rows.map((r) => r.label)).toEqual(['2027-04', '2027-05', '2027-06']);
  });

  it('sem nenhuma venda devolve serie vazia em vez de quebrar', () => {
    expect(buildSeasonalitySeries([], 'MENSAL', 24)).toEqual({ rows: [], hasComparison: false });
  });
});

describe('quebra por entidade', () => {
  const attributed = (
    createdAt: Date,
    entityKey: string,
    revenueCents: number,
    quantity = 1,
  ): EntitySale => ({
    createdAt,
    entityKey,
    entityLabel: entityKey,
    revenueCents,
    quantity,
    salesCount: 1,
  });

  it('calcula a variacao contra o ano anterior real', () => {
    const { rows, hasComparison } = buildEntityBreakdown(
      [
        attributed(new Date(2025, 0, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 0, 10), 'Bebidas', 2500),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(hasComparison).toBe(true);
    expect(rows[0]?.revenueCents).toBe(2500);
    expect(rows[0]?.variationPercent).toBe(150);
  });

  it('a receita da linha e o ano corrente inteiro, mesmo com meses a menos', () => {
    // Janeiro e fevereiro de 2026 contra janeiro e fevereiro de 2025.
    // A linha mostra os 4 meses; a variacao so usa os 2 meses comuns,
    // senao janeiro pareceria uma queda.
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2025, 0, 10), 'Bebidas', 1000),
        attributed(new Date(2025, 1, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 0, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 1, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 2, 10), 'Bebidas', 1000),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows[0]?.revenueCents).toBe(3000);
    expect(rows[0]?.salesCount).toBe(3);
    expect(rows[0]?.variationPercent).toBe(0);
  });

  it('meses que so existem no ano anterior nao entram na comparacao', () => {
    // Dezembro de 2025 entrou na base, mas dezembro de 2026 ainda nao
    // aconteceu. Comparar os 12 meses de 2025 contra 1 mes de 2026 daria
    // queda de ~92% sem nenhum motivo.
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2025, 0, 10), 'Bebidas', 1000),
        attributed(new Date(2025, 11, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 0, 10), 'Bebidas', 1000),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows[0]?.revenueCents).toBe(1000);
    expect(rows[0]?.variationPercent).toBe(0);
  });

  it('sem nenhum mes em comum a variacao e null, nunca 0', () => {
    const { rows, hasComparison } = buildEntityBreakdown(
      [attributed(new Date(2026, 0, 10), 'Bebidas', 1000)],
      { limit: 24, currentYear: 2026 },
    );

    expect(hasComparison).toBe(false);
    expect(rows[0]?.variationPercent).toBeNull();
  });

  it('uma entidade so com vendas no ano anterior nao aparece entre as linhas', () => {
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2025, 0, 10), 'Antiga', 5000),
        attributed(new Date(2026, 0, 10), 'Atual', 100),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Atual');
  });

  it('entidades com o mesmo faturamento sao ordenadas por qualquer criterio estavel', () => {
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2026, 0, 10), 'B', 1000),
        attributed(new Date(2026, 0, 10), 'A', 1000),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.revenueCents).toBe(rows[1]?.revenueCents);
  });

  it('o ticket medio usa o ano inteiro da entidade', () => {
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2026, 0, 10), 'Bebidas', 1000),
        attributed(new Date(2026, 1, 10), 'Bebidas', 2000),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows[0]?.ticketAverageCents).toBe(1500);
  });

  it('o limite e aplicado sobre as maiores receitas', () => {
    const sales: EntitySale[] = [];
    for (let i = 0; i < 10; i += 1) {
      sales.push(attributed(new Date(2026, 0, 10), `P${i}`, (i + 1) * 100));
    }

    const { rows } = buildEntityBreakdown(sales, { limit: 3, currentYear: 2026 });

    expect(rows).toHaveLength(3);
    expect(rows[0]?.revenueCents).toBe(1000);
    expect(rows[2]?.revenueCents).toBe(800);
  });

  it('agrupa meses repetidos da mesma entidade num so acumulado', () => {
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2026, 0, 1), 'Bebidas', 100, 2),
        attributed(new Date(2026, 0, 1), 'Bebidas', 250, 3),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows[0]).toMatchObject({ revenueCents: 350, itemsSold: 5, salesCount: 2 });
  });

  it('ano com receita zero no anterior mantem a comparacao nula', () => {
    const { rows } = buildEntityBreakdown(
      [
        attributed(new Date(2025, 0, 10), 'Bebidas', 0),
        attributed(new Date(2026, 0, 10), 'Bebidas', 1000),
      ],
      { limit: 24, currentYear: 2026 },
    );

    expect(rows[0]?.variationPercent).toBeNull();
  });
});