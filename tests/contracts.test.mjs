import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const registration = await readFile(new URL('../src/serviceWorker.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('client uses live sanitized Chief contracts rather than raw job-state or mock data', () => {
  assert.match(api, /\/api\/ui\/job-feed/);
  assert.doesNotMatch(api, /\/api\/ui\/job-state/);
  assert.match(api, /\/api\/notifications\?agent=jobs&sort=newest/);
  assert.match(api, /\/api\/notification-preferences/);
  assert.match(api, /\/api\/notifications\/push-subscription/);
  assert.match(api, /\/api\/notifications\/push-unsubscribe/);
  assert.doesNotMatch(api, /mock|fixture/i);
});

test('recent activity renders only the sanitized feed projection', () => {
  assert.match(app, /chiefApi\.jobFeed\(\)/);
  assert.match(app, /activity\?\.events/);
  assert.match(app, /item\.summary/);
  assert.match(app, /activity\?\.job_counts\.actions/);
  assert.match(app, /activity\?\.job_counts\.applications/);
  assert.doesNotMatch(app, /state\?\.commands/);
  assert.doesNotMatch(app, /command\.instruction|command\.result/);
  assert.doesNotMatch(app, /chiefApi\.jobState/);
});

test('job login refuses and revokes a session created for an unsupported role', () => {
  assert.match(app, /await chiefApi\.login/);
  assert.match(app, /!\['Owner', 'Administrator'\]\.includes\(active\.principal\.role\)/);
  assert.match(app, /await chiefApi\.logout\(active\.csrf\)/);
  assert.match(app, /clearPrivateView\(\)/);
});

test('private view is cleared on auth denial and account/session change', () => {
  assert.match(app, /const clearPrivateView = useCallback/);
  assert.match(app, /active\.principal\.id !== session\.principal\.id/);
  assert.match(app, /active\.principal\.session_id !== session\.principal\.session_id/);
  assert.match(app, /\[401, 403\]\.includes\(cause\.status\)/);
});

test('after-timeout notification consent remains distinct from signed-in access', () => {
  assert.match(app, /registerJobPush\(subscription\.toJSON\(\), session\.csrf, true\)/);
  assert.match(app, /pushStatus\.after_timeout/);
  assert.match(app, /does not keep you signed in/);
  assert.match(app, /Sign in to view private details/);
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
  assert.match(worker, /target\.pathname === SCOPE_PATH/);
  assert.match(worker, /requireInteraction:\s*severity === 'URGENT'/);
});

test('foreground polling only elevates ASK and STOP equivalents and avoids duplicate background alerts', () => {
  assert.match(app, /if \(!backgroundPushConnected\)/);
  assert.match(app, /item\.severity === 'ACTION_REQUIRED' \|\| item\.severity === 'URGENT'/);
  assert.match(app, /chief-job-\$\{item\.id\}/);
  assert.match(app, /requireInteraction:\s*item\.severity === 'URGENT'/);
});

test('browser persistence is limited to an identity-scoped notification cursor', () => {
  assert.match(app, /function lastSeenStorageKey\(principalId: string\)/);
  assert.match(app, /lastSeenStorageKey\(session\.principal\.id\)/);
  assert.match(app, /localStorage\.getItem\(storageKey\)/);
  assert.match(app, /localStorage\.setItem\(storageKey, String\(/);
  assert.doesNotMatch(app, /sessionStorage/);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\([^)]*(?:csrf|password|session|body|title)/i);
});

test('PWA is scoped to the Job Agent path', () => {
  assert.equal(manifest.id, '/jobs/');
  assert.equal(manifest.scope, '/jobs/');
  assert.equal(manifest.start_url, '/jobs/');
  assert.match(registration, /EXPECTED_BASE = '\/jobs\/'/);
  assert.match(vite, /base: '\/jobs\/'/);
});
