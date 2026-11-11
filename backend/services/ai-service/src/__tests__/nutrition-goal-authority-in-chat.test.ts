/**
 * Source-of-truth regression (found by the full chat verification): chat answered "Mục tiêu ngày: 2000 kcal" from the
 * profile-based estimate while the user's ACTIVE NutritionGoal said 2187 kcal. NutritionGoal owns calories/macros.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nutritionCalculator } from "../llm/nutrition_calculator";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

const base: any = { age: 22, gender: "MALE", heightCm: 178, currentWeightKg: 113.6, goal: "WEIGHT_LOSS" };

test("an ACTIVE NutritionGoal overrides the profile-derived estimate", () => {
  const t = nutritionCalculator.calculate({ ...base, nutritionGoal: { calories: 2187, protein: 193, carbs: 201, fat: 68 } }, {} as any);
  assert.equal(t.targetCalories, 2187);
  assert.equal(t.proteinGrams, 193);
  assert.equal(t.carbsGrams, 201);
  assert.equal(t.fatGrams, 68);
});

test("without a goal the fallback estimate is still produced", () => {
  const t = nutritionCalculator.calculate(base, {} as any);
  assert.ok((t.targetCalories ?? 0) > 0);
});

test("'Có chương trình tập nào ...' at message start is a program search; mid-sentence mention is not", () => {
  assert.equal(parseFitnessAgentIntent("Có chương trình tập nào cho người mới không?").kind, "PROGRAM");
  assert.notEqual(parseFitnessAgentIntent("Tôi đang tập, mà có chương trình tập nào khác thì sao?").kind, "PROGRAM");
});

import { intentRouter } from "../llm/intent_router";
test("impersonal nutrition knowledge questions are knowledge, personal/plan requests stay meal_plan_request", () => {
  for (const q of ["Macro là gì?", "Protein có vai trò gì?", "Whey protein có bắt buộc không?", "Protein bao nhiêu là đủ cho người tập tạ?", "Thâm hụt calo bao nhiêu là an toàn?"])
    assert.equal(intentRouter.route(q).intent, "general_fitness_knowledge", q);
  for (const q of ["Một ngày tôi cần bao nhiêu calo?", "Macro hiện tại của tôi là bao nhiêu?", "Tạo thực đơn giảm mỡ cho tôi", "How many calories should I eat per day?"])
    assert.equal(intentRouter.route(q).intent, "meal_plan_request", q);
});

import { detectWorkoutScheduleIntent } from "../llm/workout_schedule_context";
test("'hôm nay' inside a pure nutrition question is not a workout-schedule lookup; schedule questions still are", () => {
  assert.equal(detectWorkoutScheduleIntent("Hôm nay tôi nên ăn tối đa bao nhiêu calo?").enabled, false);
  assert.equal(detectWorkoutScheduleIntent("Hôm nay tôi tập gì?").enabled, true);
});
