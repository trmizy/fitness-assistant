import type { NutritionPlanContent } from "../schemas/nutrition-plan.schemas";

export type NutritionViolation = { code: string; path: string; actual?: unknown; expected?: unknown };

export function validateNutritionPlanInvariants(input: {
  content: NutritionPlanContent;
  mealsPerDay: number;
  allowedFoodIds: Set<string>;
  calorieTolerancePct?: number;
  macroTolerancePct?: number;
}): { ok: boolean; violations: NutritionViolation[] } {
  const calorieTolerance = input.calorieTolerancePct ?? 0.2;
  const macroTolerance = input.macroTolerancePct ?? 0.35;
  const violations: NutritionViolation[] = [];
  const plan = input.content;

  if (plan.durationWeeks !== 1 || plan.weeklySchedule.length !== 7) {
    violations.push({ code: "invalid_week_structure", path: "weeklySchedule" });
  }

  const within = (actual: number, expected: number, tolerance: number) =>
    expected > 0 && Math.abs(actual - expected) / expected <= tolerance;

  plan.weeklySchedule.forEach((day, dayIndex) => {
    const path = `weeklySchedule.${dayIndex}`;
    if (day.meals.length !== input.mealsPerDay) {
      violations.push({ code: "meal_count_mismatch", path: `${path}.meals`, actual: day.meals.length, expected: input.mealsPerDay });
    }
    if (!within(day.totalCalories, plan.dailyCaloriesTarget, calorieTolerance)) {
      violations.push({ code: "calorie_target_mismatch", path: `${path}.totalCalories`, actual: day.totalCalories, expected: plan.dailyCaloriesTarget });
    }
    for (const [field, actual, expected] of [
      ["protein", day.protein, plan.proteinTargetGrams],
      ["carbs", day.carbs, plan.carbTargetGrams],
      ["fat", day.fat, plan.fatTargetGrams],
    ] as const) {
      if (!within(actual, expected, macroTolerance)) {
        violations.push({ code: `${field}_target_mismatch`, path: `${path}.${field}`, actual, expected });
      }
    }
    day.meals.forEach((meal, mealIndex) => {
      meal.items.forEach((item, itemIndex) => {
        const itemPath = `${path}.meals.${mealIndex}.items.${itemIndex}`;
        if (!item.foodId || !input.allowedFoodIds.has(item.foodId)) {
          violations.push({ code: "invalid_food_id", path: `${itemPath}.foodId`, actual: item.foodId });
        }
        for (const field of ["quantity", "calories", "protein", "carbs", "fat"] as const) {
          if (!Number.isFinite(item[field]) || item[field] < 0) {
            violations.push({ code: "negative_or_invalid_nutrition", path: `${itemPath}.${field}`, actual: item[field] });
          }
        }
      });
    });
  });

  return { ok: violations.length === 0, violations };
}

