import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
console.log('root:', root);

let url = 'file:./dev.db';
try {
  const content = readFileSync(join(root, '.env'), 'utf8');
  const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (match?.[1]) url = match[1].trim();
  console.log('url from .env:', url);
} catch (e) {
  console.log('error reading .env:', e.message);
}

if (!url.startsWith('file:')) {
  console.log('not file:');
}

const resolvedPath = resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
console.log('resolved path:', resolvedPath);