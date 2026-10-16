import { describe, expect, it } from 'vitest';
import { computeCartTotals } from '../src/lib/cart';

/**
 * Testes dos totais do carrinho do PDV.
 *
 * Regressao: `applyPercentDiscount` devolve o valor JA descontado. Usar esse
 * retorno como se fosse o desconto fazia o total virar o proprio desconto -
 * com 0% de desconto o total aparecia zerado e o desconto, 100%. Como e
 * dinheiro, o calculo tem teste.
 */

describe('computeCartTotals', () => {
  it('sem desconto mantem o total igual ao subtotal', () => {
    const totals = computeCartTotals([
      { unitPriceCents: 579, costCents: 420, quantity: 2, discountPercent: 0 },
    ]);
    expect(totals.subtotal).toBe(1158);
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(1158);
    expect(totals.profit).toBe(1158 - 840);
    expect(totals.items).toBe(2);
  });

  it('aplica desconto percentual sobre o bruto da linha', () => {
    const totals = computeCartTotals([
      { unitPriceCents: 1000, costCents: 600, quantity: 3, discountPercent: 10 },
    ]);
    expect(totals.subtotal).toBe(3000);
    expect(totals.discount).toBe(300);
    expect(totals.total).toBe(2700);
  });

  it('100% de desconto zera o total e nao o subtotal', () => {
    const totals = computeCartTotals([
      { unitPriceCents: 500, costCents: 400, quantity: 1, discountPercent: 100 },
    ]);
    expect(totals.subtotal).toBe(500);
    expect(totals.discount).toBe(500);
    expect(totals.total).toBe(0);
    expect(totals.profit).toBe(-400);
  });

  it('soma varias linhas com descontos diferentes', () => {
    const totals = computeCartTotals([
      { unitPriceCents: 1000, costCents: 500, quantity: 2, discountPercent: 0 },
      { unitPriceCents: 500, costCents: 300, quantity: 1, discountPercent: 20 },
    ]);
    expect(totals.subtotal).toBe(2500);
    expect(totals.discount).toBe(100);
    expect(totals.total).toBe(2400);
    expect(totals.profit).toBe(2400 - 1300);
    expect(totals.items).toBe(3);
  });

  it('carrinho vazio retorna zeros', () => {
    const totals = computeCartTotals([]);
    expect(totals).toEqual({
      subtotal: 0,
      discount: 0,
      total: 0,
      profit: 0,
      margin: 0,
      items: 0,
    });
  });
});
