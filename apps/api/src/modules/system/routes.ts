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
import { getSettings, invalidateSettingsCache, normalizeSettingValue, SETTING_DEFINITIONS as SETTING_LIST } from '../../lib/settings.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { config } from '../../env.js';
import type { AuthUser } from '../../plugins/auth.js';
import { mkdir, readdir, rm, stat, readFile, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ARCHIVED_BACKUP_PATTERN,
  BACKUP_FILE_PATTERN,
  backupsDirFor,
  randomSuffix,
  timestamp,
} from '../../lib/backup-files.js';

/**
 * Definicoes de regras de negocio gravadas no banco.
 * A API le do banco; o frontend recebe os valores prontos.
 * Isso evita "informacao hardcoded" e permite ajuste sem novo deploy.
 *
 * A lista vive em `lib/settings.ts`, junto com o validador e com o leitor
 * que as regras de negocio consomem. Aqui so aparece na tela.
 */
const SETTING_DEFINITIONS = SETTING_LIST;

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

    const settings = await getSettings();

    return {
      app: { name: 'WEB DISTRIBUIDORA', version: '1.0.0' },
      counts: { products, categories, brands, suppliers, customers, users },
      company: settings.company,
      settings: {
        allowNegativeStock: settings.allowNegativeStock,
        requireOpenCash: settings.requireOpenCash,
        receiptWidth: settings.receiptWidth,
        autoPrintReceipt: settings.autoPrintReceipt,
        sellerMaxDiscount: settings.sellerMaxDiscountPercent,
        adminMaxDiscount: settings.adminMaxDiscountPercent,
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
        group: def.group,
        type: def.type,
        help: def.help ?? null,
        options: def.options ?? null,
        value: map.get(def.key) ?? def.defaultValue,
        defaultValue: def.defaultValue,
        saved: map.has(def.key),
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

    // Validado pela definicao antes de gravar. Sem isso, "abc" em um campo
    // numerico era aceito e quebrava a regra na leitura seguinte
    // (`Number('abc')` e NaN), e um desconto de 999% era aceito sem
    // complaint.
    const accepted = new Map<string, string>();
    const rejected: Array<{ key: string; reason: string }> = [];

    for (const [key, rawValue] of Object.entries(body.settings)) {
      const definition = SETTING_DEFINITIONS.find((d) => d.key === key);
      if (!definition) {
        rejected.push({ key, reason: 'Configuracao inexistente.' });
        continue;
      }
      const normalized = normalizeSettingValue(definition, rawValue);
      if (normalized === null) {
        rejected.push({
          key,
          reason:
            definition.type === 'number'
              ? `Valor invalido. Informe um numero${
                  definition.min !== undefined ? ` entre ${definition.min} e ${definition.max}` : ''
                }.`
              : definition.type === 'boolean'
                ? 'Valor invalido. Use verdadeiro ou falso.'
                : `Valor invalido. Aceitos: ${(definition.options ?? []).join(', ')}.`,
        });
        continue;
      }
      accepted.set(key, normalized);
    }

    const entries = [...accepted.entries()];

    if (entries.length === 0) {
      if (rejected.length === 0) {
        return { ok: true, updated: 0, rejected: [], message: 'Nenhuma configuracao valida informada.' };
      }
      throw new AppError(
        'VALIDATION_ERROR',
        rejected.map((r) => `"${r.key}": ${r.reason}`).join(' '),
        { rejected },
      );
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

    // O cache de regras tem 5s de vida; sem invalidar, quem acabou de
    // salvar a tela continuaria vendo (e aplicando) o valor antigo.
    invalidateSettingsCache();

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

    return {
      ok: true,
      updated: entries.length,
      rejected,
      message:
        rejected.length > 0
          ? `${entries.length} configuracao(oes) salva(s); ${rejected.length} recusada(s).`
          : 'Configuracoes salvas.',
    };
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
    return resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
  }

  /* ---------------- Registro de backups no banco ---------------- */
  /*
   * O arquivo .db.gz vive no disco; a tabela `backups` guarda o historico.
   * A listagem cruza os dois: o disco manda no que existe de fato, o banco
   * traz quem gerou e com que nota. Isso importa porque um arquivo pode ser
   * copiado para a pasta por fora da aplicacao, e nesse caso ele precisa
   * aparecer na tela mesmo sem registro.
   */

  async function checksumFile(path: string): Promise<string | null> {
    try {
      const hash = createHash('sha256');
      await pipeline(createReadStream(path), hash);
      return hash.digest('hex');
    } catch {
      // Checksum e um extra: falhar aqui nao pode impedir o backup.
      return null;
    }
  }

  async function registerBackup(input: {
    fileName: string;
    sizeBytes: number;
    kind: 'MANUAL' | 'AUTOMATICO' | 'PRE_RESTORE';
    userId: number | null;
    note?: string;
  }): Promise<void> {
    try {
      await prisma.backupRecord.upsert({
        where: { fileName: input.fileName },
        create: {
          fileName: input.fileName,
          sizeBytes: input.sizeBytes,
          kind: input.kind,
          status: 'VALIDO',
          userId: input.userId,
          note: input.note ?? null,
          checksum: await checksumFile(join(await backupsPath(), input.fileName)),
        },
        // Um nome de arquivo so pode reaparecer com o mesmo conteudo; se
        // reexecutar, o registro anterior e substituido.
        update: {
          sizeBytes: input.sizeBytes,
          status: 'VALIDO',
          userId: input.userId,
          note: input.note ?? null,
        },
      });
    } catch (error) {
      // Registrar o historico nao pode derrubar a operacao de backup: o
      // arquivo ja esta em disco e e isso que importa para o usuario.
      console.error('[backup] falha ao registrar no banco:', error);
    }
  }

  async function backupsPath(): Promise<string> {
    return backupsDirFor(await resolveDatabaseFile());
  }

  /* ---------------------------------------------------------------- */
  /* POST /api/backup - criar backup manual                           */
  /* ---------------------------------------------------------------- */
  app.post('/backup', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;

    const dbFile = await resolveDatabaseFile();
    const backupDir = await backupsPath();
    await mkdir(backupDir, { recursive: true });

    // Backup com o mesmo segundo sobrescreveria o anterior. Um sufixo curto
    // de aleatoriedade mantem o historico sem depender de data apenas.
    const rawFile = join(backupDir, `webdist-${timestamp()}-${randomSuffix()}.db`);
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
    const fileName = gzFile.split(/[\\/]/).pop()!;

    await registerBackup({ fileName, sizeBytes: size, kind: 'MANUAL', userId: actor.id });

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
    const backupDir = await backupsPath();

    let files: Array<{
      name: string;
      size: string;
      sizeBytes: number;
      date: string;
      kind: string | null;
      status: string | null;
      note: string | null;
      userName: string | null;
    }> = [];

    try {
      const existing = (await readdir(backupDir)).filter((name) =>
        ARCHIVED_BACKUP_PATTERN.test(name),
      );

      const records = await prisma.backupRecord.findMany({
        select: { fileName: true, kind: true, status: true, note: true, user: { select: { name: true } } },
      });
      const byName = new Map(records.map((r) => [r.fileName, r]));

      files = await Promise.all(
        existing.sort().reverse().map(async (name) => {
          const { size, mtime } = await stat(join(backupDir, name));
          const record = byName.get(name);
          return {
            name,
            size: humanSize(size),
            sizeBytes: size,
            date: mtime.toISOString(),
            // Arquivo copiado para a pasta por fora do sistema aparece
            // mesmo assim, com os campos de origem nulos.
            kind: record?.kind ?? null,
            status: record?.status ?? null,
            note: record?.note ?? null,
            userName: record?.user?.name ?? null,
          };
        }),
      );
    } catch (error) {
      console.error('[backup] falha ao listar:', error);
      return { data: [] };
    }

    // Registro sem arquivo correspondente: o arquivo foi apagado da pasta
    // por fora. Sinaliza em vez de esconder, para o admin notar que o
    // historico e do disco.
    const orphanRecords = await prisma.backupRecord
      .findMany({
        where: { fileName: { notIn: files.map((f) => f.name) } },
        select: { fileName: true, kind: true, sizeBytes: true, createdAt: true, note: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      .catch(() => []);

    return {
      data: files,
      orphans: orphanRecords.map((r) => ({
        name: r.fileName,
        kind: r.kind,
        size: humanSize(r.sizeBytes),
        date: r.createdAt.toISOString(),
        missing: true,
        note: r.note,
      })),
    };
  });

  /* ---------------------------------------------------------------- */
  /* POST /api/restore - restaurar backup                             */
  /* ---------------------------------------------------------------- */
  app.post('/restore', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const body = z.object({ fileName: z.string().min(1) }).parse(request.body);

    // Rejeitar qualquer nome fora do padrao antes de tocar no disco evita
    // path traversal (ex.: "webdist-20260101-000000.db.gz/../../.env").
    if (!BACKUP_FILE_PATTERN.test(body.fileName)) {
      return reply.status(400).send({ ok: false, message: 'Nome de arquivo invalido.' });
    }

    const dbFile = await resolveDatabaseFile();
    const backupDir = await backupsPath();
    const gzFile = join(backupDir, body.fileName);

    try {
      await stat(gzFile);
    } catch {
      return reply.status(404).send({ ok: false, message: 'Arquivo de backup nao encontrado.' });
    }

    // 1. Cria backup de seguranca do banco atual antes de restaurar.
    //    E o unico caminho de volta caso o arquivo restaurado esteja com
    //    schema incompativel, entao recebe nome proprio e fica listavel.
    const safetyName = `webdist-pre-restore-${timestamp()}-${randomSuffix()}.db.gz`;
    const safetyFile = join(backupDir, safetyName);
    const safetyRaw = `${safetyFile}.tmp`;
    const database = new DatabaseSync(dbFile, { readOnly: true });
    try {
      database.exec(`VACUUM INTO '${safetyRaw.replace(/'/g, "''")}'`);
    } finally {
      database.close();
    }
    await pipeline(createReadStream(safetyRaw), createGzip(), createWriteStream(safetyFile));
    await rm(safetyRaw, { force: true });
    await registerBackup({
      fileName: safetyName,
      sizeBytes: (await stat(safetyFile)).size,
      kind: 'PRE_RESTORE',
      userId: actor.id,
      note: `Backup automatico gerado antes de restaurar ${body.fileName}`,
    });

    // 2. Descompacta e prepara o restore
    const tempDb = join(backupDir, `restore-${timestamp()}-${randomSuffix()}.db`);
    await pipeline(createReadStream(gzFile), createGunzip(), createWriteStream(tempDb));

    // Valida se o banco restaurado e consistente
    const testDb = new DatabaseSync(tempDb, { readOnly: true });
    try {
      testDb.exec('PRAGMA integrity_check');
    } finally {
      testDb.close();
    }

    // Prepara o restore: move o arquivo restaurado para a pasta de backups
    // como "pending restore". O startup aplica e roda as migrations, porque
    // um backup antigo pode ter um schema anterior ao atual - restaurar sem
    // isso deixa o sistema sem tabelas e sem usuario para logar.
    const pendingName = `webdist-pending-restore-${timestamp()}-${randomSuffix()}.db`;
    const pendingRestoreFile = join(backupDir, pendingName);
    await rm(pendingRestoreFile, { force: true });
    await rename(tempDb, pendingRestoreFile);

    // O arquivo de origem foi consumido pelo restore: marca como RESTAURADO
    // para o historico mostrar que ele ja foi usado.
    await prisma.backupRecord
      .updateMany({ where: { fileName: body.fileName }, data: { status: 'RESTAURADO' } })
      .catch(() => undefined);

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
      message:
        'Restore preparado com sucesso. Reinicie a aplicacao (feche e abra novamente) para concluir a restauracao.',
      pendingFile: pendingName,
      safetyBackup: safetyName,
    });
  });

  /* ---------------------------------------------------------------- */
  /* DELETE /api/backup/:fileName - excluir backup                    */
  /* ---------------------------------------------------------------- */
  app.delete('/backup/:fileName', { preHandler: [app.requirePermission('settings:manage')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);

    if (!BACKUP_FILE_PATTERN.test(fileName)) {
      return reply.status(400).send({ ok: false, message: 'Nome de arquivo invalido.' });
    }

    const backupDir = await backupsPath();
    const gzFile = join(backupDir, fileName);

    try {
      await stat(gzFile);
    } catch {
      return reply.status(404).send({ ok: false, message: 'Arquivo nao encontrado.' });
    }

    // O backup de seguranca do ultimo restore e a saida de emergencia do
    // sistema; nao ha outro caminho para voltar os dados.
    if (/^webdist-pre-restore-\d{8}-\d{6}-[0-9a-f]{6}\.db\.gz$/.test(fileName)) {
      return reply.status(409).send({
        ok: false,
        message: 'Este e o backup de seguranca do ultimo restore e nao pode ser excluido.',
      });
    }

    await rm(gzFile, { force: true });
    await prisma.backupRecord.delete({ where: { fileName } }).catch(() => undefined);

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
