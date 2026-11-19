/**
 * V1 RC1 (2026-11-12) — H-03 (REAL HTTP/API, rc-verify-v1b): "Nếu mình tạo thực đơn 5 bữa thì có tốt hơn 3 bữa không?" was
 * answered with a full 5-meal plan template. A COMPARISON or hypothetical "is X better than Y" question asks for knowledge,
 * whatever nouns it contains; the word "thực đơn" alone must not decide that a plan is wanted. Oracle: hand-labelled routes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { intentRouter } from "../intent_router";

const route = (q: string) => intentRouter.route(q, {} as any).intent;

for (const q of [
  "Ăn 3 bữa hay 5 bữa tốt hơn để tăng cơ?",
  "Nếu mình tạo thực đơn 5 bữa thì có tốt hơn 3 bữa không?", // H-03 verbatim
  "Thực đơn eat clean và keto cái nào tốt hơn cho giảm mỡ?",
  "Chia 3 bữa hay 5 bữa thì tốt hơn?",
  "So sánh ăn 2 bữa với 4 bữa một ngày",
]) test(`comparison / hypothetical knowledge question is NOT a meal-plan request: "${q}"`, () => assert.equal(route(q), "general_fitness_knowledge"));

for (const q of [
  "Gợi ý thực đơn giảm mỡ cho tôi",
  "Tạo thực đơn 5 bữa cho tôi",
  "Thực đơn hôm nay của tôi có gì?",
  "Đổi thực đơn của tôi sang 4 bữa",
  "Lên thực đơn tăng cơ 2000 kcal giúp tôi",
  "Tạo giúp tôi thực đơn nào tốt hơn cho giảm mỡ",
]) test(`a real menu request / lookup / change keeps the meal path: "${q}"`, () => assert.equal(route(q), "meal_plan_request"));
