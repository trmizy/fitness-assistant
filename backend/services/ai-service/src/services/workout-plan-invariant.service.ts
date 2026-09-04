import type {
  AllowedExerciseItem,
  DayExerciseCatalog,
  PlanContent,
} from "../schemas/plan.schemas";

export type WorkoutPlanInvariantCode =
  | "days_per_week_mismatch"
  | "duplicate_day"
  | "invalid_day_order"
  | "empty_day"
  | "exercise_count_mismatch"
  | "invalid_exercise_id"
  | "exercise_outside_day_candidates"
  | "duplicate_exercise"
  | "invalid_exercise_order"
  | "invalid_sets"
  | "invalid_reps"
  | "invalid_rest";

export type WorkoutPlanInvariantViolation = {
  code: WorkoutPlanInvariantCode;
  path: string;
  message: string;
  actual?: unknown;
  expected?: unknown;
};

export type WorkoutPlanInvariantInput = {
  content: unknown;
  daysPerWeek: number;
  exercisesPerDay: number;
  allowedExercises: AllowedExerciseItem[];
  perDayCatalogs: DayExerciseCatalog[];
};

function normalizedDayKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function expectedDayNumber(value: unknown): number | null {
  const match = /^day\s+(\d+)$/i.exec(String(value ?? "").trim());
  return match ? Number(match[1]) : null;
}

/**
 * Authoritative, side-effect-free validation immediately before persistence.
 * Per-day catalogs are already filtered by goal, muscle taxonomy, location and
 * equipment; requiring membership prevents an otherwise valid global ID from
 * being placed in the wrong training slot.
 */
export function validateWorkoutPlanInvariants(
  input: WorkoutPlanInvariantInput,
): { ok: true; content: PlanContent } | { ok: false; violations: WorkoutPlanInvariantViolation[] } {
  const violations: WorkoutPlanInvariantViolation[] = [];
  const content = input.content as Partial<PlanContent> | null;
  const schedule = Array.isArray(content?.weeklySchedule)
    ? content.weeklySchedule
    : [];

  if (content?.daysPerWeek !== input.daysPerWeek || schedule.length !== input.daysPerWeek) {
    violations.push({
      code: "days_per_week_mismatch",
      path: "weeklySchedule",
      message: "Plan must contain exactly the requested number of training days",
      actual: { declared: content?.daysPerWeek, schedule: schedule.length },
      expected: input.daysPerWeek,
    });
  }

  const dayKeys = new Set<string>();
  const allowedIds = new Set(input.allowedExercises.map((exercise) => exercise.id));
  const catalogs = new Map(input.perDayCatalogs.map((catalog) => [catalog.dayIndex, catalog]));

  schedule.forEach((day, dayIndex) => {
    const dayPath = `weeklySchedule.${dayIndex}`;
    const key = normalizedDayKey(day?.day);
    if (dayKeys.has(key)) {
      violations.push({ code: "duplicate_day", path: `${dayPath}.day`, message: "Training day labels must be unique", actual: day?.day });
    }
    dayKeys.add(key);

    const parsedDayNumber = expectedDayNumber(day?.day);
    if (parsedDayNumber !== dayIndex + 1) {
      violations.push({ code: "invalid_day_order", path: `${dayPath}.day`, message: "Training days must use deterministic Day N order", actual: day?.day, expected: `Day ${dayIndex + 1}` });
    }

    const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
    if (exercises.length === 0) {
      violations.push({ code: "empty_day", path: `${dayPath}.exercises`, message: "A training day cannot be empty" });
    }
    if (exercises.length !== input.exercisesPerDay) {
      violations.push({ code: "exercise_count_mismatch", path: `${dayPath}.exercises`, message: "Each day must contain exactly the requested exercise count", actual: exercises.length, expected: input.exercisesPerDay });
    }

    const dayCandidateIds = new Set((catalogs.get(dayIndex)?.exercises ?? []).map((exercise) => exercise.id));
    const usedIds = new Set<string>();
    exercises.forEach((exercise, exerciseIndex) => {
      const path = `${dayPath}.exercises.${exerciseIndex}`;
      const exerciseId = String(exercise?.exerciseId ?? "").trim();
      if (!allowedIds.has(exerciseId)) {
        violations.push({ code: "invalid_exercise_id", path: `${path}.exerciseId`, message: "Exercise ID is not in the allowed catalog", actual: exerciseId });
      } else if (!dayCandidateIds.has(exerciseId)) {
        violations.push({ code: "exercise_outside_day_candidates", path: `${path}.exerciseId`, message: "Exercise is not valid for this day's taxonomy and constraints", actual: exerciseId });
      }
      if (usedIds.has(exerciseId)) {
        violations.push({ code: "duplicate_exercise", path: `${path}.exerciseId`, message: "An exercise cannot be duplicated within a day", actual: exerciseId });
      }
      usedIds.add(exerciseId);

      if (exercise?.order !== exerciseIndex + 1) {
        violations.push({ code: "invalid_exercise_order", path: `${path}.order`, message: "Exercise order must be contiguous and deterministic", actual: exercise?.order, expected: exerciseIndex + 1 });
      }
      if (!Number.isInteger(exercise?.sets) || exercise.sets < 1 || exercise.sets > 10) {
        violations.push({ code: "invalid_sets", path: `${path}.sets`, message: "Sets must be an integer between 1 and 10", actual: exercise?.sets });
      }
      if (typeof exercise?.reps !== "string" || exercise.reps.trim().length === 0) {
        violations.push({ code: "invalid_reps", path: `${path}.reps`, message: "Reps must be a non-empty prescription", actual: exercise?.reps });
      }
      if (!Number.isInteger(exercise?.restSeconds) || exercise.restSeconds < 0 || exercise.restSeconds > 600) {
        violations.push({ code: "invalid_rest", path: `${path}.restSeconds`, message: "Rest must be an integer between 0 and 600 seconds", actual: exercise?.restSeconds });
      }
    });
  });

  return violations.length === 0
    ? { ok: true, content: content as PlanContent }
    : { ok: false, violations };
}

