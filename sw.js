// Chief Job Agent PWA — conservative scoped service worker.
const CACHE_PREFIX = 'chief-job-static-';
const CACHE_VERSION = `${CACHE_PREFIX}v1`;
const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const shell = suffix => `${scopePath}${suffix}`;
const STATIC_ASSETS = [shell('/'), shell('/index.html'), shell('/styles.css'), shell('/app.js'), shell('/manifest.webmanifest'), shell('/icon.svg')];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION ? caches.delete(key) : false)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Chief API traffic is always network-only. Never cache auth, notifications,
  // applications, decisions, or any other operational API response.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!(url.pathname === scopePath || url.pathname.startsWith(`${scopePath}/`))) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      return (await caches.match(shell('/index.html'))) || new Response('Chief Job Agent offline shell unavailable', { status: 503 });
    }));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      void caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || '' }; }

  const severity = ['URGENT', 'ACTION_REQUIRED', 'INFO'].includes(String(payload.severity || '').toUpperCase())
    ? String(payload.severity).toUpperCase() : 'INFO';
  const title = String(payload.title || 'Chief Job Agent');
  const options = {
    body: String(payload.body || ''),
    tag: payload.id ? `chief-job-${payload.id}` : 'chief-job-event',
    renotify: severity === 'URGENT',
    requireInteraction: severity === 'URGENT',
    data: {
      url: shell('/'),
      notificationId: payload.id ?? null,
      severity
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || shell('/'), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) void client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
