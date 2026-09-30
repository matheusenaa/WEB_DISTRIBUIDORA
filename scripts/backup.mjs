/**
 * Backup do banco SQLite.
 *
 * Uso:
 *   npm run backup              -> cria um backup datado
 *   npm run backup -- --keep 10 -> mantém apenas os 10 mais recentes
 *
 * Por que `VACUUM INTO` e nao uma copia simples do arquivo:
 * o SQLite grava em journal (WAL). Copiar `dev.db` enquanto a API esta
 * escrevendo pode capturar um estado inconsistente. `VACUUM INTO` produz uma
 * copia consistente e compacta mesmo com a base aberta.
 *
 * Usamos o modulo nativo `node:sqlite` (Node >= 22.5) para nao depender do
 * Prisma CLI, que exige um engine proprio e trava quando executado via pipe.
 */

import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Resolve o caminho do .sqlite a partir de DATABASE_URL no .env. */
async function resolveDatabaseFile() {
  let url = 'file:./dev.db';
  try {
    const content = await readFile(join(root, '.env'), 'utf8');
    const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match?.[1]) url = match[1].trim();
  } catch {
    // .env ausente: usa o padrao do .env.example.
  }

  if (!url.startsWith('file:')) {
    throw new Error(
      'DATABASE_URL nao aponta para SQLite. Use o backup nativo do PostgreSQL (pg_dump).',
    );
  }

  // O Prisma resolve caminhos relativos a pasta prisma/.
  return resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
}

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const keepArgIndex = process.argv.indexOf('--keep');
const keep = keepArgIndex === -1 ? 30 : Number(process.argv[keepArgIndex + 1]);
if (!Number.isInteger(keep) || keep < 1) {
  throw new Error('--keep deve ser um inteiro >= 1.');
}

const dbFile = await resolveDatabaseFile();
try {
  await stat(dbFile);
} catch {
  console.error(`Banco nao encontrado: ${dbFile}`);
  process.exit(1);
}

const backupDir = join(root, 'backups');
await mkdir(backupDir, { recursive: true });

const rawFile = join(backupDir, `webdist-${timestamp()}.db`);
const gzFile = `${rawFile}.gz`;

// `VACUUM INTO` exige que o destino ainda nao exista.
await rm(rawFile, { force: true });

const database = new DatabaseSync(dbFile, { readOnly: true });
try {
  // Falha cedo e com mensagem clara se algum modulo do SQLite nao foi compilado.
  database.exec(`VACUUM INTO '${rawFile.replace(/'/g, "''")}'`);
} finally {
  database.close();
}

await pipeline(createReadStream(rawFile), createGzip(), createWriteStream(gzFile));
await rm(rawFile, { force: true });

const { size } = await stat(gzFile);
console.log(`Backup criado: backups/${gzFile.split(/[\\/]/).pop()} (${humanSize(size)})`);

// Rotacao: mantem apenas os `keep` backups mais recentes.
const existing = (await readdir(backupDir))
  .filter((name) => /^webdist-\d{8}-\d{6}\.db\.gz$/.test(name))
  .sort()
  .reverse();

for (const name of existing.slice(keep)) {
  await rm(join(backupDir, name), { force: true });
  console.log(`Removido (rotacao): ${name}`);
}

console.log(`Backups mantidos: ${Math.min(keep, existing.length)}`);