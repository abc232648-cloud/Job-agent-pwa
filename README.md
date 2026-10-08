# Chief Job Agent PWA

Private notification-first companion for the Chief Job Agent.

## Scope

This client is deliberately small:

- show Job Agent notifications and recent structured activity;
- surface ASK/action-required events prominently;
- surface BLOCK events as urgent STOP-style alerts;
- remain read-mostly and keep all job-search, ranking, scam screening, application and policy logic in Chief;
- never cache `/api/` responses in the service worker.

## Notification delivery

The PWA supports two complementary layers:

1. **Background Web Push** — when Chief VAPID is configured, the installed PWA creates a standards-based browser push subscription, registers it with Chief through the authenticated notification API, and receives `ACTION_REQUIRED` / `URGENT` alerts through the scoped `/jobs/` service worker even when the PWA is not open.
2. **Foreground fallback** — when this device does not have background push connected, the open PWA polls the existing Chief Job notification feed every 15 seconds and raises browser notifications for newly-arrived attention events.

Once background push is connected on this device, foreground polling still refreshes the timeline but does not emit a second browser notification for the same event.

The UI reports **Background connected** only after a browser `PushSubscription` exists and Chief accepts that subscription. Browser permission alone is not treated as proof of background delivery.

## Backend contracts used

- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/ui/job-state`
- `GET /api/notifications?agent=jobs&sort=newest`
- `GET /api/notification-preferences` for Web Push readiness/public VAPID key
- `POST /api/notifications/push-subscription`
- `POST /api/notifications/push-unsubscribe`

Production base path: `/jobs/`.

## Security boundaries

- all Chief API calls are same-origin and `credentials: include`;
- Web Push registration mutations include the current `X-Chief-CSRF` token;
- the service worker is scoped to `/jobs/` and never caches `/api/` responses;
- notification click targets are constrained to the same origin and `/jobs/` scope;
- private subscription endpoint/key material remains in Chief and is not displayed by this client.
