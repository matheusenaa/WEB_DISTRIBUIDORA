import { describe, expect, it } from 'vitest';
import {
  getSettingDefinition,
  maxDiscountPercentForRole,
  normalizeSettingValue,
  resolveSettings,
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from '../src/lib/settings.js';
import { config } from '../src/env.js';

/**
 * Configuracoes de regra de negocio.
 *
 * Duas garantias: o que o administrador digita e aceito de forma coerente,
 * e o que ele salva passa a valer de fato. A segunda falhou antes (a tela
 * gravava no banco e as regras liam o `.env`), e o teste nao pegaria isso
 * sozinho - ele trava a precedencia banco > padrao, que e o ponto.
 */

const def = (key: string): SettingDefinition => {
  const found = getSettingDefinition(key);
  if (!found) throw new Error(`definicao ausente: ${key}`);
  return found;
};

describe('catalogo de configuracoes', () => {
  it('cada definicao tem grupo, rotulo e valor padrao', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.key, definition.key).toBeTruthy();
      expect(definition.label.length, definition.key).toBeGreaterThan(3);
      expect(['EMPRESA', 'VENDAS', 'ESTOQUE', 'CAIXA', 'IMPRESSAO']).toContain(definition.group);
      expect(typeof definition.defaultValue, definition.key).toBe('string');
    }
  });

  it('nao ha chaves repetidas', () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todo campo numerario tem faixa, e a faixa aceita o proprio padrao', () => {
    for (const definition of SETTING_DEFINITIONS.filter((d) => d.type === 'number')) {
      expect(definition.min, definition.key).toBeDefined();
      expect(definition.max, definition.key).toBeDefined();
      const padrao = Number(definition.defaultValue);
      expect(padrao, definition.key).toBeGreaterThanOrEqual(definition.min!);
      expect(padrao, definition.key).toBeLessThanOrEqual(definition.max!);
    }
  });

  it('todo campo de texto com opcoes lista a opcao padrao', () => {
    for (const definition of SETTING_DEFINITIONS.filter((d) => d.options)) {
      expect(definition.options, definition.key).toContain(definition.defaultValue);
    }
  });
});

describe('normalizacao de valor gravado', () => {
  it('boolean aceita as grafias que a tela e o .env produzem', () => {
    const d = def('sale.allowNegativeStock');
    for (const truthy of ['true', 'TRUE', '1', 'sim', 'on', ' true ']) {
      expect(normalizeSettingValue(d, truthy), truthy).toBe('true');
    }
    for (const falsy of ['false', 'FALSE', '0', 'nao', 'off', ' false ']) {
      expect(normalizeSettingValue(d, falsy), falsy).toBe('false');
    }
  });

  it('boolean nao aceita texto ambiguo', () => {
    expect(normalizeSettingValue(def('sale.allowNegativeStock'), 'talvez')).toBeNull();
    expect(normalizeSettingValue(def('sale.allowNegativeStock'), '')).toBeNull();
  });

  it('numero recusa texto, vazio e infinito', () => {
    const d = def('sale.adminMaxDiscount');
    expect(normalizeSettingValue(d, 'abc')).toBeNull();
    expect(normalizeSettingValue(d, '')).toBeNull();
    expect(normalizeSettingValue(d, '   ')).toBeNull();
    expect(normalizeSettingValue(d, 'NaN')).toBeNull();
    expect(normalizeSettingValue(d, 'Infinity')).toBeNull();
  });

  it('vazio em campo numerico nao vira zero', () => {
    // `Number('')` e 0: um desconto apagado viraria "sem desconto" em vez
    // de "campo obrigatorio".
    expect(normalizeSettingValue(def('sale.sellerMaxDiscount'), '')).not.toBe('0');
  });

  it('numero respeita a faixa da definicao', () => {
    const d = def('sale.adminMaxDiscount');
    expect(normalizeSettingValue(d, '0')).toBe('0');
    expect(normalizeSettingValue(d, '100')).toBe('100');
    expect(normalizeSettingValue(d, '-1')).toBeNull();
    expect(normalizeSettingValue(d, '101')).toBeNull();
  });

  it('texto com opcoes recusa valor fora da lista', () => {
    const d = def('print.receiptWidth');
    expect(normalizeSettingValue(d, '58mm')).toBe('58mm');
    expect(normalizeSettingValue(d, '80mm')).toBe('80mm');
    expect(normalizeSettingValue(d, '120mm')).toBeNull();
    expect(normalizeSettingValue(d, 'A4')).toBeNull();
  });

  it('texto livre preserva espacos internos e apara as pontas', () => {
    expect(normalizeSettingValue(def('company.name'), '  Distribuidora Norte  ')).toBe(
      'Distribuidora Norte',
    );
    expect(normalizeSettingValue(def('company.document'), '12.345.678/0001-90')).toBe(
      '12.345.678/0001-90',
    );
  });

  it('numero e canonicalizado para evitar "40" e "40.0" como valores distintos', () => {
    expect(normalizeSettingValue(def('sale.adminMaxDiscount'), '40.0')).toBe('40');
    expect(normalizeSettingValue(def('cash.tolerance'), '0.010')).toBe('0.01');
  });
});

describe('precedencia das regras', () => {
  it('com a tabela vazia vale o padrao de fabrica', () => {
    const settings = resolveSettings({});

    expect(settings.company.name).toBe('WEB DISTRIBUIDORA');
    expect(settings.allowNegativeStock).toBe(config.ALLOW_NEGATIVE_STOCK);
    expect(settings.requireOpenCash).toBe(true);
    expect(settings.autoPrintReceipt).toBe(false);
    expect(settings.receiptWidth).toBe('80mm');
    expect(settings.sellerMaxDiscountPercent).toBe(config.SELLER_MAX_DISCOUNT_PERCENT);
    expect(settings.adminMaxDiscountPercent).toBe(config.ADMIN_MAX_DISCOUNT_PERCENT);
    expect(settings.cashToleranceCents).toBe(config.cashToleranceCents);
  });

  it('o que foi gravado no banco vence o padrao', () => {
    const settings = resolveSettings({
      'company.name': 'Distribuidora Norte',
      'sale.sellerMaxDiscount': '5',
      'sale.adminMaxDiscount': '25',
      'sale.allowNegativeStock': 'true',
      'pdv.requireOpenCash': 'false',
      'stock.defaultMinAlert': '12',
      'cash.tolerance': '0.50',
    });

    expect(settings.company.name).toBe('Distribuidora Norte');
    expect(settings.sellerMaxDiscountPercent).toBe(5);
    expect(settings.adminMaxDiscountPercent).toBe(25);
    expect(settings.allowNegativeStock).toBe(true);
    expect(settings.requireOpenCash).toBe(false);
    expect(settings.defaultMinAlert).toBe(12);
    // A tela informa em reais; as regras operam em centavos.
    expect(settings.cashToleranceCents).toBe(50);
  });

  it('um valor gravado invalido nao derruba as demais regras', () => {
    // Dado corrompido no banco nao pode transformar o limite de desconto
    // em NaN e derrubar toda a venda.
    const settings = resolveSettings({
      'sale.adminMaxDiscount': 'lixo',
      'sale.sellerMaxDiscount': '7',
    });

    expect(settings.adminMaxDiscountPercent).toBe(config.ADMIN_MAX_DISCOUNT_PERCENT);
    expect(settings.sellerMaxDiscountPercent).toBe(7);
  });

  it('largura de cupom fora da lista cai no padrao em vez de vazar para a impressora', () => {
    expect(resolveSettings({ 'print.receiptWidth': 'A4' }).receiptWidth).toBe('80mm');
    expect(resolveSettings({ 'print.receiptWidth': '58mm' }).receiptWidth).toBe('58mm');
  });

  it('tolerancia negativa nao vira tolerancia negativa', () => {
    expect(resolveSettings({ 'cash.tolerance': '-5' }).cashToleranceCents).toBe(
      config.cashToleranceCents,
    );
  });

  it('a tolerancia e convertida de reais para centavos', () => {
    expect(resolveSettings({ 'cash.tolerance': '1' }).cashToleranceCents).toBe(100);
    expect(resolveSettings({ 'cash.tolerance': '0' }).cashToleranceCents).toBe(0);
  });
});

describe('limite por perfil', () => {
  const settings = resolveSettings({
    'sale.sellerMaxDiscount': '3',
    'sale.adminMaxDiscount': '40',
  });

  it('cada perfil recebe o proprio limite', () => {
    expect(maxDiscountPercentForRole('VENDEDOR', settings)).toBe(3);
    expect(maxDiscountPercentForRole('ADMIN', settings)).toBe(40);
  });

  it('limite zero e preservado, nao convertido em "sem limite"', () => {
    const semDesconto = resolveSettings({
      'sale.sellerMaxDiscount': '0',
      'sale.adminMaxDiscount': '0',
    });
    expect(maxDiscountPercentForRole('VENDEDOR', semDesconto)).toBe(0);
    expect(maxDiscountPercentForRole('ADMIN', semDesconto)).toBe(0);
  });
});