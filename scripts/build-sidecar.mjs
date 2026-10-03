/**
 * Empacota a API para dentro do app desktop.
 *
 * Estrategia: enviar o `dist` compilado + `node_modules` de producao + um
 * `node.exe` portatil. Nao usar bundler (ncc/pkg/sea) porque o Prisma depende
 * de engine nativa e de `__dirname`, que nao sobrevivem a um bundle ESM.
 *
 * Saida em apps/desktop/src-tauri/binaries:
 *   nodejs/node.exe
 *   api/dist, api/node_modules, api/prisma, api/package.json
 *   prisma/dev.db          (banco migrado e populado, copiado no 1o boot)
 *   api-sidecar.mjs        (bootstrap: segredos, banco e execucao da API)
 *   api-sidecar.bat        (wrapper para o Tauri)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Tamanho total de um diretorio, em bytes. */
function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    total += info.isDirectory() ? dirSize(full) : info.size;
  }
  return total;
}

const API_DIR = resolve('apps/api');
const SHARED_DIR = resolve('packages/shared');
const OUTPUT_DIR = resolve('apps/desktop/src-tauri/binaries');
const API_OUT = join(OUTPUT_DIR, 'api');
const TEMPLATE_DB = join(OUTPUT_DIR, 'prisma', 'dev.db');

function fail(message) {
  throw new Error(message);
}

/**
 * Executa o node atual. Nunca usar `shell: true`: o repositorio vive em um
 * caminho com espaco e acento ("Área de Trabalho") e o cmd.exe corta o
 * argumento ao meio.
 *
 * `attempts` existe porque o repositorio esta dentro do OneDrive e o Defender
 * segura o arquivo recem-escrito, fazendo o rename atomico do Prisma falhar
 * com EPERM de forma transitoria.
 */
function runNode(args, label, { cwd, env, attempts = 1 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = spawnSync(process.execPath, args, {
      cwd,
      stdio: 'inherit',
      env: env ?? process.env,
      shell: false,
    });
    if (result.status === 0) {
      return;
    }
    if (attempt < attempts) {
      console.warn(`[sidecar] ${label} falhou (tentativa ${attempt}/${attempts}); o lock de arquivo e transitorio, repetindo...`);
    } else {
      fail(`${label} falhou com codigo ${result.status}`);
    }
  }
}

/** Executa o npm da instalacao atual, via o proprio node. */
function runNpm(args, cwd) {
  // No Windows `npm` e um .cmd e nao pode ser executado sem shell; chamar o
  // npm-cli.js com o node evita depender do shell.
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) {
    fail(`npm-cli.js nao encontrado em ${npmCli}`);
  }
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    fail(`npm ${args.join(' ')} falhou com codigo ${result.status}`);
  }
}

async function requireBuilt() {
  if (!existsSync(join(API_DIR, 'dist', 'server.js'))) {
    fail('apps/api/dist/server.js ausente. Rode `npm run build:shared && npm run build:api` antes.');
  }
  if (!existsSync(join(SHARED_DIR, 'dist', 'index.js'))) {
    fail('packages/shared/dist/index.js ausente. Rode `npm run build:shared` antes.');
  }
}

/** Node portatil: copia o node.exe do sistema para o bundle. */
async function copyPortableNode() {
  const nodeExe = process.execPath;
  const dest = join(OUTPUT_DIR, 'nodejs', 'node.exe');
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(nodeExe, dest);
  console.log(`[sidecar] node portatil: ${nodeExe} -> ${dest}`);
}

/** Dependencias de producao da API, sem o pacote local @webdist/shared. */
async function installProductionDeps() {
  const apiPkg = JSON.parse(await readFile(join(API_DIR, 'package.json'), 'utf8'));
  const deps = {};
  for (const [name, range] of Object.entries(apiPkg.dependencies ?? {})) {
    if (name === '@webdist/shared') continue;
    deps[name] = range;
  }

  await writeFile(
    join(API_OUT, 'package.json'),
    JSON.stringify({ name: 'webdist-api-runtime', version: '1.0.0', private: true, type: 'module', dependencies: deps }, null, 2),
  );

  console.log('[sidecar] instalando dependencias de producao...');
  runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], API_OUT);

  // O pacote interno e local: precisa ser copiado, nao resolvido do npm.
  const sharedDest = join(API_OUT, 'node_modules', '@webdist', 'shared');
  await mkdir(sharedDest, { recursive: true });
  await copyFile(join(SHARED_DIR, 'package.json'), join(sharedDest, 'package.json'));
  await cp(join(SHARED_DIR, 'dist'), join(sharedDest, 'dist'), { recursive: true });
}

/**
 * Gera o Prisma Client e copia para o bundle.
 *
 * O `prisma generate` so resolve o client corretamente quando roda na raiz do
 * monorepo (ele procura @prisma/client a partir do proprio CLI). Gerado na
 * raiz, o cliente sai em node_modules/.prisma/client e e copiado para o
 * bundle. O motor (`query_engine-windows.dll.node`) e resolvido por caminho
 * relativo ao client, entao a copia funciona sem ajuste.
 */
async function generatePrismaClient() {
  const cli = resolve('node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(cli)) {
    fail('CLI do Prisma ausente em node_modules. Rode `npm install`.');
  }

  console.log('[sidecar] gerando Prisma Client...');
  runNode([cli, 'generate', '--schema', join(API_DIR, 'prisma', 'schema.prisma')], 'prisma generate', {
    cwd: resolve(),
    attempts: 5,
  });

  const source = resolve('node_modules', '.prisma', 'client');
  const dest = join(API_OUT, 'node_modules', '.prisma', 'client');
  if (!existsSync(join(source, 'index.js'))) {
    fail(`Prisma Client nao foi gerado em ${source}`);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true });

  const engine = join(dest, 'query_engine-windows.dll.node');
  if (!existsSync(engine)) {
    fail(`engine do Prisma ausente em ${engine}`);
  }
  console.log('[sidecar] Prisma Client e engine copiados para o bundle');
}

/** Cria o banco template: aplica migrations e roda o seed. */
async function buildTemplateDatabase() {
  const dbDir = join(OUTPUT_DIR, 'prisma');
  const dbFile = join(dbDir, 'dev.db');
  await mkdir(dbDir, { recursive: true });
  await rm(dbFile, { force: true });
  await rm(`${dbFile}-journal`, { force: true });

  const cli = resolve('node_modules', 'prisma', 'build', 'index.js');
  const schema = join(API_OUT, 'prisma', 'schema.prisma');
  const databaseUrl = `file:${dbFile.replace(/\\/g, '/')}`;

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    // Engines de migration usam caminho absoluto na flag do Prisma.
    PRISMA_MIGRATION_SKIP_GENERATE: 'true',
  };
  console.log('[sidecar] aplicando migrations no banco template...');
  runNode([cli, 'migrate', 'deploy', '--schema', schema], 'prisma migrate deploy', { env, attempts: 4 });

  console.log('[sidecar] populando o banco template (admin + dados basicos)...');
  // Caminho absoluto: o node trata entrada sem "./" como specifier de pacote.
  const tsxCli = resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  runNode([tsxCli, join(API_DIR, 'prisma', 'seed.ts')], 'seed', {
    cwd: resolve(),
    env: { ...env, SEED_DEMO_SALES: 'false' },
    attempts: 3,
  });

  const info = await stat(dbFile);
  console.log(`[sidecar] banco template pronto (${(info.size / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * Bootstrap em Node do sidecar.
 *
 * Feito em Node de proposito: o `.bat` nao consegue montar com seguranca um
 * caminho com espaco e acento ("Área de Trabalho", "WEB DISTRIBUIDORA") sem
 * quoting fragil, e nao tem como gerar segredos criptograficos.
 */
function bootstrapContent() {
  return `import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(process.env.APPDATA || homedir(), 'WEB DISTRIBUIDORA');
mkdirSync(dataDir, { recursive: true });

// O Tauri nao captura a saida do sidecar, entao tudo vai para um arquivo em
// disco: sem isso nao ha como diagnosticar a falha em uma maquina nova.
const logPath = join(dataDir, 'sidecar.log');
function log(line) {
  try {
    appendFileSync(logPath, \`[\${new Date().toISOString()}] \${line}\\n\`);
  } catch {
    // log e best-effort
  }
}

// Log antes de qualquer outra coisa: se o bootstrap quebrar na sequencia,
// pelo menos existe um registro de que ele chegou a rodar.
log('bootstrap iniciado em ' + here + ' via ' + process.execPath);

try {
  await main();
} catch (err) {
  log('FALHA FATAL: ' + (err?.stack ?? err?.message ?? String(err)));
  process.exit(1);
}

async function main() {

// Segredos por maquina: nunca versionados, gerados apenas no primeiro boot.
const envPath = join(dataDir, '.env');
if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    [
      'DATABASE_URL=file:./dev.db',
      \`JWT_SECRET=\${randomBytes(48).toString('base64url')}\`,
      \`REFRESH_TOKEN_PEPPER=\${randomBytes(32).toString('base64url')}\`,
      '',
    ].join('\\n'),
  );
  log('segredos gerados em ' + envPath);
}

const dbFile = join(dataDir, 'dev.db');
if (!existsSync(dbFile)) {
  copyFileSync(join(here, 'prisma', 'dev.db'), dbFile);
  log('banco inicial criado em ' + dbFile);
}

const env = { ...process.env, NODE_ENV: 'production', TAURI_SIDECAR: 'true' };
for (const line of readFileSync(envPath, 'utf8').split(/\\r?\\n/)) {
  const match = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)\\s*$/);
  if (match && match[2]) env[match[1]] = match[2].replace(/^"|"$/g, '');
}

log('iniciando API com ' + process.execPath);
const child = spawn(process.execPath, [join(here, 'api', 'dist', 'server.js'), ...process.argv.slice(2)], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

for (const stream of [child.stdout, child.stderr]) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    process[stream === child.stderr ? 'stderr' : 'stdout'].write(chunk);
    pending += chunk;
    const parts = pending.split(/\\r?\\n/);
    pending = parts.pop() ?? '';
    for (const part of parts) log(part);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  log(\`API encerrada: code=\${code} signal=\${signal}\`);
  process.exit(signal ? 1 : (code ?? 0));
});
child.on('error', (err) => {
  log('falha ao iniciar a API: ' + (err.stack ?? err.message));
  process.exit(1);
});
}
`;
}

/** Wrapper .bat: apenas localiza o Node portatil e chama o bootstrap. */
function launcherContent() {
  return `@echo off
REM WEB DISTRIBUIDORA - launcher da API (sidecar)
setlocal

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%nodejs\\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "%SCRIPT_DIR%api-sidecar.mjs" %*
`;
}

/**
 * Remove do bundle o que a app instalada nunca usa. O app e Windows + SQLite,
 * entao os engines WASM (que servem apenas aos driver adapters de browser/
 * edge para Postgres, MySQL, SQL Server e CockroachDB) sao ~72 MB de puro
 * peso morto. Tambem limpa os `*.tmp*` que o Prisma deixa para tras quando o
 * rename atomico falha por causa do lock do Defender no OneDrive.
 */
async function pruneBundle() {
  const targets = [
    join(API_OUT, 'node_modules', '@prisma', 'client', 'runtime'),
    join(API_OUT, 'node_modules', '.prisma', 'client'),
  ];

  let removedBytes = 0;
  let removedFiles = 0;

  const drop = async (path) => {
    try {
      const info = await stat(path);
      removedBytes += info.isDirectory() ? 0 : info.size;
      await rm(path, { force: true, recursive: true });
      removedFiles += 1;
    } catch {
      // arquivo ja removido por um passo anterior
    }
  };

  for (const dir of targets) {
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      // WASM: base64 de todos os bancos e o binario do engine em wasm.
      if (/\.wasm(-base64)?\.(js|mjs)$/.test(name) || name === 'query_engine_bg.wasm') {
        await drop(join(dir, name));
      }
      // Temporarios do Prisma (renomeacao atomica que falhou).
      if (/\.tmp\d*$/.test(name)) {
        await drop(join(dir, name));
      }
    }
  }

  // Um unico engine nativo e necessario.
  for (const dir of targets) {
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      if (/^query_engine.*\.(so|dylib|dll\.node\.tmp\d*)$/.test(name) && !/windows/.test(name)) {
        await drop(join(dir, name));
      }
    }
  }

  console.log(
    `[sidecar] poda concluida: ${removedFiles} arquivos, ${(removedBytes / 1024 / 1024).toFixed(1)} MB liberados`,
  );
}

async function main() {
  console.log('[sidecar] empacotando a API para o app desktop...');
  await requireBuilt();

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(API_OUT, { recursive: true });

  console.log('[sidecar] copiando dist da API...');
  await cp(join(API_DIR, 'dist'), join(API_OUT, 'dist'), { recursive: true });

  console.log('[sidecar] copiando schema e migrations...');
  await mkdir(join(API_OUT, 'prisma'), { recursive: true });
  await copyFile(join(API_DIR, 'prisma', 'schema.prisma'), join(API_OUT, 'prisma', 'schema.prisma'));
  await cp(join(API_DIR, 'prisma', 'migrations'), join(API_OUT, 'prisma', 'migrations'), { recursive: true });

  await copyPortableNode();
  await installProductionDeps();
  await generatePrismaClient();
  await buildTemplateDatabase();
  await pruneBundle();

  await writeFile(join(OUTPUT_DIR, 'api-sidecar.mjs'), bootstrapContent(), 'utf8');
  await writeFile(join(OUTPUT_DIR, 'api-sidecar.bat'), launcherContent(), 'utf8');

  const size = await dirSize(OUTPUT_DIR);
  console.log(`[sidecar] concluido em ${OUTPUT_DIR} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error('[sidecar] FALHOU:', err.message ?? err);
  process.exit(1);
});