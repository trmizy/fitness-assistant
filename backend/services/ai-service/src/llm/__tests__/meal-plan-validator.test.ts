/**
 * Regression test for §3.5 of the training-cycle bug report: the LLM
 * returned a mealPlanDraft where TDEE=1680, calorieTarget=1730 (claimed as
 * a "-5%" adjustment), protein=145g/carb=290g/fat=65g — whose macro energy
 * (145*4 + 290*4 + 65*9 = 2325 kcal) mismatches calorieTarget by 595 kcal.
 * The existing Zod schema (MealPlanDraftSchema) only checks each field is a
 * number — it cannot catch this. These tests lock down the deterministic
 * semantic validator/reconciler that now sits between the LLM's raw output
 * and what fitness-service/the frontend ever sees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMealPlanDraft,
  reconcileMealPlanDraft,
  CALORIE_MACRO_TOLERANCE_KCAL,
  type MealPlanDraft,
} from "../meal-plan-validator";

function draft(overrides: Partial<MealPlanDraft> = {}): MealPlanDraft {
  return {
    estimatedTDEE: 2200,
    calorieTarget: 2000,
    macros: { proteinG: 150, carbG: 200, fatG: 55 }, // 150*4+200*4+55*9 = 1895, within tolerance of 2000? |1895-2000|=105 > 50
    notes: "test",
    ...overrides,
  };
}

test("SECURITY: reproduces the exact §3.5 bug — macro energy vs calorieTarget mismatch is caught", () => {
  const buggy = draft({
    estimatedTDEE: 1680,
    calorieTarget: 1730,
    macros: { proteinG: 145, carbG: 290, fatG: 65 },
  });
  const issues = validateMealPlanDraft(buggy);
  const macroMismatch = issues.find((i) => i.code === "MACRO_CALORIE_MISMATCH");
  assert.ok(macroMismatch, "expected a MACRO_CALORIE_MISMATCH issue for the reproduced bug");
  assert.match(macroMismatch!.message, /2325/); // 145*4+290*4+65*9
});

test("reconcileMealPlanDraft corrects calorieTarget to match the stated macros, not the other way around", () => {
  const buggy = draft({
    estimatedTDEE: 1680,
    calorieTarget: 1730,
    macros: { proteinG: 145, carbG: 290, fatG: 65 },
  });
  const fixed = reconcileMealPlanDraft(buggy);
  assert.ok(fixed);
  assert.equal(fixed!.calorieTarget, 2325);
  assert.deepEqual(fixed!.macros, buggy.macros); // macros are never altered, only the target
});

test("a mealPlanDraft whose macros already match its calorieTarget within tolerance passes through unchanged", () => {
  const consistent = draft({
    calorieTarget: 1900,
    macros: { proteinG: 150, carbG: 200, fatG: 55 }, // 150*4+200*4+55*9=1895, |1895-1900|=5 <= tolerance
  });
  assert.deepEqual(validateMealPlanDraft(consistent), []);
  assert.deepEqual(reconcileMealPlanDraft(consistent), consistent);
});

test("exactly at the tolerance boundary still passes", () => {
  const atBoundary = draft({
    calorieTarget: 1895 + CALORIE_MACRO_TOLERANCE_KCAL,
    macros: { proteinG: 150, carbG: 200, fatG: 55 },
  });
  assert.deepEqual(validateMealPlanDraft(atBoundary), []);
});

test("one kcal past the tolerance boundary fails", () => {
  const pastBoundary = draft({
    calorieTarget: 1895 + CALORIE_MACRO_TOLERANCE_KCAL + 1,
    macros: { proteinG: 150, carbG: 200, fatG: 55 },
  });
  const issues = validateMealPlanDraft(pastBoundary);
  assert.ok(issues.some((i) => i.code === "MACRO_CALORIE_MISMATCH"));
});

test("implausible calorie values (e.g. a hallucinated extra digit) are flagged and unsalvageable", () => {
  const garbled = draft({ estimatedTDEE: 21800, calorieTarget: 21800, macros: { proteinG: 150, carbG: 200, fatG: 55 } });
  const issues = validateMealPlanDraft(garbled);
  assert.ok(issues.some((i) => i.code === "IMPLAUSIBLE_CALORIE_VALUE"));
  assert.equal(reconcileMealPlanDraft(garbled), null);
});

test("negative macro grams are flagged and unsalvageable", () => {
  const negative = draft({ macros: { proteinG: -10, carbG: 200, fatG: 55 } });
  const issues = validateMealPlanDraft(negative);
  assert.ok(issues.some((i) => i.code === "NEGATIVE_MACRO"));
  assert.equal(reconcileMealPlanDraft(negative), null);
});
