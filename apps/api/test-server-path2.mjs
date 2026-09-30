import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const currentFile = fileURLToPath(import.meta.url);
let root = resolve(dirname(currentFile), '../../../..');
console.log('root:', root);

try {
  const content = readFileSync(join(root, '.env'), 'utf8');
  const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  let url = 'file:./dev.db';
  if (match?.[1]) url = match[1].trim();
  console.log('url:', url);
  
  const resolvedPath = resolve(root, 'apps', 'api', 'prisma', url.slice('file:'.length));
  console.log('resolved path:', resolvedPath);
} catch (e) {
  console.log('error:', e.message);
}