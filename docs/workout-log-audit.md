# Workout Log Audit

## Source Of Truth

- Plan template: `workout_programs`, `workout_program_days`, `workout_program_exercises`.
- Calendar/day state: `workout_schedules`.
- Workout session/log: `workouts`, `workout_exercises`, `workout_sets`.
- A `WorkoutSchedule` links a planned day to the real session through `workout_id`.
- A `WorkoutExercise` now links back to its planned exercise through `program_exercise_id`.
- `program_exercise_id` is the canonical key for planned exercise completion. `exercise_id` is only the global exercise template and can repeat inside one planned day.

## Completion Fields

- `workout_sets.completed`: source of truth for set completion.
- `workout_exercises.program_exercise_id`: maps a logged exercise to the planned exercise.
- `workout_schedules.status`: cached day/session state: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`.
- `workout_schedules.progress_percent`: cached progress for UI.
- `workout_schedules.started_at` and `completed_at`: lifecycle timestamps.
- `workout_schedules.total_exercises`, `completed_exercises`, `total_sets`, `completed_sets`: cached counters recomputed from logs.

## Schema Notes

- Migration required: `20260709000000_add_workout_exercise_program_link`.
- Run after pulling this change:

```bash
pnpm --filter @gym-coach/fitness-service run db:generate
pnpm --filter @gym-coach/fitness-service run db:migrate
```

- `WorkoutExercise` has a unique constraint on `[workoutId, programExerciseId]`.
- In Postgres, unique indexes allow multiple `NULL` values, so legacy rows without `program_exercise_id` are not blocked.
- No database FK is added from `workout_exercises.program_exercise_id` to `workout_program_exercises.id` yet. The service validates membership by `scheduleId + userId + programDayId` for backward compatibility with existing data and generated Prisma clients.
- Prisma generated files under `backend/services/fitness-service/src/generated/prisma` are tracked by this repo. Do not edit them manually; regenerate them with `db:generate`.

## Progress Formula

```ts
progressPercent =
  totalExercises === 0
    ? 0
    : Math.round((completedExercises / totalExercises) * 100);
```

The backend recomputes this after start, quick complete, and set updates. The UI should display the backend value and only use local state for immediate active-session row highlighting.

## Data Flow

Start workout:

- UI: `WorkoutLogPage` calls `workoutService.startSchedule(scheduleId)`.
- API: `POST /workouts/schedules/:id/start`.
- Backend: creates a `Workout` session if missing, creates `WorkoutExercise` rows for each planned exercise, creates incomplete `WorkoutSet` rows, updates `WorkoutSchedule` to `IN_PROGRESS`.
- Response: progress contract with `workoutId`, counters, status, and progress percent.

Quick complete exercise:

- UI: `WorkoutLogPage.handleCompleteExercise`.
- API: `POST /workouts/schedules/:id/exercises/:programExerciseId/complete`.
- Backend: validates `userId`, schedule, and planned exercise membership; starts session if needed; marks all sets for that planned exercise complete; recomputes schedule counters/status.
- Response: latest progress contract.

Refresh:

- UI refetches `/workouts/schedules` and `/workouts/programs/current`.
- Persisted schedule progress remains the display source.

## Root Cause

The old UI tracked completed exercises in `completedExercises: Set<number>` only in React state. Backend persistence happened only when all exercises were completed through `persistCompletedWorkout()`. This meant partial progress was never persisted. In addition, the "Training Days" card read `w.progress`, but `currentProgram.days` does not provide a `progress` field, so the card could show `0%` even when schedule progress existed.

## Mismatch Risks Found

- Template exercise ID vs planned exercise ID: fixed by adding `workout_exercises.program_exercise_id`.
- Session/day mismatch: fixed by requiring `scheduleId + userId` and planned exercise membership.
- Duplicate exercise in one day: now safe because completion maps by planned exercise ID, not global exercise ID.
- Stale frontend cache: reduced by updating `aiSchedules` immediately from mutation response and refetching after completion.
- Multiple cached fields: still present by design, but recomputed by backend service logic and checkable with `workout:check-consistency`.
- Timezone: schedules use date-only parsing in UI and service local date helpers. Weekly count should use schedule `COMPLETED` status rather than raw workout date when expanded later.

## Consistency Checker

Dry run:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run
```

Strict CI mode:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run --strict
```

Safe repair mode only recomputes cached schedule fields and timestamps:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --fix-safe
```

If the local database has not applied the migration, the script prints:

```text
Migration missing: apply migration 20260709000000_add_workout_exercise_program_link and run prisma generate.
```

The checker does not delete data.

## API Contract

After quick complete, the API returns:

```json
{
  "sessionId": "...",
  "workoutId": "...",
  "planId": "...",
  "dayId": "...",
  "exerciseId": "...",
  "programExerciseId": "...",
  "exerciseCompleted": true,
  "completedExercises": 4,
  "totalExercises": 4,
  "completedSets": 12,
  "totalSets": 12,
  "progressPercent": 100,
  "sessionStatus": "completed",
  "dayStatus": "completed",
  "completedAt": "..."
}
```

## Session State Machine (as actually implemented)

`WorkoutSchedule.status` is the persisted state. It is never set directly by
any request handler — every mutation (`startSchedule`, `completeScheduleExercise`,
`addSet`, `updateSet`, `createWorkout`, `updateWorkout`) ends by calling
`recomputeScheduleProgress` (`workout.service.ts`), which re-derives `status`,
`progressPercent`, and the four counters from the real `WorkoutSet.completed`
flags every time. The server never trusts a client-supplied percent/status —
this is what makes "0% then flips to 100% after reload" a client-side bug
class (stale/misdirected read of already-correct server state) rather than a
data-integrity bug (the stored number itself was never wrong).

States and transitions:

| Status | Meaning | Set by |
|---|---|---|
| `NOT_STARTED` | Schedule exists, no session started, 0 exercises completed | Default at creation |
| `IN_PROGRESS` | A `Workout` exists for this schedule (`workoutId` set) or at least one exercise is completed, but not all | `recomputeScheduleProgress`, whenever `completedExercises < totalExercises` and (`workoutId` or `startedAt` or `completedExercises > 0`) |
| `COMPLETED` | Every planned exercise has every one of its sets marked `completed` | `recomputeScheduleProgress`, whenever `completedExercises === totalExercises` and `totalExercises > 0` |
| `SKIPPED` | Valid schema value | **Not currently written by any code path** — see Known Gaps below |

Editability overlay (orthogonal to the status above): `schedule-lock.util.ts`'s
`assertScheduleDateEditable` blocks every one of the mutating endpoints above
whenever `WorkoutSchedule.date` is strictly before "today" in
`Asia/Ho_Chi_Minh` (`APP_SCHEDULE_TIME_ZONE`), regardless of `status`. This is
enforced server-side (`ScheduleLockedError`, HTTP 409, code
`SCHEDULE_DATE_LOCKED`) — see `schedule-lock.integration.test.ts`, which
exercises this against the real service/DB for every mutating endpoint, not
just via frontend-disabled buttons. The frontend's `schedule-lock.utils.ts` is
an explicit *mirror* used only for early UI feedback (disabling buttons,
calendar styling); its own doc comment states it must never be the only
enforcement layer.

Reload/restoration correctness: the frontend has no independent notion of
"which day am I looking at" beyond what the URL says. `WorkoutLogPage`
restores `selectedDate` from the URL's `date=YYYY-MM-DD` param at mount
(`workout-log-url.utils.ts`); before this fix, `selectedDate` always
re-initialized to `new Date()` (today) on a fresh mount, which is the
documented root cause of the "past day looks editable again after reload"
regression — the lock check and the completion-merge below were both being
evaluated against *today's* date instead of the date actually on screen.

## Unified Metrics (what each number actually measures)

Multiple screens historically showed different numbers under similar labels
because they measured genuinely different things without saying so. Current
canonical sources, after this pass:

| Label | Formula | Source |
|---|---|---|
| "Đã hoàn thành" (Workout Log overview) | count of `WorkoutSchedule` rows with `status = COMPLETED` in the trailing `days` window (default 30) | `statsService.getWorkoutStats` → `workoutRepository.countCompletedSchedules` |
| "Tuần này" (`weeklyWorkouts`) | count of `WorkoutSchedule` rows with `status = COMPLETED` within the current Mon-Sun week, computed in `Asia/Ho_Chi_Minh` | `statsService.getWorkoutStats` → `currentWeekRange` (`schedule-lock.util.ts`) + `countCompletedSchedules` |
| Cycle-scoped "Tuân thủ buổi tập" (adherence %) | completed / (completed + missed) sessions strictly inside the training cycle's own date range | `training-cycle-metrics.service.ts` computeAdherence, surfaced via `CycleAssessment.computedMetrics` or the legacy `TrainingCycle.summary` |
| Per-exercise completion (`progressPercent` on a schedule) | `completedExercises / totalExercises` for that one session | `recomputeScheduleProgress` |

Previously, `statsService.getWorkoutStats`'s `totalWorkouts` counted raw
`Workout` table rows (any logged workout, even ones never tied to a
`COMPLETED` schedule — e.g. a re-log, or a workout logged without a schedule
at all), which is why the overview page could show a materially larger
number ("58") than the same cycle's report ("21 completed"). These were
never meant to be the same metric (one is a rolling recent-activity count,
the other is cycle-scoped), but nothing distinguished them by name or
definition. The fix keeps them as two intentionally different numbers, but
now both derive from the same canonical "completed" predicate
(`WorkoutSchedule.status === "COMPLETED"`), so at least neither one overcounts
against the other's own definition of "completed." See
`stats.service.integration.test.ts` for regression coverage (a raw untied
`Workout` row must not inflate `totalWorkouts`; `weeklyWorkouts` must only
count sessions inside the current calendar week).

`weeklyWorkouts` did not exist in the backend response at all before this
fix — the frontend's "Tuần này" tile was reading `workoutStats?.weeklyWorkouts`
and silently falling back to a hardcoded `0`, unconditionally, regardless of
real activity.

## Known Gaps (honest state, not yet built)

- `SKIPPED` is a valid `WorkoutSchedule.status` value in the schema but no
  code path writes it. In practice, a past day that was never started simply
  stays `NOT_STARTED` forever — there is no distinct "missed" terminal state
  a user or report can query for. A real "missed" concept today is inferred
  ad hoc wherever it's needed (e.g. cycle adherence treats a past
  `NOT_STARTED`/incomplete schedule as "missed" for that one calculation) —
  it is not a first-class, uniformly-readable state on the schedule itself.
- There is no distinct `PARTIALLY_COMPLETED` status — a session with 1 of 4
  exercises done is `IN_PROGRESS`, same as one just started. The real partial
  progress is still fully recoverable from `completedExercises`/`totalExercises`,
  just not from `status` alone.
- There is no `CANCELLED` status and no coach/admin override path with an
  audit log — out of scope for this pass since no coach/admin role exists
  yet in this codebase for workout schedules.
- Adding these as genuinely distinct, persisted states (rather than derived
  ad hoc per call site) would need a schema migration plus an audit of every
  reader of `WorkoutSchedule.status` across fitness-service, training-cycle
  metrics, and the frontend — flagged here as a follow-up, not attempted in
  this pass, to avoid a wide-blast-radius change without dedicated review.
