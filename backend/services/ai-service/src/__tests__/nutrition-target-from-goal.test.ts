/**
 * P1 regression (2026-11-11, adjust eval): nutrition plans generated/adjusted without an explicit calorie target used a
 * hard-coded 2200 kcal instead of the user's ACTIVE NutritionGoal (all three eval personas got 2200 although their goals
 * were 2370 / 1874 / 1253 kcal). NutritionGoal is the authoritative prescription.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileExtractor } from "../llm/profile_extractor";
import { resolveNutritionTargets } from "../controllers/plan.controller";

async function withGoal<T>(goal: unknown, fetchFailed: boolean, fn: () => Promise<T>): Promise<T> {
  const orig = profileExtractor.extract;
  profileExtractor.extract = (async () => ({ profile: { nutritionGoal: goal }, nutritionGoalFetchFailed: fetchFailed })) as any;
  try { return await fn(); } finally { profileExtractor.extract = orig; }
}

test("no calorie target typed -> the ACTIVE NutritionGoal's calories and macros are used", async () => {
  const r = await withGoal({ calories: 1253, protein: 116, carbs: 105, fat: 41 }, false, () => resolveNutritionTargets("u1", "Bearer x", {}));
  assert.deepEqual(r, { dailyCaloriesTarget: 1253, proteinTargetG: 116, carbTargetG: 105, fatTargetG: 41, source: "nutrition_goal" });
});

test("a calorie target the user typed is kept (nothing is filled in)", async () => {
  const r = await withGoal({ calories: 1253, protein: 116, carbs: 105, fat: 41 }, false, () => resolveNutritionTargets("u1", "Bearer x", { dailyCaloriesTarget: 1800 }));
  assert.deepEqual(r, { source: "user" });
});

test("adjustment with no active goal falls back to the original plan's own target, never to 2200", async () => {
  const fallback = { dailyCaloriesTarget: 1900, proteinTargetG: 120, carbTargetG: 210, fatTargetG: 60 };
  const absent = await withGoal(undefined, false, () => resolveNutritionTargets("u1", undefined, {}, fallback));
  assert.deepEqual(absent, { ...fallback, source: "original_plan" });
  const failed = await withGoal(undefined, true, () => resolveNutritionTargets("u1", undefined, {}, fallback));
  assert.equal(failed.source, "original_plan");
});

test("nothing known -> no target is invented here (the caller keeps the old behaviour)", async () => {
  const r = await withGoal(undefined, false, () => resolveNutritionTargets("u1", undefined, {}));
  assert.deepEqual(r, { source: "none" });
});
