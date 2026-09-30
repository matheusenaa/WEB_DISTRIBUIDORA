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
import { mkdir, readdir, rm, stat, readFile, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

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

  /* ---------------------------------------------------------------- */
  /* BACKUP / RESTORE                                                 */
  /* ---------------------------------------------------------------- */

  function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Resolve o caminho do .sqlite a partir de DATABASE_URL no .env. */
  async function resolveDatabaseFile(): Promise<string> {
    // Em desenvolvimento (tsx), import.meta.url aponta para o arquivo .ts fonte.
    // Em producao (build), aponta para o arquivo .js em dist/.
    // Precisamos encontrar a raiz do repositorio de forma robusta.
    const currentFile = fileURLToPath(import.meta.url);
    let root = resolve(dirname(currentFile), '../../../..');
    
    // Verifica se achou o .env na raiz calculada; se nao, tenta subir mais um nivel
    // (caso esteja rodando de dist/ em producao)
    try {
      await readFile(join(root, '.env'), 'utf8');
    } catch {
      root = resolve(root, '..');
    }
    
    let url = 'file:./dev.db';
    try {
      const content = await readFile(join(root, '.env'), 'utf8');
      const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
      if (match?.[1]) url = match[1].trim();
    } catch {
      // .env ausente: usa o padrao do .env.example.
    }

    if (!url.startsWith('file:')) {
      throw new Error('DATABASE_URL nao aponta para SQLite. Use o backup nativo do PostgreSQL (pg_dump).');
    }

    // O Prisma resolve caminhos relativos a pasta prisma/.
    const resolvedPath = resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
    console.log('[resolveDatabaseFile] root:', root);
    console.log('[resolveDatabaseFile] url:', url);
    console.log('[resolveDatabaseFile] resolved:', resolvedPath);
    return resolvedPath;
  }

  function timestamp(date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* POST /api/backup - criar backup manual                           */
  /* ---------------------------------------------------------------- */
  app.post('/backup', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;

    const dbFile = await resolveDatabaseFile();
    const backupDir = join(resolve(dirname(dbFile), '../../..'), 'backups');
    await mkdir(backupDir, { recursive: true });

    const rawFile = join(backupDir, `webdist-${timestamp()}.db`);
    const gzFile = `${rawFile}.gz`;

    const database = new DatabaseSync(dbFile, { readOnly: true });
    try {
      database.exec(`VACUUM INTO '${rawFile.replace(/'/g, "''")}'`);
    } finally {
      database.close();
    }

    await pipeline(createReadStream(rawFile), createGzip(), createWriteStream(gzFile));
    await rm(rawFile, { force: true });

    const { size } = await stat(gzFile);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'BACKUP_CREATE',
      entity: 'Backup',
      entityId: gzFile.split(/[\\/]/).pop()!,
      description: `${actor.name} criou backup manual`,
      request,
    });

    return reply.send({
      ok: true,
      file: gzFile.split(/[\\/]/).pop(),
      size: humanSize(size),
      message: 'Backup criado com sucesso.',
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /api/backup - listar backups                                 */
  /* ---------------------------------------------------------------- */
  app.get('/backup', { preHandler: [app.requirePermission('settings:read')] }, async () => {
    const backupDir = join(resolve(dirname(await resolveDatabaseFile()), '../../..'), 'backups');
    try {
      const existing = (await readdir(backupDir))
        .filter((name) => /^webdist-\d{8}-\d{6}\.db\.gz$/.test(name))
        .sort()
        .reverse();

      const files = await Promise.all(
        existing.map(async (name) => {
          const filePath = join(backupDir, name);
          const { size, mtime } = await stat(filePath);
          return { name, size: humanSize(size), sizeBytes: size, date: mtime.toISOString() };
        }),
      );

      return { data: files };
    } catch {
      return { data: [] };
    }
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/restore - restaurar backup                             */
  /* ---------------------------------------------------------------- */
  app.post('/restore', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = z.object({ fileName: z.string().min(1) }).parse(request.body);

    if (!/^webdist-\d{8}-\d{6}\.db\.gz$/.test(body.fileName)) {
      return reply.status(400).send({ ok: false, message: 'Nome de arquivo invalido.' });
    }

    const dbFile = await resolveDatabaseFile();
    const backupDir = join(resolve(dirname(dbFile), '../../..'), 'backups');
    const gzFile = join(backupDir, body.fileName);

    try {
      await stat(gzFile);
    } catch {
      return reply.status(404).send({ ok: false, message: 'Arquivo de backup nao encontrado.' });
    }

    // 1. Cria backup de seguranca do banco atual antes de restaurar
    const safetyFile = join(backupDir, `webdist-pre-restore-${timestamp()}.db.gz`);
    const database = new DatabaseSync(dbFile, { readOnly: true });
    try {
      database.exec(`VACUUM INTO '${safetyFile.replace(/.gz$/, '').replace(/'/g, "''")}'`);
    } finally {
      database.close();
    }
    await pipeline(createReadStream(safetyFile.replace(/.gz$/, '')), createGzip(), createWriteStream(safetyFile));
    await rm(safetyFile.replace(/.gz$/, ''), { force: true });

    // 2. Descompacta e prepara o restore
    const tempDb = join(backupDir, `restore-${timestamp()}.db`);
    await pipeline(createReadStream(gzFile), createGunzip(), createWriteStream(tempDb));

    // Valida se o banco restaurado e consistente
    const testDb = new DatabaseSync(tempDb, { readOnly: true });
    try {
      testDb.exec('PRAGMA integrity_check');
    } finally {
      testDb.close();
    }

    // Prepara o restore: move o arquivo restaurado para a pasta de backups como "pending restore"
    const pendingRestoreFile = join(backupDir, `webdist-pending-restore-${timestamp()}.db`);
    await rm(pendingRestoreFile, { force: true });
    await rename(tempDb, pendingRestoreFile);

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'BACKUP_RESTORE_PREPARED',
      entity: 'Backup',
      entityId: body.fileName,
      description: `${actor.name} preparou restore do backup: ${body.fileName}. Reinicie a aplicacao para concluir.`,
      request,
    });

    return reply.send({
      ok: true,
      message: 'Restore preparado com sucesso. Reinicie a aplicacao (feche e abra novamente) para concluir a restauracao.',
      pendingFile: pendingRestoreFile.split(/[\\/]/).pop(),
    });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'BACKUP_RESTORE',
      entity: 'Backup',
      entityId: body.fileName,
      description: `${actor.name} restaurou backup: ${body.fileName}`,
      request,
    });

    return reply.send({
      ok: true,
      message: 'Backup restaurado com sucesso. Reinicie a aplicacao para recarregar os dados.',
    });
  });

  /* ---------------------------------------------------------------- */
  /* DELETE /api/backup/:fileName - excluir backup                    */
  /* ---------------------------------------------------------------- */
  app.delete('/backup/:fileName', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);

    if (!/^webdist-\d{8}-\d{6}\.db\.gz$/.test(fileName)) {
      return reply.status(400).send({ ok: false, message: 'Nome de arquivo invalido.' });
    }

    const backupDir = join(resolve(dirname(await resolveDatabaseFile()), '../../..'), 'backups');
    const gzFile = join(backupDir, fileName);

    try {
      await stat(gzFile);
    } catch {
      return reply.status(404).send({ ok: false, message: 'Arquivo nao encontrado.' });
    }

    await rm(gzFile, { force: true });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'BACKUP_DELETE',
      entity: 'Backup',
      entityId: fileName,
      description: `${actor.name} excluiu backup: ${fileName}`,
      request,
    });

    return { ok: true, message: 'Backup excluido.' };
  });
}
