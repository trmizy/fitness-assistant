/**
 * Phase 4.1 — rolling-window training analytics (docs/ai-product/phase4-1-training-coach-state.md).
 *
 * NOT a new analytics engine. Every number here is produced by the same
 * functions the TrainingCycle report already uses (computeAdherence,
 * computeWorkoutMetrics, computeExerciseProgression,
 * computePerformanceConsistencyScore, computeFatigueRecoveryMetrics) — their
 * "cycleStart" parameter is already just a window start. This module only
 * (a) picks the window, (b) attaches explicit data-quality states and
 * (c) applies the EXISTING cycleThresholds to emit deterministic signals.
 *
 * No LLM, no cache, no mutation.
 */
import { prisma } from "../repositories/prisma";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import {
  computeAdherence,
  computeWorkoutMetrics,
  type AdherenceMetric,
  type RirTrend,
  type RpeTrend,
  type VolumeWeek,
} from "./training-cycle-metrics.service";
import {
  computeExerciseProgression,
  computeFatigueRecoveryMetrics,
  computePerformanceConsistencyScore,
} from "./cycle-metrics.engine";

export type TrainingDataQuality =
  | "SUFFICIENT"
  | "PARTIAL"
  | "INSUFFICIENT_HISTORY"
  | "NO_DATA"
  | "STALE";

export const TRAINING_WINDOW_DEFAULT_DAYS = 28;
export const TRAINING_WINDOW_MIN_DAYS = 7;
export const TRAINING_WINDOW_MAX_DAYS = 90;

export interface TrainingWindowAdherence {
  /** NO_SCHEDULE: no WorkoutSchedule rows in the window (no denominator).
   * Never rendered as 0%. */
  state: "NO_SCHEDULE" | "MEASURED";
  scheduledSessions: number;
  completedSessions: number;
  /** Same definition as cycle report's missedSessionCount: scheduled − completed
   * (includes SKIPPED/CANCELLED/NOT_STARTED rows dated ≤ now). null when NO_SCHEDULE. */
  missedSessions: number | null;
  /** 0..1, null when NO_SCHEDULE. */
  completionRate: number | null;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowFrequency {
  completedPerWeek: number | null;
  scheduledPerWeek: number | null;
  /** Distinct calendar days with ≥1 completed logged set. */
  trainingDaysLogged: number;
  /** 0..1 from computePerformanceConsistencyScore (weekly volume CV); null with <2 weeks. */
  weeklyVolumeConsistency: number | null;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowVolume {
  /** Σ weight×reps (kg) over completed sets with both values. Same basis as the cycle report. */
  totalVolumeLoadKg: number;
  /** Each activated muscle group receives the set's full load (existing engine semantics —
   * groups are not split, so the by-group values do not sum to the total). */
  byMuscleGroupKg: Record<string, number>;
  byWeek: VolumeWeek[];
  volumeTrendPercent: number | null;
  completedSetCount: number;
  /** Completed sets that contributed to volume (weight and reps present). */
  loadedSetCount: number;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowExerciseProgression {
  exerciseId: string | null;
  exerciseName: string;
  /** Best estimated 1RM (kg) in the first / last week that has data inside the window. */
  baselineE1rmKg: number;
  currentE1rmKg: number;
  /** % change first→last observed week; null with a single observed week. */
  changePct: number | null;
  /** Number of distinct window weeks with a qualifying (non-warm-up, loaded) set. */
  weeksObserved: number;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowEffortSeries {
  observedSets: number;
  totalCompletedSets: number;
  weeklyAvg: number[];
  trend: RpeTrend["trend"] | RirTrend["trend"] | null;
  dataQuality: TrainingDataQuality;
}

export interface TrainingWindowSignal {
  code: "TRAINING_ADHERENCE_GOOD" | "TRAINING_ADHERENCE_LOW" | "INSUFFICIENT_TRAINING_HISTORY";
  /** Plain-data basis so the consumer can show/verify why without recomputing. */
  basis: Record<string, number | string>;
}

export interface TrainingAnalyticsWindow {
  period: { from: string; to: string; days: number };
  adherence: TrainingWindowAdherence;
  frequency: TrainingWindowFrequency;
  volume: TrainingWindowVolume;
  progression: {
    /** Top-N most frequently trained exercises only (computeE1rmTrend topN). */
    exercises: TrainingWindowExerciseProgression[];
    dataQuality: TrainingDataQuality;
  };
  /** The existing plateau logic is a composite inside the cycle decision engine
   * (needs cycle scope + InBody + adherence gates); it is not a standalone
   * rolling-window classifier, so it is not faked here. */
  plateau: { status: "NOT_AVAILABLE"; reason: string };
  effort: {
    rpe: TrainingWindowEffortSeries;
    rir: TrainingWindowEffortSeries;
    sessionFeedback: {
      feedbackCount: number;
      averageSessionRpe: number | null;
      sessionRpeSource: "session_feedback" | "set_rpe_fallback" | "none";
      averagePainScore: number | null;
      /** 0..1 (mean readiness ÷ 10). null if nobody filled readiness. */
      recoveryScore: number | null;
      dataQuality: TrainingDataQuality;
    };
  };
  signals: TrainingWindowSignal[];
  dataQuality: TrainingDataQuality;
}

// ─── window ──────────────────────────────────────────────────────────────

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function normalizeWindowDays(days: number | undefined): number {
  if (days == null) return TRAINING_WINDOW_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < TRAINING_WINDOW_MIN_DAYS || days > TRAINING_WINDOW_MAX_DAYS) {
    throw new RangeError(
      `days must be an integer between ${TRAINING_WINDOW_MIN_DAYS} and ${TRAINING_WINDOW_MAX_DAYS}`,
    );
  }
  return days;
}

/** Window = the `days` UTC calendar days ending on (and including) asOf's UTC day,
 * start at 00:00:00Z (WorkoutSchedule.date is stored date-only at UTC midnight), end at
 * the asOf instant — so rows dated after asOf (future sessions) are excluded, exactly
 * the `date >= start AND date <= asOf` convention computeAdherence/fetchCompletedSets use. */
export function resolveTrainingWindow(asOf: Date, days: number): { from: Date; to: Date } {
  const from = new Date(startOfUtcDay(asOf).getTime() - (days - 1) * 86_400_000);
  return { from, to: asOf };
}

// ─── pure assembly (unit-testable without a DB) ─────────────────────────

export interface TrainingWindowSetRow {
  date: Date;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  exerciseName: string;
  exerciseId?: string;
  setType: string | null;
}

export interface TrainingWindowInputs {
  from: Date;
  to: Date;
  days: number;
  adherence: AdherenceMetric;
  workout: {
    sets: TrainingWindowSetRow[];
    volumeByWeek: VolumeWeek[];
    volumeChangePct: number | null;
    e1rmTrend: Array<{ exerciseName: string; weeklyTop: Array<{ week: number; e1rm: number }> }>;
    rpeTrend: RpeTrend;
    rirTrend: RirTrend;
  };
  sessionFeedback: Array<{
    readinessScore: number | null;
    sessionRpe: number | null;
    painScore: number | null;
    date: string;
  }>;
  /** True when an earlier workout exists before `from` — distinguishes STALE from NO_DATA. */
  hasActivityBeforeWindow: boolean;
}

function meetsMinimumSample(days: number, observed: number): boolean {
  return (
    days >= cycleThresholds.assessment.minimumCycleDays &&
    observed >= cycleThresholds.assessment.minimumCompletedSessions
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function effortSeries(
  sets: TrainingWindowSetRow[],
  key: "rpe" | "rir",
  trend: RpeTrend | RirTrend,
): TrainingWindowEffortSeries {
  const observed = sets.filter((s) => s[key] != null).length;
  const total = sets.length;
  let dataQuality: TrainingDataQuality;
  if (total === 0) dataQuality = "NO_DATA";
  else if (observed === 0) dataQuality = "NO_DATA"; // never logged — not "0 effort"
  else if (trend.weeklyAvg.length < 3) dataQuality = "INSUFFICIENT_HISTORY";
  else if (observed / total < 0.5) dataQuality = "PARTIAL";
  else dataQuality = "SUFFICIENT";
  return {
    observedSets: observed,
    totalCompletedSets: total,
    weeklyAvg: trend.weeklyAvg,
    // The existing trend labels need ≥3 weeks; below that "stable" is a default, not a finding.
    trend: trend.weeklyAvg.length >= 3 ? trend.trend : null,
    dataQuality,
  };
}

export function buildTrainingAnalyticsWindow(input: TrainingWindowInputs): TrainingAnalyticsWindow {
  const { days, adherence, workout } = input;
  const completedSets = workout.sets;
  const trainingDays = new Set(completedSets.map((s) => new Date(s.date).toISOString().slice(0, 10)));
  const trainingDaysLogged = trainingDays.size;
  const hasAnyActivity = adherence.total > 0 || completedSets.length > 0;

  // ── adherence
  const hasSchedule = adherence.total > 0;
  const adherenceBlock: TrainingWindowAdherence = {
    state: hasSchedule ? "MEASURED" : "NO_SCHEDULE",
    scheduledSessions: adherence.total,
    completedSessions: adherence.completed,
    missedSessions: hasSchedule ? adherence.total - adherence.completed : null,
    completionRate: adherence.percent == null ? null : Math.round(adherence.percent) / 100,
    dataQuality: !hasSchedule
      ? "NO_DATA"
      : meetsMinimumSample(days, adherence.total)
        ? "SUFFICIENT"
        : "PARTIAL",
  };

  // ── frequency
  const weeks = days / 7;
  const sessionsObserved = Math.max(adherence.completed, trainingDaysLogged);
  const frequency: TrainingWindowFrequency = {
    completedPerWeek: hasAnyActivity ? round1(sessionsObserved / weeks) : null,
    scheduledPerWeek: hasSchedule ? round1(adherence.total / weeks) : null,
    trainingDaysLogged,
    weeklyVolumeConsistency: computePerformanceConsistencyScore(workout.volumeByWeek),
    dataQuality:
      sessionsObserved === 0
        ? "NO_DATA"
        : sessionsObserved < 2
          ? "INSUFFICIENT_HISTORY"
          : meetsMinimumSample(days, sessionsObserved)
            ? "SUFFICIENT"
            : "PARTIAL",
  };

  // ── volume
  const byMuscleGroupKg: Record<string, number> = {};
  let totalVolumeLoadKg = 0;
  for (const w of workout.volumeByWeek) {
    totalVolumeLoadKg += w.totalVolumeKg;
    for (const [group, v] of Object.entries(w.byMuscleGroup)) {
      byMuscleGroupKg[group] = (byMuscleGroupKg[group] ?? 0) + v;
    }
  }
  const loadedSetCount = completedSets.filter((s) => s.weight != null && s.reps != null).length;
  const volume: TrainingWindowVolume = {
    totalVolumeLoadKg: Math.round(totalVolumeLoadKg),
    byMuscleGroupKg: Object.fromEntries(
      Object.entries(byMuscleGroupKg).map(([k, v]) => [k, Math.round(v)]),
    ),
    byWeek: workout.volumeByWeek.map((w) => ({
      week: w.week,
      totalVolumeKg: Math.round(w.totalVolumeKg),
      byMuscleGroup: Object.fromEntries(
        Object.entries(w.byMuscleGroup).map(([k, v]) => [k, Math.round(v)]),
      ),
    })),
    volumeTrendPercent: workout.volumeChangePct,
    completedSetCount: completedSets.length,
    loadedSetCount,
    dataQuality:
      loadedSetCount === 0
        ? completedSets.length === 0
          ? "NO_DATA"
          : "PARTIAL" // sets exist but none carry load×reps (e.g. bodyweight-only)
        : trainingDaysLogged < 2
          ? "INSUFFICIENT_HISTORY"
          : meetsMinimumSample(days, trainingDaysLogged)
            ? "SUFFICIENT"
            : "PARTIAL",
  };

  // ── progression
  const idByName = new Map<string, string>();
  for (const s of completedSets) {
    if (s.exerciseId && !idByName.has(s.exerciseName)) idByName.set(s.exerciseName, s.exerciseId);
  }
  const progressionRaw = computeExerciseProgression(workout.e1rmTrend);
  const weeksByName = new Map(workout.e1rmTrend.map((t) => [t.exerciseName, t.weeklyTop.length]));
  const exercises: TrainingWindowExerciseProgression[] = progressionRaw.map((p) => {
    const weeksObserved = weeksByName.get(p.exerciseName) ?? 0;
    return {
      exerciseId: idByName.get(p.exerciseName) ?? null,
      exerciseName: p.exerciseName,
      baselineE1rmKg: p.firstWeekE1rm,
      currentE1rmKg: p.lastWeekE1rm,
      changePct: p.changePct,
      weeksObserved,
      // plateauWindowWeeks (existing config) is the repository's own "weeks of
      // history needed before a stall can be judged" — reused as the minimum
      // for a trend that is more than a two-point difference.
      dataQuality:
        weeksObserved >= cycleThresholds.assessment.plateauWindowWeeks
          ? "SUFFICIENT"
          : weeksObserved === 2
            ? "PARTIAL"
            : "INSUFFICIENT_HISTORY",
    };
  });
  const progressionQuality: TrainingDataQuality =
    exercises.length === 0
      ? "NO_DATA"
      : exercises.some((e) => e.dataQuality === "SUFFICIENT")
        ? "SUFFICIENT"
        : exercises.some((e) => e.dataQuality === "PARTIAL")
          ? "PARTIAL"
          : "INSUFFICIENT_HISTORY";

  // ── effort / recovery signals
  const fatigue = computeFatigueRecoveryMetrics(input.sessionFeedback, workout.rpeTrend);
  const feedbackCount = input.sessionFeedback.length;
  const hasReadiness = input.sessionFeedback.some((f) => f.readinessScore != null);
  const hasPain = input.sessionFeedback.some((f) => f.painScore != null);
  const sessionFeedback = {
    feedbackCount,
    averageSessionRpe: fatigue.averageSessionRpe,
    sessionRpeSource: fatigue.sessionRpeSource,
    averagePainScore: fatigue.averagePainScore,
    recoveryScore: fatigue.recoveryScore,
    dataQuality: (feedbackCount === 0 || (!hasReadiness && !hasPain && fatigue.sessionRpeSource === "none")
      ? "NO_DATA"
      : feedbackCount < 3
        ? "INSUFFICIENT_HISTORY"
        : "PARTIAL") as TrainingDataQuality,
  };

  // ── overall quality
  let dataQuality: TrainingDataQuality;
  if (!hasAnyActivity) dataQuality = input.hasActivityBeforeWindow ? "STALE" : "NO_DATA";
  else if (sessionsObserved < 2) dataQuality = "INSUFFICIENT_HISTORY";
  else if (meetsMinimumSample(days, sessionsObserved)) dataQuality = "SUFFICIENT";
  else dataQuality = "PARTIAL";

  // ── signals: thresholds are the repository's own (cycleThresholds.classification)
  const signals: TrainingWindowSignal[] = [];
  if (adherenceBlock.state === "MEASURED" && adherenceBlock.dataQuality === "SUFFICIENT") {
    const pct = Math.round((adherenceBlock.completionRate ?? 0) * 100);
    if (pct >= cycleThresholds.classification.adherenceProgressingMinPct) {
      signals.push({
        code: "TRAINING_ADHERENCE_GOOD",
        basis: { completionPct: pct, thresholdPct: cycleThresholds.classification.adherenceProgressingMinPct },
      });
    } else if (pct <= cycleThresholds.classification.adherenceDecliningMaxPct) {
      signals.push({
        code: "TRAINING_ADHERENCE_LOW",
        basis: { completionPct: pct, thresholdPct: cycleThresholds.classification.adherenceDecliningMaxPct },
      });
    }
  }
  if (dataQuality === "INSUFFICIENT_HISTORY") {
    signals.push({
      code: "INSUFFICIENT_TRAINING_HISTORY",
      basis: { sessionsObserved, windowDays: days },
    });
  }

  return {
    period: { from: input.from.toISOString(), to: input.to.toISOString(), days },
    adherence: adherenceBlock,
    frequency,
    volume,
    progression: { exercises, dataQuality: progressionQuality },
    plateau: {
      status: "NOT_AVAILABLE",
      reason:
        "Plateau detection exists only as a composite inside the cycle decision engine (needs cycle scope, InBody and adherence gates); no standalone rolling-window classifier exists.",
    },
    effort: {
      rpe: effortSeries(completedSets, "rpe", workout.rpeTrend),
      rir: effortSeries(completedSets, "rir", workout.rirTrend),
      sessionFeedback,
    },
    signals,
    dataQuality,
  };
}

// ─── read path ───────────────────────────────────────────────────────────

export async function getTrainingAnalyticsWindow(
  userId: string,
  opts: { days?: number; asOf?: Date } = {},
): Promise<TrainingAnalyticsWindow> {
  const days = normalizeWindowDays(opts.days);
  const asOf = opts.asOf ?? new Date();
  const { from, to } = resolveTrainingWindow(asOf, days);

  // Bounded, user-scoped queries — no per-workout / per-set round trips.
  const [adherence, workout, feedbackRows] = await Promise.all([
    computeAdherence(userId, null, from, to),
    computeWorkoutMetrics(userId, from, to, null),
    prisma.cycleSessionFeedback.findMany({
      where: { workoutSchedule: { userId, date: { gte: from, lte: to } } },
      select: {
        readinessScore: true,
        sessionRpe: true,
        painScore: true,
        workoutSchedule: { select: { date: true } },
      },
    }),
  ]);

  let hasActivityBeforeWindow = false;
  if (adherence.total === 0 && workout.sets.length === 0) {
    const prior = await prisma.workout.findFirst({
      where: { userId, date: { lt: from } },
      select: { id: true },
    });
    hasActivityBeforeWindow = prior != null;
  }

  return buildTrainingAnalyticsWindow({
    from,
    to,
    days,
    adherence,
    workout,
    sessionFeedback: feedbackRows.map((r) => ({
      readinessScore: r.readinessScore,
      sessionRpe: r.sessionRpe,
      painScore: r.painScore,
      date: r.workoutSchedule.date.toISOString(),
    })),
    hasActivityBeforeWindow,
  });
}
