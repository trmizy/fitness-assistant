import test from "node:test";
import assert from "node:assert/strict";
import { parseStatedNutritionTargets, inputParser } from "../llm/input_parser";
import { nutritionCalculator } from "../llm/nutrition_calculator";

/** Found by the persona journey evaluation: "thực đơn bulking sạch khoảng 3200 kcal, protein 180g" was answered with 3157 kcal / 141 g, and
 *  "cắt mỡ 8 tuần" for a muscle-gain profile was answered as a bulk (2792 kcal). */
const profile: any = { gender: "MALE", age: 36, heightCm: 180, currentWeightKg: 88, activityLevel: "VERY_ACTIVE", experienceLevel: "ADVANCED", goal: "ATHLETIC_PERFORMANCE" };

test("explicit calorie / protein numbers are read (with separators and either language)", () => {
  assert.deepEqual(parseStatedNutritionTargets("cho toi thuc don bulking sach khoang 3200 kcal, protein 180g"), { statedCalories: 3200, statedProteinGrams: 180 });
  assert.deepEqual(parseStatedNutritionTargets("an 2.400 calo va 150g dam"), { statedCalories: 2400, statedProteinGrams: 150 });
  assert.deepEqual(parseStatedNutritionTargets("toi 88kg, tap 8 nam"), {});
});

test("a stated target wins inside safe bounds and the macros stay consistent", () => {
  const intent = inputParser.parse("Cho tôi thực đơn bulking sạch khoảng 3200 kcal, protein 180g", profile);
  const t = nutritionCalculator.calculate(profile, intent);
  assert.equal(t.targetCalories, 3200);
  assert.equal(t.proteinGrams, 180);
  const kcal = (t.proteinGrams ?? 0) * 4 + (t.carbsGrams ?? 0) * 4 + (t.fatGrams ?? 0) * 9;
  assert.ok(Math.abs(kcal - 3200) <= 12, `macros add up to ${kcal}`);
});

test("an unsafe stated target is ignored (the computed value stays)", () => {
  const base = nutritionCalculator.calculate(profile, inputParser.parse("thuc don cho toi", profile));
  const t = nutritionCalculator.calculate(profile, inputParser.parse("thuc don 600 kcal, protein 400g", profile));
  assert.equal(t.targetCalories, base.targetCalories);
  assert.equal(t.proteinGrams, base.proteinGrams);
});

test("'cắt mỡ' states a fat-loss goal even when the profile says muscle gain", () => {
  const mg: any = { ...profile, goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", currentWeightKg: 72, heightCm: 174, age: 29 };
  const intent = inputParser.parse("Tôi muốn cắt mỡ 8 tuần mà vẫn giữ cơ, cần ăn bao nhiêu calo và protein?", mg);
  assert.equal(intent.goalHint, "fat_loss");
  const t = nutritionCalculator.calculate(mg, intent);
  assert.ok((t.deficitOrSurplusKcal ?? 0) < 0, "a deficit, not a surplus");
});

import { recommendationEngine } from "../llm/recommendation_engine";

/** A user WITH a saved NutritionGoal (the common case: onboarding creates one). The saved goal stays authoritative for ordinary questions, but
 *  an explicit request for other numbers / another goal is answered as a what-if and never overwrites the goal. */
const withGoal: any = { ...profile, goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", currentWeightKg: 72, heightCm: 174, age: 29, nutritionGoal: { calories: 2792, protein: 137, carbs: 386, fat: 78 }, training: { trainingDaysPerWeek: 4, availableEquipment: ["barbell", "dumbbell"], injuries: [], preferredTrainingDays: [1, 2, 4, 5] } };

test("saved NutritionGoal stays authoritative for an ordinary nutrition question", () => {
  const rec = recommendationEngine.recommend(withGoal, inputParser.parse("Thực đơn hôm nay của tôi thế nào?", withGoal), "vi");
  assert.equal(rec.mealPlan?.kcal, 2792);
  assert.notEqual(rec.mealPlan?.whatIf, true);
});

test("asking for other numbers is a what-if: the meal plan shows THEM and says the saved goal is untouched", () => {
  const rec = recommendationEngine.recommend(withGoal, inputParser.parse("Cho tôi thực đơn bulking sạch khoảng 3200 kcal, protein 180g", withGoal), "vi");
  assert.equal(rec.mealPlan?.kcal, 3200);
  assert.equal(rec.mealPlan?.proteinGrams, 180);
  assert.equal(rec.mealPlan?.whatIf, true);
  assert.equal(withGoal.nutritionGoal.calories, 2792, "the saved goal object is not modified");
});

test("naming a different goal ('cắt mỡ') is a what-if with a deficit, not the saved surplus", () => {
  const rec = recommendationEngine.recommend(withGoal, inputParser.parse("Tôi muốn cắt mỡ 8 tuần mà vẫn giữ cơ, cần ăn bao nhiêu calo và protein?", withGoal), "vi");
  assert.equal(rec.mealPlan?.whatIf, true);
  assert.ok((rec.mealPlan?.kcal ?? 9999) < 2792, `kcal ${rec.mealPlan?.kcal}`);
});
