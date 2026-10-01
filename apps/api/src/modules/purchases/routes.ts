import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  purchaseCreateSchema,
  purchaseQuerySchema,
  purchaseReceiveSchema,
  type PurchaseOrderDTO,
  type PurchaseItemDTO,
  type PurchaseStatus,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { applyStockMovement, describeMovement } from '../stock/service.js';
import type { AuthUser } from '../../plugins/auth.js';
import type { Prisma } from '@prisma/client';

/**
 * MODULO DE COMPRAS
 *
 * Um pedido de compra responde a duas perguntas que o sistema nao conseguia
 * responder antes:
 *  1. "Qual foi o ultimo preco que paguei nesse fornecedor?"  -> `Supplier.lastPurchase*`
 *  2. "Quanto de cada produto vou consumir ate o fornecedor entregar?" -> analise de recompra
 *
 * O recebimento e a unica ponte entre compras e estoque: ele grava
 * movimentacoes ENTRADA vinculadas ao pedido, e o custo medio ponderado
 * do produto e recalculado a partir do preco real pago.
 */

const orderInclude = {
  supplier: { select: { name: true } },
  user: { select: { name: true, username: true } },
  items: {
    include: { product: { select: { barcode: true, unit: true } } },
  },
} as const;

type OrderWithItems = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

function toOrderDTO(order: OrderWithItems): PurchaseOrderDTO {
  const items: PurchaseItemDTO[] = order.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    productUnit: item.unit,
    barcode: item.product.barcode,
    quantity: item.quantity,
    unitCost: item.unitCost,
    receivedQuantity: item.receivedQuantity,
    subtotal: item.unitCost * item.quantity,
  }));

  return {
    id: order.id,
    number: order.number,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    userId: order.userId,
    userName: order.user.name,
    status: order.status as PurchaseStatus,
    documentNumber: order.documentNumber,
    orderedAt: order.orderedAt.toISOString(),
    receivedAt: order.receivedAt?.toISOString() ?? null,
    notes: order.notes,
    itemsCount: items.length,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    totalCents: items.reduce((sum, i) => sum + i.subtotal, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items,
  };
}

export async function registerPurchaseRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/purchases                                                */
  /* ---------------------------------------------------------------- */
  app.get('/', { preHandler: [app.requirePermission('purchases:read')] }, async (request) => {
    const query = purchaseQuerySchema.parse(request.query ?? {});

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.orderedAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search } },
        { supplier: { name: { contains: query.search } } },
        { notes: { contains: query.search } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: orderInclude,
        orderBy: { orderedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    return {
      data: rows.map(toOrderDTO),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/purchases/:id                                           */
  /* ---------------------------------------------------------------- */
  app.get('/:id', { preHandler: [app.requirePermission('purchases:read')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new AppError('NOT_FOUND', 'Pedido de compra nao encontrado.');
    return toOrderDTO(order);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/purchases - criar (opcionalmente ja recebendo)          */
  /* ---------------------------------------------------------------- */
  app.post('/', { preHandler: [app.requirePermission('purchases:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = purchaseCreateSchema.parse(request.body);

    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, name: true, active: true },
    });
    if (!supplier) throw new AppError('NOT_FOUND', 'Fornecedor nao encontrado.');
    if (!supplier.active) {
      throw new AppError('CONFLICT', `O fornecedor "${supplier.name}" esta inativo.`);
    }

    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Um ou mais produtos do pedido nao existem.', { missing });
    }

    const order = await prisma.$transaction(
      async (tx) => {
        const last = await tx.purchaseOrder.findFirst({
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const number = (last?.number ?? 0) + 1;

        const created = await tx.purchaseOrder.create({
          data: {
            number,
            supplierId: supplier.id,
            userId: actor.id,
            status: input.receiveNow ? 'RECEBIDO' : 'ABERTO',
            documentNumber: input.documentNumber || null,
            notes: input.notes || null,
            receivedAt: input.receiveNow ? new Date() : null,
            items: {
              create: input.items.map((item) => ({
                productId: item.productId,
                productName: byId.get(item.productId)!.name,
                unit: byId.get(item.productId)!.unit,
                quantity: item.quantity,
                unitCost: item.unitCost,
                receivedQuantity: input.receiveNow ? item.quantity : null,
              })),
            },
          },
          select: { id: true, number: true },
        });

        if (input.receiveNow) {
          await receiveItems(tx, {
            orderId: created.id,
            items: input.items.map((i) => ({ productId: i.productId, receivedQuantity: i.quantity })),
            userId: actor.id,
            actorName: actor.name,
            reason: `Recebimento do pedido #${created.number}`,
          });
        }

        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: created.id },
          include: orderInclude,
        });
      },
      { timeout: 20_000 },
    );

    const dto = toOrderDTO(order);
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'PurchaseOrder',
      entityId: order.id,
      description: `${actor.name} criou o pedido de compra #${order.number} para "${supplier.name}" (${dto.itemsCount} itens, ${input.receiveNow ? 'recebido' : 'em aberto'})`,
      after: dto,
      request,
    });

    return reply.status(201).send(dto);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/purchases/:id/receive - dar entrada no estoque           */
  /* ---------------------------------------------------------------- */
  app.post('/:id/receive', { preHandler: [app.requirePermission('purchases:receive')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = purchaseReceiveSchema.parse(request.body ?? {});

    const order = await prisma.$transaction(
      async (tx) => {
        const current = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { items: true, supplier: { select: { name: true } } },
        });
        if (!current) throw new AppError('NOT_FOUND', 'Pedido de compra nao encontrado.');
        if (current.status === 'RECEBIDO') {
          throw new AppError('CONFLICT', `O pedido #${current.number} ja foi recebido.`);
        }
        if (current.status === 'CANCELADO') {
          throw new AppError('CONFLICT', `O pedido #${current.number} esta cancelado.`);
        }

        // Sem lista explicita, recebe tudo que foi pedido.
        const received = input.items?.length
          ? input.items
          : current.items.map((i) => ({ productId: i.productId, receivedQuantity: i.quantity }));

        const lines = await receiveItems(tx, {
          orderId: id,
          items: received,
          userId: actor.id,
          actorName: actor.name,
          reason: `Recebimento do pedido #${current.number}`,
        });

        for (const item of received) {
          await tx.purchaseItem.updateMany({
            where: { purchaseOrderId: id, productId: item.productId },
            data: { receivedQuantity: item.receivedQuantity },
          });
        }

        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: 'RECEBIDO',
            receivedAt: new Date(),
            documentNumber: input.documentNumber || current.documentNumber,
            notes: input.notes || current.notes,
          },
        });

        return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
      },
      { timeout: 20_000 },
    );

    const dto = toOrderDTO(order);
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'STOCK_RECEIVE',
      entity: 'PurchaseOrder',
      entityId: order.id,
      description: `${actor.name} recebeu o pedido #${order.number} de "${order.supplier.name}"`,
      after: dto,
      request,
    });

    return dto;
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/purchases/:id/cancel                                   */
  /* ---------------------------------------------------------------- */
  app.post('/:id/cancel', { preHandler: [app.requirePermission('purchases:update' as never)] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(300) }).parse(request.body);

    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, number: true, status: true } });
      if (!current) throw new AppError('NOT_FOUND', 'Pedido de compra nao encontrado.');
      if (current.status === 'RECEBIDO') {
        throw new AppError('CONFLICT', 'Pedido ja recebido nao pode ser cancelado. Faca um ajuste de estoque.');
      }
      if (current.status === 'CANCELADO') {
        throw new AppError('CONFLICT', 'Pedido ja esta cancelado.');
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELADO', notes: reason },
        include: orderInclude,
      });
    });

    const dto = toOrderDTO(order);
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'PurchaseOrder',
      entityId: id,
      description: `${actor.name} cancelou o pedido de compra #${order.number}: ${reason}`,
      after: dto,
      request,
    });

    return dto;
  });

  /* ---------------------------------------------------------------- */
  /* DELETE /api/purchases/:id - apenas pedidos em aberto             */
  /* ---------------------------------------------------------------- */
  app.delete('/:id', { preHandler: [app.requirePermission('purchases:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const current = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, number: true, status: true },
    });
    if (!current) throw new AppError('NOT_FOUND', 'Pedido de compra nao encontrado.');
    if (current.status !== 'ABERTO') {
      throw new AppError('CONFLICT', 'Somente pedidos em aberto podem ser excluidos.');
    }

    await prisma.purchaseOrder.delete({ where: { id } });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'PurchaseOrder',
      entityId: id,
      description: `${actor.name} excluiu o pedido de compra #${current.number}`,
      before: current,
      request,
    });

    return reply.send({ ok: true, message: `Pedido #${current.number} excluido.` });
  });
}

/**
 * Da entrada no estoque dos itens recebidos e atualiza o "ultimo preco pago"
 * do fornecedor. Executa dentro da transacao do chamador.
 */
async function receiveItems(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: {
    orderId: number;
    items: { productId: number; receivedQuantity: number }[];
    userId: number;
    actorName: string;
    reason: string;
  },
): Promise<{ productId: number; quantity: number; previous: number; resulting: number }[]> {
  const items = await tx.purchaseItem.findMany({
    where: { purchaseOrderId: params.orderId },
    select: { id: true, productId: true, quantity: true, unitCost: true },
  });
  const byId = new Map(items.map((i) => [i.productId, i]));

  const touchedProducts = new Set<number>();
  const results: { productId: number; quantity: number; previous: number; resulting: number }[] = [];

  for (const entry of params.items) {
    const item = byId.get(entry.productId);
    if (!item) continue; // item nao pertence a este pedido
    if (entry.receivedQuantity <= 0) continue;

    const movement = await applyStockMovement(tx, {
      type: 'ENTRADA',
      productId: entry.productId,
      quantity: entry.receivedQuantity,
      reason: params.reason,
      documentNumber: `PC-${params.orderId}`,
      unitCost: item.unitCost,
      userId: params.userId,
      purchaseOrderId: params.orderId,
      // Recebimento nunca bloqueia: o fornecedor ja entregou.
      allowNegative: true,
    });

    results.push({
      productId: entry.productId,
      quantity: entry.receivedQuantity,
      previous: movement.previousStock,
      resulting: movement.resultingStock,
    });
    touchedProducts.add(entry.productId);
  }

  // Atualiza o ultimo preco pago e a data do fornecedor com o item mais
  // recente efetivamente recebido.
  const order = await tx.purchaseOrder.findUnique({
    where: { id: params.orderId },
    select: { supplierId: true },
  });
  if (order && touchedProducts.size > 0) {
    const lastPaid = await tx.stockMovement.findFirst({
      where: { purchaseOrderId: params.orderId, unitCost: { not: null } },
      orderBy: { id: 'desc' },
      select: { unitCost: true },
    });
    if (lastPaid?.unitCost != null) {
      await tx.supplier.updateMany({
        where: { id: order.supplierId },
        data: { lastPurchasePrice: lastPaid.unitCost, lastPurchaseAt: new Date() },
      });
    }
  }

  return results;
}

export { describeMovement };
