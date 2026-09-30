import { describe, expect, it } from 'vitest';
import { reportColumnLabel, reportColumnLabels } from '../src/report-columns.js';

describe('reportColumnLabel', () => {
  it('traduz chaves conhecidas', () => {
    expect(reportColumnLabel('venda')).toBe('Venda');
    expect(reportColumnLabel('estoque_minimo')).toBe('Estoque minimo');
    expect(reportColumnLabel('margem_percent')).toBe('Margem (%)');
    expect(reportColumnLabel('forma_pagamento')).toBe('Pagamento');
  });

  it('fallback legivel para chaves desconhecidas', () => {
    expect(reportColumnLabel('coluna_nova')).toBe('Coluna nova');
    expect(reportColumnLabel('total')).toBe('Total');
  });

  it('nao devolve string vazia', () => {
    expect(reportColumnLabel('a')).toBeTruthy();
  });
});

describe('reportColumnLabels', () => {
  it('mantem a ordem das chaves', () => {
    expect(reportColumnLabels(['data', 'produto', 'quantidade'])).toEqual([
      'Data',
      'Produto',
      'Quantidade',
    ]);
  });

  it('aceita lista vazia', () => {
    expect(reportColumnLabels([])).toEqual([]);
  });
});