import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('client uses live Chief job contracts rather than mock data', () => {
  assert.match(app, /\/api\/ui\/job-state/);
  assert.match(app, /\/api\/notifications\?agent=jobs&sort=newest/);
  assert.doesNotMatch(app, /mock|fixture/i);
});

test('service worker never caches Chief API responses', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /event\.respondWith\(fetch\(request\)\)/);
});

test('service worker supports background push reception and safe click routing', () => {
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /target\.origin !== SCOPE_URL\.origin/);
});

test('PWA is scoped to the Job Agent path', () => {
  assert.equal(manifest.scope, '/jobs/');
  assert.equal(manifest.start_url, '/jobs/');
  assert.match(vite, /base: '\/jobs\/'/);
});
