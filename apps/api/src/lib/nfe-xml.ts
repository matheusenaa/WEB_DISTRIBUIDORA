import { PRODUCT_UNITS, type ProductUnit } from '@webdist/shared';

/**
 * LEITURA DE XML DE NF-e
 *
 * Parsing local, sem dependencia externa e sem chamada de rede: o arquivo
 * do fornecedor chega pelo usuario e a leitura acontece no servidor.
 *
 * Duas decisoes que valem explicar:
 *
 * 1. Nao existe parser de XML no Node. Escrever um aqui se justifica
 *    porque o que interessa do NF-e e uma arvore rasa e previsivel
 *    (`infNFe > det > prod`), nao XML qualquer. O leitor abaixo e
 *    deliberadamente raso: ele nao valida schema nem monta arvore, ele
 *    localiza blocos por nome de tag local e le texto.
 *
 * 2. O prefixo de namespace e descartado. A NF-e e publicada com
 *    namespace (`<nfe:infNFe>`), mas o mesmo documento pode chegar sem
 *    ele de terceiros que reemitem o arquivo. Comparar pelo nome local
 *    funciona nos dois casos.
 *
 * VALORES MONETARIOS: `vUnCom` e `vProd` vem com 10 casas decimais. Sao
 * convertidos para centavos com `Math.round` uma unica vez, e a
 * multiplicacao por quantidade e feita em inteiro. Somar float de dinheiro
 * e o caminho classico para divergencia de centavos no caixa.
 */

/**
 * Valor de um atributo na tag de abertura.
 *
 * A chave de acesso da NF-e nao e uma tag: e o atributo `Id` de
 * `<nfe:infNFe Id="NFe3526..." versao="4.00">`. `findValue` nao a acha, por
 * isso este leitor existe.
 */
export function findAttribute(xml: string, tagName: string, attribute: string): string | null {
  const opening = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${tagName}\\s([^>]*?)/?>`,
  ).exec(xml);
  if (!opening) return null;

  const attrs = opening[1] ?? '';
  const match = new RegExp(`${attribute}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? decodeXmlText(match[1] ?? '') : null;
}

/** Remove o prefixo de namespace: `nfe:det` vira `det`. */
export function localName(tag: string): string {
  const colon = tag.indexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodifica entidades XML e remove CDATA. */
export function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '')
    .trim();
}

/**
 * Conteudo interno de cada ocorrencia de uma tag.
 *
 * Nao casa tag vazia (`<xProd/>`), que e o caso comum de EAN ausente.
 */
export function findBlocks(xml: string, name: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${name}(?:\\s[^>]*?)?\\s*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${name}\\s*>`,
    'g',
  );
  const blocks: string[] = [];
  for (const match of xml.matchAll(pattern)) blocks.push(match[1] ?? '');
  return blocks;
}

/** Texto da primeira ocorrencia da tag, ou null. */
export function findValue(xml: string, name: string): string | null {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${name}(?:\\s[^>]*?)?\\s*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${name}\\s*>`,
  );
  const match = pattern.exec(xml);
  return match ? decodeXmlText(match[1] ?? '') : null;
}

/**
 * Numero decimal do XML -> numero.
 *
 * Aceita `1.234,56` e `1234.56`: XML da NF-e usa ponto, mas planilha
 * convertida usa virgula.
 */
export function parseDecimal(raw: string | null): number | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reais com 10 casas -> centavos, arredondando uma vez. */
export function toCents(raw: string | null): number | null {
  const value = parseDecimal(raw);
  if (value === null) return null;
  return Math.round(value * 100);
}

/** `2026-03-15T10:30:00-03:00` -> Date. */
function parseIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Unidade comercial da NF-e -> unidade do catalogo.
 *
 * A NF-e usa `UN`, `PC`, `CX`, `FD`, `LT`, `MT`, `KG`... e o catalogo tem
 * um conjunto proprio. Duas letras viram `UN` em vez de sumirem: um
 * pacote com unidade desconhecida continua sendo um item, e o usuario
 * ajusta na tela.
 */
const UNIT_MAP: Record<string, ProductUnit> = {
  UN: 'UN',
  UND: 'UN',
  UNID: 'UN',
  PC: 'UN',
  PCT: 'PCT',
  CX: 'CX',
  CJ: 'CX',
  CAIXA: 'CX',
  KG: 'KG',
  G: 'G',
  GR: 'G',
  LT: 'L',
  L: 'L',
  ML: 'ML',
  MT: 'M',
  M: 'M',
  M2: 'M',
  M3: 'M',
  PAR: 'PAR',
  DZ: 'DZ',
  PAC: 'UN',
  FD: 'UN',
  FR: 'UN',
  GL: 'L',
  MIL: 'UN',
  SC: 'UN',
  TST: 'UN',
};

export function mapNfeUnit(raw: string | null): ProductUnit {
  const key = (raw ?? '').trim().toUpperCase();
  if (key in UNIT_MAP) return UNIT_MAP[key]!;
  if ((PRODUCT_UNITS as readonly string[]).includes(key)) return key as ProductUnit;
  return 'UN';
}

export interface NfeItem {
  /** Numero do item dentro da nota (1-based), como aparece na tela. */
  line: number;
  /** Codigo do fornecedor (`cProd`). */
  code: string | null;
  /** GTIN/EAN. `SEM GTIN` vira null: e o placeholder oficial. */
  ean: string | null;
  name: string;
  unit: ProductUnit;
  /** Unidade da nota, preservada para mostrar divergencia de conversao. */
  rawUnit: string | null;
  quantity: number;
  unitValueCents: number;
  totalCents: number;
}

export interface ParsedNfe {
  /** Chave de acesso de 44 digitos, quando presente. */
  accessKey: string | null;
  /** Numero e serie da nota. */
  number: string | null;
  series: string | null;
  issueDate: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  destinationName: string | null;
  items: NfeItem[];
  /** Valor total da nota (`vNF`). */
  totalCents: number | null;
  /**
   * Avisos que nao impedem a importacao: EAN ausente, quantidade fracionada,
   * total que nao bate com a soma dos itens. A tela mostra antes de
   * confirmar.
   */
  warnings: string[];
  /** Itens que nao puderam ser lidos. */
  errors: Array<{ line: number; reason: string }>;
}

/**
 * Extrai os dados de uma NF-e.
 *
 * Devolve avisos em vez de falhar por um item ruim: uma nota de 200 linhas
 * com 3 produtos sem EAN ainda e uma importacao util, desde que a tela
 * deixe o usuario ver o que ficou de fora.
 */
export function parseNfeXml(xml: string): ParsedNfe {
  const warnings: string[] = [];
  const errors: Array<{ line: number; reason: string }> = [];
  const items: NfeItem[] = [];

  const infNFe = findBlocks(xml, 'infNFe')[0] ?? xml;
  const ide = findBlocks(infNFe, 'ide')[0] ?? infNFe;
  const emit = findBlocks(infNFe, 'emit')[0] ?? '';
  const dest = findBlocks(infNFe, 'dest')[0] ?? '';

  // `det` pode repetir nome de tag dentro de `prod` (infAdProd), por isso a
  // leitura de `prod` acontece dentro do bloco do item, nunca do documento.
  const detBlocks = findBlocks(infNFe, 'det');

  let sumOfItems = 0;
  detBlocks.forEach((det, index) => {
    const line = index + 1;
    const prod = findBlocks(det, 'prod')[0] ?? det;

    const name = findValue(prod, 'xProd');
    if (!name) {
      errors.push({ line, reason: 'Item sem descricao (xProd).' });
      return;
    }

    const rawEan = findValue(prod, 'cEAN');
    const ean = !rawEan || /^SEM GTIN$/i.test(rawEan) ? null : rawEan;
    if (!ean) warnings.push(`Item ${line} (${name}): nota fiscal sem codigo de barras.`);

    const quantity = parseDecimal(findValue(prod, 'qCom'));
    const unitValueCents = toCents(findValue(prod, 'vUnCom'));
    const totalCents = toCents(findValue(prod, 'vProd'));

    if (quantity === null || quantity <= 0) {
      errors.push({ line, reason: `Item ${name}: quantidade invalida.` });
      return;
    }
    if (unitValueCents === null || unitValueCents < 0) {
      errors.push({ line, reason: `Item ${name}: valor unitario invalido.` });
      return;
    }

    // O catalogo tem estoque inteiro. Uma nota em kg com 3 casas nao pode
    // ser arredondada em silencio: o usuario precisa ver o que foi ajustado.
    if (!Number.isInteger(quantity)) {
      warnings.push(
        `Item ${line} (${name}): quantidade fracionada (${quantity}) sera arredondada, porque o estoque e inteiro.`,
      );
    }

    // `vProd` as vezes vem zerado em notas antigas; o preco unitario e a
    // fonte confiavel.
    const resolvedTotal =
      totalCents !== null && totalCents > 0 ? totalCents : Math.round(unitValueCents * quantity);

    sumOfItems += resolvedTotal;

    items.push({
      line,
      code: findValue(prod, 'cProd') || null,
      ean,
      name,
      unit: mapNfeUnit(findValue(prod, 'uCom')),
      rawUnit: findValue(prod, 'uCom') || null,
      quantity: Number.isInteger(quantity) ? quantity : Math.round(quantity),
      unitValueCents,
      totalCents: resolvedTotal,
    });
  });

  const totalCents = toCents(findValue(findBlocks(infNFe, 'total')[0] ?? '', 'vNF'));
  if (totalCents !== null && items.length > 0 && Math.abs(totalCents - sumOfItems) > 1) {
    warnings.push(
      `A soma dos itens (${(sumOfItems / 100).toFixed(2)}) difere do total da nota (${(totalCents / 100).toFixed(2)}).`,
    );
  }

  if (items.length === 0 && errors.length === 0) {
    warnings.push('Nenhum item encontrado. O arquivo pode ser um modelo de NF-e sem itens.');
  }

  // A chave vem do atributo `Id` de `<infNFe>`, que fica na tag de abertura e
  // portanto some quando o bloco e recortado. Por isso se le no documento
  // inteiro. `chNFe` e o fallback para quem traz a tag.
  const rawKey = findAttribute(xml, 'infNFe', 'Id') ?? findValue(ide, 'chNFe');

  return {
    // `Id="NFe3526..."` carrega a chave com o prefixo `NFe`.
    accessKey: rawKey ? rawKey.replace(/^NFe/, '').trim() || null : null,
    number: findValue(ide, 'nNF') || null,
    series: findValue(ide, 'serie') || null,
    issueDate: parseIsoDate(findValue(ide, 'dhEmi') ?? findValue(ide, 'dEmi')),
    supplierName: findValue(emit, 'xNome') || null,
    supplierDocument: findValue(emit, 'CNPJ') || findValue(emit, 'CPF') || null,
    destinationName: findValue(dest, 'xNome') || null,
    items,
    totalCents,
    warnings,
    errors,
  };
}