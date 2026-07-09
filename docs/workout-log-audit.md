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
progressPercent = totalExercises === 0
  ? 0
  : Math.round((completedExercises / totalExercises) * 100)
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
