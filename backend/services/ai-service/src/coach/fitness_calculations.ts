import type {
  CoachContext,
  CoachExperienceLevel,
  CoachGoal,
  CoachSex,
  NutritionSummaryContext,
  TrainingSummaryContext,
} from './coach_context.types';

export interface TdeeInput {
  weightKg: number | null | undefined;
  heightCm: number | null | undefined;
  age: number | null | undefined;
  sex: CoachSex | string | null | undefined;
  activityLevel?: string | null;
  bodyFatPercent?: number | null;
}

export interface TdeeRange {
  bmr_kcal: number | null;
  low_kcal: number | null;
  high_kcal: number | null;
  formula: 'mifflin_st_jeor' | 'katch_mcardle' | 'none';
  confidence: 'low' | 'medium' | 'high';
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function activityMultiplier(activityLevel?: string | null): number {
  switch (String(activityLevel || '').toUpperCase()) {
    case 'LIGHTLY_ACTIVE':
      return 1.375;
    case 'MODERATELY_ACTIVE':
      return 1.55;
    case 'VERY_ACTIVE':
      return 1.725;
    case 'EXTREMELY_ACTIVE':
      return 1.9;
    case 'SEDENTARY':
    default:
      return 1.2;
  }
}

export function calculateBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  const weight = finiteNumber(weightKg);
  const height = finiteNumber(heightCm);
  if (!weight || !height || weight <= 0 || height <= 0) return null;
  return round(weight / ((height / 100) ** 2), 1);
}

export function estimateFatMass(weightKg?: number | null, bodyFatPercent?: number | null): number | null {
  const weight = finiteNumber(weightKg);
  const pct = finiteNumber(bodyFatPercent);
  if (!weight || pct == null || weight <= 0 || pct < 0 || pct > 80) return null;
  return round(weight * pct / 100, 1);
}

export function estimateLeanBodyMass(weightKg?: number | null, bodyFatPercent?: number | null): number | null {
  const fatMass = estimateFatMass(weightKg, bodyFatPercent);
  const weight = finiteNumber(weightKg);
  if (!weight || fatMass == null) return null;
  return round(weight - fatMass, 1);
}

export function estimateTdeeRange(input: TdeeInput): TdeeRange {
  const weight = finiteNumber(input.weightKg);
  const height = finiteNumber(input.heightCm);
  const age = finiteNumber(input.age);
  const sex = String(input.sex || '').toLowerCase();
  const multiplier = activityMultiplier(input.activityLevel);

  const leanMass = estimateLeanBodyMass(weight, input.bodyFatPercent);
  if (leanMass && leanMass > 20) {
    const bmr = 370 + (21.6 * leanMass);
    const tdee = bmr * multiplier;
    return {
      bmr_kcal: Math.round(bmr),
      low_kcal: Math.round(tdee * 0.95),
      high_kcal: Math.round(tdee * 1.05),
      formula: 'katch_mcardle',
      confidence: height && age ? 'high' : 'medium',
    };
  }

  if (!weight || !height || !age) {
    return { bmr_kcal: null, low_kcal: null, high_kcal: null, formula: 'none', confidence: 'low' };
  }

  const sexOffset = sex === 'female' ? -161 : 5;
  const bmr = (10 * weight) + (6.25 * height) - (5 * age) + sexOffset;
  const tdee = bmr * multiplier;
  return {
    bmr_kcal: Math.round(bmr),
    low_kcal: Math.round(tdee * 0.95),
    high_kcal: Math.round(tdee * 1.05),
    formula: 'mifflin_st_jeor',
    confidence: sex === 'male' || sex === 'female' ? 'medium' : 'low',
  };
}

export function recommendCalorieTarget(
  tdeeRange: TdeeRange,
  goal: CoachGoal | string | null | undefined,
): { target_kcal: number | null; range_kcal: [number, number] | null; rationale: string } {
  if (!tdeeRange.low_kcal || !tdeeRange.high_kcal) {
    return { target_kcal: null, range_kcal: null, rationale: 'missing_tdee_inputs' };
  }

  const maintenance = Math.round((tdeeRange.low_kcal + tdeeRange.high_kcal) / 2);
  const normalizedGoal = String(goal || '').toLowerCase();
  if (normalizedGoal.includes('weight_loss') || normalizedGoal.includes('fat_loss')) {
    const target = maintenance - 400;
    return { target_kcal: target, range_kcal: [target - 150, target + 100], rationale: 'moderate_deficit' };
  }
  if (normalizedGoal.includes('muscle_gain')) {
    const target = maintenance + 250;
    return { target_kcal: target, range_kcal: [target - 100, target + 150], rationale: 'controlled_surplus' };
  }
  if (normalizedGoal.includes('recomposition')) {
    return { target_kcal: maintenance - 100, range_kcal: [maintenance - 250, maintenance + 100], rationale: 'near_maintenance_recomposition' };
  }
  return { target_kcal: maintenance, range_kcal: [tdeeRange.low_kcal, tdeeRange.high_kcal], rationale: 'maintenance' };
}

export function recommendProteinTarget(
  weightKg?: number | null,
  goal?: CoachGoal | string | null,
  experience?: CoachExperienceLevel | string | null,
): { grams_per_day: number | null; grams_per_kg: number | null; rationale: string } {
  const weight = finiteNumber(weightKg);
  if (!weight || weight <= 0) return { grams_per_day: null, grams_per_kg: null, rationale: 'missing_weight' };

  const normalizedGoal = String(goal || '').toLowerCase();
  const normalizedExperience = String(experience || '').toLowerCase();
  let gramsPerKg = 1.6;
  if (normalizedGoal.includes('weight_loss') || normalizedGoal.includes('recomposition')) gramsPerKg = 1.8;
  if (normalizedGoal.includes('muscle_gain')) gramsPerKg = 1.8;
  if (normalizedExperience === 'advanced') gramsPerKg += 0.1;

  return {
    grams_per_day: Math.round(weight * gramsPerKg),
    grams_per_kg: round(gramsPerKg, 1),
    rationale: 'evidence_based_fitness_range',
  };
}

export function summarizeTrainingVolume(workouts: Array<Record<string, any>> = []): TrainingSummaryContext {
  const weeklySets: Record<string, number> = {};
  let totalRpe = 0;
  let rpeCount = 0;
  let totalRir = 0;
  let rirCount = 0;

  for (const workout of workouts.slice(0, 14)) {
    const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    for (const item of exercises) {
      const sets = finiteNumber(item.sets) ?? 0;
      const muscleGroups = Array.isArray(item.muscleGroups)
        ? item.muscleGroups
        : Array.isArray(item.exercise?.muscleGroupsActivated)
          ? item.exercise.muscleGroupsActivated
          : item.exercise?.bodyPart
            ? [item.exercise.bodyPart]
            : ['unknown'];
      for (const muscle of muscleGroups.slice(0, 3)) {
        const key = String(muscle || 'unknown').toLowerCase();
        weeklySets[key] = (weeklySets[key] || 0) + sets;
      }
      const rpe = finiteNumber(item.rpe);
      const rir = finiteNumber(item.rir);
      if (rpe != null) {
        totalRpe += rpe;
        rpeCount += 1;
      }
      if (rir != null) {
        totalRir += rir;
        rirCount += 1;
      }
    }
  }

  const sessionCount = workouts.length;
  return {
    sessions_per_week: sessionCount > 0 ? Math.min(7, sessionCount) : null,
    weekly_sets_by_muscle: weeklySets,
    average_rpe: rpeCount ? round(totalRpe / rpeCount, 1) : null,
    average_rir: rirCount ? round(totalRir / rirCount, 1) : null,
    progression_status: 'unknown',
    missed_sessions: null,
    recent_session_count: sessionCount,
  };
}

export function detectTrainingRisk(summary: TrainingSummaryContext, context?: Partial<CoachContext>): string[] {
  const flags: string[] = [];
  const experience = context?.profile?.experience_level;
  const maxSets = Object.values(summary.weekly_sets_by_muscle).reduce((max, sets) => Math.max(max, sets), 0);
  if (experience === 'beginner' && maxSets > 16) flags.push('beginner_volume_high');
  if ((summary.sessions_per_week ?? 0) >= 6) flags.push('high_training_frequency');
  if ((summary.average_rpe ?? 0) >= 9) flags.push('high_rpe');
  return flags;
}

export function detectNutritionRisk(summary: NutritionSummaryContext, context?: Partial<CoachContext>): string[] {
  const flags: string[] = [];
  const weight = context?.profile?.weight_kg ?? null;
  if (summary.avg_calories != null && summary.avg_calories < 1200) flags.push('very_low_calories');
  if (weight && summary.avg_protein_g != null && summary.avg_protein_g < weight * 1.2) flags.push('protein_below_fitness_target');
  return flags;
}

export function classifyExperienceLevel(input: {
  declared?: string | null;
  recentSessionCount?: number | null;
  trainingAgeMonths?: number | null;
}): CoachExperienceLevel {
  const declared = String(input.declared || '').toLowerCase();
  if (declared.includes('advanced')) return 'advanced';
  if (declared.includes('intermediate')) return 'intermediate';
  if (declared.includes('beginner')) return 'beginner';
  if (input.trainingAgeMonths != null) {
    if (input.trainingAgeMonths >= 24) return 'advanced';
    if (input.trainingAgeMonths >= 6) return 'intermediate';
    return 'beginner';
  }
  if ((input.recentSessionCount ?? 0) >= 8) return 'intermediate';
  return null;
}

export function buildSafetyFlags(context: Pick<CoachContext, 'profile' | 'training_summary' | 'nutrition_summary' | 'constraints'>): string[] {
  return Array.from(new Set([
    ...detectTrainingRisk(context.training_summary, context),
    ...detectNutritionRisk(context.nutrition_summary, context),
    ...(context.constraints.injuries.length > 0 ? ['injury_constraints_present'] : []),
  ]));
}
