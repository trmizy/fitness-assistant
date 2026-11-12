/**
 * V2 Training Agent — P3 per-turn trace + offline metrics. Offline: scripted mock model, mocked V1 tools, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runTrainingAgentTurn } from "../agent-v2/training-agent";
import { createTrainingToolRegistry, TRAINING_AGENT_PILOT_POLICY, type TrainingToolDeps } from "../agent-v2/training-tools";
import { summarizeTurnTraces, fingerprintText, type TurnTrace } from "../agent-v2/turn-trace";
import type { ToolTraceEvent } from "../agent-v2/tool-registry";
import type { AgentBlock, AgentModelProvider, AgentModelRequest, AgentModelResponse } from "../agent-v2/model-provider";

const ME = "11111111-1111-4111-8111-111111111111";
const CTX = { userId: ME, authorizationHeader: "Bearer secret-token-value" };
const CYCLE = "33333333-3333-4333-8333-333333333333";
const deps = {
  getActiveCycle: async () => ({ cycle: { id: CYCLE, userId: ME, status: "ACTIVE", startDate: "2026-11-02", endDate: "2026-11-29", weekNumber: 2 }, summary: {} }),
  getTodaySchedule: async () => [{ id: "s-1", userId: ME, scheduledDate: "2026-11-12", status: "SCHEDULED", title: "Upper", exercises: [{}] }],
} as unknown as TrainingToolDeps;

function provider(steps: Array<AgentModelResponse | (() => never)>): AgentModelProvider {
  return { modelId: "mock-model", supportsCancellation: false, async converse(_r: AgentModelRequest) { const s = steps.shift()!; return typeof s === "function" ? s() : s; } };
}
const U = { inputTokens: 1000, outputTokens: 100 };
const say = (text: string, usage: AgentModelResponse["usage"] = U): AgentModelResponse => ({ stopReason: "end_turn", rawStopReason: "end_turn", content: [{ type: "text", text }], usage });
const use = (...b: AgentBlock[]): AgentModelResponse => ({ stopReason: "tool_use", rawStopReason: "tool_use", content: b, usage: U });
const call = (name: string, id: string): AgentBlock => ({ type: "toolUse", toolUseId: id, name, input: {} });

async function turn(question: string, steps: AgentModelResponse[], opts: { enabled?: boolean; context?: unknown } = {}) {
  const turns: TurnTrace[] = [];
  const toolEvents: ToolTraceEvent[] = [];
  const registry = createTrainingToolRegistry({ enabled: true, deps, traceSink: (e) => toolEvents.push(e) });
  const result = await runTrainingAgentTurn({ question, context: opts.context ?? CTX },
    { provider: provider(steps), registry, policy: TRAINING_AGENT_PILOT_POLICY, enabled: opts.enabled ?? true, traceSink: (t) => turns.push(t) });
  return { result, turns, toolEvents };
}

test("exactly one TurnTrace per turn, joined to the result and to every registry tool event by turnId", async () => {
  const { result, turns, toolEvents } = await turn("Chu kỳ hiện tại của tôi đang ở tuần mấy?", [use(call("training__get_active_cycle", "a1")), say("Bạn đang ở tuần 2.")]);
  assert.equal(result.status, "ANSWERED");
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.turnId, result.turnId);
  assert.match(t.turnId, /^[0-9a-f-]{36}$/);
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].turnId, t.turnId, "tool trace joins the turn trace");
  assert.equal(t.agentId, "training-agent-pilot"); assert.equal(t.modelId, "mock-model");
  assert.deepEqual(t.rounds.map((r) => [r.round, r.outcome, r.inputTokens, r.outputTokens, r.toolUseCount, r.usageEstimated]),
    [[1, "tool_use", 1000, 100, 1, false], [2, "end_turn", 1000, 100, 0, false]]);
  assert.deepEqual(t.tools.map((c) => [c.toolId, c.outcome, c.round]), [["training.get_active_cycle", "ok", 1]]);
  assert.equal(t.totals.inputTokens, 2000); assert.equal(t.totals.toolInvocations, 1);
  assert.equal(t.totals.estimatedCostUsd, result.usage.estimatedCostUsd);
});

test("early exits are traced too (flag off, unauthenticated, safety, confirmation) — zero rounds", async () => {
  for (const [q, opts, status] of [
    ["Buổi hôm nay tôi cần tập gì?", { enabled: false }, "DISABLED"],
    ["Buổi hôm nay tôi cần tập gì?", { context: {} }, "UNAUTHENTICATED"],
    ["Tôi muốn giảm 10kg trong 1 tuần thì tập thế nào?", {}, "SAFETY_BLOCKED"],
    ["Hãy thay squat bằng leg press.", {}, "CONFIRMATION_REQUIRED"],
  ] as const) {
    const { turns } = await turn(q, [], opts as any);
    assert.equal(turns.length, 1, status); assert.equal(turns[0].status, status); assert.equal(turns[0].rounds.length, 0);
  }
});

test("refused tool calls and provider errors appear in the trace", async () => {
  const { turns } = await turn("Buổi hôm nay tôi cần tập gì?", [use(call("training__get_today_schedule", "b1"), call("training__skip_workout", "b2")), say("Hôm nay bạn tập Upper.")]);
  assert.deepEqual(turns[0].tools.map((c) => [c.toolId, c.outcome]), [["training.get_today_schedule", "ok"], ["(unknown)", "TOOL_NOT_OFFERED"]]);
  assert.equal(turns[0].tools[1].durationMs, 0, "refused before the registry");
  const failing = provider([() => { throw Object.assign(new Error("x"), { name: "AgentProviderError", kind: "server" }); }]);
  const traces: TurnTrace[] = [];
  const reg = createTrainingToolRegistry({ enabled: true, deps, traceSink: () => {} });
  await runTrainingAgentTurn({ question: "Mỗi tuần nên tập bao nhiêu set?", context: CTX }, { provider: failing, registry: reg, policy: TRAINING_AGENT_PILOT_POLICY, enabled: true, traceSink: (t) => traces.push(t) });
  assert.equal(traces[0].status, "PROVIDER_ERROR"); assert.match(traces[0].rounds[0].outcome, /^error:/);
});

test("privacy: no question text, answer text, token, user id or tool data in the trace", async () => {
  const q = "Chu kỳ hiện tại của tôi đang ở tuần mấy?";
  const { turns } = await turn(q, [use(call("training__get_active_cycle", "c1")), say("Bạn đang ở tuần 2 của chu kỳ.")]);
  const json = JSON.stringify(turns[0]);
  for (const forbidden of ["Chu kỳ", "tuần mấy", "Bạn đang", "secret-token-value", "Bearer", ME, CYCLE, "2026-11-29"]) assert.ok(!json.includes(forbidden), forbidden);
  assert.equal(turns[0].question.length, q.length);
  assert.equal(turns[0].question.fingerprint, fingerprintText(q));
  assert.match(turns[0].question.fingerprint, /^[0-9a-f]{16}$/);
});

test("a throwing trace sink never changes the turn's outcome", async () => {
  const reg = createTrainingToolRegistry({ enabled: true, deps, traceSink: () => {} });
  const r = await runTrainingAgentTurn({ question: "Mỗi tuần nên tập bao nhiêu set?", context: CTX },
    { provider: provider([say("Khoảng 10–20 set mỗi nhóm cơ mỗi tuần.")]), registry: reg, policy: TRAINING_AGENT_PILOT_POLICY, enabled: true, traceSink: () => { throw new Error("sink down"); } });
  assert.equal(r.status, "ANSWERED");
});

test("summarizeTurnTraces: status mix, rates, latency percentiles, tool usage, cost, guard actions", () => {
  const base = (over: Partial<TurnTrace>): TurnTrace => ({
    turnId: "t", agentId: "a", policyTools: 11, modelId: "m", startedAt: "2026-11-12T00:00:00Z", durationMs: 100, status: "ANSWERED", stopDetail: null,
    question: { length: 10, fingerprint: "0".repeat(16) }, answerLength: 50, rounds: [], tools: [],
    totals: { modelRounds: 1, providerAttempts: 1, retries: 0, toolInvocations: 0, toolRefusals: 0, inputTokens: 1000, outputTokens: 100, usageEstimated: false, estimatedCostUsd: 0.00112, deadlineHit: false, inFlightAtEnd: 0 },
    guardActions: [], ...over,
  });
  const m = summarizeTurnTraces([
    base({ durationMs: 100, tools: [{ toolId: "training.get_active_cycle", outcome: "ok", durationMs: 5, round: 1 }], totals: { ...base({}).totals, toolInvocations: 1, modelRounds: 2 } }),
    base({ durationMs: 300, status: "BUDGET_EXHAUSTED", tools: [{ toolId: "(unknown)", outcome: "TOOL_NOT_OFFERED", durationMs: 0, round: 1 }] }),
    base({ durationMs: 200, status: "UNGROUNDED", guardActions: ["bmi:0/1", "hygiene:1/0"] }),
    base({ durationMs: 900, status: "DEADLINE_EXCEEDED", totals: { ...base({}).totals, inFlightAtEnd: 1, usageEstimated: true } }),
  ]);
  assert.equal(m.turns, 4);
  assert.deepEqual(m.byStatus, { ANSWERED: 1, BUDGET_EXHAUSTED: 1, UNGROUNDED: 1, DEADLINE_EXCEEDED: 1 });
  assert.equal(m.answeredRate, 0.25); assert.equal(m.budgetExhaustedRate, 0.25); assert.equal(m.deadlineRate, 0.25); assert.equal(m.ungroundedRate, 0.25);
  assert.deepEqual(m.latencyMs, { p50: 200, p95: 900, max: 900 });
  assert.deepEqual(m.toolCalls.byTool, { "training.get_active_cycle": 1 });
  assert.deepEqual(m.toolCalls.refusedByOutcome, { TOOL_NOT_OFFERED: 1 });
  assert.equal(m.modelRounds.max, 2);
  assert.equal(m.estimatedCostUsd.total, 0.00448);
  assert.deepEqual(m.guardActionCounts, { bmi: 1, hygiene: 1 });
  assert.equal(m.inFlightAtEndTurns, 1); assert.equal(m.tokens.estimatedTurns, 1);
  assert.equal(summarizeTurnTraces([]).turns, 0);
});
