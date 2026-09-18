import { cycleThresholds } from "../config/cycle-thresholds.config";

/**
 * AI Nutrition Cycle Engine (Gymini) — the ONE-TIME deterministic
 * calculation that produces a user's very first NutritionGoal right after
 * onboarding (spec §4/§5), before any weight-trend data exists for
 * nutrition-decision.engine.ts to reason over.
 *
 * Architectural rule, same as nutrition-decision.engine.ts: this is the ONLY
 * thing allowed to decide the initial numbers. An LLM may translate the
 * result into a natural-language explanation and a concrete meal plan (see
 * ai-service's nutrition.processor.ts, invoked by
 * nutrition-onboarding-bootstrap.service.ts with this engine's
 * dailyCaloriesTarget passed in explicitly) but never recomputes or
 * overrides it. Deliberately self-contained (no import from ai-service) so
 * a user's first prescription can be produced even if ai-service/the LLM
 * provider is down (spec §LI fallback rule) — fitness-service has no
 * dependency on ai-service being reachable for this.
 */

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type Goal = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";
export type ActivityLevel =
  | "SEDENTARY"
  | "LIGHTLY_ACTIVE"
  | "MODERATELY_ACTIVE"
  | "VERY_ACTIVE"
  | "EXTREMELY_ACTIVE";
export type ExperienceLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

export interface NutritionBootstrapInput {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
  goal: Goal;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel | null;
  /** InBody-measured BMR (kcal/day), when available — always preferred over
   * the Mifflin-St Jeor estimate below (spec §V/§XX: InBody data is more
   * accurate than a formula whenever it exists). */
  measuredBmr?: number | null;
  /** Phase 2 safety hardening — set by
   * nutrition-onboarding-bootstrap.service.ts when
   * nutritionBootstrapScreening() reports `professionalReviewRequired`.
   * Skips the goal-driven deficit/surplus entirely and targets maintenance
   * calories instead, regardless of `goal` — never withhold a number
   * (respects UserProfile.SafetyScreeningStatus's own documented "warn,
   * never hard-block" principle), but never hand out an aggressive
   * calorie deficit/surplus to a user who flagged a health concern before
   * a human has looked at it either. Protein/fat/water and the safety
   * floor are computed exactly as normal. */
  useMaintenanceOnly?: boolean;
}

export interface NutritionBootstrapResult {
  bmr: number;
  bmrFormula: "inbody_measured" | "mifflin_st_jeor";
  maintenanceCalories: number;
  targetCalories: number;
  deficitOrSurplusKcal: number;
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  waterMl: number;
  /** Machine-readable reasons for the "why did Gymini set these numbers"
   * explainability view (spec §XXVIII) — composed into a human sentence by
   * the caller, never invented per-call. */
  reasonCodes: string[];
  /** Real ids from data/processed/evidence/_index.json only. */
  evidenceIds: string[];
}

export interface MissingFieldsResult {
  ok: false;
  missingFields: string[];
}

export type NutritionBootstrapOutcome =
  | ({ ok: true } & NutritionBootstrapResult)
  | MissingFieldsResult;

const REQUIRED_FIELDS: Array<keyof NutritionBootstrapInput> = [
  "weightKg",
  "heightCm",
  "age",
  "gender",
  "goal",
  "activityLevel",
];

/** Checks the minimum profile fields needed to compute anything (spec
 * §XXXIII: "we need N more fields", never a 20-field blocking form). Does
 * NOT require experienceLevel or InBody — both are optional refinements
 * (missing experienceLevel falls back to INTERMEDIATE-equivalent rates
 * below; missing InBody falls back to the Mifflin-St Jeor estimate). */
export function findMissingBootstrapFields(
  input: Partial<Record<keyof NutritionBootstrapInput, unknown>>,
): string[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = input[field];
    return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
  });
}

function proteinGPerKgFor(goal: Goal, experienceLevel: ExperienceLevel | null): number {
  const t = cycleThresholds.nutritionBootstrap;
  if (goal === "WEIGHT_LOSS" || goal === "MUSCLE_GAIN") {
    return t.proteinGPerKgByExperience[experienceLevel ?? "INTERMEDIATE"];
  }
  return t.proteinGPerKgMaintenance;
}

export function computeInitialNutritionPrescription(
  input: NutritionBootstrapInput,
): NutritionBootstrapResult {
  const t = cycleThresholds.nutritionBootstrap;
  const reasonCodes: string[] = [];
  const evidenceIds: string[] = [];

  let bmr: number;
  let bmrFormula: NutritionBootstrapResult["bmrFormula"];
  if (input.measuredBmr && input.measuredBmr > 0) {
    bmr = Math.round(input.measuredBmr);
    bmrFormula = "inbody_measured";
    reasonCodes.push("BMR_FROM_INBODY_MEASUREMENT");
  } else {
    const genderTerm = input.gender === "MALE" ? 5 : input.gender === "FEMALE" ? -161 : 0;
    bmr = Math.round(10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + genderTerm);
    bmrFormula = "mifflin_st_jeor";
    reasonCodes.push("BMR_FROM_MIFFLIN_ST_JEOR_ESTIMATE");
    evidenceIds.push("mifflin-1990-original-equation");
  }

  const activityFactor = t.activityMultiplier[input.activityLevel];
  const maintenanceCalories = Math.round(bmr * activityFactor);

  let targetCalories = maintenanceCalories;
  let deficitOrSurplusKcal = 0;
  const experienceKey = input.experienceLevel ?? "INTERMEDIATE";
  if (input.useMaintenanceOnly) {
    // Safety hardening — see NutritionBootstrapInput.useMaintenanceOnly's
    // doc comment. Deliberately skips the WEIGHT_LOSS/MUSCLE_GAIN branches
    // below entirely rather than computing-then-discarding a deficit/
    // surplus, so there is no path where an aggressive number is computed
    // at all for a flagged user.
    reasonCodes.push("MAINTENANCE_ONLY_PENDING_SAFETY_SCREENING_REVIEW");
  } else if (input.goal === "WEIGHT_LOSS") {
    const pct = t.deficitFractionByExperience[experienceKey];
    deficitOrSurplusKcal = -Math.round(maintenanceCalories * pct);
    targetCalories = maintenanceCalories + deficitOrSurplusKcal;
    reasonCodes.push("INITIAL_DEFICIT_FOR_WEIGHT_LOSS_GOAL");
    evidenceIds.push("hall-2011-dynamic-energy-balance", "garthe-2011-weight-loss-rate-athletes");
  } else if (input.goal === "MUSCLE_GAIN") {
    const pct = t.surplusFractionByExperience[experienceKey];
    deficitOrSurplusKcal = Math.round(maintenanceCalories * pct);
    targetCalories = maintenanceCalories + deficitOrSurplusKcal;
    reasonCodes.push("INITIAL_SURPLUS_FOR_MUSCLE_GAIN_GOAL");
    evidenceIds.push("slater-2019-energy-surplus-hypertrophy");
  } else {
    reasonCodes.push("MAINTENANCE_CALORIES_FOR_MAINTENANCE_OR_PERFORMANCE_GOAL");
  }

  // Safety floor — never propose a prescription below this regardless of
  // goal/experience (same floor nutrition-decision.engine.ts's adaptive
  // adjustments respect, so a user's very first target and every later
  // adjustment share one safety rail).
  targetCalories = Math.max(cycleThresholds.nutritionAdaptive.minPrescriptionCalories, targetCalories);

  const proteinGPerKg = proteinGPerKgFor(input.goal, input.experienceLevel);
  const proteinGrams = Math.round(input.weightKg * proteinGPerKg);
  evidenceIds.push("issn-protein-2017");

  const fatFloorGrams = Math.round(input.weightKg * t.fatFloorGPerKg);
  const proteinKcal = proteinGrams * 4;
  // Fat gets ~25% of total calories by default (within the AMDR 20-35%
  // band), clamped up to the essential-fat floor if 25% would fall short —
  // never clamped down, since the floor is a minimum, not a target.
  const fatFromPct = Math.round((targetCalories * 0.25) / 9);
  const fatGrams = Math.max(fatFloorGrams, fatFromPct);
  evidenceIds.push("iom-amdr-macronutrients");
  const fatKcal = fatGrams * 9;

  const remainingKcal = Math.max(0, targetCalories - proteinKcal - fatKcal);
  const carbGrams = Math.round(remainingKcal / 4);

  const waterMl = Math.round(input.weightKg * t.waterMlPerKg);
  evidenceIds.push("nata-fluid-replacement-2017");

  return {
    bmr,
    bmrFormula,
    maintenanceCalories,
    targetCalories,
    deficitOrSurplusKcal,
    proteinGrams,
    carbGrams,
    fatGrams,
    waterMl,
    reasonCodes,
    evidenceIds: Array.from(new Set(evidenceIds)),
  };
}
