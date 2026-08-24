/**
 * Regression test: the "Mục tiêu đang lưu" line shown for a saved
 * NutritionGoal must flag it when its own macros don't add up to its own
 * calorie figure (bug report's exact 3000/150/200/65 case), instead of
 * displaying the contradictory numbers silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatNutritionAnswer, type NutritionScheduleContext } from "../nutrition_context";

function baseContext(
  overrides: Partial<NutritionScheduleContext> = {},
): NutritionScheduleContext {
  return {
    targetDate: "2026-08-18",
    mealType: "all",
    plannedMealsFound: false,
    meals: [],
    source: "nutrition_goal",
    ...overrides,
  };
}

test("BUG REPORT: 3000kcal/150P/200C/65F saved goal is displayed WITH a discrepancy warning", () => {
  const context = baseContext({
    dailyCaloriesTarget: 3000,
    proteinTarget: 150,
    carbTarget: 200,
    fatTarget: 65,
  });
  const answer = formatNutritionAnswer(context, "vi");
  assert.match(answer, /3000 kcal/);
  assert.match(answer, /1985/, "must surface the actual macro-derived calorie total");
  assert.match(answer, /không khớp|Lưu ý/i, "must explicitly flag the inconsistency");
});

test("a self-consistent saved goal is displayed WITHOUT a spurious warning", () => {
  const context = baseContext({
    dailyCaloriesTarget: 1985,
    proteinTarget: 150,
    carbTarget: 200,
    fatTarget: 65,
  });
  const answer = formatNutritionAnswer(context, "vi");
  assert.match(answer, /1985 kcal/);
  assert.doesNotMatch(answer, /không khớp/i);
});

test("English locale also surfaces the discrepancy", () => {
  const context = baseContext({
    dailyCaloriesTarget: 3000,
    proteinTarget: 150,
    carbTarget: 200,
    fatTarget: 65,
  });
  const answer = formatNutritionAnswer(context, "en");
  assert.match(answer, /1985/);
  assert.match(answer, /not the stated/i);
});
