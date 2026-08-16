import { prisma } from "../repositories/prisma";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { InBodyEntrySnapshot } from "../clients/user.client";
import {
  computeAdherence,
  computeWorkoutMetrics,
  computeNewPRs,
  type AdherenceMetric,
  type VolumeWeek,
  type E1rmTrendPoint,
  type RpeTrend,
  type RirTrend,
} from "./training-cycle-metrics.service";
import { evaluateInBodyQuality, type InBodyQualityResult, type InBodyTrendPoint } from "./inbody-quality.evaluator";

export interface ExerciseProgression {
  exerciseName: string;
  firstWeekE1rm: number;
  lastWeekE1rm: number;
  changePct: number | null; // null if only one data point
  isPriority: boolean;
}

export interface FieldTrend {
  direction: "up" | "flat" | "down";
  changePerWeek: number | null;
  dataPoints: number;
}

export interface FatigueRecoveryMetrics {
  averageSessionRpe: number | null;
  sessionRpeSource: "session_feedback" | "set_rpe_fallback" | "none";
  rpeTrend: RpeTrend["trend"];
  painTrend: FieldTrend | null;
  averagePainScore: number | null;
  fatigueScore: number | null; // 0-1, higher = more fatigued (from RPE + pain trend)
  recoveryScore: number | null; // 0-1, higher = better recovery (from readinessScore trend)
}

export interface CycleMetricsResult {
  adherenceRate: number; // 0-1 (AdherenceMetric.percent / 100) — 0 when hasScheduledSessions is false; callers must check hasScheduledSessions before displaying this as a percentage
  completionRate: number; // alias of adherenceRate today — kept as a distinct field per spec, may diverge later (e.g. counting partial completions)
  /** false when there were zero scheduled sessions in the window at all —
   * distinguishes "genuinely 0% adherence" from "no data to judge yet".
   * The frontend must render "Chưa có dữ liệu"/similar instead of "0%"
   * when this is false (see TrainingCyclePage.tsx's CycleProgressSection). */
  hasScheduledSessions: boolean;
  workoutsPerWeek: number;
  weeklyVolumeByMuscleGroup: VolumeWeek[];
  volumeTrendPercent: number | null;
  /** % change in total volume per week, from a least-squares regression
   * across EVERY week of data (not just first-vs-last like volumeTrendPercent)
   * — a single anomalous first/last week can't dominate this signal. Null
   * with <2 weeks of volume data. */
  volumeProgressionSlope: number | null;
  exerciseProgression: ExerciseProgression[];
  estimated1RmTrend: E1rmTrendPoint[];
  strengthProgressScore: number | null; // 0-1
  performanceConsistencyScore: number | null; // 0-1
  averageSessionRpe: number | null;
  rpeTrend: RpeTrend["trend"];
  averageRir: number | null;
  rirTrend: RirTrend["trend"];
  painTrend: FieldTrend | null;
  averagePainScore: number | null;
  fatigueScore: number | null;
  recoveryScore: number | null;
  bodyWeightTrend: FieldTrend | null;
  skeletalMuscleTrend: FieldTrend | null;
  bodyFatTrend: FieldTrend | null;
  goalProgressScore: number | null; // 0-1
  dataCompletenessScore: number; // 0-1
  dataQualityScore: number; // 0-1, folds in InBody quality confidence
  newPRs: string[];
  inBodyQuality: InBodyQualityResult;
  /** Absolute count of scheduled-but-not-completed sessions in the window
   * (adherence.total - adherence.completed) — the Decision Engine previously
   * only saw a ratio (adherenceRate), which can't distinguish "80% of 10
   * sessions" from "80% of 100 sessions". Null carries the same 0/0
   * semantics as AdherenceMetric.percent (see computeAdherence's doc
   * comment) — 0 scheduled sessions is "no data", not "0 missed". */
  missedSessionCount: number | null;
  /** 0-1, or null if no nutrition logging exists at all in the window —
   * never fabricated as 0. Combines (days logged ÷ days in window) with
   * closeness of average logged calories to NutritionGoal.calories. */
  nutritionConsistencyScore: number | null;
}

/** First-week vs last-week estimated-1RM change per exercise, from the
 * existing per-exercise weekly-top e1RM trend. Priority/primary lifts (from
 * TrainingCycle.configuration.priorityExercises, case-insensitive match) are
 * flagged so callers can weight them instead of averaging every exercise
 * equally — an isolation accessory shouldn't count the same as a squat PR. */
export function computeExerciseProgression(
  e1rmTrend: E1rmTrendPoint[],
  priorityExercises: string[] = [],
): ExerciseProgression[] {
  const prioritySet = new Set(priorityExercises.map((p) => p.toLowerCase()));
  return e1rmTrend
    .filter((ex) => ex.weeklyTop.length > 0)
    .map((ex) => {
      const first = ex.weeklyTop[0].e1rm;
      const last = ex.weeklyTop[ex.weeklyTop.length - 1].e1rm;
      const changePct =
        ex.weeklyTop.length >= 2 && first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null;
      return {
        exerciseName: ex.exerciseName,
        firstWeekE1rm: first,
        lastWeekE1rm: last,
        changePct,
        isPriority: prioritySet.has(ex.exerciseName.toLowerCase()),
      };
    });
}

/** Weighted average of exercise e1RM progression, 0-1 (0 = -20% or worse
 * across the board, 1 = +20% or better; clamped/scaled linearly between).
 * Priority exercises (if configured) get 2x weight — otherwise every
 * exercise with enough data counts equally, deliberately not just the top-1. */
export function computeStrengthProgressScore(progression: ExerciseProgression[]): number | null {
  const withData = progression.filter((p) => p.changePct != null);
  if (withData.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of withData) {
    const weight = p.isPriority ? 2 : 1;
    // Scale: -20% -> 0, 0% -> 0.5, +20% -> 1, clamped.
    const scaled = Math.max(0, Math.min(1, 0.5 + p.changePct! / 40));
    weightedSum += scaled * weight;
    totalWeight += weight;
  }
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

/** Coefficient-of-variation-based consistency score across weekly training
 * volume: low relative variance (steady weekly output) scores near 1, high
 * variance (boom/bust weeks) scores near 0. Not a judgment on which pattern
 * is "correct" — just a descriptive signal fed into the Decision Engine. */
export function computePerformanceConsistencyScore(volumeByWeek: VolumeWeek[]): number | null {
  const values = volumeByWeek.map((w) => w.totalVolumeKg).filter((v) => v > 0);
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  // cv=0 -> score 1, cv>=1 -> score 0, linear in between.
  return Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100) / 100;
}

/** Continuous 0-1 version of the existing classifyBodyComposition up/flat/down
 * signal — how far the composition change moved toward (1) or away from (0)
 * the stated goal, centered at 0.5 for "no meaningful change". */
export function computeGoalProgressScore(
  goal: string | null,
  deltaSMM: number | null,
  deltaPBF: number | null,
  // Performance-goal athletes (powerlifting/strength sport, not
  // bodybuilding) may show flat/negative body-composition change during a
  // successful cycle — strength/skill IS the progress, not muscle/fat delta.
  // Previously this function returned null unconditionally for
  // ATHLETIC_PERFORMANCE, meaning the Decision Engine had literally no
  // goalProgressScore signal for this goal at all (see
  // docs/USER_LEVEL_PERSONALIZATION_PLAN.md, nhóm D). Optional and
  // backward-compatible: omitting it reproduces the exact prior behavior
  // for MUSCLE_GAIN/WEIGHT_LOSS/other goals.
  strengthProgressScore?: number | null,
): number | null {
  const c = cycleThresholds.classification;
  if (goal === "MUSCLE_GAIN") {
    if (deltaSMM == null) return null;
    return Math.round(Math.max(0, Math.min(1, 0.5 + deltaSMM / (2 * c.smmProgressingMinKg))) * 100) / 100;
  }
  if (goal === "WEIGHT_LOSS") {
    if (deltaPBF == null) return null;
    return Math.round(Math.max(0, Math.min(1, 0.5 - deltaPBF / (2 * Math.abs(c.pbfProgressingMaxPct)))) * 100) / 100;
  }
  if (goal === "ATHLETIC_PERFORMANCE") {
    // computeStrengthProgressScore is already 0-1 (0.5 = no change), the
    // same scale this function returns on every other branch — reuse it
    // directly rather than re-deriving a parallel formula.
    return strengthProgressScore ?? null;
  }
  return null; // MAINTENANCE/unset — no single composition-based goal signal
}

function linearTrend(points: Array<{ dayOffset: number; value: number }>): FieldTrend | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { direction: "flat", changePerWeek: null, dataPoints: 1 };

  // Simple least-squares slope (value per day), then scale to per-week.
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.dayOffset, 0);
  const sumY = points.reduce((s, p) => s + p.value, 0);
  const sumXY = points.reduce((s, p) => s + p.dayOffset * p.value, 0);
  const sumXX = points.reduce((s, p) => s + p.dayOffset * p.dayOffset, 0);
  const denom = n * sumXX - sumX * sumX;
  const slopePerDay = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const changePerWeek = Math.round(slopePerDay * 7 * 100) / 100;

  const direction: FieldTrend["direction"] =
    Math.abs(changePerWeek) < 0.05 ? "flat" : changePerWeek > 0 ? "up" : "down";
  return { direction, changePerWeek, dataPoints: n };
}

/** Body-weight/skeletal-muscle/body-fat trends from all comparable
 * (non-outlier) InBody points for the cycle — uses a real trend line across
 * 3+ points when available, falls back to a 2-point delta, and returns null
 * (not a guess) below that. Always operates on InBodyDataQualityEvaluator's
 * comparablePoints, never raw/outlier-included entries. */
export function computeBodyCompositionTrends(comparablePoints: InBodyTrendPoint[]): {
  bodyWeightTrend: FieldTrend | null;
  skeletalMuscleTrend: FieldTrend | null;
  bodyFatTrend: FieldTrend | null;
} {
  if (comparablePoints.length === 0) {
    return { bodyWeightTrend: null, skeletalMuscleTrend: null, bodyFatTrend: null };
  }
  const t0 = new Date(comparablePoints[0].date).getTime();
  const dayOffset = (d: string) => (new Date(d).getTime() - t0) / 86_400_000;

  return {
    bodyWeightTrend: linearTrend(comparablePoints.map((p) => ({ dayOffset: dayOffset(p.date), value: p.weight }))),
    skeletalMuscleTrend: linearTrend(
      comparablePoints.map((p) => ({ dayOffset: dayOffset(p.date), value: p.muscleMass })),
    ),
    bodyFatTrend: linearTrend(
      comparablePoints
        .filter((p) => p.bodyFatPct != null)
        .map((p) => ({ dayOffset: dayOffset(p.date), value: p.bodyFatPct! })),
    ),
  };
}

/** % change in weekly volume per week, from a least-squares regression across
 * every week with data — unlike volumeChangePct (training-cycle-metrics.service.ts),
 * which only compares the first and last week, a single noisy week can't
 * dominate this signal. Null with <2 weeks of data or a zero/negative
 * baseline (can't express a % change against it). */
export function computeVolumeProgressionSlope(weeks: VolumeWeek[]): number | null {
  if (weeks.length < 2) return null;
  const trend = linearTrend(weeks.map((w) => ({ dayOffset: w.week * 7, value: w.totalVolumeKg })));
  if (!trend || trend.changePerWeek == null) return null;
  const baseline = weeks[0].totalVolumeKg;
  if (baseline <= 0) return null;
  return Math.round((trend.changePerWeek / baseline) * 1000) / 10;
}

/** 0-1 nutrition consistency: (days with any logged meal ÷ days in window)
 * combined with how close average logged calories sit to NutritionGoal.calories.
 * Returns null (never 0) when nothing was logged at all in the window — no
 * nutrition data is "unknown", not "zero consistency". Kept as a plain async
 * DB read (not folded into computeCycleMetrics's Promise.all) so callers that
 * don't need it (e.g. legacy /complete, which doesn't touch nutrition today)
 * aren't forced to pay the query. */
export async function computeNutritionConsistencyScore(params: {
  userId: string;
  startDate: Date;
  asOf: Date;
}): Promise<number | null> {
  const [mealCompletions, nutritionGoal] = await Promise.all([
    prisma.nutritionMealCompletion.findMany({
      where: { userId: params.userId, logDate: { gte: params.startDate, lte: params.asOf } },
      select: { logDate: true, status: true, consumedCalories: true },
    }),
    prisma.nutritionGoal.findUnique({ where: { userId: params.userId } }),
  ]);
  if (mealCompletions.length === 0) return null;

  const byDay = new Map<string, { calories: number }>();
  for (const m of mealCompletions) {
    if (m.status !== "COMPLETED" && m.status !== "PARTIAL") continue;
    const key = m.logDate.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? { calories: 0 };
    day.calories += m.consumedCalories ?? 0;
    byDay.set(key, day);
  }
  const loggedDays = [...byDay.values()];
  if (loggedDays.length === 0) return null;

  const totalDaysInWindow = Math.max(
    1,
    Math.floor((params.asOf.getTime() - params.startDate.getTime()) / 86_400_000) + 1,
  );
  const daysLoggedRatio = Math.min(1, loggedDays.length / totalDaysInWindow);
  const avgCalories = loggedDays.reduce((s, d) => s + d.calories, 0) / loggedDays.length;
  const targetCalories = nutritionGoal?.calories ?? null;
  // No target set at all — can't judge closeness, don't penalize for it.
  const closeness =
    targetCalories && targetCalories > 0
      ? Math.max(0, 1 - Math.abs(avgCalories - targetCalories) / targetCalories)
      : 1;

  return Math.round(daysLoggedRatio * closeness * 100) / 100;
}

interface SessionFeedbackRow {
  readinessScore: number | null;
  sessionRpe: number | null;
  painScore: number | null;
  date: string; // WorkoutSchedule.date, joined in
}

/** Fatigue/recovery/pain metrics from per-session subjective feedback
 * (CycleSessionFeedback — a brand-new data source, so early cycles will
 * often have none; falls back to the existing set-level RPE trend when no
 * session feedback exists, rather than returning nothing). */
export function computeFatigueRecoveryMetrics(
  sessionFeedback: SessionFeedbackRow[],
  fallbackRpeTrend: RpeTrend,
): FatigueRecoveryMetrics {
  const rpeValues = sessionFeedback.map((s) => s.sessionRpe).filter((v): v is number => v != null);
  const painValues = sessionFeedback
    .filter((s) => s.painScore != null)
    .map((s) => ({ dayOffset: 0, value: s.painScore as number, date: s.date }));
  const readinessValues = sessionFeedback.map((s) => s.readinessScore).filter((v): v is number => v != null);

  const hasSessionRpe = rpeValues.length > 0;
  const averageSessionRpe = hasSessionRpe
    ? Math.round((rpeValues.reduce((s, v) => s + v, 0) / rpeValues.length) * 10) / 10
    : fallbackRpeTrend.weeklyAvg.length > 0
      ? Math.round(
          (fallbackRpeTrend.weeklyAvg.reduce((s, v) => s + v, 0) / fallbackRpeTrend.weeklyAvg.length) * 10,
        ) / 10
      : null;

  let painTrend: FieldTrend | null = null;
  if (painValues.length > 0) {
    const t0 = new Date(painValues[0].date).getTime();
    painTrend = linearTrend(
      painValues.map((p) => ({ dayOffset: (new Date(p.date).getTime() - t0) / 86_400_000, value: p.value })),
    );
  }
  const averagePainScore =
    painValues.length > 0
      ? Math.round((painValues.reduce((s, v) => s + v.value, 0) / painValues.length) * 10) / 10
      : null;

  // fatigueScore: rising RPE trend + rising pain trend => more fatigued (0-1).
  let fatigueScore: number | null = null;
  if (hasSessionRpe || fallbackRpeTrend.weeklyAvg.length > 0) {
    const rpeComponent =
      fallbackRpeTrend.trend === "increasing" ? 0.7 : fallbackRpeTrend.trend === "decreasing" ? 0.3 : 0.5;
    const painComponent = painTrend?.direction === "up" ? 0.8 : painTrend?.direction === "down" ? 0.2 : 0.5;
    fatigueScore = Math.round(((rpeComponent + painComponent) / 2) * 100) / 100;
  }

  const recoveryScore =
    readinessValues.length > 0
      ? Math.round((readinessValues.reduce((s, v) => s + v, 0) / readinessValues.length / 10) * 100) / 100
      : null;

  return {
    averageSessionRpe,
    sessionRpeSource: hasSessionRpe ? "session_feedback" : fallbackRpeTrend.weeklyAvg.length > 0 ? "set_rpe_fallback" : "none",
    rpeTrend: fallbackRpeTrend.trend,
    painTrend,
    averagePainScore,
    fatigueScore,
    recoveryScore,
  };
}

/** Fraction of expected data actually present, across workout logging,
 * InBody measurements, and session feedback — feeds dataQualityScore
 * alongside InBodyDataQualityEvaluator's confidenceMultiplier. */
export function computeDataCompletenessScore(params: {
  adherence: AdherenceMetric;
  inBodyRecordCount: number;
  minimumComparableInBodyRecords: number;
  sessionFeedbackCount: number;
  completedSessionCount: number;
}): number {
  const workoutLoggingCompleteness = params.adherence.total > 0 ? (params.adherence.percent ?? 0) / 100 : 0;
  const inbodyCompleteness = Math.min(
    1,
    params.inBodyRecordCount / Math.max(1, params.minimumComparableInBodyRecords),
  );
  const feedbackCompleteness =
    params.completedSessionCount > 0
      ? Math.min(1, params.sessionFeedbackCount / params.completedSessionCount)
      : 0;
  // Workout logging matters most (it's the core signal), InBody second,
  // subjective feedback last (most optional per spec).
  const score = workoutLoggingCompleteness * 0.5 + inbodyCompleteness * 0.35 + feedbackCompleteness * 0.15;
  return Math.round(score * 100) / 100;
}

export async function computeCycleMetrics(params: {
  cycleId: string;
  userId: string;
  planId: string | null;
  goal: string | null;
  startDate: Date;
  asOf: Date;
  inBodyEntries: InBodyEntrySnapshot[]; // from CycleInBodyLink + start/end, caller-fetched
  priorityExercises?: string[]; // from TrainingCycle.configuration.priorityExercises
}): Promise<CycleMetricsResult> {
  const [adherence, workoutMetrics, sessionFeedbackRows, nutritionConsistencyScore] = await Promise.all([
    computeAdherence(params.userId, params.planId, params.startDate, params.asOf),
    computeWorkoutMetrics(params.userId, params.startDate, params.asOf, params.planId),
    prisma.cycleSessionFeedback.findMany({
      where: { cycleId: params.cycleId },
      select: {
        readinessScore: true,
        sessionRpe: true,
        painScore: true,
        workoutSchedule: { select: { date: true } },
      },
    }),
    computeNutritionConsistencyScore({ userId: params.userId, startDate: params.startDate, asOf: params.asOf }),
  ]);

  const newPRs = await computeNewPRs(params.userId, workoutMetrics.sets, params.startDate);

  const sessionFeedback: SessionFeedbackRow[] = sessionFeedbackRows.map((r) => ({
    readinessScore: r.readinessScore,
    sessionRpe: r.sessionRpe,
    painScore: r.painScore,
    date: r.workoutSchedule.date.toISOString(),
  }));

  const inBodyQuality = evaluateInBodyQuality(params.inBodyEntries);
  const { bodyWeightTrend, skeletalMuscleTrend, bodyFatTrend } = computeBodyCompositionTrends(
    inBodyQuality.comparablePoints,
  );

  const deltaSMM =
    bodyWeightTrend && skeletalMuscleTrend && inBodyQuality.comparablePoints.length >= 2
      ? Math.round(
          (inBodyQuality.comparablePoints[inBodyQuality.comparablePoints.length - 1].muscleMass -
            inBodyQuality.comparablePoints[0].muscleMass) *
            100,
        ) / 100
      : null;
  const firstPct = inBodyQuality.comparablePoints[0]?.bodyFatPct;
  const lastPct = inBodyQuality.comparablePoints[inBodyQuality.comparablePoints.length - 1]?.bodyFatPct;
  const deltaPBF =
    inBodyQuality.comparablePoints.length >= 2 && firstPct != null && lastPct != null
      ? Math.round((lastPct - firstPct) * 100) / 100
      : null;

  const exerciseProgression = computeExerciseProgression(workoutMetrics.e1rmTrend, params.priorityExercises);
  const fatigueRecovery = computeFatigueRecoveryMetrics(sessionFeedback, workoutMetrics.rpeTrend);

  const cycleWeeks = Math.max(1, Math.ceil((params.asOf.getTime() - params.startDate.getTime()) / (7 * 86_400_000)));
  const dataCompletenessScore = computeDataCompletenessScore({
    adherence,
    inBodyRecordCount: inBodyQuality.comparableRecordCount,
    minimumComparableInBodyRecords: cycleThresholds.assessment.minimumComparableInBodyRecords,
    sessionFeedbackCount: sessionFeedback.length,
    completedSessionCount: adherence.completed,
  });
  const dataQualityScore =
    Math.round(dataCompletenessScore * inBodyQuality.confidenceMultiplier * 100) / 100;

  // adherence.percent is null when there were zero scheduled sessions —
  // treated as 0 here (not skipped) so the Decision Engine's own
  // TOO_FEW_COMPLETED_SESSIONS / CYCLE_TOO_SHORT gates (which look at
  // completedSessions/cycleDurationDays directly, not adherenceRate) are
  // what correctly route a 0/0 cycle to INSUFFICIENT_DATA — this field is
  // just not left as NaN.
  const adherenceRateValue = adherence.percent == null ? 0 : Math.round((adherence.percent / 100) * 100) / 100;
  const strengthProgressScoreValue = computeStrengthProgressScore(exerciseProgression);

  return {
    adherenceRate: adherenceRateValue,
    completionRate: adherenceRateValue,
    hasScheduledSessions: adherence.total > 0,
    workoutsPerWeek: Math.round((adherence.completed / cycleWeeks) * 10) / 10,
    weeklyVolumeByMuscleGroup: workoutMetrics.volumeByWeek,
    volumeTrendPercent: workoutMetrics.volumeChangePct,
    volumeProgressionSlope: computeVolumeProgressionSlope(workoutMetrics.volumeByWeek),
    exerciseProgression,
    estimated1RmTrend: workoutMetrics.e1rmTrend,
    strengthProgressScore: strengthProgressScoreValue,
    performanceConsistencyScore: computePerformanceConsistencyScore(workoutMetrics.volumeByWeek),
    averageSessionRpe: fatigueRecovery.averageSessionRpe,
    rpeTrend: fatigueRecovery.rpeTrend,
    // No RIR source at the CycleSessionFeedback (session-level) layer, only
    // the set-level WorkoutSet.rir — averaged across whatever weeks logged
    // it, same shape as averageSessionRpe's set-level fallback.
    averageRir:
      workoutMetrics.rirTrend.weeklyAvg.length > 0
        ? Math.round(
            (workoutMetrics.rirTrend.weeklyAvg.reduce((s, v) => s + v, 0) /
              workoutMetrics.rirTrend.weeklyAvg.length) *
              10,
          ) / 10
        : null,
    rirTrend: workoutMetrics.rirTrend.trend,
    painTrend: fatigueRecovery.painTrend,
    averagePainScore: fatigueRecovery.averagePainScore,
    fatigueScore: fatigueRecovery.fatigueScore,
    recoveryScore: fatigueRecovery.recoveryScore,
    bodyWeightTrend,
    skeletalMuscleTrend,
    bodyFatTrend,
    goalProgressScore: computeGoalProgressScore(params.goal, deltaSMM, deltaPBF, strengthProgressScoreValue),
    dataCompletenessScore,
    dataQualityScore,
    newPRs,
    inBodyQuality,
    missedSessionCount: adherence.total > 0 ? adherence.total - adherence.completed : null,
    nutritionConsistencyScore,
  };
}
