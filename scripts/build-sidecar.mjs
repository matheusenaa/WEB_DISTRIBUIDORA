import ncc from '@vercel/ncc';
import { copyFile, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const API_ENTRY = resolve('apps/api/src/server.ts');
const OUTPUT_DIR = resolve('apps/desktop/src-tauri/binaries');
const OUTPUT_FILE = 'api-sidecar';

async function main() {
  console.log('[sidecar] Building API sidecar...');
  
  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });
  
  // Clean previous build
  try {
    await rm(join(OUTPUT_DIR, OUTPUT_FILE), { force: true });
    await rm(join(OUTPUT_DIR, `${OUTPUT_FILE}.exe`), { force: true });
    await rm(join(OUTPUT_DIR, `${OUTPUT_FILE}.js`), { force: true });
  } catch {}
  
  // Bundle with ncc
  // Nao usar `externals` para @prisma/client: o bundle precisa ser autonomous,
  // senao o app instalado quebra com ERR_MODULE_NOT_FOUND por nao ter node_modules.
  const { code, map, assets, errors } = await ncc(API_ENTRY, {
    target: 'es2022',
    minify: true,
    sourceMap: false,
    v8cache: true,
  });
  
  // ncc nao lanca excecao: devolve `errors` e um code vazio. Sem esta
  // checagem o script escrevia um bundle quebrado e|reportava sucesso.
  if (errors?.length) {
    throw new Error(`ncc falhou:\n${errors.map((e) => `  - ${e.message ?? e}`).join('\n')}`);
  }
  if (!code) {
    throw new Error('ncc devolveu bundle vazio');
  }
  
  // Write bundled file
  const bundledPath = join(OUTPUT_DIR, `${OUTPUT_FILE}.js`);
  await writeFile(bundledPath, code);
  
  // ncc emite os assets (engine do Prisma, schema, package.json) como um mapa
  // nome -> { source }. Descartar esses assets deixa o Prisma sem engine e o
  // bundle sem o package.json que marca o arquivo como ESM.
  for (const [filename, asset] of Object.entries(assets ?? {})) {
    const assetPath = join(OUTPUT_DIR, filename);
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, asset.source);
    console.log('[sidecar] asset:', filename);
  }
  
  // Create a simple launcher batch file for Windows
  const launcherContent = `@echo off
REM WEB DISTRIBUIDORA - API Sidecar Launcher
REM This script starts the API server using bundled JavaScript

set SCRIPT_DIR=%~dp0
set NODE_EXE=%SCRIPT_DIR%..\\..\\..\\..\\nodejs\\node.exe
set BUNDLED_JS=%SCRIPT_DIR%api-sidecar.js

REM Set TAURI_SIDECAR env var so the API knows it's running as a sidecar
set TAURI_SIDECAR=true

REM Check if bundled Node.js exists, otherwise use system Node.js
if exist "%NODE_EXE%" (
    "%NODE_EXE%" "%BUNDLED_JS%" %*
) else (
    node "%BUNDLED_JS%" %*
)
`;
  const launcherPath = join(OUTPUT_DIR, 'api-sidecar.bat');
  await writeFile(launcherPath, launcherContent);
  
  // Copy prisma schema and migrations
  const prismaSrc = resolve('apps/api/prisma');
  const prismaDest = join(OUTPUT_DIR, 'prisma');
  await mkdir(prismaDest, { recursive: true });
  
  // Copy schema.prisma
  await copyFile(join(prismaSrc, 'schema.prisma'), join(prismaDest, 'schema.prisma'));
  
  // Copy migrations
  const migrationsSrc = join(prismaSrc, 'migrations');
  const migrationsDest = join(prismaDest, 'migrations');
  await rm(migrationsDest, { recursive: true, force: true });
  await cp(migrationsSrc, migrationsDest, { recursive: true });
  
  const migrationDirs = await readdir(migrationsDest);
  console.log('[sidecar] migrations copiadas:', migrationDirs.join(', ') || '(nenhuma)');
  
  console.log('[sidecar] API sidecar built successfully at:', bundledPath);
  console.log('[sidecar] Launcher created at:', launcherPath);
}

main().catch((err) => {
  console.error('[sidecar] Build failed:', err);
  process.exit(1);
});