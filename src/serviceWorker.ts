const EXPECTED_BASE = '/jobs/';

export function registerJobServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (import.meta.env.BASE_URL !== EXPECTED_BASE) {
    console.warn('[Job Agent] Service worker registration refused: production base path mismatch.');
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${EXPECTED_BASE}sw.js`, { scope: EXPECTED_BASE })
      .catch(() => console.warn('[Job Agent] Service worker registration failed.'));
  });
}

export async function showForegroundNotification(title: string, options: NotificationOptions): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration(EXPECTED_BASE);
  if (!registration) return false;
  await registration.showNotification(title, options);
  return true;
}
