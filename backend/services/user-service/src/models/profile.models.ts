import { z } from "zod";

export const profileSchema = z.object({
  dateOfBirth: z.string().optional(), // ISO date string e.g. "2000-01-15"
  age: z.number().int().min(13).max(120).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  heightCm: z.number().positive().optional(),
  goal: z
    .enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"])
    .optional(),
  activityLevel: z
    .enum([
      "SEDENTARY",
      "LIGHTLY_ACTIVE",
      "MODERATELY_ACTIVE",
      "VERY_ACTIVE",
      "EXTREMELY_ACTIVE",
    ])
    .optional(),
  experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  // Distinguishes a competing/professional athlete from an ADVANCED
  // recreational lifter — see docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0
  // for why this is a separate flag rather than a 5th experienceLevel value.
  competesInSport: z.boolean().optional(),
  preferredTrainingDays: z.array(z.number().int().min(0).max(6)).optional(),
  availableEquipment: z.array(z.string()).optional(),
  injuries: z.array(z.string()).optional(),
  currentWeight: z.number().positive().optional(),
  targetWeight: z.number().positive().optional(),
  dietaryPreference: z.string().optional(),
  photoUrl: z.string().optional(),
  // Advisory/UI-only free text (e.g. "Full Body", "Push/Pull/Legs") — never
  // read by the Decision Engine, which only reasons about actually-logged
  // sessions. Capped to a sane length since it's free text from a client.
  preferredSplit: z.string().max(100).optional(),
  // Set true only by OnboardingWizardPage's final submit step — distinct
  // from "has some profile fields filled in" via the plain edit form.
  hasCompletedOnboarding: z.boolean().optional(),
});

export const adminPTStatusSchema = z.object({
  isPT: z.boolean(),
});

export type ProfileDto = z.infer<typeof profileSchema>;
export type AdminPTStatusDto = z.infer<typeof adminPTStatusSchema>;
