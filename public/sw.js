// Chief Job Agent PWA — scoped cache + notification receiver.
const CACHE_PREFIX = 'chief-jobs-static-';
const CACHE_VERSION = `${CACHE_PREFIX}v1`;
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.replace(/\/$/, '');
const shell = (suffix) => `${SCOPE_PATH}${suffix}`;
const STATIC_ASSETS = [shell('/'), shell('/index.html'), shell('/manifest.webmanifest'), shell('/icon.svg')];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_VERSION ? caches.delete(name) : false)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Chief data/auth is always network-only. Never turn stale data into a synthetic success.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/') || request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }
  if (url.origin !== self.location.origin || !(url.pathname === SCOPE_PATH || url.pathname.startsWith(`${SCOPE_PATH}/`))) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(shell('/index.html'))) || new Response('Job Agent shell unavailable offline', { status: 503 })));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      const clone = response.clone();
      void caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
    }
    return response;
  })));
});

function safeTarget(candidate) {
  try {
    const target = new URL(candidate || self.registration.scope, self.registration.scope);
    if (target.origin !== SCOPE_URL.origin) return self.registration.scope;
    if (!(target.pathname === SCOPE_PATH || target.pathname.startsWith(`${SCOPE_PATH}/`))) return self.registration.scope;
    return target.href;
  } catch {
    return self.registration.scope;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const severity = ['INFO', 'ACTION_REQUIRED', 'URGENT'].includes(payload.severity) ? payload.severity : 'INFO';
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.slice(0, 160) : 'Chief Job Agent';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 500) : 'Job Agent activity requires attention.';
  const tag = typeof payload.tag === 'string' ? payload.tag.slice(0, 120) : `job-agent-${Date.now()}`;
  const url = safeTarget(payload.url);

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: shell('/icon.svg'),
    badge: shell('/icon.svg'),
    requireInteraction: severity === 'URGENT',
    data: { url, severity }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === SCOPE_URL.origin && 'focus' in client) {
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  }));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
