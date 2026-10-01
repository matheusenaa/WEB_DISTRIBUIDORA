import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingRestoreIfExists } from '../src/lib/restore.js';

/**
 * O restore de startup e a operacao mais destrutiva do sistema: ele apaga o
 * banco atual. Estes testes existem porque dois bugs reais ja passaram
 * despercebidos aqui:
 *
 * 1. A leitura de `PRAGMA integrity_check` usava `exec()`, que devolve void no
 *    node:sqlite. O resultado nunca era conferido e um arquivo invalido
 *    substituia o banco de boa.
 * 2. Quando o passo de alinhar o schema falhava, o banco antigo ja tinha sido
 *    removido e nao havia rollback: o sistema ficava sem banco.
 *
 * Os testes injetam um `npx` falso na frente do PATH para decidir se o passo
 * de alinhar o schema deve ter sucesso ou falhar.
 */

let workDir: string;
let dbFile: string;
let backupDir: string;
let originalPath: string | undefined;

function createDb(path: string, marker: string): void {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS marker (value TEXT NOT NULL)');
  db.prepare('DELETE FROM marker').run();
  db.prepare('INSERT INTO marker (value) VALUES (?)').run(marker);
  db.close();
}

function readMarker(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM marker').get() as { value: string } | undefined;
    return row?.value ?? '';
  } finally {
    db.close();
  }
}

/** Instala um `npx` falso que "sempre" ou "nunca" alinha o schema. */
async function stubNpx(succeeds: boolean): Promise<void> {
  const script = process.platform === 'win32'
    ? succeeds
      ? '@echo off\r\necho Your database is now in sync with your Prisma schema.\r\n'
      : '@echo off\r\necho schema push failed 1>&2\r\nexit /b 1\r\n'
    : succeeds
      ? '#!/bin/sh\necho "Your database is now in sync with your Prisma schema."\n'
      : '#!/bin/sh\necho "schema push failed" >&2\nexit 1\n';

  const binDir = join(workDir, 'fakebin');
  // `shell: true` faz o spawn passar por cmd.exe, que resolve npx.cmd pelo
  // PATH. Sem o sufixo .cmd o stub nunca e encontrado no Windows.
  const target = join(binDir, process.platform === 'win32' ? 'npx.cmd' : 'npx');
  await mkdir(binDir, { recursive: true });
  await writeFile(target, script);
  if (process.platform !== 'win32') {
    await chmod(target, 0o755);
  }
  process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'restore-test-'));
  // `backupsDirFor` sobe tres niveis a partir do .db (prisma -> api -> apps ->
  // raiz), e `alignSchema` roda o npx com cwd em apps/api. O layout abaixo
  // reproduz o mesmo, senao os testes medem um caminho que o sistema nao usa.
  dbFile = join(workDir, 'apps', 'api', 'prisma', 'dev.db');
  backupDir = join(workDir, 'backups');
  await mkdir(join(workDir, 'apps', 'api', 'prisma'), { recursive: true });
  await mkdir(backupDir, { recursive: true });
  createDb(dbFile, 'atual');
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(workDir, { recursive: true, force: true });
});

describe('applyPendingRestoreIfExists', () => {
  it('nao faz nada quando nao existe restore pendente', async () => {
    await stubNpx(true);
    const outcome = await applyPendingRestoreIfExists(dbFile, workDir);
    expect(outcome.applied).toBe(false);
    expect(outcome.fileName).toBeUndefined();
    expect(readMarker(dbFile)).toBe('atual');
  });

  it('substitui o banco e remove o arquivo pendente quando tudo da certo', async () => {
    await stubNpx(true);
    const pending = join(backupDir, 'webdist-pending-restore-20260101-000000-aaaaaa.db');
    createDb(pending, 'restaurado');

    const outcome = await applyPendingRestoreIfExists(dbFile, workDir);

    expect(outcome.applied).toBe(true);
    expect(readMarker(dbFile)).toBe('restaurado');
    await expect(stat(pending)).rejects.toThrow();
  });

  it('escolhe o restore pendente mais recente quando ha varios', async () => {
    await stubNpx(true);
    createDb(join(backupDir, 'webdist-pending-restore-20260101-000000-dddddd.db'), 'antigo');
    createDb(join(backupDir, 'webdist-pending-restore-20260101-010101-eeeeee.db'), 'novo');

    await applyPendingRestoreIfExists(dbFile, workDir);

    expect(readMarker(dbFile)).toBe('novo');
  });

  it('ignora arquivos que nao seguem o padrao de restore pendente', async () => {
    await stubNpx(true);
    await writeFile(join(backupDir, 'notas.txt'), 'isso nao e backup');

    const outcome = await applyPendingRestoreIfExists(dbFile, workDir);

    expect(outcome.applied).toBe(false);
    expect(outcome.error).toBeUndefined();
    expect(readMarker(dbFile)).toBe('atual');
  });

  it('recusa arquivo pendente corrompido e preserva o banco atual', async () => {
    await stubNpx(true);
    const pending = join(backupDir, 'webdist-pending-restore-20260101-000000-bbbbbb.db');
    await writeFile(pending, Buffer.from('isto nao e um banco sqlite'));

    const outcome = await applyPendingRestoreIfExists(dbFile, workDir);

    expect(outcome.applied).toBe(false);
    // Node pode recusar o arquivo já na abertura ("file is not a database")
    // ou abrir e falhar no PRAGMA. Os dois caminhos sao aceitavel: o que nao
    // pode acontecer e o banco atual ser substituido.
    expect(outcome.error).toBeTruthy();
    expect(readMarker(dbFile)).toBe('atual');
    // O arquivo recusado fica no disco para o admin investigar.
    expect((await stat(pending)).size).toBeGreaterThan(0);
  });

  it('reverte para o banco anterior quando o schema nao alinha', async () => {
    await stubNpx(false);
    createDb(join(backupDir, 'webdist-pending-restore-20260101-000000-cccccc.db'), 'restaurado');

    const outcome = await applyPendingRestoreIfExists(dbFile, workDir);

    expect(outcome.applied).toBe(false);
    expect(outcome.error).toMatch(/rollback/);
    // Um restore que deixa o sistema sem banco e pior do que um restore
    // que nao acontece.
    expect(readMarker(dbFile)).toBe('atual');
  });

  it('nao deixa arquivos de rollback acumulados', async () => {
    await stubNpx(true);
    createDb(join(backupDir, 'webdist-pending-restore-20260101-000000-111111.db'), 'restaurado');
    await applyPendingRestoreIfExists(dbFile, workDir);
    expect((await readdir(backupDir)).filter((n) => n.includes('rollback'))).toHaveLength(0);

    await stubNpx(false);
    createDb(join(backupDir, 'webdist-pending-restore-20260101-000001-222222.db'), 'outro');
    await applyPendingRestoreIfExists(dbFile, workDir);
    expect((await readdir(backupDir)).filter((n) => n.includes('rollback'))).toHaveLength(0);
  });

  it('nao deixa vestigios de -wal e -shm do banco antigo', async () => {
    await stubNpx(true);
    createDb(join(backupDir, 'webdist-pending-restore-20260101-000000-333333.db'), 'restaurado');
    await writeFile(`${dbFile}-wal`, Buffer.from('wal antigo'));
    await writeFile(`${dbFile}-shm`, Buffer.from('shm antigo'));

    await applyPendingRestoreIfExists(dbFile, workDir);

    await expect(stat(`${dbFile}-wal`)).rejects.toThrow();
    await expect(stat(`${dbFile}-shm`)).rejects.toThrow();
  });
});
