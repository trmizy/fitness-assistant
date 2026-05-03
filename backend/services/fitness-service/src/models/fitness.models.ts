import { z } from 'zod';

export const createWorkoutSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
  duration: z.number().int().positive().optional(),
  notes: z.string().optional(),
  exercises: z.array(
    z.object({
      // Existing datasets include non-UUID ids such as seed_ex_001.
      exerciseId: z.string().min(1),
      sets: z.number().int().positive(),
      reps: z.number().int().positive().optional(),
      duration: z.number().int().positive().optional(),
      weight: z.number().nonnegative().optional(),
      notes: z.string().optional(),
    }),
  ),
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
