import { test } from "node:test";
import assert from "node:assert/strict";
import { promptBuilder } from "../prompt_builder";
import { planContext, PROMPT_TOKEN_BUDGET } from "../context_plan";
import { inputParser } from "../input_parser";
import { recommendationEngine } from "../recommendation_engine";

const profile: any = { age: 30, gender: "MALE", heightCm: 175, currentWeightKg: 85, goal: "WEIGHT_LOSS", experienceLevel: "BEGINNER", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } };
const ctx: any = { profile, inBodyHistory: [{ date: "2026-10-01", weight: 86 }, { date: "2026-11-01", weight: 85 }], workoutHistory: [], nutritionHistory: [], memories: [] };
const empty: any = { documents: [], isEmpty: true };
const build = (q: string, intent: string, opts: any = {}, notes?: string) => {
  const parsed: any = { ...inputParser.parse(q, profile), routeIntent: intent };
  return promptBuilder.build(q, parsed, ctx, empty, recommendationEngine.recommend(profile, parsed, "vi"), "vi", [], notes, opts);
};
const plan = (q: string, intent: string, extra: any = {}) =>
  planContext({ intent, question: q, personalQuestion: false, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: false, ...extra });

// Expected rule presence is written from the rule's PURPOSE (plan formatting / InBody left-right / body-data reasoning /
// safety), not from the selection code.
test("rules on demand: a plain knowledge question drops plan-format and InBody rules, keeps safety and evidence-honesty rules", () => {
  const q = "Plank nên giữ bao lâu?";
  const p = build(q, "general_fitness_knowledge", { contextPlan: plan(q, "general_fitness_knowledge") });
  assert.doesNotMatch(p, /Với workout plan hoặc lịch ngày/);
  assert.doesNotMatch(p, /theo vùng cơ thể \(tay, chân\) từ dữ liệu InBody/);
  assert.doesNotMatch(p, /KHÔNG BAO GIỜ nhầm baseline/);
  assert.match(p, /KHÔNG chẩn đoán bệnh lý/, "safety rule always kept");
  assert.match(p, /Khi bằng chứng khoa học không đủ/, "evidence-honesty rule always kept");
  assert.match(p, /KHÔNG chúc mừng hay khẳng định thành tích/, "context-fidelity rule always kept");
});

test("rules on demand: an InBody question keeps InBody and body-data rules; a plan request keeps format rules", () => {
  const q1 = "Chỉ số InBody của tôi nói gì?";
  const p1 = build(q1, "general_fitness_knowledge", { contextPlan: plan(q1, "general_fitness_knowledge", { bodyCompositionQuestion: true }) });
  assert.match(p1, /theo vùng cơ thể \(tay, chân\) từ dữ liệu InBody/);
  assert.match(p1, /KHÔNG BAO GIỜ nhầm baseline/);
  const q2 = "Lên lịch tập 4 buổi cho tôi";
  const p2 = build(q2, "workout_plan_request", { contextPlan: plan(q2, "workout_plan_request") });
  assert.match(p2, /Với workout plan hoặc lịch ngày/);
});

test("rules on demand: without a plan the legacy prompt carries every rule", () => {
  const p = build("Plank nên giữ bao lâu?", "general_fitness_knowledge");
  for (const re of [/Với workout plan hoặc lịch ngày/, /dữ liệu InBody/, /KHÔNG BAO GIỜ nhầm baseline/, /KHÔNG chẩn đoán bệnh lý/]) assert.match(p, re);
});

test("manifest: reports coach_context only when the JSON was actually sent; whole-prompt size and budget flag", () => {
  const q = "Thực đơn giảm mỡ cho tôi";
  let m: any;
  build(q, "meal_plan_request", { contextPlan: plan(q, "meal_plan_request"), onManifest: (x: any) => (m = x) }, "NOTE A\n\nCoachContext JSON (sanitized, no user identity):\n{\"a\":1}");
  assert.ok(m.entries.some((e: any) => e.block === "coach_context" && e.tokens > 0));
  assert.ok(m.entries.some((e: any) => e.block === "notes"));
  assert.ok(m.promptTokens >= m.totalTokens - 5, "whole prompt measured");
  assert.equal(m.budget, PROMPT_TOKEN_BUDGET);
  assert.equal(m.overBudget, m.promptTokens > PROMPT_TOKEN_BUDGET);
  let k: any;
  build("Plank nên giữ bao lâu?", "general_fitness_knowledge", { contextPlan: plan("Plank nên giữ bao lâu?", "general_fitness_knowledge"), onManifest: (x: any) => (k = x) });
  assert.ok(!k.entries.some((e: any) => e.block === "coach_context"));
  assert.ok(k.skipped.includes("coach_context"));
  assert.ok(k.entries.every((e: any) => Object.keys(e).sort().join(",") === "block,reason,tokens"), "no text in the manifest");
});

test("manifest: over-budget prompts are flagged, structured JSON is not truncated", () => {
  const big = "CoachContext JSON (sanitized, no user identity):\n" + JSON.stringify({ rows: Array.from({ length: 1500 }, (_, i) => ({ i, v: "x".repeat(10) })) });
  let m: any;
  const q = "Thực đơn giảm mỡ cho tôi";
  const p = build(q, "meal_plan_request", { contextPlan: plan(q, "meal_plan_request"), onManifest: (x: any) => (m = x) }, big);
  assert.equal(m.overBudget, true);
  assert.ok(p.includes(big.slice(-50)), "the JSON reaches the prompt whole (never sliced)");
});
