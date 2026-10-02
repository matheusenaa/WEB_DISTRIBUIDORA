import { z } from 'zod';
import { applyPercentDiscount } from '@webdist/shared';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import {
  getSettings,
  maxDiscountPercentForRole,
  type ResolvedSettings,
} from '../../lib/settings.js';
import { applyStockMovement } from '../stock/service.js';

export interface SaleLineInput {
  productId: number;
  quantity: number;
  unitPrice?: number;
  discountPercent: number;
}

export interface SaleActor {
  id: number;
  name: string;
  role: 'ADMIN' | 'VENDEDOR';
  /** Permite que o vendedor registre venda em nome de outro (uso do admin). */
  sellerId?: number;
}

export interface PreparedLine {
  productId: number;
  productName: string;
  productUnit: string;
  barcode: string | null;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  discountPercent: number;
  discountCents: number;
  subtotal: number;
  costTotal: number;
}

/**
 * Limite de desconto aplicavel ao perfil do operador.
 *
 * Vem das configuracoes gravadas (tela de Configuracoes), nao de variavel
 * de ambiente: mudar o limite de desconto e uma decisao do dono do
 * negocio, nao uma troca de ambiente de implantacao.
 */
export function maxDiscountForRole(
  role: 'ADMIN' | 'VENDEDOR',
  settings: ResolvedSettings,
): number {
  return maxDiscountPercentForRole(role, settings);
}

/**
 * Valida e prepara os itens da venda.
 *
 * Nenhum valor vem do frontend confiavelmente: o preco de venda e lido do
 * catalogo e o desconto e recalculado no servidor conforme a permissao.
 */
export async function prepareSaleLines(
  tx: Tx,
  items: SaleLineInput[],
  actor: SaleActor,
  settings: ResolvedSettings,
): Promise<PreparedLine[]> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, unit: true, barcode: true, salePrice: true, costPrice: true, status: true, stock: true },
  });

  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Um ou mais produtos da venda nao existem.', { missing });
  }

  const discountLimit = maxDiscountForRole(actor.role, settings);
  const prepared: PreparedLine[] = [];
  const stockNeeded = new Map<number, number>();

  for (const item of items) {
    const product = byId.get(item.productId)!;

    if (product.status !== 'ATIVO') {
      throw new AppError(
        'CONFLICT',
        `O produto "${product.name}" esta inativo e nao pode ser vendido.`,
        { productId: product.id },
      );
    }

    if (item.discountPercent > discountLimit) {
      throw new AppError(
        'DISCOUNT_EXCEEDED',
        discountLimit === 0
          ? 'Seu perfil nao permite aplicar desconto nesta venda.'
          : `Desconto de ${item.discountPercent}% excede o limite de ${discountLimit}% para o seu perfil.`,
        { productId: product.id, requested: item.discountPercent, limit: discountLimit },
      );
    }
    if (item.discountPercent < 0) {
      throw new AppError('VALIDATION_ERROR', 'Desconto nao pode ser negativo.');
    }

    const unitPrice = item.unitPrice ?? product.salePrice;
    const gross = unitPrice * item.quantity;
    const discountCents = gross - applyPercentDiscount(gross, item.discountPercent);
    const subtotal = gross - discountCents;

    /**
     * Consolida o mesmo produto apenas quando preco e desconto batem.
     *
     * Juntar linhas com valores diferentes faria `quantity` e `subtotal`
     * contarem coisas distintas: o cliente levaria, por exemplo, 5 unidades
     * e o subtotal cobriria so as 3 da segunda linha. Por isso linhas com
     * preco ou desconto diferentes permanecem separadas - a baixa de
     * estoque continua correta porque `stockNeeded` soma por produto.
     */
    const existing = prepared.find(
      (p) =>
        p.productId === product.id &&
        p.unitPrice === unitPrice &&
        p.discountPercent === item.discountPercent,
    );

    if (existing) {
      existing.quantity += item.quantity;
      existing.subtotal += subtotal;
      existing.discountCents += discountCents;
      existing.costTotal = product.costPrice * existing.quantity;
    } else {
      prepared.push({
        productId: product.id,
        productName: product.name,
        productUnit: product.unit,
        barcode: product.barcode,
        quantity: item.quantity,
        unitPrice,
        costPrice: product.costPrice,
        discountPercent: item.discountPercent,
        discountCents,
        subtotal,
        costTotal: product.costPrice * item.quantity,
      });
    }

    stockNeeded.set(product.id, (stockNeeded.get(product.id) ?? 0) + item.quantity);
  }

  // Confere estoque considerando o total de cada produto na venda.
  for (const [productId, needed] of stockNeeded) {
    const product = byId.get(productId)!;
    if (product.stock < needed && !settings.allowNegativeStock) {
      throw new AppError(
        'STOCK_INSUFFICIENT',
        `Estoque insuficiente para "${product.name}". Disponivel: ${product.stock}, solicitado: ${needed}.`,
        { productId, available: product.stock, requested: needed },
      );
    }
  }

  return prepared;
}

export interface ResolvedDiscounts {
  grossSubtotal: number;
  itemsSubtotal: number;
  itemDiscounts: number;
  globalDiscount: number;
  combinedDiscount: number;
  combinedPercent: number;
  total: number;
}

/**
 * Aplica o desconto global e confere o limite do perfil.
 *
 * O limite e sobre o desconto COMBINADO (por item + global), medido sobre o
 * bruto.
 *
 * Medir o global sobre o subtotal ja descontado permitia empilhar duas vezes
 * o limite: com limite de 20%, 20% em cada item e mais 20% global passavam
 * pelos dois testes e resultavam em 36% de desconto real. A verificacao
 * precisa olhar o total, nao cada etapa.
 *
 * Funcao pura de proposito: a regra de desconto nao deve depender de banco
 * para ser testada.
 */
export function resolveDiscounts(
  lines: Pick<PreparedLine, 'unitPrice' | 'quantity' | 'subtotal'>[],
  requestedGlobalCents: number,
  discountLimit: number,
): ResolvedDiscounts {
  const grossSubtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const itemsSubtotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const itemDiscounts = grossSubtotal - itemsSubtotal;

  const globalDiscount = Math.max(0, requestedGlobalCents);

  if (globalDiscount > itemsSubtotal) {
    // Antes era limitado a itemsSubtotal em silencio, o que registrava uma
    // venda de total zero sem avisar ninguem. O cliente tem um bug.
    throw new AppError(
      'VALIDATION_ERROR',
      'O desconto global nao pode ser maior que o total dos itens.',
      { globalDiscountCents: globalDiscount, itemsSubtotal },
    );
  }

  const combinedDiscount = itemDiscounts + globalDiscount;
  const combinedPercent = grossSubtotal > 0 ? (combinedDiscount / grossSubtotal) * 100 : 0;

  if (combinedPercent > discountLimit) {
    throw new AppError(
      'DISCOUNT_EXCEEDED',
      discountLimit === 0
        ? 'Seu perfil nao permite aplicar desconto nesta venda.'
        : `Desconto total de ${combinedPercent.toFixed(1)}% excede o limite de ${discountLimit}% para o seu perfil.`,
      { requestedPercent: Number(combinedPercent.toFixed(2)), limit: discountLimit },
    );
  }

  return {
    grossSubtotal,
    itemsSubtotal,
    itemDiscounts,
    globalDiscount,
    combinedDiscount,
    combinedPercent,
    total: itemsSubtotal - globalDiscount,
  };
}

export interface CreateSaleParams {
  items: SaleLineInput[];
  paymentMethod: string;
  customerId?: number;
  discountPercent: number;
  globalDiscountCents: number;
  amountPaidCents: number;
  notes?: string | null;
  actor: SaleActor;
}

export interface CreateSaleResult {
  saleId: number;
  number: number;
  total: number;
  changeCents: number;
  cashSessionId: number | null;
  items: PreparedLine[];
}

export async function createSale(params: CreateSaleParams): Promise<CreateSaleResult> {
  const { actor } = params;
  const settings = await getSettings();

  // `pdv.requireOpenCash`: sem caixa aberto, a venda nao teria para onde
  // registrar a entrada e o caixa nao fecharia. A regra e do dono, entao
  // vem da configuracao e nao de variavel de ambiente.
  if (settings.requireOpenCash) {
    const openSession = await prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    if (!openSession) {
      throw new AppError(
        'CONFLICT',
        'Nao ha caixa aberto. Abra o caixa no modulo Financeiro para registrar vendas.',
      );
    }
  }

  return prisma.$transaction(
    async (tx) => {
      const lines = await prepareSaleLines(tx, params.items, actor, settings);

      const { total, combinedDiscount: discountCents, grossSubtotal, itemsSubtotal } = resolveDiscounts(
        lines,
        params.globalDiscountCents,
        maxDiscountForRole(actor.role, settings),
      );

      const costTotal = lines.reduce((sum, l) => sum + l.costTotal, 0);

      // Numeracao sequencial legivel. Em SQLite o max()+1 e seguro porque a
      // transacao mantem a escrita serializada; ver nota de migracao no README.
      const last = await tx.sale.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;

      const sellerId = actor.sellerId ?? actor.id;

      const sale = await tx.sale.create({
        data: {
          number,
          sellerId,
          userId: actor.id,
          customerId: params.customerId ?? null,
          subtotal: itemsSubtotal,
          discountCents,
          total,
          costTotal,
          paymentMethod: params.paymentMethod,
          amountPaidCents: params.amountPaidCents,
          changeCents: Math.max(0, params.amountPaidCents - total),
          status: 'CONCLUIDA',
          notes: params.notes || null,
        },
        select: { id: true, number: true },
      });

      await tx.saleItem.createMany({
        data: lines.map((l) => ({
          saleId: sale.id,
          productId: l.productId,
          productName: l.productName,
          productUnit: l.productUnit,
          barcode: l.barcode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          costPrice: l.costPrice,
          discountPercent: l.discountPercent,
          discountCents: l.discountCents,
          subtotal: l.subtotal,
        })),
      });

      await tx.salePayment.create({
        data: { saleId: sale.id, method: params.paymentMethod, amountCents: total },
      });

      // Baixa de estoque: uma movimentacao por item, sempre registrada.
      // `VENDA` e um tipo proprio para que o relatorio de estoque distinga
      // a saida comercial de uma perda, de um ajuste ou de uma devolucao.
      const soldAt = new Date();
      for (const line of lines) {
        await applyStockMovement(tx, {
          type: 'VENDA',
          productId: line.productId,
          quantity: line.quantity,
          reason: `Venda #${number}`,
          documentNumber: String(number),
          userId: actor.id,
          saleId: sale.id,
          allowNegative: settings.allowNegativeStock,
        });
        // `lastSaleAt` desnormalizado alimenta a analise de produtos
        // parados sem exigir JOIN com sale_items.
        await tx.product.update({
          where: { id: line.productId },
          data: { lastSaleAt: soldAt },
        });
      }

      // Entrada no caixa: sempre que houver caixa aberto.
      const cashSession = await tx.cashSession.findFirst({
        where: { status: 'ABERTO' },
        orderBy: { openedAt: 'desc' },
        select: { id: true },
      });

      if (cashSession) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: cashSession.id,
            type: 'ENTRADA',
            kind: 'VENDA',
            amountCents: total,
            description: `Venda #${number}`,
            saleId: sale.id,
            userId: actor.id,
          },
        });
        await tx.sale.update({ where: { id: sale.id }, data: { cashSessionId: cashSession.id } });
      }

      return {
        saleId: sale.id,
        number: sale.number,
        total,
        changeCents: Math.max(0, params.amountPaidCents - total),
        cashSessionId: cashSession?.id ?? null,
        items: lines,
      };
    },
    { timeout: 15_000 },
  );
}

export const saleIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
