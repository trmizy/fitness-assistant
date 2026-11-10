import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ExplainUnavailableError, MIN_EXPLANATION_CHARS, generateAiExplanation, nutritionExplanationRequest, workoutExplanationRequest, type ExplainLlmCall,
} from "../services/plan-explanation";

const PLAN = {
  goal: "WEIGHT_LOSS", durationWeeks: 8, daysPerWeek: 3, exercisesPerDay: 2,
  weeklySchedule: [
    { day: "Thứ 2", goal: "Toàn thân A", exercises: [{ name: "Goblet Squat", sets: 3, reps: "10-12", restSeconds: 90 }, { name: "Push-Up", sets: 3, reps: "8-12", restSeconds: 60, note: "giữ thân thẳng" }] },
    { day: "Thứ 4", goal: "Toàn thân B", exercises: [{ name: "Romanian Deadlift", sets: 3, reps: "8-10", restSeconds: 90 }], cardio: "đi bộ nhanh 20 phút" },
    { day: "Thứ 6", goal: "Toàn thân C", exercises: [{ name: "Lat Pulldown", sets: 3, reps: "10-12", restSeconds: 75 }] },
  ],
  progressionNotes: ["Tăng tạ 2.5% khi hoàn thành đủ số lần ở mọi hiệp."], recoveryNotes: ["Ngủ 7-9 tiếng."], nutritionSummary: "Thâm hụt vừa phải, đạm cao.",
};
const LONG = "**Vì sao kế hoạch này phù hợp**\n" + "Kế hoạch 3 buổi toàn thân giúp bạn luyện mỗi nhóm cơ nhiều lần trong tuần mà vẫn đủ thời gian hồi phục. ".repeat(3);
const ok = (answer: string): ExplainLlmCall => async () => ({ answer });
const REQ = workoutExplanationRequest(PLAN, "vi");

describe("generateAiExplanation — the AI must write it; no template path", () => {
  it("returns exactly the model's text when it answers", async () => {
    assert.equal(await generateAiExplanation(ok(LONG), REQ), LONG.trim());
  });
  it("a model that is too slow is an error (TIMEOUT), not a canned answer", async () => {
    const slow: ExplainLlmCall = () => new Promise(() => {});
    await assert.rejects(generateAiExplanation(slow, REQ, 40), (e: unknown) => e instanceof ExplainUnavailableError && e.reason === "TIMEOUT");
  });
  it("model error -> LLM_ERROR; empty -> EMPTY; fragment -> TOO_SHORT (never fabricated text)", async () => {
    await assert.rejects(generateAiExplanation(async () => { throw new Error("throttled"); }, REQ), (e: unknown) => e instanceof ExplainUnavailableError && e.reason === "LLM_ERROR");
    await assert.rejects(generateAiExplanation(ok("   "), REQ), (e: unknown) => e instanceof ExplainUnavailableError && e.reason === "EMPTY");
    await assert.rejects(generateAiExplanation(ok("x".repeat(MIN_EXPLANATION_CHARS - 1)), REQ), (e: unknown) => e instanceof ExplainUnavailableError && e.reason === "TOO_SHORT");
  });
  it("passes the system prompt, a deadline-matching timeout and the purpose to the model call", async () => {
    let seen: any;
    await generateAiExplanation(async (p, o) => { seen = { p, o }; return { answer: LONG }; }, REQ, 5000);
    assert.equal(seen.o.systemPrompt, REQ.systemPrompt);
    assert.equal(seen.o.timeoutMs, 5000);
    assert.equal(seen.p, REQ.prompt);
  });
  it("the timer is cleaned up after success (no leaked 24 s timer keeping the Lambda busy)", async () => {
    const before = (process as any)._getActiveHandles().length;
    await generateAiExplanation(ok(LONG), REQ, 60_000);
    assert.ok((process as any)._getActiveHandles().length <= before);
  });
});

describe("workoutExplanationRequest — the model sees the whole plan and strict rules", () => {
  it("includes schedule, sets x reps, rest, notes, cardio, progression, recovery and nutrition summary", () => {
    const p = REQ.prompt;
    for (const s of ["Goblet Squat 3x10-12 (nghỉ 90s)", "giữ thân thẳng", "đi bộ nhanh 20 phút", "Tăng tạ 2.5%", "Ngủ 7-9 tiếng", "Thâm hụt vừa phải", "3 buổi/tuần", "2 bài/buổi"]) assert.ok(p.includes(s), `missing: ${s}`);
  });
  it("shows the goal in Vietnamese, not the raw enum", () => {
    assert.match(REQ.prompt, /giảm cân/);
    assert.doesNotMatch(REQ.prompt, /WEIGHT_LOSS/);
  });
  it("the system prompt forbids invented numbers, promises, translated exercise names and listing-only answers", () => {
    for (const re of [/KHÔNG bịa số liệu/, /không hứa/, /KHÔNG dịch tên bài tập|không dịch tên bài tập/i, /KHÔNG chỉ liệt kê/, /đau nhói/]) assert.match(REQ.systemPrompt, re);
  });
  it("English requests use the English rules", () => {
    const en = workoutExplanationRequest(PLAN, "en");
    assert.match(en.systemPrompt, /Never invent figures/);
    assert.match(en.prompt, /Goal: WEIGHT_LOSS/);
  });
  it("long free text in the plan is clipped so the prompt stays bounded", () => {
    const big = workoutExplanationRequest({ ...PLAN, progressionNotes: ["a".repeat(5000)], nutritionSummary: "b".repeat(5000) }, "vi");
    assert.ok(big.prompt.length < 4000);
  });
});

describe("nutritionExplanationRequest", () => {
  const N = nutritionExplanationRequest({
    goal: "MUSCLE_GAIN", durationWeeks: 1, mealsPerDay: 3, dailyCaloriesTarget: 2400, proteinTargetGrams: 140, carbTargetGrams: 300, fatTargetGrams: 70,
    days: [{ dayNumber: 1, totalCalories: 2395, meals: [{ mealType: "Sáng", items: [{ name: "Yến mạch", quantity: 60, unit: "g" }] }] }],
  });
  it("carries the targets, goal label and the meal data", () => {
    for (const s of ["2400 kcal", "140 g", "tăng cơ", "Yến mạch 60g", "Ngày 1 (2395 kcal)"]) assert.ok(N.prompt.includes(s), `missing: ${s}`);
  });
  it("rules forbid invented numbers and require macro words in plain Vietnamese", () => {
    assert.match(N.systemPrompt, /KHÔNG bịa số/);
    assert.match(N.systemPrompt, /đạm \(protein\)/);
  });
});
