import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// O .env fica na raiz do monorepo para ser a unica fonte de verdade.
loadEnv({ path: path.resolve(here, '../../.env') });
loadEnv({ path: path.resolve(here, '.env'), override: true });

export default defineConfig({
  schema: path.join(here, 'prisma/schema.prisma'),
  migrations: {
    path: path.join(here, 'prisma/migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
