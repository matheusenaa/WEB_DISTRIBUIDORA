import { describe, expect, it } from 'vitest';
import type { StockAlertDTO, StockAlertLevel } from '@webdist/shared';
import {
  groupAlertsBySupplier,
  sortAlerts,
  summarizeAlerts,
} from '../src/modules/stock/alerts.js';

/**
 * Regras dos alertas de estoque.
 *
 * Estas funcoes sao a unica fonte dos numeros de alerta, consumidas pelo
 * dashboard, pela tela de alertas e pela geracao de pedido de compra. O
 * risco nao e delas quebrarem: e divergirem entre telas, ou pior,
 * apresentarem um total de custo incompleto como se fosse completo.
 */

let nextId = 1;

function alert(overrides: Partial<StockAlertDTO> = {}): StockAlertDTO {
  return {
    productId: nextId++,
    code: `P${nextId}`,
    name: 'Produto',
    unit: 'UN',
    stock: 1,
    minStock: 5,
    maxStock: null,
    alertLevel: 'BAIXO',
    suggestedRestock: 10,
    costPrice: 100,
    estimatedCostCents: 1000,
    supplierId: 1,
    supplierName: 'Fornecedor A',
    daysOfCoverage: 3,
    ...overrides,
  };
}

describe('ordenacao dos alertas', () => {
  it('prioriza zerado, depois critico, depois baixo', () => {
    const sorted = sortAlerts([
      alert({ alertLevel: 'BAIXO' }),
      alert({ alertLevel: 'ZERADO' }),
      alert({ alertLevel: 'CRITICO' }),
    ]);

    expect(sorted.map((a) => a.alertLevel)).toEqual(['ZERADO', 'CRITICO', 'BAIXO']);
  });

  it('dentro do nivel, quem tem menos dias de cobertura vem primeiro', () => {
    const sorted = sortAlerts([
      alert({ alertLevel: 'CRITICO', daysOfCoverage: 12 }),
      alert({ alertLevel: 'CRITICO', daysOfCoverage: 2 }),
      alert({ alertLevel: 'CRITICO', daysOfCoverage: 7 }),
    ]);

    expect(sorted.map((a) => a.daysOfCoverage)).toEqual([2, 7, 12]);
  });

  /**
   * Sem historico de venda nao existe previsao de ruptura, entao o produto
   * vai para o fim do nivel. Coloca-lo em primeiro sugeriria uma urgencia
   * que os dados nao sustentam.
   */
  it('produto sem historico de venda fica no fim do proprio nivel', () => {
    const sorted = sortAlerts([
      alert({ alertLevel: 'BAIXO', daysOfCoverage: null }),
      alert({ alertLevel: 'BAIXO', daysOfCoverage: 30 }),
    ]);

    expect(sorted.map((a) => a.daysOfCoverage)).toEqual([30, null]);
  });

  it('nao altera o array recebido', () => {
    const original = [alert({ alertLevel: 'BAIXO' }), alert({ alertLevel: 'ZERADO' })];
    const before = original.map((a) => a.productId);

    sortAlerts(original);

    expect(original.map((a) => a.productId)).toEqual(before);
  });
});

describe('resumo dos alertas', () => {
  it('conta por nivel e soma as unidades a repor', () => {
    const summary = summarizeAlerts([
      alert({ alertLevel: 'ZERADO', suggestedRestock: 20, estimatedCostCents: 2000 }),
      alert({ alertLevel: 'CRITICO', suggestedRestock: 10, estimatedCostCents: 1000 }),
      alert({ alertLevel: 'BAIXO', suggestedRestock: 5, estimatedCostCents: 500 }),
    ]);

    expect(summary.byLevel).toEqual({
      ZERADO: 1,
      CRITICO: 1,
      BAIXO: 1,
    } satisfies Record<StockAlertLevel, number>);
    expect(summary.totalUnitsToRestock).toBe(35);
  });

  it('soma o custo estimado quando todos os produtos tem custo', () => {
    const summary = summarizeAlerts([
      alert({ estimatedCostCents: 1000 }),
      alert({ estimatedCostCents: 2500 }),
    ]);

    expect(summary.estimatedTotalCents).toBe(3500);
    expect(summary.productsWithoutCost).toBe(0);
  });

  /**
   * Este e o ponto do desenho: com um produto sem custo, o total verdadeiro
   * e desconhecido. Somar so os conhecidos daria um numero plausivel e
   * errado, e o operador dimensionaria a compra por ele.
   */
  it('devolve custo estimado nulo quando algum produto nao tem custo', () => {
    const summary = summarizeAlerts([
      alert({ estimatedCostCents: 1000 }),
      alert({ estimatedCostCents: null, costPrice: 0, suggestedRestock: 7 }),
    ]);

    expect(summary.estimatedTotalCents).toBeNull();
    expect(summary.productsWithoutCost).toBe(1);
  });

  it('produto sem custo e sem reposicao sugerida nao vira pendencia', () => {
    const summary = summarizeAlerts([
      alert({ alertLevel: 'ZERADO', suggestedRestock: 0, estimatedCostCents: null, costPrice: 0 }),
    ]);

    expect(summary.productsWithoutCost).toBe(0);
    expect(summary.estimatedTotalCents).toBe(0);
  });

  it('lista vazia devolve zeros, sem NaN', () => {
    const summary = summarizeAlerts([]);

    expect(summary.byLevel).toEqual({ ZERADO: 0, CRITICO: 0, BAIXO: 0 });
    expect(summary.totalUnitsToRestock).toBe(0);
    expect(summary.estimatedTotalCents).toBe(0);
  });
});

describe('agrupamento por fornecedor', () => {
  it('separa os produtos de cada fornecedor', () => {
    const groups = groupAlertsBySupplier([
      alert({ supplierId: 1, supplierName: 'Fornecedor A', suggestedRestock: 10, estimatedCostCents: 1000 }),
      alert({ supplierId: 2, supplierName: 'Fornecedor B', suggestedRestock: 4, estimatedCostCents: 800 }),
      alert({ supplierId: 1, supplierName: 'Fornecedor A', suggestedRestock: 6, estimatedCostCents: 600 }),
    ]);

    expect(groups).toEqual([
      {
        supplierId: 1,
        supplierName: 'Fornecedor A',
        productCount: 2,
        totalUnits: 16,
        totalCents: 1600,
        withoutSupplier: 0,
      },
      {
        supplierId: 2,
        supplierName: 'Fornecedor B',
        productCount: 1,
        totalUnits: 4,
        totalCents: 800,
        withoutSupplier: 0,
      },
    ]);
  });

  it('produtos sem fornecedor caem em um grupo proprio e nao somem', () => {
    const groups = groupAlertsBySupplier([
      alert({ supplierId: null, supplierName: null, suggestedRestock: 3, estimatedCostCents: 300 }),
      alert({ supplierId: null, supplierName: null, suggestedRestock: 2, estimatedCostCents: null }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      supplierId: null,
      supplierName: 'Sem fornecedor definido',
      productCount: 2,
      totalUnits: 5,
      withoutSupplier: 2,
    });
  });

  it('ordena pelo maior volume de unidades a repor', () => {
    const groups = groupAlertsBySupplier([
      alert({ supplierId: 1, supplierName: 'Pequeno', suggestedRestock: 1, estimatedCostCents: 100 }),
      alert({ supplierId: 2, supplierName: 'Grande', suggestedRestock: 500, estimatedCostCents: 50_000 }),
    ]);

    expect(groups.map((g) => g.supplierName)).toEqual(['Grande', 'Pequeno']);
  });

  /**
   * O agrupamento e o que alimenta o botao "Gerar pedido de compra", e o
   * modal so oferece fornecedores com `supplierId` numerico. Um grupo com
   * id nulo na Option faria o pedido falhar na API.
   */
  it('todo grupo sem fornecedor fica com supplierId nulo', () => {
    const groups = groupAlertsBySupplier([alert({ supplierId: null, supplierName: null })]);

    expect(groups.every((g) => g.supplierId === null)).toBe(true);
  });
});