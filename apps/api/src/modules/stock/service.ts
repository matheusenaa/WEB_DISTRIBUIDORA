import type { Prisma } from '@prisma/client';
import type { StockMovementType } from '@webdist/shared';
import { STOCK_MOVEMENT_LABELS } from '@webdist/shared';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { config } from '../../env.js';

/** Tipos que aumentam o estoque. */
const INBOUND: ReadonlySet<StockMovementType> = new Set<StockMovementType>([
  'ENTRADA',
  'DEVOLUCAO',
  'TRANSFERENCIA_ENTRADA',
]);

/** Tipos que reduzem o estoque. */
const OUTBOUND: ReadonlySet<StockMovementType> = new Set<StockMovementType>([
  'SAIDA',
  'PERDA',
  'TRANSFERENCIA_SAIDA',
]);

/** Tipos de ajuste: sinal definido pelo valor alvo. */
const ADJUSTMENT: ReadonlySet<StockMovementType> = new Set<StockMovementType>(['AJUSTE']);

export function isInbound(type: StockMovementType): boolean {
  return INBOUND.has(type);
}

export function isOutbound(type: StockMovementType): boolean {
  return OUTBOUND.has(type);
}

export function isAdjustment(type: StockMovementType): boolean {
  return ADJUSTMENT.has(type);
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
