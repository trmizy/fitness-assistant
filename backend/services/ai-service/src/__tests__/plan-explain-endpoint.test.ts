/**
 * POST /plans/explain and /plans/nutrition/:id/explain — HTTP level, real Express app, repository and model stubbed.
 * Proves: the answer is always the model's text; when the model fails or is too slow the user gets an honest 503 and NEVER a canned
 * explanation; internal validation records never reach the response.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import app from "../app";
import { llmService } from "../services/llm.service";
import { conversationRepository } from "../repositories/conversation.repository";

const USER = "test-user-explain-0001";
const agent = supertest(app);
const withAuth = (r: supertest.Test) => { r.set("x-user-id", USER); if (process.env.INTERNAL_SERVICE_SECRET) r.set("x-internal-token", process.env.INTERNAL_SERVICE_SECRET); return r; };

const PLAN_ID = "550e8400-e29b-41d4-a716-446655440001";
const PLAN_CONTENT = {
  goal: "MUSCLE_GAIN", durationWeeks: 4, daysPerWeek: 1,
  weeklySchedule: [{ day: "Day 1", goal: "Tập ngực", exercises: [{ exerciseId: "e1", order: 1, name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }] }],
  progressionNotes: ["Tăng tạ khi đủ số lần."], recoveryNotes: ["Ngủ đủ."],
  _metadata: { aiWarnings: ["Hãy khởi động kỹ.", { type: "coach_plan_validation", errors: [], warnings: [{ code: "beginner_volume_high", message: "Beginner daily volume is high" }] }, { type: "deterministic_repair" }, "{\"type\":\"x\"}"] },
};
const ANSWER = "**Vì sao chọn bài ngực**\n" + "Bench Press là bài nền tảng giúp bạn tăng sức mạnh cơ ngực, vai trước và tay sau trong cùng một động tác. ".repeat(3);

const original = { find: conversationRepository.findPlanById, findN: (conversationRepository as any).findNutritionPlanById, call: llmService.callLLM, health: llmService.getHealthStatus };
function stubPlan() {
  const row = { id: PLAN_ID, userId: USER, status: "COMPLETED", archivedAt: null, plan: PLAN_CONTENT, goal: "MUSCLE_GAIN", durationWeeks: 4, mealsPerDay: 3 };
  (conversationRepository as any).findPlanById = async () => row;
  (conversationRepository as any).findNutritionPlanById = async () => ({ ...row, plan: { dailyCaloriesTarget: 2400, proteinTargetGrams: 140, carbTargetGrams: 300, fatTargetGrams: 70, nutritionDays: [{ dayNumber: 1, totalCalories: 2395, meals: [{ mealType: "Sáng", items: [{ name: "Yến mạch", quantity: 60, unit: "g" }] }] }] } });
  (llmService as any).getHealthStatus = async () => ({ llmAvailable: true });
}
before(stubPlan);
after(() => { (conversationRepository as any).findPlanById = original.find; (conversationRepository as any).findNutritionPlanById = original.findN; (llmService as any).callLLM = original.call; (llmService as any).getHealthStatus = original.health; });

const CANNED = /Lịch tập theo tuần|giải thích tự động|Kế hoạch này hướng tới mục tiêu|luân phiên giúp đảm bảo/;

describe("POST /plans/explain", () => {
  it("returns the model's text, source llm, and only plain-sentence warnings", async () => {
    (llmService as any).callLLM = async () => ({ answer: ANSWER });
    const res = await withAuth(agent.post("/plans/explain?lang=vi")).send({ planId: PLAN_ID });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, "llm");
    assert.equal(res.body.data.explanation, ANSWER.trim());
    assert.deepEqual(res.body.data.warnings, ["Hãy khởi động kỹ."]);
    assert.doesNotMatch(JSON.stringify(res.body), /coach_plan_validation|deterministic_repair|beginner_volume_high/);
  });
  it("model error -> 503 with a Vietnamese retry message and NO canned explanation", async () => {
    (llmService as any).callLLM = async () => { throw new Error("ThrottlingException"); };
    const res = await withAuth(agent.post("/plans/explain?lang=vi")).send({ planId: PLAN_ID });
    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.match(res.body.error.message, /AI chưa giải thích kịp/);
    assert.doesNotMatch(JSON.stringify(res.body), CANNED);
    assert.equal(res.body.data, undefined);
  });
  it("a model that answers with a fragment is rejected, not shown", async () => {
    (llmService as any).callLLM = async () => ({ answer: "Xin lỗi, tôi không thể." });
    const res = await withAuth(agent.post("/plans/explain?lang=vi")).send({ planId: PLAN_ID });
    assert.equal(res.status, 503);
    assert.doesNotMatch(JSON.stringify(res.body), CANNED);
  });
  it("the model call receives the whole plan and the system prompt", async () => {
    let seen: any;
    (llmService as any).callLLM = async (prompt: string, opts: any) => { seen = { prompt, opts }; return { answer: ANSWER }; };
    await withAuth(agent.post("/plans/explain?lang=vi")).send({ planId: PLAN_ID });
    assert.match(seen.prompt, /Bench Press 3x8-10 \(nghỉ 90s\)/);
    assert.match(seen.prompt, /Tăng tạ khi đủ số lần/);
    assert.match(seen.opts.systemPrompt, /KHÔNG bịa số liệu/);
    assert.equal(seen.opts.timeoutMs, 24000);
  });
});

describe("POST /plans/nutrition/:planId/explain", () => {
  it("returns the model's text; failure is a 503, never the old fixed paragraph", async () => {
    (llmService as any).callLLM = async () => ({ answer: ANSWER });
    const ok = await withAuth(agent.post(`/plans/nutrition/${PLAN_ID}/explain`)).send({});
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.source, "llm");
    assert.equal(ok.body.data.explanation, ANSWER.trim());
    (llmService as any).callLLM = async () => { throw new Error("boom"); };
    const bad = await withAuth(agent.post(`/plans/nutrition/${PLAN_ID}/explain`)).send({});
    assert.equal(bad.status, 503);
    assert.doesNotMatch(JSON.stringify(bad.body), CANNED);
  });
  it("AI reported unavailable by the health check -> 503 as well", async () => {
    (llmService as any).getHealthStatus = async () => ({ llmAvailable: false });
    const res = await withAuth(agent.post(`/plans/nutrition/${PLAN_ID}/explain`)).send({});
    assert.equal(res.status, 503);
    (llmService as any).getHealthStatus = async () => ({ llmAvailable: true });
  });
});
