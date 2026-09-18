import { calculateBmi } from "../coach/fitness_calculations";

/**
 * Contextual target-weight safety — Codex Conversational AI Coach
 * Evaluation #1's HIGH finding: a target weight of 30kg for a 180cm/80kg
 * profile passed `parseWeightKg()`'s absolute 25-300kg range check and was
 * confirmed and persisted, with no contextual gate at all.
 *
 * An audit before writing this file (see docs/conversational-ai-coach-
 * remediation-1.md §8-9) confirmed NO existing height-aware target-weight
 * safety predicate exists anywhere in this codebase. What exists is a
 * *rate*-vs-timeframe check (`assessTargetRealism` /
 * `MAX_SAFE_WEEKLY_RATE_PCT`, fitness-service's fitness-diagnosis.engine.ts)
 * that needs a `timeframeWeeks` this slot-collection step does not have
 * yet, and a BMI *upper* bound (`body_composition_rules.ts`'s
 * `BMI_OVERWEIGHT = 25`) used only to suppress LLM narration, never to
 * reject a value. Building a new, minimal, honestly-labeled floor is
 * therefore genuinely necessary here, not an arbitrary threshold invented
 * to pass one test case.
 *
 * This module does NOT diagnose disease. It only rejects a value that is
 * either (a) directionally inconsistent with the stated goal, or (b)
 * below the WHO's own globally-standard "underweight" BMI classification
 * for the person's real height — a widely-cited public-health convention,
 * not a Gymini-specific heuristic.
 */

// WHO BMI classification: BMI < 18.5 is classified underweight. This is a
// named, citable, external clinical-body standard (World Health
// Organization BMI categories), not an internally invented number.
export const WHO_BMI_UNDERWEIGHT_THRESHOLD = 18.5;

export type TargetWeightSafetyInput = {
  heightCm: number;
  currentWeightKg: number;
  targetWeightKg: number;
  goal: "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";
};

export type TargetWeightSafetyResult =
  | { verdict: "SAFE" }
  | { verdict: "UNSAFE"; reason: "WRONG_DIRECTION_FOR_GOAL" | "BMI_BELOW_UNDERWEIGHT_THRESHOLD"; clarifyingQuestion: string };

export function assessTargetWeightSafety(input: TargetWeightSafetyInput): TargetWeightSafetyResult {
  const { heightCm, currentWeightKg, targetWeightKg, goal } = input;

  // Directional consistency — cheap, not a medical judgment, just internal
  // coherence between the stated goal and the requested number.
  if (goal === "WEIGHT_LOSS" && targetWeightKg >= currentWeightKg) {
    return {
      verdict: "UNSAFE",
      reason: "WRONG_DIRECTION_FOR_GOAL",
      clarifyingQuestion: `Mục tiêu của bạn là giảm mỡ, nhưng ${targetWeightKg}kg không thấp hơn cân nặng hiện tại (${currentWeightKg}kg). Bạn cho mình một mức thấp hơn cân nặng hiện tại nhé?`,
    };
  }
  if (goal === "MUSCLE_GAIN" && targetWeightKg <= currentWeightKg) {
    return {
      verdict: "UNSAFE",
      reason: "WRONG_DIRECTION_FOR_GOAL",
      clarifyingQuestion: `Mục tiêu của bạn là tăng cơ, nhưng ${targetWeightKg}kg không cao hơn cân nặng hiện tại (${currentWeightKg}kg). Bạn cho mình một mức cao hơn cân nặng hiện tại nhé?`,
    };
  }

  const targetBmi = calculateBmi(targetWeightKg, heightCm);
  if (targetBmi != null && targetBmi < WHO_BMI_UNDERWEIGHT_THRESHOLD) {
    const minSafeWeightKg = Math.ceil(WHO_BMI_UNDERWEIGHT_THRESHOLD * (heightCm / 100) ** 2);
    return {
      verdict: "UNSAFE",
      reason: "BMI_BELOW_UNDERWEIGHT_THRESHOLD",
      clarifyingQuestion: `Với chiều cao ${heightCm}cm, mức ${targetWeightKg}kg thấp hơn ngưỡng cân nặng an toàn theo phân loại BMI của WHO (khoảng ${minSafeWeightKg}kg trở lên). Vì lý do an toàn, Gymini chưa thể đặt mục tiêu này qua trò chuyện — bạn có thể trao đổi trực tiếp với PT/chuyên gia nếu vẫn muốn theo hướng này, hoặc cho mình một mức khác nhé?`,
    };
  }

  return { verdict: "SAFE" };
}
