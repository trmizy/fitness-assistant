# Notifications/Reminders — Impact Analysis

Date: 2026-08-27. Roadmap: P4.1 "Notifications/reminders" (§27) — first
P4 (polish) milestone.

## Why

§27 potential notifications: upcoming workout, rescheduled workout, rest
timer, unfinished active workout, PT feedback, plan update. Need
preference controls. Do not spam. Rest timer notification should remain
session-scoped.

Scope confirmed with the user before implementation (per this roadmap's
own §45.13 "do not implement multiple high-blast-radius milestones
unchecked" — the same discipline already applied before P2/P3.1's own
scope decisions): (1) extend user-service's existing `Notification`
model/history rather than build a fitness-service-local parallel store,
and (2) build all 6 notification types this pass, including PT
feedback — which required building a real PT-feedback-sending mechanism
from scratch (disclosed as its own real scope item, not hidden inside
"just notifications").

## Audit findings

- **A real, working, persisted notification system already exists — but
  entirely scoped to PT/contract/booking events.** `Notification`
  model + `notificationService.create` (real DB write + real-time push
  via chat-service's socket relay) + a real generic Topbar bell UI
  already existed in user-service, covering only `CONTRACT_*`/
  `SESSION_*` event types (PT-booking sessions, not fitness workout
  schedules — a genuine naming collision risk between "Session" the PT
  booking concept and "session" the workout-logging concept, kept
  distinct throughout this pass).
- **fitness-service already had a real-time-only push mechanism
  (`pushCycleAssessmentNotification`, via chat-service), with a
  disclosed gap already documented in its own code comment**: it never
  persisted a row, so an offline user's notification was lost forever,
  irretrievable from any history/list. This is the exact gap this
  milestone closes for workout-domain events.
- **The generic Topbar notification bell needed ZERO changes to display
  new event types** — it already renders `n.text` (server-composed,
  already-localized) generically; only a small VI label map was added
  for polish (the old fallback — `eventType.replace(/_/g, " ")` — would
  have worked regardless).
- **"PT feedback" had no existing send mechanism anywhere in this
  codebase** (real audit finding, not assumed) — every other §27 type
  had a real trigger point to hook into; this one needed a new,
  deliberately minimal feature: a single free-text message a PT sends
  on an ACTIVE contract, anchored to `Contract` (the one relationship
  this service already has a real, verified trust boundary for) —
  **not** a new threaded conversation feature (chat already exists
  separately for that).
- **`WorkoutSchedule.date` is day-granularity only** (UTC-midnight
  label, no time-of-day column anywhere in this schema) — "upcoming
  workout" is therefore necessarily "scheduled today, not yet started,"
  not a precise "in N hours" reminder. Disclosed, not worked around.
- **`coachService.createAndAssignPlan`** (pre-existing, already
  cross-service-authorized) was the real, correct hook for "plan
  update" — a PT assigning/updating a client's program.
- **`workoutService.rescheduleSchedule`** (P1.2, pre-existing) was the
  real hook for "rescheduled workout" — fires a confirmation
  notification to the SAME user who just acted (same "here's a record
  of what you did" convention as an order confirmation), since this
  reschedule flow is single-actor/self-service with no other party to
  notify.
- **No repeatable/cron job pattern existed in fitness-service** (it has
  a single-purpose BullMQ queue for AI plan generation, not a scheduled-
  sweep pattern) — user-service's own 3 existing background jobs
  (`session-autoconfirm`, `reschedule-expiry`, `session-settlement-
  sweep`) are ALL plain `setInterval` with a `running` overlap guard and
  an injectable-deps testability seam. That proven pattern was mirrored
  exactly for fitness-service's first-ever background job, rather than
  introducing a new mechanism.

## Scope decisions

- **Architecture**: extend `NotificationEventType`/`NotificationEntityType`
  (5 new event values, 2 new entity values) + a new `NotificationPreference`
  model, all in user-service — confirmed with the user over the
  alternative (a fitness-service-local store, which would have
  fragmented the notification list UX across two systems).
- **New cross-service write path**: fitness-service → user-service's
  new internal `POST /internal/notifications` (the first time
  fitness-service has ever WRITTEN into user-service — every prior
  cross-service call was a read). Reuses `notificationService.create`
  completely unchanged — same preference-gating, same real-time push.
- **Preference gating is scoped to exactly the 5 new event types** —
  every pre-existing `CONTRACT_*`/`SESSION_*` type is deliberately left
  out of the gating map, so `create()`'s behavior for them is 100%
  unchanged (proven by a real test asserting an unrelated event type is
  never silently swallowed even when every new preference is disabled).
- **Anti-spam is per-row idempotency, not a rate limiter**: each
  `WorkoutSchedule` row can trigger at most ONE upcoming-reminder and
  ONE unfinished-reminder, ever (`upcomingReminderSentAt`/
  `unfinishedReminderSentAt`, set once, never cleared) — 2 new nullable
  columns, purely additive.
- **PT feedback is deliberately minimal**: one free-text message,
  anchored to `Contract`, delivered as a `Notification` whose `text` IS
  the message — no separate `PtFeedback` model, no reply/thread
  feature. PT-only, contract must be ACTIVE, 1000-char cap.
- **Rest timer notification is explicitly OUT of scope this pass** — the
  roadmap's own instruction ("should remain session-scoped") describes
  behavior an entirely client-side, local `Notification` API trigger
  already satisfies without any of this pass's server-side
  infrastructure; not touched here to avoid scope creep into an
  unrelated, already-correctly-scoped mechanism.
- **All best-effort, never a hard dependency**: every new notification
  create call (`createPersistentNotification`) is fire-and-forget with
  its own try/catch — a missed reminder must never fail the real state
  change (a reschedule, a plan assignment) that triggered it.

## Affected models

- user-service: `NotificationEventType`/`NotificationEntityType` enums
  extended (5 + 2 new values); new `NotificationPreference` model.
- fitness-service: `WorkoutSchedule` gains `upcomingReminderSentAt`/
  `unfinishedReminderSentAt` (both nullable, additive).

## Affected services

- user-service: `notification.service.ts` (preference gating,
  `getPreferences`/`updatePreferences`), `notification.repository.ts`
  (preference CRUD), new `POST /internal/notifications`,
  `contract.service.ts`'s new `sendFeedback`, new `POST /contracts/:id/feedback`,
  new `GET`/`PUT /notifications/preferences`.
- fitness-service: new `clients/notification.client.ts`'s
  `createPersistentNotification`; `workout.service.ts`'s
  `rescheduleSchedule` and `coach.service.ts`'s `createAndAssignPlan`
  each gained one notification call; new `workout-reminder.service.ts`
  (2 background jobs, mirroring user-service's own proven sweep-job
  pattern); `server.ts` starts both new jobs (never `app.ts` — same
  Lambda-safety convention this session's own AWS deployment-prep audit
  already established for user-service's jobs).

## Affected frontend

Topbar's existing notification bell needed no structural change (new VI
labels only). New `/client/notification-preferences` page (5 toggles),
new entry-point card on `ProfilePage.tsx`. New "Gửi phản hồi" button +
dialog on `PTContractsPage.tsx` for ACTIVE contracts.

## Real bug found and fixed

The new `sendFeedback` controller method initially read
`req.headers['x-user-id']`, copying this file's OTHER (pre-existing)
methods' convention — but that header is only ever populated by the
GATEWAY's own proxy-time injection, never by `authMiddleware` itself
(which this new route DOES apply directly and which DOES correctly set
`req.user`). A request that reaches user-service directly (bypassing
the gateway — exactly what this pass's own E2E test setup does, calling
the service's own port for a real authenticated action, matching an
established test convention) silently read `undefined`, so `contract.
ptUserId !== undefined` was always true, and the real PT's own feedback
was rejected with a 403 — caught by this pass's own E2E test, not
assumed correct. Fixed by reading `req.user!.id` instead, which works
correctly whether the request arrives via the gateway or directly.

## Domain invariants

- A `WorkoutSchedule` row fires at most one upcoming-reminder and one
  unfinished-reminder, ever.
- Every pre-existing `CONTRACT_*`/`SESSION_*` notification type is
  never gated by this pass's new preference model.
- PT feedback requires the caller to be the contract's real PT AND the
  contract to be ACTIVE — both enforced server-side, never trusted from
  the client.
- A missed/failed notification create never fails the real action that
  triggered it.

## Migration risk

Both migrations are purely additive (2 new enum value sets, 1 new
table, 2 new nullable columns) — no destructive SQL, no backfill
needed (a new preference row's absence already means "everything
enabled," the same behavior every existing user already had).

## Test plan

Unit: `runUpcomingReminderSweep`/`runUnfinishedReminderSweep` — notify-
then-mark ordering, a failed notify never marks the row (stays eligible
next tick), one row's failure never stops the batch, an empty candidate
set is a real no-op.

Backend integration: preference gating (opt-out blocks a gated type,
default-enabled creates a row, pre-existing types are never gated),
preference get/update round trip, `sendFeedback` (real notification
created, 403 for a non-PT caller, 409 for a non-ACTIVE contract, 400
for empty text), the 2 reminder sweeps against real seeded
`WorkoutSchedule` rows (real date/status/idempotency-column filtering,
not just mocked deps).

Browser E2E: a real reschedule creates a real, visible
`WORKOUT_RESCHEDULED` notification; a real PT-sent feedback message
creates a real, visible `PT_FEEDBACK_RECEIVED` notification for the
real client; a real preference toggle survives a real page reload.

## Verified results

**Unit** (fitness-service, `workout-reminder.service.test.ts`) — 5/5
passing.

**Backend integration**:
- user-service, `notification-preferences-and-pt-feedback.integration.test.ts`
  — 8/8 passing (real dev DB): preference opt-out/default-enabled/
  unaffected-pre-existing-types, get/update round trip, `sendFeedback`
  happy path + 403 + 409 + 400.
- fitness-service, `workout-reminder.service.integration.test.ts` — 3/3
  passing (real test DB): real upcoming-candidate matching + idempotency
  across two real sweep runs, a different-day session correctly
  excluded, real stale-vs-recent `IN_PROGRESS` distinction.
- Full user-service suite: 184/184 passing (zero regressions).
- `npx tsc --noEmit` clean on both services. Frontend `npm run build`
  clean.

**Browser E2E** (`tests/53-notifications-reminders.spec.ts`) — 3/3
passing: real reschedule → real `WORKOUT_RESCHEDULED` notification in
the real bell; two real accounts + a real `ACTIVE` contract → real PT
feedback → real `PT_FEEDBACK_RECEIVED` notification for the real
client (this run is what caught the `req.user`/`x-user-id` bug above,
fixed, then re-verified passing); a real preference toggle survives a
real page reload.

**Regression**: `tests/37-reschedule-workout.spec.ts` (2/2) +
`coach.service.integration.test.ts` (5/5) + `reschedule-schedule.integration.test.ts`
(8/8) — all still passing, confirming the new notification hooks added
to `rescheduleSchedule`/`createAndAssignPlan` did not disturb either
function's existing behavior.
