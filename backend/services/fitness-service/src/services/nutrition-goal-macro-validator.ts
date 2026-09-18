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
 *
 * Calorie-floor audit (2026-09-07): found three DIFFERENT "minimum
 * calories" numbers live in this codebase — the deterministic engines'
 * 1200 (cycleThresholds.nutritionAdaptive.minPrescriptionCalories, "a
 * basic safety rail, not a clinical minimum"), a hardcoded, uncommented
 * 800 in the PT-modify Zod schema, and NO floor at all on the client's own
 * manual goal edit (PUT /nutrition/goals only checked `.positive()`) — so
 * a client, or a PT acting for a client, could save an arbitrarily low
 * (even single-digit) calorie target through those two direct-entry paths
 * while the AI-derived paths were the only ones actually protected. Fixed
 * by having every direct-entry path (client self-edit, PT modify) share
 * this ONE floor check, reusing the existing 1200 constant rather than
 * inventing a new number — see assertCalorieFloor below.
 */
import { cycleThresholds } from "../config/cycle-thresholds.config";

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

/** Throws a 400 (never silently clamps — this is an EXPLICIT client/PT-
 * typed number, not an internal engine computation; silently overriding
 * what someone actually typed would desync their intent from what got
 * saved, the same reasoning checkNutritionGoalMacroConsistency above
 * already applies to a macro mismatch). The bootstrap/adaptive ENGINES'
 * own `Math.max(floor, targetCalories)` clamp is a different, still-
 * correct pattern for a number THEY computed, not one a person entered. */
export function assertCalorieFloor(calories: number, context: "CLIENT" | "PT"): void {
  const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
  if (calories >= floor) return;
  const message =
    context === "PT"
      ? `Mục tiêu ${calories} kcal thấp hơn mức an toàn tối thiểu (${floor} kcal). Nếu đây là chỉ định có giám sát y tế đặc biệt, vui lòng liên hệ đội ngũ kỹ thuật — hệ thống hiện chưa hỗ trợ vượt sàn này.`
      : `Mục tiêu ${calories} kcal thấp hơn mức an toàn tối thiểu (${floor} kcal/ngày). Vui lòng đặt mục tiêu cao hơn, hoặc trao đổi với PT/bác sĩ nếu bạn thực sự cần một mức thấp hơn.`;
  throw {
    status: 400,
    message,
    code: "NUTRITION_GOAL_BELOW_SAFETY_FLOOR",
    minCalories: floor,
  };
}
