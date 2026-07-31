import test from "node:test";
import assert from "node:assert/strict";
import {
  computeExerciseProgression,
  computeStrengthProgressScore,
  computePerformanceConsistencyScore,
  computeGoalProgressScore,
  computeBodyCompositionTrends,
  computeDataCompletenessScore,
  computeFatigueRecoveryMetrics,
} from "../services/cycle-metrics.engine";
import type { E1rmTrendPoint, VolumeWeek, AdherenceMetric, RpeTrend } from "../services/training-cycle-metrics.service";
import type { InBodyTrendPoint } from "../services/inbody-quality.evaluator";

// ── computeExerciseProgression ──────────────────────────────────────────────

test("computeExerciseProgression: computes % change from first to last week, flags priority exercises", () => {
  const e1rmTrend: E1rmTrendPoint[] = [
    { exerciseName: "Squat", weeklyTop: [{ week: 0, e1rm: 100 }, { week: 3, e1rm: 110 }] },
    { exerciseName: "Curl", weeklyTop: [{ week: 0, e1rm: 20 }] }, // single data point -> changePct null
  ];
  const result = computeExerciseProgression(e1rmTrend, ["Squat"]);
  const squat = result.find((r) => r.exerciseName === "Squat")!;
  const curl = result.find((r) => r.exerciseName === "Curl")!;
  assert.equal(squat.changePct, 10);
  assert.equal(squat.isPriority, true);
  assert.equal(curl.changePct, null);
  assert.equal(curl.isPriority, false);
});

// ── computeStrengthProgressScore ────────────────────────────────────────────

test("computeStrengthProgressScore: no data returns null", () => {
  assert.equal(computeStrengthProgressScore([]), null);
});

test("computeStrengthProgressScore: +20% progression scores 1 (clamped ceiling)", () => {
  const score = computeStrengthProgressScore([
    { exerciseName: "Bench", firstWeekE1rm: 100, lastWeekE1rm: 120, changePct: 20, isPriority: false },
  ]);
  assert.equal(score, 1);
});

test("computeStrengthProgressScore: 0% change scores 0.5 (neutral midpoint)", () => {
  const score = computeStrengthProgressScore([
    { exerciseName: "Bench", firstWeekE1rm: 100, lastWeekE1rm: 100, changePct: 0, isPriority: false },
  ]);
  assert.equal(score, 0.5);
});

test("computeStrengthProgressScore: priority exercises count double weight", () => {
  const withPriorityRegression = computeStrengthProgressScore([
    { exerciseName: "Squat", firstWeekE1rm: 100, lastWeekE1rm: 80, changePct: -20, isPriority: true }, // scores 0, weight 2
    { exerciseName: "Curl", firstWeekE1rm: 20, lastWeekE1rm: 24, changePct: 20, isPriority: false }, // scores 1, weight 1
  ]);
  // weighted avg = (0*2 + 1*1) / 3 = 0.333
  assert.equal(withPriorityRegression, 0.33);
});

// ── computePerformanceConsistencyScore ──────────────────────────────────────

test("computePerformanceConsistencyScore: identical weekly volume scores near 1 (perfectly consistent)", () => {
  const weeks: VolumeWeek[] = [
    { week: 0, totalVolumeKg: 1000, byMuscleGroup: {} },
    { week: 1, totalVolumeKg: 1000, byMuscleGroup: {} },
    { week: 2, totalVolumeKg: 1000, byMuscleGroup: {} },
  ];
  assert.equal(computePerformanceConsistencyScore(weeks), 1);
});

test("computePerformanceConsistencyScore: wildly varying weekly volume scores low", () => {
  const weeks: VolumeWeek[] = [
    { week: 0, totalVolumeKg: 2000, byMuscleGroup: {} },
    { week: 1, totalVolumeKg: 200, byMuscleGroup: {} },
    { week: 2, totalVolumeKg: 1800, byMuscleGroup: {} },
  ];
  const score = computePerformanceConsistencyScore(weeks)!;
  assert.ok(score < 0.5, `expected low consistency score, got ${score}`);
});

test("computePerformanceConsistencyScore: fewer than 2 weeks of data returns null", () => {
  assert.equal(computePerformanceConsistencyScore([{ week: 0, totalVolumeKg: 500, byMuscleGroup: {} }]), null);
});

// ── computeGoalProgressScore ─────────────────────────────────────────────────

test("computeGoalProgressScore: MUSCLE_GAIN goal with positive SMM delta scores above 0.5", () => {
  const score = computeGoalProgressScore("MUSCLE_GAIN", 0.6, null)!;
  assert.ok(score > 0.5);
});

test("computeGoalProgressScore: WEIGHT_LOSS goal with negative PBF delta (fat loss) scores above 0.5", () => {
  const score = computeGoalProgressScore("WEIGHT_LOSS", null, -1.6)!;
  assert.ok(score > 0.5);
});

test("computeGoalProgressScore: WEIGHT_LOSS goal with fat gain (positive PBF delta) scores below 0.5", () => {
  const score = computeGoalProgressScore("WEIGHT_LOSS", null, 1.5)!;
  assert.ok(score < 0.5);
});

test("computeGoalProgressScore: MAINTENANCE goal has no single composition signal, returns null", () => {
  assert.equal(computeGoalProgressScore("MAINTENANCE", 0.5, -0.5), null);
});

// ── computeBodyCompositionTrends ────────────────────────────────────────────

test("computeBodyCompositionTrends: empty input returns all-null trends", () => {
  const result = computeBodyCompositionTrends([]);
  assert.equal(result.bodyWeightTrend, null);
  assert.equal(result.skeletalMuscleTrend, null);
  assert.equal(result.bodyFatTrend, null);
});

test("computeBodyCompositionTrends: 2-point delta is used when only 2 comparable points exist", () => {
  const points: InBodyTrendPoint[] = [
    { entryId: "a", date: "2026-06-01", weight: 80, bodyFatPct: 20, muscleMass: 30 },
    { entryId: "b", date: "2026-06-15", weight: 78, bodyFatPct: 18, muscleMass: 31 },
  ];
  const result = computeBodyCompositionTrends(points);
  assert.equal(result.bodyWeightTrend?.direction, "down");
  assert.equal(result.bodyWeightTrend?.dataPoints, 2);
  assert.equal(result.skeletalMuscleTrend?.direction, "up");
  assert.equal(result.bodyFatTrend?.direction, "down");
});

test("computeBodyCompositionTrends: uses a real trend line across 3+ points, not just endpoints", () => {
  const points: InBodyTrendPoint[] = [
    { entryId: "a", date: "2026-06-01", weight: 80, bodyFatPct: 20, muscleMass: 30 },
    { entryId: "b", date: "2026-06-08", weight: 79, bodyFatPct: 19.3, muscleMass: 30.3 },
    { entryId: "c", date: "2026-06-15", weight: 78, bodyFatPct: 18.6, muscleMass: 30.6 },
  ];
  const result = computeBodyCompositionTrends(points);
  assert.equal(result.bodyWeightTrend?.dataPoints, 3);
  assert.equal(result.bodyWeightTrend?.direction, "down");
  // ~1kg/week loss expected from the linear points above
  assert.ok(Math.abs((result.bodyWeightTrend?.changePerWeek ?? 0) - -1) < 0.2);
});

// ── computeDataCompletenessScore ────────────────────────────────────────────

test("computeDataCompletenessScore: full data on every axis scores near 1", () => {
  const adherence: AdherenceMetric = { completed: 10, total: 10, percent: 100 };
  const score = computeDataCompletenessScore({
    adherence,
    inBodyRecordCount: 2,
    minimumComparableInBodyRecords: 2,
    sessionFeedbackCount: 10,
    completedSessionCount: 10,
  });
  assert.equal(score, 1);
});

test("computeDataCompletenessScore: no data logged at all scores 0", () => {
  const adherence: AdherenceMetric = { completed: 0, total: 0, percent: 0 };
  const score = computeDataCompletenessScore({
    adherence,
    inBodyRecordCount: 0,
    minimumComparableInBodyRecords: 2,
    sessionFeedbackCount: 0,
    completedSessionCount: 0,
  });
  assert.equal(score, 0);
});

test("computeDataCompletenessScore: workout logging weighs more than optional session feedback", () => {
  const adherence: AdherenceMetric = { completed: 10, total: 10, percent: 100 };
  const goodWorkoutNoFeedback = computeDataCompletenessScore({
    adherence,
    inBodyRecordCount: 2,
    minimumComparableInBodyRecords: 2,
    sessionFeedbackCount: 0,
    completedSessionCount: 10,
  });
  const badWorkoutFullFeedback = computeDataCompletenessScore({
    adherence: { completed: 0, total: 10, percent: 0 },
    inBodyRecordCount: 2,
    minimumComparableInBodyRecords: 2,
    sessionFeedbackCount: 10,
    completedSessionCount: 10,
  });
  assert.ok(goodWorkoutNoFeedback > badWorkoutFullFeedback);
});

// ── computeFatigueRecoveryMetrics ───────────────────────────────────────────

test("computeFatigueRecoveryMetrics: no session feedback falls back to set-level RPE trend", () => {
  const fallback: RpeTrend = { weeklyAvg: [6, 7, 8], trend: "increasing" };
  const result = computeFatigueRecoveryMetrics([], fallback);
  assert.equal(result.sessionRpeSource, "set_rpe_fallback");
  assert.equal(result.averageSessionRpe, 7);
  assert.equal(result.rpeTrend, "increasing");
  assert.equal(result.painTrend, null); // no pain data at all -> null, not fabricated
});

test("computeFatigueRecoveryMetrics: real session feedback is preferred over the set-level fallback", () => {
  const fallback: RpeTrend = { weeklyAvg: [6], trend: "stable" };
  const result = computeFatigueRecoveryMetrics(
    [
      { readinessScore: 8, sessionRpe: 9, painScore: 1, date: "2026-06-01" },
      { readinessScore: 7, sessionRpe: 9, painScore: 1, date: "2026-06-08" },
    ],
    fallback,
  );
  assert.equal(result.sessionRpeSource, "session_feedback");
  assert.equal(result.averageSessionRpe, 9);
  assert.equal(result.recoveryScore, 0.75); // avg readiness 7.5 / 10
});

test("computeFatigueRecoveryMetrics: rising pain score trend increases fatigueScore", () => {
  const fallback: RpeTrend = { weeklyAvg: [7], trend: "stable" };
  const result = computeFatigueRecoveryMetrics(
    [
      { readinessScore: null, sessionRpe: null, painScore: 1, date: "2026-06-01" },
      { readinessScore: null, sessionRpe: null, painScore: 3, date: "2026-06-08" },
      { readinessScore: null, sessionRpe: null, painScore: 6, date: "2026-06-15" },
    ],
    fallback,
  );
  assert.equal(result.painTrend?.direction, "up");
  assert.ok(result.fatigueScore! > 0.5);
});
