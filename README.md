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

The PWA supports two layers:

1. **Foreground alerts** — while the PWA is open, it polls the existing Chief Job notification feed and raises browser notifications for newly-arrived `ACTION_REQUIRED` and `URGENT` records.
2. **Background Web Push receiver** — the service worker already handles the standards-based `push` event and notification clicks. A Chief backend push-subscription endpoint/VAPID delivery channel is still required before closed-app background delivery can be called live.

The UI states that distinction explicitly; permission being granted is not presented as proof that background push is connected.

## Backend contracts used

- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/ui/job-state`
- `GET /api/notifications?agent=jobs&sort=newest`

Production base path: `/jobs/`.
