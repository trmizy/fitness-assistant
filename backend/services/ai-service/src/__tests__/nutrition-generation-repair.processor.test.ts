/**
 * Golden + integration tests for the deterministic nutrition repair, through the REAL processNutritionPlanJob
 * (real builder, real repair, real invariant, real exclusion gate). Only the HTTP food catalog, the LLM call and the
 * plan-row writes are stubbed (same isolation as nutrition-food-exclusion.test.ts). No DB.
 *
 * Golden fixtures are SANITIZED captures of real qwen3:30b-a3b-instruct-2507-q4_K_M answers
 * (fixtures/nutrition-30b-*.json; no prompts, user ids or provider metadata).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { conversationRepository } from "../repositories/conversation.repository";
import { llmService } from "../services/llm.service";
import { processNutritionPlanJob, buildNutritionPlanFromTemplate, parseNutritionTemplate } from "../services/nutrition.processor";
import { validateNutritionPlanInvariants } from "../services/nutrition-plan-invariant.service";
import { findExclusionViolations } from "../services/nutrition-food-constraints";

const load = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const failed3 = load("nutrition-30b-3meal-failed.json");
const valid4 = load("nutrition-30b-4meal-valid.json");

async function runJob(fx: { foods: any[]; llmTemplateAnswer: string }, jobData: Record<string, unknown>) {
  const orig = {
    get: axios.get, call: llmService.callLLM,
    status: conversationRepository.updateNutritionPlanStatus,
    complete: conversationRepository.updateNutritionPlanCompletion,
    failed: conversationRepository.updateNutritionPlanFailed,
  };
  let completed: any = null; let failure: string | null = null; let llmCalls = 0;
  try {
    axios.get = (async (url: string) => {
      if (url.includes("for-ai-nutrition")) return { data: { success: true, data: { foods: fx.foods } } };
      throw new Error("isolated fixture: optional worker context unavailable");
    }) as any;
    llmService.callLLM = (async () => { llmCalls += 1; return { answer: fx.llmTemplateAnswer }; }) as any;
    conversationRepository.updateNutritionPlanStatus = (async () => ({})) as any;
    conversationRepository.updateNutritionPlanCompletion = (async (_id: string, c: any) => { completed = c; return {}; }) as any;
    conversationRepository.updateNutritionPlanFailed = (async (_id: string, reason: string) => { failure = reason; return {}; }) as any;
    await processNutritionPlanJob({ id: "fixture", data: { planId: randomUUID(), userId: `repair-${randomUUID()}`, goal: "WEIGHT_LOSS", durationWeeks: 1, ...jobData } } as any);
  } finally {
    axios.get = orig.get; llmService.callLLM = orig.call;
    conversationRepository.updateNutritionPlanStatus = orig.status;
    conversationRepository.updateNutritionPlanCompletion = orig.complete;
    conversationRepository.updateNutritionPlanFailed = orig.failed;
  }
  return { completed, failure, llmCalls };
}
const jobFor = (fx: any) => ({ mealsPerDay: fx.mealsPerDay, dailyCaloriesTarget: fx.dailyCaloriesTarget, proteinTargetG: fx.proteinTargetG, carbTargetG: fx.carbTargetG, fatTargetG: fx.fatTargetG, excludedFoodKeys: fx.excludedFoodKeys });
const builderOutput = (fx: any) => {
  const parsed = parseNutritionTemplate(fx.llmTemplateAnswer);
  assert.equal(parsed.ok, true);
  return buildNutritionPlanFromTemplate({ goal: "WEIGHT_LOSS", mealsPerDay: fx.mealsPerDay, dailyCaloriesTarget: fx.dailyCaloriesTarget, template: (parsed as any).template, allowedFoods: fx.foods, proteinTargetG: fx.proteinTargetG, carbTargetG: fx.carbTargetG, fatTargetG: fx.fatTargetG });
};
const inv = (content: any, meals: number, foods: any[]) => validateNutritionPlanInvariants({ content, mealsPerDay: meals, allowedFoodIds: new Set(foods.map((f) => String(f.id))) });

test("GOLDEN (real qwen3:30b 3-meal output): the builder alone FAILS the invariant (fat + calories)", () => {
  const before = builderOutput(failed3);
  const r = inv(before, 3, failed3.foods);
  assert.equal(r.ok, false);
  const codes = new Set(r.violations.map((v) => v.code));
  assert.ok(codes.has("fat_target_mismatch"));
  assert.ok(before.weeklySchedule[0].fat > 55 * 1.35, `day-1 fat ${before.weeklySchedule[0].fat} g vs target 55`);
});

test("GOLDEN through the REAL processor: the same output now COMPLETES — 3 meals/day, targets unchanged, invariant passes, no fish/beef, no LLM retry", async () => {
  const { completed, failure, llmCalls } = await runJob(failed3, jobFor(failed3));
  assert.equal(failure, null, String(failure));
  assert.ok(completed, "plan must complete");
  assert.equal(llmCalls, 1, "repair is deterministic: no extra LLM call");
  assert.equal(inv(completed, 3, failed3.foods).ok, true);
  assert.ok(completed.weeklySchedule.every((d: any) => d.meals.length === 3), "meal count preserved");
  assert.deepEqual([completed.dailyCaloriesTarget, completed.proteinTargetGrams, completed.carbTargetGrams, completed.fatTargetGrams], [1992, 128, 246, 55], "authoritative targets unchanged");
  assert.equal(findExclusionViolations(completed, ["fish", "beef"]).length, 0);
  const before = builderOutput(failed3);
  const foodsBefore = (c: any) => new Set(c.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.foodId))));
  const after = foodsBefore(completed);
  for (const id of after) assert.ok(foodsBefore(before).has(id), "repair introduced a food that was not in the plan");
});

test("no-op through the processor: an already-valid 4-meal 30B plan is persisted EXACTLY as the builder produced it", async () => {
  const expected = builderOutput(valid4);
  assert.equal(inv(expected, 4, valid4.foods).ok, true);
  const { completed, failure } = await runJob(valid4, jobFor(valid4));
  assert.equal(failure, null, String(failure));
  assert.deepEqual(completed, expected);
});

test("impossible repair through the processor still FAILS CLOSED with the real constraint failure (no invalid plan persisted)", async () => {
  const oneFood = {
    foods: [{ id: "pb", name: "Peanut butter", calories: 588, protein: 25, carbs: 20, fat: 50 }],
    llmTemplateAnswer: JSON.stringify({ meals: [{ mealType: "BREAKFAST", title: "PB", items: [{ foodId: "pb", quantity: 30 }] }] }),
  };
  const { completed, failure } = await runJob(oneFood, { mealsPerDay: 3, dailyCaloriesTarget: 1992, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55, excludedFoodKeys: [] });
  assert.equal(completed, null, "must not persist an unrepairable plan");
  assert.match(String(failure), /Nutrition plan constraint failure/);
});

test("repair does not weaken exclusions: excluding the food the plan needs still fails, and never resurrects it", async () => {
  const withOil = {
    foods: [
      { id: "chicken", name: "Chicken breast", calories: 165, protein: 31, carbs: 0, fat: 4 },
      { id: "rice", name: "Rice cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      { id: "salmon", name: "Salmon, Atlantic, farmed", calories: 208, protein: 20, carbs: 0, fat: 13 },
    ],
    llmTemplateAnswer: JSON.stringify({ meals: [{ mealType: "BREAKFAST", title: "Gà", items: [{ foodId: "salmon", quantity: 150 }] }] }),
  };
  const { completed } = await runJob(withOil, { mealsPerDay: 3, dailyCaloriesTarget: 1992, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55, excludedFoodKeys: ["fish"] });
  const names: string[] = completed ? completed.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.name))) : [];
  assert.equal(names.filter((n) => /salmon|fish/i.test(n)).length, 0);
});
