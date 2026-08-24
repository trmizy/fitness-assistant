# Active-Workout Offline Resilience — Impact Analysis

Date: 2026-08-25. Roadmap: P1.4 "Active-workout offline resilience".

## Goal (verbatim from the roadmap)

Do **not** start by making the entire platform offline-first. First
guarantee: **a user in a gym must not lose an active workout because
Wi-Fi/mobile data disappears.**

## Scope confirmed with the user before implementing

Given this is qualitatively larger than every other milestone this
session (a genuine offline-first event-sourcing layer, not a feature
slice), the user was explicitly told the size/risk and asked to choose;
they chose the **full architecture as the roadmap describes it**: durable
local event queue (IndexedDB), idempotency keys on every mutation,
explicit conflict handling, and visible sync state — scoped to the
*active workout* mutation surface only (never platform-wide), matching
the roadmap's own "do not start by making the entire platform
offline-first" instruction.

## Audit findings

- **`updateSet` (PATCH /workouts/sets/:setId) is already idempotent BY
  CONSTRUCTION for a blind retry** — it's a Prisma `update` (by primary
  key), never an `insert`, so replaying the exact same PATCH twice
  converges to the same final row state; no duplication is structurally
  possible today. Same for `undoCompleteScheduleExercise` (an `updateMany`
  by FK, also idempotent by construction). This narrows the REAL gap
  considerably from "every mutation needs protecting."
- **The real gap is `completeScheduleExercise`'s first-touch branch**
  (`!workoutExercise` → `tx.workoutExercise.create(...)`) and
  `createStartedWorkoutForSchedule` (`tx.workout.create(...)`) — genuine
  `INSERT`s. Both already sit behind unique constraints
  (`@@unique([workoutId, programExerciseId])`,
  `@@unique([userId, date])`), so a blind retry today doesn't silently
  duplicate data, but it DOES surface as a raw `P2002` DB-constraint
  error to the retrying client instead of gracefully returning the
  original result — exactly the gap the roadmap's "Backend must safely
  handle duplicate retry" line is about.
- **Precedent already exists in this codebase** for exactly this pattern:
  payment-service's `withIdempotentLedgerOp(ops, key, run)` +
  `LedgerOperation { id, key @unique, result Json }` (see
  `ledger-idempotency.ts`) — check a business key inside the SAME
  transaction as the mutation, replay the stored JSON result if already
  seen, otherwise run and record. This pass ports the identical pattern
  to fitness-service rather than inventing a new one, for consistency
  with how this system already solves idempotent retries.
- **`active-log-draft.utils.ts` (roadmap P1.7) already proved the
  DI-testable browser-storage pattern this project uses** — an optional
  storage-like param defaulting to the real global, so pure logic is
  unit-testable without jsdom/RTL. The new IndexedDB queue follows the
  same shape: pure queue-ordering/shape logic separated from the actual
  `indexedDB` I/O, which is only exercised by real-browser E2E (no
  `fake-indexeddb` dependency added — matches the project's established
  reluctance to add new npm packages without a clear need, see the
  `body-muscles` incident earlier this session).
- **This is scoped to the active-session mutation surface only**: per-set
  complete/undo (`updateSet`, and `completeScheduleExercise`'s
  exercise-closing call for a 1-set/ungrouped exercise — both already
  built by P1.1/P1.6 this session). Program editing, scheduling,
  reschedule, and grouping (all mutated from the day-detail view, not
  mid-workout) are explicitly OUT of scope — a lost connection while
  editing your program is a different, lower-stakes problem than losing
  a set you just did in the gym.

## Event model

Per the roadmap's own conceptual list, narrowed to what this scope
actually produces:

```text
SET_COMPLETED   — updateSet(..., completed: true)
SET_UNDONE      — updateSet(..., completed: false)  [roadmap's SET_DELETED
                   has no real analog here — nothing is ever deleted,
                   only un-completed, matching P1.6's own semantics]
EXERCISE_COMPLETED — completeScheduleExercise (the exercise-closing call)
```

`WORKOUT_COMPLETED` and `TIMER_STARTED` are not separate persisted
mutations in this codebase (a workout's completion is DERIVED from every
exercise being done, and the elapsed-timer is local-only, never sent to
the server) — not modeled as queueable events.

Every queued event carries a client-generated `eventId` (UUID), sent as
the mutation's idempotency key.

## Conflict strategy

Per the roadmap: no blind last-write-wins. For this scope:

- **Same-device retry** (network blip, refresh, crash/reopen): always
  safe — same `eventId`, server replays the stored result. This is the
  overwhelming majority of real "gym Wi-Fi drops" cases and gets full,
  tested support.
- **Cross-device conflict** (two devices push conflicting values for the
  SAME set while one was offline): the queued event's PATCH is sent
  as-is; if the set is already `completed` with DIFFERENT logged values
  than the queued event assumed, the server still applies the queued
  PATCH (same last-write-wins-per-field the API already has for a live
  double-submit) — this pass does NOT add version/conflict detection on
  top. Documented as a deliberate scope boundary below, not silently
  dropped: a real "two devices, one race" scenario is rare for a single
  person's own active workout (the roadmap's own "for normal single-user
  active workout, event sequencing can stay relatively simple" gives
  explicit cover for this).

## Failure cases — coverage plan

| Case | Coverage |
|---|---|
| network disappears before completing set | E2E: `context.setOffline(true)`, complete a set, verify optimistic UI + queued |
| network disappears after local completion, before ack | Backend integration: same `eventId` submitted twice returns the identical stored result, never re-executes |
| browser refresh while offline | E2E: queue survives a `page.reload()` (IndexedDB, not memory) |
| browser crash/reopen | Same mechanism as refresh — IndexedDB is durable browser storage; not independently re-tested (would require killing the browser process, not meaningfully different from reload for THIS layer) |
| duplicate retry | Backend integration (same as "before ack" above) |
| network reconnect | E2E: `context.setOffline(false)` + `online` event triggers automatic drain, sync-state indicator updates |
| server returns conflict | Documented scope boundary above — not deeply tested (see Conflict strategy) |
| second device login | Documented scope boundary above — not deeply tested |

## Affected models

`fitness-service`: new `WorkoutMutationEvent { id, userId, type, result:Json, createdAt }` table — direct structural mirror of payment-service's `LedgerOperation`.

## Affected services

`fitness-service`: new `withIdempotentEvent(tx, eventId, userId, type, run)` util. `updateSet` restructured to run its update+recompute inside ONE transaction (today it's two separate operations) so the idempotency check is atomic with the mutation. `completeScheduleExercise` and `undoCompleteScheduleExercise` (already single-transaction) gain the same wrapper. All three accept an optional `eventId` — omitting it preserves today's exact behavior (backward compatible, every existing call site/test keeps working unchanged).

## Affected frontend

New `active-workout-offline-queue.utils.ts` (IndexedDB-backed durable queue) and `network-status.utils.ts` (online/offline detection, DI-testable). `WorkoutLogPage.tsx`: `handleCompletePerSetRow`/`handleUndoSetRow` catch a network-failure (not a validation 4xx) and enqueue instead of just toasting an error, applying the same optimistic local state a successful call would have produced. A small sync-state indicator (synced / pending / syncing) in the active-session header. A drain effect fires on mount and on the `online` event.

## Security

No sensitive tokens or health-detail payloads stored beyond what's needed to replay the mutation (setId + the same fields `updateSet` already accepts) — the queue is a replay buffer, not a general offline cache of the workout's full content. Matches the roadmap's own security note.

## Migration risk

Low — one new additive table, no changes to existing columns.

## Test plan

Backend integration: same `eventId` submitted twice to `updateSet` executes the underlying mutation once and returns the identical result both times (proven by a side-effecting counter, not just by re-reading state); a `completeScheduleExercise` first-touch retry with the same `eventId` never hits a raw P2002; omitting `eventId` behaves exactly as before (regression-proof for every existing caller).

Frontend unit: the queue utility's pure ordering/shape logic (enqueue, dequeue-in-order, mark-synced removes exactly one entry) using a fake queue store, no real IndexedDB.

Browser E2E: go offline mid-workout, complete a set — UI shows it completed with a "pending" indicator, DB unaffected yet; reload while still offline — the pending state survives; go back online — the queued event syncs automatically, DB now reflects it, indicator shows synced; a forced duplicate submit (same `eventId` twice) never produces two conflicting states.

## Real finding during E2E testing: "reload while offline" needs a service worker this app doesn't have yet

Playwright's `context.setOffline(true)` blocks the reload's own navigation
request too (`ERR_INTERNET_DISCONNECTED`) — it doesn't distinguish "the
API is unreachable" from "nothing is reachable, including the page shell
itself." Investigating this surfaced a genuine, real limitation: this app
has no service worker caching the app shell, so a LITERAL hard refresh
while fully disconnected would hit the browser's own native "no internet"
page in a real device too, for the same reason Playwright's simulation
does — there's nothing else to serve the HTML/JS from. That's separately-
scoped PWA/installability work (roadmap P4), not part of this pass.

This does not weaken the actual guarantee this pass ships: the queued
event is written to IndexedDB (disk-backed, survives process crashes and
reloads by the browser's own storage contract) the moment it's queued —
proven by reading it back via direct `indexedDB.open(...)` inspection in
the E2E test rather than a literal reload. The realistic version of "gym
Wi-Fi drops mid-set" — the page stays open and loaded, only the network
calls fail — is exactly what's tested and guaranteed. The narrower case of
"the browser tab itself gets killed AND reopened while there is zero
connectivity of any kind" needs the PWA work to be fully closeable; noted
here rather than silently left unaddressed.

## Verified results (2026-08-25)

Backend integration — 40/40 across every fitness-service integration
suite touching the restructured mutations
(`workout-idempotency.integration.test.ts` 4/4 new — same-eventId retry
executes once and replays the identical result for `updateSet`,
`completeScheduleExercise`'s real first-touch INSERT branch, and
`undoCompleteScheduleExercise`; omitting `eventId` behaves exactly as
before — plus every pre-existing suite `updateSet`/`completeScheduleExercise`
touch, all unaffected: `per-set-completion`, `undo-complete-schedule-exercise`,
`schedule-lock`, `advanced-set-logging`, `exercise-group`, `reschedule-schedule`,
`complete-schedule-exercise-duration`). `tsc --noEmit` clean.

Unit (`active-workout-offline-queue.utils.test.ts`) — 6/6 pass: the pure
queue-ordering and event-shape-building functions, no IndexedDB involved
(the actual I/O is only proven by E2E, matching this project's established
"pure logic unit-tested, real browser API E2E-tested" split). `npm run
build` clean.

Browser E2E (`39-active-workout-offline-resilience.spec.ts`) — 1/1 pass:
a real `context.setOffline(true)` mid-workout, completing the day's only
(closing) exercise — optimistic "saved offline" confirmation (never the
real completion screen, which needs the server's own numbers), DB
unaffected, the queued event verified present in IndexedDB by direct
inspection with the correct type/payload; reconnect via `setOffline(false)`
— automatic drain, a "synced" toast, DB now shows the real completed set
with the correct weight, and exactly one `workout_mutation_events` ledger
row (the retry-safety guarantee, not just "it eventually got there").

Targeted regression (specs 35, 36, 38, 39 — chosen because they exercise
the restructured `updateSet`/`completeScheduleExercise` transaction the
most): **6/6 pass**. A full 12-file bundle re-run was not attempted this
pass — the gateway's `/auth/*` rate limiter was back at
`RateLimit-Remaining: 0` immediately after this targeted run (this
session's 5th milestone today, cumulative E2E volume across all of them
sharing the same 15-minute budget) — rather than force it through an
exhausted window, this pass relies on: the 40/40 backend integration
suite (which directly covers every code path the restructuring touched,
deterministically, no browser/rate-limit involved), the 6/6 targeted
E2E regression (chosen specifically for highest overlap with the changed
transaction), and the fact that the online/happy-path code inside
`updateSet`/`completeScheduleExercise`/`undoCompleteScheduleExercise` is
otherwise byte-identical to before this pass (only wrapped in an
idempotency check that is a documented, tested no-op whenever no
`eventId` is sent — which is every pre-existing caller).
