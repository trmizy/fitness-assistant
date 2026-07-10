/**
 * Pure validation helpers — no npm dependencies, only Node built-ins.
 * Importable in unit tests without any package installation.
 * The Zod schema in fitness.models.ts mirrors these same bounds.
 */

export const WORKOUT_LIMITS = {
  SETS_MIN: 1,
  SETS_MAX: 20,
  REPS_MIN: 1,
  REPS_MAX: 100,
  WEIGHT_MIN: 0,
  WEIGHT_MAX: 500,
  EXERCISES_MIN: 1,
  EXERCISES_MAX: 30,
  DURATION_MIN: 1,
  DURATION_MAX: 600,
  DATE_MAX_FUTURE_DAYS: 7,
} as const;

export function validateSets(sets: number): string | null {
  if (!Number.isInteger(sets)) return "Sets must be a whole number";
  if (sets < WORKOUT_LIMITS.SETS_MIN)
    return `Sets must be at least ${WORKOUT_LIMITS.SETS_MIN}`;
  if (sets > WORKOUT_LIMITS.SETS_MAX)
    return `Sets cannot exceed ${WORKOUT_LIMITS.SETS_MAX}`;
  return null;
}

export function validateReps(reps: number): string | null {
  if (!Number.isInteger(reps)) return "Reps must be a whole number";
  if (reps < WORKOUT_LIMITS.REPS_MIN)
    return `Reps must be at least ${WORKOUT_LIMITS.REPS_MIN}`;
  if (reps > WORKOUT_LIMITS.REPS_MAX)
    return `Reps cannot exceed ${WORKOUT_LIMITS.REPS_MAX}`;
  return null;
}

export function validateWeight(weight: number): string | null {
  if (weight < WORKOUT_LIMITS.WEIGHT_MIN) return "Weight cannot be negative";
  if (weight > WORKOUT_LIMITS.WEIGHT_MAX)
    return `Weight cannot exceed ${WORKOUT_LIMITS.WEIGHT_MAX} kg`;
  return null;
}

export function validateExercisesCount(count: number): string | null {
  if (count < WORKOUT_LIMITS.EXERCISES_MIN)
    return "At least one exercise is required";
  if (count > WORKOUT_LIMITS.EXERCISES_MAX) {
    return `A workout session cannot have more than ${WORKOUT_LIMITS.EXERCISES_MAX} exercises`;
  }
  return null;
}

export function validateDuration(minutes: number): string | null {
  if (!Number.isInteger(minutes)) return "Duration must be a whole number";
  if (minutes < WORKOUT_LIMITS.DURATION_MIN)
    return `Duration must be at least ${WORKOUT_LIMITS.DURATION_MIN} minute`;
  if (minutes > WORKOUT_LIMITS.DURATION_MAX)
    return `Duration cannot exceed ${WORKOUT_LIMITS.DURATION_MAX} minutes`;
  return null;
}

export function validateWorkoutDate(isoDate: string): string | null {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "Invalid date format";
  const maxFuture = new Date(
    Date.now() + WORKOUT_LIMITS.DATE_MAX_FUTURE_DAYS * 86_400_000,
  );
  if (d > maxFuture) {
    return `Date cannot be more than ${WORKOUT_LIMITS.DATE_MAX_FUTURE_DAYS} days in the future`;
  }
  return null;
}

export function validateExerciseId(id: string): string | null {
  if (!id || !id.trim()) return "Exercise ID is required";
  return null;
}

export function checkMissingExerciseIds(
  requestedIds: string[],
  existingIds: Set<string>,
): string[] {
  return requestedIds.filter((id) => !existingIds.has(id));
}

export function formatZodErrors(
  errors: Array<{ path: (string | number)[]; message: string }>,
): Array<{ field: string; message: string }> {
  return errors.map((e) => ({
    field: e.path.join(".") || "root",
    message: e.message,
  }));
}
