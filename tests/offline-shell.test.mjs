import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareOfflineShell } from '../scripts/prepare-offline-shell.mjs';

test('offline shell pins real bundle identity and only same-scope static assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'chief-shell-'));
  const template = "const BUILD_ID = 'development';\nconst BUILD_ASSETS = [];";
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<script src="/staff/assets/main.js"></script>');
    writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({scope:'/staff/'}));
    writeFileSync(join(root, 'assets/main.js'), 'first');
    writeFileSync(join(root, 'sw.js'), template);
    const first = prepareOfflineShell(root);
    assert.match(readFileSync(join(root, 'sw.js'), 'utf8'), /\/staff\/assets\/main.js/);
    writeFileSync(join(root, 'assets/main.js'), 'changed');
    writeFileSync(join(root, 'sw.js'), template);
    assert.notEqual(prepareOfflineShell(root).id, first.id);
    writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({scope:'/api/'}));
    assert.throws(() => prepareOfflineShell(root), /scope/);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
