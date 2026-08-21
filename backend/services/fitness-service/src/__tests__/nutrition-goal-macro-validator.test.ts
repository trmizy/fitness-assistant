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
import { checkNutritionGoalMacroConsistency } from "../services/nutrition-goal-macro-validator";

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
