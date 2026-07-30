import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCycle, type DecisionEngineInput, type CycleDecision } from "../services/cycle-decision.engine";
import type { CycleMetricsResult } from "../services/cycle-metrics.engine";
import type { InBodyQualityResult } from "../services/inbody-quality.evaluator";

function baseInBodyQuality(overrides: Partial<InBodyQualityResult> = {}): InBodyQualityResult {
  return {
    recordCount: 3,
    comparableRecordCount: 3,
    hasSufficientData: true,
    outlierFlags: [],
    intervalWarnings: [],
    deviceConsistencyWarning: null,
    weightWaterConflict: false,
    confidenceMultiplier: 1,
    qualityFlags: [],
    comparablePoints: [],
    ...overrides,
  };
}

function baseMetrics(overrides: Partial<CycleMetricsResult> = {}): CycleMetricsResult {
  return {
    adherenceRate: 0.85,
    completionRate: 0.85,
    hasScheduledSessions: true,
    workoutsPerWeek: 4,
    weeklyVolumeByMuscleGroup: [],
    volumeTrendPercent: 10,
    exerciseProgression: [],
    estimated1RmTrend: [],
    strengthProgressScore: 0.75,
    performanceConsistencyScore: 0.8,
    averageSessionRpe: 7,
    rpeTrend: "stable",
    averageRir: null,
    rirTrend: "stable",
    painTrend: null,
    averagePainScore: null,
    fatigueScore: 0.4,
    recoveryScore: 0.7,
    bodyWeightTrend: null,
    skeletalMuscleTrend: null,
    bodyFatTrend: null,
    goalProgressScore: 0.75,
    dataCompletenessScore: 0.9,
    dataQualityScore: 0.9,
    newPRs: ["Squat"],
    inBodyQuality: baseInBodyQuality(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<DecisionEngineInput> = {}): DecisionEngineInput {
  return {
    cycleDurationDays: 30,
    completedSessions: 12,
    metrics: baseMetrics(),
    ...overrides,
  };
}

// ── Fixture: tiến bộ tốt → KEEP ─────────────────────────────────────────────

test("fixture: steady, modest progress with good adherence -> KEEP", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.6,
        strengthProgressScore: 0.55,
        volumeTrendPercent: 3,
        rpeTrend: "increasing", // no headroom -> should not qualify for PROGRESS
      }),
    }),
  );
  assert.equal(result.decision, "KEEP");
  assert.equal(result.recommendedActionScope, "none");
  assert.equal(result.safetyFlags.length, 0);
});

// ── Fixture: đủ khả năng tăng tải → PROGRESS ────────────────────────────────

test("fixture: strong progress across the board with RPE headroom -> PROGRESS", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.85,
        strengthProgressScore: 0.9,
        performanceConsistencyScore: 0.85,
        volumeTrendPercent: 15,
        rpeTrend: "stable",
        newPRs: ["Squat", "Bench Press"],
      }),
    }),
  );
  assert.equal(result.decision, "PROGRESS");
  assert.equal(result.recommendedActionScope, "minor_adjustment");
  assert.ok(result.confidenceScore > 0.5);
});

test("PROGRESS is denied when RPE is already trending up (no headroom) even with a strong score", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.9,
        strengthProgressScore: 0.9,
        rpeTrend: "increasing",
      }),
    }),
  );
  assert.notEqual(result.decision, "PROGRESS");
});

// ── Fixture: plateau → ADJUST ────────────────────────────────────────────────

test("fixture: plateau (near-neutral composite score) with good adherence -> ADJUST", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.5,
        strengthProgressScore: 0.48,
        performanceConsistencyScore: 0.5,
        volumeTrendPercent: 0,
        newPRs: [],
        fatigueScore: 0.4,
        recoveryScore: 0.6,
      }),
    }),
  );
  assert.equal(result.decision, "ADJUST");
  assert.equal(result.recommendedActionScope, "minor_adjustment");
});

// ── Fixture: fatigue tăng, performance giảm → DELOAD ────────────────────────

test("fixture: rising fatigue + declining performance with good adherence -> DELOAD", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.2,
        strengthProgressScore: 0.15,
        performanceConsistencyScore: 0.3,
        volumeTrendPercent: -10,
        fatigueScore: 0.85,
        recoveryScore: 0.25,
        rpeTrend: "increasing",
        adherenceRate: 0.9, // good adherence -> decline isn't just missed sessions
      }),
    }),
  );
  assert.equal(result.decision, "DELOAD");
  assert.equal(result.recommendedActionScope, "deload");
  assert.ok(result.reasonCodes.includes("ADHERENCE_GOOD_SO_DECLINE_NOT_JUST_MISSED_SESSIONS"));
});

test("high pain score alone (critical safety flag) combined with declining performance triggers DELOAD", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.2,
        strengthProgressScore: 0.2,
        performanceConsistencyScore: 0.2,
        volumeTrendPercent: -15,
        newPRs: [],
        averagePainScore: 8,
        fatigueScore: 0.5, // not fatigued by the fatigue check alone
        recoveryScore: 0.7, // recovery looks fine
        adherenceRate: 0.9,
      }),
    }),
  );
  assert.equal(result.decision, "DELOAD");
  assert.ok(result.safetyFlags.some((f) => f.code === "HIGH_PAIN_SCORE" && f.severity === "critical"));
});

// ── Fixture: hai chu kỳ liên tiếp không đạt mục tiêu → REBUILD ──────────────

test("fixture: two consecutive missed cycles despite otherwise-plateau data -> REBUILD", () => {
  const priorCycleDecisions: CycleDecision[] = ["ADJUST", "DELOAD"];
  const result = evaluateCycle(
    baseInput({
      priorCycleDecisions,
      metrics: baseMetrics({
        goalProgressScore: 0.45,
        strengthProgressScore: 0.4,
        volumeTrendPercent: -2,
        newPRs: [],
      }),
    }),
  );
  assert.equal(result.decision, "REBUILD");
  assert.equal(result.recommendedActionScope, "full_rebuild");
  assert.ok(result.reasonCodes.includes("TWO_CONSECUTIVE_CYCLES_BELOW_TARGET_DESPITE_GOOD_DATA"));
});

test("explicit goal/context change triggers REBUILD even with a fine score", () => {
  const result = evaluateCycle(
    baseInput({
      goalOrContextChangedSincePriorCycle: true,
      metrics: baseMetrics({ goalProgressScore: 0.8, strengthProgressScore: 0.8 }),
    }),
  );
  assert.equal(result.decision, "REBUILD");
  assert.ok(result.reasonCodes.includes("GOAL_OR_CONTEXT_CHANGED"));
});

test("one missed cycle (not two consecutive) does NOT trigger REBUILD on its own", () => {
  const result = evaluateCycle(
    baseInput({
      priorCycleDecisions: ["ADJUST", "PROGRESS"],
      metrics: baseMetrics({ goalProgressScore: 0.45, strengthProgressScore: 0.4, volumeTrendPercent: -2, newPRs: [] }),
    }),
  );
  assert.notEqual(result.decision, "REBUILD");
});

// ── Fixture: thiếu dữ liệu → INSUFFICIENT_DATA ──────────────────────────────

test("fixture: cycle too short -> INSUFFICIENT_DATA", () => {
  const result = evaluateCycle(baseInput({ cycleDurationDays: 10 }));
  assert.equal(result.decision, "INSUFFICIENT_DATA");
  assert.ok(result.reasonCodes.includes("CYCLE_TOO_SHORT"));
  assert.equal(result.recommendedActionScope, "none");
});

test("fixture: too few completed sessions -> INSUFFICIENT_DATA", () => {
  const result = evaluateCycle(baseInput({ completedSessions: 3 }));
  assert.equal(result.decision, "INSUFFICIENT_DATA");
  assert.ok(result.reasonCodes.includes("TOO_FEW_COMPLETED_SESSIONS"));
});

test("fixture: adherence too low to judge the program -> INSUFFICIENT_DATA", () => {
  const result = evaluateCycle(
    baseInput({ metrics: baseMetrics({ adherenceRate: 0.3 }) }),
  );
  assert.equal(result.decision, "INSUFFICIENT_DATA");
  assert.ok(result.reasonCodes.includes("ADHERENCE_TOO_LOW_TO_JUDGE_PROGRAM"));
});

test("fixture: too many InBody outliers with zero comparable records -> INSUFFICIENT_DATA", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: null,
        inBodyQuality: baseInBodyQuality({
          comparableRecordCount: 0,
          hasSufficientData: false,
          outlierFlags: [{ entryId: "x", reason: "implausible" }],
        }),
      }),
    }),
  );
  assert.equal(result.decision, "INSUFFICIENT_DATA");
  assert.ok(result.reasonCodes.includes("TOO_MANY_DATA_ERRORS_OR_OUTLIERS"));
});

test("safety flags are still evaluated and returned even when the decision is INSUFFICIENT_DATA", () => {
  const result = evaluateCycle(
    baseInput({
      cycleDurationDays: 10, // forces INSUFFICIENT_DATA
      metrics: baseMetrics({ averagePainScore: 9 }),
    }),
  );
  assert.equal(result.decision, "INSUFFICIENT_DATA");
  assert.ok(result.safetyFlags.some((f) => f.code === "HIGH_PAIN_SCORE"));
});

// ── Conflicting signals ──────────────────────────────────────────────────────

test("conflicting signals (strong strength gain, poor goal progress) are surfaced and default to ADJUST", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        goalProgressScore: 0.15, // strongly negative toward goal
        strengthProgressScore: 0.85, // strongly positive strength
        performanceConsistencyScore: 0.5,
        volumeTrendPercent: 0,
        newPRs: [],
        fatigueScore: 0.3,
        recoveryScore: 0.7,
      }),
    }),
  );
  assert.ok(result.conflictingSignals.length > 0);
  assert.equal(result.decision, "ADJUST");
  assert.ok(result.reasonCodes.includes("CONFLICTING_SIGNALS_DEFAULT_TO_ADJUST"));
});

// ── Confidence & determinism ────────────────────────────────────────────────

test("confidenceScore scales down when dataQualityScore is weaker, for the same decision", () => {
  const strong = evaluateCycle(baseInput({ metrics: baseMetrics({ dataQualityScore: 0.95 }) }));
  const weak = evaluateCycle(baseInput({ metrics: baseMetrics({ dataQualityScore: 0.4 }) }));
  assert.equal(strong.decision, weak.decision);
  assert.ok(strong.confidenceScore > weak.confidenceScore);
});

test("evaluateCycle is a pure function — identical input produces identical output", () => {
  const input = baseInput();
  const a = evaluateCycle(input);
  const b = evaluateCycle(input);
  assert.deepEqual(a, b);
});
