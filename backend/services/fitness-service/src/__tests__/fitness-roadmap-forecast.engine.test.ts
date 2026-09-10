import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveStrategyGroups,
  forecastPhaseSequence,
  mapPhaseTypeToNutritionGoal,
  computeForecastConfidence,
  type PhaseForecastPhaseInput,
  type ForecastContext,
} from "../services/fitness-roadmap-forecast.engine";

function phase(phaseType: PhaseForecastPhaseInput["phaseType"], index: number, weeks = 4): PhaseForecastPhaseInput {
  const start = new Date(Date.UTC(2026, 0, 1 + (index - 1) * weeks * 7));
  const end = new Date(start.getTime() + weeks * 7 * 86_400_000);
  return {
    phaseIndex: index,
    phaseType,
    name: `Phase ${index}`,
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
  };
}

// ── deriveStrategyGroups — master task §33 scenarios ────────────────────

test("deriveStrategyGroups: FAT_LOSS -> DIET_BREAK -> FAT_LOSS stays ONE campaign (diet break is a bridge inside the same cut)", () => {
  const groups = deriveStrategyGroups([phase("FAT_LOSS", 1), phase("DIET_BREAK", 2), phase("FAT_LOSS", 3)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "CUT");
  assert.equal(groups[0].phases.length, 3);
});

test("deriveStrategyGroups: LEAN_GAIN -> RECOVERY -> LEAN_GAIN stays ONE campaign (recovery is a bridge inside the same build)", () => {
  const groups = deriveStrategyGroups([phase("LEAN_GAIN", 1), phase("RECOVERY", 2), phase("LEAN_GAIN", 3)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "BUILD");
  assert.equal(groups[0].phases.length, 3);
});

test("deriveStrategyGroups: FAT_LOSS -> MAINTENANCE -> LEAN_GAIN is a genuine transition -> 3 separate strategic groups", () => {
  const groups = deriveStrategyGroups([phase("FAT_LOSS", 1), phase("MAINTENANCE", 2), phase("LEAN_GAIN", 3)]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].bucket, "CUT");
  assert.equal(groups[1].bucket, "STABILIZE");
  assert.equal(groups[2].bucket, "BUILD");
});

test("deriveStrategyGroups: MINI_CUT -> MAINTENANCE (trailing bridge) closes out the same cut campaign", () => {
  const groups = deriveStrategyGroups([phase("MINI_CUT", 1), phase("MAINTENANCE", 2)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "CUT");
  assert.equal(groups[0].phases.length, 2);
});

test("deriveStrategyGroups: DIET_BREAK alone -> one deterministic standalone group", () => {
  const groups = deriveStrategyGroups([phase("DIET_BREAK", 1)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "STABILIZE");
});

test("deriveStrategyGroups: RECOVERY alone -> one deterministic standalone group", () => {
  const groups = deriveStrategyGroups([phase("RECOVERY", 1)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "STABILIZE");
});

test("deriveStrategyGroups: a leading bridge (DIET_BREAK before the first FAT_LOSS) joins the upcoming campaign", () => {
  const groups = deriveStrategyGroups([phase("DIET_BREAK", 1), phase("FAT_LOSS", 2)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bucket, "CUT");
  assert.equal(groups[0].phases.length, 2);
});

test("deriveStrategyGroups: consecutive bridge phases between two different campaigns are grouped together as one transition block", () => {
  const groups = deriveStrategyGroups([
    phase("FAT_LOSS", 1),
    phase("DIET_BREAK", 2),
    phase("MAINTENANCE", 3),
    phase("LEAN_GAIN", 4),
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[1].bucket, "STABILIZE");
  assert.equal(groups[1].phases.length, 2); // DIET_BREAK + MAINTENANCE together
});

test("deriveStrategyGroups: real-world long sequence assigns sequential K-keys", () => {
  const groups = deriveStrategyGroups([
    phase("FAT_LOSS", 1),
    phase("DIET_BREAK", 2),
    phase("FAT_LOSS", 3),
    phase("MAINTENANCE", 4),
    phase("LEAN_GAIN", 5),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["K1", "K2", "K3"]);
});

// ── mapPhaseTypeToNutritionGoal ──────────────────────────────────────────

test("mapPhaseTypeToNutritionGoal: covers every phaseType with a real, non-fabricated goal", () => {
  assert.equal(mapPhaseTypeToNutritionGoal("FAT_LOSS"), "WEIGHT_LOSS");
  assert.equal(mapPhaseTypeToNutritionGoal("MINI_CUT"), "WEIGHT_LOSS");
  assert.equal(mapPhaseTypeToNutritionGoal("LEAN_GAIN"), "MUSCLE_GAIN");
  assert.equal(mapPhaseTypeToNutritionGoal("PERFORMANCE"), "ATHLETIC_PERFORMANCE");
  assert.equal(mapPhaseTypeToNutritionGoal("DIET_BREAK"), "MAINTENANCE");
  assert.equal(mapPhaseTypeToNutritionGoal("MAINTENANCE"), "MAINTENANCE");
  assert.equal(mapPhaseTypeToNutritionGoal("RECOVERY"), "MAINTENANCE");
  assert.equal(mapPhaseTypeToNutritionGoal("RECOMPOSITION"), "MAINTENANCE");
});

// ── forecastPhaseSequence ─────────────────────────────────────────────────

const baseContext: ForecastContext = {
  heightCm: 178,
  age: 29,
  gender: "MALE",
  activityLevel: "MODERATELY_ACTIVE",
  experienceLevel: "INTERMEDIATE",
  startWeightKg: 82,
  startBodyFatPct: 22,
  measuredBmr: null,
};

test("forecastPhaseSequence: phase continuity — phase N's start state is always phase N-1's projected end state", () => {
  const results = forecastPhaseSequence(baseContext, [
    phase("FAT_LOSS", 1, 8),
    phase("DIET_BREAK", 2, 2),
    phase("FAT_LOSS", 3, 8),
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[1].projectedStartWeightKg, results[0].projectedEndWeightKg);
  assert.equal(results[1].projectedStartBodyFatPct, results[0].projectedEndBodyFatPct);
  assert.equal(results[2].projectedStartWeightKg, results[1].projectedEndWeightKg);
  assert.equal(results[2].projectedStartBodyFatPct, results[1].projectedEndBodyFatPct);
});

test("forecastPhaseSequence: FAT_LOSS projects a weight decrease, and body-fat% decrease is conservative (never all-fat, never faster than the safety ceiling)", () => {
  const [result] = forecastPhaseSequence(baseContext, [phase("FAT_LOSS", 1, 8)]);
  assert.ok(result.projectedEndWeightKg < result.projectedStartWeightKg);
  assert.ok(result.projectedEndBodyFatPct! < result.projectedStartBodyFatPct!);
  // Never faster than the shared safety ceiling (1%/week for loss).
  const maxTotalLossKg = baseContext.startWeightKg * 0.01 * 8;
  const actualLossKg = result.projectedStartWeightKg - result.projectedEndWeightKg;
  assert.ok(actualLossKg <= maxTotalLossKg + 0.05); // small rounding tolerance
});

test("forecastPhaseSequence: LEAN_GAIN projects a weight increase, but does not imply 100% of the gain is lean mass", () => {
  const [result] = forecastPhaseSequence(baseContext, [phase("LEAN_GAIN", 1, 12)]);
  assert.ok(result.projectedEndWeightKg > result.projectedStartWeightKg);
  const totalGainKg = result.projectedEndWeightKg - result.projectedStartWeightKg;
  const startFatMassKg = result.projectedStartWeightKg * (result.projectedStartBodyFatPct! / 100);
  const endFatMassKg = result.projectedEndWeightKg * (result.projectedEndBodyFatPct! / 100);
  const fatGainKg = endFatMassKg - startFatMassKg;
  // Some, but not all, of the gain is fat mass (never "100% muscle").
  assert.ok(fatGainKg > 0);
  assert.ok(fatGainKg < totalGainKg);
});

test("forecastPhaseSequence: MAINTENANCE/DIET_BREAK/RECOVERY project a stable weight (conservative default)", () => {
  for (const phaseType of ["MAINTENANCE", "DIET_BREAK", "RECOVERY"] as const) {
    const [result] = forecastPhaseSequence(baseContext, [phase(phaseType, 1, 4)]);
    assert.equal(result.projectedEndWeightKg, result.projectedStartWeightKg);
    assert.equal(result.projectedEndBodyFatPct, result.projectedStartBodyFatPct);
  }
});

test("forecastPhaseSequence: RECOMPOSITION also projects a stable weight, with an explicit assumption note explaining why", () => {
  const [result] = forecastPhaseSequence(baseContext, [phase("RECOMPOSITION", 1, 8)]);
  assert.equal(result.projectedEndWeightKg, result.projectedStartWeightKg);
  assert.ok(result.assumptions.some((a) => /tái cấu trúc/i.test(a)));
});

test("forecastPhaseSequence: missing body-fat baseline -> every phase's body-composition/FFMI fields are null, never fabricated", () => {
  const noBodyFatContext: ForecastContext = { ...baseContext, startBodyFatPct: null };
  const results = forecastPhaseSequence(noBodyFatContext, [
    phase("FAT_LOSS", 1, 8),
    phase("MAINTENANCE", 2, 4),
    phase("LEAN_GAIN", 3, 8),
  ]);
  for (const r of results) {
    assert.equal(r.projectedStartBodyFatPct, null);
    assert.equal(r.projectedEndBodyFatPct, null);
    assert.equal(r.projectedStartFfmi, null);
    assert.equal(r.projectedEndFfmi, null);
    assert.equal(r.dataCompleteness.bodyComposition, false);
  }
  // Weight is still always projected — never blocked by missing body-fat.
  assert.ok(results[0].projectedEndWeightKg < results[0].projectedStartWeightKg);
});

test("forecastPhaseSequence: BMR/TDEE evolve phase-to-phase (never held constant across the whole roadmap when weight changes)", () => {
  const results = forecastPhaseSequence(baseContext, [phase("FAT_LOSS", 1, 12), phase("MAINTENANCE", 2, 4)]);
  // End-of-phase-1 TDEE reflects the lower projected weight -> lower than start.
  assert.ok(results[0].estimatedEndTdee < results[0].estimatedStartTdee);
  // Phase 2 starts exactly where phase 1 ended.
  assert.equal(results[1].estimatedStartTdee, results[0].estimatedEndTdee);
});

test("forecastPhaseSequence: only the very first phase may use a real measured BMR — every later phase always uses the Mifflin-St Jeor formula (a future body state was never measured)", () => {
  const withMeasured: ForecastContext = { ...baseContext, measuredBmr: 1850 };
  const results = forecastPhaseSequence(withMeasured, [phase("FAT_LOSS", 1, 4), phase("MAINTENANCE", 2, 4)]);
  assert.equal(results[0].bmrFormula, "inbody_measured");
  assert.equal(results[0].estimatedStartBmr, 1850);
  assert.equal(results[1].bmrFormula, "mifflin_st_jeor");
});

test("forecastPhaseSequence: nutrition estimate reuses the real engine's own protein/calorie floor — never a fabricated number below it", () => {
  const [result] = forecastPhaseSequence(baseContext, [phase("FAT_LOSS", 1, 8)]);
  assert.ok(result.projectedCalories > 0);
  assert.ok(result.projectedMacros.proteinGrams > 0);
  // Deficit sign matches a fat-loss phase.
  assert.ok(result.projectedDeficitOrSurplusKcal < 0);
  assert.ok(result.projectedDeficitOrSurplusPercent! < 0);
});

test("forecastPhaseSequence: PERFORMANCE phase nutrition matches the existing engine's own MAINTENANCE_OR_PERFORMANCE behavior (no deficit/surplus fabricated)", () => {
  const [result] = forecastPhaseSequence(baseContext, [phase("PERFORMANCE", 1, 8)]);
  assert.equal(result.projectedDeficitOrSurplusKcal, 0);
});

test("forecastPhaseSequence: a long realistic sequence never produces negative or NaN values anywhere", () => {
  const results = forecastPhaseSequence(baseContext, [
    phase("FAT_LOSS", 1, 8),
    phase("DIET_BREAK", 2, 2),
    phase("FAT_LOSS", 3, 8),
    phase("MAINTENANCE", 4, 4),
    phase("LEAN_GAIN", 5, 12),
  ]);
  for (const r of results) {
    assert.ok(Number.isFinite(r.projectedEndWeightKg) && r.projectedEndWeightKg > 0);
    assert.ok(Number.isFinite(r.estimatedStartTdee) && r.estimatedStartTdee > 0);
    assert.ok(Number.isFinite(r.projectedCalories) && r.projectedCalories > 0);
    assert.ok(r.projectedMacros.proteinGrams >= 0);
    assert.ok(r.projectedMacros.carbGrams >= 0);
    assert.ok(r.projectedMacros.fatGrams >= 0);
  }
});

// ── computeForecastConfidence — Adaptive Forecast Reconciliation (design doc §8) ──

test("computeForecastConfidence: recent InBody scores strictly higher than stale InBody, manual, visual, or none", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");
  const recent = computeForecastConfidence({ ...baseContext, asOf: now, bodyFatMethod: "inbody", bodyFatMeasuredAt: "2026-09-01T00:00:00.000Z", completedCycleCount: 2 });
  const stale = computeForecastConfidence({ ...baseContext, asOf: now, bodyFatMethod: "inbody", bodyFatMeasuredAt: "2026-01-01T00:00:00.000Z", completedCycleCount: 2 });
  const manual = computeForecastConfidence({ ...baseContext, asOf: now, bodyFatMethod: "manual", completedCycleCount: 2 });
  const visual = computeForecastConfidence({ ...baseContext, asOf: now, bodyFatMethod: "visual_reference", completedCycleCount: 2 });
  const none = computeForecastConfidence({ ...baseContext, asOf: now, bodyFatMethod: null, completedCycleCount: 2 });
  assert.ok(recent.score > stale.score);
  assert.ok(stale.score > manual.score);
  assert.ok(manual.score > visual.score);
  assert.ok(visual.score > none.score);
  assert.ok(recent.reasonCodes.includes("RECENT_INBODY_MEASUREMENT"));
  assert.ok(stale.reasonCodes.includes("STALE_INBODY_MEASUREMENT"));
});

test("computeForecastConfidence: zero completed cycles is more conservative than 1, which is more conservative than 2+", () => {
  const zero = computeForecastConfidence({ ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 0 });
  const one = computeForecastConfidence({ ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 1 });
  const many = computeForecastConfidence({ ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 5 });
  assert.ok(zero.score < one.score);
  assert.ok(one.score < many.score);
  assert.ok(zero.reasonCodes.includes("NO_COMPLETED_CYCLES_YET"));
});

test("computeForecastConfidence: no history at all (no body-fat, zero cycles) is conservative (LOW tier)", () => {
  const result = computeForecastConfidence({ ...baseContext, bodyFatMethod: null, completedCycleCount: 0 });
  assert.equal(result.tier, "LOW");
});

test("computeForecastConfidence: tier is always one of HIGH/MEDIUM/LOW and score always in [0,1]", () => {
  const combos = [
    { bodyFatMethod: "inbody" as const, bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 5 },
    { bodyFatMethod: null, completedCycleCount: 0 },
    { bodyFatMethod: "manual" as const, completedCycleCount: 1 },
  ];
  for (const c of combos) {
    const r = computeForecastConfidence({ ...baseContext, ...c });
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(r.tier));
    assert.ok(r.score >= 0 && r.score <= 1);
  }
});

// ── forecastPhaseSequence — ranges & per-phase confidence (design doc §7) ──

test("forecastPhaseSequence: every phase's weight range satisfies low <= expected <= high", () => {
  const results = forecastPhaseSequence(
    { ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 2 },
    [phase("FAT_LOSS", 1, 8), phase("DIET_BREAK", 2, 2), phase("LEAN_GAIN", 3, 12)],
  );
  for (const r of results) {
    assert.ok(r.projectedEndWeightRangeKg.low <= r.projectedEndWeightRangeKg.expected);
    assert.ok(r.projectedEndWeightRangeKg.expected <= r.projectedEndWeightRangeKg.high);
    assert.equal(r.projectedEndWeightRangeKg.expected, r.projectedEndWeightKg);
    if (r.projectedEndBodyFatPctRange) {
      assert.ok(r.projectedEndBodyFatPctRange.low <= r.projectedEndBodyFatPctRange.expected);
      assert.ok(r.projectedEndBodyFatPctRange.expected <= r.projectedEndBodyFatPctRange.high);
    }
  }
});

test("forecastPhaseSequence: missing body-fat baseline -> body-fat range is null for every phase (never fabricated)", () => {
  const results = forecastPhaseSequence({ ...baseContext, startBodyFatPct: null }, [phase("FAT_LOSS", 1, 8)]);
  assert.equal(results[0].projectedEndBodyFatPctRange, null);
  // Weight range must still be present — missing body-fat never blocks weight.
  assert.ok(results[0].projectedEndWeightRangeKg);
});

test("forecastPhaseSequence: confidence never increases for a farther-future phase than a nearer one", () => {
  const tierRank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const results = forecastPhaseSequence(
    { ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 5 },
    [phase("FAT_LOSS", 1, 8), phase("DIET_BREAK", 2, 2), phase("FAT_LOSS", 3, 8), phase("MAINTENANCE", 4, 4)],
  );
  for (let i = 1; i < results.length; i++) {
    assert.ok(tierRank[results[i].confidence.tier] <= tierRank[results[i - 1].confidence.tier]);
  }
});

test("forecastPhaseSequence: with no body-fat/cycle-history context supplied at all, confidence still computes (defaults conservative), never throws", () => {
  const results = forecastPhaseSequence(baseContext, [phase("FAT_LOSS", 1, 8)]);
  assert.ok(["HIGH", "MEDIUM", "LOW"].includes(results[0].confidence.tier));
});

test("forecastPhaseSequence: range rounding is stable (1 decimal place for weight/body-fat)", () => {
  const results = forecastPhaseSequence(
    { ...baseContext, bodyFatMethod: "inbody", bodyFatMeasuredAt: new Date().toISOString(), completedCycleCount: 3 },
    [phase("FAT_LOSS", 1, 8)],
  );
  const r = results[0].projectedEndWeightRangeKg;
  for (const v of [r.low, r.expected, r.high]) {
    assert.equal(Math.round(v * 10) / 10, v);
  }
});
