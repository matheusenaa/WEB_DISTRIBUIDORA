import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  productCreateSchema,
  productUpdateSchema,
  productQuerySchema,
  type ProductDTO,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { toProductDTO } from '../../lib/product-mapper.js';
import { applyStockMovement, describeMovement } from '../stock/service.js';
import { parseCsv, toCsv } from '../../lib/csv.js';
import { config } from '../../env.js';
import type { AuthUser } from '../../plugins/auth.js';

const productInclude = {
  category: { select: { name: true } },
  brand: { select: { name: true } },
  supplier: { select: { name: true } },
} as const;

/**
 * Cache curto para consulta por codigo de barras.
 *
 * O leitor dispara uma busca por tecla digitada; sem cache isso vira
 * dezenas de consultas por segundo no PDV. 60s de TTL e seguro: alteracao
 * de preco/estoque e invalidada explicitamente.
 */
const barcodeCache = new Map<string, { expires: number; product: ProductDTO | null }>();

function cacheGet(key: string): ProductDTO | null | undefined {
  const entry = barcodeCache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    barcodeCache.delete(key);
    return undefined;
  }
  return entry.product;
}

function cacheSet(key: string, product: ProductDTO | null): void {
  if (config.BARCODE_CACHE_TTL_SECONDS <= 0) return;
  if (barcodeCache.size > 500) barcodeCache.clear();
  barcodeCache.set(key, { expires: Date.now() + config.BARCODE_CACHE_TTL_SECONDS * 1000, product });
}

/**
 * Invalida apenas as entradas de cache do produto alterado.
 *
 * Uma versao anterior chamava `barcodeCache.clear()` aqui, o que zerava o
 * cache de todos os produtos a cada edicao: o operador corrigia o preco de
 * um item e o PDV passava a consultar o banco em todas as bipadas ate o
 * TTL expirar. A versao atual remove so as chaves conhecidas e varre o
 * mapa apenas para finding chaves `id:` (barcode pode ter mudado).
 */
function cacheInvalidateProduct(id: number, barcodes: (string | null | undefined)[]): void {
  for (const barcode of barcodes) {
    if (barcode) barcodeCache.delete(`barcode:${barcode}`);
  }
  // Varredura acotada: remove a entrada de id, cujo barcode pode ter mudado.
  for (const key of barcodeCache.keys()) {
    if (key === `id:${id}`) barcodeCache.delete(key);
  }
}

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/products - listagem com filtros                          */
  /* ---------------------------------------------------------------- */
  app.get('/', { preHandler: [app.requirePermission('products:read')] }, async (request) => {
    const query = productQuerySchema.parse(request.query ?? {});

    const where: Record<string, unknown> = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.brandId) where.brandId = query.brandId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;

    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { internalCode: { contains: query.search } },
        { barcode: { contains: query.search } },
        { description: { contains: query.search } },
      ];
    }

    switch (query.stock) {
      case 'ZERADO':
        where.stock = 0;
        break;
      case 'BAIXO':
        where.AND = [{ minStock: { gt: 0 } }, { stock: { gt: 0, lte: 5 } }];
        break;
      case 'CRITICO':
        where.AND = [{ minStock: { gt: 0 } }, { stock: { gt: 0 } }, { id: { in: await criticalStockIds() } }];
        break;
      case 'DISPONIVEL':
        where.stock = { gt: 0 };
        break;
      default:
        break;
    }

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: productInclude,
      }),
    ]);

    return {
      data: rows.map(toProductDTO),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/products/barcode/:code - busca pelo leitor               */
  /* ---------------------------------------------------------------- */
  app.get('/barcode/:code', { preHandler: [app.requirePermission('products:read')] }, async (request) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(64) }).parse(request.params);
    const normalized = code.trim();

    const cached = cacheGet(`barcode:${normalized}`);
    if (cached !== undefined) {
      return { found: cached !== null, product: cached, source: 'cache' };
    }

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { barcode: normalized },
          { internalCode: normalized },
          // Leitores internos tambem aceitam o codigo interno em maiusculas
          { internalCode: normalized.toUpperCase() },
        ],
      },
      include: productInclude,
    });

    if (!product) {
      cacheSet(`barcode:${normalized}`, null);
      return { found: false, product: null, source: 'db' };
    }

    const dto = toProductDTO(product);
    cacheSet(`barcode:${normalized}`, dto);
    return { found: true, product: dto, source: 'db' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/products/search - busca rapida (PDV)                     */
  /* ---------------------------------------------------------------- */
  app.get('/search', { preHandler: [app.requirePermission('products:read')] }, async (request) => {
    const query = z
      .object({
        q: z.string().trim().min(1, 'Informe o termo de busca').max(120),
        limit: z.coerce.number().int().min(1).max(50).default(15),
        onlyActive: z
          .union([z.boolean(), z.string()])
          .optional()
          .transform((v) => v === true || v === 'true' || v === '1'),
      })
      .parse(request.query ?? {});

    const rows = await prisma.product.findMany({
      where: {
        ...(query.onlyActive ? { status: 'ATIVO' } : {}),
        OR: [
          { name: { contains: query.q } },
          { internalCode: { contains: query.q } },
          { barcode: { contains: query.q } },
        ],
      },
      include: productInclude,
      orderBy: [{ name: 'asc' }],
      take: query.limit,
    });

    return { data: rows.map(toProductDTO) };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/products/:id                                           */
  /* ---------------------------------------------------------------- */
  app.get('/:id', { preHandler: [app.requirePermission('products:read')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const product = await prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');
    return toProductDTO(product);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/products - criar                                       */
  /* ---------------------------------------------------------------- */
  app.post('/', { preHandler: [app.requirePermission('products:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const input = productCreateSchema.parse(request.body);

    if (input.barcode) {
      const existing = await prisma.product.findUnique({
        where: { barcode: input.barcode },
        select: { id: true, name: true },
      });
      if (existing) {
        throw new AppError(
          'CONFLICT',
          `Codigo de barras ja cadastrado no produto "${existing.name}".`,
        );
      }
    }

    // Estoque inicial vem como movimentacao registrada, nao como numero solto,
    // para que o historico de estoque comece consistente desde o primeiro dia.
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          internalCode: input.internalCode || null,
          barcode: input.barcode || null,
          name: input.name,
          description: input.description || null,
          categoryId: input.categoryId ?? null,
          brandId: input.brandId ?? null,
          supplierId: input.supplierId ?? null,
          costPrice: input.costPrice,
          salePrice: input.salePrice,
          stock: 0,
          minStock: input.minStock,
          maxStock: input.maxStock ?? null,
          unit: input.unit,
          status: input.status,
          saleObservation: input.saleObservation || null,
          location: input.location || null,
        },
        include: productInclude,
      });

      if (input.stock > 0) {
        await applyStockMovement(tx, {
          type: 'ENTRADA',
          productId: created.id,
          quantity: input.stock,
          reason: 'Estoque inicial no cadastro do produto',
          documentNumber: 'CADASTRO',
          unitCost: input.costPrice,
          userId: actor.id,
          allowNegative: true,
        });
      }

      return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: productInclude });
    });

    const dto = toProductDTO(product);
    cacheInvalidateProduct(dto.id, [dto.barcode]);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      description: `${actor.name} cadastrou o produto "${product.name}"${
        input.stock > 0 ? ` com estoque inicial de ${input.stock}` : ''
      }`,
      after: dto,
      request,
    });

    return reply.status(201).send(dto);
  });

  /* ---------------------------------------------------------------- */
  /* PATCH /api/products/:id - alterar                                 */
  /* ---------------------------------------------------------------- */
  app.patch('/:id', { preHandler: [app.requirePermission('products:update')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = productUpdateSchema.parse(request.body);

    const before = await prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!before) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');

    if (input.barcode) {
      const clash = await prisma.product.findFirst({
        where: { barcode: input.barcode, NOT: { id } },
        select: { id: true, name: true },
      });
      if (clash) {
        throw new AppError('CONFLICT', `Codigo de barras ja cadastrado no produto "${clash.name}".`);
      }
    }

    const data: Record<string, unknown> = {};
    if (input.internalCode !== undefined) data.internalCode = input.internalCode || null;
    if (input.barcode !== undefined) data.barcode = input.barcode || null;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.brandId !== undefined) data.brandId = input.brandId;
    if (input.supplierId !== undefined) data.supplierId = input.supplierId;
    if (input.costPrice !== undefined) data.costPrice = input.costPrice;
    if (input.salePrice !== undefined) data.salePrice = input.salePrice;
    if (input.minStock !== undefined) data.minStock = input.minStock;
    if (input.maxStock !== undefined) data.maxStock = input.maxStock;
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.status !== undefined) data.status = input.status;
    if (input.saleObservation !== undefined) data.saleObservation = input.saleObservation || null;
    if (input.location !== undefined) data.location = input.location || null;

    const after = await prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });

    // Invalida o barcode antigo E o novo: renomear o codigo deixaria a
    // entrada antiga servindo um produto que ja nao existe mais.
    cacheInvalidateProduct(id, [after.barcode, before.barcode, input.barcode || null]);

    const changes: string[] = [];
    if (input.name !== undefined && input.name !== before.name) changes.push(`nome: "${before.name}" -> "${input.name}"`);
    if (input.salePrice !== undefined && input.salePrice !== before.salePrice)
      changes.push(`preco de venda: ${before.salePrice / 100} -> ${input.salePrice / 100}`);
    if (input.costPrice !== undefined && input.costPrice !== before.costPrice)
      changes.push(`custo: ${before.costPrice / 100} -> ${input.costPrice / 100}`);
    if (input.barcode !== undefined && input.barcode !== before.barcode) changes.push('codigo de barras');
    if (input.status !== undefined && input.status !== before.status)
      changes.push(`status: ${before.status} -> ${input.status}`);
    if (input.minStock !== undefined && input.minStock !== before.minStock)
      changes.push(`estoque minimo: ${before.minStock} -> ${input.minStock}`);
    if (input.categoryId !== undefined) changes.push('categoria');
    if (input.brandId !== undefined) changes.push('marca');
    if (input.supplierId !== undefined) changes.push('fornecedor');
    if (input.unit !== undefined && input.unit !== before.unit) changes.push(`unidade: ${before.unit} -> ${input.unit}`);

    if (changes.length > 0) {
      await recordAudit({
        userId: actor.id,
        userName: actor.username,
        action: 'UPDATE',
        entity: 'Product',
        entityId: id,
        description: `${actor.name} alterou o produto "${before.name}": ${changes.join('; ')}`,
        before: toProductDTO(before),
        after: toProductDTO(after),
        request,
      });
    }

    return toProductDTO(after);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/products/:id/status - ativar / desativar                 */
  /* ---------------------------------------------------------------- */
  app.post('/:id/status', { preHandler: [app.requirePermission('products:update')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['ATIVO', 'INATIVO']) }).parse(request.body);

    const before = await prisma.product.findUnique({ where: { id }, select: { name: true, status: true, barcode: true } });
    if (!before) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');

    const after = await prisma.product.update({
      where: { id },
      data: { status },
      include: productInclude,
    });
    cacheInvalidateProduct(id, [after.barcode, before.barcode]);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      description: `${actor.name} ${status === 'ATIVO' ? 'ativou' : 'desativou'} o produto "${before.name}"`,
      before,
      after: toProductDTO(after),
      request,
    });

    return toProductDTO(after);
  });

  /* ---------------------------------------------------------------- */
  /* DELETE /api/products/:id - desativar (nunca apaga com historico)  */
  /* ---------------------------------------------------------------- */
  app.delete('/:id', { preHandler: [app.requirePermission('products:delete')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, barcode: true, stock: true },
    });
    if (!product) throw new AppError('NOT_FOUND', 'Produto nao encontrado.');

    const saleItems = await prisma.saleItem.count({ where: { productId: id } });
    if (saleItems > 0) {
      // Produto com historico de vendas e desativado, nunca removido: caso
      // contrario o historico fiscal/contabil perderia a referencia.
        await prisma.product.update({ where: { id }, data: { status: 'INATIVO' } });
        cacheInvalidateProduct(id, [product.barcode]);
      await recordAudit({
        userId: actor.id,
        userName: actor.username,
        action: 'UPDATE',
        entity: 'Product',
        entityId: id,
        description: `${actor.name} tentou excluir "${product.name}", que possui historico. Produto foi desativado.`,
        request,
      });
      return reply.send({
        ok: true,
        deactivated: true,
        message: 'Produto possui historico de vendas e foi desativado em vez de excluido.',
      });
    }

    const movementCount = await prisma.stockMovement.count({ where: { productId: id } });
    if (movementCount > 0 && product.stock !== 0) {
      throw new AppError(
        'CONFLICT',
        'Produto possui movimentacoes de estoque com saldo. Zere o estoque antes de excluir.',
        { movementCount, stock: product.stock },
      );
    }

    await prisma.product.delete({ where: { id } });
    cacheInvalidateProduct(id, [product.barcode]);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'Product',
      entityId: id,
      description: `${actor.name} excluiu o produto "${product.name}"`,
      before: product,
      request,
    });

    return reply.send({ ok: true, deactivated: false, message: 'Produto excluido.' });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/products/export/csv                                     */
  /* ---------------------------------------------------------------- */
  app.get('/export/csv', { preHandler: [app.requirePermission('products:read')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const query = productQuerySchema
      .pick({ categoryId: true, status: true, search: true })
      .parse(request.query ?? {});

    const products = await prisma.product.findMany({
      where: {
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: productInclude,
      orderBy: { name: 'asc' },
    });

    const rows = products.map((p) => ({
      codigo_interno: p.internalCode ?? '',
      codigo_barras: p.barcode ?? '',
      nome: p.name,
      descricao: p.description ?? '',
      categoria: p.category?.name ?? '',
      marca: p.brand?.name ?? '',
      fornecedor: p.supplier?.name ?? '',
      custo: (p.costPrice / 100).toFixed(2).replace('.', ','),
      preco_venda: (p.salePrice / 100).toFixed(2).replace('.', ','),
      margem_percent: (
        p.salePrice > 0 ? (((p.salePrice - p.costPrice) / p.salePrice) * 100).toFixed(2) : '0.00'
      ).replace('.', ','),
      estoque: p.stock,
      estoque_minimo: p.minStock,
      unidade: p.unit,
      status: p.status,
    }));

    const csv = toCsv(Object.keys(rows[0] ?? { nome: '' }), rows);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'EXPORT',
      entity: 'Product',
      description: `${actor.name} exportou a lista de produtos (${rows.length} registros)`,
      request,
    });

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="produtos-${Date.now()}.csv"`)
      .send(`\uFEFF${csv}`);
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/products/import/csv                                    */
  /* ---------------------------------------------------------------- */
  app.post('/import/csv', { preHandler: [app.requirePermission('products:create')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = z
      .object({
        csv: z.string().min(10, 'Envie o conteudo do CSV'),
        dryRun: z.boolean().default(false),
      })
      .parse(request.body);

    const table = parseCsv(body.csv);
    const headers = table.headers.map((h) => normalizeHeader(h));
    const idx = (name: string) => headers.indexOf(name);

    const required = ['nome'];
    for (const name of required) {
      if (idx(name) === -1) {
        throw new AppError('VALIDATION_ERROR', `Coluna obrigatoria ausente no CSV: "${name}".`);
      }
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: { linha: number; motivo: string }[] = [];

    for (let i = 0; i < table.rows.length; i += 1) {
      const row = table.rows[i]!;
      const lineNumber = i + 2;
      const get = (name: string) => {
        const index = idx(name);
        return index === -1 ? '' : (row[index] ?? '').trim();
      };

      const name = get('nome');
      if (!name) {
        errors.push({ linha: lineNumber, motivo: 'nome vazio' });
        continue;
      }

      const barcode = get('codigo_barras') || null;
      const internalCode = get('codigo_interno') || null;
      const parseMoney = (v: string) => {
        const n = Number(v.replace(',', '.'));
        return Number.isFinite(n) ? Math.round(n * 100) : 0;
      };

      const data = {
        name,
        barcode,
        internalCode,
        description: get('descricao') || null,
        costPrice: parseMoney(get('custo')),
        salePrice: parseMoney(get('preco_venda')),
        stock: Number.parseInt(get('estoque') || '0', 10) || 0,
        minStock: Number.parseInt(get('estoque_minimo') || '0', 10) || 0,
        maxStock: get('estoque_maximo') ? Number.parseInt(get('estoque_maximo'), 10) : null,
        unit: get('unidade') || 'UN',
        status: (get('status') as 'ATIVO' | 'INATIVO') || 'ATIVO',
        saleObservation: get('observacao') || null,
      };

      try {
        if (body.dryRun) {
          const clash = barcode
            ? await prisma.product.findUnique({ where: { barcode }, select: { name: true } })
            : null;
          if (clash) updated.push(clash.name);
          else created.push(name);
          continue;
        }

        const existing = barcode ? await prisma.product.findUnique({ where: { barcode } }) : null;

        if (existing) {
          await prisma.product.update({ where: { id: existing.id }, data });
          updated.push(name);
        } else {
          const product = await prisma.product.create({
            data: { ...data, stock: 0, salePrice: data.salePrice || data.costPrice },
            select: { id: true },
          });
          if (data.stock > 0) {
            await prisma.$transaction((tx) =>
              applyStockMovement(tx, {
                type: 'ENTRADA',
                productId: product.id,
                quantity: data.stock,
                reason: 'Importacao de planilha',
                documentNumber: 'IMPORTACAO',
                unitCost: data.costPrice,
                userId: actor.id,
                allowNegative: true,
              }),
            );
          }
          created.push(name);
        }
      } catch (err) {
        errors.push({ linha: lineNumber, motivo: err instanceof Error ? err.message : 'erro desconhecido' });
      }
    }

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: body.dryRun ? 'EXPORT' : 'CREATE',
      entity: 'Product',
      description: `${actor.name} ${body.dryRun ? 'simulou' : 'executou'} importacao de produtos: ${created.length} criados, ${updated.length} atualizados, ${errors.length} com erro`,
      request,
    });

    return reply.send({
      ok: errors.length === 0,
      dryRun: body.dryRun,
      created: created.length,
      updated: updated.length,
      errors,
      message: body.dryRun
        ? `Simulacao: ${created.length} novos, ${updated.length} atualizados, ${errors.length} com erro.`
        : `Importacao concluida: ${created.length} criados, ${updated.length} atualizados, ${errors.length} com erro.`,
    });
  });
}

/**
 * Ids de produtos em estoque critico (stock <= minStock, ainda com saldo).
 *
 * Prisma nao compara uma coluna com outra, entao usamos SQL parametrizado.
 * A clausula e ANSI e funciona tanto em SQLite quanto em PostgreSQL.
 */
async function criticalStockIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number | bigint }[]>`
    SELECT id FROM products WHERE minStock > 0 AND stock > 0 AND stock <= minStock
  `;
  return rows.map((r) => Number(r.id));
}

function normalizeHeader(header: string): string {  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
