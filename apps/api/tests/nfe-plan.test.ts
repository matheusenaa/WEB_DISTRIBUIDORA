import { describe, expect, it } from 'vitest';
import { planNfeImport } from '../src/modules/products/nfe-import.js';
import type { NfeItem, NfePreviewRow, CatalogMap } from '../src/modules/products/nfe-import.js';

/**
 * Planificador puro da importacao NF-e.
 *
 * O que se protege aqui e a regra de conflito: o preco de compra da nota
 * NAO deve virar preco de venda do produto automaticamente. A previa
 * marca como IGNORAR e o usuario escolhe explicitamente.
 */

const item = (overrides: Partial<NfeItem> = {}): NfeItem => ({
  line: 1,
  name: 'Produto',
  ean: '789000000001',
  code: 'COD-001',
  unit: 'UN',
  quantity: 10,
  unitValueCents: 500,
  totalCents: 5000,
  ...overrides,
});

const catalogEntry = (
  id: number,
  name: string,
  salePrice: number,
  barcode: string | null,
  internalCode: string | null,
) => ({ id, name, salePrice, barcode, internalCode });

function buildCatalog(entries: ReturnType<typeof catalogEntry>[]): CatalogMap {
  const map = new Map<string, ReturnType<typeof catalogEntry>>();
  for (const e of entries) {
    if (e.barcode) map.set(`EAN:${e.barcode}`, e);
    if (e.internalCode) map.set(`CODIGO:${e.internalCode}`, e);
  }
  return map;
}

describe('planNfeImport', () => {
  it('item sem correspondencia vira CRIAR', () => {
    const { rows, summary } = planNfeImport([item({ ean: '999' })], buildCatalog([]), false);

    expect(rows[0]?.action).toBe('CRIAR');
    expect(summary.create).toBe(1);
    expect(summary.update).toBe(0);
    expect(summary.ignore).toBe(0);
  });

  it('correspondencia por EAN tem prioridade sobre codigo', () => {
    const catalog = buildCatalog([
      catalogEntry(1, 'Produto EAN', 600, '789000000001', 'COD-ERRADO'),
    ]);
    const { rows } = planNfeImport(
      [item({ ean: '789000000001', code: 'COD-ERRADO' })],
      catalog,
      true,
    );

    expect(rows[0]?.matchedBy).toBe('EAN');
    expect(rows[0]?.matchedProductId).toBe(1);
    expect(rows[0]?.action).toBe('ATUALIZAR');
  });

  it('quando EAN nao casa, tenta o codigo do fornecedor', () => {
    const catalog = buildCatalog([
      catalogEntry(2, 'Produto Codigo', 700, null, 'FORN-123'),
    ]);
    const { rows } = planNfeImport([item({ ean: null, code: 'FORN-123' })], catalog, true);

    expect(rows[0]?.matchedBy).toBe('CODIGO');
    expect(rows[0]?.matchedProductId).toBe(2);
  });

  it('updateExisting=false -> IGNORAR com razao explicativa', () => {
    const catalog = buildCatalog([
      catalogEntry(3, 'Ja Cadastrado', 800, '789000000002', 'COD-002'),
    ]);
    const { rows, summary } = planNfeImport(
      [item({ ean: '789000000002', name: 'Da Nota', unitValueCents: 400 })],
      catalog,
      false,
    );

    expect(rows[0]?.action).toBe('IGNORAR');
    expect(rows[0]?.reason).toContain('atualizar existentes');
    expect(summary.ignore).toBe(1);
    expect(summary.update).toBe(0);
  });

  it('updateExisting=true -> ATUALIZAR, expõe preco atual para a tela comparar', () => {
    const catalog = buildCatalog([
      catalogEntry(4, 'Cadastrado', 900, '789000000003', 'COD-003'),
    ]);
    const { rows } = planNfeImport(
      [item({ ean: '789000000003', unitValueCents: 500 })],
      catalog,
      true,
    );

    expect(rows[0]?.action).toBe('ATUALIZAR');
    expect(rows[0]?.currentSalePriceCents).toBe(900);
    expect(rows[0]?.unitValueCents).toBe(500);
  });

  it('totalCents reflete o valor total dos itens lidos da nota', () => {
    const catalog = buildCatalog([
      catalogEntry(5, 'Ignorado', 1000, '789000000004', 'COD-004'),
    ]);
    const { summary } = planNfeImport(
      [
        item({ ean: '789000000004', totalCents: 10000 }),
        item({ ean: '999', totalCents: 5000 }),
      ],
      catalog,
      false,
    );

    // Soma TODOS os itens da nota (inclui os ignorados)
    expect(summary.totalCents).toBe(15000);
  });

  it('resumo contabiliza cada acao corretamente', () => {
    const catalog = buildCatalog([
      catalogEntry(6, 'Atualiza', 2000, '789000000005', 'COD-005'),
    ]);
    const { summary } = planNfeImport(
      [
        item({ ean: '789000000005' }), // IGNORAR: casa por EAN
        item({ ean: '999' }), // CRIAR: sem correspondencia
        item({ ean: '888', code: 'COD-005' }), // IGNORAR: casa por codigo, updateExisting=false
      ],
      catalog,
      false,
    );

    expect(summary.ignore).toBe(2);
    expect(summary.create).toBe(1);
    expect(summary.update).toBe(0);
  });

  it('itemsRead e o numero de itens da nota, nao so os validos', () => {
    const catalog = buildCatalog([]);
    const { summary } = planNfeImport(
      [item(), item({ ean: '999' }), item({ ean: '888' })],
      catalog,
      false,
    );

    expect(summary.itemsRead).toBe(3);
  });

  it('quantidade fracionada ja veio arredondada do parser; aqui so reflete', () => {
    const { rows } = planNfeImport(
      [item({ quantity: 4, totalCents: 7560 })], // 3.75 -> 4
      buildCatalog([]),
      false,
    );
    expect(rows[0]?.quantity).toBe(4);
  });

  it('unidade ja mapeada para catalogo; aqui so passa adiante', () => {
    const { rows } = planNfeImport(
      [item({ unit: 'CX' })],
      buildCatalog([]),
      false,
    );
    expect(rows[0]?.unit).toBe('CX');
  });
});