import { z } from "zod";
import { WORKOUT_LIMITS } from "../utils/workout-validation";

const L = WORKOUT_LIMITS;

// Advanced/professional-athlete set-logging fields (WorkoutSet.setType,
// .side). Plain string enums validated here at the app layer rather than a
// DB enum, matching this codebase's existing convention for
// WorkoutSchedule.status. "Top set"/"back-off set" naming follows common
// powerlifting-coaching practice (not a peer-reviewed classification) — see
// docs/advanced-set-logging.md.
export const SET_TYPES = ["WARMUP", "WORKING", "TOP", "BACKOFF", "FAILURE"] as const;
export const SET_SIDES = ["LEFT", "RIGHT", "BOTH"] as const;

const advancedSetFields = {
  setType: z.enum(SET_TYPES).optional().nullable(),
  tempo: z.string().max(20).optional().nullable(),
  rangeOfMotion: z.string().max(40).optional().nullable(),
  side: z.enum(SET_SIDES).optional().nullable(),
  painScore: z.number().int().min(0).max(10).optional().nullable(),
  techniqueNotes: z.string().max(500).optional().nullable(),
};

export const aiPlanExerciseSchema = z.object({
  exerciseId: z.string().min(1, "Exercise ID is required"),
  order: z.number().int().min(1).max(30).optional(),
  name: z.string().min(1, "Exercise name is required").max(200),
  sets: z.number().int().min(1).max(10),
  reps: z
    .union([z.number().int().positive(), z.string().min(1).max(50)])
    .transform(String),
  restSeconds: z.number().int().min(0).max(600),
  note: z.string().max(300).optional(),
  muscleGroup: z.string().max(120).optional(),
  equipment: z.string().max(120).optional(),
  intensity: z.string().max(120).optional(),
});

export const aiPlanDaySchema = z.object({
  day: z
    .union([z.string().min(1).max(50), z.number().int().min(1).max(31)])
    .optional(),
  goal: z.string().max(200).optional(),
  focus: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
  cardio: z.string().max(300).optional(),
  exercises: z
    .array(aiPlanExerciseSchema)
    .min(1, "each day must have at least one exercise"),
});

export const importAiPlanSchema = z.object({
  sourcePlanId: z.string().uuid("sourcePlanId must be a valid UUID"),
  sourcePlanVersion: z.number().int().min(1).optional(),
  sourcePlanName: z.string().min(1).max(200).optional(),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
    .optional(),
  repeatWeeks: z.number().int().min(1).max(52).optional(),
  selectedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeklySchedule: z
    .array(aiPlanDaySchema)
    .min(1, "weeklySchedule must not be empty"),
  /** true (default) = archive existing programs + delete their incomplete schedules before importing */
  replaceExisting: z.boolean().default(true).optional(),
});

export const manualProgramExerciseSchema = z.object({
  exerciseId: z.string().min(1, "Exercise ID is required"),
  order: z.number().int().min(1).max(30).optional(),
  sets: z.number().int().min(1).max(10).default(3),
  reps: z.number().int().min(1).max(100).default(10),
  restSeconds: z.number().int().min(0).max(600).default(90),
  notes: z.string().max(300).optional().nullable(),
});

export const manualProgramDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  exercises: z
    .array(manualProgramExerciseSchema)
    .min(1, "each day must have at least one exercise"),
});

export const createManualProgramSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(200).optional().nullable(),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  repeatWeeks: z.number().int().min(1).max(52).optional(),
  selectedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  replaceExisting: z.boolean().default(true).optional(),
  days: z.array(manualProgramDaySchema).min(1).max(7),
});

export type AiPlanExerciseDto = z.infer<typeof aiPlanExerciseSchema>;
export type AiPlanDayDto = z.infer<typeof aiPlanDaySchema>;
export type ImportAiPlanDto = z.infer<typeof importAiPlanSchema>;
export type CreateManualProgramDto = z.infer<typeof createManualProgramSchema>;

export const createWorkoutSchema = z
  .object({
    scheduleId: z.string().uuid().optional(),
    name: z.string().min(1, "Workout name is required"),
    description: z.string().optional(),
    date: z.string().datetime("Invalid date format").optional(),
    duration: z
      .number()
      .int()
      .min(L.DURATION_MIN, `Duration must be at least ${L.DURATION_MIN} minute`)
      .max(L.DURATION_MAX, `Duration cannot exceed ${L.DURATION_MAX} minutes`)
      .optional(),
    notes: z.string().optional(),
    exercises: z
      .array(
        z.object({
          // Note: existing datasets use non-UUID ids such as seed_ex_001
          exerciseId: z.string().min(1, "Exercise ID is required"),
          programExerciseId: z.string().min(1).optional().nullable(),
          sets: z
            .number()
            .int("Sets must be a whole number")
            .min(L.SETS_MIN, `Sets must be at least ${L.SETS_MIN}`)
            .max(L.SETS_MAX, `Sets cannot exceed ${L.SETS_MAX}`),
          reps: z
            .number()
            .int("Reps must be a whole number")
            .min(L.REPS_MIN, `Reps must be at least ${L.REPS_MIN}`)
            .max(L.REPS_MAX, `Reps cannot exceed ${L.REPS_MAX}`)
            .optional(),
          duration: z.number().int().positive().optional(),
          bodyWeightAtSetKg: z.number().positive().max(500).optional(),
          durationSeconds: z.number().int().positive().max(36000).optional(),
          distanceMeters: z.number().nonnegative().max(1000000).optional(),
          weight: z
            .number()
            .min(L.WEIGHT_MIN, "Weight cannot be negative")
            .max(L.WEIGHT_MAX, `Weight cannot exceed ${L.WEIGHT_MAX} kg`)
            .optional(),
          rpe: z.number().min(1).max(10).optional(),
          rir: z.number().int().min(0).max(5).optional(),
          completed: z.boolean().optional(),
          notes: z.string().optional(),
          ...advancedSetFields,
        }),
      )
      .min(L.EXERCISES_MIN, "At least one exercise is required")
      .max(
        L.EXERCISES_MAX,
        `A workout session cannot have more than ${L.EXERCISES_MAX} exercises`,
      ),
  })
  .superRefine((data, ctx) => {
    if (!data.date || data.scheduleId) return;
    const maxFuture = new Date(
      Date.now() + L.DATE_MAX_FUTURE_DAYS * 86_400_000,
    );
    if (new Date(data.date) > maxFuture) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: `Date cannot be more than ${L.DATE_MAX_FUTURE_DAYS} days in the future`,
      });
    }
  });

export const updateWorkoutSetSchema = z.object({
  reps: z.number().int().positive().optional(),
  weight: z.number().nonnegative().optional(),
  rpe: z.number().min(1).max(10).optional(),
  rir: z.number().int().min(0).max(5).optional(),
  bodyWeightAtSetKg: z.number().positive().max(500).optional().nullable(),
  durationSeconds: z.number().int().positive().max(36000).optional().nullable(),
  distanceMeters: z.number().nonnegative().max(1000000).optional().nullable(),
  completed: z.boolean().optional(),
  ...advancedSetFields,
});

// Hardening pass §3 — POST /workouts/schedules/:id/exercises/:programExerciseId/complete
// previously took no body at all, so it always logged the PLANNED
// exerciseId/weight/reps regardless of what the user actually entered in
// WorkoutLogPage's "Ghi chép" card, and a session-only exercise swap
// (SwapExerciseModal) was silently lost the moment the exercise was marked
// complete via this (the common, schedule-linked) path — only the rarely-hit
// ad-hoc createWorkout path ever recorded what was truly performed. All
// fields optional and additive: omitting the body preserves the exact old
// behavior (falls back to the planned values), never a breaking change.
export const completeScheduleExerciseSchema = z.object({
  exerciseId: z.string().uuid().optional(),
  weight: z.number().nonnegative().optional(),
  reps: z.number().int().positive().optional(),
  rpe: z.number().min(1).max(10).optional(),
  rir: z.number().int().min(0).max(5).optional(),
  bodyWeightAtSetKg: z.number().positive().max(500).optional(),
  notes: z.string().max(500).optional(),
  // TIME / TIME_LOAD / DISTANCE_TIME logging modes (openGym P0-completion
  // pass — docs/OPENGYM_P0_COMPLETION_REPORT.md). Additive, same pattern as
  // every field above: omitting them preserves the exact old behavior.
  // Genuinely separate columns from `weight`/`reps` — a plank's duration
  // must never be silently stored as "kg" (a real bug this pass found and
  // fixed; see the report's "Bugs found" section for the mechanism).
  durationSeconds: z.number().int().positive().max(36000).optional(),
  distanceMeters: z.number().nonnegative().max(1000000).optional(),
});

export const createNutritionSchema = z.object({
  date: z.string().datetime().optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  foodName: z.string().min(1),
  calories: z.number().int().positive(),
  protein: z.number().positive().optional(),
  carbs: z.number().positive().optional(),
  fats: z.number().positive().optional(),
  notes: z.string().optional(),
});

export const upsertNutritionGoalSchema = z.object({
  calories: z.number().int().positive(),
  protein: z.number().positive(),
  carbs: z.number().positive(),
  fat: z.number().positive(),
  waterMl: z.number().int().positive().optional().nullable(),
  // "RECOMMENDED" (app-calculated, default) | "CUSTOM" (user hand-entered).
  // Optional so existing callers that never send this keep working exactly
  // as before.
  goalMode: z.enum(["RECOMMENDED", "CUSTOM"]).optional(),
});

export type CreateWorkoutDto = z.infer<typeof createWorkoutSchema>;
export type UpdateWorkoutSetDto = z.infer<typeof updateWorkoutSetSchema>;
export type CompleteScheduleExerciseDto = z.infer<typeof completeScheduleExerciseSchema>;
export type CreateNutritionDto = z.infer<typeof createNutritionSchema>;
export type UpsertNutritionGoalDto = z.infer<typeof upsertNutritionGoalSchema>;
