import { buildApp } from './app.js';
import { config } from './env.js';
import { connectDatabase, disconnectDatabase, prisma } from './lib/prisma.js';
import { applyPendingRestoreIfExists, clearStalePendingRestores } from './lib/restore.js';
import { assertMovementTypesComplete } from './modules/stock/service.js';
import { STOCK_MOVEMENT_TYPES } from '@webdist/shared';
import { mkdir } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/** Detecta se está rodando como sidecar do Tauri. */
function isTauriSidecar(): boolean {
  // Verifica variável de ambiente ou caminho do executável
  const exePath = process.execPath.toLowerCase();
  return exePath.includes('tauri') || exePath.includes('webdist') || process.env.TAURI_SIDECAR === 'true';
}

/** Resolve o diretório de dados da aplicação (onde fica o banco). */
function getAppDataDir(): string {
  // Em produção/Tauri, usa diretório de dados do usuário
  if (isTauriSidecar() || config.NODE_ENV === 'production') {
    const base = process.env.APPDATA || process.env.HOME || homedir();
    return join(base, 'WEB DISTRIBUIDORA');
  }
  // Em desenvolvimento, usa o diretório do projeto
  return resolve(process.cwd(), '..', '..');
}

/**
 * Resolve o caminho do arquivo SQLite.
 *
 * A fonte única é `config.DATABASE_URL`: `env.ts` já transformou o
 * `file:./dev.db` do `.env` em caminho absoluto no sidecar, e é exatamente
 * esse valor que o Prisma abriu. Re-ler o `.env` do disco aqui criava uma
 * segunda resolutions discordante, e o backup falhava com
 * `unable to open database file` porque apontava para um arquivo que não
 * existe.
 */
async function resolveDatabaseFile(): Promise<{ dbFile: string; root: string }> {
  const url = config.DATABASE_URL;
  if (!url.startsWith('file:')) {
    throw new Error('DATABASE_URL não aponta para SQLite. Use o backup nativo do PostgreSQL (pg_dump).');
  }

  const target = url.slice('file:'.length);
  let dbFile: string;

  if (isAbsolute(target)) {
    // Sidecar: `env.ts` já entregou o caminho absoluto do usuário.
    dbFile = target;
  } else if (isTauriSidecar() || config.NODE_ENV === 'production') {
    dbFile = resolve(getAppDataDir(), target);
  } else {
    // Desenvolvimento: o Prisma resolve relativos a pasta prisma/, que é
    // `<api>/prisma` relativo a `dist/server.js`.
    const distDir = dirname(fileURLToPath(import.meta.url));
    dbFile = resolve(distDir, '..', 'prisma', target);
  }

  const root = dirname(dbFile);
  await mkdir(root, { recursive: true });

  return { dbFile, root };
}

/**
 * Aplica restore pendente e limpa os arquivos que nunca foram aplicados.
 * A implementação está em lib/restore.ts.
 */
async function runStartupRestore(): Promise<void> {
  /*
   * Um tipo de movimentação sem sinal definido não quebra a compilação:
   * o TypeScript aceita o enum, e o erro só apareceria como saldo de
   * estoque errado em produção. Falhar no startup, logo após o restore,
   * é o ponto onde o developer ainda está olhando o terminal.
   */
  assertMovementTypesComplete(STOCK_MOVEMENT_TYPES, (type) => {
    throw new Error(
      `Tipo de movimentação "${type}" não pertence a nenhuma lista de sinal ` +
        '(INBOUND_MOVEMENT_TYPES, OUTBOUND_MOVEMENT_TYPES, ' +
        'ADJUSTMENT_MOVEMENT_TYPES ou DOCUMENTAL_MOVEMENT_TYPES).',
    );
  });

  const { dbFile, root } = await resolveDatabaseFile();

  const outcome = await applyPendingRestoreIfExists(dbFile, root);
  if (outcome.applied) {
    console.log(
      `[STARTUP] Restore concluído: ${outcome.fileName}` +
        (outcome.migrations ? ` | ${outcome.migrations}` : ''),
    );
  } else if (outcome.error) {
    console.error(
      '[STARTUP] O restore NÃO foi concluído. O banco atual permanece intacto; ' +
        'use o backup de segurança em backups/ para recuperar.',
    );
  }

  const removed = await clearStalePendingRestores(dbFile);
  if (removed > 0) {
    console.log(`[STARTUP] ${removed} restore(s) pendente(s) antigo(s) removido(s).`);
  }
}

async function main(): Promise<void> {
  // 1. Aplica restore pendente ANTES de conectar no banco.
  //    Inclui o alinhamento de schema: um backup antigo precisa ser
  //    atualizado para a versão atual do sistema, senão não há usuário
  //    para logar depois do restore.
  await runStartupRestore();

  const app = await buildApp();

  // Verifica o banco ANTES de aceitar tráfego. Se o banco estiver fora,
  // o sistema informa o erro de forma clara em vez de fingir que funciona.
  try {
    await connectDatabase();
    app.log.info('Banco de dados conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no banco de dados.');
    console.error(
      '\n[ERRO] Não foi possível conectar no banco de dados.\n' +
        `        DATABASE_URL: ${config.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}\n` +
        '        Verifique se o arquivo do banco existe e se o prisma generate foi executado.\n',
    );
    await app.close();
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Encerrando o servidor...');
    try {
      await app.close();
      await disconnectDatabase();
      app.log.info('Servidor encerrado com sucesso.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Erro ao encerrar o servidor.');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Promise rejeitada sem tratamento');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Exceção não tratada');
    void shutdown('uncaughtException');
  });

  try {
    const address = await app.listen({ port: config.API_PORT, host: config.API_HOST });
    app.log.info(`API ouvindo em ${address}`);
    app.log.info(`Ambiente: ${config.NODE_ENV} | Documentação de saúde: ${address}/api/health`);

    if (config.isProduction) {
      const count = await prisma.user.count();
      if (count === 0) {
        app.log.warn(
          'Nenhum usuário cadastrado. Rode "npm run db:seed" antes de usar o sistema em produção.',
        );
      }
    }
  } catch (err) {
    app.log.error({ err }, 'Falha ao iniciar o servidor.');
    process.exit(1);
  }
}

void main();