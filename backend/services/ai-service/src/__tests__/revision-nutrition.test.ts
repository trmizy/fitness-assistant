/**
 * Phase 3 Batch 4 — nutrition revision unit tests (injected deps, no real DB).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tryReviseNutritionTarget, type NutritionRevisionDeps } from "../services/revision/nutrition-revision";

const okTarget = (overrides: Partial<{ calories: number; protein: number; carbs: number; fat: number; source: "ACTIVE_GOAL" | "COMPUTED" }> = {}) => ({
  ok: true as const,
  target: { source: "ACTIVE_GOAL" as const, calories: 2000, protein: 150, carbs: 200, fat: 60, ...overrides },
});

function deps(result = okTarget()): NutritionRevisionDeps {
  return { resolveNutritionTarget: async () => result };
}

test("T13: hypothetical calorie question is answered with a comparison and creates zero writes/proposals", async () => {
  let calls = 0;
  const d: NutritionRevisionDeps = { resolveNutritionTarget: async () => { calls += 1; return okTarget(); } };
  const result = await tryReviseNutritionTarget("2000 kcal hơi cao, nếu 1900 thì sao?", { userId: "u1" } as any, d);
  assert.ok(result);
  assert.match(result!.answer, /2000 kcal/);
  assert.match(result!.answer, /1900/);
  assert.match(result!.answer, /thấp hơn/);
  assert.equal(result!.blocks.length, 0, "a hypothetical comparison never carries a proposal/action block");
  assert.equal(calls, 1, "exactly one read of the authoritative target — zero extra calls");
});

test("T13 stays hypothetical: the SAME turn never creates a confirmable mutation, confirmed by the absence of any block/action", async () => {
  const result = await tryReviseNutritionTarget("nếu 2200 thì sao?", { userId: "u1" } as any, deps());
  assert.ok(result);
  assert.equal(result!.blocks.length, 0);
});

test("T14: a real change request ('đổi mục tiêu xuống 1900 kcal') is answered honestly — no safe override mechanism exists, so nothing is proposed", async () => {
  const result = await tryReviseNutritionTarget("Đổi mục tiêu xuống 1900 kcal.", { userId: "u1" } as any, deps());
  assert.ok(result);
  assert.match(result!.answer, /chưa thể/, "must honestly refuse, never silently claim the goal changed");
  assert.match(result!.answer, /2000/, "must state the REAL current target, not the requested 1900");
  assert.equal(result!.blocks.length, 0, "never creates a pending action for an unsupported override");
});

test("a message with no calorie number at all is not intercepted — returns null, falls through to normal chat", async () => {
  const result = await tryReviseNutritionTarget("Hôm nay tôi nên ăn gì?", { userId: "u1" } as any, deps());
  assert.equal(result, null);
});

test("upstream target resolution failure is surfaced honestly, never silently defaulted", async () => {
  const d: NutritionRevisionDeps = { resolveNutritionTarget: async () => ({ ok: false, message: "thiếu dữ liệu hồ sơ" }) };
  const result = await tryReviseNutritionTarget("nếu 1800 thì sao?", { userId: "u1" } as any, d);
  assert.equal(result!.answer, "thiếu dữ liệu hồ sơ");
  assert.equal(result!.blocks.length, 0);
});
