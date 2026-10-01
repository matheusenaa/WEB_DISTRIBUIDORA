import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_MOVEMENT_TYPES,
  DOCUMENTAL_MOVEMENT_TYPES,
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  STOCK_MOVEMENT_LABELS,
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '@webdist/shared';

/**
 * O sinal de cada tipo de movimentacao decide se o saldo do estoque sobe
 * ou desce. A classificacao vive em listas separadas porque o service
 * nao deve decidir o sinal sozinho.
 *
 * Um tipo fora de todas as listas nao gera erro de compilacao: o enum
 * aceita o valor e o saldo apenas fica errado. Estes testes existem para
 * que isso apareca no CI, e nao numa reconciliacao de estoque.
 */

const isIn = (set: readonly string[], type: string): boolean => set.includes(type);

function setsContaining(type: string): string[] {
  return [
    ['INBOUND', isIn(INBOUND_MOVEMENT_TYPES, type)],
    ['OUTBOUND', isIn(OUTBOUND_MOVEMENT_TYPES, type)],
    ['ADJUSTMENT', isIn(ADJUSTMENT_MOVEMENT_TYPES, type)],
    ['DOCUMENTAL', isIn(DOCUMENTAL_MOVEMENT_TYPES, type)],
  ]
    .filter(([, present]) => present)
    .map(([name]) => name!);
}

describe('sinal das movimentacoes de estoque', () => {
  it('todo tipo pertence a exatamente uma lista de sinal', () => {
    const orphans = STOCK_MOVEMENT_TYPES.filter((type) => setsContaining(type).length !== 1);

    expect(
      orphans.map((type) => `${type} -> [${setsContaining(type).join(', ')}]`),
    ).toEqual([]);
  });

  it('entradas aumentam o saldo', () => {
    expect(isIn(INBOUND_MOVEMENT_TYPES, 'ENTRADA')).toBe(true);
    expect(isIn(INBOUND_MOVEMENT_TYPES, 'DEVOLUCAO')).toBe(true);
    expect(isIn(INBOUND_MOVEMENT_TYPES, 'TRANSFERENCIA_ENTRADA')).toBe(true);
  });

  it('saidas reduzem o saldo', () => {
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'SAIDA')).toBe(true);
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'VENDA')).toBe(true);
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'PERDA')).toBe(true);
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'TRANSFERENCIA_SAIDA')).toBe(true);
  });

  /**
   * Este e o bug que motivou a separacao. `CANCELAMENTO` estava em
   * OUTBOUND_MOVEMENT_TYPES, entao cancelar uma venda sem repor estoque
   * descontava a quantidade uma segunda vez - a saida ja tinha ocorrido
   * na venda original - e podia zerar o estoque de um item que ainda
   * estava na prateleira.
   */
  it('CANCELAMENTO e documental: nao mexe no saldo', () => {
    expect(isIn(DOCUMENTAL_MOVEMENT_TYPES, 'CANCELAMENTO')).toBe(true);
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'CANCELAMENTO')).toBe(false);
    expect(isIn(INBOUND_MOVEMENT_TYPES, 'CANCELAMENTO')).toBe(false);
    expect(isIn(ADJUSTMENT_MOVEMENT_TYPES, 'CANCELAMENTO')).toBe(false);
  });

  it('AJUSTE fica na lista de ajuste, que ignora o sinal', () => {
    expect(isIn(ADJUSTMENT_MOVEMENT_TYPES, 'AJUSTE')).toBe(true);
    expect(isIn(OUTBOUND_MOVEMENT_TYPES, 'AJUSTE')).toBe(false);
  });

  it('todo tipo tem rotulo para exibicao', () => {
    const missing = STOCK_MOVEMENT_TYPES.filter((type) => !STOCK_MOVEMENT_LABELS[type]);
    expect(missing).toEqual([]);
  });

  it('nenhum rotulo aponta para um tipo inexistente', () => {
    const known = new Set<string>(STOCK_MOVEMENT_TYPES);
    const extras = Object.keys(STOCK_MOVEMENT_LABELS).filter((key) => !known.has(key));
    expect(extras).toEqual([]);
  });

  it('as listas nao tem tipos repetidos entre si', () => {
    const all = [
      ...INBOUND_MOVEMENT_TYPES,
      ...OUTBOUND_MOVEMENT_TYPES,
      ...ADJUSTMENT_MOVEMENT_TYPES,
      ...DOCUMENTAL_MOVEMENT_TYPES,
    ];
    const duplicates = all.filter((type, index) => all.indexOf(type) !== index);
    expect(duplicates).toEqual([]);
  });
});
