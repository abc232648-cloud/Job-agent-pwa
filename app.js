const state = {
  notifications: [],
  seenIds: new Set(),
  firstLoad: true,
  pollingTimer: null
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
  failure.textContent = `Unable to load authoritative Job Agent events. ${String(error?.message || error)}`;
  els.timeline.replaceChildren(failure);
  els.unreadCount.textContent = '—';
  els.urgentCount.textContent = '—';
}

async function fetchJobNotifications({ notifyOnNew = true } = {}) {
  els.refreshButton.disabled = true;
  try {
    const response = await fetch('/api/notifications?agent=jobs&sort=newest', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Chief returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Unexpected notifications response');

    const incomingIds = new Set(payload.map(item => String(item.id)));
    if (notifyOnNew && !state.firstLoad && notificationsSupported() && Notification.permission === 'granted') {
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

function refreshPermissionUI() {
  if (!notificationsSupported()) {
    els.pushStatus.textContent = 'This browser does not expose the Notification API.';
    els.enableNotifications.disabled = true;
    return;
  }
  const permission = Notification.permission;
  els.permissionDot.className = `status-dot ${permission === 'granted' ? 'on' : permission === 'denied' ? 'denied' : ''}`;
  els.enableNotifications.disabled = permission === 'denied';
  els.enableNotifications.textContent = permission === 'granted' ? 'Notifications enabled' : permission === 'denied' ? 'Notifications blocked' : 'Enable notifications';
  els.pushStatus.textContent = permission === 'granted'
    ? 'Browser permission is enabled. While this PWA is open, new ASK/URGENT Chief events can alert you. Background Web Push delivery remains inactive until Chief exposes a push subscription endpoint.'
    : permission === 'denied'
      ? 'Notifications are blocked in browser/site settings.'
      : 'Permission is not granted. No notification will be shown without your explicit approval.';
}

async function enableNotifications() {
  if (!notificationsSupported() || Notification.permission === 'denied') return;
  await registerServiceWorker();
  if (Notification.permission === 'default') await Notification.requestPermission();
  refreshPermissionUI();
}

els.enableNotifications.addEventListener('click', enableNotifications);
els.refreshButton.addEventListener('click', () => fetchJobNotifications({ notifyOnNew: false }));
els.severityFilter.addEventListener('change', render);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchJobNotifications({ notifyOnNew: true });
});

await registerServiceWorker();
refreshPermissionUI();
await fetchJobNotifications({ notifyOnNew: false });
state.pollingTimer = window.setInterval(() => fetchJobNotifications({ notifyOnNew: true }), 60_000);
