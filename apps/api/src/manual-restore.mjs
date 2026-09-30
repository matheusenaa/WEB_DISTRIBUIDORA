import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

let root = currentDir;
for (let i = 0; i < 10; i++) {
  try {
    readFileSync(join(root, '.env'), 'utf8');
    console.log('found .env at:', root);
    break;
  } catch {
    const parent = resolve(root, '..');
    if (parent === root) break;
    root = parent;
  }
}
console.log('final root:', root);

const dbFile = resolve(root, 'apps', 'api', 'prisma', 'dev.db');
console.log('dbFile:', dbFile);

const backupDir = join(dirname(dbFile), '..', '..', 'backups');
console.log('backupDir:', backupDir);

const files = readdirSync(backupDir);
const pendingFile = files
  .filter((name) => /^webdist-pending-restore-\d{8}-\d{6}\.db$/.test(name))
  .sort()
  .pop();

if (!pendingFile) {
  console.log('No pending restore file found');
  process.exit(0);
}

const pendingPath = join(backupDir, pendingFile);
console.log('pending restore file:', pendingFile);

// Validate integrity
const testDb = new DatabaseSync(pendingPath, { readOnly: true });
try {
  testDb.exec('PRAGMA integrity_check');
  console.log('integrity check passed');
} finally {
  testDb.close();
}

// Remove WAL/SHM
rmSync(join(dbFile, '-wal'), { force: true });
rmSync(join(dbFile, '-shm'), { force: true });

// Remove current db
rmSync(dbFile, { force: true });
rmSync(join(dbFile, '-wal'), { force: true });
rmSync(join(dbFile, '-shm'), { force: true });

// Move pending to db
renameSync(pendingPath, dbFile);
console.log('Restore applied successfully!');