# PWA Installability Impact Analysis

Date: 2026-08-28

## Status

DONE.

This is the final non-blocked roadmap item: P4.2 PWA/installability. Apple
Health and Android Health Connect remain blocked in this environment because
they require native mobile tooling and real platform verification.

## Current State

- `frontend/web/public` has no manifest or service worker.
- `vite.config.ts` has no PWA plugin setup.
- `index.html` still references `/favicon.svg`, but that file is absent in
  the current working tree.
- P1.7 active-workout offline resilience already provides an IndexedDB-backed
  durable mutation queue for active-session set complete/undo events, but a
  full offline reload still needs a service worker shell.

## Scope

Implement a conservative, dependency-free PWA layer for `frontend/web`:

- web app manifest;
- installable icons and favicon;
- production-only service-worker registration;
- offline navigation shell;
- runtime asset caching for same-origin static assets;
- explicit update UX so users are not silently trapped on stale cached app
  code.

## Non-Goals

- Do not cache API responses, auth responses, Socket.IO, or user data.
- Do not claim native Apple Health / Android Health Connect support.
- Do not replace P1.7's IndexedDB mutation queue; this layer only supplies the
  reload/navigation shell and static asset cache it depends on.
- Do not add a PWA dependency unless the existing Vite app requires it.

## Risks

- A service worker can serve stale frontend assets after deployment if updates
  are hidden from the user.
- Aggressive caching of `/api` would risk stale personal data and broken auth.
- Offline shell UX must be honest: it can keep the app shell reachable, but it
  cannot invent fresh server data while offline.

## Design Decision

Use a manual service worker in `public/sw.js` rather than adding
`vite-plugin-pwa`. The app already has a simple Vite build and no generated
PWA scaffold; a small service worker keeps the cache policy inspectable:

- navigation requests use network-first, then cached page, then
  `/offline.html`;
- same-origin static assets use stale-while-revalidate;
- `/api`, `/socket.io`, `/chat-socket.io`, and non-GET requests bypass the
  cache;
- old versioned caches are deleted on activation;
- a waiting worker activates only after the UI sends `SKIP_WAITING`.

## Verification Plan

- Unit-test the pure PWA helper functions with `tsx --test`.
- Run `npm run build` in `frontend/web`.
- Serve the production build locally and verify with a real browser:
  manifest reachable, service worker registers, offline navigation shell
  works, and no API response is cached.

## Implemented

- Added `public/manifest.webmanifest` with standalone display, app shortcuts,
  theme/background colors, SVG icon, and 192/512 PNG maskable icons.
- Replaced the stale `/favicon.svg` reference in `index.html` with the new
  PWA icon and manifest metadata.
- Added `public/sw.js`, a versioned manual service worker with:
  - precached app/offline shell files;
  - network-first app navigation;
  - stale-while-revalidate same-origin static assets;
  - explicit bypass for `/api`, `/socket.io`, `/chat-socket.io`, and non-GET
    requests;
  - old-cache cleanup on activation;
  - `SKIP_WAITING` support only when the UI asks for update activation.
- Added `PwaUpdatePrompt`, mounted once in the root layout beside the existing
  Sonner toaster, so a waiting service worker shows a visible update action
  instead of silently trapping users on stale assets.
- Added pure PWA helper tests for registration eligibility and cache
  boundaries.
- Added Playwright spec `54-pwa-installability.spec.ts` and made the E2E
  config accept `PLAYWRIGHT_BASE_URL` so this spec can run against a local
  production preview instead of the dev server.

## Verified

- `frontend/web`: `npx tsx --test src/app/pwa/__tests__/pwa-registration.utils.test.ts`
  passed 5/5.
- `frontend/web`: `npm run build` passed.
- `frontend/web`: `node --check public/sw.js` passed.
- `frontend/web/dist`: manifest, service worker, offline shell, SVG icon, and
  192/512 PNG icons were present after build.
- `fitnessassistant-playwright-e2e`: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npm run test:e2e -- tests/54-pwa-installability.spec.ts --workers=1`
  passed 1/1 in run `e2e_202608280704534` against a production preview.

## Known Limits

- This does not implement Apple Health or Android Health Connect; those remain
  blocked by the lack of native platform tooling in this environment.
- The service worker intentionally does not cache API data. Offline reload can
  restore the app shell and previously cached static assets, while server data
  still depends on the existing app state, IndexedDB queues, and reconnect
  behavior.
