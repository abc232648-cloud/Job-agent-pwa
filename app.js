const state = {
  notifications: [],
  seenIds: new Set(),
  firstLoad: true,
  pollingTimer: null,
  backgroundPushActive: false,
  csrf: null
};

const els = {
  connectionBadge: document.querySelector('#connectionBadge'),
  enableNotifications: document.querySelector('#enableNotifications'),
  permissionDot: document.querySelector('#permissionDot'),
  pushStatus: document.querySelector('#pushStatus'),
  refreshButton: document.querySelector('#refreshButton'),
  severityFilter: document.querySelector('#severityFilter'),
  timeline: document.querySelector('#timeline'),
  unreadCount: document.querySelector('#unreadCount'),
  urgentCount: document.querySelector('#urgentCount'),
  eventTemplate: document.querySelector('#eventTemplate')
};

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function backgroundPushSupported() {
  return notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;
}

function formatWhen(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function normalizeSeverity(value) {
  const severity = String(value || 'INFO').toUpperCase();
  return ['URGENT', 'ACTION_REQUIRED', 'INFO'].includes(severity) ? severity : 'INFO';
}

function isUnread(item) {
  return Number(item.read) === 0 || item.read === false;
}

function render() {
  const filter = els.severityFilter.value;
  const rows = state.notifications.filter(item => !filter || normalizeSeverity(item.severity) === filter);
  els.timeline.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.notifications.length ? 'No events match this filter.' : 'No recent Job Agent events.';
    els.timeline.append(empty);
  } else {
    for (const item of rows) {
      const fragment = els.eventTemplate.content.cloneNode(true);
      const row = fragment.querySelector('.event-row');
      const severity = normalizeSeverity(item.severity);
      row.dataset.severity = severity;
      fragment.querySelector('.event-title').textContent = item.title || 'Job Agent event';
      fragment.querySelector('.event-body').textContent = item.body || '';
      const time = fragment.querySelector('.event-time');
      time.textContent = formatWhen(item.created_at);
      if (item.created_at) time.dateTime = item.created_at;

      const meta = fragment.querySelector('.event-meta');
      [severity.replace('_', ' '), isUnread(item) ? 'UNREAD' : 'READ'].forEach(label => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = label;
        meta.append(pill);
      });
      els.timeline.append(fragment);
    }
  }

  els.unreadCount.textContent = String(state.notifications.filter(isUnread).length);
  els.urgentCount.textContent = String(state.notifications.filter(item => normalizeSeverity(item.severity) === 'URGENT').length);
}

function renderFetchError(error) {
  els.connectionBadge.textContent = 'Chief unavailable';
  els.connectionBadge.className = 'badge error';
  if (state.notifications.length) return;
  const failure = document.createElement('div');
  failure.className = 'empty-state error-state';
  failure.textContent = `Unable to load authorized Job Agent events. ${String(error?.message || error)}`;
  els.timeline.replaceChildren(failure);
  els.unreadCount.textContent = '—';
  els.urgentCount.textContent = '—';
}

async function fetchJson(path, options = {}) {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Unsafe Chief API path');
  const { headers: extraHeaders = {}, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...requestOptions,
    headers: { Accept: 'application/json', ...extraHeaders }
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const reason = payload.reason || payload.message || payload.status || `Chief returned ${response.status}`;
    const error = new Error(String(reason));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function chiefSession() {
  const session = await fetchJson('/api/auth/session');
  if (!session?.principal?.domains?.includes('jobs') || typeof session.csrf !== 'string' || !session.csrf) {
    throw new Error('Signed-in Job Agent access is required.');
  }
  state.csrf = session.csrf;
  return session;
}

async function chiefPost(path, body) {
  if (!state.csrf) await chiefSession();
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Chief-CSRF': state.csrf },
    body: JSON.stringify(body)
  });
}

async function fetchJobNotifications({ notifyOnNew = true } = {}) {
  els.refreshButton.disabled = true;
  try {
    const payload = await fetchJson('/api/job-push/events');
    if (!Array.isArray(payload)) throw new Error('Unexpected Job Agent events response');

    const incomingIds = new Set(payload.map(item => String(item.id)));
    if (notifyOnNew && !state.firstLoad && !state.backgroundPushActive && notificationsSupported() && Notification.permission === 'granted') {
      const newAttention = payload.filter(item =>
        !state.seenIds.has(String(item.id)) &&
        ['URGENT', 'ACTION_REQUIRED'].includes(normalizeSeverity(item.severity))
      );
      for (const item of newAttention.slice(0, 3)) await showLocalNotification(item);
    }

    state.notifications = payload.slice(0, 50);
    state.seenIds = incomingIds;
    state.firstLoad = false;
    els.connectionBadge.textContent = 'Chief connected';
    els.connectionBadge.className = 'badge ok';
    render();
  } catch (error) {
    renderFetchError(error);
  } finally {
    els.refreshButton.disabled = false;
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    return null;
  }
}

async function showLocalNotification(item) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const options = {
    body: item.body || '',
    tag: `chief-job-${item.id}`,
    renotify: normalizeSeverity(item.severity) === 'URGENT',
    data: { url: './', notificationId: item.id, severity: normalizeSeverity(item.severity) }
  };
  if (registration) await registration.showNotification(item.title || 'Chief Job Agent', options);
  else new Notification(item.title || 'Chief Job Agent', options);
}

function vapidKeyBytes(value) {
  if (typeof value !== 'string' || !value) throw new Error('Chief Web Push public key is missing.');
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function registerBackgroundPush() {
  if (!backgroundPushSupported()) return { active: false, reason: 'Background Web Push is not supported by this browser.' };
  await chiefSession();
  const config = await fetchJson('/api/job-push/config');
  if (!config?.enabled || typeof config.public_key !== 'string' || !config.public_key) {
    return { active: false, reason: 'Chief background Web Push is not configured yet.' };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(config.public_key)
    });
  }
  await chiefPost('/api/job-push/subscribe', { subscription: subscription.toJSON() });
  state.backgroundPushActive = true;
  return { active: true };
}

function refreshPermissionUI(message = null) {
  if (!notificationsSupported()) {
    els.pushStatus.textContent = 'This browser does not expose the Notification API.';
    els.enableNotifications.disabled = true;
    return;
  }
  const permission = Notification.permission;
  els.permissionDot.className = `status-dot ${permission === 'granted' ? 'on' : permission === 'denied' ? 'denied' : ''}`;
  els.enableNotifications.disabled = permission === 'denied';
  els.enableNotifications.textContent = state.backgroundPushActive
    ? 'Background notifications active'
    : permission === 'granted'
      ? 'Finish notification setup'
      : permission === 'denied'
        ? 'Notifications blocked'
        : 'Enable notifications';
  els.pushStatus.textContent = message || (state.backgroundPushActive
    ? 'Background Web Push is active for Job Agent ASK and URGENT events.'
    : permission === 'granted'
      ? 'Browser permission is enabled. Finish setup to register this device with Chief; foreground ASK/URGENT alerts remain available meanwhile.'
      : permission === 'denied'
        ? 'Notifications are blocked in browser/site settings.'
        : 'Permission is not granted. No notification will be shown without your explicit approval.');
}

async function enableNotifications() {
  if (!notificationsSupported() || Notification.permission === 'denied') return;
  els.enableNotifications.disabled = true;
  try {
    const registration = await registerServiceWorker();
    if (!registration) throw new Error('The Job Agent service worker could not be registered.');
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') {
      refreshPermissionUI();
      return;
    }
    const result = await registerBackgroundPush();
    refreshPermissionUI(result.active ? null : result.reason);
  } catch (error) {
    state.backgroundPushActive = false;
    refreshPermissionUI(`Notification setup is incomplete: ${String(error?.message || error)}`);
  } finally {
    els.enableNotifications.disabled = Notification.permission === 'denied';
  }
}

async function inspectExistingPush() {
  if (!backgroundPushSupported() || !notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    state.backgroundPushActive = Boolean(subscription);
    if (subscription) {
      // Re-registering is idempotent and repairs Chief state after a restore or
      // state-file loss. A failed server sync degrades to foreground alerts.
      await chiefSession();
      await chiefPost('/api/job-push/subscribe', { subscription: subscription.toJSON() });
    }
  } catch {
    state.backgroundPushActive = false;
  }
}

els.enableNotifications.addEventListener('click', enableNotifications);
els.refreshButton.addEventListener('click', () => fetchJobNotifications({ notifyOnNew: false }));
els.severityFilter.addEventListener('change', render);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchJobNotifications({ notifyOnNew: true });
});

await registerServiceWorker();
await inspectExistingPush();
refreshPermissionUI();
await fetchJobNotifications({ notifyOnNew: false });
state.pollingTimer = window.setInterval(() => fetchJobNotifications({ notifyOnNew: true }), 60_000);
