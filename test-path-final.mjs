import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const currentFile = fileURLToPath(import.meta.url);
console.log('currentFile:', currentFile);
const currentDir = dirname(currentFile);
console.log('currentDir:', currentDir);

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
    console.log('trying parent:', root);
  }
}
console.log('final root:', root);