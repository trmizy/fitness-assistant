import { z } from 'zod';

export const createWorkoutSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
  duration: z.number().int().positive().optional(),
  notes: z.string().optional(),
  exercises: z.array(
    z.object({
      exerciseId: z.string().uuid(),
      sets: z.number().int().positive(),
      reps: z.number().int().positive().optional(),
      duration: z.number().int().positive().optional(),
      weight: z.number().positive().optional(),
      notes: z.string().optional(),
    }),
  ),
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
export type CreateNutritionDto = z.infer<typeof createNutritionSchema>;
