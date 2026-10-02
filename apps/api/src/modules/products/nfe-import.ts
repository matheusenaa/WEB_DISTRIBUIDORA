import type { ProductUnit } from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { parseNfeXml, type NfeItem, type ParsedNfe } from '../../lib/nfe-xml.js';
import { applyStockMovement } from '../stock/service.js';

/**
 * IMPORTACAO DE NF-e
 *
 * Duas etapas, e a separacao e o ponto:
 *
 *   1. `previewNfe` le o XML, casa cada item com o catalogo e devolve o que
 *      SERIA feito. Nao escreve nada.
 *   2. `confirmNfeImport` executa exatamente o que a previa descreveu.
 *
 * Sem a previa, importar uma nota errada significaria descobrir o erro
 * olhando o estoque. Com ela, o usuario ve antes: quantos produtos novos,
 * quantos serao sobrescritos, quais EAN nao existem e o que foi ignorado.
 *
 * REGRA DE CONFLITO: um item com EAN que ja existe no catalogo NAO e
 * sobrescrito por default. A nota traz o preco do fornecedor naquele
 * momento; aceitar isso como preco de venda mudaria a margem do negocio
 * por um arquivo importado. A previa marca como `ATUALIZAR` e o usuario
 * escolhe item a item.
 */

/** O que vai acontecer com um item da nota. */
export type NfeItemAction = 'CRIAR' | 'ATUALIZAR' | 'IGNORAR';

export interface NfePreviewRow {
  line: number;
  name: string;
  ean: string | null;
  code: string | null;
  unit: ProductUnit;
  quantity: number;
  unitValueCents: number;
  totalCents: number;
  action: NfeItemAction;
  /** Produto do catalogo que casou, quando houve. */
  matchedProductId: number | null;
  matchedProductName: string | null;
  /** Preco de venda atual, para a tela mostrar a diferenca. */
  currentSalePriceCents: number | null;
  /** Por que o item foi ignorado. */
  reason: string | null;
  /** Como o EAN foi encontrado. */
  matchedBy: 'EAN' | 'CODIGO' | null;
}

export interface NfePreview {
  supplier: {
    id: number | null;
    name: string | null;
    document: string | null;
    /** true quando existe fornecedor com o mesmo documento. */
    found: boolean;
  };
  note: {
    number: string | null;
    series: string | null;
    accessKey: string | null;
    issueDate: string | null;
    totalCents: number | null;
  };
  rows: NfePreviewRow[];
  summary: {
    create: number;
    update: number;
    ignore: number;
    itemsRead: number;
    totalCents: number;
  };
  warnings: string[];
  errors: Array<{ line: number; reason: string }>;
}

/** Normaliza documento: so digits, para comparar CNPJ com pontuacao ou sem. */
const onlyDigits = (value: string | null) => (value ? value.replace(/\D/g, '') : '');

/**
 * Localiza o fornecedor pelo documento do emitente.
 *
 * A comparacao ignora pontuacao, porque o XML traz `12345678000190` e o
 * cadastro costuma trazer `12.345.678/0001-90`. Nao ha como comparar
 * isso no SQL (o SQLite nao tem regexp de digitos), entao a lista de
 * fornecedores e filtrada em memoria. Fornecedor e tabela de dimensao,
 * com dezenas de registros; o teto evita varrer um cadastro aberrantemente
 * grande.
 */
export async function findSupplierByDocument(
  document: string | null,
): Promise<{ id: number; name: string } | null> {
  const digits = onlyDigits(document);
  if (digits.length === 0) return null;

  const candidates = await prisma.supplier.findMany({
    where: { document: { not: null } },
    select: { id: true, name: true, document: true },
    take: 1000,
  });
  const match = candidates.find((s) => onlyDigits(s.document) === digits);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Casa os itens da nota com o catalogo.
 *
 * A busca e feita em uma unica consulta por EAN e outra por codigo, e o
 * resultadoindexado em memoria. Buscar produto por produto dentro do
 * laco transformeria a previa em N consultas.
 */
export type CatalogMap = Map<
  string,
  { id: number; name: string; salePrice: number; internalCode: string | null }
>;

/**
 * Planejador puro da importacao.
 *
 * Dado o catalogo ja indexado (EAN > CODIGO), decide o que acontece com
 * cada item: CRIAR, ATUALIZAR ou IGNORAR. E a regra que evita sobrescrever
 * preco de venda por preco de compra da nota sem confirmacao do usuario.
 */
export function planNfeImport(
  items: NfeItem[],
  catalog: CatalogMap,
  updateExisting: boolean,
): { rows: NfePreviewRow[]; summary: NfePreview['summary'] } {
  const rows: NfePreviewRow[] = items.map((item) => {
    const matchedByEan = item.ean ? catalog.get(`EAN:${item.ean}`) : undefined;
    const matchedByCode =
      matchedByEan === undefined && item.code ? catalog.get(`CODIGO:${item.code}`) : undefined;
    const matched = matchedByEan ?? matchedByCode;

    const base: NfePreviewRow = {
      line: item.line,
      name: item.name,
      ean: item.ean,
      code: item.code,
      unit: item.unit,
      quantity: item.quantity,
      unitValueCents: item.unitValueCents,
      totalCents: item.totalCents,
      action: 'CRIAR',
      matchedProductId: matched?.id ?? null,
      matchedProductName: matched?.name ?? null,
      currentSalePriceCents: matched?.salePrice ?? null,
      reason: null,
      matchedBy: matchedByEan ? 'EAN' : matchedByCode ? 'CODIGO' : null,
    };

    if (matched && !updateExisting) {
      return {
        ...base,
        action: 'IGNORAR',
        reason: 'Ja existe no catalogo. Marque "atualizar existentes" para trazer o preco da nota.',
      };
    }

    return { ...base, action: matched ? 'ATUALIZAR' : 'CRIAR' };
  });

  const summary = {
    create: rows.filter((r) => r.action === 'CRIAR').length,
    update: rows.filter((r) => r.action === 'ATUALIZAR').length,
    ignore: rows.filter((r) => r.action === 'IGNORAR').length,
    itemsRead: items.length,
    totalCents: rows.reduce((sum, r) => sum + r.totalCents, 0),
  };

  return { rows, summary };
}

async function matchCatalog(
  items: NfeItem[],
): Promise<CatalogMap> {
  const eans = [...new Set(items.map((i) => i.ean).filter((v): v is string => !!v))];
  const codes = [
    ...new Set(items.map((i) => i.code).filter((v): v is string => !!v && v.length > 0)),
  ];

  const [byEan, byCode] = await Promise.all([
    eans.length > 0
      ? prisma.product.findMany({
          where: { barcode: { in: eans } },
          select: { id: true, name: true, salePrice: true, internalCode: true, barcode: true },
        })
      : Promise.resolve([]),
    codes.length > 0
      ? prisma.product.findMany({
          where: { internalCode: { in: codes } },
          select: { id: true, name: true, salePrice: true, internalCode: true, barcode: true },
        })
      : Promise.resolve([]),
  ]);

  const map = new Map<
    string,
    { id: number; name: string; salePrice: number; internalCode: string | null }
  >();
  for (const product of [...byEan, ...byCode]) {
    // A chave precisa casar com o que a tela procura: EAN quando existe,
    // senao o codigo do fornecedor.
    if (product.barcode) map.set(`EAN:${product.barcode}`, product);
    if (product.internalCode) map.set(`CODIGO:${product.internalCode}`, product);
  }
  return map;
}

/** O que o usuario pediu para fazer com cada linha da previa. */
export interface NfeConfirmOptions {
  /** Linhas a aplicar. Ausente = todas as linhas `CRIAR`. */
  lines?: number[];
  /** Sobrescrever preco de venda e custo de produtos existentes. */
  updateExisting?: boolean;
  /** Lancar a entrada de estoque dos itens criados. */
  applyStock?: boolean;
  supplierId?: number | null;
}

export async function previewNfe(
  xml: string,
  options: { updateExisting?: boolean } = {},
): Promise<NfePreview> {
  const parsed = parseNfeXml(xml);

  if (parsed.items.length === 0 && parsed.errors.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Nenhum item encontrado no XML. Envie o arquivo da NF-e, nao o modelo em branco.',
    );
  }

  const supplier = await findSupplierByDocument(parsed.supplierDocument);
  const catalog = await matchCatalog(parsed.items);

  const { rows, summary } = planNfeImport(parsed.items, catalog, options.updateExisting ?? false);

  return {
    supplier: {
      id: supplier?.id ?? null,
      name: parsed.supplierName ?? supplier?.name ?? null,
      document: parsed.supplierDocument,
      found: supplier !== null,
    },
    note: {
      number: parsed.number,
      series: parsed.series,
      accessKey: parsed.accessKey,
      issueDate: parsed.issueDate,
      totalCents: parsed.totalCents,
    },
    rows,
    summary,
    warnings: parsed.warnings,
    errors: parsed.errors,
  };
}

export interface NfeConfirmResult {
  created: number;
  updated: number;
  skipped: number;
  stockMovements: number;
  supplierId: number | null;
  errors: Array<{ line: number; reason: string }>;
  message: string;
}

/**
 * Executa a importacao.
 *
 * Refaz o parse e a previa dentro da chamada em vez de confiar no que veio
 * do navegador: o XML reenviado e a fonte, e a previa precisa refletir o
 * catalogo do momento da gravacao (outro usuario pode ter criado oEAN
 * nesse intervalo).
 */
export async function confirmNfeImport(params: {
  xml: string;
  actorId: number;
  options?: NfeConfirmOptions;
}): Promise<NfeConfirmResult> {
  const { xml, actorId, options = {} } = params;
  const preview = await previewNfe(xml, { updateExisting: options.updateExisting ?? false });

  const wanted = options.lines === undefined ? null : new Set(options.lines);
  const applyStock = options.applyStock ?? true;

  const supplierId =
    options.supplierId !== undefined
      ? options.supplierId
      : preview.supplier.id !== null
        ? preview.supplier.id
        : await createSupplierFromNote(preview);

  const created: string[] = [];
  const updated: string[] = [];
  const errors: Array<{ line: number; reason: string }> = [...preview.errors];
  let stockMovements = 0;
  let skipped = preview.summary.ignore;
  let failed = preview.errors.length;

  for (const row of preview.rows) {
    if (row.action === 'IGNORAR') continue;
    // Linha que o usuario desmarcou na previa.
    if (wanted !== null && !wanted.has(row.line)) {
      skipped += 1;
      continue;
    }

    try {
      if (row.action === 'ATUALIZAR' && row.matchedProductId !== null) {
        // Custo vem da nota; preco de venda so muda se o usuario pediu.
        await prisma.product.update({
          where: { id: row.matchedProductId },
          data: {
            costPrice: row.unitValueCents,
            ...(options.updateExisting ? { salePrice: row.unitValueCents } : {}),
          },
        });
        updated.push(row.name);
        continue;
      }

      const product = await prisma.product.create({
        data: {
          name: row.name,
          barcode: row.ean,
          internalCode: row.code,
          costPrice: row.unitValueCents,
          // Sem preco de venda conhecido, o custo e a melhor base
          // disponivel. A margem e ajustada depois, na tela de produtos.
          salePrice: row.unitValueCents,
          stock: 0,
          minStock: 0,
          unit: row.unit,
          supplierId,
          status: 'ATIVO',
        },
        select: { id: true },
      });
      created.push(row.name);

      if (applyStock && row.quantity > 0) {
        await prisma.$transaction(
          (tx) =>
            applyStockMovement(tx, {
              type: 'ENTRADA',
              productId: product.id,
              quantity: row.quantity,
              reason: `Importacao NF-e ${preview.note.number ?? ''}`.trim(),
              documentNumber: preview.note.accessKey ?? preview.note.number ?? 'NFE',
              unitCost: row.unitValueCents,
              userId: actorId,
              // O que veio da nota e entrada de mercadoria, nao uma venda
              // que furou o saldo.
              allowNegative: true,
            }),
        );
        stockMovements += 1;
      }
    } catch (err) {
      errors.push({
        line: row.line,
        reason: err instanceof Error ? err.message : 'erro desconhecido',
      });
      failed += 1;
    }
  }

  return {
    created: created.length,
    updated: updated.length,
    skipped,
    stockMovements,
    supplierId,
    errors,
    message:
      `${created.length} produto(s) criado(s), ${updated.length} atualizado(s)` +
      (stockMovements > 0 ? `, ${stockMovements} entrada(s) de estoque` : '') +
      (skipped > 0 ? `, ${skipped} ignorado(s)` : '') +
      (failed > 0 ? `, ${failed} com erro` : '') +
      '.',
  };
}

/**
 * Cria o fornecedor a partir do emitente da nota.
 *
 * A importacao precisa do vinculo com o fornecedor para a recompra
 * automatica (prazo de entrega, preco minimo) funcionar depois. Deixar o
 * produto sem fornecedor faria a sugestao de compra cair no grupo "Sem
 * fornecedor".
 */
async function createSupplierFromNote(preview: NfePreview): Promise<number | null> {
  const name = preview.supplier.name?.trim();
  if (!name) return null;
  const created = await prisma.supplier.create({
    data: { name, document: preview.supplier.document },
    select: { id: true },
  });
  return created.id;
}