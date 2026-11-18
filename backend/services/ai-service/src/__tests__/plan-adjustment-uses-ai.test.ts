/**
 * Audit 2026-11-11 ("Giải thích / Điều chỉnh phải dùng AI"):
 *  1. The nutrition "Điều chỉnh" text (POST /plans/nutrition/:id/adjust -> job.notes) was stripped by the job schema, so the model
 *     never saw what the user asked for. It must now reach the prompt.
 *  2. A workout "Điều chỉnh" job must never be completed by the deterministic catalog fallback (which ignores the request);
 *     when the model fails, the adjustment fails honestly.
 * Real processNutritionPlanJob; only the HTTP food catalog, the LLM call and plan-row writes are stubbed. No DB.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { conversationRepository } from "../repositories/conversation.repository";
import { llmService } from "../services/llm.service";
import { processNutritionPlanJob } from "../services/nutrition.processor";
import { ADJUSTMENT_FAILED_MESSAGE_VI } from "../workers/ai.worker";

const foods = [
  { id: "chicken", name: "Chicken breast", calories: 165, protein: 31, carbs: 0, fat: 4 },
  { id: "rice", name: "Rice cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: "egg", name: "Egg, whole, cooked", calories: 155, protein: 13, carbs: 1.1, fat: 11 },
  { id: "broccoli", name: "Broccoli, cooked", calories: 35, protein: 2.4, carbs: 7, fat: 0.4 },
  { id: "oats", name: "Oats, dry", calories: 379, protein: 13, carbs: 67, fat: 6.5 },
];

async function capturePrompt(jobData: Record<string, unknown>): Promise<string> {
  const orig = {
    get: axios.get, call: llmService.callLLM,
    status: conversationRepository.updateNutritionPlanStatus,
    complete: conversationRepository.updateNutritionPlanCompletion,
    failed: conversationRepository.updateNutritionPlanFailed,
  };
  const prompts: string[] = [];
  try {
    axios.get = (async (url: string) => {
      if (url.includes("for-ai-nutrition")) return { data: { success: true, data: { foods } } };
      throw new Error("isolated fixture: optional worker context unavailable");
    }) as any;
    llmService.callLLM = (async (prompt: string) => {
      prompts.push(prompt);
      return { answer: JSON.stringify({ meals: [{ mealType: "BREAKFAST", title: "Gà", items: [{ foodId: "chicken", quantity: 150 }] }] }) };
    }) as any;
    conversationRepository.updateNutritionPlanStatus = (async () => ({})) as any;
    conversationRepository.updateNutritionPlanCompletion = (async () => ({})) as any;
    conversationRepository.updateNutritionPlanFailed = (async () => ({})) as any;
    await processNutritionPlanJob({
      id: "fixture", data: { planId: randomUUID(), userId: `adj-${randomUUID()}`, goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: 3, ...jobData },
    } as any);
  } finally {
    axios.get = orig.get; llmService.callLLM = orig.call;
    conversationRepository.updateNutritionPlanStatus = orig.status;
    conversationRepository.updateNutritionPlanCompletion = orig.complete;
    conversationRepository.updateNutritionPlanFailed = orig.failed;
  }
  return prompts[0] ?? "";
}

test("nutrition adjustment: the user's request text reaches the model's prompt", async () => {
  const prompt = await capturePrompt({ notes: "Điều chỉnh từ kế hoạch trước: bữa sáng nhẹ hơn, thêm nhiều rau xanh" });
  assert.match(prompt, /Yêu cầu riêng của người dùng/);
  assert.match(prompt, /bữa sáng nhẹ hơn, thêm nhiều rau xanh/);
});

test("nutrition generation without an adjustment adds no request line", async () => {
  const prompt = await capturePrompt({});
  assert.ok(prompt.length > 0, "the model must have been called");
  assert.doesNotMatch(prompt, /Yêu cầu riêng của người dùng/);
});

test("workout adjustment: catalog fallbacks are guarded off for adjustment jobs, with an honest failure message", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "workers", "ai.worker.ts"), "utf8");
  assert.match(src, /isRecoverablePlanLlmTimeout\(err\) && !isAdjustmentJob/);
  assert.match(src, /if \(!parseResult\.ok && !isAdjustmentJob\)/);
  assert.match(ADJUSTMENT_FAILED_MESSAGE_VI, /Kế hoạch cũ vẫn giữ nguyên/);
});
