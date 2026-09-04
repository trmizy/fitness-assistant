import type { MealPlanDraftSchema } from "../schemas/cycle-analysis.schemas";
import type { z } from "zod";

export type MealPlanDraft = z.infer<typeof MealPlanDraftSchema>;

/**
 * Semantic (not just type-level) validation for the LLM's mealPlanDraft.
 * Reproduced bug (§3.5 of the training-cycle bug report): the LLM returned
 * TDEE=1680, calorieTarget=1730 ("-5%" adjustment claimed) with
 * macros protein=145g/carb=290g/fat=65g — whose energy content is
 * 145*4+290*4+65*9=2325 kcal, a 595 kcal mismatch against the stated
 * target, and a target HIGHER than TDEE despite a claimed cut. Zod's
 * `MealPlanDraftSchema` only checks each field is a number — it has no way
 * to catch either problem. The LLM must never be trusted to do this
 * arithmetic itself (see the "code tính số liệu, LLM chỉ diễn giải"
 * principle already used elsewhere in this codebase for the Decision
 * Engine) — this module is the deterministic check + correction.
 */

/** kcal/g constants (protein/carb 4, fat 9) — standard Atwater factors, not
 * a per-product tunable. */
function macroEnergyKcal(macros: MealPlanDraft["macros"]): number {
  return macros.proteinG * 4 + macros.carbG * 4 + macros.fatG * 9;
}

/** Absolute tolerance between stated calorieTarget and what its own macros
 * actually add up to. 50 kcal is roughly one typical rounding/unit-of-food
 * slip (e.g. one macro rounded to the nearest 5g) — anything wider means
 * the numbers don't actually describe the same plan. */
export const CALORIE_MACRO_TOLERANCE_KCAL = 50;

/** Sane absolute bounds for an adult daily calorie figure — product safety
 * rails against a garbled/hallucinated number (e.g. a stray extra digit),
 * not a personalized medical minimum/maximum. */
export const MIN_PLAUSIBLE_CALORIES = 800;
export const MAX_PLAUSIBLE_CALORIES = 6000;

export interface MealPlanValidationIssue {
  code: "MACRO_CALORIE_MISMATCH" | "IMPLAUSIBLE_CALORIE_VALUE" | "NEGATIVE_MACRO";
  message: string;
}

export function validateMealPlanDraft(draft: MealPlanDraft): MealPlanValidationIssue[] {
  const issues: MealPlanValidationIssue[] = [];

  if (draft.macros.proteinG < 0 || draft.macros.carbG < 0 || draft.macros.fatG < 0) {
    issues.push({ code: "NEGATIVE_MACRO", message: "Macro grams cannot be negative." });
  }

  for (const [label, value] of [
    ["estimatedTDEE", draft.estimatedTDEE],
    ["calorieTarget", draft.calorieTarget],
  ] as const) {
    if (!Number.isFinite(value) || value < MIN_PLAUSIBLE_CALORIES || value > MAX_PLAUSIBLE_CALORIES) {
      issues.push({
        code: "IMPLAUSIBLE_CALORIE_VALUE",
        message: `${label}=${value} is outside the plausible range [${MIN_PLAUSIBLE_CALORIES}, ${MAX_PLAUSIBLE_CALORIES}] kcal.`,
      });
    }
  }

  const macroEnergy = macroEnergyKcal(draft.macros);
  if (Math.abs(macroEnergy - draft.calorieTarget) > CALORIE_MACRO_TOLERANCE_KCAL) {
    issues.push({
      code: "MACRO_CALORIE_MISMATCH",
      message: `Macros (P${draft.macros.proteinG}g/C${draft.macros.carbG}g/F${draft.macros.fatG}g = ${macroEnergy} kcal) do not match calorieTarget=${draft.calorieTarget} kcal (tolerance ${CALORIE_MACRO_TOLERANCE_KCAL} kcal).`,
    });
  }

  return issues;
}

/**
 * Deterministically reconciles a mealPlanDraft that fails validateMealPlanDraft.
 * Macros are the more granular, directly-checkable number (grams of each
 * macronutrient) — so on a mismatch, calorieTarget is recomputed FROM the
 * macros (never the other way around: the LLM must not be trusted to pick
 * which of its own two numbers was "right"). Returns null when the draft is
 * unsalvageable (implausible calorie bounds or negative macros) — callers
 * must fall back to a safe deterministic default rather than show this to
 * the user.
 */
export function reconcileMealPlanDraft(draft: MealPlanDraft): MealPlanDraft | null {
  const issues = validateMealPlanDraft(draft);
  const fatal = issues.some((i) => i.code === "IMPLAUSIBLE_CALORIE_VALUE" || i.code === "NEGATIVE_MACRO");
  if (fatal) return null;

  const mismatch = issues.some((i) => i.code === "MACRO_CALORIE_MISMATCH");
  if (!mismatch) return draft;

  return {
    ...draft,
    calorieTarget: Math.round(macroEnergyKcal(draft.macros)),
  };
}
