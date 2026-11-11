import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveNutritionGoalForAiCoach } from "../profile_extractor";

test("AI coach uses a consistent active NutritionGoal when it is valid", () => {
  const result = resolveEffectiveNutritionGoalForAiCoach(
    {
      id: "goal-1",
      status: "ACTIVE",
      calories: 2200,
      protein: 165,
      carbs: 248,
      fat: 61,
    },
    {
      dailyCaloriesTarget: 2100,
      proteinTargetGrams: 150,
      carbTargetGrams: 240,
      fatTargetGrams: 60,
    },
  );

  assert.deepEqual(result, {
    calories: 2200,
    protein: 165,
    carbs: 248,
    fat: 61,
  });
});

test("AI coach ignores legacy inconsistent active NutritionGoal and uses active program target", () => {
  const result = resolveEffectiveNutritionGoalForAiCoach(
    {
      id: "legacy-bad-goal",
      status: "ACTIVE",
      calories: 3000,
      protein: 150,
      carbs: 200,
      fat: 65,
    },
    {
      dailyCaloriesTarget: 2200,
      proteinTargetGrams: 165,
      carbTargetGrams: 248,
      fatTargetGrams: 61,
    },
  );

  assert.deepEqual(result, {
    calories: 2200,
    protein: 165,
    carbs: 248,
    fat: 61,
  });
});

test("AI coach falls back to profile calculation when stored goal and program targets are inconsistent", () => {
  const result = resolveEffectiveNutritionGoalForAiCoach(
    {
      id: "legacy-bad-goal",
      status: "ACTIVE",
      calories: 3000,
      protein: 150,
      carbs: 200,
      fat: 65,
    },
    {
      dailyCaloriesTarget: 3000,
      proteinTargetGrams: 150,
      carbTargetGrams: 200,
      fatTargetGrams: 65,
    },
  );

  assert.equal(result, undefined);
});
