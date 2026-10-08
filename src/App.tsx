import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChiefApiError, chiefApi } from './api';
import { currentPushSubscription, ensurePushSubscription, removeLocalPushSubscription, showForegroundNotification } from './serviceWorker';
import type { ChiefSession, JobNotification, JobPushStatus, JobState, TimelineItem } from './types';

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

function timeline(notifications: JobNotification[], state: JobState | null): TimelineItem[] {
  const items: TimelineItem[] = notifications.map((item) => ({
    key: `n-${item.id}`,
    at: item.created_at,
    title: item.title,
    detail: item.body,
    severity: item.severity,
    unread: item.read === 0
  }));
  for (const command of state?.commands ?? []) {
    items.push({
      key: `c-${command.id}`,
      at: command.created_at,
      title: `Command ${command.status}`,
      detail: command.result || command.instruction,
      severity: 'COMMAND',
      unread: false
    });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40);
}

export default function App() {
  const [session, setSession] = useState<ChiefSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<JobState | null>(null);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const [permission, setPermission] = useState(notificationPermission());
  const [pushStatus, setPushStatus] = useState<JobPushStatus>(NO_PUSH);
  const [backgroundPushConnected, setBackgroundPushConnected] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const initializedFeed = useRef(false);

  const refresh = useCallback(async (announce = true) => {
    if (!session) return;
    setRefreshing(true);
    try {
      const [nextState, nextNotifications] = await Promise.all([chiefApi.jobState(), chiefApi.jobNotifications()]);
      setState(nextState);
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
            await showForegroundNotification(item.title, {
              body: item.body.slice(0, 500),
              tag: `chief-job-${item.id}`,
              data: { url: '/jobs/', severity: item.severity },
              requireInteraction: item.severity === 'URGENT'
            });
          }
        }
        localStorage.setItem(storageKey, String(maxId));
      }
    } catch (cause) {
      if (cause instanceof ChiefApiError && cause.status === 401) setSession(null);
      setError(cause instanceof Error ? cause.message : 'Unable to refresh Job Agent data.');
    } finally {
      setRefreshing(false);
    }
  }, [session, backgroundPushConnected]);

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
      setPushStatus({ ...status, subscribed: true, subscription_count: result.subscription_count });
      setBackgroundPushConnected(true);
    } catch (cause) {
      setBackgroundPushConnected(false);
      if (!(cause instanceof ChiefApiError && cause.status === 403)) {
        setError(cause instanceof Error ? cause.message : 'Unable to reconcile background notifications.');
      }
    }
  }, [session, permission]);

  useEffect(() => {
    void chiefApi.session().then((value) => setSession(value)).catch(() => setSession(null)).finally(() => setAuthChecked(true));
  }, []);

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

  const items = useMemo(() => timeline(notifications, state), [notifications, state]);
  const urgent = notifications.filter((item) => item.read === 0 && item.severity === 'URGENT').length;
  const actionRequired = notifications.filter((item) => item.read === 0 && item.severity === 'ACTION_REQUIRED').length;

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await chiefApi.login(username.trim(), password);
      const active = await chiefApi.session();
      if (!['Owner', 'Administrator'].includes(active.principal.role)) {
        setError('This Job Agent oversight PWA requires an Owner or Administrator identity.');
        return;
      }
      setSession(active);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    }
  }

  async function signOut() {
    if (!session) return;
    try { await chiefApi.logout(session.csrf); } catch {}
    setSession(null);
    setState(null);
    setNotifications([]);
    setPushStatus(NO_PUSH);
    setBackgroundPushConnected(false);
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
      if (!status.configured) return; // Foreground alerts still work while the PWA is open.
      const subscription = await ensurePushSubscription(status.public_key);
      const registered = await chiefApi.registerJobPush(subscription.toJSON(), session.csrf);
      setPushStatus({ ...status, subscribed: true, subscription_count: registered.subscription_count });
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
    ? 'Background Web Push is connected. ASK and STOP alerts can arrive while this PWA is closed.'
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
      {!backgroundPushConnected && permission !== 'denied' && permission !== 'unsupported' && <button disabled={notificationBusy} onClick={() => void enableNotifications()}>{notificationBusy ? 'Connecting…' : permission === 'granted' && pushStatus.configured ? 'Connect background' : 'Enable alerts'}</button>}
      {permission === 'denied' && <span className="pill danger">Blocked in browser</span>}
      {permission === 'unsupported' && <span className="pill">Unsupported</span>}
      {backgroundPushConnected && <span className="pill ok">Background connected</span>}
    </section>

    <section className="stats" aria-label="Job Agent status">
      <article className="panel"><span>Urgent</span><strong>{urgent}</strong><small>unread STOP-style alerts</small></article>
      <article className="panel"><span>Needs you</span><strong>{actionRequired}</strong><small>unread ASK alerts</small></article>
      <article className="panel"><span>Pending actions</span><strong>{state?.counts.actions ?? '—'}</strong><small>Chief action queue</small></article>
      <article className="panel"><span>Applications</span><strong>{state?.counts.applications ?? '—'}</strong><small>recorded by Chief</small></article>
    </section>

    <section className="timeline panel">
      <div className="sectionHead"><div><h2>Recent activity</h2><p className="muted">Safe structured events, not raw server logs.</p></div><span className="pill">15s live refresh</span></div>
      {items.length === 0 ? <p className="empty">No recent Job Agent activity.</p> : <ol>
        {items.map((item) => <li key={item.key} className={`event ${item.severity.toLowerCase()}`}>
          <div className="eventMark" aria-hidden="true" />
          <div className="eventBody"><div className="eventTop"><strong>{item.title}</strong><time>{asTime(item.at)}</time></div><p>{item.detail}</p><div className="eventMeta"><span>{item.severity === 'URGENT' ? 'STOP / urgent' : item.severity === 'ACTION_REQUIRED' ? 'ASK / action required' : item.severity === 'COMMAND' ? 'worker command' : 'info'}</span>{item.unread && <span>unread</span>}</div></div>
        </li>)}
      </ol>}
    </section>

    <footer>Signed in as {session.principal.role}. AUTO/ALLOW activity stays quiet unless Chief records it; ASK and BLOCK/STOP are elevated.</footer>
  </main>;
}
