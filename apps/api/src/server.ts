import { buildApp } from './app.js';
import { config } from './env.js';
import { connectDatabase, disconnectDatabase, prisma } from './lib/prisma.js';
import { applyPendingRestoreIfExists, clearStalePendingRestores } from './lib/restore.js';
import { assertMovementTypesComplete } from './modules/stock/service.js';
import { STOCK_MOVEMENT_TYPES } from '@webdist/shared';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve o caminho do .sqlite a partir de DATABASE_URL no .env. */
async function resolveDatabaseFile(): Promise<{ dbFile: string; root: string }> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  
  // Sobe diretorios ate encontrar o .env (raiz do repositorio)
  // Funciona tanto em dev (src/) quanto em prod (dist/)
  let root = currentDir;
  for (let i = 0; i < 10; i++) {
    try {
      await readFile(join(root, '.env'), 'utf8');
      break; // Achou .env
    } catch {
      const parent = resolve(root, '..');
      if (parent === root) break; // Chegou na raiz do filesystem
      root = parent;
    }
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
  const dbFile = resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
  return { dbFile, root };
}

/**
 * Aplica restore pendente e limpa os arquivos que nunca foram aplicados.
 * A implementacao esta em lib/restore.ts.
 */
async function runStartupRestore(): Promise<void> {
  /*
   * Um tipo de movimentacao sem sinal definido nao quebra a compilacao:
   * o TypeScript aceita o enum, e o erro so apareceria como saldo de
   * estoque errado em producao. Falhar no startup, logo apos o restore,
   * e o ponto onde o developer ainda esta olhando o terminal.
   */
  assertMovementTypesComplete(STOCK_MOVEMENT_TYPES, (type) => {
    throw new Error(
      `Tipo de movimentacao "${type}" nao pertence a nenhuma lista de sinal ` +
        '(INBOUND_MOVEMENT_TYPES, OUTBOUND_MOVEMENT_TYPES, ' +
        'ADJUSTMENT_MOVEMENT_TYPES ou DOCUMENTAL_MOVEMENT_TYPES).',
    );
  });

  const { dbFile, root } = await resolveDatabaseFile();

  const outcome = await applyPendingRestoreIfExists(dbFile, root);
  if (outcome.applied) {
    console.log(
      `[STARTUP] Restore concluido: ${outcome.fileName}` +
        (outcome.migrations ? ` | ${outcome.migrations}` : ''),
    );
  } else if (outcome.error) {
    console.error(
      '[STARTUP] O restore NAO foi concluido. O banco atual permanece intacto; ' +
        'use o backup de seguranca em backups/ para recuperar.',
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
  //    atualizado para a versao atual do sistema, senao nao ha usuario
  //    para logar depois do restore.
  await runStartupRestore();

  const app = await buildApp();

  // Verifica o banco ANTES de aceitar trafego. Se o banco estiver fora,
  // o sistema informa o erro de forma clara em vez de fingir que funciona.
  try {
    await connectDatabase();
    app.log.info('Banco de dados conectado.');
  } catch (err) {
    app.log.error({ err }, 'Falha ao conectar no banco de dados.');
    console.error(
      '\n[ERRO] Nao foi possivel conectar no banco de dados.\n' +
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
    app.log.fatal({ err }, 'Excecao nao tratada');
    void shutdown('uncaughtException');
  });

  try {
    const address = await app.listen({ port: config.API_PORT, host: config.API_HOST });
    app.log.info(`API ouvindo em ${address}`);
    app.log.info(`Ambiente: ${config.NODE_ENV} | Documentacao de saude: ${address}/api/health`);

    if (config.isProduction) {
      const count = await prisma.user.count();
      if (count === 0) {
        app.log.warn(
          'Nenhum usuario cadastrado. Rode "npm run db:seed" antes de usar o sistema em producao.',
        );
      }
    }
  } catch (err) {
    app.log.error({ err }, 'Falha ao iniciar o servidor.');
    process.exit(1);
  }
}

void main();
