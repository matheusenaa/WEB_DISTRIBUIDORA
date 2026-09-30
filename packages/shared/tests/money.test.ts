import { describe, expect, it } from 'vitest';
import {
  applyPercentDiscount,
  centsToBRL,
  centsToNumber,
  marginFromPrice,
  parseMoneyToCents,
  priceFromMargin,
  priceFromMarkup,
  profitCents,
  toCents,
} from '../src/money.js';

describe('centsToBRL', () => {
  it('formata centavos no padrao pt-BR', () => {
    expect(centsToBRL(0)).toBe('0,00');
    expect(centsToBRL(5)).toBe('0,05');
    expect(centsToBRL(100)).toBe('1,00');
    expect(centsToBRL(2550)).toBe('25,50');
    expect(centsToBRL(123456)).toBe('1.234,56');
  });

  it('mantem o sinal negativo', () => {
    expect(centsToBRL(-2550)).toBe('-25,50');
  });

  it('arredonda valores fracionarios herdados de float', () => {
    expect(centsToBRL(10.5)).toBe('0,11');
  });
});

describe('centsToNumber', () => {
  it('divide por 100', () => {
    expect(centsToNumber(2550)).toBe(25.5);
    expect(centsToNumber(-100)).toBe(-1);
  });
});

describe('parseMoneyToCents', () => {
  it('entende o formato pt-BR com milhar e virgula', () => {
    expect(parseMoneyToCents('1.234,56')).toBe(123456);
    expect(parseMoneyToCents('25,50')).toBe(2550);
    expect(parseMoneyToCents('1.234.567,89')).toBe(123456789);
  });

  it('entende o formato com ponto decimal', () => {
    expect(parseMoneyToCents('1234.56')).toBe(123456);
    expect(parseMoneyToCents('25.5')).toBe(2550);
  });

  it('aceita numero, prefixo de moeda e espacos', () => {
    expect(parseMoneyToCents(25.5)).toBe(2550);
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyToCents('  10,00  ')).toBe(1000);
  });

  it('trata "1.234" como milhar, evitando erro em "R$ 1.234"', () => {
    expect(parseMoneyToCents('1.234')).toBe(123400);
  });

  it('retorna null para entradas invalidas', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('   ')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
  });
});

describe('markup e margem', () => {
  it('calcula preco a partir do markup divisor', () => {
    expect(priceFromMarkup(5000, 40)).toBe(7000);
    expect(priceFromMarkup(1000, 0)).toBe(1000);
  });

  it('calcula margem sobre o preco de venda', () => {
    // Custo 1000, venda 7000 => margem 85,71%.
    expect(marginFromPrice(7000, 1000)).toBeCloseTo(85.71, 2);
    // Prejuizo nao gera margem negativa alem do esperado.
    expect(marginFromPrice(1000, 7000)).toBeCloseTo(-600, 2);
    expect(marginFromPrice(0, 1000)).toBe(0);
  });

  it('mantem coerencia entre markup e margem', () => {
    const cost = 1000;
    const price = priceFromMarkup(cost, 40);
    const margin = marginFromPrice(price, cost);

    // Markup de 40% equivale a margem de 28,57%.
    expect(margin).toBeCloseTo(28.57, 2);
    expect(priceFromMargin(cost, margin)).toBe(price);
  });

  it('recusa margens impossiveis', () => {
    expect(priceFromMargin(1000, 100)).toBe(0);
    expect(priceFromMargin(1000, 120)).toBe(0);
    expect(priceFromMargin(1000, -120)).toBe(0);
    expect(priceFromMargin(1000, 50)).toBe(2000);
  });

  it('calcula lucro em centavos', () => {
    expect(profitCents(2550, 1000)).toBe(1550);
  });
});

describe('applyPercentDiscount', () => {
  it('aplica desconto percentual sobre o subtotal', () => {
    expect(applyPercentDiscount(10000, 10)).toBe(9000);
    expect(applyPercentDiscount(10000, 50)).toBe(5000);
  });

  it('nunca devolve valor negativo', () => {
    expect(applyPercentDiscount(10000, 100)).toBe(0);
    expect(applyPercentDiscount(10000, 150)).toBe(0);
    expect(applyPercentDiscount(-500, 10)).toBe(0);
  });

  it('sem desconto devolve o proprio subtotal', () => {
    expect(applyPercentDiscount(10000, 0)).toBe(10000);
    expect(applyPercentDiscount(10000, -10)).toBe(10000);
  });
});

describe('toCents', () => {
  it('arredonda para inteiro', () => {
    expect(toCents(10.4)).toBe(10);
    expect(toCents(10.5)).toBe(11);
    expect(toCents(Number.NaN)).toBe(0);
  });
});

describe('regra de ouro do smoke test', () => {
  it('custo 10,00 e venda 25,00 resulta em margem de 60% sobre a venda', () => {
    const cost = 1000;
    const price = 2500;
    expect(marginFromPrice(price, cost)).toBeCloseTo(60, 5);
    expect(profitCents(price, cost)).toBe(1500);
  });
});