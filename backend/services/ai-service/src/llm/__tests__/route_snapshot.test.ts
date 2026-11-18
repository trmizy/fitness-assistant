import { test } from "node:test";
import assert from "node:assert/strict";
import { intentRouter } from "../intent_router";
import { detectWorkoutScheduleIntent } from "../workout_schedule_context";
import { detectDirectionGoal } from "../../services/training-direction";

const LLM_INTENTS = new Set([
  "general_fitness_knowledge", "schedule_specific_day_request", "body_recomposition_request",
  "meal_plan_request", "combined_plan_request", "nutrient_timing_request",
]);
const route = (q: string) => intentRouter.route(q, undefined as any);

// Confirmed misroutes from the 200-question coach eval (REAL HTTP/API, 2026-11-11). Each must now reach the model.
const MISROUTED: Array<[string, string]> = [
  ["B1-10", "Em muốn tập 4 buổi một tuần, chia lịch thế nào để mông và chân phát triển nhiều nhất?"],
  ["B2-14", "Tập 5 buổi mỗi tuần liệu có quá nhiều với người mới không?"],
  ["B3-44", "Tôi tập được 3 tháng rồi mà vẫn chưa thấy cơ bụng đâu, nản quá."],
  ["spec", "Tập 5 buổi một tuần có nhiều không?"],
  ["spec", "Có nên dùng dây kháng lực để tăng cơ không?"],
];

test("route snapshot: advice questions are no longer answered by a plan template", () => {
  for (const [id, q] of MISROUTED) {
    const r = route(q);
    assert.ok(LLM_INTENTS.has(r.intent), `${id} routed to ${r.intent}`);
  }
  assert.equal(route("Tập 5 buổi mỗi tuần liệu có quá nhiều với người mới không?").abstainedFrom, "frequency_change_request");
});

// Requests that MUST keep their deterministic plan/routine path (hard constraints: day count, minimum exercises).
const KEEP: Array<[string, string]> = [
  ["Lên lịch tập 4 buổi/tuần cho tôi", "frequency_change_request"],
  ["Cho tôi lịch tập 5 buổi mỗi tuần", "frequency_change_request"],
  ["Vậy lên giúp em một buổi tập chân nhé.", "muscle_group_routine_request"],
  ["Tôi muốn tập chân", "muscle_group_routine_request"],
  ["vậy nếu tập tay trước và tay sau thì có những bài tập nào và bài nào hỗ trợ tốt cho tôi", "muscle_group_routine_request"],
  ["Lịch tập 3 buổi một tuần", "workout_plan_request"],
];

test("route snapshot: explicit plan / exercise-list requests keep their template intent", () => {
  for (const [q, intent] of KEEP) {
    const r = route(q);
    assert.ok(!r.abstainedFrom, `${q} abstained from ${r.abstainedFrom}`);
    if (intent !== "workout_plan_request") assert.equal(r.intent, intent, q);
    else assert.ok(!LLM_INTENTS.has(r.intent), `${q} -> ${r.intent}`);
  }
});

test("route snapshot: speech act is exposed on the route", () => {
  assert.equal(route("Lên lịch tập 4 buổi/tuần cho tôi").speechAct, "COMMAND");
  assert.equal(route("Plank nên giữ bao lâu là đủ?").speechAct, "QUESTION");
});

test("schedule lookup: a progression question is not a 'what is on my schedule' lookup (eval B4-46)", () => {
  const history = [{ question: "Bench press của tôi kẹt ở 60kg 3 tuần nay rồi.", answer: "Lịch tập hôm nay của bạn…" }];
  assert.equal(detectWorkoutScheduleIntent("Vậy tôi nên tăng tạ thế nào?", history).enabled, false);
  assert.equal(detectWorkoutScheduleIntent("Làm sao tăng tạ theo từng tuần?", history).enabled, false);
  assert.equal(detectWorkoutScheduleIntent("Hôm nay tôi tập gì?").enabled, true, "a real lookup still works");
});

test("training direction: a concrete constraint is a coaching question, not the two-direction template (eval B4-09)", () => {
  assert.equal(detectDirectionGoal("Em chỉ có dây kháng lực ở nhà, tập thế nào để tăng cơ?"), null);
  assert.equal(detectDirectionGoal("Tôi muốn giảm mỡ thì nên làm gì?"), "fat_loss", "generic direction question keeps the template");
});
