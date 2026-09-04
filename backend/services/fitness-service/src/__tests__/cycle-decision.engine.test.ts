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
    volumeProgressionSlope: 2.5,
    missedSessionCount: 2,
    nutritionConsistencyScore: 0.8,
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
        volumeProgressionSlope: 0, // neutral — this fixture is specifically about a plateau, not nutrition/volume-slope pulling the score elsewhere
        newPRs: [],
        fatigueScore: 0.4,
        recoveryScore: 0.6,
        nutritionConsistencyScore: 0.5, // neutral, same reason
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

// Both REBUILD fixtures below explicitly set experienceLevel: "ADVANCED" —
// since Phase 8, REBUILD never fires for BEGINNER/UNKNOWN (see the
// level-aware tests further down), so these level-agnostic-looking fixtures
// need a non-beginner level to actually exercise the REBUILD branch.

test("fixture: two consecutive missed cycles despite otherwise-plateau data -> REBUILD", () => {
  const priorCycleDecisions: CycleDecision[] = ["ADJUST", "DELOAD"];
  const result = evaluateCycle(
    baseInput({
      priorCycleDecisions,
      experienceLevel: "ADVANCED",
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
      experienceLevel: "ADVANCED",
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

// ── Phase 8: level-aware behavior (docs/USER_LEVEL_PERSONALIZATION_PLAN.md) ──

test("BEGINNER/UNKNOWN never triggers REBUILD even with two consecutive missed cycles — not enough cycle history to compare (plan doc §A)", () => {
  const priorCycleDecisions: CycleDecision[] = ["ADJUST", "DELOAD"];
  const metrics = baseMetrics({ goalProgressScore: 0.45, strengthProgressScore: 0.4, volumeTrendPercent: -2, newPRs: [] });
  const advancedResult = evaluateCycle(baseInput({ priorCycleDecisions, metrics, experienceLevel: "ADVANCED" }));
  const beginnerResult = evaluateCycle(baseInput({ priorCycleDecisions, metrics, experienceLevel: "BEGINNER" }));
  const unknownResult = evaluateCycle(baseInput({ priorCycleDecisions, metrics, experienceLevel: "UNKNOWN" }));
  assert.equal(advancedResult.decision, "REBUILD");
  assert.notEqual(beginnerResult.decision, "REBUILD");
  assert.notEqual(unknownResult.decision, "REBUILD");
});

test("BEGINNER: an explicit goal/context change does not force REBUILD either", () => {
  const result = evaluateCycle(
    baseInput({
      goalOrContextChangedSincePriorCycle: true,
      experienceLevel: "BEGINNER",
      metrics: baseMetrics({ goalProgressScore: 0.8, strengthProgressScore: 0.8 }),
    }),
  );
  assert.notEqual(result.decision, "REBUILD");
});

test("BEGINNER needs a much stronger fatigue/recovery signal than ADVANCED before DELOAD fires, for identical underlying data (plan doc §C)", () => {
  const metrics = baseMetrics({
    goalProgressScore: 0.2,
    strengthProgressScore: 0.15,
    performanceConsistencyScore: 0.3,
    volumeTrendPercent: -10,
    fatigueScore: 0.65,
    recoveryScore: 0.4,
    rpeTrend: "increasing",
    adherenceRate: 0.9,
  });
  const beginnerResult = evaluateCycle(baseInput({ metrics, experienceLevel: "BEGINNER" }));
  const advancedResult = evaluateCycle(baseInput({ metrics, experienceLevel: "ADVANCED" }));
  assert.notEqual(beginnerResult.decision, "DELOAD", "0.65 fatigue / 0.4 recovery should not be enough to alarm a BEGINNER's more conservative thresholds");
  assert.equal(advancedResult.decision, "DELOAD", "the same data should read as fatigued/under-recovered for an ADVANCED lifter's tighter thresholds");
});

test("PROFESSIONAL (ADVANCED + competesInSport) requires a stronger composite score than a recreational ADVANCED lifter before PROGRESS (plan doc §D)", () => {
  const metrics = baseMetrics({
    goalProgressScore: 0.65,
    strengthProgressScore: 0.65,
    performanceConsistencyScore: 0.65,
    volumeTrendPercent: 5,
  });
  const recreational = evaluateCycle(baseInput({ metrics, experienceLevel: "ADVANCED", competesInSport: false }));
  const professional = evaluateCycle(baseInput({ metrics, experienceLevel: "ADVANCED", competesInSport: true }));
  assert.equal(recreational.decision, "PROGRESS");
  assert.notEqual(professional.decision, "PROGRESS", "same score should not clear the stricter professional progress bar");
});

test("PROFESSIONAL athletes hit INSUFFICIENT_DATA at a data-quality bar a recreational ADVANCED lifter still clears (plan doc §D)", () => {
  const metrics = baseMetrics({ dataQualityScore: 0.6 });
  const recreational = evaluateCycle(baseInput({ metrics, experienceLevel: "ADVANCED", competesInSport: false }));
  const professional = evaluateCycle(baseInput({ metrics, experienceLevel: "ADVANCED", competesInSport: true }));
  assert.notEqual(recreational.decision, "INSUFFICIENT_DATA");
  assert.equal(professional.decision, "INSUFFICIENT_DATA");
  assert.ok(professional.reasonCodes.includes("PROFESSIONAL_REQUIRES_HIGHER_DATA_QUALITY"));
});

test("competesInSport has no effect unless experienceLevel is ADVANCED", () => {
  const metrics = baseMetrics({ dataQualityScore: 0.6 });
  const beginnerCompeting = evaluateCycle(baseInput({ metrics, experienceLevel: "BEGINNER", competesInSport: true }));
  const intermediateCompeting = evaluateCycle(baseInput({ metrics, experienceLevel: "INTERMEDIATE", competesInSport: true }));
  assert.notEqual(beginnerCompeting.decision, "INSUFFICIENT_DATA");
  assert.notEqual(intermediateCompeting.decision, "INSUFFICIENT_DATA");
});

test("supportingMetrics records experienceLevel and competesInSport for audit", () => {
  const result = evaluateCycle(baseInput({ experienceLevel: "ADVANCED", competesInSport: true }));
  assert.equal(result.supportingMetrics.experienceLevel, "ADVANCED");
  assert.equal(result.supportingMetrics.competesInSport, true);
});

// ── nutritionConsistencyScore / volumeProgressionSlope are genuinely read ──
// (docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md gap: these were computed by
// cycle-metrics.engine.ts but never consumed by the Decision Engine)

test("nutritionConsistencyScore measurably shifts the outcome for otherwise-identical training data", () => {
  const goodNutrition = evaluateCycle(
    baseInput({ metrics: baseMetrics({ goalProgressScore: 0.5, strengthProgressScore: 0.5, performanceConsistencyScore: 0.5, volumeTrendPercent: 0, volumeProgressionSlope: 0, newPRs: [], nutritionConsistencyScore: 0.95 }) }),
  );
  const poorNutrition = evaluateCycle(
    baseInput({ metrics: baseMetrics({ goalProgressScore: 0.5, strengthProgressScore: 0.5, performanceConsistencyScore: 0.5, volumeTrendPercent: 0, volumeProgressionSlope: 0, newPRs: [], nutritionConsistencyScore: 0.05 }) }),
  );
  assert.notDeepEqual(goodNutrition, poorNutrition, "changing only nutritionConsistencyScore must change the engine's output");
  assert.equal(poorNutrition.decision, "ADJUST", "poor nutrition consistency should be enough to pull an otherwise-plateau cycle to ADJUST rather than KEEP");
  assert.equal(goodNutrition.decision, "KEEP", "strong nutrition consistency should be enough to lift an otherwise-plateau cycle to KEEP");
});

test("volumeProgressionSlope (regression-based) is read independently of volumeTrendPercent (naive first-vs-last)", () => {
  const bothPositive = evaluateCycle(
    baseInput({ metrics: baseMetrics({ goalProgressScore: 0.55, strengthProgressScore: 0.5, volumeTrendPercent: 10, volumeProgressionSlope: 10 }) }),
  );
  const slopeNegative = evaluateCycle(
    baseInput({ metrics: baseMetrics({ goalProgressScore: 0.55, strengthProgressScore: 0.5, volumeTrendPercent: 10, volumeProgressionSlope: -20 }) }),
  );
  assert.ok(
    slopeNegative.confidenceScore < bothPositive.confidenceScore || slopeNegative.decision !== bothPositive.decision,
    "a negative volumeProgressionSlope should change the outcome even when volumeTrendPercent alone looks positive",
  );
});

test("experienceLevel defaults to UNKNOWN (treated as BEGINNER) when the caller omits it entirely", () => {
  const priorCycleDecisions: CycleDecision[] = ["ADJUST", "DELOAD"];
  const result = evaluateCycle(
    baseInput({ priorCycleDecisions, metrics: baseMetrics({ goalProgressScore: 0.45, strengthProgressScore: 0.4, volumeTrendPercent: -2, newPRs: [] }) }),
  );
  assert.equal(result.supportingMetrics.experienceLevel, "UNKNOWN");
  assert.notEqual(result.decision, "REBUILD");
});
