import type { InBodyMetrics, UserProfile } from "../llm/types";
import type { PersonalizationContext } from "../llm/profile_extractor";
import type {
  CoachContext,
  CoachExperienceLevel,
  CoachGoal,
  CoachSex,
  InBodyTrendContext,
  NutritionSummaryContext,
} from "./coach_context.types";
import {
  buildSafetyFlags,
  calculateBmi,
  classifyExperienceLevel,
  estimateFatMass,
  estimateLeanBodyMass,
  summarizeTrainingVolume,
} from "./fitness_calculations";

export interface CoachContextBuilderInput {
  userId?: string;
  profile?: Partial<UserProfile> | null;
  latestInBody?: Partial<InBodyMetrics> | null;
  inBodyHistory?: Array<Record<string, any>>;
  workoutHistory?: Array<Record<string, any>>;
  nutritionHistory?: Array<Record<string, any>>;
  currentWorkoutProgram?: Record<string, any> | null;
  currentNutritionProgram?: Record<string, any> | null;
  requestedDaysPerWeek?: number | null;
  requestedSessionDurationMinutes?: number | null;
  timeframeWeeks?: number | null;
  goal?: string | null;
  equipment?: string[];
  injuries?: string[];
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSex(value: unknown): CoachSex {
  const text = String(value || "").toLowerCase();
  if (text === "male" || text === "m") return "male";
  if (text === "female" || text === "f") return "female";
  if (text === "other") return "other";
  return null;
}

function mapGoal(value: unknown): CoachGoal {
  const text = String(value || "").toLowerCase();
  if (
    text.includes("weight_loss") ||
    text.includes("fat_loss") ||
    text.includes("giam")
  )
    return "weight_loss";
  if (
    text.includes("muscle_gain") ||
    text.includes("hypertrophy") ||
    text.includes("tang co")
  )
    return "muscle_gain";
  if (text.includes("maintenance") || text.includes("duy tri"))
    return "maintenance";
  if (text.includes("athletic")) return "athletic_performance";
  if (text.includes("recomposition") || text.includes("recomp"))
    return "recomposition";
  if (text) return "general_fitness";
  return null;
}

function mapExperience(
  value: unknown,
  recentSessionCount: number,
): CoachExperienceLevel {
  return classifyExperienceLevel({
    declared: typeof value === "string" ? value : null,
    recentSessionCount,
  });
}

function readDate(value: unknown): string | null {
  if (!value) return null;
  return String(value).split("T")[0] || null;
}

function normalizeInBodyEntry(
  entry: Record<string, any> | Partial<InBodyMetrics> | null | undefined,
) {
  if (!entry) return null;
  const row = entry as Record<string, any>;
  return {
    measured_at: readDate(
      row.measuredAt ?? row.measured_at ?? row.date ?? row.dateOnly,
    ),
    weight_kg: finiteNumber(row.weightKg ?? row.weight_kg ?? row.weight),
    body_fat_percent: finiteNumber(row.bodyFatPct ?? row.body_fat_percent),
    skeletal_muscle_mass_kg: finiteNumber(
      row.skeletalMuscleKg ??
        row.skeletal_muscle_mass_kg ??
        row.muscleMassKg ??
        row.muscleMass,
    ),
    body_fat_mass_kg: finiteNumber(
      row.bodyFatKg ?? row.body_fat_mass_kg ?? row.bodyFat,
    ),
    bmr_kcal: finiteNumber(row.bmr ?? row.bmr_kcal),
    bmi: finiteNumber(row.bmi),
    visceral_fat_level: finiteNumber(
      row.visceralFatLevel ?? row.visceral_fat_level,
    ),
    ecw_tbw: finiteNumber(row.ecwTbw ?? row.ecw_tbw),
  };
}

function buildTrend(
  history: Array<Record<string, any>>,
  latest: ReturnType<typeof normalizeInBodyEntry>,
): InBodyTrendContext {
  const normalized = history
    .map(normalizeInBodyEntry)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const newest = latest ?? normalized[0] ?? null;
  const oldest =
    normalized.length > 1 ? normalized[normalized.length - 1] : null;
  if (!newest || !oldest) {
    return {
      first_measured_at: oldest?.measured_at ?? null,
      latest_measured_at: newest?.measured_at ?? null,
      weight_change_kg: null,
      body_fat_percent_change: null,
      skeletal_muscle_mass_change_kg: null,
      direction: "unknown",
    };
  }

  const weightChange =
    newest.weight_kg != null && oldest.weight_kg != null
      ? Number((newest.weight_kg - oldest.weight_kg).toFixed(1))
      : null;
  const fatChange =
    newest.body_fat_percent != null && oldest.body_fat_percent != null
      ? Number((newest.body_fat_percent - oldest.body_fat_percent).toFixed(1))
      : null;
  const muscleChange =
    newest.skeletal_muscle_mass_kg != null &&
    oldest.skeletal_muscle_mass_kg != null
      ? Number(
          (
            newest.skeletal_muscle_mass_kg - oldest.skeletal_muscle_mass_kg
          ).toFixed(1),
        )
      : null;

  let direction: InBodyTrendContext["direction"] = "stable";
  if ((fatChange ?? 0) < -0.5 && (muscleChange ?? 0) >= 0)
    direction = "improving";
  else if ((fatChange ?? 0) > 0.5 && (muscleChange ?? 0) < 0)
    direction = "declining";
  else if (fatChange != null || muscleChange != null || weightChange != null)
    direction = "mixed";

  return {
    first_measured_at: oldest.measured_at,
    latest_measured_at: newest.measured_at,
    weight_change_kg: weightChange,
    body_fat_percent_change: fatChange,
    skeletal_muscle_mass_change_kg: muscleChange,
    direction,
  };
}

function summarizeNutrition(
  entries: Array<Record<string, any>>,
  currentNutritionProgram?: Record<string, any> | null,
): NutritionSummaryContext {
  if (entries.length === 0) {
    return {
      avg_calories: null,
      avg_protein_g: null,
      avg_carbs_g: null,
      avg_fat_g: null,
      adherence_percent: null,
      weight_trend: "unknown",
    };
  }

  const totals = entries.reduce(
    (acc, item) => ({
      calories: acc.calories + (finiteNumber(item.calories) ?? 0),
      protein: acc.protein + (finiteNumber(item.protein) ?? 0),
      carbs: acc.carbs + (finiteNumber(item.carbs) ?? 0),
      fat: acc.fat + (finiteNumber(item.fat ?? item.fats) ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const count = entries.length;
  const avgCalories = Math.round(totals.calories / count);
  const targetCalories = finiteNumber(
    currentNutritionProgram?.dailyCaloriesTarget,
  );
  const adherence =
    targetCalories && targetCalories > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (1 - Math.abs(avgCalories - targetCalories) / targetCalories) *
                100,
            ),
          ),
        )
      : null;

  return {
    avg_calories: avgCalories,
    avg_protein_g: Math.round(totals.protein / count),
    avg_carbs_g: Math.round(totals.carbs / count),
    avg_fat_g: Math.round(totals.fat / count),
    adherence_percent: adherence,
    weight_trend: "unknown",
  };
}

function addMissing(missing: string[], key: string, value: unknown): void {
  if (value === null || value === undefined || value === "") missing.push(key);
}

export function buildCoachContext(
  input: CoachContextBuilderInput | PersonalizationContext,
): CoachContext {
  const profile = input.profile ?? {};
  const latestRaw = input.latestInBody ?? (profile as any).inBody ?? null;
  const latest = normalizeInBodyEntry(latestRaw);
  const workoutHistory = input.workoutHistory ?? [];
  const nutritionHistory = input.nutritionHistory ?? [];
  const goal = mapGoal(
    (input as CoachContextBuilderInput).goal ?? profile.goal,
  );
  const missingFields: string[] = [];
  const profileWeight = finiteNumber(
    profile.currentWeightKg ?? (profile as any).currentWeight,
  );
  const weight = latest?.weight_kg ?? profileWeight;
  const startingWeight = finiteNumber(
    (profile as any).startingWeightKg ?? (profile as any).startingWeight,
  );
  const targetWeight = finiteNumber(
    profile.targetWeightKg ?? (profile as any).targetWeight,
  );
  const height = finiteNumber(profile.heightCm);
  const experience = mapExperience(
    profile.experienceLevel,
    workoutHistory.length,
  );
  const injuries = Array.from(
    new Set(
      [
        ...((input as CoachContextBuilderInput).injuries ?? []),
        ...(Array.isArray(profile.training?.injuries)
          ? profile.training.injuries
          : []),
      ]
        .filter(Boolean)
        .map(String),
    ),
  );
  const equipment = Array.from(
    new Set(
      [
        ...((input as CoachContextBuilderInput).equipment ?? []),
        ...(Array.isArray(profile.training?.availableEquipment)
          ? profile.training.availableEquipment
          : []),
      ]
        .filter(Boolean)
        .map(String),
    ),
  );
  const availableDays =
    Array.isArray(profile.training?.preferredTrainingDays) &&
    profile.training.preferredTrainingDays.length > 0
      ? profile.training.preferredTrainingDays
      : null;

  addMissing(missingFields, "profile.age", profile.age);
  addMissing(missingFields, "profile.sex", profile.gender);
  addMissing(missingFields, "profile.height_cm", height);
  addMissing(missingFields, "profile.weight_kg", weight);
  addMissing(missingFields, "profile.goal", goal);
  addMissing(missingFields, "constraints.available_days", availableDays);

  const inbodyLatest = {
    measured_at: latest?.measured_at ?? null,
    weight_kg: latest?.weight_kg ?? weight,
    body_fat_percent: latest?.body_fat_percent ?? null,
    skeletal_muscle_mass_kg: latest?.skeletal_muscle_mass_kg ?? null,
    body_fat_mass_kg:
      latest?.body_fat_mass_kg ??
      estimateFatMass(weight, latest?.body_fat_percent),
    lean_body_mass_kg: estimateLeanBodyMass(weight, latest?.body_fat_percent),
    bmr_kcal: latest?.bmr_kcal ?? null,
    bmi: latest?.bmi ?? calculateBmi(weight, height),
    visceral_fat_level: latest?.visceral_fat_level ?? null,
    ecw_tbw: latest?.ecw_tbw ?? null,
  };

  const trainingSummary = summarizeTrainingVolume(workoutHistory);
  const coachContext: CoachContext = {
    profile: {
      user_id: (input as CoachContextBuilderInput).userId ?? profile.userId,
      age: finiteNumber(profile.age),
      sex: mapSex(profile.gender),
      height_cm: height,
      weight_kg: weight,
      target_weight_kg: targetWeight,
      starting_weight_kg: startingWeight,
      goal,
      activity_level: profile.activityLevel
        ? String(profile.activityLevel)
        : null,
      experience_level: experience,
      safety_screening_status: profile.safetyScreeningStatus ?? null,
      safety_screening_flags: profile.safetyScreeningFlags ?? [],
    },
    journey: {
      starting_weight_kg: startingWeight,
      current_weight_kg: weight,
      target_weight_kg: targetWeight,
      changed_since_start_kg:
        startingWeight != null && weight != null
          ? Math.round((startingWeight - weight) * 10) / 10
          : null,
      remaining_to_goal_kg:
        weight != null && targetWeight != null
          ? Math.round((weight - targetWeight) * 10) / 10
          : null,
    },
    inbody_latest: inbodyLatest,
    inbody_trend: buildTrend(input.inBodyHistory ?? [], latest),
    training_summary: trainingSummary,
    nutrition_summary: summarizeNutrition(
      nutritionHistory,
      input.currentNutritionProgram,
    ),
    recovery: {
      sleep_hours_avg: null,
      soreness_level: null,
      fatigue_level: null,
      rest_days_per_week:
        trainingSummary.sessions_per_week == null
          ? null
          : Math.max(0, 7 - trainingSummary.sessions_per_week),
    },
    goal: {
      primary_goal: goal,
      requested_days_per_week: finiteNumber(
        (input as CoachContextBuilderInput).requestedDaysPerWeek,
      ),
      requested_session_duration_minutes: finiteNumber(
        (input as CoachContextBuilderInput).requestedSessionDurationMinutes,
      ),
      timeframe_weeks: finiteNumber(
        (input as CoachContextBuilderInput).timeframeWeeks,
      ),
    },
    constraints: {
      injuries,
      equipment,
      available_days: availableDays,
      session_duration_minutes: finiteNumber(
        (input as CoachContextBuilderInput).requestedSessionDurationMinutes,
      ),
    },
    safety_flags: [],
    missing_fields: Array.from(new Set(missingFields)),
  };

  coachContext.safety_flags = buildSafetyFlags(coachContext);
  return coachContext;
}

export function sanitizeCoachContextForPrompt(context: CoachContext): Omit<
  CoachContext,
  "profile"
> & {
  profile: Omit<CoachContext["profile"], "user_id">;
} {
  const { user_id: _userId, ...profile } = context.profile;
  return {
    ...context,
    profile,
    evidence_used: context.evidence_used?.map((item) => ({
      title: item.title,
      source_url: item.source_url,
      category: item.category,
      source_type: item.source_type,
      source: item.source,
      year: item.year,
      date: item.date,
      citation: item.citation,
      summary: item.summary,
    })),
  };
}
