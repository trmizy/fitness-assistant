import test from "node:test";
import assert from "node:assert/strict";
import {
  computeEnergyBreakdown,
  computeFfmi,
  assessTargetRealism,
  buildDiagnosisReasoning,
} from "../services/fitness-diagnosis.engine";

// ── computeEnergyBreakdown ──────────────────────────────────────────────

test("computeEnergyBreakdown: components always sum exactly to the real TDEE (never a competing total)", () => {
  const result = computeEnergyBreakdown({
    weightKg: 75,
    heightCm: 175,
    age: 28,
    gender: "MALE",
    activityLevel: "MODERATELY_ACTIVE",
    experienceLevel: "INTERMEDIATE",
    trainingDaysPerWeek: 4,
    dailyGoalSteps: 8000,
  });
  const sum = result.bmr + result.components.reduce((a, c) => a + c.kcal, 0);
  assert.equal(sum, result.tdee);
});

test("computeEnergyBreakdown: uses InBody-measured BMR when supplied, matching the authoritative engine's own priority", () => {
  const result = computeEnergyBreakdown({
    weightKg: 75, heightCm: 175, age: 28, gender: "MALE",
    activityLevel: "SEDENTARY", experienceLevel: null, measuredBmr: 1800,
  });
  assert.equal(result.bmr, 1800);
  assert.equal(result.bmrFormula, "inbody_measured");
});

test("computeEnergyBreakdown: no InBody -> Mifflin-St Jeor estimate, still reconciles", () => {
  const result = computeEnergyBreakdown({
    weightKg: 60, heightCm: 160, age: 30, gender: "FEMALE",
    activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "BEGINNER",
  });
  assert.equal(result.bmrFormula, "mifflin_st_jeor");
  const sum = result.bmr + result.components.reduce((a, c) => a + c.kcal, 0);
  assert.equal(sum, result.tdee);
});

test("computeEnergyBreakdown: zero training/steps input still reconciles (remainder folds into a single honest 'Hoạt động & tiêu hao khác' row, never dropped)", () => {
  const result = computeEnergyBreakdown({
    weightKg: 70, heightCm: 170, age: 25, gender: "MALE",
    activityLevel: "VERY_ACTIVE", experienceLevel: "ADVANCED",
    trainingDaysPerWeek: 0, dailyGoalSteps: 0,
  });
  const sum = result.bmr + result.components.reduce((a, c) => a + c.kcal, 0);
  assert.equal(sum, result.tdee);
  assert.ok(result.components.every((c) => c.kcal >= 0));
  // Roadmap Projection Hardening fix: with zero steps/training evidence,
  // there must be exactly ONE component (the honest catch-all), never a
  // fabricated TEF/steps/training split from nothing.
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].label, "Hoạt động & tiêu hao khác");
  assert.equal(result.components[0].kcal, result.tdee - result.bmr);
});

test("computeEnergyBreakdown: never fabricates an independent TEF line — no component is ever labeled 'TEF' regardless of input", () => {
  const withActivity = computeEnergyBreakdown({
    weightKg: 82, heightCm: 178, age: 29, gender: "MALE",
    activityLevel: "MODERATELY_ACTIVE", experienceLevel: "INTERMEDIATE",
    trainingDaysPerWeek: 4, dailyGoalSteps: 9000,
  });
  assert.ok(!withActivity.components.some((c) => /TEF/i.test(c.label)));
});

test("computeEnergyBreakdown: real nonzero steps/training produce their own separately-labeled rows, and the combined claimable share never exceeds the real gap", () => {
  const result = computeEnergyBreakdown({
    weightKg: 82, heightCm: 178, age: 29, gender: "MALE",
    activityLevel: "MODERATELY_ACTIVE", experienceLevel: "INTERMEDIATE",
    trainingDaysPerWeek: 4, dailyGoalSteps: 9000,
  });
  const stepsRow = result.components.find((c) => c.label === "Bước chân hằng ngày");
  const trainingRow = result.components.find((c) => c.label === "Tập kháng lực");
  const otherRow = result.components.find((c) => c.label === "Hoạt động & tiêu hao khác");
  assert.ok(stepsRow && stepsRow.kcal > 0);
  assert.ok(trainingRow && trainingRow.kcal > 0);
  assert.ok(otherRow, "the catch-all row is always present, even when steps/training claim most of the gap");
  const sum = result.bmr + result.components.reduce((a, c) => a + c.kcal, 0);
  assert.equal(sum, result.tdee);
});

// ── computeFfmi ──────────────────────────────────────────────────────────

test("computeFfmi: standard formula (fat-free mass / height^2), normalized variant included", () => {
  const result = computeFfmi(80, 180, 15); // 80kg, 180cm, 15% bf
  // fat-free mass = 80 * 0.85 = 68
  assert.equal(result.fatFreeMassKg, 68);
  // ffmi = 68 / 1.8^2 = 20.99
  assert.equal(result.ffmi, 20.99);
  assert.ok(result.normalizedFfmi > 0);
});

test("computeFfmi: higher body fat % -> lower FFMI at the same weight/height", () => {
  const lean = computeFfmi(80, 180, 10);
  const fat = computeFfmi(80, 180, 25);
  assert.ok(lean.ffmi > fat.ffmi);
});

// ── assessTargetRealism ──────────────────────────────────────────────────

test("assessTargetRealism: an aggressive weight-loss timeframe produces a warning and a suggested minimum", () => {
  const result = assessTargetRealism({
    currentWeightKg: 90, targetWeightKg: 70, timeframeWeeks: 4, goal: "WEIGHT_LOSS",
  });
  assert.ok(result.warnings.length > 0);
  assert.ok(result.suggestedMinTimeframeWeeks !== null);
  assert.ok(result.suggestedMinTimeframeWeeks! > 4);
});

test("assessTargetRealism: a realistic timeframe produces no warning", () => {
  const result = assessTargetRealism({
    currentWeightKg: 90, targetWeightKg: 85, timeframeWeeks: 20, goal: "WEIGHT_LOSS",
  });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.suggestedMinTimeframeWeeks, null);
});

test("assessTargetRealism: no target/timeframe supplied -> no warning, never fabricated", () => {
  const result = assessTargetRealism({
    currentWeightKg: 90, targetWeightKg: null, timeframeWeeks: null, goal: "MAINTENANCE",
  });
  assert.equal(result.warnings.length, 0);
});

// ── buildDiagnosisReasoning ────────────────────────────────────────────

test("buildDiagnosisReasoning: focuses on the current-vs-target comparison itself, never duplicates the permanent adaptive-Gymini messaging (that lives as its own always-visible UI element in the wizard, per the master task's explicit split)", () => {
  const text = buildDiagnosisReasoning({
    goal: "WEIGHT_LOSS", currentBodyFatPct: 20, targetBodyFatPct: 15, currentFfmi: 21.5,
    targetRealismWarnings: [], safetyReviewRequired: false,
  });
  assert.ok(/giảm mỡ/.test(text));
  assert.ok(!/Lộ trình này không cố định/.test(text));
});

test("buildDiagnosisReasoning: missing body-fat data never fabricates a comparison", () => {
  const text = buildDiagnosisReasoning({
    goal: "MUSCLE_GAIN", currentBodyFatPct: null, targetBodyFatPct: null, currentFfmi: null,
    targetRealismWarnings: [], safetyReviewRequired: false,
  });
  assert.ok(/Chưa đủ dữ liệu/.test(text));
});

test("buildDiagnosisReasoning: safety review required is surfaced explicitly", () => {
  const text = buildDiagnosisReasoning({
    goal: "WEIGHT_LOSS", currentBodyFatPct: null, targetBodyFatPct: null, currentFfmi: null,
    targetRealismWarnings: [], safetyReviewRequired: true,
  });
  assert.ok(/an toàn/.test(text));
});
