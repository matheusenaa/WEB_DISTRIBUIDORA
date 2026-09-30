import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  categorySchema,
  brandSchema,
  supplierSchema,
  customerSchema,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import type { AuthUser } from '../../plugins/auth.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

/* ------------------------------------------------------------------ */
/* Categorias                                                          */
/* ------------------------------------------------------------------ */
export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('categories:read')] }, async (request) => {
    const query = z
      .object({ includeInactive: z.coerce.boolean().optional() })
      .parse(request.query ?? {});

    const rows = await prisma.category.findMany({
      where: query.includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        active: c.active,
        productCount: c._count.products,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  });

  app.post('/', { preHandler: [app.requirePermission('categories:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = categorySchema.parse(request.body);

    const category = await prisma.category.create({
      data: { name: input.name, description: input.description || null, active: input.active },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'Category',
      entityId: category.id,
      description: `${actor.name} criou a categoria "${category.name}"`,
      after: category,
      request,
    });

    return reply.status(201).send(category);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('categories:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const input = categorySchema.partial().parse(request.body);

    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Categoria nao encontrada.');

    const after = await prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'Category',
      entityId: id,
      description: `${actor.name} alterou a categoria "${before.name}"`,
      before,
      after,
      request,
    });

    return after;
  });

  app.delete('/:id', { preHandler: [app.requirePermission('categories:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);

    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Categoria nao encontrada.');

    const count = await prisma.product.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new AppError(
        'CONFLICT',
        `A categoria possui ${count} produto(s) vinculado(s). Mova os produtos ou desative a categoria.`,
        { productCount: count },
      );
    }

    await prisma.category.delete({ where: { id } });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'Category',
      entityId: id,
      description: `${actor.name} excluiu a categoria "${before.name}"`,
      before,
      request,
    });

    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Marcas                                                              */
/* ------------------------------------------------------------------ */
export async function registerBrandRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('brands:read')] }, async (request) => {
    const query = z
      .object({ includeInactive: z.coerce.boolean().optional() })
      .parse(request.query ?? {});

    const rows = await prisma.brand.findMany({
      where: query.includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return {
      data: rows.map((b) => ({
        id: b.id,
        name: b.name,
        active: b.active,
        productCount: b._count.products,
      })),
    };
  });

  app.post('/', { preHandler: [app.requirePermission('brands:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = brandSchema.parse(request.body);
    const brand = await prisma.brand.create({
      data: { name: input.name, active: input.active },
    });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'Brand',
      entityId: brand.id,
      description: `${actor.name} criou a marca "${brand.name}"`,
      request,
    });
    return reply.status(201).send(brand);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('brands:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const input = brandSchema.partial().parse(request.body);
    const before = await prisma.brand.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Marca nao encontrada.');
    const after = await prisma.brand.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'Brand',
      entityId: id,
      description: `${actor.name} alterou a marca "${before.name}"`,
      before,
      after,
      request,
    });
    return after;
  });

  app.delete('/:id', { preHandler: [app.requirePermission('brands:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const before = await prisma.brand.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Marca nao encontrada.');
    const count = await prisma.product.count({ where: { brandId: id } });
    if (count > 0) {
      throw new AppError('CONFLICT', `A marca possui ${count} produto(s) vinculado(s).`, { productCount: count });
    }
    await prisma.brand.delete({ where: { id } });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'Brand',
      entityId: id,
      description: `${actor.name} excluiu a marca "${before.name}"`,
      request,
    });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Fornecedores                                                        */
/* ------------------------------------------------------------------ */
export async function registerSupplierRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('suppliers:read')] }, async (request) => {
    const query = z
      .object({
        includeInactive: z.coerce.boolean().optional(),
        search: z.string().trim().max(120).optional(),
      })
      .parse(request.query ?? {});

    const rows = await prisma.supplier.findMany({
      where: {
        ...(query.includeInactive ? {} : { active: true }),
        ...(query.search ? { OR: [{ name: { contains: query.search } }, { document: { contains: query.search } }] } : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return {
      data: rows.map((s) => ({
        id: s.id,
        name: s.name,
        document: s.document,
        email: s.email,
        phone: s.phone,
        address: s.address,
        active: s.active,
        productCount: s._count.products,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  app.post('/', { preHandler: [app.requirePermission('suppliers:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = supplierSchema.parse(request.body);
    const supplier = await prisma.supplier.create({
      data: {
        name: input.name,
        document: input.document ?? null,
        email: input.email || null,
        phone: input.phone ?? null,
        address: input.address || null,
        active: input.active,
      },
    });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
      description: `${actor.name} cadastrou o fornecedor "${supplier.name}"`,
      after: supplier,
      request,
    });
    return reply.status(201).send(supplier);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('suppliers:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const input = supplierSchema.partial().parse(request.body);
    const before = await prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Fornecedor nao encontrado.');

    const after = await prisma.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.document !== undefined ? { document: input.document || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'Supplier',
      entityId: id,
      description: `${actor.name} alterou o fornecedor "${before.name}"`,
      before,
      after,
      request,
    });
    return after;
  });

  app.delete('/:id', { preHandler: [app.requirePermission('suppliers:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const before = await prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Fornecedor nao encontrado.');
    const count = await prisma.product.count({ where: { supplierId: id } });
    if (count > 0) {
      throw new AppError('CONFLICT', `O fornecedor possui ${count} produto(s) vinculado(s).`, { productCount: count });
    }
    await prisma.supplier.delete({ where: { id } });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'Supplier',
      entityId: id,
      description: `${actor.name} excluiu o fornecedor "${before.name}"`,
      request,
    });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Clientes                                                            */
/* ------------------------------------------------------------------ */
export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.requirePermission('customers:read')] }, async (request) => {
    const query = z
      .object({
        includeInactive: z.coerce.boolean().optional(),
        search: z.string().trim().max(120).optional(),
      })
      .parse(request.query ?? {});

    const rows = await prisma.customer.findMany({
      where: {
        ...(query.includeInactive ? {} : { active: true }),
        ...(query.search ? { OR: [{ name: { contains: query.search } }, { document: { contains: query.search } }] } : {}),
      },
      orderBy: { name: 'asc' },
    });

    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        document: c.document,
        email: c.email,
        phone: c.phone,
        address: c.address,
        active: c.active,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  });

  app.post('/', { preHandler: [app.requirePermission('customers:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = customerSchema.parse(request.body);
    const customer = await prisma.customer.create({
      data: {
        name: input.name,
        document: input.document ?? null,
        email: input.email || null,
        phone: input.phone ?? null,
        address: input.address || null,
        active: input.active,
      },
    });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      description: `${actor.name} cadastrou o cliente "${customer.name}"`,
      after: customer,
      request,
    });
    return reply.status(201).send(customer);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('customers:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const input = customerSchema.partial().parse(request.body);
    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Cliente nao encontrado.');

    const after = await prisma.customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.document !== undefined ? { document: input.document || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: id,
      description: `${actor.name} alterou o cliente "${before.name}"`,
      before,
      after,
      request,
    });
    return after;
  });

  app.delete('/:id', { preHandler: [app.requirePermission('customers:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = idParam.parse(request.params);
    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Cliente nao encontrado.');
    const count = await prisma.sale.count({ where: { customerId: id } });
    if (count > 0) {
      throw new AppError('CONFLICT', 'Este cliente possui vendas registradas e nao pode ser excluido.', { saleCount: count });
    }
    await prisma.customer.delete({ where: { id } });
    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'Customer',
      entityId: id,
      description: `${actor.name} excluiu o cliente "${before.name}"`,
      request,
    });
    return { ok: true };
  });
}
