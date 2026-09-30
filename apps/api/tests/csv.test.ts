import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/lib/csv.js';

describe('toCsv', () => {
  it('escreve cabecalho e linhas com separador ;', () => {
    const csv = toCsv(['venda', 'total'], [{ venda: 1, total: 2550 }]);
    expect(csv).toBe('venda;total\n1;2550');
  });

  it('usa rotulos amigaveis no cabecalho sem trocar a chave de leitura', () => {
    const rows = [{ codigo_interno: 'P-001', estoque_minimo: 10 }];
    const csv = toCsv(['codigo_interno', 'estoque_minimo'], rows, [
      'Codigo interno',
      'Estoque minimo',
    ]);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('Codigo interno;Estoque minimo');
    // O valor continua sendo lido pela chave tecnica, nao pelo rotulo.
    expect(lines[1]).toBe('P-001;10');
  });

  it('usa as proprias chaves quando nenhum rotulo e informado', () => {
    expect(toCsv(['a'], [{ a: 1 }]).split('\n')[0]).toBe('a');
  });

  it('escapa aspas, separadores e quebras de linha', () => {
    const csv = toCsv(['nome'], [{ nome: 'Calc; "pro" \nnovo' }]);
    expect(csv).toBe('nome\n"Calc; ""pro"" \nnovo"');
  });

  it('escreve vazio para null e undefined', () => {
    const csv = toCsv(['a', 'b'], [{ a: null, b: undefined }]);
    expect(csv.split('\n')[1]).toBe(';');
  });

  it('omite colunas ausentes na linha', () => {
    const csv = toCsv(['a', 'b'], [{ a: 1 }]);
    expect(csv.split('\n')[1]).toBe('1;');
  });

  it('aceita separador customizado', () => {
    const csv = toCsv(['a', 'b'], [{ a: 1, b: 2 }], undefined, ',');
    expect(csv).toBe('a,b\n1,2');
  });
});

describe('deteccao de separador', () => {
  it('detecta ; (padrao pt-BR do Excel)', () => {
    const parsed = parseCsv('a;b;c\n1;2;3');
    expect(parsed.headers).toEqual(['a', 'b', 'c']);
    expect(parsed.rows).toEqual([['1', '2', '3']]);
  });

  it('detecta , (CSV en_US)', () => {
    const parsed = parseCsv('a,b,c\n1,2,3');
    expect(parsed.headers).toEqual(['a', 'b', 'c']);
    expect(parsed.rows).toEqual([['1', '2', '3']]);
  });

  it('nao confunde separador com conteudo entre aspas', () => {
    const parsed = parseCsv('a;b\n"x,y;z";2');
    expect(parsed.rows).toEqual([['x,y;z', '2']]);
  });

  it('respeita separador explicito', () => {
    const parsed = parseCsv('a,b;c\n1;2', ';');
    expect(parsed.headers).toEqual(['a,b', 'c']);
    expect(parsed.rows).toEqual([['1', '2']]);
  });

  it('round-trip: arquivo exportado pelo sistema e reimportavel', () => {
    const rows = [
      { nome: 'Café Orgânico; 500g', codigo_barras: '7891234567890' },
      { nome: 'Leite "integral", 1L', codigo_barras: '7891234567891' },
    ];
    const csv = toCsv(['nome', 'codigo_barras'], rows, ['Nome', 'Codigo de barras']);
    const parsed = parseCsv(csv);

    expect(parsed.headers).toEqual(['Nome', 'Codigo de barras']);
    expect(parsed.rows).toEqual([
      ['Café Orgânico; 500g', '7891234567890'],
      ['Leite "integral", 1L', '7891234567891'],
    ]);
  });
});

describe('parseCsv', () => {
  it('lida cabecalho e linhas', () => {
    const { headers, rows } = parseCsv('a;b\n1;2\n3;4');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('remove BOM', () => {
    const { headers } = parseCsv('\uFEFFa;b\n1;2');
    expect(headers).toEqual(['a', 'b']);
  });

  it('normaliza CRLF', () => {
    const { rows } = parseCsv('a\r\n1\r\n2');
    expect(rows).toEqual([['1'], ['2']]);
  });

  it('preserva virgula e quebra de linha dentro de campos entre aspas', () => {
    const { rows } = parseCsv('a\n"linha1\nlinha2"');
    expect(rows).toEqual([['linha1\nlinha2']]);
  });

  it('desescapa aspas duplicadas', () => {
    const { rows } = parseCsv('a\n"diz ""oi"""');
    expect(rows).toEqual([['diz "oi"']]);
  });

  it('preenche colunas faltantes com vazio', () => {
    const { rows } = parseCsv('a;b;c\n1');
    expect(rows).toEqual([['1', '', '']]);
  });

  it('ignora linhas totalmente vazias', () => {
    const { rows } = parseCsv('a;b\n1;2\n\n\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('devolve vazio para entrada sem conteudo', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [] });
  });

  it('faz round-trip preservando acentos e separadores', () => {
    const rows = [{ produto: 'Café Orgânico; 500g', quantidade: 3 }];
    const csv = toCsv(['produto', 'quantidade'], rows);
    const parsed = parseCsv(csv);

    expect(parsed.headers).toEqual(['produto', 'quantidade']);
    expect(parsed.rows).toEqual([['Café Orgânico; 500g', '3']]);
  });

  it('faz round-trip preservando quebra de linha interna', () => {
    const csv = toCsv(['obs'], [{ obs: 'linha1\nlinha2' }]);
    expect(parseCsv(csv).rows).toEqual([['linha1\nlinha2']]);
  });
});