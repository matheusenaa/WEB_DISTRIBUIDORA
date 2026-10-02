import { describe, expect, it } from 'vitest';
import { MAX_RANGE_DAYS, resolveRange } from '../src/modules/dashboard/routes.js';

/**
 * Resolucao dos periodos do dashboard.
 *
 * A comparacao com o periodo anterior e o que faz o operador confiar no
 * numero. Erro aqui nao quebra a tela: ele produz uma variacao plausivel e
 * errada, que e pior.
 */

/** 15/03/2026, meio-dia: domingo no meio do mes. */
const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

const iso = (date: Date) => date.toISOString();
const dayOf = (date: Date) => date.toDateString();

describe('periodos padrao', () => {
  it('HOJE comeca a meia-noite e vai ate agora', () => {
    const range = resolveRange('HOJE', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(NOW));
    expect(range.from.getHours()).toBe(0);
    expect(range.from.getMinutes()).toBe(0);
    expect(range.to.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('ONTEM e o dia cheio anterior', () => {
    const range = resolveRange('ONTEM', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(new Date(2026, 2, 14)));
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });

  it('ULTIMOS_7 cobre 7 dias incluindo hoje', () => {
    const range = resolveRange('ULTIMOS_7', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(new Date(2026, 2, 9)));
    expect(dayOf(range.to)).toBe(dayOf(NOW));
  });

  it('ULTIMOS_30 cobre 30 dias incluindo hoje', () => {
    const range = resolveRange('ULTIMOS_30', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(new Date(2026, 1, 14)));
  });

  it('MES_ATUAL comeca no dia 1', () => {
    const range = resolveRange('MES_ATUAL', undefined, undefined, NOW);

    expect(range.from.getDate()).toBe(1);
    expect(dayOf(range.to)).toBe(dayOf(NOW));
  });

  it('MES_ATUAL compara com o mes anterior inteiro', () => {
    const range = resolveRange('MES_ATUAL', undefined, undefined, NOW);

    expect(dayOf(range.previousFrom)).toBe(dayOf(new Date(2026, 1, 1)));
    expect(range.previousTo.getDate()).toBe(28);
  });

  /**
   * O bug corrigido. A janela anterior era de `addDays(prevStart, -1)`
   * ate `startOfMonth(prevStart)`: do dia 28 as 00:00 de fevereiro ate
   * 1 de fevereiro as 00:00. Menos de um milissegundo de janela, sempre
   * vazia, entao a variacao do mes anterior aparecia como queda para zero.
   */
  it('MES_ANTERIOR compara com o mes antepenultimo inteiro', () => {
    const range = resolveRange('MES_ANTERIOR', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(new Date(2026, 1, 1)));
    expect(range.to.getDate()).toBe(28);
    // Mes anterior de mes anterior: janeiro cheio, 1o a 31.
    expect(dayOf(range.previousFrom)).toBe(dayOf(new Date(2026, 0, 1)));
    expect(dayOf(range.previousTo)).toBe(dayOf(new Date(2026, 0, 31)));
  });

  it('MES_ANTERIOR em janeiro compara com o ano anterior', () => {
    const january = new Date(2026, 0, 20, 10, 0, 0, 0);
    const range = resolveRange('MES_ANTERIOR', undefined, undefined, january);

    expect(dayOf(range.from)).toBe(dayOf(new Date(2025, 11, 1)));
    expect(dayOf(range.previousFrom)).toBe(dayOf(new Date(2025, 10, 1)));
    expect(dayOf(range.previousTo)).toBe(dayOf(new Date(2025, 10, 30)));
  });

  it('desconhecido cai em HOJE', () => {
    const range = resolveRange('NAO_EXISTE', undefined, undefined, NOW);

    expect(dayOf(range.from)).toBe(dayOf(NOW));
  });
});

describe('periodo personalizado', () => {
  it('exige as duas datas', () => {
    expect(() => resolveRange('PERSONALIZADO', undefined, undefined, NOW)).toThrowError(/datas/i);
  });

  it('aceita datas em ordem invertida', () => {
    const range = resolveRange(
      'PERSONALIZADO',
      new Date(2026, 2, 20),
      new Date(2026, 2, 10),
      NOW,
    );

    expect(dayOf(range.from)).toBe(dayOf(new Date(2026, 2, 10)));
    expect(dayOf(range.to)).toBe(dayOf(new Date(2026, 2, 20)));
  });

  /**
   * A serie diaria tem uma entrada por dia e as vendas sao carregadas uma a
   * uma para agrupar. Sem teto, um intervalo de anos derruba a API.
   */
  it('rejeita periodo acima do teto de dias', () => {
    const from = new Date(2020, 0, 1);
    const to = new Date(2026, 0, 1);

    expect(() => resolveRange('PERSONALIZADO', from, to, NOW)).toThrowError(/nao pode passar de/i);
  });

  it('aceita periodo exatamente no teto', () => {
    const from = new Date(2026, 0, 1);
    // `spanDays` conta dias inclusivos: de 1/jan a 1/jan + N sao N + 1
    // dias, entao o ultimo intervalo aceito termina MAX_RANGE_DAYS - 1 depois.
    const to = new Date(2026, 0, 1 + MAX_RANGE_DAYS - 1);

    expect(() => resolveRange('PERSONALIZADO', from, to, NOW)).not.toThrow();
  });

  it('rejeita um dia a mais que o teto', () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 1 + MAX_RANGE_DAYS);

    expect(() => resolveRange('PERSONALIZADO', from, to, NOW)).toThrowError(/nao pode passar de/i);
  });

  it('o periodo anterior e a mesma duracao, imediatamente antes', () => {
    const range = resolveRange(
      'PERSONALIZADO',
      new Date(2026, 1, 1),
      new Date(2026, 1, 10),
      NOW,
    );

    expect(range.previousTo.getTime()).toBe(range.from.getTime() - 1);

    const currentMs = range.to.getTime() - range.from.getTime();
    const previousMs = range.previousTo.getTime() - range.previousFrom.getTime();
    expect(Math.abs(currentMs - previousMs)).toBeLessThan(86_400_000);
  });
});

describe('limites dos periodos', () => {
  it('todo periodo padrao comeca a meia-noite', () => {
    for (const kind of ['HOJE', 'ONTEM', 'ULTIMOS_7', 'ULTIMOS_30', 'MES_ATUAL', 'MES_ANTERIOR']) {
      const range = resolveRange(kind, undefined, undefined, NOW);
      expect(range.from.getHours(), kind).toBe(0);
      expect(range.to.getTime(), kind).toBeGreaterThan(range.from.getTime());
    }
  });

  it('o periodo anterior nunca invade o periodo atual', () => {
    for (const kind of ['HOJE', 'ONTEM', 'ULTIMOS_7', 'ULTIMOS_30', 'MES_ATUAL', 'MES_ANTERIOR']) {
      const range = resolveRange(kind, undefined, undefined, NOW);
      expect(range.previousTo.getTime(), kind).toBeLessThan(range.from.getTime());
    }
  });

  it('todos os periodos tem rotulo', () => {
    for (const kind of ['HOJE', 'ONTEM', 'ULTIMOS_7', 'ULTIMOS_30', 'MES_ATUAL', 'MES_ANTERIOR']) {
      expect(resolveRange(kind, undefined, undefined, NOW).label.length, kind).toBeGreaterThan(0);
    }
  });

  it('o intervalo do periodo nao gera NaN nas datas', () => {
    const range = resolveRange('MES_ANTERIOR', undefined, undefined, NOW);

    expect(Number.isNaN(range.from.getTime())).toBe(false);
    expect(Number.isNaN(range.previousTo.getTime())).toBe(false);
    expect(iso(range.to)).toBeTruthy();
  });
});