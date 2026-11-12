/**
 * V1 stabilization (2026-11-12) — fitness-agent speech-act gate.
 *
 * Real defect (REAL HTTP/API, Nova Pro recheck B1-13, trace ai_1794437941627_bcbdd0): "Tôi muốn đổi lịch tập từ 3 buổi lên 5
 * buổi mỗi tuần được không?" returned responseSource=fitness_agent and started AI generation of a NEW 5-day schedule. Root
 * cause: parseFitnessAgentIntent read the directional "lên" ("từ 3 buổi LÊN 5 buổi") as the verb "lên lịch", and the agent
 * runs BEFORE intentRouter, so no question/hypothetical check ever applied to it.
 *
 * Oracle: the expected act/kind of every sentence below is hand-labelled from what the user is asking for — never derived from
 * the production classifier.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAgentTurnAct, mayStartMutation } from "../services/agent-turn-act";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";
import { intentRouter } from "../llm/intent_router";

const ACTS: Array<[string, string]> = [
  ["Tập 5 buổi có nhiều không?", "QUESTION"],
  ["Đổi lên 5 buổi được không?", "QUESTION"],
  ["Tôi muốn đổi lịch tập từ 3 buổi lên 5 buổi mỗi tuần được không?", "QUESTION"],
  ["Lịch tập của tôi tuần này có gì?", "QUESTION"],
  ["Có nên bỏ qua buổi tập hôm nay không?", "QUESTION"],
  ["Nếu tập 5 buổi thì thế nào?", "HYPOTHETICAL"],
  ["Hãy đổi lịch của tôi lên 5 buổi.", "COMMAND"],
  ["Tạo lịch tập 5 buổi cho tôi", "COMMAND"],
  ["Lên lịch tập cho tôi, nếu được thì 4 buổi", "COMMAND"],
  ["Bạn có thể tạo lịch 5 buổi cho tôi không?", "REQUEST"],
  ["Lên giúp tôi lịch tập 4 buổi được không?", "REQUEST"],
  ["Tạo lịch tập cho tôi được không?", "REQUEST"],
  ["Xác nhận", "CONFIRMATION"],
  ["Ok lưu đi", "CONFIRMATION"],
  ["Tôi đang tập 3 buổi mỗi tuần.", "STATEMENT"],
];

for (const [text, act] of ACTS) {
  test(`turn act: "${text}" -> ${act}`, () => {
    assert.equal(classifyAgentTurnAct(text), act);
  });
}

// "Tôi muốn tạo lịch tập mới" — a stated wish to have something created. Hand label first written as STATEMENT; speech_act.ts
// deliberately classifies "muốn + tạo lịch" as COMMAND (COMMAND_INNER). Either reading must ALLOW the agent to start the flow,
// which is the property that matters here.
test(`a stated wish to create a plan may start the (confirmation-gated) flow`, () => {
  assert.equal(mayStartMutation(classifyAgentTurnAct("Tôi muốn tạo lịch tập mới")), true);
  assert.equal(mayStartMutation(classifyAgentTurnAct("Đổi lên 5 buổi được không?")), false);
  assert.equal(mayStartMutation(classifyAgentTurnAct("Nếu tập 5 buổi thì thế nào?")), false);
});

// Advisory turns must never reach a data-creating/changing agent intent.
const ADVISORY: string[] = [
  "Tôi muốn đổi lịch tập từ 3 buổi lên 5 buổi mỗi tuần được không?", // B1-13 verbatim
  "Đổi lên 5 buổi được không?",
  "Tập 5 buổi có nhiều không?",
  "Nếu tập 5 buổi thì thế nào?",
  "Có nên tạo thực đơn riêng không?",
  "Có nên bỏ qua buổi tập hôm nay không?",
  "Nếu tôi lên lịch tập 6 buổi thì có quá sức không?",
  "Lịch tập của tôi tuần này có gì?",
];
for (const text of ADVISORY) {
  test(`advisory turn never maps to a mutating agent intent: "${text}"`, () => {
    assert.equal(parseFitnessAgentIntent(text).kind, null);
  });
}

// Explicit commands/requests keep working.
const COMMANDS: Array<[string, string]> = [
  ["Hãy đổi lịch của tôi lên 5 buổi.", "CREATE_WORKOUT_PLAN"],
  ["Bạn có thể tạo lịch 5 buổi cho tôi không?", "CREATE_WORKOUT_PLAN"],
  ["Tạo lịch tập 5 buổi cho tôi", "CREATE_WORKOUT_PLAN"],
  ["Lên giúp tôi lịch tập 3 buổi/tuần để giảm mỡ, mỗi buổi tôi chỉ có 45 phút.", "CREATE_WORKOUT_PLAN"],
  ["Lên giúp tôi lịch tập 4 buổi được không?", "CREATE_WORKOUT_PLAN"],
  ["Đổi giúp tôi sang lịch upper/lower 4 buổi", "CREATE_WORKOUT_PLAN"],
  ["Tạo thực đơn giảm mỡ 4 bữa", "CREATE_NUTRITION_PLAN"],
  ["Bỏ qua buổi tập hôm nay", "WORKOUT_SKIP"],
];
for (const [text, kind] of COMMANDS) {
  test(`explicit command/request keeps its agent intent: "${text}" -> ${kind}`, () => {
    assert.equal(parseFitnessAgentIntent(text).kind, kind);
  });
}

test("read-only agent intents are not gated by the speech act (a search/status QUESTION is still answered by the agent)", () => {
  assert.equal(parseFitnessAgentIntent("Có chương trình tập nào cho người mới không?").kind, "PROGRAM");
  assert.equal(parseFitnessAgentIntent("Chu kỳ hiện tại của tôi thế nào?").kind, "EVALUATE");
});

test("B2-38: a supplement-effect knowledge question is not routed to the meal-plan template (\"fat burner\" is not a macro)", () => {
  // REAL HTTP/API B2-38 (trace ai_1794438061436_30lj9b) was routed to meal_plan_request and the answer appended an unrequested
  // 3-day workout table.
  assert.equal(intentRouter.route("Thuốc đốt mỡ (fat burner) có giúp đốt mỡ thật sự không?", {} as any).intent, "general_fitness_knowledge");
  assert.equal(intentRouter.route("Uống trà xanh có giúp giảm mỡ không?", {} as any).intent, "general_fitness_knowledge");
  // personal / plan requests still reach the meal path
  assert.equal(intentRouter.route("Gợi ý thực đơn giảm mỡ cho tôi", {} as any).intent, "meal_plan_request");
  assert.equal(intentRouter.route("Ăn gì có giúp tăng cơ cho tôi không?", {} as any).intent, "meal_plan_request");
});
