/**
 * Regression test for the AI-nutrition bug report's exact reproduction:
 * saving a NutritionGoal of 3000 kcal / 150g protein / 200g carb / 65g fat
 * must be rejected (Atwater 4/4/9 only accounts for 1985 kcal), not
 * silently persisted.
 *
 * Run with (from backend/services/fitness-service):
 *   npx tsx --test src/__tests__/nutrition-goal-macro-validator.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { checkNutritionGoalMacroConsistency, assertCalorieFloor } from "../services/nutrition-goal-macro-validator";
import { cycleThresholds } from "../config/cycle-thresholds.config";

test("BUG REPORT: 3000/150/200/65 is flagged inconsistent (computed 1985 kcal)", () => {
  const result = checkNutritionGoalMacroConsistency(3000, 150, 200, 65);
  assert.equal(result.computedCalories, 1985);
  assert.equal(result.consistent, false);
});

test("a self-consistent goal passes", () => {
  const result = checkNutritionGoalMacroConsistency(1985, 150, 200, 65);
  assert.equal(result.consistent, true);
});

test("within tolerance (rounding slack) still passes", () => {
  // 150*4 + 200*4 + 56*9 = 1904; target 1950 -> diff 46 <= 50
  const result = checkNutritionGoalMacroConsistency(1950, 150, 200, 56);
  assert.equal(result.consistent, true);
});

// Safety-floor audit (2026-09-07) — see assertCalorieFloor's own doc
// comment in nutrition-goal-macro-validator.ts for the three-way
// inconsistency this closes (engine 1200 / PT-modify's old uncommented
// 800 / client self-edit's previous total absence of a floor).

test("assertCalorieFloor: throws a 400 for a value below the shared safety floor (CLIENT)", () => {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  assert.throws(
    () => assertCalorieFloor(floor - 1, "CLIENT"),
    (err: any) => err.status === 400 && err.code === "NUTRITION_GOAL_BELOW_SAFETY_FLOOR",
  );
});

test("assertCalorieFloor: throws a 400 for a value below the shared safety floor (PT)", () => {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  assert.throws(
    () => assertCalorieFloor(floor - 1, "PT"),
    (err: any) => err.status === 400 && err.code === "NUTRITION_GOAL_BELOW_SAFETY_FLOOR",
  );
});

test("assertCalorieFloor: exactly at the floor passes (inclusive boundary)", () => {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  assert.doesNotThrow(() => assertCalorieFloor(floor, "CLIENT"));
  assert.doesNotThrow(() => assertCalorieFloor(floor, "PT"));
});

test("assertCalorieFloor: comfortably above the floor passes for both roles", () => {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  assert.doesNotThrow(() => assertCalorieFloor(floor + 500, "CLIENT"));
  assert.doesNotThrow(() => assertCalorieFloor(floor + 500, "PT"));
});

test("assertCalorieFloor: PT and CLIENT share the exact same numeric floor (the whole point of this fix)", () => {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  // The old PT-only floor was 800, strictly below the shared 1200 floor —
  // confirm a value in that old gap (800-1199) is now rejected for BOTH
  // roles, not just CLIENT.
  assert.ok(floor > 800, "sanity: this test only means something if the shared floor is above the old PT-only 800");
  for (const role of ["CLIENT", "PT"] as const) {
    assert.throws(() => assertCalorieFloor(900, role), (err: any) => err.status === 400);
  }
});
