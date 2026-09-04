/**
 * Regression tests for the AI-nutrition root-cause fix: the bug report's
 * exact reproduction case is "3000 kcal | 150g protein | 200g carb | 65g
 * fat" being displayed/saved without ever checking that
 * 150*4 + 200*4 + 65*9 = 1985 kcal, not 3000. Also covers weight-conflict
 * resolution (76kg stated vs 73.2kg latest InBody) and protein g/kg
 * evaluation (150g / 76kg ≈ 1.97 g/kg).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMacroCalories,
  checkMacroCalorieConsistency,
  extractStatedWeightKg,
  requestsIgnoreSavedData,
  resolveWeightForCalculation,
  evaluateProteinIntake,
  evaluateCalorieSurplus,
  extractClaimedMacros,
  checkCalorieEstimationInputs,
  estimateTdee,
  hasCalorieEstimationSignal,
  mapGenderToBiologicalSex,
  mapActivityLevel,
  MACRO_CALORIE_TOLERANCE_KCAL,
  PROTEIN_EVIDENCE_RANGE_G_PER_KG,
} from "../nutrition_engine";

test("computeMacroCalories: Atwater 4/4/9", () => {
  assert.equal(computeMacroCalories(150, 200, 65), 150 * 4 + 200 * 4 + 65 * 9);
  assert.equal(computeMacroCalories(0, 0, 0), 0);
});

test("checkMacroCalorieConsistency: reproduces the bug report's exact 3000/150/200/65 case", () => {
  const result = checkMacroCalorieConsistency(3000, 150, 200, 65);
  assert.equal(result.computedCalories, 1985);
  assert.equal(result.discrepancyKcal, 1985 - 3000);
  assert.equal(result.consistent, false, "1015 kcal off should never be reported as consistent");
});

test("checkMacroCalorieConsistency: within tolerance is consistent", () => {
  // 150*4 + 200*4 + 56*9 = 600+800+504 = 1904; target 1950 -> diff 46 <= 50
  const result = checkMacroCalorieConsistency(1950, 150, 200, 56);
  assert.equal(result.consistent, true);
});

test("checkMacroCalorieConsistency: exactly at tolerance boundary is consistent, one over is not", () => {
  const atBoundary = checkMacroCalorieConsistency(
    2000 - MACRO_CALORIE_TOLERANCE_KCAL,
    0,
    500,
    0,
  ); // computed = 2000
  assert.equal(atBoundary.discrepancyKcal, MACRO_CALORIE_TOLERANCE_KCAL);
  assert.equal(atBoundary.consistent, true);

  const overBoundary = checkMacroCalorieConsistency(
    2000 - MACRO_CALORIE_TOLERANCE_KCAL - 1,
    0,
    500,
    0,
  );
  assert.equal(overBoundary.consistent, false);
});

test("checkMacroCalorieConsistency: floating point boundary cases don't false-positive", () => {
  // 33.33*4 + 33.33*4 + 33.34*9 style rounding stress
  const result = checkMacroCalorieConsistency(566.7, 33.33, 33.33, 33.34);
  assert.ok(result.consistent);
});

// ── extractStatedWeightKg ────────────────────────────────────────────────

test("extractStatedWeightKg: parses 'tôi nặng 76kg'", () => {
  assert.equal(extractStatedWeightKg("Giúp tôi lên thực đơn, tôi nặng 76kg"), 76);
});

test("extractStatedWeightKg: parses '76 kg' with a space", () => {
  assert.equal(extractStatedWeightKg("cân nặng hiện tại 76 kg"), 76);
});

test("extractStatedWeightKg: parses decimal weight", () => {
  assert.equal(extractStatedWeightKg("tôi nặng 76.5kg"), 76.5);
});

test("extractStatedWeightKg: ignores implausible values (typo guard)", () => {
  assert.equal(extractStatedWeightKg("tạ 500kg"), undefined);
  assert.equal(extractStatedWeightKg("1kg gạo"), undefined);
});

test("extractStatedWeightKg: returns undefined when no weight is mentioned", () => {
  assert.equal(extractStatedWeightKg("Tôi nên ăn bao nhiêu protein mỗi ngày?"), undefined);
});

test("requestsIgnoreSavedData: detects explicit override phrasing", () => {
  assert.equal(
    requestsIgnoreSavedData("Bỏ qua dữ liệu đã lưu. Hãy ước tính calo duy trì."),
    true,
  );
  assert.equal(requestsIgnoreSavedData("Tôi nên ăn bao nhiêu protein?"), false);
});

// ── resolveWeightForCalculation (Part 3 precedence) ─────────────────────

test("resolveWeightForCalculation: message-stated weight wins over InBody, conflict flagged", () => {
  const result = resolveWeightForCalculation({
    messageStatedWeightKg: 76,
    latestMeasurement: { weightKg: 73.2, measuredAt: "2026-08-10" },
  });
  assert.equal(result.weightKg, 76);
  assert.equal(result.source, "message_stated");
  assert.equal(result.conflict, true);
  assert.match(result.conflictNote!, /76/);
  assert.match(result.conflictNote!, /73\.2/);
  assert.equal(result.alternateWeightKg, 73.2);
});

test("resolveWeightForCalculation: message-stated weight close to InBody is not flagged as conflict", () => {
  const result = resolveWeightForCalculation({
    messageStatedWeightKg: 73.5,
    latestMeasurement: { weightKg: 73.2 },
  });
  assert.equal(result.conflict, false);
});

test("resolveWeightForCalculation: falls back to latest measurement when no message weight given", () => {
  const result = resolveWeightForCalculation({
    latestMeasurement: { weightKg: 73.2, measuredAt: "2026-08-10" },
    profileCurrentWeightKg: 80,
  });
  assert.equal(result.weightKg, 73.2);
  assert.equal(result.source, "latest_measurement");
});

test("resolveWeightForCalculation: falls back to profile cache when no measurement exists", () => {
  const result = resolveWeightForCalculation({ profileCurrentWeightKg: 80 });
  assert.equal(result.weightKg, 80);
  assert.equal(result.source, "profile_cache");
});

test("resolveWeightForCalculation: returns 'none' when nothing is known — caller must ask", () => {
  const result = resolveWeightForCalculation({});
  assert.equal(result.weightKg, undefined);
  assert.equal(result.source, "none");
});

// ── evaluateProteinIntake ─────────────────────────────────────────────────

test("evaluateProteinIntake: 150g/76kg is within range, near the upper end (spec's worked example)", () => {
  const result = evaluateProteinIntake(150, 76);
  assert.equal(result.gPerKg, 1.97);
  assert.equal(result.tier, "within_range");
  assert.ok(result.gPerKg <= PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling);
});

test("evaluateProteinIntake: below evidence range is flagged", () => {
  const result = evaluateProteinIntake(80, 76); // ~1.05 g/kg
  assert.equal(result.tier, "below_range");
});

test("evaluateProteinIntake: very high intake (448g/76kg from the bug report) is flagged, not silently accepted", () => {
  const result = evaluateProteinIntake(448, 76); // ~5.9 g/kg
  assert.equal(result.tier, "very_high");
  assert.ok(result.gPerKg > 5);
});

test("evaluateProteinIntake: does not recommend increasing protein when already sufficient", () => {
  const result = evaluateProteinIntake(130, 76); // ~1.71 g/kg, comfortably within range
  assert.equal(result.tier, "within_range");
  assert.doesNotMatch(result.note, /tăng/i);
});

// ── evaluateCalorieSurplus ────────────────────────────────────────────────

test("evaluateCalorieSurplus: flags a large muscle-gain surplus", () => {
  const result = evaluateCalorieSurplus(2500, 3200); // 28% surplus
  assert.equal(result.isLarge, true);
});

test("evaluateCalorieSurplus: does not flag a conservative surplus", () => {
  const result = evaluateCalorieSurplus(2500, 2625); // 5% surplus
  assert.equal(result.isLarge, false);
});

// ── extractClaimedMacros (bug report Q3) ─────────────────────────────────

test("extractClaimedMacros: parses the exact bug-report claim", () => {
  const result = extractClaimedMacros(
    "Đánh giá 3000 kcal, 150g protein, 200g carb, 65g fat và kiểm tra tổng calo.",
  );
  assert.deepEqual(result, { calories: 3000, proteinG: 150, carbG: 200, fatG: 65 });
});

test("extractClaimedMacros + checkMacroCalorieConsistency together reproduce the exact bug", () => {
  const claimed = extractClaimedMacros(
    "Đánh giá 3000 kcal, 150g protein, 200g carb, 65g fat và kiểm tra tổng calo.",
  );
  const check = checkMacroCalorieConsistency(
    claimed!.calories!,
    claimed!.proteinG!,
    claimed!.carbG!,
    claimed!.fatG!,
  );
  assert.equal(check.computedCalories, 1985);
  assert.equal(check.consistent, false);
});

test("extractClaimedMacros: a bare calorie mention with no macros returns undefined (not enough to validate)", () => {
  assert.equal(extractClaimedMacros("Tôi cần khoảng 2000 kcal mỗi ngày"), undefined);
});

test("extractClaimedMacros: a single macro mention alone is not enough (avoids false-positive on casual mentions)", () => {
  assert.equal(extractClaimedMacros("Món này có 500 kcal và 30g protein"), undefined);
});

test("extractClaimedMacros: returns undefined for a message with no numbers", () => {
  assert.equal(extractClaimedMacros("Tôi nên ăn bao nhiêu protein?"), undefined);
});

// ── checkCalorieEstimationInputs / estimateTdee (Part 4: deterministic
// calorie engine — root-cause gap found while verifying the Definition of
// Done: no function anywhere computed a TDEE/BMR estimate at all, so a
// CALORIE_ESTIMATION question had nothing but raw LLM math to fall back
// on) ──────────────────────────────────────────────────────────────────

test("checkCalorieEstimationInputs: all required fields present -> complete", () => {
  const check = checkCalorieEstimationInputs({
    weightKg: 76,
    heightCm: 175,
    age: 28,
    sex: "male",
    activityLevel: "moderate",
  });
  assert.equal(check.complete, true);
  assert.deepEqual(check.missingFields, []);
  assert.equal(check.missingFieldsPromptVi, undefined);
});

test("checkCalorieEstimationInputs: missing fields are reported by name, not silently defaulted", () => {
  const check = checkCalorieEstimationInputs({ weightKg: 76 });
  assert.equal(check.complete, false);
  assert.deepEqual(
    [...check.missingFields].sort(),
    ["activityLevel", "age", "heightCm", "sex"].sort(),
  );
  assert.ok(check.missingFieldsPromptVi);
  assert.ok(check.missingFieldsPromptVi!.includes("chiều cao"));
  assert.ok(check.missingFieldsPromptVi!.includes("tuổi"));
});

test("checkCalorieEstimationInputs: completely empty input -> all 5 fields reported missing", () => {
  const check = checkCalorieEstimationInputs({});
  assert.equal(check.complete, false);
  assert.equal(check.missingFields.length, 5);
});

test("estimateTdee: a known Mifflin-St Jeor case computes the textbook BMR", () => {
  // Male, 76kg, 175cm, 28yo: BMR = 10*76 + 6.25*175 - 5*28 + 5
  //   = 760 + 1093.75 - 140 + 5 = 1718.75 -> rounds to 1719.
  const result = estimateTdee({
    weightKg: 76,
    heightCm: 175,
    age: 28,
    sex: "male",
    activityLevel: "moderate",
  });
  assert.equal(result.bmrKcal, 1719);
  assert.equal(result.formulaVersion, "Mifflin-St Jeor (1990)");
  // TDEE = BMR * 1.55 (moderate) = 1719 * 1.55 = 2664.45 -> 2664
  assert.equal(result.tdeeKcal, 2664);
  assert.equal(result.activityMultiplier, 1.55);
  assert.deepEqual(result.applicabilityWarnings, []);
});

test("estimateTdee: female uses the -161 constant instead of +5", () => {
  const result = estimateTdee({
    weightKg: 60,
    heightCm: 165,
    age: 30,
    sex: "female",
    activityLevel: "sedentary",
  });
  // BMR = 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161 = 1320.25 -> 1320
  assert.equal(result.bmrKcal, 1320);
});

test("estimateTdee: never returns a single false-precision number — always a range around the point estimate", () => {
  const result = estimateTdee({
    weightKg: 76,
    heightCm: 175,
    age: 28,
    sex: "male",
    activityLevel: "moderate",
  });
  assert.ok(result.tdeeRangeLowKcal < result.tdeeKcal);
  assert.ok(result.tdeeRangeHighKcal > result.tdeeKcal);
});

test("estimateTdee: flags applicability warnings for under-18 rather than silently applying the adult formula", () => {
  const result = estimateTdee({
    weightKg: 55,
    heightCm: 160,
    age: 16,
    sex: "female",
    activityLevel: "moderate",
  });
  assert.ok(result.applicabilityWarnings.length > 0);
  assert.ok(result.applicabilityWarnings.some((w) => w.includes("18 tuổi")));
});

test("estimateTdee: flags applicability warnings for very_active (athlete) inputs rather than presenting a generic estimate as precise", () => {
  const result = estimateTdee({
    weightKg: 80,
    heightCm: 180,
    age: 25,
    sex: "male",
    activityLevel: "very_active",
  });
  assert.ok(result.applicabilityWarnings.length > 0);
});

test("hasCalorieEstimationSignal: recognizes Vietnamese calorie-need questions", () => {
  assert.equal(hasCalorieEstimationSignal("Mình cần bao nhiêu calo một ngày?"), true);
  assert.equal(hasCalorieEstimationSignal("Nhu cầu calo của mình là bao nhiêu?"), true);
  assert.equal(hasCalorieEstimationSignal("TDEE của mình khoảng bao nhiêu?"), true);
  assert.equal(hasCalorieEstimationSignal("Giúp mình tính BMR với"), true);
});

test("hasCalorieEstimationSignal: recognizes English calorie-need questions", () => {
  assert.equal(hasCalorieEstimationSignal("How many calories do I need per day?"), true);
  assert.equal(hasCalorieEstimationSignal("What's my daily calorie requirement?"), true);
});

test("hasCalorieEstimationSignal: does not fire on unrelated nutrition questions", () => {
  assert.equal(hasCalorieEstimationSignal("Trứng có bao nhiêu protein?"), false);
  assert.equal(hasCalorieEstimationSignal("Tôi nên ăn gì trước khi tập?"), false);
});

test("mapGenderToBiologicalSex: MALE/FEMALE map directly, OTHER and undefined are left unmapped (must be asked, not guessed)", () => {
  assert.equal(mapGenderToBiologicalSex("MALE"), "male");
  assert.equal(mapGenderToBiologicalSex("FEMALE"), "female");
  assert.equal(mapGenderToBiologicalSex("OTHER"), undefined);
  assert.equal(mapGenderToBiologicalSex(undefined), undefined);
});

test("mapActivityLevel: maps all 5 profile enum values, undefined for anything else", () => {
  assert.equal(mapActivityLevel("SEDENTARY"), "sedentary");
  assert.equal(mapActivityLevel("LIGHTLY_ACTIVE"), "light");
  assert.equal(mapActivityLevel("MODERATELY_ACTIVE"), "moderate");
  assert.equal(mapActivityLevel("VERY_ACTIVE"), "active");
  assert.equal(mapActivityLevel("EXTREMELY_ACTIVE"), "very_active");
  assert.equal(mapActivityLevel(undefined), undefined);
});

test("estimateTdee: a typical healthy adult profile produces no applicability warnings", () => {
  const result = estimateTdee({
    weightKg: 70,
    heightCm: 170,
    age: 35,
    sex: "male",
    activityLevel: "light",
  });
  assert.deepEqual(result.applicabilityWarnings, []);
});
