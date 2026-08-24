import assert from "node:assert/strict";
import test from "node:test";
import { validateNutritionPlanInvariants } from "../services/nutrition-plan-invariant.service";

function content(): any {
  const meal = { mealType: "BREAKFAST", title: "Meal", calories: 2000, protein: 150, carbs: 225, fat: 56, items: [{ foodId: "food-1", name: "Food", quantity: 100, unit: "g", calories: 2000, protein: 150, carbs: 225, fat: 56 }] };
  return { goal: "maintain", durationWeeks: 1, mealsPerDay: 1, dailyCaloriesTarget: 2000, proteinTargetGrams: 150, carbTargetGrams: 225, fatTargetGrams: 56, weeklySchedule: Array.from({ length: 7 }, (_, index) => ({ dayNumber: index + 1, title: `Day ${index + 1}`, totalCalories: 2000, protein: 150, carbs: 225, fat: 56, meals: [structuredClone(meal)] })), generalNotes: [] };
}

test("accepts deterministic calories, macros and catalog food IDs", () => {
  assert.equal(validateNutritionPlanInvariants({ content: content(), mealsPerDay: 1, allowedFoodIds: new Set(["food-1"]) }).ok, true);
});

test("rejects calorie/macro drift, invented food and negative values", () => {
  const plan = content();
  plan.weeklySchedule[0].totalCalories = 500;
  plan.weeklySchedule[0].protein = 10;
  plan.weeklySchedule[0].meals[0].items[0].foodId = "invented";
  plan.weeklySchedule[0].meals[0].items[0].quantity = -1;
  const result = validateNutritionPlanInvariants({ content: plan, mealsPerDay: 1, allowedFoodIds: new Set(["food-1"]) });
  assert.equal(result.ok, false);
  assert(result.violations.some((item) => item.code === "calorie_target_mismatch"));
  assert(result.violations.some((item) => item.code === "protein_target_mismatch"));
  assert(result.violations.some((item) => item.code === "invalid_food_id"));
  assert(result.violations.some((item) => item.code === "negative_or_invalid_nutrition"));
});

