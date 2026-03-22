import type { InputIntent, NutritionTargets, UserProfile } from './types';

const ACTIVITY_FACTOR: Record<NonNullable<UserProfile['activityLevel']>, number> = {
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
    return { bmr: profile.inBody.bmr, formula: 'inbody_bmr' };
  }

  const weight = getWeight(profile);
  const height = profile.heightCm;
  const age = profile.age;
  const gender = profile.gender;
  if (!weight || !height || !age || !gender) {
    return { formula: 'insufficient_data' };
  }

  const genderTerm = gender === 'MALE' ? 5 : gender === 'FEMALE' ? -161 : 0;
  const bmr = 10 * weight + 6.25 * height - 5 * age + genderTerm;
  return { bmr: Math.round(bmr), formula: 'mifflin_st_jeor' };
}

function resolveGoal(profile: UserProfile, intent: InputIntent): 'fat_loss' | 'muscle_gain' | 'maintenance' | 'recomposition' {
  if (intent.goalHint) return intent.goalHint;
  switch (profile.goal) {
    case 'WEIGHT_LOSS':
      return 'fat_loss';
    case 'MUSCLE_GAIN':
      return 'muscle_gain';
    case 'MAINTENANCE':
      return 'maintenance';
    default:
      return 'recomposition';
  }
}

export const nutritionCalculator = {
  calculate(profile: UserProfile, intent: InputIntent): NutritionTargets {
    const weight = getWeight(profile);
    const goal = resolveGoal(profile, intent);
    const activityFactor = profile.activityLevel ? ACTIVITY_FACTOR[profile.activityLevel] : 1.375;
    const { bmr, formula } = estimateBmr(profile);

    if (!bmr || !weight) {
      return {
        formula,
        confidence: 'low',
      };
    }

    const maintenanceCalories = Math.round(bmr * activityFactor);

    let targetCalories = maintenanceCalories;
    let delta = 0;
    if (goal === 'fat_loss') {
      delta = -Math.round(maintenanceCalories * 0.15);
      targetCalories = maintenanceCalories + delta;
    } else if (goal === 'muscle_gain') {
      delta = Math.round(maintenanceCalories * 0.1);
      targetCalories = maintenanceCalories + delta;
    } else if (goal === 'recomposition') {
      const bf = profile.inBody?.bodyFatPct;
      const isHighBodyFat = typeof bf === 'number' && bf >= 25;
      delta = isHighBodyFat ? -Math.round(maintenanceCalories * 0.08) : 0;
      targetCalories = maintenanceCalories + delta;
    }

    const proteinMultiplier =
      goal === 'fat_loss' ? 2.0 : goal === 'muscle_gain' ? 1.8 : goal === 'recomposition' ? 1.9 : 1.6;
    const fatMultiplier = goal === 'muscle_gain' ? 0.9 : 0.8;

    const proteinGrams = Math.round(weight * proteinMultiplier);
    const fatGrams = Math.round(weight * fatMultiplier);
    const proteinKcal = proteinGrams * 4;
    const fatKcal = fatGrams * 9;
    const remainingKcal = clamp(targetCalories - proteinKcal - fatKcal, 0, 99999);
    const carbsGrams = Math.round(remainingKcal / 4);

    return {
      maintenanceCalories,
      targetCalories,
      proteinGrams,
      fatGrams,
      carbsGrams,
      deficitOrSurplusKcal: delta,
      formula,
      confidence: 'high',
    };
  },
};
