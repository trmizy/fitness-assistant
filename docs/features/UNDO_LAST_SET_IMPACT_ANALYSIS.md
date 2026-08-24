# Undo Last Set — Impact Analysis

Date: 2026-08-24. Roadmap: P1.6 "Fast active-workout interaction polish" /
Milestone P1-A exit criterion ("undo recent set").

## Problem

Gym logging errors are common (wrong weight, fat-fingered a slider, hit
"complete" before actually finishing the exercise). Today there is no way
to correct a completion once submitted short of navigating away and coming
back — and even then, `completeScheduleExercise`'s "re-completion" branch
lets you overwrite the LOGGED values but not un-mark the exercise as done,
so it stays counted toward `completedExercises`/progress the whole time.

## Current FA behavior

- `completeScheduleExercise` creates/updates a `WorkoutExercise` +
  `WorkoutSet` row(s) and sets `WorkoutSet.completed = true`, then calls
  `recomputeScheduleProgress`, which **always recomputes
  `completedExercises`/`progressPercent`/`status` fresh from the current
  `WorkoutSet.completed` flags** — it is not an incremental counter.
- On the frontend, completing a non-final exercise auto-advances
  `activeExIdx` and starts the 90s rest timer; completing the FINAL exercise
  shows the whole-workout completion screen (`showCompletion=true`),
  computes the session's PR summary, and may prompt for cycle feedback.

## Desired behavior

A brief, safe "Undo" affordance appears immediately after completing an
exercise. Using it:

- reverts that exercise's `WorkoutSet.completed` flags back to `false`;
- removes it from the session's completed count (via the SAME
  `recomputeScheduleProgress` recomputation completion already uses — no
  new counting logic);
- returns the user to that exercise with their just-submitted values
  editable, not blank;
- cancels the rest timer that completion started;
- is available only for the **most recently completed exercise, in the
  current session** — not a general history/audit undo.

## openGym behavior reference

openGym allows editing a just-logged set inline. Fitness Assistant already
has this idea covered better on the *editing* pass; the missing piece is
specifically the FLAG that marks the exercise "done" for schedule/progress
purposes. This is a Fitness-Assistant-specific implementation (reuses the
existing `recomputeScheduleProgress` derivation), not a copy of any openGym
mechanism.

## What we will NOT copy

No openGym code/schema/UI. No general multi-step undo history — one level,
most-recent-action only.

## Scoped MVP boundary (deliberate, to keep blast radius small)

**Undo is only offered for completing a NON-final exercise of the day** —
i.e., exactly the branch where `completeScheduleExercise` auto-advances to
the next exercise rather than finishing the whole session. This is a
one-line frontend guard, and it means undo never has to interact with:

- the whole-workout completion screen / PR summary computation
  (`loadCompletionSummary`, `getSessionSummary`);
- cycle-feedback prompts (`setFeedbackPrompt`);
- training-cycle cache invalidation from a session that just "completed"
  and then un-completed.

If the user wants to undo the FINAL exercise of a session after the
completion screen has already appeared, that is explicitly **out of scope**
for this pass — they can still fix values via the existing re-completion
path (navigate back into the exercise, edit, complete again), which already
works and is unaffected by this change.

## Domain invariants

- Undo never fabricates or discards *historical* data — it only ever
  reverses the single most recent, still-in-session completion, before any
  other read (PR calc, cycle evaluation, adherence) has consumed it.
- Undo is only valid while the schedule's date is still editable
  (`assertScheduleDateEditable` — same today-only rule every other mutation
  on this schedule already enforces); a past/locked day can never be
  undone.
- Undoing an exercise that is not currently marked completed is rejected
  (409) — never silently "undoes" a different exercise. (Note: the backend
  does not separately track *which* exercise was most recently completed —
  see "Implemented behavior note" below for how "most-recent-only" is
  actually enforced.)
- `recomputeScheduleProgress` remains the single source of truth for
  progress/status after undo, exactly as it already is after completion —
  no parallel counting logic introduced.

## Affected models

None. No schema change — `WorkoutSet.completed` already exists and is
exactly the flag that needs flipping back.

## Affected services

`fitness-service`: new `workoutService.undoCompleteScheduleExercise`
(sibling of `completeScheduleExercise`, same transaction shape, reuses
`recomputeScheduleProgress`). New route
`POST /workouts/schedules/:scheduleId/exercises/:programExerciseId/undo-complete`.

## Affected frontend pages

`WorkoutLogPage.tsx` only: a "last completed" tracking ref, an Undo
affordance (visible for a bounded window / until the next action), and the
handler that calls the new endpoint and restores local state (active index,
draft values, rest timer).

## Affected AI context

None.

## Affected cycle/adherence logic

None directly — `recomputeScheduleProgress` already invalidates the cycle
progress cache on every call (completion or undo), so a cycle summary
computed moments later reflects the corrected state, not a stale one.

## Migration risk

None (no schema change).

## Backward compatibility

Fully additive — a new endpoint and a new, optional frontend affordance.
Every existing completion path is unchanged.

## Security/privacy

Same auth/ownership checks as `completeScheduleExercise`
(`userId`-scoped schedule lookup) — no new exposure.

## Failure modes

- Undo called for an exercise that isn't the most recent completion (stale
  client state, e.g. two tabs): the backend independently re-verifies
  ownership, that this exercise is currently completed, and that the
  schedule date is still editable, before reverting — but it does NOT track
  a separate "which exercise was completed most recently" pointer, so as an
  API it is capable of un-completing any currently-completed exercise on
  the schedule, not only the latest one. "Most-recent-only" is what the
  ONLY caller (the toast action, closure-capturing the exact exercise it
  just completed, live for 8s) actually enforces today — see "Implemented
  behavior note" below.
- Network failure calling undo: exercise stays completed (safe default —
  never leaves an ambiguous half-undone state); user can retry or just
  re-edit via the existing re-completion path.
- Undo on a locked/past day: rejected with the same 4xx the rest of this
  schedule's mutations already use.

## Test plan

Unit: none needed (no new pure-logic module — this is a thin transactional
service method + a UI state handler, matching `completeScheduleExercise`'s
own precedent of being integration-tested directly, not unit-tested).

Integration (fitness-service, real DB):
- undoing the most recent completion flips `completed=false` and
  `recomputeScheduleProgress` correctly reports one fewer completed
  exercise, status downgraded from `PARTIALLY_COMPLETED`/`COMPLETED` back
  to the appropriate prior state;
- undoing an exercise that was never completed is rejected;
- undoing on a locked/past-day schedule is rejected;
- undo does not touch OTHER exercises' completed sets.

Browser E2E: complete a non-final exercise, use Undo, verify the exercise
re-opens with the same values editable, verify the rest timer is gone,
verify DB shows `completed=false` again, verify progress count decreased.

## Rollout strategy

Ship as one additive slice, same as smart-prefill/session-resume-draft
before it. No feature flag needed (zero effect on any user who never
triggers it).

## Implemented behavior note (post-implementation correction)

The section above was written before implementation and describes the
*intended* scope ("most recent completion only"). What actually shipped is
slightly broader at the API layer:
`workoutService.undoCompleteScheduleExercise` reverts whichever exercise
`programExerciseId` you pass, as long as it belongs to the caller's own
schedule, is currently completed, and the schedule date is still editable —
there is no additional "and it must be the LAST one completed" check, and
no timestamp/ordering is consulted. This was a deliberate simplification
(no new bookkeeping needed — `isWorkoutExerciseCompleted` + the existing
`recomputeScheduleProgress` derivation were already sufficient) rather than
an oversight, but it means "most-recent-only" is currently a UI-layer
guarantee, not an API-layer one: the ONLY place `undoCompleteScheduleExercise`
is called from is the toast action rendered right after
`handleCompleteExercise` succeeds, which closure-captures the exact
`scheduleId`/`programExerciseId` it just completed and is only live for 8
seconds (`duration: 8_000`) before sonner auto-dismisses it. If a future
caller (e.g. a full session-history "edit past sets" screen) reuses this
same endpoint against an older completed exercise, it would work exactly as
a generic "un-complete this exercise" toggle, not reject it — worth
re-reading this note before doing so, since that caller would need its own
reasoning about whether un-completing an older set is safe in that context
(this pass never had to answer that question because it never arises).

## Verified results (2026-08-24)

Backend integration (`gymcoach_fitness_test`, `undo-complete-schedule-exercise.integration.test.ts`) — 4/4 pass:
- undo flips `completed` back to `false`, `recomputeScheduleProgress` reports
  one fewer completed exercise, and the just-submitted weight/reps values
  are preserved on the (now-uncompleted) `WorkoutSet` row, not blanked;
- undoing a never-completed exercise is rejected with 409;
- undo never touches a sibling exercise's own completion in the same
  session;
- undo on a locked (past-day) schedule is rejected with 409
  `SCHEDULE_DATE_LOCKED` (same `assertScheduleDateEditable` every other
  mutation on this schedule already uses).

`npx tsc --noEmit` clean (fitness-service). `npm run build` clean
(frontend/web).

Browser E2E (`fitnessassistant-playwright-e2e/tests/35-undo-last-set.spec.ts`) — 2/2 pass:
- `TC-UNDO-LAST-SET-01`: complete a non-final exercise (70kg) → view advances
  to the next exercise, rest timer starts, DB shows 1 completed set → toast
  `Đã hoàn thành "<name>"` with a "Hoàn tác" action appears → clicking it
  returns to the first exercise with 70kg still shown (editable, not
  blanked), rest timer gone, DB shows 0 completed sets for it, and the
  second (never-touched) exercise independently confirmed still at 0
  completed sets.
- `TC-UNDO-LAST-SET-02`: completing the FINAL (only) exercise of a day shows
  the whole-workout completion screen and NEVER renders a "Hoàn tác" button
  anywhere on the page — locks in the deliberate final-exercise scope
  boundary above.

Full regression re-run (specs 29–35: bodyweight PR/previous-performance,
TIME_LOAD/DISTANCE_TIME previous-performance, rest-timer persistence,
mobile logging modes, smart set prefill, session-resume draft persistence,
undo last set) — **24/24 pass** (10.3 min), confirming this slice introduced
no regression in the adjacent P0/P1.1/P1.7 surface it shares
`WorkoutLogPage.tsx` with. Global test-suite verdict: `READY (FAIL=0,
total=356)`.
