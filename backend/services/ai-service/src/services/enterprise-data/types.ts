/**
 * Enterprise Data Layer — canonical typed shapes.
 *
 * "Enterprise Data Agent" is a logical architecture role (docs/ai-product/
 * phase3-current-ai-map.md), not an LLM agent. Every reader in this module
 * returns ONLY facts already persisted by an owning business service
 * (user-service/fitness-service) — never an LLM call, never a chat-text
 * inference, never an invented default. Conversation-derived candidate
 * values belong to belief-state.ts, not here.
 *
 * AuthoritativeRead<T> never collapses "fetched fine, nothing there" and
 * "upstream failed" into the same result — a caller that treats "error" as
 * "no nutrition goal" would be the exact bug this layer exists to prevent.
 */

export type DataSource = "USER_SERVICE" | "FITNESS_SERVICE";

export type AuthoritativeRead<T> =
  | { status: "ok"; value: T; source: DataSource; fetchedAt: number }
  | { status: "absent"; source: DataSource; fetchedAt: number }
  | { status: "error"; source: DataSource; fetchedAt: number; message: string };

export function ok<T>(value: T, source: DataSource, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "ok", value, source, fetchedAt };
}
export function absent<T>(source: DataSource, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "absent", source, fetchedAt };
}
export function errorRead<T>(source: DataSource, message: string, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "error", source, message, fetchedAt };
}

/** Same shape as UserProfile.nutritionGoal (llm/types.ts) — the ONE authoritative calorie/macro target. */
export interface NutritionGoalFacts {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Mirrors profile_extractor.ts's own compacted currentWorkoutProgram shape — not a new shape. */
export interface WorkoutProgramSummary {
  name?: string;
  goal?: string;
  daysPerWeek?: number;
  durationWeeks?: number;
  sourceType?: string;
  status?: string;
  dayCount?: number;
  daySummaries?: Array<{ dayNumber?: number; title?: string; exerciseCount: number }>;
}

/** Mirrors profile_extractor.ts's own compacted currentNutritionProgram shape — not a new shape. */
export interface NutritionProgramSummary {
  name?: string;
  goal?: string;
  dailyCaloriesTarget?: number;
  proteinTargetGrams?: number;
  carbTargetGrams?: number;
  fatTargetGrams?: number;
  mealsPerDay?: number;
  startDate?: string;
  endDate?: string;
  repeatEnabled?: boolean;
  status?: string;
  daySummaries?: Array<{
    dayNumber?: number;
    meals: Array<{
      mealType?: string;
      itemNames: string[];
    }>;
  }>;
}

/**
 * Phase 4.1 — mirror of fitness-service's `TrainingAnalyticsWindow`
 * (backend/services/fitness-service/src/services/training-analytics-window.service.ts,
 * GET /stats/training-window). fitness-service owns every formula and threshold;
 * this is a read-only shape and ai-service must never recompute these values.
 */
export type TrainingDataQuality =
  | "SUFFICIENT"
  | "PARTIAL"
  | "INSUFFICIENT_HISTORY"
  | "NO_DATA"
  | "STALE";

export interface TrainingWindowExerciseProgression {
  exerciseId: string | null;
  exerciseName: string;
  baselineE1rmKg: number;
  currentE1rmKg: number;
  changePct: number | null;
  weeksObserved: number;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowEffortSeries {
  observedSets: number;
  totalCompletedSets: number;
  weeklyAvg: number[];
  trend: "stable" | "increasing" | "decreasing" | null;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowSignal {
  code: "TRAINING_ADHERENCE_GOOD" | "TRAINING_ADHERENCE_LOW" | "INSUFFICIENT_TRAINING_HISTORY";
  basis: Record<string, number | string>;
}

export interface TrainingAnalyticsWindow {
  period: { from: string; to: string; days: number };
  adherence: {
    state: "NO_SCHEDULE" | "MEASURED";
    scheduledSessions: number;
    completedSessions: number;
    missedSessions: number | null;
    completionRate: number | null;
    dataQuality: TrainingDataQuality;
  };
  frequency: {
    completedPerWeek: number | null;
    scheduledPerWeek: number | null;
    trainingDaysLogged: number;
    weeklyVolumeConsistency: number | null;
    dataQuality: TrainingDataQuality;
  };
  volume: {
    totalVolumeLoadKg: number;
    byMuscleGroupKg: Record<string, number>;
    byWeek: Array<{ week: number; totalVolumeKg: number; byMuscleGroup: Record<string, number> }>;
    volumeTrendPercent: number | null;
    completedSetCount: number;
    loadedSetCount: number;
    dataQuality: TrainingDataQuality;
  };
  progression: { exercises: TrainingWindowExerciseProgression[]; dataQuality: TrainingDataQuality };
  plateau: { status: "NOT_AVAILABLE"; reason: string };
  effort: {
    rpe: TrainingWindowEffortSeries;
    rir: TrainingWindowEffortSeries;
    sessionFeedback: {
      feedbackCount: number;
      averageSessionRpe: number | null;
      sessionRpeSource: "session_feedback" | "set_rpe_fallback" | "none";
      averagePainScore: number | null;
      recoveryScore: number | null;
      dataQuality: TrainingDataQuality;
    };
  };
  signals: TrainingWindowSignal[];
  dataQuality: TrainingDataQuality;
}

/**
 * Phase 4.3 — read-only mirror of fitness-service's `NutritionAnalyticsWindow`
 * (GET /nutrition/analytics/window). fitness-service owns normalization,
 * source precedence and every number; ai-service must never recompute them.
 */
export type NutritionDataQuality = TrainingDataQuality;
export type NutritionCoverage = "COMPLETE" | "PARTIAL" | "NONE";

export interface NutritionActualDay {
  date: string;
  state: "LOGGED" | "NO_DATA";
  completeness: "COMPLETE" | "PARTIAL" | "COVERAGE_UNKNOWN" | "NO_DATA";
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  coverage: Record<"calories" | "protein" | "carbs" | "fat", NutritionCoverage>;
  sources: { mealCompletions: number; nutritionLogs: number; skippedMeals: number };
  hasExplicitSkip: boolean;
}

export interface NutritionDimensionAdherence {
  comparedDays: number;
  averageTarget: number;
  averageActual: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
}

export interface NutritionAnalyticsWindow {
  period: { from: string; to: string; days: number };
  activeTarget:
    | { state: "NO_ACTIVE_TARGET" }
    | { state: "ACTIVE_TARGET"; goalId: string; caloriesKcal: number; proteinG: number; carbsG: number; fatG: number; validFrom: string; triggeredBy: string | null };
  targetChangedInWindow: boolean;
  actual: {
    days: NutritionActualDay[];
    summary: {
      daysInWindow: number;
      loggedDays: number;
      calories: { averageKcal: number | null; daysUsed: number };
      protein: { averageG: number | null; daysUsed: number; partialDays: number };
      carbs: { averageG: number | null; daysUsed: number; partialDays: number };
      fat: { averageG: number | null; daysUsed: number; partialDays: number };
    };
  };
  adherence: {
    state: "MEASURED" | "NOT_AVAILABLE_NO_TARGET" | "NOT_AVAILABLE_NO_ACTUAL";
    calories: NutritionDimensionAdherence | null;
    protein: NutritionDimensionAdherence | null;
    carbs: NutritionDimensionAdherence | null;
    fat: NutritionDimensionAdherence | null;
  };
  dataQuality: NutritionDataQuality;
}

/**
 * Phase 4.4 — read-only mirror of fitness-service's `BodyGoalState`
 * (GET /stats/body-goal-state). fitness-service owns the trend/quality logic
 * (reused cycle-engine functions); ai-service must never recompute it.
 */
export type BodyDataQuality = TrainingDataQuality;
export type BodyTrajectoryReason =
  | "NO_TARGET" | "NO_TARGET_DATE" | "NO_STARTING_STATE" | "INSUFFICIENT_BODY_HISTORY" | "STALE_BODY_DATA" | "UNSUPPORTED_TARGET_METRIC";

export interface BodyObservationSnapshot {
  measuredAt: string;
  weightKg: number;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  source: "EXTRACTED" | "MANUAL" | "UNKNOWN";
  excludedFromTrend: boolean;
}
export interface BodyTrendSnapshot {
  status: "AVAILABLE" | "INSUFFICIENT_HISTORY";
  direction?: "UP" | "FLAT" | "DOWN";
  changePerWeek?: number | null;
  dataPoints: number;
}

export interface BodyGoalStateWindow {
  asOf: string;
  lookbackDays: number;
  body: {
    dataQuality: BodyDataQuality;
    observations: { totalOnRecord: number; inLookback: number; comparableInLookback: number; firstAt: string | null; latestAt: string | null };
    latest: BodyObservationSnapshot | null;
    previous: BodyObservationSnapshot | null;
    latestAgeDays: number | null;
    trends: { weight: BodyTrendSnapshot; bodyFat: BodyTrendSnapshot; muscleMass: BodyTrendSnapshot };
    quality: { outlierCount: number; intervalWarningCount: number; mixedSources: boolean; confidenceMultiplier: number; flags: string[] };
    muscleMassSemantics: "UNRESOLVED";
    muscleMassProvenance: { extracted: number; manual: number; unknown: number };
    profileReportedWeight: { kg: number; matchesLatestMeasurement: boolean | null; differenceFromLatestKg: number | null } | null;
  };
  goal: {
    type: string | null;
    currentTarget:
      | { state: "AVAILABLE"; weightKg: number; source: "PROFILE_TARGET_WEIGHT"; history: "TARGET_HISTORY_UNAVAILABLE" }
      | { state: "NO_TARGET" };
    startingState:
      | { state: "AVAILABLE"; scope: "ACTIVE_CYCLE_BASELINE"; weightKg: number; source: "INBODY" | "PROFILE_FALLBACK"; measuredAt: string | null; cycleStartedAt: string; targetAtCycleStartKg: number | null }
      | { state: "NOT_AVAILABLE"; reason: "NO_ACTIVE_CYCLE" | "NO_VALID_BASELINE_SNAPSHOT" };
    profileStartingWeightKg: number | null;
    gap:
      | {
          state: "AVAILABLE"; currentKg: number; targetKg: number; differenceKg: number; absoluteKg: number;
          currentSource: "MEASURED_INBODY" | "PROFILE_REPORTED"; currentAsOf: string | null;
          alternateCurrent: { source: "PROFILE_REPORTED"; kg: number; differenceKg: number } | null;
        }
      | { state: "NOT_AVAILABLE"; reason: "NO_TARGET" | "NO_CURRENT_WEIGHT" };
    trajectory: {
      observed:
        | {
            state: "AVAILABLE"; timeSpanDays: number; observationCount: number; firstWeightKg: number; latestWeightKg: number;
            observedChangeKg: number; observedRateKgPerWeek: number | null;
            directionRelativeToGap: "TOWARD_TARGET" | "AWAY_FROM_TARGET" | "FLAT" | "NOT_APPLICABLE";
          }
        | { state: "NOT_AVAILABLE"; reasons: BodyTrajectoryReason[] };
      onTrack: { status: "NOT_EVALUABLE"; reasons: BodyTrajectoryReason[]; classification: "DEFERRED" };
    };
    roadmap:
      | { state: "NONE" }
      | {
          state: "ACTIVE"; roadmapId: string; name: string; goalType: string; plannedStartAt: string; plannedEndAt: string | null;
          currentPhase: { id: string; name: string; phaseType: string; plannedStartAt: string; plannedEndAt: string } | null;
        };
    dataQuality: BodyDataQuality;
  };
}
