import type { Prisma } from '@prisma/client';
import type { StockMovementType } from '@webdist/shared';
import {
  ADJUSTMENT_MOVEMENT_TYPES,
  DOCUMENTAL_MOVEMENT_TYPES,
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  STOCK_MOVEMENT_LABELS,
} from '@webdist/shared';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { config } from '../../env.js';

/**
 * O sinal de cada tipo e definido AQUI, e nao espalhado pelas rotas.
 * `VENDA` e `CANCELAMENTO` sao types proprios justamente para que o
 * relatorio de movimentacoes distinga uma saida comercial de uma perda
 * ou de um ajuste manual, sem precisar correlacionar com a tabela de
 * vendas.
 *
 * Todo tipo precisa estar em exatamente um destes conjuntos. Um tipo
 * fora dos quatro nao teria sinal definido e passaria a-treated
 * silenciosamente; a verificacao abaixo existe para fazer esse erro
 * aparecer no log, e nao em um saldo de estoque errado.
 */
const INBOUND: ReadonlySet<StockMovementType> = new Set<StockMovementType>(INBOUND_MOVEMENT_TYPES);
const OUTBOUND: ReadonlySet<StockMovementType> = new Set<StockMovementType>(OUTBOUND_MOVEMENT_TYPES);
const ADJUSTMENT: ReadonlySet<StockMovementType> = new Set<StockMovementType>(ADJUSTMENT_MOVEMENT_TYPES);
const DOCUMENTAL: ReadonlySet<StockMovementType> = new Set<StockMovementType>(DOCUMENTAL_MOVEMENT_TYPES);

export function isInbound(type: StockMovementType): boolean {
  return INBOUND.has(type);
}

export function isOutbound(type: StockMovementType): boolean {
  return OUTBOUND.has(type);
}

export function isAdjustment(type: StockMovementType): boolean {
  return ADJUSTMENT.has(type);
}

/** True quando o tipo e apenas um registro no historico, sem efeito no saldo. */
export function isDocumental(type: StockMovementType): boolean {
  return DOCUMENTAL.has(type);
}

/** Confere que todo tipo de movimentacao tem um sinal definido. */
export function assertMovementTypesComplete(
  all: readonly StockMovementType[],
  onMissing: (type: StockMovementType) => void = (type) => {
    throw new AppError(
      'VALIDATION_ERROR',
      `Tipo de movimentacao "${type}" nao tem sinal definido. Adicione-o a uma das listas em shared/enums.ts.`,
    );
  },
): void {
  for (const type of all) {
    const count =
      (isInbound(type) ? 1 : 0) +
      (isOutbound(type) ? 1 : 0) +
      (isAdjustment(type) ? 1 : 0) +
      (isDocumental(type) ? 1 : 0);
    if (count !== 1) onMissing(type);
  }
}

export interface ApplyMovementInput {
  type: StockMovementType;
  productId: number;
  /** Quantidade sempre positiva. Para AJUSTE, use `targetStock`. */
  quantity: number;
  /** Usado apenas por AJUSTE: estoque final desejado. */
  targetStock?: number;
  reason: string;
  documentNumber?: string | null;
  unitCost?: number | null;
  userId: number;
  userName?: string;
  saleId?: number | null;
  /** Vincula a movimentacao a um pedido de compra (recebimento). */
  purchaseOrderId?: number | null;
  /** Permite estoque negativo mesmo com ALLOW_NEGATIVE_STOCK=false. */
  allowNegative?: boolean;
}

export interface MovementResult {
  movementId: number;
  previousStock: number;
  resultingStock: number;
  unitCostApplied: number;
}

/**
 * Aplica uma movimentacao de estoque de forma atomica e registra o historico.
 *
 * A atualizacao do saldo usa um `UPDATE ... WHERE stock >= qty` condicional.
 * Isso e obrigatorio: duas vendas simultaneas do mesmo ultimo item nao podem
 * ambas ler "estoque = 1" e concluir com estoque negativo. Com o filtro
 * condicional no proprio UPDATE, apenas uma transacao afeta a linha.
 */
export async function applyStockMovement(
  tx: Tx,
  input: ApplyMovementInput,
): Promise<MovementResult> {
  const allowNegative = input.allowNegative ?? config.ALLOW_NEGATIVE_STOCK;

  const current = await tx.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true, stock: true, costPrice: true, status: true },
  });
  if (!current) {
    throw new AppError('NOT_FOUND', 'Produto nao encontrado.', { productId: input.productId });
  }

  let delta: number;
  let previousStock: number;
  let resultingStock: number;
  let quantity: number;

  if (isAdjustment(input.type)) {
    if (input.targetStock === undefined) {
      throw new AppError('VALIDATION_ERROR', 'Informe o estoque final desejado para o ajuste.');
    }
    if (input.targetStock < 0 && !allowNegative) {
      throw new AppError(
        'STOCK_NEGATIVE_BLOCKED',
        'O ajuste resultado em estoque negativo, o que nao e permitido pela configuracao.',
      );
    }
    previousStock = current.stock;
    resultingStock = input.targetStock;
    delta = resultingStock - previousStock;
    quantity = Math.abs(delta);
  } else if (isDocumental(input.type)) {
    // Cancelamento sem devolucao: a mercadoria nao volta ao estoque, mas
    // tambem nao consome nada agora - a saida ja ocorreu na venda. O
    // registro existe para deixar o cancelamento visivel no historico,
    // com estoque anterior e posterior iguais.
    previousStock = current.stock;
    resultingStock = current.stock;
    delta = 0;
    quantity = input.quantity;
  } else {
    previousStock = current.stock;
    delta = isInbound(input.type) ? input.quantity : -input.quantity;
    resultingStock = previousStock + delta;
    quantity = input.quantity;
  }

  if (quantity <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Quantidade deve ser maior que zero.');
  }

  if (isOutbound(input.type) || isAdjustment(input.type)) {
    if (resultingStock < 0 && !allowNegative) {
      throw new AppError(
        'STOCK_INSUFFICIENT',
        `Estoque insuficiente para "${current.name}". Disponivel: ${previousStock}.`,
        { productId: current.id, productName: current.name, available: previousStock, requested: quantity },
      );
    }
  }

  // Atualizacao condicional: garante serializacao contra vendas concorrentes.
  // Movimentacao documental nao escreve no saldo (delta 0), entao nao ha o
  // que serializar e nao vale a pena tocar a linha do produto.
  if (isDocumental(input.type)) {
    const movement = await tx.stockMovement.create({
      data: {
        type: input.type,
        productId: current.id,
        quantity,
        previousStock,
        resultingStock,
        reason: input.reason,
        documentNumber: input.documentNumber ?? null,
        unitCost: current.costPrice,
        userId: input.userId,
        saleId: input.saleId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
      },
      select: { id: true },
    });

    return {
      movementId: movement.id,
      previousStock,
      resultingStock,
      unitCostApplied: current.costPrice,
    };
  }

  const updated = await tx.product.updateMany({
    where: isOutbound(input.type) || isAdjustment(input.type)
      ? allowNegative
        ? { id: current.id }
        : { id: current.id, stock: { gte: quantity } }
      : { id: current.id },
    data: { stock: { increment: delta } },
  });

  if (updated.count === 0) {
    // Outro processo consumiu o estoque entre a leitura e a escrita.
    const fresh = await tx.product.findUnique({
      where: { id: current.id },
      select: { stock: true, name: true },
    });
    throw new AppError(
      'STOCK_INSUFFICIENT',
      `Estoque insuficiente para "${current?.name ?? 'produto'}". Disponivel: ${fresh?.stock ?? 0}.`,
      { productId: current.id, available: fresh?.stock ?? 0, requested: quantity },
    );
  }

  // Em movimentacoes de entrada, o custo medioponderado pode ser atualizado.
  let unitCostApplied: number | null = input.unitCost ?? null;
  if (isInbound(input.type) && input.unitCost !== undefined && input.unitCost !== null) {
    await tx.product.update({
      where: { id: current.id },
      data: {
        costPrice: await computeWeightedAverageCost(tx, current.id, current.costPrice, quantity, input.unitCost),
      },
    });
    unitCostApplied = input.unitCost;
  } else if (isInbound(input.type)) {
    unitCostApplied = current.costPrice;
  }

  const movement = await tx.stockMovement.create({
    data: {
      type: input.type,
      productId: current.id,
      quantity,
      previousStock,
      resultingStock,
      reason: input.reason,
      documentNumber: input.documentNumber ?? null,
      unitCost: unitCostApplied,
      userId: input.userId,
      saleId: input.saleId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
    },
    select: { id: true },
  });

  return {
    movementId: movement.id,
    previousStock,
    resultingStock: previousStock + delta,
    unitCostApplied: unitCostApplied ?? current.costPrice,
  };
}

/**
 * Custo medio ponderado: (valor_atual + valor_entrada) / (qtd_atual + qtd_entrada).
 * Evita que uma unica compra barata distorca o lucro de todas as vendas.
 */
async function computeWeightedAverageCost(
  tx: Tx,
  productId: number,
  currentCost: number,
  quantityIn: number,
  incomingUnitCost: number,
): Promise<number> {
  const stock = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
  const stockAfter = Math.max(0, (stock?.stock ?? 0) - quantityIn);
  const totalQty = stockAfter + quantityIn;
  if (totalQty <= 0) return incomingUnitCost;
  const totalValue = stockAfter * currentCost + quantityIn * incomingUnitCost;
  return Math.round(totalValue / totalQty);
}

/** Gera descricao legivel de uma movimentacao para auditoria. */
export function describeMovement(
  type: StockMovementType,
  productName: string,
  quantity: number,
  previousStock: number,
  resultingStock: number,
): string {
  const label = STOCK_MOVEMENT_LABELS[type] ?? type;
  const arrow = resultingStock >= previousStock ? '+' : '-';
  return `${label} de ${quantity} un. em "${productName}": ${previousStock} ${arrow} ${Math.abs(
    resultingStock - previousStock,
  )} -> ${resultingStock}`;
}

/**
 * Estorna as movimentacoes de estoque de uma venda cancelada.
 * Mantem o historico: cria DEVOLUCAO em vez de apagar o registro original.
 */
export async function restockSale(
  tx: Tx,
  saleId: number,
  userId: number,
  reason: string,
): Promise<number> {
  const items = await tx.saleItem.findMany({
    where: { saleId },
    select: { productId: true, productName: true, quantity: true, unitPrice: true, costPrice: true },
  });

  for (const item of items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { id: true, stock: true, name: true },
    });
    if (!product) continue;

    await applyStockMovement(tx, {
      type: 'DEVOLUCAO',
      productId: item.productId,
      quantity: item.quantity,
      reason,
      userId,
      allowNegative: true,
    });
  }

  return items.length;
}
