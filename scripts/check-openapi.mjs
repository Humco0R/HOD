import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';

const routeFiles = [
  'apps/backend/src/app.ts',
  'apps/backend/src/transport/http/health.routes.ts',
  'apps/backend/src/transport/http/miniapp-api.routes.ts',
];
const routePattern = /\bapp\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g;
const implementation = new Set();

for (const file of routeFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(routePattern)) {
    const path = match[2].replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
    implementation.add(`${match[1].toUpperCase()} ${path}`);
  }
}

const specification = new Set();
const openapi = await readFile('openapi.yaml', 'utf8');
let currentPath;
for (const line of openapi.split(/\r?\n/)) {
  const path = /^ {2}(\/[^:]*?(?:\{[^}]+\}[^:]*)?):\s*$/.exec(line);
  if (path) {
    currentPath = path[1];
    continue;
  }
  const method = /^ {4}(get|post|patch|delete):\s*$/.exec(line);
  if (currentPath && method) specification.add(`${method[1].toUpperCase()} ${currentPath}`);
}

const missing = [...implementation].filter((route) => !specification.has(route));
const stale = [...specification].filter((route) => !implementation.has(route));
if (missing.length || stale.length) {
  throw new Error(
    `OpenAPI route mismatch\nMissing: ${missing.join(', ') || 'none'}\nStale: ${stale.join(', ') || 'none'}`,
  );
}

stdout.write(`OpenAPI matches ${implementation.size} public HTTP routes.\n`);
