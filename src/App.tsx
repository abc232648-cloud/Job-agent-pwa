import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ChiefApiError, chiefApi } from './api';
import { currentPushSubscription, ensurePushSubscription, removeLocalPushSubscription, showForegroundNotification } from './serviceWorker';
import type { ChiefSession, JobActivityFeed, JobNotification, JobPushStatus } from './types';

const POLL_MS = 15_000;
const LAST_SEEN_KEY = 'chief.jobs.last-notification-id';
const NO_PUSH: JobPushStatus = { configured: false, public_key: '', subscribed: false, subscription_count: 0 };

function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function lastSeenStorageKey(principalId: string): string {
  return `${LAST_SEEN_KEY}.${encodeURIComponent(principalId)}`;
}

function asTime(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eventLabel(source: string, severity: string): string {
  if (severity === 'URGENT') return 'STOP / urgent';
  if (severity === 'ACTION_REQUIRED') return 'ASK / action required';
  if (source === 'command') return 'worker command';
  if (source === 'application') return 'application';
  return 'info';
}

export default function App() {
  const [session, setSession] = useState<ChiefSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [activity, setActivity] = useState<JobActivityFeed | null>(null);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const [permission, setPermission] = useState(notificationPermission());
  const [pushStatus, setPushStatus] = useState<JobPushStatus>(NO_PUSH);
  const [backgroundPushConnected, setBackgroundPushConnected] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const initializedFeed = useRef(false);

  const clearPrivateView = useCallback(() => {
    setSession(null);
    setActivity(null);
    setNotifications([]);
    setPushStatus(NO_PUSH);
    setBackgroundPushConnected(false);
    initializedFeed.current = false;
  }, []);

  const refresh = useCallback(async (announce = true) => {
    if (!session) return;
    setRefreshing(true);
    try {
      const active = await chiefApi.session();
      if (!['Owner', 'Administrator'].includes(active.principal.role)) {
        clearPrivateView();
        throw new ChiefApiError(403, 'Owner or Administrator access is required.');
      }
      if (active.principal.id !== session.principal.id || active.principal.session_id !== session.principal.session_id || active.csrf !== session.csrf) {
        setActivity(null); setNotifications([]); setPushStatus(NO_PUSH); setBackgroundPushConnected(false);
        initializedFeed.current = false;
        setSession(active);
        return;
      }
      const [nextActivity, nextNotifications] = await Promise.all([chiefApi.jobFeed(), chiefApi.jobNotifications()]);
      setActivity(nextActivity);
      setNotifications(nextNotifications);
      setError('');

      const maxId = nextNotifications.reduce((max, item) => Math.max(max, item.id), 0);
      const storageKey = lastSeenStorageKey(session.principal.id);
      const stored = Number(localStorage.getItem(storageKey) || '0');
      if (!initializedFeed.current) {
        initializedFeed.current = true;
        localStorage.setItem(storageKey, String(Math.max(stored, maxId)));
      } else if (announce && maxId > stored) {
        if (!backgroundPushConnected) {
          const newAttention = nextNotifications
            .filter((item) => item.id > stored && (item.severity === 'ACTION_REQUIRED' || item.severity === 'URGENT'))
            .sort((a, b) => a.id - b.id);
          for (const item of newAttention) {
            await showForegroundNotification('Chief update', {
              body: 'Sign in to view your update.',
              tag: `chief-job-${item.id}`,
              data: { url: '/jobs/', severity: item.severity },
              requireInteraction: item.severity === 'URGENT'
            });
          }
        }
        localStorage.setItem(storageKey, String(maxId));
      }
    } catch (cause) {
      if (cause instanceof ChiefApiError && [401, 403].includes(cause.status)) {
        clearPrivateView();
      }
      setError(cause instanceof Error ? cause.message : 'Unable to refresh Job Agent data.');
    } finally {
      setRefreshing(false);
    }
  }, [session, backgroundPushConnected, clearPrivateView]);

  const reconcilePush = useCallback(async () => {
    if (!session) return;
    try {
      const prefs = await chiefApi.notificationPreferences();
      const status = prefs.job_push ?? NO_PUSH;
      setPushStatus(status);
      if (!status.configured || permission !== 'granted') {
        setBackgroundPushConnected(false);
        return;
      }
      const existing = await currentPushSubscription();
      if (!existing) {
        setBackgroundPushConnected(false);
        return;
      }
      const result = await chiefApi.registerJobPush(existing.toJSON(), session.csrf);
      setPushStatus({ ...status, subscribed: true, after_timeout: result.after_timeout, subscription_count: result.subscription_count });
      setBackgroundPushConnected(true);
    } catch (cause) {
      setBackgroundPushConnected(false);
      if (!(cause instanceof ChiefApiError && cause.status === 403)) {
        setError(cause instanceof Error ? cause.message : 'Unable to reconcile background notifications.');
      }
    }
  }, [session, permission]);

  useEffect(() => {
    void chiefApi.session().then((value) => {
      if (['Owner', 'Administrator'].includes(value.principal.role)) setSession(value);
      else { clearPrivateView(); setError('Owner or Administrator access is required.'); }
    }).catch(() => clearPrivateView()).finally(() => setAuthChecked(true));
  }, [clearPrivateView]);

  useEffect(() => {
    if (!session) return;
    initializedFeed.current = false;
    void refresh(false);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  useEffect(() => {
    if (session) void reconcilePush();
  }, [session, reconcilePush]);

  const items = activity?.events ?? [];
  const urgent = notifications.filter((item) => item.read === 0 && item.severity === 'URGENT').length;
  const actionRequired = notifications.filter((item) => item.read === 0 && item.severity === 'ACTION_REQUIRED').length;

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await chiefApi.login(username.trim(), password);
      const active = await chiefApi.session();
      if (!['Owner', 'Administrator'].includes(active.principal.role)) {
        try { await chiefApi.logout(active.csrf); } catch { /* The role is still refused locally; server expiry remains authoritative. */ }
        clearPrivateView();
        setPassword('');
        setError('This Job Agent oversight PWA requires an Owner or Administrator identity.');
        return;
      }
      setSession(active);
      setPassword('');
    } catch (cause) {
      clearPrivateView();
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    }
  }

  async function signOut() {
    if (!session) return;
    try { await chiefApi.logout(session.csrf); } catch { setError('Sign-out could not be confirmed. Please retry.'); return; }
    clearPrivateView();
  }

  async function enableNotifications() {
    if (!session || !('Notification' in window)) return;
    setNotificationBusy(true);
    setError('');
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setBackgroundPushConnected(false);
        return;
      }
      const prefs = await chiefApi.notificationPreferences();
      const status = prefs.job_push ?? NO_PUSH;
      setPushStatus(status);
      if (!status.configured) return;
      const subscription = await ensurePushSubscription(status.public_key);
      const registered = await chiefApi.registerJobPush(subscription.toJSON(), session.csrf, true);
      setPushStatus({ ...status, subscribed: true, after_timeout: registered.after_timeout, subscription_count: registered.subscription_count });
      setBackgroundPushConnected(true);
    } catch (cause) {
      setBackgroundPushConnected(false);
      setError(cause instanceof Error ? cause.message : 'Unable to enable notifications.');
    } finally {
      setNotificationBusy(false);
    }
  }

  async function disableBackgroundPush() {
    if (!session) return;
    setNotificationBusy(true);
    setError('');
    try {
      const current = await currentPushSubscription();
      if (current) {
        await chiefApi.unregisterJobPush(current.endpoint, session.csrf);
        await removeLocalPushSubscription();
      }
      setBackgroundPushConnected(false);
      setPushStatus((value) => ({ ...value, subscribed: false, subscription_count: Math.max(0, value.subscription_count - (current ? 1 : 0)) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disable background notifications.');
    } finally {
      setNotificationBusy(false);
    }
  }

  if (!authChecked) return <main className="center"><p>Connecting to Chief…</p></main>;

  if (!session) {
    return <main className="center">
      <form className="login panel" onSubmit={signIn}>
        <div className="brand">CHIEF / JOB AGENT</div>
        <h1>Private oversight</h1>
        <p className="muted">Owner/Admin notifications and recent Job Agent activity. Chief remains authoritative.</p>
        <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit">Sign in</button>
      </form>
    </main>;
  }

  const deliveryText = backgroundPushConnected
    ? pushStatus.after_timeout
      ? 'Generic ASK/STOP alerts may continue after Chief idle timeout under this device consent. Sign in to view private details.'
      : 'Background Web Push is connected only while the current Chief session remains valid.'
    : permission === 'granted' && !pushStatus.configured
      ? 'Foreground alerts work while this PWA is open. Chief background Web Push is not configured yet.'
      : permission === 'granted'
        ? 'Notification permission is granted. Connect this device to enable closed-app ASK and STOP alerts.'
        : 'Enable alerts to receive important Job Agent decisions. Background delivery is used when Chief Web Push is configured.';

  return <main className="shell">
    <header>
      <div><div className="brand">CHIEF / JOB AGENT</div><h1>Notifications</h1></div>
      <div className="headerActions"><button className="secondary" onClick={() => void refresh(false)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button><button className="secondary" onClick={() => void signOut()}>Sign out</button></div>
    </header>

    {error && <div className="error" role="alert">{error}</div>}

    <section className="notice panel">
      <div><strong>Notification delivery</strong><p className="muted">{deliveryText}</p></div>
      {backgroundPushConnected && <button className="secondary" disabled={notificationBusy} onClick={() => void disableBackgroundPush()}>{notificationBusy ? 'Updating…' : 'Disable background'}</button>}
      <p>Explicit after-timeout device consent does not keep you signed in. Sign-out, account switching, access changes, or disabling Job access stops delivery.</p>
      {(!backgroundPushConnected || !pushStatus.after_timeout) && permission !== 'denied' && permission !== 'unsupported' && <button disabled={notificationBusy} onClick={() => void enableNotifications()}>{notificationBusy ? 'Connecting…' : permission === 'granted' && pushStatus.configured ? 'Keep alerts after timeout' : 'Enable alerts'}</button>}
      {permission === 'denied' && <span className="pill danger">Blocked in browser</span>}
      {permission === 'unsupported' && <span className="pill">Unsupported</span>}
      {backgroundPushConnected && <span className="pill ok">Background connected</span>}
    </section>

    <section className="stats" aria-label="Job Agent status">
      <article className="panel"><span>Urgent</span><strong>{urgent}</strong><small>unread STOP-style alerts</small></article>
      <article className="panel"><span>Needs you</span><strong>{actionRequired}</strong><small>unread ASK alerts</small></article>
      <article className="panel"><span>Pending actions</span><strong>{activity?.job_counts.actions ?? '—'}</strong><small>Chief action queue</small></article>
      <article className="panel"><span>Applications</span><strong>{activity?.job_counts.applications ?? '—'}</strong><small>recorded by Chief</small></article>
    </section>

    <section className="timeline panel">
      <div className="sectionHead"><div><h2>Recent activity</h2><p className="muted">Safe structured events, not raw server logs.</p></div><span className="pill">15s live refresh</span></div>
      {items.length === 0 ? <p className="empty">No recent Job Agent activity.</p> : <ol>
        {items.map((item) => <li key={item.id} className={`event ${item.severity.toLowerCase()}`}>
          <div className="eventMark" aria-hidden="true" />
          <div className="eventBody"><div className="eventTop"><strong>{item.title}</strong><time>{asTime(item.occurred_at)}</time></div><p>{item.summary}</p><div className="eventMeta"><span>{eventLabel(item.source, item.severity)}</span>{item.unread && <span>unread</span>}</div></div>
        </li>)}
      </ol>}
    </section>

    <footer>Signed in as {session.principal.role}. AUTO/ALLOW activity stays quiet unless Chief records it; ASK and BLOCK/STOP are elevated.</footer>
  </main>;
}
