/**
 * Phase 3 Rollout R1 — routing guard, deterministic read fast path, and the semantic-routing model budget.
 * Product validation, not a research benchmark: pass/fail behaviour only.
 *
 * Model calls are stubbed at the llmService boundary (the same seam the other suites use). The routing decision itself is real code.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import { llmRoute, routeAcceptance, limitLlmRoute, ROUTING_TIMEOUT_MS } from "../conversational-intelligence/global/llm-route";
import { llmService } from "../services/llm.service";

const realCallLLM = llmService.callLLM;
afterEach(() => { llmService.callLLM = realCallLLM; });

/** stub the model boundary; records every call so a test can count semantic-routing calls and the budget it was given */
function stubModel(answer: string | (() => Promise<never>)) {
  const calls: Array<{ timeoutMs?: number; responseFormat?: string }> = [];
  llmService.callLLM = (async (_prompt: string, opts?: { timeoutMs?: number; responseFormat?: string }) => {
    calls.push({ timeoutMs: opts?.timeoutMs, responseFormat: opts?.responseFormat });
    if (typeof answer === "function") return answer();
    return { answer, promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  }) as typeof llmService.callLLM;
  return calls;
}

// ── 1. Deterministic READ fast path: these phrases must NEVER reach the semantic router (budget: 0 semantic calls) ──
const PT_READ = ["PT hiện tại của tôi là ai?", "Tôi đang có PT chưa?", "Ai đang là PT của tôi?", "Huấn luyện viên hiện tại của tôi là ai?"];
const NUTRITION_READ = ["Macro hiện tại của tôi bao nhiêu?", "Mục tiêu dinh dưỡng hiện tại là gì?", "Tôi đang ăn bao nhiêu kcal theo app?", "Protein target của tôi hiện là bao nhiêu?"];

for (const text of PT_READ) {
  test(`deterministic PT READ (no semantic routing call): "${text}"`, () => {
    const r = classifyGlobal(text, {});
    assert.equal(r.route, "READ_STATE");
    assert.equal((r as { topic?: string }).topic, "PT_STATUS");
    assert.notEqual(r.route, "UNKNOWN", "UNKNOWN is the only condition that reaches the semantic router");
  });
}
for (const text of NUTRITION_READ) {
  test(`deterministic nutrition READ (no semantic routing call): "${text}"`, () => {
    const r = classifyGlobal(text, {});
    assert.equal(r.route, "READ_STATE");
    assert.equal((r as { topic?: string }).topic, "NUTRITION_TARGET");
    assert.notEqual(r.route, "UNKNOWN");
  });
}

// ── 2. Pending-draft revision phrasing (no pending-context route may be an unrelated READ) ──
const REVISION = ["Buổi chân hơi nặng.", "Lịch này hơi nặng.", "Giảm buổi chân giúp tôi.", "Giữ số buổi nhưng giảm volume chân.", "Tôi muốn nhẹ phần chân hơn.", "Bài chân nhiều quá."];

for (const text of REVISION) {
  test(`pending-draft revision is never an unrelated PROGRAM_STATUS read: "${text}"`, async () => {
    // deterministic: UNKNOWN in both contexts (the pending-draft path owns it when a draft exists)
    assert.equal(classifyGlobal(text, { draft: true }).route, "UNKNOWN");
    // a model proposing the observed wrong route is rejected in a pending-draft context
    const wrong = { route: "READ_STATE" as const, topic: "PROGRAM_STATUS" as const, confidence: 0.6, reason: "x" };
    assert.equal(limitLlmRoute(text, wrong, { pendingDraft: true }), null, "a revision utterance must not be accepted as a status read");
    assert.equal(routeAcceptance(text, wrong, { pendingDraft: true }).reason !== null, true);
  });
}

test("the same revision phrases WITHOUT pending context do not fabricate a draft and do not become a status read", () => {
  for (const text of REVISION) {
    assert.equal(classifyGlobal(text, {}).route, "UNKNOWN");
    const wrong = { route: "READ_STATE" as const, topic: "PROGRAM_STATUS" as const, confidence: 0.6, reason: "x" };
    assert.equal(limitLlmRoute(text, wrong, {}), null);
  }
});

// ── 3. Legitimate READ questions through the model are still accepted (the guard must not over-block reads) ──
test("a genuine program-status question is still accepted from the model", () => {
  const ok = { route: "READ_STATE" as const, topic: "PROGRAM_STATUS" as const, confidence: 0.6, reason: "x" };
  assert.ok(limitLlmRoute("Chương trình tập của tôi là gì?", ok, {}));
  assert.ok(limitLlmRoute("Tôi đang tập chương trình nào?", ok, {}));
});

// ── 4. Model failure modes (A–E): each must end in null, never in a route ──
test("A. invalid JSON from the model → no route, typed reason, no retry", async () => {
  const calls = stubModel("this is not json at all");
  const r = await llmRoute("Buổi chân hơi nặng.", {}, "u-r1", "c-a");
  assert.equal(r, null);
  assert.equal(calls.length, 1, "routing makes exactly one model attempt");
});
test("B. valid JSON but an unsupported enum value → no route", async () => {
  stubModel('{"route":"WRITE_EVERYTHING","topic":"PT_STATUS"}');
  assert.equal(await llmRoute("Tôi đang có PT chưa?", {}, "u-r1", "c-b"), null);
});
test("C. valid allowed enum but contextually inconsistent (the N2 case) → rejected by the context guard", async () => {
  stubModel('{"route":"READ_STATE","topic":"PROGRAM_STATUS"}');
  const r = await llmRoute("Buổi chân hơi nặng.", { draft: true }, "u-r1", "c-c");
  assert.equal(r, null, "schema validity must not imply semantic acceptance");
});
test("D. timeout → no route (the caller falls back to UNKNOWN / clarification)", async () => {
  stubModel(async () => { throw Object.assign(new Error("timeout of 25000ms exceeded"), { name: "TimeoutError" }); });
  assert.equal(await llmRoute("Lịch này hơi nặng.", {}, "u-r1", "c-d"), null);
});
test("E. provider unavailable → no route", async () => {
  stubModel(async () => { throw new Error("connect ECONNREFUSED"); });
  assert.equal(await llmRoute("Lịch này hơi nặng.", {}, "u-r1", "c-e"), null);
});

// ── 5. Budget assertions ──
test("the routing call is given its own bounded budget, not the 80 s cycle-analysis default", async () => {
  const calls = stubModel('{"route":"KNOWLEDGE_QA"}');
  await llmRoute("Một câu hỏi kiến thức chung nào đó?", {}, "u-r1", "c-budget");
  assert.equal(calls.length, 1, "one semantic routing call");
  assert.equal(calls[0].timeoutMs, ROUTING_TIMEOUT_MS);
  assert.ok((calls[0].timeoutMs ?? Infinity) <= 25_000, "routing budget must stay short");
});

test("known deterministic paths never reach the model: a deterministic READ produces zero model calls", async () => {
  const calls = stubModel("should never be asked");
  for (const text of [...PT_READ, ...NUTRITION_READ]) {
    const r = classifyGlobal(text, {});
    if (r.route === "UNKNOWN") await llmRoute(text, {}, "u-r1", "c-det");
  }
  assert.equal(calls.length, 0, "no semantic routing call for deterministic READ phrasing");
});

// ── 6. Acceptance decisions are explicit (telemetry reasons) ──
test("every rejection carries a typed reason", () => {
  assert.equal(routeAcceptance("x", null).reason, "no_route_proposed");
  assert.equal(routeAcceptance("Buổi chân hơi nặng.", { route: "READ_STATE", topic: "PROGRAM_STATUS", confidence: 0.6, reason: "x" }).reason, "topic_evidence_missing");
  assert.equal(routeAcceptance("Chương trình của tôi hơi nặng.", { route: "READ_STATE", topic: "PROGRAM_STATUS", confidence: 0.6, reason: "x" }, { pendingDraft: true }).reason, "pending_draft_revision_wording");
});

// ── 7. Known deterministic paths: zero semantic routing calls (mandate §13 budget assertions) ──
// classifyGlobal is the deterministic stage; the semantic router is reached ONLY when its result is UNKNOWN, so "not UNKNOWN" = 0 semantic calls.
test("known slot answer while a workflow waits: no semantic routing call", () => {
  const ctx = { active: { wf: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" } } as const;
  assert.notEqual(classifyGlobal("4 buổi một tuần", { ...ctx }).route, "UNKNOWN");
});
test("known cancellation: no semantic routing call", () => {
  assert.notEqual(classifyGlobal("Hủy kế hoạch này nhé.", { draft: true }).route, "UNKNOWN");
});
test("known confirmation phrasing is handled before the router (no semantic routing call)", () => {
  // the confirmation boundary classifies these deterministically; the router never sees them
  const { classifyConfirmationUtterance } = require("../services/confirmation-boundary") as typeof import("../services/confirmation-boundary");
  assert.notEqual(classifyConfirmationUtterance("xác nhận"), null);
});
// NOTE (not a test): with a pending draft, the semantic router is NOT eligible at all — global-turn.ts `llmEligible` requires `!pendingDraft`,
// and the draft revision path owns the turn. That is verified by code inspection here; a live draft probe is still open (see the R1 doc).

