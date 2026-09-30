import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PRODUCT_UNITS,
  SALE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  STOCK_MOVEMENT_LABELS,
  ROLE_LABELS,
  ROLES,
  type Permission,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { connectDatabase } from '../../lib/prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { config } from '../../env.js';
import type { AuthUser } from '../../plugins/auth.js';

/**
 * Definicoes de regras de negocio gravadas no banco.
 * A API le do banco; o frontend recebe os valores prontos.
 * Isso evita "informacao hardcoded" e permite ajuste sem novo deploy.
 */
const SETTING_DEFINITIONS = [
  { key: 'company.name', label: 'Nome da empresa', type: 'text', defaultValue: 'WEB DISTRIBUIDORA' },
  { key: 'company.document', label: 'CNPJ / CPF', type: 'text', defaultValue: '' },
  { key: 'company.phone', label: 'Telefone', type: 'text', defaultValue: '' },
  { key: 'company.address', label: 'Endereco', type: 'text', defaultValue: '' },
  { key: 'sale.allowNegativeStock', label: 'Permitir venda com estoque negativo', type: 'boolean', defaultValue: 'false' },
  { key: 'sale.sellerMaxDiscount', label: 'Desconto maximo do vendedor (%)', type: 'number', defaultValue: '0' },
  { key: 'sale.adminMaxDiscount', label: 'Desconto maximo do administrador (%)', type: 'number', defaultValue: '40' },
  { key: 'stock.defaultMinAlert', label: 'Estoque minimo padrao de alerta', type: 'number', defaultValue: '5' },
  { key: 'cash.tolerance', label: 'Tolerancia de divergencia de caixa (R$)', type: 'number', defaultValue: '0.01' },
  { key: 'print.autoPrintReceipt', label: 'Imprimir cupom automaticamente', type: 'boolean', defaultValue: 'false' },
  { key: 'print.receiptWidth', label: 'Largura do cupom (58mm/80mm)', type: 'text', defaultValue: '80mm' },
  { key: 'pdv.requireOpenCash', label: 'Exigir caixa aberto para vender', type: 'boolean', defaultValue: 'true' },
] as const;

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/health - nao exige autenticacao                         */
  /* ---------------------------------------------------------------- */
  app.get('/health', async (_request, reply) => {
    const startedAt = Date.now();
    let database = 'up';
    let databaseError: string | undefined;

    try {
      await connectDatabase();
    } catch (err) {
      database = 'down';
      databaseError = err instanceof Error ? err.message : 'erro desconhecido';
    }

    const healthy = database === 'up';

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      version: '1.0.0',
      environment: config.NODE_ENV,
      database: { status: database, error: databaseError },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/meta - dados de apoio para o frontend                   */
  /* ---------------------------------------------------------------- */
  app.get('/meta', async () => {
    const [products, categories, brands, suppliers, customers, users] = await Promise.all([
      prisma.product.count(),
      prisma.category.count(),
      prisma.brand.count(),
      prisma.supplier.count(),
      prisma.customer.count(),
      prisma.user.count(),
    ]);

    const settings = await prisma.systemSetting.findMany();
    const settingMap = new Map(settings.map((s) => [s.key, s.value]));

    return {
      app: { name: 'WEB DISTRIBUIDORA', version: '1.0.0' },
      counts: { products, categories, brands, suppliers, customers, users },
      company: {
        name: settingMap.get('company.name') ?? 'WEB DISTRIBUIDORA',
        document: settingMap.get('company.document') ?? '',
        phone: settingMap.get('company.phone') ?? '',
        address: settingMap.get('company.address') ?? '',
      },
      settings: {
        allowNegativeStock: settingMap.get('sale.allowNegativeStock') === 'true',
        requireOpenCash: (settingMap.get('pdv.requireOpenCash') ?? 'true') === 'true',
        receiptWidth: settingMap.get('print.receiptWidth') ?? '80mm',
        autoPrintReceipt: settingMap.get('print.autoPrintReceipt') === 'true',
        sellerMaxDiscount: Number(settingMap.get('sale.sellerMaxDiscount') ?? '0'),
        adminMaxDiscount: Number(settingMap.get('sale.adminMaxDiscount') ?? '40'),
      },
      enums: {
        units: PRODUCT_UNITS,
        paymentMethods: SALE_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
        movementTypes: Object.entries(STOCK_MOVEMENT_LABELS).map(([value, label]) => ({ value, label })),
        roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
      },
    };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/settings                                                 */
  /* ---------------------------------------------------------------- */
  app.get('/settings', { preHandler: [app.requirePermission('settings:read')] }, async () => {
    const rows = await prisma.systemSetting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      data: SETTING_DEFINITIONS.map((def) => ({
        key: def.key,
        label: def.label,
        type: def.type,
        value: map.get(def.key) ?? def.defaultValue,
        defaultValue: def.defaultValue,
      })),
    };
  });

  /* ---------------------------------------------------------------- */
  /* PUT /api/settings                                                 */
  /* ---------------------------------------------------------------- */
  app.put('/settings', { preHandler: [app.requirePermission('settings:manage')] }, async (request) => {
    const actor = request.currentUser as AuthUser;
    const body = z
      .object({ settings: z.record(z.string(), z.string().max(500)) })
      .parse(request.body);

    const allowed = new Set<string>(SETTING_DEFINITIONS.map((d) => d.key));
    const entries = Object.entries(body.settings).filter(([key]) => allowed.has(key));

    if (entries.length === 0) {
      return { ok: true, updated: 0, message: 'Nenhuma configuracao valida informada.' };
    }

    const before = await prisma.systemSetting.findMany({
      where: { key: { in: entries.map(([k]) => k) } },
    });

    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.systemSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );

    const changed = entries
      .map(([key, value]) => {
        const old = before.find((b) => b.key === key)?.value;
        return old !== value ? `"${key}" de "${old ?? '(padrao)'}" para "${value}"` : null;
      })
      .filter((c): c is string => c !== null);

    if (changed.length > 0) {
      await recordAudit({
        userId: actor.id,
        userName: actor.username,
        action: 'UPDATE',
        entity: 'SystemSetting',
        description: `${actor.name} alterou configuracoes: ${changed.join('; ')}`,
        before: Object.fromEntries(before.map((b) => [b.key, b.value])),
        after: Object.fromEntries(entries),
        request,
      });
    }

    return { ok: true, updated: entries.length, message: 'Configuracoes salvas.' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/permissions - matriz usada pelo frontend                 */
  /* ---------------------------------------------------------------- */
  app.get('/permissions', { preHandler: [app.requirePermission('settings:read')] }, async () => {
    const { ROLE_PERMISSIONS } = await import('@webdist/shared');
    return {
      data: ROLES.map((role) => ({
        role,
        label: ROLE_LABELS[role],
        permissions: ROLE_PERMISSIONS[role] as readonly Permission[],
      })),
    };
  });
}
