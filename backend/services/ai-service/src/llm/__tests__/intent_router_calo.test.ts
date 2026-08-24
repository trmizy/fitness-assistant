/**
 * Real bug found via E2E testing: a message with the Vietnamese "calo"
 * (e.g. "hãy ước tính calo duy trì cho tôi") did NOT match
 * intent_router.ts's meal_plan_request regex, which only checked the
 * English "calories" (plural, with 's') — so the message fell through to
 * "general_fitness_knowledge", whose prompt instructs the LLM to refuse
 * off-topic questions. The local model then misjudged a legitimate
 * calorie-estimation request as off-topic and refused it (observed in
 * fitnessassistant-playwright-e2e/tests/21-ai-nutrition-chat-routing.spec.ts
 * TC-AI-NUTRITION-05). Fixed by adding "calo" as its own alternative
 * (word-boundary, so it doesn't accidentally match "calories" twice or an
 * unrelated word).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { intentRouter } from "../intent_router";

test("BUG: a bare Vietnamese 'calo' (no 's') routes to meal_plan_request, not general_fitness_knowledge", () => {
  const result = intentRouter.route(
    "Bỏ qua dữ liệu cân nặng đã lưu. Cân nặng của tôi bây giờ là 76kg, hãy ước tính calo duy trì cho tôi.",
  );
  assert.equal(result.intent, "meal_plan_request");
});

test("English 'calories' still routes to meal_plan_request (no regression)", () => {
  const result = intentRouter.route("How many calories should I eat per day?");
  assert.equal(result.intent, "meal_plan_request");
});

test("bare 'calo' with no other nutrition keyword still routes to meal_plan_request", () => {
  const result = intentRouter.route("Tôi cần bao nhiêu calo mỗi ngày?");
  assert.equal(result.intent, "meal_plan_request");
});
