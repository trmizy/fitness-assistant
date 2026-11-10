/**
 * Regression (2026-11-10, eval B1-01 / B1-15): training advice/comparison/diagnosis questions were routed to the
 * deterministic plan templates (answered with a default schedule, no reasoning). They must reach the model, while explicit
 * creation requests keep their template/agent routes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { intentRouter, isTrainingAdviceQuestion } from "../llm/intent_router";

const route = (q: string) => intentRouter.route(q).intent;

test("comparison and plateau questions go to the model (general_fitness_knowledge)", () => {
  assert.equal(route("Người mới như em tập full body 3 buổi/tuần với tập chia nhóm cơ 5 buổi thì cái nào tăng cơ tốt hơn?"), "general_fitness_knowledge");
  assert.equal(route("Tôi tập push pull legs được 6 tháng rồi mà cơ không lên nữa, nên thay đổi gì?"), "general_fitness_knowledge");
});

test("explicit creation requests are never treated as advice", () => {
  assert.equal(isTrainingAdviceQuestion("Lên giúp tôi lịch tập 3 buổi/tuần để giảm mỡ"), false);
  assert.equal(isTrainingAdviceQuestion("Tạo lịch tập 4 buổi, cái nào tốt hơn thì chọn"), false);
  assert.equal(route("Lên giúp tôi lịch tập 3 buổi/tuần để giảm mỡ, mỗi buổi tôi chỉ có 45 phút."), "frequency_change_request");
});

test("nutrition comparisons are not hijacked", () => {
  assert.equal(isTrainingAdviceQuestion("Gạo lứt hay gạo trắng cái nào tốt hơn cho calo?"), false);
});
