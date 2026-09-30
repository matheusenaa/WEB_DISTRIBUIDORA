import { buildApp } from './app.js';
import { config } from './env.js';
import { connectDatabase, disconnectDatabase, prisma } from './lib/prisma.js';

async function main(): Promise<void> {
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
