import { z } from 'zod';
import { WORKOUT_LIMITS } from '../utils/workout-validation';

const L = WORKOUT_LIMITS;

export const createWorkoutSchema = z.object({
  name: z.string().min(1, 'Workout name is required'),
  description: z.string().optional(),
  date: z
    .string()
    .datetime('Invalid date format')
    .refine(
      (d) => new Date(d) <= new Date(Date.now() + L.DATE_MAX_FUTURE_DAYS * 86_400_000),
      { message: `Date cannot be more than ${L.DATE_MAX_FUTURE_DAYS} days in the future` },
    )
    .optional(),
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
        exerciseId: z.string().min(1, 'Exercise ID is required'),
        sets: z
          .number()
          .int('Sets must be a whole number')
          .min(L.SETS_MIN, `Sets must be at least ${L.SETS_MIN}`)
          .max(L.SETS_MAX, `Sets cannot exceed ${L.SETS_MAX}`),
        reps: z
          .number()
          .int('Reps must be a whole number')
          .min(L.REPS_MIN, `Reps must be at least ${L.REPS_MIN}`)
          .max(L.REPS_MAX, `Reps cannot exceed ${L.REPS_MAX}`)
          .optional(),
        duration: z.number().int().positive().optional(),
        weight: z
          .number()
          .min(L.WEIGHT_MIN, 'Weight cannot be negative')
          .max(L.WEIGHT_MAX, `Weight cannot exceed ${L.WEIGHT_MAX} kg`)
          .optional(),
        notes: z.string().optional(),
      }),
    )
    .min(L.EXERCISES_MIN, 'At least one exercise is required')
    .max(L.EXERCISES_MAX, `A workout session cannot have more than ${L.EXERCISES_MAX} exercises`),
});

export const updateWorkoutSetSchema = z.object({
  reps: z.number().int().positive().optional(),
  weight: z.number().nonnegative().optional(),
  rpe: z.number().min(1).max(10).optional(),
  completed: z.boolean().optional(),
});

export const createNutritionSchema = z.object({
  date: z.string().datetime().optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  foodName: z.string().min(1),
  calories: z.number().int().positive(),
  protein: z.number().positive().optional(),
  carbs: z.number().positive().optional(),
  fats: z.number().positive().optional(),
  notes: z.string().optional(),
});

export type CreateWorkoutDto = z.infer<typeof createWorkoutSchema>;
export type UpdateWorkoutSetDto = z.infer<typeof updateWorkoutSetSchema>;
export type CreateNutritionDto = z.infer<typeof createNutritionSchema>;
