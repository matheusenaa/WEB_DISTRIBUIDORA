import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StockMovementDTO } from '@webdist/shared';
import { stockMovementSchema, stockQuerySchema } from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { applyStockMovement, describeMovement } from './service.js';
import { buildStockAlerts } from './alerts.js';
import type { AuthUser } from '../../plugins/auth.js';

export async function registerStockRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/stock/movements - registrar movimentacao                */
  /* ---------------------------------------------------------------- */
  app.post('/movements', { preHandler: [app.requirePermission('stock:adjust')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = stockMovementSchema.parse(request.body);

    // Saida/Perda sao operacoes de baixa deliberada; entrada exige permissao de recebimento.
    if (input.type === 'ENTRADA' || input.type === 'DEVOLUCAO') {
      await app.requirePermission('stock:receive')(request, reply);
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const before = await tx.product.findUnique({
          where: { id: input.productId },
          select: { name: true },
        });
        if (!before) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');

        return applyStockMovement(tx, {
          type: input.type,
          productId: input.productId,
          quantity: input.quantity,
          reason: input.reason,
          documentNumber: input.documentNumber || null,
          unitCost: input.unitCost ?? null,
          userId: actor.id,
          allowNegative: false,
        });
      },
      { timeout: 10_000 },
    );

    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { name: true },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'STOCK_ADJUST',
      entity: 'Product',
      entityId: input.productId,
      description: describeMovement(
        input.type,
        product?.name ?? `produto #${input.productId}`,
        input.quantity,
        result.previousStock,
        result.resultingStock,
      ) + ` - motivo: ${input.reason}`,
      after: { stock: result.resultingStock, type: input.type, reason: input.reason },
      request,
    });

    return reply.status(201).send({
      ok: true,
      movementId: result.movementId,
      previousStock: result.previousStock,
      resultingStock: result.resultingStock,
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/stock/adjust - ajuste para estoque alvo                */
  /* ---------------------------------------------------------------- */
  app.post('/adjust', { preHandler: [app.requirePermission('stock:adjust')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = z
      .object({
        productId: z.coerce.number().int().positive(),
        targetStock: z.coerce.number().int().min(0, 'Estoque final invalido'),
        reason: z.string().trim().min(3, 'Informe o motivo').max(300),
      })
      .parse(request.body);

    const result = await prisma.$transaction(
      (tx) =>
        applyStockMovement(tx, {
          type: 'AJUSTE',
          productId: input.productId,
          quantity: Math.abs(input.targetStock),
          targetStock: input.targetStock,
          reason: input.reason,
          userId: actor.id,
          allowNegative: false,
        }),
      { timeout: 10_000 },
    );

    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { name: true },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'STOCK_ADJUST',
      entity: 'Product',
      entityId: input.productId,
      description: `Ajuste manual de estoque em "${product?.name ?? input.productId}" de ${
        result.previousStock
      } para ${result.resultingStock} - motivo: ${input.reason}`,
      after: { previous: result.previousStock, target: input.targetStock, reason: input.reason },
      request,
    });

    return reply.send({
      ok: true,
      movementId: result.movementId,
      previousStock: result.previousStock,
      resultingStock: result.resultingStock,
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/stock/movements - historico                             */
  /* ---------------------------------------------------------------- */
  app.get('/movements', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = stockQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: {
          product: { select: { name: true, unit: true } },
          user: { select: { name: true } },
        },
      }),
    ]);

    const data: StockMovementDTO[] = rows.map((row) => ({
      id: row.id,
      type: row.type as StockMovementDTO['type'],
      productId: row.productId,
      productName: row.product?.name ?? 'Produto removido',
      productUnit: row.product?.unit ?? 'UN',
      quantity: row.quantity,
      previousStock: row.previousStock,
      resultingStock: row.resultingStock,
      reason: row.reason,
      documentNumber: row.documentNumber,
      unitCost: row.unitCost,
      userId: row.userId,
      userName: row.user?.name ?? 'Usuario removido',
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      data,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/stock/alerts - alertas de estoque                       */
  /* ---------------------------------------------------------------- */
  app.get('/alerts', { preHandler: [app.requirePermission('stock:read')] }, async (request) => {
    const query = z
      .object({
        level: z.enum(['TODOS', 'ZERADO', 'CRITICO', 'BAIXO']).default('TODOS'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(request.query ?? {});

    // `noLimit` mantem o resumo e o agrupamento completos mesmo quando a
    // lista exibida esta truncada: os numeros do cabecalho precisam
    // refletir a situacao inteira, nao a pagina visivel.
    return buildStockAlerts({ level: query.level, limit: query.limit, noLimit: true });
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/stock/restock-order - pedido de compra a partir de      */
  /* alertas. Agrupa por fornecedor, porque e assim que a compra e     */
  /* feita de verdade: um pedido por fornecedor, nao um pedido giant.  */
  /* ---------------------------------------------------------------- */
  app.post('/restock-order', { preHandler: [app.requirePermission('purchases:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = z
      .object({
        supplierId: z.coerce.number().int().positive(),
        /** Quando ausente, usa a quantidade sugerida de cada alerta. */
        items: z
          .array(
            z.object({
              productId: z.coerce.number().int().positive(),
              quantity: z.coerce.number().int().positive('Quantidade deve ser maior que zero'),
              unitCost: z.coerce.number().int().min(0, 'Custo invalido').optional(),
            }),
          )
          .min(1, 'Selecione ao menos um produto')
          .max(500),
        notes: z.string().trim().max(600).optional(),
      })
      .parse(request.body ?? {});

    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, name: true, active: true, lastPurchasePrice: true },
    });
    if (!supplier) throw new AppError('NOT_FOUND', 'Fornecedor nao encontrado.');
    if (!supplier.active) {
      throw new AppError('CONFLICT', `O fornecedor "${supplier.name}" esta inativo.`);
    }

    const products = await prisma.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) } },
      select: { id: true, name: true, unit: true, costPrice: true, supplierId: true, status: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = input.items.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
    if (missing.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Um ou mais produtos do pedido nao existem.', { missing });
    }

    // Produto de outro fornecedor no pedido e um erro de operacao: o
    // preco viria do fornecedor errado e o recebimento atualizaria o
    // "ultimo preco pago" de forma enganosa.
    const wrongSupplier = input.items
      .map((i) => byId.get(i.productId)!)
      .filter((p) => p.supplierId !== null && p.supplierId !== supplier.id)
      .map((p) => ({ productId: p.id, name: p.name }));
    if (wrongSupplier.length > 0) {
      throw new AppError(
        'CONFLICT',
        'Produtos vinculados a outro fornecedor nao podem entrar neste pedido.',
        { products: wrongSupplier },
      );
    }

    // Sem custo informado: usa o custo medio do produto. Sem os dois,
    // o pedido e criado com custo zero e o operador preenche depois -
    // bloquear aqui deixaria o operador sem caminho para comprar.
    const items = input.items.map((item) => {
      const product = byId.get(item.productId)!;
      const unitCost = item.unitCost ?? product.costPrice;
      return {
        productId: product.id,
        quantity: item.quantity,
        unitCost,
      };
    });

    const order = await prisma.$transaction(
      async (tx) => {
        const last = await tx.purchaseOrder.findFirst({
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const created = await tx.purchaseOrder.create({
          data: {
            number: (last?.number ?? 0) + 1,
            supplierId: supplier.id,
            userId: actor.id,
            status: 'ABERTO',
            notes: input.notes?.trim() || 'Gerado a partir dos alertas de estoque',
            items: {
              create: items.map((item) => {
                const product = byId.get(item.productId)!;
                return {
                  productId: product.id,
                  productName: product.name,
                  unit: product.unit,
                  quantity: item.quantity,
                  unitCost: item.unitCost,
                };
              }),
            },
          },
          select: { id: true, number: true },
        });
        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            supplier: { select: { name: true } },
            user: { select: { name: true, username: true } },
            items: { include: { product: { select: { barcode: true, unit: true } } } },
          },
        });
      },
      { timeout: 20_000 },
    );

    const totalCents = items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'PurchaseOrder',
      entityId: order.id,
      description: `${actor.name} gerou o pedido de compra #${order.number} para "${supplier.name}" a partir dos alertas de estoque (${items.length} itens, ${(totalCents / 100).toFixed(2)})`,
      after: { id: order.id, number: order.number, items },
      request,
    });

    return reply.status(201).send({
      ok: true,
      order: {
        id: order.id,
        number: order.number,
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        status: order.status,
        itemsCount: order.items.length,
        totalQuantity: order.items.reduce((sum, i) => sum + i.quantity, 0),
        totalCents,
      },
      message: `Pedido #${order.number} criado para ${supplier.name}.`,
    });
  });
}
