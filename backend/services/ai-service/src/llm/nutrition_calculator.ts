import type { InputIntent, NutritionTargets, UserProfile } from "./types";

const ACTIVITY_FACTOR: Record<
  NonNullable<UserProfile["activityLevel"]>,
  number
> = {
  SEDENTARY: 1.2,
  LIGHTLY_ACTIVE: 1.375,
  MODERATELY_ACTIVE: 1.55,
  VERY_ACTIVE: 1.725,
  EXTREMELY_ACTIVE: 1.9,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getWeight(profile: UserProfile): number | undefined {
  return profile.currentWeightKg || profile.inBody?.weightKg;
}

function estimateBmr(profile: UserProfile): { bmr?: number; formula: string } {
  if (profile.inBody?.bmr) {
    return { bmr: profile.inBody.bmr, formula: "inbody_bmr" };
  }

  const weight = getWeight(profile);
  const height = profile.heightCm;
  const age = profile.age;
  const gender = profile.gender;
  if (!weight || !height || !age || !gender) {
    return { formula: "insufficient_data" };
  }

  const genderTerm = gender === "MALE" ? 5 : gender === "FEMALE" ? -161 : 0;
  const bmr = 10 * weight + 6.25 * height - 5 * age + genderTerm;
  return { bmr: Math.round(bmr), formula: "mifflin_st_jeor" };
}

function resolveGoal(
  profile: UserProfile,
  intent: InputIntent,
): "fat_loss" | "muscle_gain" | "maintenance" | "recomposition" {
  if (intent.goalHint) return intent.goalHint;
  switch (profile.goal) {
    case "WEIGHT_LOSS":
      return "fat_loss";
    case "MUSCLE_GAIN":
      return "muscle_gain";
    case "MAINTENANCE":
      return "maintenance";
    default:
      return "recomposition";
  }
}

// Experience-based surplus/deficit rates — see docs/research/nutrition-ai-product-and-expert-review.md
// #5 (Iraki/Helms/Fitschen bodybuilding off-season review) and ACSM
// individualization guidance. A single flat rate for every experience
// level was a real gap flagged in that doc's "rule chưa implement" list:
// advanced lifters were getting the same +10% surplus / -15% deficit as
// total beginners, which the literature explicitly warns against
// (advanced lifters should use smaller, more conservative rates — more
// muscle-building headroom for beginners, more restraint for advanced).
// Percentages below are single deterministic points picked from within
// each literature-cited range (not the range's edges) so this stays a
// calculator, not a guess.
const MUSCLE_GAIN_SURPLUS_PCT: Record<
  NonNullable<UserProfile["experienceLevel"]> | "UNKNOWN",
  number
> = {
  BEGINNER: 0.12, // within cited 10-15%
  INTERMEDIATE: 0.08, // within cited 5-10%
  ADVANCED: 0.05, // within cited 3-8%
  UNKNOWN: 0.1, // no experienceLevel on profile — keep prior flat default
};

const FAT_LOSS_DEFICIT_PCT: Record<
  NonNullable<UserProfile["experienceLevel"]> | "UNKNOWN",
  number
> = {
  BEGINNER: 0.15, // within cited 10-20%
  INTERMEDIATE: 0.12, // within cited 10-15%
  ADVANCED: 0.1, // within cited 5-15%, conservative end
  UNKNOWN: 0.15, // no experienceLevel on profile — keep prior flat default
};

// Protein g/kg by experience level — ISSN protein position stand's overall
// 1.4-2.2g/kg range, refined by experience per
// docs/research/nutrition-ai-product-and-expert-review.md #1/#5. Only
// applied to muscle_gain/fat_loss (the two goals the source literature
// this is grounded in actually addresses — "beginner tăng cơ" /
// "advanced/cutting/athlete") so maintenance/recomposition keep their
// existing goal-based defaults unchanged when no clearer guidance exists.
const EXPERIENCE_PROTEIN_MULTIPLIER: Partial<
  Record<NonNullable<UserProfile["experienceLevel"]>, number>
> = {
  BEGINNER: 1.7, // within cited 1.6-1.8
  INTERMEDIATE: 1.9, // within cited 1.8-2.0
  ADVANCED: 2.1, // within cited 2.0-2.2
};

const GOAL_OF_PROFILE: Record<string, string> = { WEIGHT_LOSS: "fat_loss", MUSCLE_GAIN: "muscle_gain", MAINTENANCE: "maintenance", RECOMPOSITION: "recomposition" };

/** The user asked for numbers or a goal DIFFERENT from the saved one ("cắt mỡ 8 tuần…", "3200 kcal, protein 180g"): answer that as a what-if, never overwrite the goal. */
export function isNutritionWhatIf(profile: UserProfile, intent: InputIntent): boolean {
  if (intent.statedCalories || intent.statedProteinGrams) return true;
  return !!intent.goalStatedInQuestion && !!intent.goalHint && intent.goalHint !== GOAL_OF_PROFILE[profile.goal ?? ""];
}

const STATED_KCAL_RANGE = [1200, 5000] as const;
const STATED_PROTEIN_PER_KG = [0.8, 3.0] as const;

/** A target the user NAMED for this request wins over the computed one — but only inside safe bounds; otherwise the computed value stays. */
function applyStatedTargets(t: NutritionTargets, intent: InputIntent, weight: number | undefined): NutritionTargets {
  const out = { ...t };
  const kcal = intent.statedCalories;
  if (kcal && kcal >= STATED_KCAL_RANGE[0] && kcal <= STATED_KCAL_RANGE[1]) out.targetCalories = kcal;
  const prot = intent.statedProteinGrams;
  if (prot && weight && prot >= weight * STATED_PROTEIN_PER_KG[0] && prot <= weight * STATED_PROTEIN_PER_KG[1]) out.proteinGrams = prot;
  if (out.targetCalories !== t.targetCalories || out.proteinGrams !== t.proteinGrams) {
    if (out.targetCalories !== undefined && out.proteinGrams !== undefined) {
      const fat = out.fatGrams ?? 0;
      out.carbsGrams = Math.round(clamp(out.targetCalories - out.proteinGrams * 4 - fat * 9, 0, 99999) / 4);
    }
    if (out.maintenanceCalories !== undefined && out.targetCalories !== undefined) out.deficitOrSurplusKcal = out.targetCalories - out.maintenanceCalories;
  }
  return out;
}

/**
 * The inputs behind the maintenance ESTIMATE (same estimateBmr/ACTIVITY_FACTOR as calculateBase — no second formula), so a chat
 * answer to "con số 2370 kcal của tôi được tính thế nào?" can show the engine's own numbers (added by test/ai-quality-eval,
 * 2026-11-08: the model answered "Harris-Benedict hoặc Mifflin-St Jeor" with no figure).
 */
export function explainMaintenanceEstimate(profile: UserProfile): { bmr?: number; formula: string; activityFactor: number; maintenanceCalories?: number } {
  const activityFactor = profile.activityLevel ? ACTIVITY_FACTOR[profile.activityLevel] : 1.375;
  const { bmr, formula } = estimateBmr(profile);
  return { bmr, formula, activityFactor, maintenanceCalories: bmr ? Math.round(bmr * activityFactor) : undefined };
}

export const nutritionCalculator = {
  calculate(profile: UserProfile, intent: InputIntent): NutritionTargets {
    return applyStatedTargets(nutritionCalculator.calculateBase(profile, intent), intent, getWeight(profile));
  },
  calculateBase(profile: UserProfile, intent: InputIntent): NutritionTargets {
    const weight = getWeight(profile);
    const goal = resolveGoal(profile, intent);
    const experienceLevel = profile.experienceLevel;
    const activityFactor = profile.activityLevel
      ? ACTIVITY_FACTOR[profile.activityLevel]
      : 1.375;
    const { bmr, formula } = estimateBmr(profile);

    // Source of truth: the user's ACTIVE NutritionGoal (fitness-service) owns calories/macros. Chat must state exactly those
    // numbers; the profile-based estimate below is only the fallback for a user who has no goal yet. (Found by the full chat
    // verification: "Một ngày tôi cần bao nhiêu calo?" answered 2000 kcal while the stored goal was 2187 kcal.)
    if (profile.nutritionGoal && !isNutritionWhatIf(profile, intent)) {
      const g = profile.nutritionGoal;
      const maintenance = bmr && weight ? Math.round(bmr * activityFactor) : undefined;
      return {
        maintenanceCalories: maintenance,
        targetCalories: g.calories,
        proteinGrams: g.protein,
        fatGrams: g.fat,
        carbsGrams: g.carbs,
        deficitOrSurplusKcal: maintenance !== undefined ? g.calories - maintenance : undefined,
        formula: "NutritionGoal (ACTIVE)",
        confidence: "high",
      };
    }

    if (!bmr || !weight) {
      return {
        formula,
        confidence: "low",
      };
    }

    const maintenanceCalories = Math.round(bmr * activityFactor);

    let targetCalories = maintenanceCalories;
    let delta = 0;
    if (goal === "fat_loss") {
      const pct = FAT_LOSS_DEFICIT_PCT[experienceLevel ?? "UNKNOWN"];
      delta = -Math.round(maintenanceCalories * pct);
      targetCalories = maintenanceCalories + delta;
    } else if (goal === "muscle_gain") {
      const pct = MUSCLE_GAIN_SURPLUS_PCT[experienceLevel ?? "UNKNOWN"];
      delta = Math.round(maintenanceCalories * pct);
      targetCalories = maintenanceCalories + delta;
    } else if (goal === "recomposition") {
      const bf = profile.inBody?.bodyFatPct;
      const isHighBodyFat = typeof bf === "number" && bf >= 25;
      delta = isHighBodyFat ? -Math.round(maintenanceCalories * 0.08) : 0;
      targetCalories = maintenanceCalories + delta;
    }

    const baseProteinMultiplier =
      goal === "fat_loss"
        ? 2.0
        : goal === "muscle_gain"
          ? 1.8
          : goal === "recomposition"
            ? 1.9
            : 1.6;
    const proteinMultiplier =
      (goal === "muscle_gain" || goal === "fat_loss") && experienceLevel
        ? (EXPERIENCE_PROTEIN_MULTIPLIER[experienceLevel] ?? baseProteinMultiplier)
        : baseProteinMultiplier;
    const fatMultiplier = goal === "muscle_gain" ? 0.9 : 0.8;

    const proteinGrams = Math.round(weight * proteinMultiplier);
    const fatGrams = Math.round(weight * fatMultiplier);
    const proteinKcal = proteinGrams * 4;
    const fatKcal = fatGrams * 9;
    const remainingKcal = clamp(
      targetCalories - proteinKcal - fatKcal,
      0,
      99999,
    );
    const carbsGrams = Math.round(remainingKcal / 4);

    return {
      maintenanceCalories,
      targetCalories,
      proteinGrams,
      fatGrams,
      carbsGrams,
      deficitOrSurplusKcal: delta,
      formula,
      confidence: "high",
    };
  },
};
