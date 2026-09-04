# Exercise Progress Charts — Impact Analysis

Date: 2026-08-27. Roadmap: P3.3 "Exercise progress charts" (§23).

## Why

Per-exercise trend charts over time — weight, reps, e1RM, best-set,
duration, distance/pace, bodyweight-reps — so a user can see real
progression on a specific movement, not just a single session's summary.
§23's own explicit warning: charts must be logging-mode aware; never
graph "weight" for an exercise where weight isn't meaningful (e.g. a
bodyweight pull-up).

## Audit findings

- **Real per-set data is the only correct source, confirmed again by
  this session's own prior bug.** P3.2's integration test caught
  `WorkoutExercise`'s coarse aggregate `weight`/`reps`/`sets` fields
  silently under-reporting real per-set variation (see
  `ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md`). This feature reads only
  `WorkoutSet` rows from the start — never the aggregate fields.
- **`estimate1RM` (Epley) is the single source of truth for e1RM,
  already used by `getSessionSummary`/`getPRs`** — reused unchanged,
  never reimplemented.
- **`workoutService.getPRs`/`workoutRepository.findExercisePRs` are NOT
  reusable for a real trend chart** — despite the name, `findExercisePRs`
  returns exactly one row per exercise (the single all-time max
  `WorkoutExercise.weight`, from the coarse aggregate field, not a
  timeseries), and doesn't use e1RM at all. A genuine chronological
  per-session series needed new code reading real `WorkoutSet` rows
  grouped by workout.
- **`Exercise.loggingMode`** (`REPS_LOAD` | `BODYWEIGHT_REPS` | `TIME` |
  `TIME_LOAD` | `DISTANCE_TIME`) is the existing taxonomy §23's
  "logging-mode aware" requirement maps onto — no new taxonomy needed.
- **A workout can carry more than one `WorkoutExercise` row for the same
  exercise** (e.g. logged again later in the same session) — real
  per-session aggregation groups by `workoutId` first, so all of a
  session's completed sets for this exercise contribute to one combined
  data point, never split into two artificial points on the same date.
- **No existing per-exercise detail/history page exists yet** to attach
  a chart to — that's §26 (P3.6 "Exercise history detail page"), a
  separate, later milestone. This pass's entry point is the existing
  Exercise Detail modal in `WorkoutLogPage.tsx` (opened via
  `showExerciseDetail`, already shows the exercise's real muscle map via
  `ExerciseMuscleMap` when a real DB id is known) — a "Xem tiến độ" link
  added there, gated the same way the muscle map already is
  (`showExerciseDetail.dbId`), navigates to the new standalone chart
  page. This is the one real place in the app a user is already looking
  at one specific exercise.

## Scope decisions

- **§23 lists 7 trend line names; this pass computes every one of them
  from real data, always returning `null` (never guessed) when a
  session has no set with that dimension** — mode-gating which lines to
  *render* is left to the frontend (`loggingMode` + non-null fields),
  not hardcoded per-mode branching on the backend, so a genuinely mixed
  dataset (e.g. an exercise whose `loggingMode` was corrected later)
  still shows whatever real data exists rather than being filtered out
  by a stale mode value.
- **"rep trend" vs "bodyweight-rep trend"** are the same underlying
  computation (`maxReps`, the highest single completed set's rep count
  that session) — §23 names them separately because they apply to two
  different `loggingMode`s, not because the computation differs. Backend
  exposes one field; the frontend labels it per mode.
- **"best-set trend"**: defined as the (weight, reps) pair of the
  completed set with the highest e1RM that session — i.e. the same set
  that produces the e1RM-trend number, exposed with its own weight/reps
  detail (`bestSetWeightKg`/`bestSetReps`) for a tooltip/annotation,
  not a second independent metric.
- **"distance/pace trend"**: distance (`maxDistanceMeters`, farthest
  single set) and pace (`bestPaceSecPerKm`, fastest sec/km — only
  computed from a set with BOTH duration and distance logged together)
  are both returned; the frontend can show either or both.
- **Range is optional `from`/`to` (YYYY-MM-DD), defaulting to full
  history** — unlike muscle/activity heatmap's fixed preset ranges, a
  progression chart's whole point is showing long-run trend; a hard
  default window (7d/30d) would hide exactly the "did I actually get
  stronger over months" view this feature exists for. The frontend can
  still let a user narrow the range via the same params later.
- **New `GET /stats/exercise-progress/:exerciseId`** on the existing
  `stats` route family, matching this session's own established
  precedent (muscle heatmap, activity heatmap).
- **Visibility**: an exercise must be `SYSTEM` (public) or a
  `USER_CUSTOM` exercise owned by the caller — the same rule
  `import.service.ts`'s catalog lookup already applies. A private
  custom exercise owned by someone else 404s, identical to a genuinely
  nonexistent id (never confirms existence).

## Affected models

None — pure aggregate read of existing `Exercise`/`Workout`/
`WorkoutExercise`/`WorkoutSet` data.

## Affected services

`stats.service.ts`: new `getExerciseProgress(userId, exerciseId, {from?, to?})`.
`stats.controller.ts`/`stats.routes.ts`: one new endpoint.
New pure `exercise-progress.util.ts`: `computeSessionProgressPoint`.

## Affected frontend

New `/client/exercise-progress/:exerciseId` page — a line-chart view
(one or more lines depending on `loggingMode` + which fields are
non-null), reusing this codebase's existing charting approach. Entry
point: a "Xem tiến độ" link in `WorkoutLogPage.tsx`'s existing Exercise
Detail modal, next to the existing muscle-map section.

## Domain invariants

- Every session's fields come from real completed `WorkoutSet` rows
  only, grouped by real `workoutId` — never `WorkoutExercise`'s
  aggregate columns.
- A dimension with no real data that session is `null`, never guessed
  or defaulted to 0 (0 would misleadingly plot as "did nothing," not
  "not applicable").
- e1RM uses the one shared `estimate1RM` formula — never a second copy.
- Mode-gating (which lines to show) is a presentation decision, applied
  once, in the frontend chart component.

## Migration risk

None — no schema change.

## Test plan

Unit: `computeSessionProgressPoint` — each of the 7 derived fields
independently, ties (same max weight at different rep counts), a
session with only bodyweight-rep sets (no weight lines), a session with
only timed/distance sets, an empty-sets session, a pace computed only
from a set with both duration+distance present together (not mixed
across two different sets).

Backend integration: `getExerciseProgress` returns a real correct
chronological series for a real seeded REPS_LOAD exercise across
multiple sessions (including a session where the same exercise appears
in two separate `WorkoutExercise` rows, proving they merge into one
point); 404 for a nonexistent exercise id and for another user's
private `USER_CUSTOM` exercise; `from`/`to` correctly narrows the range.

Browser E2E: open the Exercise Detail modal for a real exercise with
real logged history, click "Xem tiến độ", see the real chart render
with the real values the API returns.

## Verified results

**Unit** (`exercise-progress.util.test.ts`) — 10/10 passing: weight
trend picks the heaviest set (with that same set's own reps); rep trend
is independent of weight; e1RM/best-set trend picks the highest-e1RM
set (not simply the heaviest weight); a bodyweight-only session has no
weight/e1RM lines; a duration-only (TIME) session has no weight/rep/
e1RM lines; a TIME_LOAD session gets both weight and duration; distance/
pace trend (farthest distance, fastest pace); pace is never computed by
mixing duration from one set with distance from another; an empty set
list returns an all-null point (never guessed/defaulted); date/workoutId
pass through unchanged.

**Backend integration** (`exercise-progress.service.integration.test.ts`,
against `gymcoach_fitness_test`, real seeded "Barbell Curl") — 3/3
passing: a real chronological 2-session series, including proving two
separate `WorkoutExercise` rows for the same exercise in one workout
merge into a single session point (not split into two); `from`/`to`
correctly narrows the range to only the real sessions inside it; 404 for
a nonexistent exercise id AND for another user's private `USER_CUSTOM`
exercise (never leaking that it exists), while the real owner can still
see it. `npx tsc --noEmit` clean (backend). Frontend `npm run build`
clean.

**Browser E2E** (`tests/49-exercise-progress-charts.spec.ts`) — 1/1
passing: two real seeded sessions with a real weight/rep progression
(42.5kg×8 → 50kg×5) render the real exercise name and the 3
REPS_LOAD-appropriate trend charts (weight/reps/e1RM), computed and
served entirely by the real backend endpoint.

**Regression**: `tests/33-smart-set-prefill.spec.ts` (5 sub-tests,
exercises the same `WorkoutLogPage.tsx` this pass added the "Xem tiến
độ" entry-point link to) + `tests/47-muscle-heatmap.spec.ts` +
`tests/48-activity-heatmap.spec.ts` (both share `stats.service.ts`,
which gained a new sibling function this pass) — 7/7 still passing.

No real bug was found while implementing this pass — unlike P3.1/P3.2,
this feature was pure new-aggregation-read on already-correct
`WorkoutSet` data, with no pre-existing aggregate-field shortcut in its
path to rediscover.
