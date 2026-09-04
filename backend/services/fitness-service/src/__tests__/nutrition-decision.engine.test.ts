/**
 * Pure unit tests for the Adaptive Nutrition Decision Engine (Phase 2) —
 * same fast, DB-free, pure-function convention as cycle-decision.engine.test.ts.
 *
 * Run with: npx tsx --test src/__tests__/nutrition-decision.engine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNutritionAdaptive,
  type NutritionDecisionInput,
  type ActiveNutritionPrescription,
} from "../services/nutrition-decision.engine";
import type { CycleMetricsResult } from "../services/cycle-metrics.engine";
import type { WeightTrendResult } from "../services/weight-trend.util";

function baseMetrics(overrides: Partial<CycleMetricsResult> = {}): CycleMetricsResult {
  return {
    adherenceRate: 0.85,
    completionRate: 0.85,
    hasScheduledSessions: true,
    workoutsPerWeek: 4,
    weeklyVolumeByMuscleGroup: [],
    volumeTrendPercent: 5,
    volumeProgressionSlope: 2,
    exerciseProgression: [],
    estimated1RmTrend: [],
    strengthProgressScore: 0.6,
    performanceConsistencyScore: 0.7,
    averageSessionRpe: 7,
    rpeTrend: "stable",
    averageRir: 2,
    rirTrend: "stable",
    painTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 },
    averagePainScore: 1,
    fatigueScore: 0.3,
    recoveryScore: 0.7,
    bodyWeightTrend: { direction: "down", changePerWeek: -0.4, dataPoints: 4 },
    skeletalMuscleTrend: null,
    bodyFatTrend: { direction: "down", changePerWeek: -0.2, dataPoints: 4 },
    goalProgressScore: 0.6,
    dataCompletenessScore: 0.8,
    dataQualityScore: 0.8,
    newPRs: [],
    inBodyQuality: {
      hasSufficientData: true,
      comparableRecordCount: 4,
      outlierFlags: [],
      intervalWarnings: [],
      deviceConsistencyWarning: null,
      weightWaterConflict: false,
    } as any,
    missedSessionCount: 1,
    nutritionConsistencyScore: 0.85,
    ...overrides,
  };
}

function goodTrend(overrides: Partial<WeightTrendResult> = {}): WeightTrendResult {
  return {
    trendWeight: 78.2,
    latestWeight: 78,
    sampleCount: 7,
    confidence: "HIGH",
    windowDays: 14,
    ...overrides,
  };
}

const activeGoal: ActiveNutritionPrescription = { calories: 2000, protein: 150, carbs: 200, fat: 60 };

function baseInput(overrides: Partial<NutritionDecisionInput> = {}): NutritionDecisionInput {
  return {
    goal: "WEIGHT_LOSS",
    targetWeightKg: 72,
    weightTrend: goodTrend(),
    metrics: baseMetrics(),
    activeNutritionGoal: activeGoal,
    cycleDurationDaysSoFar: 28,
    ...overrides,
  };
}

// ── Scenario A (spec §56) — steady progress, good adherence, no safety flag ──
test("Scenario A: on-target weight-loss trend + good adherence -> KEEP_PLAN, no calorie change", () => {
  const result = evaluateNutritionAdaptive(baseInput());
  assert.equal(result.decision, "KEEP_PLAN");
  assert.equal(result.proposedChanges, null);
  assert.ok(result.reasonCodes.includes("TREND_ON_TARGET_FOR_GOAL"));
  assert.equal(result.requiresConfirmation, false);
});

// ── Scenario B — plateau + good adherence + no safety concern -> PROPOSE_ADJUSTMENT ──
test("Scenario B: weight-loss plateaued despite good adherence -> PROPOSE_ADJUSTMENT with bounded calorie decrease", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  assert.equal(result.requiresConfirmation, true);
  assert.ok(result.proposedChanges);
  assert.ok(result.proposedChanges!.calories! < activeGoal.calories, "a plateau on a weight-loss goal must propose a decrease, not an increase");
  assert.ok(
    Math.abs(result.proposedChanges!.calories! - activeGoal.calories) <= 300,
    "calorie delta must stay within the configured max adjustment step",
  );
  assert.ok(result.evidenceIds.length > 0);
});

// ── Scenario C — insufficient data -> REQUEST_MORE_DATA ──
test("Scenario C: only 1-2 weight samples -> REQUEST_MORE_DATA, no proposed change", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({ weightTrend: goodTrend({ confidence: "LOW", sampleCount: 1, trendWeight: 78, latestWeight: 78 }) }),
  );
  assert.equal(result.decision, "REQUEST_MORE_DATA");
  assert.equal(result.proposedChanges, null);
  assert.equal(result.requiresConfirmation, false);
});

test("no nutrition logging at all in the window -> REQUEST_MORE_DATA (never fabricates an adherence score)", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({ metrics: baseMetrics({ nutritionConsistencyScore: null }) }),
  );
  assert.equal(result.decision, "REQUEST_MORE_DATA");
  assert.ok(result.reasonCodes.includes("NO_NUTRITION_LOGGING_IN_WINDOW"));
});

// ── Scenario D — safety flag -> EARLY_REVIEW / ESCALATE, never a diet change ──
test("Scenario D: severe pain score -> ESCALATE, never proposes a more aggressive calorie cut", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({ metrics: baseMetrics({ averagePainScore: 9 }) }),
  );
  assert.equal(result.decision, "ESCALATE");
  assert.equal(result.proposedChanges, null);
  assert.equal(result.requiresConfirmation, true);
});

test("elevated (but not severe) pain -> EARLY_REVIEW, not a silent KEEP_PLAN", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({ metrics: baseMetrics({ averagePainScore: 7 }) }),
  );
  assert.equal(result.decision, "EARLY_REVIEW");
});

test("rising pain trend alone (even with a low average score) -> EARLY_REVIEW", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      metrics: baseMetrics({ averagePainScore: 2, painTrend: { direction: "up", changePerWeek: 1, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "EARLY_REVIEW");
});

test("safety gate fires BEFORE the data-quality gate — a severe-pain user with also-thin data still gets ESCALATE, not REQUEST_MORE_DATA", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      weightTrend: goodTrend({ confidence: "LOW", sampleCount: 1 }),
      metrics: baseMetrics({ averagePainScore: 9 }),
    }),
  );
  assert.equal(result.decision, "ESCALATE");
});

// ── Adherence gate — plateau + LOW adherence must not touch the target ──
test("plateau with low nutrition adherence -> KEEP_PLAN (behavior issue, not a target-calorie issue)", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      metrics: baseMetrics({
        bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 },
        nutritionConsistencyScore: 0.3,
      }),
    }),
  );
  assert.equal(result.decision, "KEEP_PLAN");
  assert.equal(result.proposedChanges, null);
  assert.ok(result.reasonCodes.includes("LOW_NUTRITION_ADHERENCE_ADDRESS_BEHAVIOR_NOT_TARGET"));
});

// ── Evaluation window too short — even a real plateau isn't acted on yet ──
test("cycle only a few days old — even an apparent plateau does not yet trigger PROPOSE_ADJUSTMENT", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      cycleDurationDaysSoFar: 5,
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "KEEP_PLAN");
  assert.ok(result.reasonCodes.includes("EVALUATION_WINDOW_TOO_SHORT_FOR_A_CONFIDENT_CALL"));
});

// ── Weight loss too fast -> propose an INCREASE (protect lean mass) ──
test("weight-loss goal losing much faster than the reference pace -> PROPOSE_ADJUSTMENT with a calorie INCREASE, citing Garthe 2011", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      weightTrend: goodTrend({ trendWeight: 70 }),
      metrics: baseMetrics({ bodyWeightTrend: { direction: "down", changePerWeek: -1.5, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  assert.ok(result.proposedChanges!.calories! > activeGoal.calories, "losing too fast must propose more calories, not fewer");
  assert.ok(result.evidenceIds.includes("garthe-2011-weight-loss-rate-athletes"));
});

// ── Muscle gain plateau -> propose an increase ──
test("muscle-gain goal with flat/declining weight -> PROPOSE_ADJUSTMENT with a calorie increase", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      goal: "MUSCLE_GAIN",
      targetWeightKg: 85,
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  assert.ok(result.proposedChanges!.calories! > activeGoal.calories);
});

// ── Maintenance drifting outside tolerance -> propose a correction ──
test("maintenance goal drifting down beyond the tolerance band -> PROPOSE_ADJUSTMENT with a calorie increase", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      goal: "MAINTENANCE",
      targetWeightKg: 78,
      metrics: baseMetrics({ bodyWeightTrend: { direction: "down", changePerWeek: -0.5, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  assert.ok(result.proposedChanges!.calories! > activeGoal.calories);
});

test("maintenance goal within tolerance -> KEEP_PLAN", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      goal: "MAINTENANCE",
      targetWeightKg: 78,
      metrics: baseMetrics({ bodyWeightTrend: { direction: "down", changePerWeek: -0.1, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "KEEP_PLAN");
});

// ── Macro redistribution invariants (spec §13) ──
test("proposed protein is never reduced below the current prescription when calories are cut", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  assert.ok(result.proposedChanges!.protein! >= activeGoal.protein, "protein must never be scaled down proportionally with calories");
});

test("proposed protein stays within the 1.4-2.0 g/kg evidence-supported range", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      weightTrend: goodTrend({ trendWeight: 70, latestWeight: 70 }),
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
      activeNutritionGoal: { calories: 2000, protein: 50, carbs: 250, fat: 60 }, // deliberately below the floor
    }),
  );
  assert.equal(result.decision, "PROPOSE_ADJUSTMENT");
  const proteinPerKg = result.proposedChanges!.protein! / 70;
  assert.ok(proteinPerKg >= 1.4 - 0.01 && proteinPerKg <= 2.0 + 0.01, `expected protein/kg in [1.4, 2.0], got ${proteinPerKg}`);
});

test("proposed calories, protein, and fat/carb split are internally consistent (macros sum to ~the proposed calorie total)", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  const p = result.proposedChanges!;
  const total = p.protein! * 4 + p.carbs! * 4 + p.fat! * 9;
  assert.ok(Math.abs(total - p.calories!) <= 8, `macro kcal (${total}) should reconcile with proposed calories (${p.calories})`);
});

// ── No active prescription / unresolved weight -> REQUEST_MORE_DATA, never guesses ──
test("no active nutrition prescription exists -> REQUEST_MORE_DATA rather than fabricating one", () => {
  const result = evaluateNutritionAdaptive(
    baseInput({
      activeNutritionGoal: null,
      metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }),
    }),
  );
  assert.equal(result.decision, "REQUEST_MORE_DATA");
});

// ── evidenceIds must only ever be real registry ids (spec §17, §40) ──
test("every evidenceId returned is one of the real ids registered in data/processed/evidence/_index.json", () => {
  const REAL_IDS = new Set([
    "hall-2011-dynamic-energy-balance",
    "brewer-2021-inbody-validation",
    "tinsley-2022-bodycomp-standardization",
    "shcherbina-2017-wearable-accuracy",
    "garthe-2011-weight-loss-rate-athletes",
    "nunes-adaptive-thermogenesis",
    "issn-protein-2017",
  ]);
  const scenarios: NutritionDecisionInput[] = [
    baseInput(),
    baseInput({ metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }) }),
    baseInput({ weightTrend: goodTrend({ confidence: "LOW", sampleCount: 1 }) }),
    baseInput({
      weightTrend: goodTrend({ trendWeight: 70 }),
      metrics: baseMetrics({ bodyWeightTrend: { direction: "down", changePerWeek: -1.5, dataPoints: 4 } }),
    }),
  ];
  for (const s of scenarios) {
    const result = evaluateNutritionAdaptive(s);
    for (const id of result.evidenceIds) {
      assert.ok(REAL_IDS.has(id), `evidenceId "${id}" is not a real registered id — must never invent one`);
    }
  }
});

// ── requiresConfirmation must be true for every decision that touches numbers ──
test("requiresConfirmation is true for PROPOSE_ADJUSTMENT/ESCALATE/EARLY_REVIEW, false for KEEP_PLAN/REQUEST_MORE_DATA", () => {
  const propose = evaluateNutritionAdaptive(
    baseInput({ metrics: baseMetrics({ bodyWeightTrend: { direction: "flat", changePerWeek: 0, dataPoints: 4 } }) }),
  );
  assert.equal(propose.requiresConfirmation, true);

  const keep = evaluateNutritionAdaptive(baseInput());
  assert.equal(keep.requiresConfirmation, false);

  const moreData = evaluateNutritionAdaptive(baseInput({ weightTrend: goodTrend({ confidence: "LOW", sampleCount: 1 }) }));
  assert.equal(moreData.requiresConfirmation, false);
});

test("purity: identical input always produces identical output (no hidden randomness/state)", () => {
  const input = baseInput();
  const r1 = evaluateNutritionAdaptive(input);
  const r2 = evaluateNutritionAdaptive(input);
  assert.deepEqual(r1, r2);
});
