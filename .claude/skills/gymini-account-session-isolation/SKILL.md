---
name: gymini-account-session-isolation
description: Auth, logout/login/account-switch, React Query cache, and session persistence in Gymini. Load whenever a previous user's data might leak into the next session, or when touching auth/token refresh/Capacitor auth/profile switching.
---

# Gymini Account/Session Isolation

## Core invariant

Account A's data must **never** remain visible after switching to
Account B — on any user-owned surface: Roadmap, Workout, TrainingCycle,
Nutrition, InBody, Profile, PT data, payments, notifications, every
user-owned query.

Backend authorization alone does not guarantee this. The backend can be
100% correct (every request scoped to the authenticated user) while the
**frontend** still shows stale Account-A data for a moment (or
indefinitely) because of cached React Query state that was never
invalidated on switch.

## Required debugging workflow for any reported leakage

1. Reproduce with two real, dedicated accounts (not the same account
   twice).
2. Capture Account A's real resource IDs (roadmapId, programId, etc.).
3. Logout / switch.
4. Login Account B.
5. Inspect the real network requests — which token is attached, which
   IDs come back in the response.
6. Determine: does the **backend** actually return Account A's data for
   Account B's token (a real IDOR — see `gymini-scope-control`'s
   severity table, this is P0), or does the **frontend** display
   correctly-scoped-but-stale cached data from before the switch?
7. Inspect the React Query cache / query keys involved.
8. Inspect the auth store / session store.
9. Inspect `localStorage`/`sessionStorage`.
10. Inspect any in-flight queries that were still running at the moment
    of logout (a slow request resolving AFTER Account B has already
    logged in can paint stale data into a component that hasn't
    re-fetched yet).
11. Inspect WebSocket/context state if the surface uses one (chat,
    realtime notifications).

**Classify explicitly**: `BACKEND IDOR` vs. `FRONTEND STALE CACHE
EXPOSURE`. These need different fixes and different severity — a real
IDOR is P0 regardless of surface; a stale-cache flash is usually P1/P2
depending on how long it persists and what it exposes.

## What correct account-switch semantics require (conceptually)

- Cancel in-flight user-scoped requests before/during switch.
- Invalidate or remove the prior user's query cache (`queryClient.
  clear()` or targeted `removeQueries` for user-scoped keys) — don't
  rely on "the component will unmount and forget."
- Reset user-owned local stores/contexts (auth context, any client-side
  cached profile/roadmap/session state).
- Only then: set the new credentials/session, fetch fresh identity,
  fetch fresh Account B data.
- Query keys should be identity-aware where it matters (e.g. include
  `userId` in the key, or clear the whole cache on switch) rather than
  relying on "logout redirects away from the page" as the only
  protection — a redirect doesn't retroactively un-render already-
  painted stale content, and a fast re-login can land back on the same
  route before a full remount happens.

## Definition of correct behavior

No prior user's resource ID, name, number, or state should be visible —
even briefly — on any screen after a real account switch, where
reasonably testable. A hard page reload always fixes it (fresh state);
the bug is specifically about in-SPA switches without a reload.

## Common failure modes

- Assuming a `401`/redirect on logout is sufficient — it stops NEW
  unauthorized requests, it does nothing about already-cached data.
- Query keys that don't vary by user for a per-user resource ("my
  roadmap" cached under a bare `["roadmap"]` key survives a switch).
- Trusting a `userId`/`clientId` in a request body/query param as
  authoritative instead of the authenticated identity server-side (this
  is a backend IDOR risk, not just a frontend cache risk — see
  `gymini-domain-source-of-truth` and the PT-specific case in
  `gymini-cross-system-journey`).

## Required regression checklist (standard whenever auth/query-cache
## architecture is touched)

```
Login A -> open Roadmap -> capture roadmapIdA
Switch/logout -> Login B -> open Roadmap
  - roadmapIdA never appears for B
  - B's real token is used (check the request header)
  - B's own real data is fetched (check the response body)
  - if B has no Roadmap, the real NoRoadmap empty state renders
  - no A Nutrition/InBody/Workout data remains anywhere on screen
  - no stale-data flash where practically detectable (record video if
    using Playwright, check the first frame after navigation)
B -> A (repeat the same checks in reverse)
```

Also test: rapid switch (switch again before the first switch's queries
settle), an expired token mid-session, and a token refresh that happens
DURING a switch.
