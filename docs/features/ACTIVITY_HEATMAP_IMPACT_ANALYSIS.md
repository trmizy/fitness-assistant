# Activity Heatmap — Impact Analysis

Date: 2026-08-26. Roadmap: P3.2 "Activity heatmap" (§22).

## Why

A GitHub-style calendar view of training activity for adherence/
retention — explicitly NOT a binary "worked out yes/no": §22 lists 5 real
day states (`completed`, `partial`, `rest`, `missed`, `rescheduled`) and
a click-through day detail (workout, duration, volume, PR, RPE/RIR,
notes).

## Audit findings

- **Every day state §22 lists maps onto columns that already exist —
  no new schema needed.** `WorkoutSchedule.status` already distinguishes
  `COMPLETED`/`PARTIALLY_COMPLETED`/`SKIPPED`/`CANCELLED`/`NOT_STARTED`/
  `IN_PROGRESS`. P1.2's own reschedule audit columns
  (`originalPlannedDate`, set once on the FIRST reschedule only and never
  overwritten — confirmed by re-reading that column's own doc comment)
  are exactly what "rescheduled" needs: a calendar day whose ORIGINAL
  schedule moved away, not the day it moved to.
- **Real day-state derivation, per calendar day D (D ≤ today only — a
  future day hasn't happened yet, so none of these 5 retrospective
  states apply to it and it's left unclassified rather than forced into
  one)**:
  1. A `WorkoutSchedule` row exists at `date = D`:
     - `COMPLETED` → `completed`
     - `PARTIALLY_COMPLETED` → `partial`
     - `SKIPPED` or `CANCELLED` → `missed` (§22's vocabulary is smaller
       than the schema's — both collapse to the same user-facing
       "didn't happen" state)
     - `NOT_STARTED`/`IN_PROGRESS` and D is in the past → `missed`
       (planned but time passed with no action)
  2. No row at `date = D`, but some OTHER row has
     `originalPlannedDate = D` (it moved elsewhere) → `rescheduled`
  3. No row at `date = D` and nothing ever pointed here as an original
     plan → `rest` (nothing was ever planned this day)
- **PR detection already exists and is reused unchanged**:
  `workoutService.getSessionSummary(userId, workoutId)` — built for the
  end-of-session completion screen — already does the real "did any
  exercise in this workout beat its own prior best (by e1RM, or by reps
  for bodyweight work)" comparison. The click-through day detail calls
  this directly rather than re-implementing PR logic a second time.
- **No existing "training volume" aggregate to reuse** — computed fresh
  here as Σ(weight × reps) across the day's completed weighted sets, the
  same formula convention already implied by `estimate1RM`'s own
  weight/reps inputs elsewhere in this codebase. Bodyweight-only/timed/
  distance sets don't have a meaningful "kg volume" figure and are
  excluded from that specific number (never forced into a wrong unit).

## Scope decisions

- **New `GET /stats/activity-heatmap` (range) + `GET /stats/activity-heatmap/day/:date` (detail)** on the existing `stats` route family, matching muscle heatmap's own precedent from this session.
- **Click-through detail is a lightweight in-page panel, not a second
  full day-editing UI** — `WorkoutLogPage.tsx`'s own day-detail/edit view
  already exists for actually editing a session; this heatmap's detail
  view is read-only retrospective summary (workout name, duration,
  volume, PRs, RPE/RIR averages, notes) with a link out to the full page
  for anyone who wants to edit, not a duplicate editing surface.
- **Range defaults to the current calendar year-to-date** (a GitHub-style
  contribution graph's own convention) with month-range navigation,
  rather than a fixed hardcoded window.

## Affected models

None — pure aggregate read of existing `WorkoutSchedule`/`Workout`/
`WorkoutExercise`/`WorkoutSet` data.

## Affected services

`stats.service.ts`: new `getActivityHeatmap(userId, from, to)` and
`getActivityDayDetail(userId, date)`, reusing
`workoutService.getSessionSummary` unchanged for the PR data.
`stats.controller.ts`/`stats.routes.ts`: two new endpoints.

## Affected frontend

New `/client/activity-heatmap` page — a GitHub-style day-square grid
(5 real states + neutral for future/unclassified days), click → inline
detail panel. Entry point on `ProfilePage.tsx`, matching this session's
established pattern for every other new top-level feature page.

## Domain invariants

- A future date is never classified into any of the 5 states.
- `rescheduled` is about the ORIGINAL date a session moved away FROM,
  never confused with the date it moved TO (which shows its own real
  current status).
- PR detection is byte-for-byte the same logic the real end-of-session
  completion screen already uses — never a second, possibly-divergent
  implementation.

## Migration risk

None — no schema change.

## Test plan

Unit: pure day-state classification function (all 5 states + the
"future date, unclassified" case + the SKIPPED/CANCELLED/NOT_STARTED-
past collapse into `missed`).

Integration: `getActivityHeatmap` returns the real, correct state for a
range covering all 5 real scenarios seeded directly (completed, partial,
missed via SKIPPED, rest via no-schedule, rescheduled via a real
P1.2-style date move); `getActivityDayDetail` returns real workout/
volume/PR/RPE data for a completed day, reusing `getSessionSummary`'s
real PR output; scoped to the requesting user only.

Browser E2E: a real user with a real seeded week of mixed-state history
opens the heatmap, sees the real day states rendered, clicks a completed
day, sees the real detail panel (real duration/volume/notes) — verified
against the same values the API returns.

## Real bug found and fixed during implementation

`getActivityDayDetail`'s first version reused `workoutService.
getSessionSummary`'s own `totalVolumeKg` directly for the day's volume
figure — until its own integration test (seeding a real, genuinely
varying per-set fixture: 50kg×10, then 52.5kg×8) asserted the real
expected total (920kg) and got `0` back. Root cause:
`getSessionSummary`'s volume sums `WorkoutExercise.weight * reps * sets`
— coarse AGGREGATE fields on the exercise row, not the real per-set
`WorkoutSet` data — and a workout logged set-by-set (this app's actual
current logging UX, see roadmap's own P1.1 Smart Set-by-Set Prefill)
never necessarily populates those aggregate fields at all. Fixed by
computing volume directly from real `WorkoutSet` rows instead (more
precise, and already this codebase's own established "set-by-set is the
source of truth" convention — `recomputeScheduleProgress`, this
session's own P2 import commit path, etc. — not a new pattern invented
here). PR detection is still reused unchanged from `getSessionSummary`,
since that specific comparison (best single set vs. prior best) is
unaffected by the same limitation.

## Verified results

**Unit** (`activity-heatmap.util.test.ts`) — 9/9 passing: all 5 real day
states, a future date left unclassified, SKIPPED/CANCELLED both
collapsing to `missed`, and the "a real schedule at this date wins over
a stale moved-away flag" defensive case.

**Backend integration** (`activity-heatmap.service.integration.test.ts`,
against `gymcoach_fitness_test`, real seeded exercise) — 2/2 passing
(after the volume-calculation fix above): `getActivityHeatmap` correctly
classifies all 5 real states from real seeded `WorkoutSchedule` rows
across one range, including proving the date a session moved TO shows
its own real current status (never mislabeled `rescheduled`, only the
date it moved FROM is); `getActivityDayDetail` returns the real,
correct volume/duration/RPE for a completed day and correctly reports no
workout for a rest day. `npx tsc --noEmit` clean.

**Browser E2E** (`tests/48-activity-heatmap.spec.ts`) — 1/1 passing
(40.2s): a real seeded `COMPLETED` day renders with the correct color/
state attribute in the real month grid, clicking it shows the real
detail panel with the real workout name and the real computed volume
(400kg = 40kg × 10 reps), and a real rest day (no schedule at all)
correctly shows no workout.

**Regression**: `tests/37-reschedule-workout.spec.ts` (shares
`WorkoutSchedule.originalPlannedDate`, the exact column this pass's
`rescheduled` state derivation reads) + `tests/13-training-cycle-fixes.spec.ts`
(exercises `ProfilePage.tsx`, which this pass also touched) — 4/4 still
passing.
