import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const registration = await readFile(new URL('../src/serviceWorker.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('client uses live Chief job contracts rather than mock data', () => {
  assert.match(api, /\/api\/ui\/job-state/);
  assert.match(api, /\/api\/notifications\?agent=jobs&sort=newest/);
  assert.match(api, /\/api\/notification-preferences/);
  assert.match(api, /\/api\/notifications\/push-subscription/);
  assert.match(api, /\/api\/notifications\/push-unsubscribe/);
  assert.doesNotMatch(api, /mock|fixture/i);
});

test('service worker never caches Chief API responses', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /event\.respondWith\(fetch\(request\)\)/);
});

test('browser registration creates a real standards-based push subscription', () => {
  assert.match(registration, /pushManager\.getSubscription/);
  assert.match(registration, /pushManager\.subscribe/);
  assert.match(registration, /userVisibleOnly:\s*true/);
  assert.match(registration, /applicationServerKey/);
});

test('service worker supports background push reception and safe click routing', () => {
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /target\.origin !== SCOPE_URL\.origin/);
});

test('foreground polling does not duplicate a connected background alert', () => {
  assert.match(app, /if \(!backgroundPushConnected\)/);
  assert.match(app, /chief-job-\$\{item\.id\}/);
});

test('PWA is scoped to the Job Agent path', () => {
  assert.equal(manifest.scope, '/jobs/');
  assert.equal(manifest.start_url, '/jobs/');
  assert.match(vite, /base: '\/jobs\/'/);
});
