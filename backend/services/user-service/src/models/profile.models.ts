import { z } from "zod";

// N13A-04: plausibility limits (owner-approved ranges, 14/11/2026). They reject typos and junk before
// they reach BMR/TDEE and the AI context; they are not a medical judgement.
const WEIGHT_RANGE_MSG = "Cân nặng phải từ 20 đến 400 kg";
const HEIGHT_RANGE_MSG = "Chiều cao phải từ 100 đến 250 cm";
const MIN_AGE = 13;
const MAX_AGE = 100;

/** Whole years between a date of birth and `now` (UTC calendar, same rule everywhere). */
export function ageFromDateOfBirth(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

const dateOfBirthSchema = z
  .string({ invalid_type_error: "Ngày sinh không hợp lệ" })
  .max(40, "Ngày sinh không hợp lệ")
  .superRefine((value, ctx) => {
    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ngày sinh không hợp lệ" });
      return;
    }
    const age = ageFromDateOfBirth(dob);
    if (age < MIN_AGE || age > MAX_AGE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tuổi phải từ ${MIN_AGE} đến ${MAX_AGE} (tính theo ngày sinh)`,
      });
    }
  });

const shortText = (label: string, max: number) =>
  z.string().max(max, `${label} tối đa ${max} ký tự`);
const textList = (label: string, maxItems: number, maxLen: number) =>
  z
    .array(shortText(label, maxLen), { invalid_type_error: `${label} không hợp lệ` })
    .max(maxItems, `${label} tối đa ${maxItems} mục`);

export const profileSchema = z.object({
  dateOfBirth: dateOfBirthSchema.optional(), // ISO date string e.g. "2000-01-15"; age must be 13-100
  age: z.number().int().min(MIN_AGE).max(MAX_AGE).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  heightCm: z.number().min(100, HEIGHT_RANGE_MSG).max(250, HEIGHT_RANGE_MSG).optional(),
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
  safetyScreeningFlags: textList("Cờ sàng lọc an toàn", 30, 100).optional(),
  preferredTrainingDays: z.array(z.number().int().min(0).max(6)).max(7, "Tối đa 7 ngày tập").optional(),
  // 2026-10-23 real bug: OnboardingWizardPage's "Thời lượng mỗi buổi (phút)"
  // input has always sent this field, but it was never in this schema —
  // Zod silently drops unknown keys, so no user's chosen session length was
  // EVER persisted; every AI-generated plan fell back to the ai-service
  // default of 60 minutes regardless of what was entered here. Range
  // matches ai-service's own domain bound (agent-workflow/slot-values.ts's
  // parseMinutes, 10-240), wider than the onboarding form's own 15-180 UI
  // cap so a value already saved under the old (wider) chat-parsed range
  // is never rejected on a later unrelated profile update.
  sessionDurationMinutes: z.number().int().min(10).max(240).optional(),
  availableEquipment: textList("Thiết bị", 50, 100).optional(),
  injuries: textList("Chấn thương", 30, 200).optional(),
  currentWeight: z.number().min(20, WEIGHT_RANGE_MSG).max(400, WEIGHT_RANGE_MSG).optional(),
  targetWeight: z.number().min(20, WEIGHT_RANGE_MSG).max(400, WEIGHT_RANGE_MSG).optional(),
  dietaryPreference: shortText("Chế độ ăn", 200).optional(),
  photoUrl: shortText("Ảnh đại diện", 1000).optional(),
  // AI Nutrition Cycle Engine (Gymini) — food-suggestion/meal-generation
  // budget hint (spec §13). See UserProfile.nutritionBudgetLevel's schema
  // comment for why this is a plain string, not an enum.
  nutritionBudgetLevel: z.enum(["LOW", "NORMAL", "FLEXIBLE"]).optional(),
  // Smart Substitute region personalization (Nutrition Cycle Engine
  // follow-up) — reorders Vietnamese food suggestions/substitutes by
  // regional preference; see fitness-service's
  // vietnamese-region-food.config.ts for the research this is grounded in.
  // Optional, same "plain string, not enum" house style as the budget
  // field above; unset means "national" (today's existing behavior).
  region: z.enum(["BAC", "TRUNG", "NAM"]).optional(),
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
  // D1.1: Optional discovery region preferences ("Toàn quốc" when null; no FK in DB).
  searchProvinceCode: z
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .nullable()
    .optional(),
  searchWardCode: z
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .nullable()
    .optional(),
});

export const adminPTStatusSchema = z.object({
  isPT: z.boolean(),
});

export type ProfileDto = z.infer<typeof profileSchema>;
export type AdminPTStatusDto = z.infer<typeof adminPTStatusSchema>;
