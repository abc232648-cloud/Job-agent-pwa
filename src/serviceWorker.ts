const EXPECTED_BASE = '/jobs/';

async function scopedRegistration(create = false): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  let registration = await navigator.serviceWorker.getRegistration(EXPECTED_BASE);
  if (!registration && create && import.meta.env.PROD && import.meta.env.BASE_URL === EXPECTED_BASE) {
    registration = await navigator.serviceWorker.register(`${EXPECTED_BASE}sw.js`, { scope: EXPECTED_BASE });
  }
  return registration ?? null;
}

export function registerJobServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (import.meta.env.BASE_URL !== EXPECTED_BASE) {
    console.warn('[Job Agent] Service worker registration refused: production base path mismatch.');
    return;
  }
  window.addEventListener('load', () => {
    void scopedRegistration(true).catch(() => console.warn('[Job Agent] Service worker registration failed.'));
  });
}

function applicationServerKey(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try { binary = atob(padded); } catch { throw new Error('Chief supplied an invalid Web Push public key.'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await scopedRegistration(false);
  if (!registration || !('pushManager' in registration)) return null;
  return registration.pushManager.getSubscription();
}

export async function ensurePushSubscription(publicKey: string): Promise<PushSubscription> {
  if (!('Notification' in window) || Notification.permission !== 'granted') throw new Error('Notification permission is required.');
  const registration = await scopedRegistration(true);
  if (!registration || !('pushManager' in registration)) throw new Error('Background Web Push is not available in this browser.');
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
}

export async function removeLocalPushSubscription(): Promise<string | null> {
  const subscription = await currentPushSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  const removed = await subscription.unsubscribe();
  if (!removed) throw new Error('Browser refused to remove the Web Push subscription.');
  return endpoint;
}

export async function showForegroundNotification(title: string, options: NotificationOptions): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const registration = await scopedRegistration(false);
  if (!registration) return false;
  await registration.showNotification(title, options);
  return true;
}
