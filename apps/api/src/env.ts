import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '../..');

loadEnv({ path: path.join(repoRoot, '.env') });
loadEnv({ path: path.join(apiRoot, '.env'), override: true });

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  API_PUBLIC_URL: z.string().default('http://localhost:3333'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatorio'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  REFRESH_TOKEN_PEPPER: z.string().min(16, 'REFRESH_TOKEN_PEPPER deve ter ao menos 16 caracteres'),
  PUBLIC_ROUTES: z
    .string()
    .default('/api/auth/login,/api/auth/refresh,/api/health,/api/meta'),

  ALLOW_NEGATIVE_STOCK: bool(false),
  SELLER_MAX_DISCOUNT_PERCENT: z.coerce.number().min(0).max(100).default(0),
  ADMIN_MAX_DISCOUNT_PERCENT: z.coerce.number().min(0).max(100).default(40),
  CASH_TOLERANCE: z.coerce.number().min(0).default(0.01),
  BARCODE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('\n');
  console.error(`\n[config] variaveis de ambiente invalidas:\n${issues}\n`);
  console.error('Copie .env.example para .env e preencha os valores.\n');
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  publicRoutes: raw.PUBLIC_ROUTES.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Tolerancia de caixa convertida para centavos. */
  cashToleranceCents: Math.round(raw.CASH_TOLERANCE * 100),
} as const;

export type Config = typeof config;
