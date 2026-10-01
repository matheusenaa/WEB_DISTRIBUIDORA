import { execFile } from 'node:child_process';
import { copyFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { PENDING_RESTORE_PATTERN, backupsDirFor } from './backup-files.js';

const execFileAsync = promisify(execFile);

/**
 * Restore de backup aplicado no startup.
 *
 * Por que no startup e nao durante a request: o arquivo do banco e
 * substituido por inteiro, e a conexao do Prisma ja estaria aberta. Fazer
 * isso antes de `buildApp` evita que qualquer consulta veja um banco pela
 * metade.
 *
 * Por que as migrations rodam DEPOIS do restore
 * --------------------------------------------
 * Um backup de mes passado tem o schema de mes passado. Restaurar o arquivo
 * sem alinhar o schema deixa o sistema sem as tabelas novas e sem usuario
 * para logar - foi exatamente o que aconteceu na validacao manual. Por isso
 * o passo 3 e obrigatorio e nao opcional.
 */

export interface RestoreOutcome {
  applied: boolean;
  fileName?: string;
  /** Mensagens de migracao, quando houve. */
  migrations?: string;
  error?: string;
}

export async function applyPendingRestoreIfExists(
  dbFile: string,
  projectRoot: string,
): Promise<RestoreOutcome> {
  const backupDir = backupsDirFor(dbFile);

  let pendingFile: string | undefined;
  try {
    const files = await readdir(backupDir);
    pendingFile = files
      .filter((name) => PENDING_RESTORE_PATTERN.test(name))
      .sort()
      .pop();
  } catch {
    // Sem pasta de backups ainda: nada a restaurar.
    return { applied: false };
  }

  if (!pendingFile) return { applied: false };

  const pendingPath = join(backupDir, pendingFile);
  console.log(`[STARTUP] Restore pendente detectado: ${pendingFile}`);

  try {
    // 1. O arquivo precisa ser um SQLite integro antes de substituir o banco.
    await assertSqliteIntegrity(pendingPath);

    // 2. Guarda o banco atual em arquivo proprio antes de qualquer troca.
    //    O backup comprimido ja existe, mas um .db cru permite reverter
    //    localmente sem depender do ciclo de descompactacao.
    const rollbackFile = join(backupDir, `webdist-restore-rollback-${Date.now()}.db`);
    let dbReplaced = false;
    try {
      await copyFile(dbFile, rollbackFile);
    } catch {
      // Sem banco atual nao ha o que reverter.
    }

    try {
      // 3. Substitui o banco. Os arquivos -wal e -shm pertencem ao banco antigo:
      //    sobra-los junto com o novo produziria estado inconsistente.
      await rm(`${dbFile}-wal`, { force: true });
      await rm(`${dbFile}-shm`, { force: true });
      await rm(dbFile, { force: true });
      await rename(pendingPath, dbFile);
      dbReplaced = true;
      console.log(`[STARTUP] Arquivo restaurado: ${pendingFile} -> ${dbFile}`);

      // 4. Alinha o schema restaurado com o schema atual do sistema.
      const migrations = await alignSchema(projectRoot);
      console.log('[STARTUP] Schema alinhado com sucesso.');
      await rm(rollbackFile, { force: true });

      return { applied: true, fileName: pendingFile, migrations };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Se o schema nao alinhou, o banco restaurado esta no lugar mas
      // inutilizavel. Devolve o banco anterior para nao deixar o sistema
      // quebrado, a menos que nao exista copia de rollback.
      if (dbReplaced) {
        try {
          await stat(rollbackFile);
          await rm(`${dbFile}-wal`, { force: true });
          await rm(`${dbFile}-shm`, { force: true });
          await rm(dbFile, { force: true });
          await rename(rollbackFile, dbFile);
          console.error('[STARTUP] Restore revertido: banco anterior restaurado do rollback.');
          return { applied: false, fileName: pendingFile, error: `rollback: ${message}` };
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          console.error('[STARTUP] Falha ao reverter o restore:', rollbackMessage);
          return {
            applied: false,
            fileName: pendingFile,
            error: `${message} | rollback indisponivel: ${rollbackMessage}`,
          };
        }
      }

      console.error('[STARTUP] Erro ao aplicar restore pendente:', message);
      // Nao derruba o startup: o admin precisa de chance de ver o erro e
      // recorrer ao backup de seguranca, e o log fica registrado.
      return { applied: false, fileName: pendingFile, error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[STARTUP] Erro ao aplicar restore pendente:', message);
    return { applied: false, fileName: pendingFile, error: message };
  }
}

/**
 * `DatabaseSync.exec()` devolve `void` no node:sqlite, entao nao serve para
 * ler o resultado de um PRAGMA. `prepare().get()` devolve a linha de fato.
 */
async function assertSqliteIntegrity(dbPath: string): Promise<void> {
  const testDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = testDb.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined;
    const status = row?.integrity_check;
    if (status !== 'ok') {
      throw new Error(`integrity_check respondeu "${status ?? 'vazio'}"`);
    }
  } finally {
    testDb.close();
  }
}

/**
 * Leva o banco restaurado ao schema atual.
 *
 * Usa `db push` e nao `migrate deploy` de proposito: o objetivo aqui e
 * "faca este banco ter o schema de hoje", independente de qual historico
 * de migration aquele arquivo carrega. Um backup antigo nao tem a tabela
 * `_prisma_migrations` populated com o estado atual, e rodar migrations
 * nele falharia por tabela ja existente.
 */
async function alignSchema(projectRoot: string): Promise<string> {
  const apiDir = join(projectRoot, 'apps', 'api');
  const args = ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'];
  try {
    // `execFile` sem shell falha com EINVAL ao tentar spawnar um .cmd no
    // Windows, e o prisma CLI so existe como .cmd. Passar pelo shell do SO
    // resolve nos dois sistemas.
    const { stdout } = await execFileAsync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args,
      { cwd: apiDir, timeout: 180_000, shell: true },
    );
    return stdout.trim().split('\n').slice(-3).join(' | ');
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const stdout = (error as { stdout?: string }).stdout ?? '';
    throw new Error(
      `falha ao alinhar o schema do banco restaurado (${stdout.trim()} ${stderr.trim()})`.trim(),
    );
  }
}

/** Remove arquivos de restore pendente antigos que nunca foram aplicados. */
export async function clearStalePendingRestores(dbFile: string, keepDays = 7): Promise<number> {
  const backupDir = backupsDirFor(dbFile);
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  let files: string[];
  try {
    files = await readdir(backupDir);
  } catch {
    return 0;
  }

  for (const name of files) {
    if (!PENDING_RESTORE_PATTERN.test(name)) continue;
    const info = await stat(join(backupDir, name)).catch(() => null);
    if (info && info.mtimeMs < cutoff) {
      await rm(join(backupDir, name), { force: true });
      removed += 1;
    }
  }

  return removed;
}
