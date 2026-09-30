/**
 * Leitura e escrita de CSV sem dependencias externas.
 *
 * Suporta campos entre aspas com virgula, quebras de linha e aspas
 * escapadas (""), que e o formato emitido pelo Excel em pt-BR.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Detecta o separador usado no cabecalho.
 *
 * O padrao pt-BR (Excel em locale brasileiro) usa `;`, enquanto CSV gerado por
 * ferramentas en_US usa `,`. Sem deteccao, um arquivo exportado pelo proprio
 * sistema (`;`) nao seria lido pela importacao, que esperaria `,`.
 */
function detectDelimiter(text: string): string {
  // Analisa apenas a primeira linha, ignorando conteudo entre aspas.
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') inQuotes = text[i + 1] === '"' ? (i += 1, true) : false;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') commas += 1;
    else if (char === ';') semicolons += 1;
    else if (char === '\n') break;
  }

  return semicolons > commas ? ';' : ',';
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sep = delimiter ?? detectDelimiter(text);
  const matrix: string[][] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === sep) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    matrix.push(row);
  }

  const nonEmpty = matrix.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = (nonEmpty[0] ?? []).map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const padded = [...r];
    while (padded.length < headers.length) padded.push('');
    return padded.slice(0, headers.length);
  });

  return { headers, rows };
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Gera CSV com separador `;` (padrao pt-BR, abre direto no Excel) e BOM
 * UTF-8 para preservar acentos.
 *
 * `keys` indexa as linhas; `labels` (opcional) sao os rotulos escritos no
 * cabecalho. Isso permite exportar cabecalhos amigaveis ("Estoque minimo")
 * sem deixar de ler o valor correto da linha (`row.estoque_minimo`).
 *
 * O par (write `;`, read auto-detect) garante round-trip: o arquivo exportado
 * pelo sistema pode ser reimportado sem ajuste manual.
 */
export function toCsv(
  keys: string[],
  rows: Record<string, unknown>[],
  labels: string[] = keys,
  separator = ';',
): string {
  const headerRow = keys.map((key, index) => escapeCell(labels[index] ?? key));

  const lines: string[] = [];
  lines.push(headerRow.join(separator));
  for (const row of rows) {
    lines.push(keys.map((key) => escapeCell(row[key])).join(separator));
  }
  return lines.join('\n');
}
