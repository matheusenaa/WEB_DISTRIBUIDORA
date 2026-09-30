import type { FastifyInstance } from 'fastify';
import {
  saleCreateSchema,
  saleCancelSchema,
  saleQuerySchema,
  saleItemSchema,
  type SaleDTO,
  type SaleItemDTO,
} from '@webdist/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { createSale, maxDiscountForRole, saleIdParamSchema } from './service.js';
import { restockSale } from '../stock/service.js';
import type { AuthUser } from '../../plugins/auth.js';

const SALE_INCLUDE = {
  seller: { select: { name: true } },
  user: { select: { name: true } },
  customer: { select: { name: true } },
  items: { orderBy: { id: 'asc' as const } },
} as const;

type SaleRow = Awaited<ReturnType<typeof loadSale>>;

async function loadSale(id: number) {
  return prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
}

function toSaleDTO(row: NonNullable<SaleRow>): SaleDTO {
  const items: SaleItemDTO[] = row.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    productUnit: item.productUnit,
    barcode: item.barcode,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountPercent: item.discountPercent,
    subtotal: item.subtotal,
    costPrice: item.costPrice,
    profitCents: item.subtotal - item.costPrice * item.quantity,
  }));

  return {
    id: row.id,
    number: row.number,
    sellerId: row.sellerId,
    sellerName: row.seller?.name ?? 'Removido',
    userId: row.userId,
    userName: row.user?.name ?? 'Removido',
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    subtotal: row.subtotal,
    discountCents: row.discountCents,
    total: row.total,
    costTotal: row.costTotal,
    profitCents: row.total - row.costTotal,
    paymentMethod: row.paymentMethod as SaleDTO['paymentMethod'],
    amountPaidCents: row.amountPaidCents,
    changeCents: row.changeCents,
    status: row.status as SaleDTO['status'],
    itemsCount: items.length,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    items,
  };
}

export async function registerSaleRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/sales/quote - simula total sem gravar nada             */
  /* ---------------------------------------------------------------- */
  app.post('/quote', { preHandler: [app.requirePermission('sales:create')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const body = saleCreateSchema.parse(request.body);
    const items = body.items.map((i) => saleItemSchema.parse(i));

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, salePrice: true, stock: true, status: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new AppError('VALIDATION_ERROR', 'Produto nao encontrado na venda.');

    const limit = maxDiscountForRole(actor.role);
    const lines = items.map((item) => {
      const product = byId.get(item.productId)!;
      const unitPrice = item.unitPrice ?? product.salePrice;
      const gross = unitPrice * item.quantity;
      const discountCents =
        item.discountPercent > limit
          ? Math.round((gross * limit) / 100)
          : Math.round((gross * item.discountPercent) / 100);
      return {
        productId: item.productId,
        name: product.name,
        quantity: item.quantity,
        unitPrice,
        discountCents,
        subtotal: gross - discountCents,
        available: product.stock,
        active: product.status === 'ATIVO',
      };
    });

    const itemsSubtotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
    const maxGlobal = Math.round((itemsSubtotal * limit) / 100);
    const globalDiscount = Math.min(body.globalDiscountCents ?? 0, maxGlobal);
    const total = itemsSubtotal - globalDiscount;

    return {
      lines,
      subtotal: itemsSubtotal,
      maxGlobalDiscountCents: maxGlobal,
      discountLimitPercent: limit,
      discountCents: itemsSubtotal - total,
      total,
      changeCents: Math.max(0, (body.amountPaidCents ?? 0) - total),
    };
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/sales - registrar venda                                 */
  /* ---------------------------------------------------------------- */
  app.post('/', { preHandler: [app.requirePermission('sales:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = saleCreateSchema.parse(request.body);
    const items = body.items.map((i) => saleItemSchema.parse(i));

    const result = await createSale({
      items,
      paymentMethod: body.paymentMethod,
      customerId: body.customerId,
      discountPercent: body.discountPercent ?? 0,
      globalDiscountCents: body.globalDiscountCents ?? 0,
      amountPaidCents: body.amountPaidCents ?? 0,
      notes: body.notes ?? null,
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    const sale = await loadSale(result.saleId);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'SALE_CREATE',
      entity: 'Sale',
      entityId: result.saleId,
      description: `${actor.name} realizou a venda #${result.number} - total ${(result.total / 100).toFixed(2)} em ${body.paymentMethod} (${result.items.length} item(ns))`,
      after: sale ? toSaleDTO(sale) : null,
      request,
    });

    return reply.status(201).send({
      ok: true,
      sale: sale ? toSaleDTO(sale) : null,
      number: result.number,
      total: result.total,
      changeCents: result.changeCents,
      cashSessionId: result.cashSessionId,
      message: `Venda #${result.number} registrada com sucesso.`,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/sales - listagem                                         */
  /* ---------------------------------------------------------------- */
  app.get('/', { preHandler: [app.requirePermission('sales:read')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const query = saleQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};

    if (actor.role !== 'ADMIN' && !actor.permissions.includes('sales:read-all')) {
      // Vendedor so enxerga as proprias vendas.
      where.sellerId = actor.id;
    } else if (query.sellerId) {
      where.sellerId = query.sellerId;
    }

    if (query.status) where.status = query.status;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.customerId) where.customerId = query.customerId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [{ number: Number.isNaN(Number(query.search)) ? -1 : Number(query.search) }, { notes: { contains: query.search } }];
    }
    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
      where.total = {
        ...(query.minTotal !== undefined ? { gte: query.minTotal } : {}),
        ...(query.maxTotal !== undefined ? { lte: query.maxTotal } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: SALE_INCLUDE,
      }),
    ]);

    return {
      data: rows.map(toSaleDTO),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/sales/:id                                                */
  /* ---------------------------------------------------------------- */
  app.get('/:id', { preHandler: [app.requirePermission('sales:read')] }, async (request) => {
    const { id } = saleIdParamSchema.parse(request.params);
    const actor = request.currentUser as AuthUser;

    const sale = await loadSale(id);
    if (!sale) throw new AppError('NOT_FOUND', 'Venda nao encontrada.');

    if (actor.role !== 'ADMIN' && sale.sellerId !== actor.id) {
      throw new AppError('FORBIDDEN', 'Voce nao tem acesso a esta venda.');
    }

    return toSaleDTO(sale);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/sales/:id/cancel                                        */
  /* ---------------------------------------------------------------- */
  app.post('/:id/cancel', { preHandler: [app.requirePermission('sales:cancel')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = saleIdParamSchema.parse(request.params);
    const { reason, restock } = saleCancelSchema.parse(request.body);

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { items: { select: { productId: true, productName: true, quantity: true } } },
      });
      if (!sale) throw new AppError('NOT_FOUND', 'Venda nao encontrada.');
      if (sale.status === 'CANCELADA') {
        throw new AppError('SALE_ALREADY_CANCELED', 'Esta venda ja esta cancelada.');
      }

      if (restock) {
        await restockSale(tx, id, actor.id, `Cancelamento da venda #${sale.number}: ${reason}`);
      } else {
        for (const item of sale.items) {
          await prisma.stockMovement.create({
            data: {
              type: 'SAIDA',
              productId: item.productId,
              quantity: item.quantity,
              previousStock: 0,
              resultingStock: 0,
              reason: `Cancelamento sem devolucao - venda #${sale.number}: ${reason}`,
              documentNumber: String(sale.number),
              userId: actor.id,
              saleId: id,
            },
          });
        }
      }

      await tx.sale.update({
        where: { id },
        data: { status: 'CANCELADA', canceledAt: new Date(), cancelReason: reason },
      });

      // Estorno no caixa: cria uma SAIDA compensatoria e PRESERVA a
      // movimentacao de entrada original. Alterar o registro original
      // destruiria a rastreabilidade da venda no caixa.
      const cashEntry = await tx.cashMovement.findFirst({
        where: { saleId: id, type: 'ENTRADA' },
        select: { id: true, cashSessionId: true, amountCents: true },
      });
      if (cashEntry) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: cashEntry.cashSessionId,
            type: 'SAIDA',
            kind: 'ESTORNO',
            amountCents: cashEntry.amountCents,
            description: `Estorno da venda #${sale.number}: ${reason}`,
            saleId: id,
            userId: actor.id,
          },
        });
      }

      return { number: sale.number, total: sale.total, restocked: restock, items: sale.items.length };
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'SALE_CANCEL',
      entity: 'Sale',
      entityId: id,
      description: `${actor.name} cancelou a venda #${result.number} (${(result.total / 100).toFixed(2)}) - motivo: ${reason}${
        restock ? ' - estoque devolvido' : ' - estoque NAO devolvido'
      }`,
      request,
    });

    return {
      ok: true,
      message: `Venda #${result.number} cancelada.`,
      restocked: result.restocked,
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/sales/meta/next-number - pre-visualizacao do numero     */
  /* ---------------------------------------------------------------- */
  app.get('/meta/next-number', { preHandler: [app.requirePermission('sales:read')] }, async () => {
    const last = await prisma.sale.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
    return { nextNumber: (last?.number ?? 0) + 1 };
  });
}
