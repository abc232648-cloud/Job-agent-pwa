import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareOfflineShell(dist) {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
  const scope = manifest.scope;
  if (!['/owner/', '/staff/', '/jobs/'].includes(scope)) throw new Error('Unexpected PWA scope');
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Build assets must not be symlinks');
      if (entry.isDirectory()) walk(join(directory, entry.name), relative + '/');
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk(join(dist, 'assets'));
  files.sort();
  if (!files.some(name => name.endsWith('.js'))) throw new Error('Missing application bundle');
  const hash = createHash('sha256').update(readFileSync(join(dist, 'index.html')));
  for (const name of files) hash.update(name).update(readFileSync(join(dist, 'assets', name)));
  const id = hash.digest('hex').slice(0, 20);
  const path = join(dist, 'sw.js');
  const worker = readFileSync(path, 'utf8');
  if (!worker.includes("const BUILD_ID = 'development';") || !worker.includes('const BUILD_ASSETS = [];')) {
    throw new Error('Missing service-worker build markers; rebuild before preparing shell');
  }
  const output = worker.replace("const BUILD_ID = 'development';", `const BUILD_ID = '${id}';`)
    .replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(files.map(name => scope + 'assets/' + name))};`);
  writeFileSync(path, output);
  return { id, assets: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Versioned static offline shell:', prepareOfflineShell(resolve('dist')));
}
