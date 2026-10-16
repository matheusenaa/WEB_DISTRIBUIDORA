import { applyPercentDiscount, marginFromPrice } from '@webdist/shared';

/** Campos do carrinho do PDV necessarios para calcular os totais. */
export interface CartLineLike {
  unitPriceCents: number;
  costCents: number;
  quantity: number;
  discountPercent: number;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
  margin: number;
  items: number;
}

/**
 * Calcula subtotal, desconto, total, lucro e margem do carrinho do PDV.
 *
 * Tudo em centavos inteiros. `applyPercentDiscount` devolve o valor JA
 * descontado - o desconto deste calculo e a diferenca entre bruto e liquido.
 * Tratar o retorno como se fosse o desconto zerava o total da venda (o
 * "desconto" virava o proprio subtotal, exibindo 100% de desconto).
 *
 * O custo e o das unidades vendidas e nao muda com desconto.
 */
export function computeCartTotals(lines: CartLineLike[]): CartTotals {
  let subtotal = 0;
  let discount = 0;
  let cost = 0;
  for (const line of lines) {
    const gross = line.unitPriceCents * line.quantity;
    const net = applyPercentDiscount(gross, line.discountPercent);
    subtotal += gross;
    discount += gross - net;
    cost += line.costCents * line.quantity;
  }
  const total = subtotal - discount;
  return {
    subtotal,
    discount,
    total,
    profit: total - cost,
    margin: marginFromPrice(total, cost),
    items: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}
