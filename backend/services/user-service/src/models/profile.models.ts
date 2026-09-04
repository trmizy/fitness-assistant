import { z } from "zod";

export const profileSchema = z.object({
  dateOfBirth: z.string().optional(), // ISO date string e.g. "2000-01-15"
  age: z.number().int().min(13).max(120).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  heightCm: z.number().positive().optional(),
  goal: z
    .enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"])
    .optional(),
  // Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.2. Same
  // .nullable() reasoning as preferredSplit below: the DB column is nullable and the profile
  // repository does a partial Prisma update (an omitted key leaves the column untouched), so
  // an explicit `null` is the only way to clear a previously-set activityLevel back to unset
  // — real bug found via the onboarding Playwright spec's own snapshot-restore step (the
  // exact same failure mode preferredSplit already hit) once OnboardingWizardPage started
  // actually asking for this field instead of leaving it permanently null/fabricated.
  activityLevel: z
    .enum([
      "SEDENTARY",
      "LIGHTLY_ACTIVE",
      "MODERATELY_ACTIVE",
      "VERY_ACTIVE",
      "EXTREMELY_ACTIVE",
    ])
    .optional()
    .nullable(),
  experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  // Distinguishes a competing/professional athlete from an ADVANCED
  // recreational lifter — see docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0
  // for why this is a separate flag rather than a 5th experienceLevel value.
  competesInSport: z.boolean().optional(),
  // Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.6.
  // `safetyScreeningFlags` holds question KEYS (not question text) answered "Yes" — the
  // OnboardingWizardPage computes `safetyScreeningStatus` itself (CLEARED if the flags array
  // it's about to send is empty, FOLLOW_UP_SUGGESTED otherwise) rather than the backend
  // re-deriving it, since the set of flag keys that count as "a Yes" is a UI/copy concern,
  // not a business rule this service should own.
  safetyScreeningStatus: z.enum(["UNKNOWN", "CLEARED", "FOLLOW_UP_SUGGESTED"]).optional(),
  safetyScreeningFlags: z.array(z.string()).optional(),
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
  // .nullable() (in addition to .optional()) matters: the DB column is
  // nullable and the profile repository does a partial Prisma update
  // (omitted keys are left untouched), so an explicit `null` is the ONLY
  // way to clear a previously-set split back to "no preference" — omitting
  // the key (the old undefined-only shape) can never do that. Found via the
  // onboarding Playwright spec's snapshot-restore step failing to restore a
  // null preferredSplit back to null after the wizard set it to a real value.
  preferredSplit: z.string().max(100).optional().nullable(),
  // Set true only by OnboardingWizardPage's final submit step — distinct
  // from "has some profile fields filled in" via the plain edit form.
  hasCompletedOnboarding: z.boolean().optional(),
  // Product Completeness pass — Settings Center → Units. Display-only; every
  // canonical field on this model stays metric regardless of this value.
  unitSystem: z.enum(["metric", "imperial"]).optional(),
  energyUnit: z.enum(["kcal", "kj"]).optional(),
});

export const adminPTStatusSchema = z.object({
  isPT: z.boolean(),
});

export type ProfileDto = z.infer<typeof profileSchema>;
export type AdminPTStatusDto = z.infer<typeof adminPTStatusSchema>;
