/**
 * Deterministic Atwater-conversion consistency check for a NutritionGoal
 * save (PUT /nutrition/goals). Root-cause context: the AI-nutrition bug
 * report's exact reproduction case is a stored goal of 3000 kcal / 150g
 * protein / 200g carb / 65g fat — whose macros (150*4 + 200*4 + 65*9 =
 * 1985 kcal) don't actually add up to 1985 kcal, not 3000 — being saved
 * and displayed with no warning. This mirrors the existing pattern already
 * used for the LLM-generated cycle-assessment mealPlanDraft
 * (ai-service/src/llm/meal-plan-validator.ts) — same tolerance, same
 * Atwater constants — applied here to the user-facing/PT-facing
 * NutritionGoal save path instead.
 */

export const ATWATER_KCAL_PER_GRAM = { protein: 4, carb: 4, fat: 9 } as const;

// PRODUCT_HEURISTIC: matches ai-service's meal-plan-validator.ts tolerance —
// roughly one typical gram-rounding slip, not a clinically-derived number.
export const MACRO_CALORIE_TOLERANCE_KCAL = 50;

export interface NutritionGoalMacroCheck {
  statedCalories: number;
  computedCalories: number;
  discrepancyKcal: number;
  consistent: boolean;
}

export function checkNutritionGoalMacroConsistency(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  toleranceKcal: number = MACRO_CALORIE_TOLERANCE_KCAL,
): NutritionGoalMacroCheck {
  const computedCalories =
    protein * ATWATER_KCAL_PER_GRAM.protein +
    carbs * ATWATER_KCAL_PER_GRAM.carb +
    fat * ATWATER_KCAL_PER_GRAM.fat;
  const discrepancyKcal = Math.round(computedCalories - calories);
  return {
    statedCalories: calories,
    computedCalories: Math.round(computedCalories),
    discrepancyKcal,
    consistent: Math.abs(discrepancyKcal) <= toleranceKcal,
  };
}
