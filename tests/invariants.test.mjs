import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('timeline consumes only the dedicated Jobs-authorized event feed', async () => {
  const app = await read('app.js');
  assert.match(app, /\/api\/job-push\/events/);
  assert.doesNotMatch(app, /\/api\/notifications\?agent=/);
  assert.doesNotMatch(app, /JOB_OPPORTUNITIES|fixture|mock/i);
});

test('service worker never caches Chief API traffic', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /event\.respondWith\(fetch\(request\)\)/);
});

test('service worker has explicit push and notification click handlers', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /requireInteraction: severity === 'URGENT'/);
});

test('client notification policy only foreground-alerts ASK/URGENT equivalents', async () => {
  const app = await read('app.js');
  assert.match(app, /\['URGENT', 'ACTION_REQUIRED'\]\.includes/);
  assert.match(app, /!state\.backgroundPushActive/);
});

test('background push registration uses Chief auth session and in-memory CSRF', async () => {
  const app = await read('app.js');
  assert.match(app, /\/api\/auth\/session/);
  assert.match(app, /\/api\/job-push\/config/);
  assert.match(app, /pushManager\.subscribe/);
  assert.match(app, /\/api\/job-push\/subscribe/);
  assert.match(app, /X-Chief-CSRF/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});

test('manifest is scoped to the Job Agent app', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Chief Job Agent');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
});
