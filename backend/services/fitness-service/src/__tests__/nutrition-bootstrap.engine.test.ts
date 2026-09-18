/**
 * Run with: npx tsx --test src/__tests__/nutrition-bootstrap.engine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInitialNutritionPrescription,
  findMissingBootstrapFields,
  type NutritionBootstrapInput,
} from "../services/nutrition-bootstrap.engine";

const baseInput: NutritionBootstrapInput = {
  weightKg: 113.6,
  heightCm: 178,
  age: 22,
  gender: "MALE",
  goal: "WEIGHT_LOSS",
  activityLevel: "SEDENTARY",
  experienceLevel: "BEGINNER",
};

test("spec §XLI scenario: 22yo male, 178cm, 113.6kg, beginner, weight loss — sane initial prescription, never an extreme deficit", () => {
  const result = computeInitialNutritionPrescription(baseInput);

  // Mifflin-St Jeor: 10*113.6 + 6.25*178 - 5*22 + 5 = 1136 + 1112.5 - 110 + 5 = 2143.5
  assert.equal(result.bmr, 2144);
  assert.equal(result.bmrFormula, "mifflin_st_jeor");
  // maintenance = bmr * 1.2 (sedentary)
  assert.equal(result.maintenanceCalories, Math.round(2144 * 1.2));
  // 15% deficit for a beginner — nowhere near a crash diet
  assert.ok(result.targetCalories < result.maintenanceCalories);
  assert.ok(
    result.targetCalories > result.maintenanceCalories * 0.8,
    "must not apply anything close to a starvation-level deficit",
  );
  // Protein should be a real, evidence-informed number, not left at 0
  assert.ok(result.proteinGrams > 150 && result.proteinGrams < 250);
  assert.ok(result.carbGrams >= 0);
  assert.ok(result.fatGrams > 0);
  assert.ok(result.waterMl > 0);
  assert.ok(result.evidenceIds.length > 0);
  assert.ok(result.evidenceIds.every((id) => typeof id === "string" && id.length > 0));
});

test("never proposes below the shared safety floor (1200 kcal) even for a very light, sedentary profile", () => {
  const result = computeInitialNutritionPrescription({
    weightKg: 42,
    heightCm: 150,
    age: 60,
    gender: "FEMALE",
    goal: "WEIGHT_LOSS",
    activityLevel: "SEDENTARY",
    experienceLevel: "ADVANCED",
  });
  assert.ok(result.targetCalories >= 1200);
});

test("MUSCLE_GAIN goal produces a surplus, not a deficit", () => {
  const result = computeInitialNutritionPrescription({
    ...baseInput,
    goal: "MUSCLE_GAIN",
    experienceLevel: "INTERMEDIATE",
  });
  assert.ok(result.targetCalories > result.maintenanceCalories);
  assert.ok(result.deficitOrSurplusKcal > 0);
});

test("MAINTENANCE goal keeps target at maintenance calories", () => {
  const result = computeInitialNutritionPrescription({
    ...baseInput,
    goal: "MAINTENANCE",
  });
  assert.equal(result.targetCalories, result.maintenanceCalories);
  assert.equal(result.deficitOrSurplusKcal, 0);
});

test("prefers a measured InBody BMR over the Mifflin-St Jeor estimate when available", () => {
  const result = computeInitialNutritionPrescription({ ...baseInput, measuredBmr: 1950 });
  assert.equal(result.bmr, 1950);
  assert.equal(result.bmrFormula, "inbody_measured");
});

test("advanced lifters get a smaller deficit fraction than beginners for the same goal", () => {
  const beginner = computeInitialNutritionPrescription({ ...baseInput, experienceLevel: "BEGINNER" });
  const advanced = computeInitialNutritionPrescription({ ...baseInput, experienceLevel: "ADVANCED" });
  const beginnerDeficit = Math.abs(beginner.deficitOrSurplusKcal);
  const advancedDeficit = Math.abs(advanced.deficitOrSurplusKcal);
  assert.ok(advancedDeficit < beginnerDeficit);
});

test("useMaintenanceOnly forces maintenance calories even for a WEIGHT_LOSS goal — no deficit computed at all", () => {
  const result = computeInitialNutritionPrescription({
    ...baseInput,
    goal: "WEIGHT_LOSS",
    useMaintenanceOnly: true,
  });
  assert.equal(result.targetCalories, result.maintenanceCalories);
  assert.equal(result.deficitOrSurplusKcal, 0);
  assert.ok(result.reasonCodes.includes("MAINTENANCE_ONLY_PENDING_SAFETY_SCREENING_REVIEW"));
  assert.ok(!result.reasonCodes.includes("INITIAL_DEFICIT_FOR_WEIGHT_LOSS_GOAL"));
});

test("useMaintenanceOnly forces maintenance calories even for a MUSCLE_GAIN goal — no surplus computed at all", () => {
  const result = computeInitialNutritionPrescription({
    ...baseInput,
    goal: "MUSCLE_GAIN",
    useMaintenanceOnly: true,
  });
  assert.equal(result.targetCalories, result.maintenanceCalories);
  assert.equal(result.deficitOrSurplusKcal, 0);
});

test("useMaintenanceOnly still computes a real, evidence-backed protein/fat/water target — never withholds a number entirely", () => {
  const result = computeInitialNutritionPrescription({ ...baseInput, useMaintenanceOnly: true });
  assert.ok(result.proteinGrams > 0);
  assert.ok(result.fatGrams > 0);
  assert.ok(result.waterMl > 0);
});

test("findMissingBootstrapFields flags absent required fields without requiring experienceLevel or InBody", () => {
  assert.deepEqual(findMissingBootstrapFields({}), [
    "weightKg",
    "heightCm",
    "age",
    "gender",
    "goal",
    "activityLevel",
  ]);
  assert.deepEqual(
    findMissingBootstrapFields({
      weightKg: 70,
      heightCm: 170,
      age: 30,
      gender: "MALE",
      goal: "MAINTENANCE",
      activityLevel: "SEDENTARY",
    }),
    [],
  );
  assert.deepEqual(
    findMissingBootstrapFields({ weightKg: 70, heightCm: 170, goal: "MAINTENANCE" }),
    ["age", "gender", "activityLevel"],
  );
});
