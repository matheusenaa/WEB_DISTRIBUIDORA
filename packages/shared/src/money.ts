/**
 * DINHEIRO EM CENTAVOS (inteiros).
 *
 * Regra absoluta do projeto: nenhum valor monetario e persistido ou
 * calculado como float. Todo valor monetario trafega e e armazenado em
 * centavos (inteiro). Isso elimina erros de arredondamento de centavo,
 * que em caixa/vendas acumulam e geram divergencias.
 */

/** Centavos -> string no padrao pt-BR, ex.: 123456 -> "1.234,56" */
export function centsToBRL(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const centavos = abs % 100;
  const reaisStr = reais.toLocaleString('pt-BR', { useGrouping: true });
  return `${negative ? '-' : ''}${reaisStr},${centavos.toString().padStart(2, '0')}`;
}

/** Centavos -> numero fracionario, apenas para exibicao/relatorios. */
export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Converte entrada do usuario ("1.234,56", "1234.56", "1234,56", 1234.56)
 * para centavos, arredondando meio-para-cima.
 * Retorna null quando nao e um numero valido.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.trim();
  if (s === '') return null;
  s = s.replace(/[R$\s\u00a0]/gi, '');
  if (s === '') return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Formato pt-BR: ponto = milhar, virgula = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // So virgula: decimal
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      // "1.234.567" -> milhar
      s = s.replace(/\./g, '');
    } else if (parts[1]!.length === 3 && parts[0]!.length >= 1) {
      // Ambiguo: "1.234" pode ser milhar ou 1.234 decimal.
      // Convenção: tres digitos à direita de ponto com digitos a esquerda
      // e quantidade par de grupos e' milhar (1.234,56 ja cai no caso acima).
      // Aqui tratamos "1.234" como milhar para evitar erro em "R$ 1.234".
      s = s.replace(/\./g, '');
    }
  }

  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Arredonda para inteiro (protege contra resumos de matematica discreta). */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Markup divisor (multiplicador).
 * Markup 40% sobre custo 5000 => preco 7000.
 */
export function priceFromMarkup(costCents: number, markupPercent: number): number {
  return Math.round(costCents * (1 + markupPercent / 100));
}

/**
 * Margem sobre o preco de venda (percentual da receita).
 * Preco 7000, margem 28.57% => lucro 2000.
 */
export function marginFromPrice(priceCents: number, costCents: number): number {
  if (priceCents <= 0) return 0;
  return ((priceCents - costCents) / priceCents) * 100;
}

/**
 * MARKUP sobre o custo (percentual investido -> percentual acrescimo).
 *
 * Custo 5000, preco 7000 => markup 40%.
 *
 * NAO CONFUNDIR com margem: markup e relativo ao CUSTO, margem e relativa
 * ao PRECO DE VENDA. Para o mesmo par (5000 / 7000) os valores sao
 * 40% e 28,57%. Em qualquer discussao comercial os dois numeros precisam
 * estar explicitamente rotulados, senao o vendedor negocia errado.
 */
export function markupFromPrice(priceCents: number, costCents: number): number {
  if (costCents <= 0) return 0;
  return ((priceCents - costCents) / costCents) * 100;
}

/** Preco necessario para atingir a margem desejada. */
export function priceFromMargin(costCents: number, marginPercent: number): number {
  if (marginPercent >= 100) return 0;
  if (marginPercent <= -100) return 0;
  return Math.round(costCents / (1 - marginPercent / 100));
}

/**
 * Conversao inversa: qual margem corresponde a um markup informado.
 * priceFromMarkup e marginFromPrice sao equivalentes por estaformula.
 */
export function marginFromMarkup(markupPercent: number): number {
  const divisor = 1 + markupPercent / 100;
  if (divisor <= 0) return 0;
  return (markupPercent / 100 / divisor) * 100;
}

/** Markup necessario para atingir a margem desejada. */
export function markupFromMargin(marginPercent: number): number {
  if (marginPercent >= 100) return Number.POSITIVE_INFINITY;
  if (marginPercent <= -100) return 0;
  return (marginPercent / (100 - marginPercent)) * 100;
}

/** Lucro estimado em centavos. */
export function profitCents(priceCents: number, costCents: number): number {
  return priceCents - costCents;
}

/**
 * Aplica desconto percentual a um subtotal, garantindo que o resultado
 * nunca fique negativo.
 */
export function applyPercentDiscount(amountCents: number, percent: number): number {
  if (percent <= 0) return Math.max(0, amountCents);
  if (percent >= 100) return 0;
  return Math.max(0, amountCents - Math.round((amountCents * percent) / 100));
}
