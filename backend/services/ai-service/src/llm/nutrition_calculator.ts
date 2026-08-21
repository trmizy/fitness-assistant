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

export const nutritionCalculator = {
  calculate(profile: UserProfile, intent: InputIntent): NutritionTargets {
    const weight = getWeight(profile);
    const goal = resolveGoal(profile, intent);
    const experienceLevel = profile.experienceLevel;
    const activityFactor = profile.activityLevel
      ? ACTIVITY_FACTOR[profile.activityLevel]
      : 1.375;
    const { bmr, formula } = estimateBmr(profile);

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
