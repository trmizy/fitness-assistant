import { z } from 'zod';

export const profileSchema = z.object({
  age: z.number().int().min(13).max(120).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  heightCm: z.number().positive().optional(),
  goal: z
    .enum(['WEIGHT_LOSS', 'MUSCLE_GAIN', 'MAINTENANCE', 'ATHLETIC_PERFORMANCE'])
    .optional(),
  activityLevel: z
    .enum([
      'SEDENTARY',
      'LIGHTLY_ACTIVE',
      'MODERATELY_ACTIVE',
      'VERY_ACTIVE',
      'EXTREMELY_ACTIVE',
    ])
    .optional(),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  preferredTrainingDays: z.array(z.number().int().min(0).max(6)).optional(),
  availableEquipment: z.array(z.string()).optional(),
  injuries: z.array(z.string()).optional(),
  currentWeight: z.number().positive().optional(),
  targetWeight: z.number().positive().optional(),
});

export type ProfileDto = z.infer<typeof profileSchema>;
