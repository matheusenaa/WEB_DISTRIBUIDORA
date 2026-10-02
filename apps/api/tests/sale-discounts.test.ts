import { describe, expect, it } from 'vitest';
import { resolveDiscounts } from '../src/modules/sales/service.js';

/**
 * Controle de desconto da venda.
 *
 * O limite do perfil (vendedor x admin) so tem valor se for medido sobre o
 * desconto TOTAL. Medir cada etapa separadamente deixa passar metade do
 * limite duas vezes, que era exatamente o que o codigo permitia.
 */

type Line = { unitPrice: number; quantity: number; subtotal: number };

/** Linha sem desconto: subtotal cheio. */
function full(unitPrice: number, quantity = 1): Line {
  return { unitPrice, quantity, subtotal: unitPrice * quantity };
}

/** Linha ja com desconto por item aplicado no subtotal. */
function discounted(unitPrice: number, quantity: number, percent: number): Line {
  const gross = unitPrice * quantity;
  const off = Math.round((gross * percent) / 100);
  return { unitPrice, quantity, subtotal: gross - off };
}

describe('resolveDiscounts', () => {
  it('sem desconto, o total e o bruto', () => {
    const result = resolveDiscounts([full(1000), full(2500, 2)], 0, 20);

    expect(result.grossSubtotal).toBe(6000);
    expect(result.itemsSubtotal).toBe(6000);
    expect(result.combinedPercent).toBe(0);
    expect(result.total).toBe(6000);
  });

  it('desconto global reduz o total', () => {
    const result = resolveDiscounts([full(10_000)], 1000, 20);

    expect(result.globalDiscount).toBe(1000);
    expect(result.combinedPercent).toBeCloseTo(10, 5);
    expect(result.total).toBe(9000);
  });

  it('desconto global negativo e tratado como zero', () => {
    const result = resolveDiscounts([full(1000)], -500, 20);

    expect(result.globalDiscount).toBe(0);
    expect(result.total).toBe(1000);
  });

  it('carro vazio nao divide por zero', () => {
    const result = resolveDiscounts([], 0, 20);

    expect(result.combinedPercent).toBe(0);
    expect(result.total).toBe(0);
  });

  /**
   * O bug original. Com limite de 20%: 20% em cada item, mais 20% de
   * desconto global. As duas checagens antigas mediam o global sobre o
   * subtotal ja descontado, entao as duas passavam e o desconto real era
   * de 36%.
   */
  it('desconto por item e global nao se empilham alem do limite', () => {
    expect(() => resolveDiscounts([discounted(10_000, 1, 20)], 1600, 20)).toThrowError(
      /excede o limite/i,
    );
  });

  it('rejeita quando o combinado ultrapassa o limite', () => {
    expect(() => resolveDiscounts([full(10_000)], 2001, 20)).toThrowError(/excede o limite/i);
  });

  it('aceita exatamente o limite', () => {
    const result = resolveDiscounts([full(10_000)], 2000, 20);

    expect(result.combinedPercent).toBeCloseTo(20, 5);
    expect(result.total).toBe(8000);
  });

  it('perfil sem desconto nao consegue conceder nenhum, nem empilhando', () => {
    expect(() => resolveDiscounts([discounted(10_000, 1, 1)], 0, 0)).toThrowError(/nao permite/i);
    expect(() => resolveDiscounts([full(10_000)], 100, 0)).toThrowError(/nao permite/i);
  });

  it('admin com limite maior consegue o desconto combinado', () => {
    const result = resolveDiscounts([discounted(10_000, 1, 30)], 1000, 50);

    expect(result.combinedPercent).toBeCloseTo(40, 5);
    expect(result.total).toBe(6000);
  });

  /**
   * Antes o valor era limitado ao subtotal em silencio, e a venda era
   * gravada com total zero. Agora e erro: o desconto maior que a venda e
   * um bug do cliente, nao uma promoção.
   */
  it('desconto maior que o subtotal e erro, nao venda de total zero', () => {
    expect(() => resolveDiscounts([full(1000)], 1500, 20)).toThrowError(/nao pode ser maior/i);
  });

  it('desconto igual ao subtotal zera a venda', () => {
    const result = resolveDiscounts([full(1000)], 1000, 100);

    expect(result.total).toBe(0);
  });

  it('o desconto registrado e a soma dos dois, sem dupla contagem', () => {
    const result = resolveDiscounts([discounted(10_000, 2, 10)], 500, 30);

    // 2 x 10.000 = 20.000 bruto; 10% por item = 2.000; mais 500 global.
    expect(result.grossSubtotal).toBe(20_000);
    expect(result.itemDiscounts).toBe(2000);
    expect(result.globalDiscount).toBe(500);
    expect(result.combinedDiscount).toBe(2500);
    expect(result.total).toBe(17_500);
  });
});