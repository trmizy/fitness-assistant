/**
 * AI Nutrition Cycle Engine (Gymini) — spec §XIII/§XXXVII: UserProfile's
 * budget-level preference, used by fitness-service's
 * nutrition-food-suggestion.engine.ts and ai-service's meal-plan generator.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../models/profile.models";

test("profileSchema: accepts each valid nutritionBudgetLevel value", () => {
  for (const value of ["LOW", "NORMAL", "FLEXIBLE"] as const) {
    const result = profileSchema.safeParse({ nutritionBudgetLevel: value });
    assert.equal(result.success, true, `expected ${value} to be accepted`);
    if (result.success) assert.equal(result.data.nutritionBudgetLevel, value);
  }
});

test("profileSchema: nutritionBudgetLevel is optional — omitting it still validates", () => {
  const result = profileSchema.safeParse({ age: 25 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.nutritionBudgetLevel, undefined);
});

test("profileSchema: rejects an invalid nutritionBudgetLevel value", () => {
  const result = profileSchema.safeParse({ nutritionBudgetLevel: "CHEAP" });
  assert.equal(result.success, false);
});
