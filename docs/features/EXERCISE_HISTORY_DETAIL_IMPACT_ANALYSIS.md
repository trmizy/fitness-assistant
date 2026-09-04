# Exercise History Detail Page — Impact Analysis

Date: 2026-08-27. Roadmap: P3.6 "Exercise history detail page" (§26) —
**the final P3 (visualization) milestone.**

## Why

§26, per exercise: recent sessions, previous actual sets, progression
decisions, PRs, e1RM where eligible, charts, logging-mode-specific
records, notes, exercise substitutions if available — "a better place
for deep history than cluttering active workout."

## Audit findings — this milestone is almost entirely composition

Every single bullet in §26's list was already served, in whole or in
large part, by code this session (or an earlier one) already built and
proved correct:

- **Charts / logging-mode-specific records / e1RM**: P3.3's own
  `statsService.getExerciseProgress` (`exercise-progress.util.ts`) —
  reused completely unchanged, including its own real visibility check
  (SYSTEM or owned USER_CUSTOM, 404 otherwise) — not duplicated a second
  time.
- **PRs**: P3.3's own audit already found `workoutService.getPRs`/
  `findExercisePRs` unsuitable (single all-time max off `WorkoutExercise`'s
  coarse aggregate field, no e1RM). Re-confirmed here rather than
  re-reused. Instead, a new thin pure function
  (`derivePersonalRecord`, `exercise-history.util.ts`) reduces over
  P3.3's own already-correct per-session `SessionProgressPoint[]` — the
  underlying math (e1RM, max reps, etc.) is never recomputed, only the
  "which session was the best one" reduction is new.
- **Recent sessions / previous actual sets**:
  `workoutRepository.findRecentCompletedSessionsForExercise` — a
  pre-existing function built for `exercise-progression.engine.ts`,
  already returning exactly the real per-set breakdown (setNumber/
  weight/reps/rpe/rir/setType/durationSeconds/distanceMeters) across the
  N most recent real sessions. Reused unchanged; only extended (purely
  additively) to also select `notes` and the workout's own `id`/`name`,
  neither of which existing callers read.
- **Progression decisions**: `workoutService.getExerciseProgression` —
  already a real, deterministic, independently-tested endpoint (used
  live for smart set prefill). Reused unchanged, called fail-soft
  (`.catch(() => null)`) — a history page must still render everything
  else if this one piece has a transient failure, matching the fail-soft
  convention that function's OWN internals already apply to its external
  lookups (profile/cycle/assessment).
- **Notes**: `WorkoutExercise.notes` — already existed, just not
  previously selected by the recent-sessions query (an oversight this
  pass fixes, not a new column).
- **Exercise substitutions if available**: `GET /exercises/:id/substitute`
  — already a real, complete, equipment-aware endpoint (built for the
  in-session "swap exercise" feature). Deliberately NOT folded into the
  new aggregator — called as a second, independent frontend request
  instead, so a slow/failed substitute lookup never blocks the rest of
  the page (§26's own "if available" wording already signals this is
  optional/best-effort).

The only genuinely NEW logic this pass wrote is the thin composition
layer itself (`exercise-history.service.ts`) and the PR-derivation
reduction (`exercise-history.util.ts`) — everything else is real reuse,
not re-implementation.

## Scope decisions

- **Extended P3.3's existing `/client/exercise-progress/:exerciseId`
  page in place, rather than a second URL/page for the same exercise.**
  §26 itself frames this as "a better place" (singular) for deep
  history — two different "exercise deep-dive" destinations for the same
  exercise would fragment the UX, not clarify it. Same entry point
  ("Xem tiến độ" in `WorkoutLogPage.tsx`'s Exercise Detail modal) keeps
  working unchanged.
- **One new aggregated backend endpoint** (`GET /workouts/exercises/
  :exerciseId/history`), composing the 3 backend pieces above into a
  single page-ready response — avoids the frontend making 3-4 separate
  round trips for what is conceptually one page. Substitutions stay a
  separate request by design (see above).
- **`recentSessions` capped at 10** (matches the limit
  `exercise-progression.engine.ts` already effectively works with via
  the same underlying repository function, just requesting more of them
  for display purposes than that engine's own `5`).

## Affected models

None — pure aggregate read of existing data; one purely additive
`select` extension (`notes`, `workout.id`, `workout.name`) on an
existing repository query.

## Affected services

- New `backend/services/fitness-service/src/utils/exercise-history.util.ts`
  — pure `derivePersonalRecord`.
- New `backend/services/fitness-service/src/services/exercise-history.service.ts`
  — `getExerciseHistoryDetail`, composing `statsService.getExerciseProgress`,
  `workoutRepository.findRecentCompletedSessionsForExercise`, and
  `workoutService.getExerciseProgression`.
- `workout.repository.ts`: `findRecentCompletedSessionsForExercise`'s
  `select` gains `notes`/`workout.id`/`workout.name` (additive).
- New `GET /workouts/exercises/:exerciseId/history` (workout.controller.ts/
  workout.routes.ts, named route ahead of `/:id` per the existing
  convention on that router).

## Affected frontend

`ExerciseProgressChartPage.tsx` (P3.3, extended in place) gains: a
Personal Record badge, a Progression card (only shown when the
underlying status isn't `INSUFFICIENT_DATA`), a Recent Sessions list
(real per-set breakdown + real notes), and a Substitutions list (a
second, independent query against the existing `/substitute` endpoint).
New `data-testid`s: `exercise-history-pr`, `exercise-history-progression`,
`exercise-history-recent-sessions`, `exercise-history-session-{workoutId}`,
`exercise-history-substitutes`.

## Domain invariants

- A `PersonalRecord` is `null`, never fabricated, when no session has
  data for that mode's metric.
- Progression is fail-soft — its own transient failure never breaks the
  rest of the page.
- Substitutions are independent of the main query — a slow/failed
  lookup never blocks charts/PR/recent-sessions from rendering.
- Real per-set data only — never `WorkoutExercise`'s coarse aggregate
  fields, continuing every prior P3 milestone's own established rule.

## Migration risk

None — no schema change.

## Test plan

Unit: `derivePersonalRecord` — each of the 4 comparable modes'
metric/reduction independently, an empty session list, a mode with no
matching data, an unrecognized mode.

Backend integration: `getExerciseHistoryDetail` against 2 real seeded
sessions (a lighter older one with a real note, a heavier newer one) —
proves the composed response's recent-sessions ordering, real note
preservation, and personal-record derivation (the newer, higher-e1RM
session wins, not just "most recent"); 404 for a nonexistent exercise
(reusing `statsService.getExerciseProgress`'s own check).

Browser E2E: the extended page, opened with real seeded 2-session
history including a real note, shows the real personal-record badge and
the real recent-sessions list.

## Verified results

**Unit** (`exercise-history.util.test.ts`) — 7/7 passing.

**Backend integration**
(`exercise-history.service.integration.test.ts`, against
`gymcoach_fitness_test`, real seeded "Barbell Curl") — 2/2 passing: a
real 2-session history correctly orders newest-first, preserves a real
note on the older session, and derives the personal record from the
newer session's genuinely higher e1RM (50kg×5 beats 42.5kg×8); 404 for
a nonexistent exercise id. `npx tsc --noEmit` clean (backend). Frontend
`npm run build` clean.

**Browser E2E** (`tests/52-exercise-history-detail.spec.ts`) — 1/1
passing: 2 real seeded sessions (one with a real note) render the real
personal-record badge and the real recent-sessions list through the
extended `/client/exercise-progress/:exerciseId` page.

**Regression**: `tests/49-exercise-progress-charts.spec.ts` (1/1, P3.3's
own spec against the SAME page, now extended) +
`tests/33-smart-set-prefill.spec.ts` (5/5, shares
`WorkoutLogPage.tsx`'s entry-point modal) — 6/6 still passing.

---

**This closes out P3 (visualization) in full — 6/6 done**: Muscle
Heatmap (§21), Activity Heatmap (§22), Exercise Progress Charts (§23),
Training Consistency and Adherence (§24), Planned vs Actual Training
Volume (§25), and Exercise History Detail Page (§26). Only P4 (polish —
notifications/reminders, PWA/installability) and the environment-blocked
Apple Health/Health Connect item remain.
