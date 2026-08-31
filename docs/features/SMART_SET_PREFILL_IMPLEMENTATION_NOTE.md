# Smart Set Prefill Implementation Note

Date: 2026-08-24

## Status

**IN PROGRESS / FIRST SLICE VERIFIED.**

This pass implements the first safe slice of roadmap P1.1: mode-aware smart
prefill for the active exercise's editable draft values. It does not yet
replace the active workout UI with a full set-by-set table, and it does not
include undo-last-set. Those remain in P1-A.

## Implemented

- Added `selectSmartSetPrefill`, a pure mode-aware selector.
- Prefill hierarchy:
  1. sufficient deterministic progression target;
  2. previous actual performance;
  3. program prescription/defaults.
- `REVIEW` and `INSUFFICIENT_DATA` progression outputs do not create automatic
  target bumps.
- Cycle-driven `DELOAD` target is allowed because the deterministic
  progression endpoint already applied the cycle envelope.
- Async UI integration waits for previous-performance and progression calls to
  settle before initializing the draft, so previous data does not race ahead of
  the deterministic target.
- Existing user edits are never overwritten: prefill only runs when the active
  exercise has no draft log yet.
- Prefill never marks a set/exercise complete.
- Added browser-visible `data-testid="smart-prefill-source"` for regression
  proof and debugging.

## Verified

- `frontend/web`: `npx tsx --test src/app/pages/client/__tests__/smart-set-prefill.utils.test.ts`
  passed **9/9**.
- `frontend/web`: `npm run build` passed.
- `fitnessassistant-playwright-e2e`: `npx playwright test tests/33-smart-set-prefill.spec.ts --workers=1`
  passed **4/4** (adds TC-SMART-PREFILL-04, the cycle-DELOAD case below —
  closes the "Dedicated browser case for cycle DELOAD prefill" item that was
  previously open in this same note).
- P0 + P1.1 browser regression:
  `npx playwright test tests/29-bodyweight-pr-and-previous-performance.spec.ts tests/30-time-load-and-distance-time-previous-performance.spec.ts tests/31-rest-timer-persistence.spec.ts tests/32-workout-mobile-logging-modes.spec.ts tests/33-smart-set-prefill.spec.ts --workers=1`
  passed **19/19**.

## Coverage Added

- Deterministic `REPS_LOAD` target prefilled into the editable weight control.
- User-edited prefilled value is saved as the actual completed set.
- `TIME_LOAD` falls back to previous actual weight + duration when progression
  data is insufficient.
- `DISTANCE_TIME` falls back to previous actual distance + duration.
- Prefilled-but-uncompleted `DISTANCE_TIME` draft does not create a completed
  set.
- An active cycle `DELOAD` decision prefills the deterministic
  DELOAD-reduced target (verified: two improving sessions that would
  locally suggest 63kg instead correctly prefill 54kg, the -10% DELOAD
  target, with `smart-prefill-source="progression"` — proves the cycle
  envelope, not just the local exercise trend, drives the prefill).
- **Bodyweight reps is now a real, editable prefill control** (closes the
  item that used to be listed below as blocked on "the active UI doesn't
  expose per-set reps"): a new `RulerSlider` ("Số reps", `min=1 max=100
  step=1`), gated to `BODYWEIGHT_REPS` only, prefilled via
  `selectSmartSetPrefill`'s already-existing reps hierarchy
  (progression -> previous -> prescription). Wired into both completion
  payload builders — `completeScheduleExercise` (the real schedule-based
  path) and `persistCompletedWorkout` (the ad-hoc path) — each gated to
  BODYWEIGHT_REPS only, so every other logging mode's reps behavior is
  byte-for-byte unchanged. Backend needed **zero changes**:
  `completeScheduleExerciseSchema`/`completeScheduleExercise` already had
  an optional `reps` field with the exact right fallback
  (`performed?.reps ?? plannedExercise.reps ?? null`), just never
  populated by the frontend until now. Verified: two improving prior
  bodyweight-rep sessions (10 -> 12) produce a deterministic 14-rep
  target, prefilled correctly, user-edited to 16, and 16 (not 10 or 14) is
  what lands in `workout_sets.reps`.

### Real infrastructure bug found and worked around while adding the
### bodyweight-reps E2E case (flagged, not fixed — see below)

Confirmed empirically (isolated Prisma read/write probe, not guesswork):
on this host, Prisma converts `timestamp without time zone` Postgres
columns using the **system's local timezone** (`Asia/Saigon`/`Asia/Ho_Chi_Minh`,
UTC+7) — it subtracts 7h on write and adds 7h back on read. This
round-trips correctly for data written through Prisma (self-cancelling),
but any row inserted via a **raw SQL client** (exactly what every E2E
spec's `seedCompletedSession`/`seedCompletedPriorDayWorkout`-style
helpers do across this whole project) skips the write-side subtraction,
so Prisma's read-side addition over-corrects by a real +7h. A `daysAgo: 1`
seed therefore reads as only ~17h in the past to the app — crossing into
"today" (and getting merged into `workoutCache`/`completedExercises` as
an already-done exercise, silently blocking prefill) for any test run
after ~17:00 local time. This is a genuine, previously-undiscovered,
time-of-day-dependent flakiness hazard, not something this pass caused —
it was just newly exposed because this pass happened to add a `daysAgo: 1`
seed and got run late in the day. **Fixed for this file only**: bumped
every `daysAgo: 1` seed in `33-smart-set-prefill.spec.ts` to `2` (full
day of margin, safe regardless of run time) and documented the mechanism
in a code comment on `seedCompletedSession`. **Not fixed**: the underlying
Prisma/system-timezone behavior itself — that is an infrastructure-level
decision (force the container/system to `TZ=UTC`, or switch the affected
columns to `@db.Timestamptz`) affecting every service, out of scope for a
P1.1 feature slice, and flagged here for a dedicated pass. Other existing
E2E specs across this project that seed `daysAgo: 1` (or similarly narrow
margins) via raw SQL carry the same latent risk and were not audited or
changed.

## Session-resume draft persistence (roadmap P1.7, P1-A exit criterion) — DONE

Added `active-log-draft.utils.ts` (11 exports/functions, dependency-injected
`storage` parameter matching `wake-lock.utils.ts`'s testability convention —
14/14 unit tests) and wired it into `WorkoutLogPage.tsx`:

- Every real user edit (`updateActiveLog`) persists the full draft to
  localStorage, keyed per `(scheduleId, exerciseId)` — same isolation
  property already proven for the rest timer (no cross-exercise or
  cross-schedule bleed).
- On mount/exercise-change, a real, recent (<=12h old) persisted draft is
  restored BEFORE the smart-prefill computation even runs (checked first in
  the same effect, not a separate racing one) — the user's own typed values
  always win over recomputing a fresh prefill.
- A draft older than 12h is discarded and removed, never resurrected —
  satisfies the roadmap's explicit "do not accidentally reopen yesterday's
  completed workout" warning.
- Cleared the instant an exercise is actually completed (both the
  schedule-based and ad-hoc completion paths) — a real persisted set must
  never be shadowed by a stale draft on a later visit.
- Also cleared for every exercise in the day when the user deliberately
  backs out of the active view (same "Reset workout when leaving active
  view" effect that already clears the rest timer) — a full page reload or
  real URL navigation never passes through that state, so this only ever
  fires on an intentional in-app exit, not the reload/navigate-away-and-back
  scenarios the draft is meant to survive.
- Restoring a draft never marks anything complete — verified directly
  against the DB (0 completed sets) in the E2E test below.

Real-browser E2E (`tests/34-session-resume-draft-persistence.spec.ts`,
2/2 pass): an edited-but-uncompleted weight value survives `page.reload()`
unchanged, with zero completed sets in the DB; a completed exercise leaves
zero `active-draft` localStorage keys behind (direct probe, not just visual
absence). Full P0+P1.1+P1.7 browser regression: **22/22 pass.**

## Remaining P1.1 / P1-A Work

- True set-by-set table UI: Previous / Recommended / Today per set.
- Undo last set.
