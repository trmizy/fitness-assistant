/**
 * Pure logic for merging a real logged Workout (from workoutCache, keyed by
 * calendar date) onto the plan's exercise template — both the per-exercise
 * weight/RPE/RIR values AND which exercises are actually complete.
 *
 * Extracted out of WorkoutLogPage.tsx's day-selection effect so the exact
 * computation behind the completion percentage / "Xong X/Y" counter is
 * independently testable — this is the logic implicated in the reported
 * "one session shows 0% then becomes 100% after reload" bug: before the
 * URL/selectedDate restoration fix (see workout-log-url.utils.ts), the
 * caller looked up workoutCache using the WRONG calendar date (today,
 * post-reload) instead of the date actually being viewed, so this merge
 * silently ran against an empty/wrong cached workout and produced 0%. The
 * merge logic itself (below) was always correct — the bug was entirely in
 * which cachedWorkout got passed in. This test file locks down the merge
 * side of that contract so a future regression in the merge algorithm
 * itself (e.g. an off-by-one in "every set must be completed") would also
 * be caught, not just the date-lookup side.
 */

export interface ExerciseMergeTemplate {
  dbId: string;
  weight?: number | null;
  rpe?: number | null;
  rir?: number | null;
}

interface LoggedWorkoutSet {
  completed?: boolean;
  rpe?: number | null;
  rir?: number | null;
}

interface LoggedWorkoutExercise {
  exerciseId: string;
  weight?: number | null;
  workoutSets?: LoggedWorkoutSet[];
}

export interface CachedWorkoutForMerge {
  exercises?: LoggedWorkoutExercise[];
}

export interface MergeRealWorkoutDataResult<T> {
  merged: T[];
  completedIndices: Set<number>;
}

/**
 * `completedIndices` only ever grows from real, explicit per-set
 * `completed` flags — never inferred from "a WorkoutExercise row exists"
 * alone (an exercise can be logged with 0/3 sets actually completed, and
 * must NOT count as done).
 */
export function mergeRealWorkoutData<T extends ExerciseMergeTemplate>(
  templateExercises: readonly T[],
  cachedWorkout: CachedWorkoutForMerge | null | undefined,
): MergeRealWorkoutDataResult<T> {
  const completedIndices = new Set<number>();

  if (!cachedWorkout?.exercises?.length) {
    return { merged: [...templateExercises], completedIndices };
  }

  const loggedByExerciseId = new Map<string, LoggedWorkoutExercise>(
    cachedWorkout.exercises.map((we) => [we.exerciseId, we]),
  );

  const merged = templateExercises.map((ex, index) => {
    const logged = loggedByExerciseId.get(ex.dbId);
    if (!logged) return ex;

    const sets = logged.workoutSets ?? [];
    if (sets.length > 0 && sets.every((s) => s.completed)) {
      completedIndices.add(index);
    }

    return {
      ...ex,
      weight: logged.weight ?? null,
      rpe: sets[0]?.rpe ?? null,
      rir: sets[0]?.rir ?? null,
    };
  });

  return { merged, completedIndices };
}
