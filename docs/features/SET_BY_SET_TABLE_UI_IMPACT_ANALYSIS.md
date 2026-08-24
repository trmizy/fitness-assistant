# True Set-by-Set Table UI — Impact Analysis

Date: 2026-08-24. Roadmap: P1.1 "Smart set-by-set prefill" remaining item /
P1.6 "Fast active-workout interaction polish" (§11's own mockup is this
exact table). Milestone P1-A exit criterion.

## Problem

`WorkoutLogPage.tsx`'s active-exercise view currently treats an exercise as
ONE unit: one weight/reps/duration/distance input, one RPE/RIR pair, one
"Hoàn thành" button. Clicking it calls `completeScheduleExercise`, which
marks **every** `WorkoutSet` row for that exercise `completed = true` with
the SAME logged value — even when the program prescribes 3 or 5 sets. There
is no way today to log set 1 at one weight and set 3 at a different one, or
to see set-by-set "Previous"/"Recommended" reference the way the roadmap's
own target mockup (§6) shows:

```text
Set   Previous       Recommended      Today
1     100kg × 8      102.5kg × 8      [102.5] [8]  [✓]
2     100kg × 8      102.5kg × 8      [102.5] [8]  [✓]
3     100kg × 7      100kg × 8        [100.0] [8]  [✓]
```

## Audit findings (why this is smaller than it looks)

- `startSchedule` already pre-creates a `WorkoutExercise` + one `WorkoutSet`
  row **per planned set** (all `completed: false`) for every exercise in
  the day, the moment the user opens the active view — confirmed in
  `createStartedWorkoutForSchedule`. The per-set skeleton already exists in
  the DB by the time any logging UI renders; nothing new needs creating.
- `PATCH /workouts/sets/:setId` (`updateSet`) already accepts
  `{weight, reps, rpe, rir, bodyWeightAtSetKg, durationSeconds,
  distanceMeters, completed}` — everything one table row needs to log
  itself — and already calls `recomputeScheduleProgress` after writing.
  **No backend change is required for per-set logging.**
- `GET /workouts/:id` (`workoutService.getWorkout`, already wired in
  `frontend/web/src/app/services/api.ts`) already returns
  `exercises[].workoutSets[]` (id, setNumber, completed, and every logged
  field) ordered by `setNumber` — everything needed to render real rows
  with real ids.
- `GET .../previous-performance` already returns `sets[]` with a
  `setNumber` field — "Previous" can already be matched per row, it's just
  never been read that way (today's single-value UI always uses set 1's).
- The progression engine returns ONE `nextTarget`, not one per set number —
  "Recommended" in this pass is the SAME deterministic target repeated on
  every not-yet-completed row, exactly like the mockup's rows 1–2. Making
  row 3 differ the way the mockup shows (a genuinely different
  recommendation because set 3's own previous fell short) would require
  the progression engine to reason per-set, which is out of scope here —
  see "What we will NOT do" below.

Because of the above, this pass needs **zero new backend endpoints**. It
reuses `updateSet` (interior sets) and the existing, already-shipped
`completeScheduleExercise` / `undoCompleteScheduleExercise` (the set that
closes out — or reopens — the exercise) exactly as they already behave.

## Target behavior for this pass

- The "Ghi chép" card becomes a real table: one row per planned set.
- A completed row shows its persisted actual values, read-only, with a
  check mark — never editable again from this view.
- Exactly one row is ever "active" (editable): the first not-yet-completed
  set. Every later row shows its own Previous/Recommended as reference
  only, with no input yet — it becomes active once its turn comes.
- Completing the active row:
  - **not the exercise's last remaining set** → `PATCH
    /workouts/sets/:setId` with `completed: true` and the logged fields;
    locally advance to the next row, start the 90s rest timer, and clear
    the draft/prefill state so the new active row gets its own fresh
    prefill (never the just-completed row's stale values).
  - **the exercise's last remaining set** → the EXISTING
    `completeScheduleExercise` call, byte-for-byte unchanged from today —
    it already marks every set of the exercise complete (a no-op for the
    already-completed earlier rows) and returns the full
    `WorkoutProgressSummary` that drives `applyScheduleProgress` /
    whole-workout-completion / cycle-feedback, exactly as it does today.
    Nothing about the exercise-boundary/whole-workout path changes.
- Undo (roadmap P1.6, already shipped):
  - undoing the row that just closed out the exercise → the EXISTING
    `undoCompleteScheduleExercise` toast, unchanged.
  - undoing an interior row → a new, much simpler per-row undo: `PATCH
    /workouts/sets/:setId` with `completed: false`. No new endpoint.
- "Previous" per row uses the historical set with the **same set number**
  (new: `selectSmartSetPrefill`'s optional `targetSetNumber`, additive,
  defaults to the pre-existing "always set 1" behavior for every other
  caller) — set 3's reference is genuinely set 3's own history, not set
  1's, unlike every value shown on the page before this pass.
- RPE/RIR stay a single pair of sliders (not one per row) applying to
  whichever row is about to be completed next — matches how a lifter
  actually reports RPE/RIR (right after finishing that specific set), and
  keeps row density sane on mobile. The mockup itself doesn't show
  per-row RPE/RIR either.

## Layout decision (disclosed simplification vs. the literal mockup)

The mockup draws editable `[weight] [reps]` inputs INSIDE each table row.
This pass instead renders a compact **set overview table** (Set N /
Previous / Recommended / status) directly above the existing "Ghi chép"
input card, and keeps that card's already-shipped, mode-aware RulerSlider
inputs (weight/reps/duration/distance/RPE/RIR) exactly as they are today —
they now apply to whichever row the overview table highlights as active,
rather than rebuilding every logging-mode's input set inline inside each
table row. Net user-visible behavior is the same (see the row of previous/
recommended/today values, edit, one-tap complete, next set focuses
automatically) with far less blast radius on already-proven, heavily
logging-mode-branched JSX. If real usage feedback later wants literal
inline per-row inputs, that is a follow-up presentation-only change — the
underlying per-set completion/undo/prefill wiring built in this pass does
not need to change for it.

## What we will NOT do in this pass (deliberate MVP boundary)

- **Not** teaching the progression engine to produce a different
  recommendation per set number (row 3 ≠ rows 1–2 in the mockup) — that is
  a real engine change (`exercise-progression.engine.ts`), independently
  testable, and belongs in its own pass. "Recommended" stays flat across a
  given exercise's remaining sets this pass.
- **Not** adding per-row RPE/RIR inputs.
- **Not** touching the ad-hoc/freeform (no-schedule) logging branch —
  `persistCompletedWorkout`'s path has no pre-created `WorkoutSet`
  skeleton to key rows off of; it keeps its existing single-value-per-
  exercise behavior untouched, matching how undo-last-set was scoped.
- **Not** changing `completeScheduleExercise`'s own semantics — it is
  reused exactly as it already behaves for the exercise-closing set.
- **Not** rewriting the existing E2E specs 29–35. Every program those specs
  create uses `sets: 1`; for a 1-set exercise, "complete the exercise's
  only set" and "complete the exercise" are the exact same DB effect and
  the exact same UI action, on the exact same testids/labels (the active
  row keeps `data-testid="complete-exercise-button"` and the weight slider
  keeps its `Khối lượng tạ` label) — those specs are expected to keep
  passing unmodified. A new spec proves the genuinely-multi-set behavior.

## Domain invariants

- `recomputeScheduleProgress` (already called by both `updateSet` and
  `completeScheduleExercise`) remains the sole source of truth for
  exercise/schedule progress — the frontend's local "is this the last
  remaining set" check only decides WHICH existing endpoint to call next,
  it never substitutes for or races the server's own recompute.
  `completedExercises` (the `Set<number>` of exercise indices, driving the
  page's own progress ring) is only ever updated at the moment the
  EXISTING exercise-closing call succeeds — unchanged trigger point from
  today, just reached via a per-row path instead of always the first
  click.
- A prefilled-but-uncompleted row is never sent as completed (same
  invariant `selectSmartSetPrefill`/`completeScheduleExercise` already
  uphold; per-row `updateSet` calls explicitly pass `completed: true`,
  never rely on a default).
- Undoing an interior row never touches sibling rows (bare `updateSet` on
  one `setId`, same isolation `undoCompleteScheduleExercise` already
  proved for whole-exercise undo).

## Affected models

None. No schema change.

## Affected services

`fitness-service`: none (reuses `updateSet`, `completeScheduleExercise`,
`undoCompleteScheduleExercise` as-is).

## Affected frontend

- `smart-set-prefill.utils.ts`: additive `targetSetNumber` param + a
  `setNumber` field on `SmartPrefillPreviousSet` (both optional, default
  behavior unchanged — 14/14 unit tests, 3 new).
- `WorkoutLogPage.tsx`: the "Ghi chép" card becomes a per-set table for the
  schedule-linked (non-ad-hoc) logging path only; `handleCompleteExercise`
  is split into "complete the active row" (routes to `updateSet` or
  `completeScheduleExercise` depending on whether more sets remain) and a
  new lightweight per-row undo action.

## Migration risk / backward compatibility

None — additive only, same as every other slice this session.

## Bugs found and routed around during this pass

1. **`completeScheduleExercise`'s re-completion branch overwrites every
   sibling `WorkoutSet`.** Its `else if (performed)` branch runs
   `workoutSet.updateMany({ where: { workoutExerciseId }, data: { weight,
   reps, ... } })` — no `id`/`setNumber` filter — because in the pre-
   existing single-value-per-exercise model every sibling set always held
   the identical value anyway, so this was harmless. It stops being
   harmless the moment sets can hold genuinely different values (this
   pass's whole point). **Fix**: the per-set table NEVER calls
   `completeScheduleExercise` for a multi-set exercise, not even for the
   set that closes it out — every completion, interior or closing, goes
   through `updateSet` (which only ever touches the one targeted row).
   Proven directly by `per-set-completion.integration.test.ts`'s first
   test and by spec 36's own set-1-survives-set-2's-completion assertion.
2. **`updateSet`'s response carried no progress summary**, so the frontend
   had no way to learn "did that just close out the exercise" without a
   second round-trip. **Fix**: `workout.service.ts`'s `updateSet` now
   returns `{ ...updatedSet, progress }`, reusing the exact
   `recomputeScheduleProgress` call it already made internally (previously
   its result was just discarded) — additive, backward compatible with
   every existing caller that doesn't read `.progress`.
3. **The inline per-row "undo" button (✕) had no way to know a row it was
   undoing had been the one that closed out the exercise**, so undoing a
   completed row after navigating back to an already-finished exercise
   would leave `completedExercises`/`activeExIdx`/the whole-workout
   completion screen out of sync with the now-reopened set. **Fix**: the
   inline button only ever renders on the single most-recently-completed
   row (the row immediately before the active one, or the last row once
   every set is done — always unambiguous, since this table only ever lets
   sets complete in strict order), and passes the correct "was this the
   closing set" flag through to `handleUndoSetRow` so it reverses the
   right amount of state.

4. **Reaching the active-exercise view via a direct/deep-link URL never
   called `startSchedule`**, so no `WorkoutExercise`/`WorkoutSet` skeleton
   existed yet — meaning the table (and everything built on it: per-set
   undo, per-set prefill) would never appear via that landing path, and the
   first "Hoàn thành" click would silently fall straight to the old
   bulk-complete path instead, defeating this whole feature for what turned
   out to be the common case (confirmed by the new E2E spec initially
   failing this exact way — `openActiveExerciseForToday`'s direct-URL
   success path, the same one 5 pre-existing specs already relied on,
   reaches the logging UI without ever clicking "Bắt đầu tập"). **Fix**: the
   same effect that fetches the skeleton now eagerly calls `startSchedule`
   first when no workout exists yet (mirroring exactly what "Bắt đầu tập"
   already does), gated identically to that button (never on a locked day
   with no existing session) and only once per schedule. This is a real,
   user-visible behavior change beyond this feature's own scope — a session
   now formally "starts" (schedule status → `IN_PROGRESS`) the moment its
   active-exercise view is reached, not only on first explicit completion —
   so the full P0–P1.7 regression bundle was re-run afterward specifically
   to catch any assumption elsewhere that depended on the old lazy-start
   timing (see Verified results).

## Test plan

Unit: `smart-set-prefill.utils.test.ts` `targetSetNumber` coverage (done,
14/14).

Browser E2E (new spec): a 3-set exercise where set 1 and set 2 complete
independently (each its own weight, each starts a rest timer, each
"Previous" row matches its own set number), set 2 is undone via the
per-row undo and re-completed, and set 3 (the exercise-closing set) uses
the existing whole-exercise completion path and correctly advances to the
next exercise / shows the completion screen exactly as before. Full
regression re-run of specs 29–35 to confirm the 1-set-per-exercise
existing coverage is genuinely unaffected.

## Verified results (2026-08-24)

Backend integration (`gymcoach_fitness_test`,
`per-set-completion.integration.test.ts`) — 2/2 pass: sibling-set isolation
(set 1's 60kg survives set 2's 70kg completion) and set-granular progress
(`completedSets`/`totalSets` increment per set, `completedExercises` only
flips once every set is done). Pre-existing `updateSet`-adjacent tests
(`advanced-set-logging.integration.test.ts`,
`schedule-lock.integration.test.ts`) — 15/15 unaffected. `tsc --noEmit`
clean (fitness-service). `npm run build` clean (frontend/web).

Browser E2E (`36-set-by-set-table-ui.spec.ts`) — 1/1 pass, after fixing the
two real bugs #3 (missing effect dependencies — the fetch effect never
re-ran once `aiSchedules` loaded asynchronously after mount) and #4
(eager session start) documented above; first attempt failed exactly the
way bug #4 predicted (`set-overview-table` never appeared) before either
fix landed.

Full regression re-run (specs 29–36, all 8 P0/P1.1/P1.6/P1.7 specs
together) specifically to catch any hidden assumption about the old
lazy-session-start timing that bug #4's fix changed — **25/25 pass**
(10.9 min). Global test-suite verdict: `READY (FAIL=0, total=429)`.
