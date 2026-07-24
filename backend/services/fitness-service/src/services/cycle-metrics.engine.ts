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
  adherenceRate: number; // 0-1 (AdherenceMetric.percent / 100)
  completionRate: number; // alias of adherenceRate today — kept as a distinct field per spec, may diverge later (e.g. counting partial completions)
  workoutsPerWeek: number;
  weeklyVolumeByMuscleGroup: VolumeWeek[];
  volumeTrendPercent: number | null;
  exerciseProgression: ExerciseProgression[];
  estimated1RmTrend: E1rmTrendPoint[];
  strengthProgressScore: number | null; // 0-1
  performanceConsistencyScore: number | null; // 0-1
  averageSessionRpe: number | null;
  rpeTrend: RpeTrend["trend"];
  averageRir: number | null; // always null — no RIR data source in this schema today, see note at bottom of file
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
  return null; // MAINTENANCE/ATHLETIC_PERFORMANCE/unset — no single composition-based goal signal
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
  const workoutLoggingCompleteness = params.adherence.total > 0 ? params.adherence.percent / 100 : 0;
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
  const [adherence, workoutMetrics, sessionFeedbackRows] = await Promise.all([
    computeAdherence(params.userId, params.planId, params.startDate, params.asOf),
    computeWorkoutMetrics(params.userId, params.startDate, params.asOf),
    prisma.cycleSessionFeedback.findMany({
      where: { cycleId: params.cycleId },
      select: {
        readinessScore: true,
        sessionRpe: true,
        painScore: true,
        workoutSchedule: { select: { date: true } },
      },
    }),
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

  return {
    adherenceRate: Math.round((adherence.percent / 100) * 100) / 100,
    completionRate: Math.round((adherence.percent / 100) * 100) / 100,
    workoutsPerWeek: Math.round((adherence.completed / cycleWeeks) * 10) / 10,
    weeklyVolumeByMuscleGroup: workoutMetrics.volumeByWeek,
    volumeTrendPercent: workoutMetrics.volumeChangePct,
    exerciseProgression,
    estimated1RmTrend: workoutMetrics.e1rmTrend,
    strengthProgressScore: computeStrengthProgressScore(exerciseProgression),
    performanceConsistencyScore: computePerformanceConsistencyScore(workoutMetrics.volumeByWeek),
    averageSessionRpe: fatigueRecovery.averageSessionRpe,
    rpeTrend: fatigueRecovery.rpeTrend,
    averageRir: null,
    painTrend: fatigueRecovery.painTrend,
    averagePainScore: fatigueRecovery.averagePainScore,
    fatigueScore: fatigueRecovery.fatigueScore,
    recoveryScore: fatigueRecovery.recoveryScore,
    bodyWeightTrend,
    skeletalMuscleTrend,
    bodyFatTrend,
    goalProgressScore: computeGoalProgressScore(params.goal, deltaSMM, deltaPBF),
    dataCompletenessScore,
    dataQualityScore,
    newPRs,
    inBodyQuality,
  };
}

// NOTE on averageRir: the spec's "Workout data" input list includes RIR
// (Reps in Reserve) alongside RPE. This schema's WorkoutSet only stores
// `rpe` (Float?) — there is no `rir` column anywhere in fitness-service or
// user-service. Rather than fabricate a value or silently ignore the
// requirement, averageRir is always returned as null (a real, documented
// "missing data" signal that lowers dataCompletenessScore's workout-side
// component implicitly via the same adherence/logging completeness used
// elsewhere) until a real RIR data source exists.
