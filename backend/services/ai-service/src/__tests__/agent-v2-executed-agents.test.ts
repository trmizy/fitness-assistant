/**
 * V2 PUBLIC `agents` = EXECUTED agents only (owner decision B, M7-P5A.2.2). SUPERVISOR level.
 *
 * Contract under test (supervisor.ts `executedAgentsOf` / `SupervisorResult.executedAgents`; routes/ai-v2.routes.ts returns it as
 * `data.agents`): an agent counts as executed when its runner RETURNED a result for a real attempt — completion NOT in
 * {SKIPPED, BLOCKED, POLICY_VIOLATION} and `error.code !== "RUNNER_THREW"`. So COMPLETE, INSUFFICIENT_DATA, FAILED (the agent's own
 * loop failed and returned) and BUDGET_EXHAUSTED (an agent that started) count; a budget-skipped agent (SKIPPED), an agent-level
 * BLOCKED (its own gate before answering, e.g. CONFIRMATION_REQUIRED), POLICY_VIOLATION (output withheld) and a runner that
 * THREW do not. Whether the agent SUCCEEDED is the turn `status`, not the list. `decision.agents` (SELECTED), `decision.dropped`
 * (deferred codes) and `trace.delegations[]` (attempted, incl. SKIPPED) are unchanged and stay distinguishable from it.
 *
 * Evidence label: BACKEND INTEGRATION (real supervisor + real bounded agents + real hybrid provider over TEST FIXTURES; routing
 * model = counting mock; a few rows use a hand-written AgentRunner stub, marked "stub runner"). No network / AWS / model / DB:
 * fetch, axios and bedrockRuntimeDeps.send are blocked and COUNTED; the last test asserts 0. Expectations are derived from the
 * contract above and the supervisor code, never from a run's output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { bedrockRuntimeDeps } from "../services/bedrock.client";
import { createHybridDecisionProvider } from "../agent-v2/hybrid-router";
import { createAgentRunners } from "../agent-v2/agent-catalog";
import { SUPERVISOR_BUDGET, executedAgentsOf, type SupervisorResult, type SupervisorTrace } from "../agent-v2/supervisor";
import { checkInputSafety } from "../agent-v2/answer-guards";
import { AgentProviderError, type AgentModelProvider, type AgentModelResponse } from "../agent-v2/model-provider";
import type { AnySessionStore } from "../agent-v2/session-context";
import type { AgentBudget, AgentCompletion, AgentExecutionPolicy, AgentId, AgentRequest, AgentResult, AgentRunner, ProfileReadResult } from "../agent-v2/multi-agent-contracts";
import { system, mockProvider, say, use, call, USER_A, type MockProvider, type Step, type WorldState } from "./m5-benchmark/harness";

const ALL: AgentId[] = ["progress", "recovery", "training", "nutrition"]; // = the supervisor's AGENT_ORDER (execution order)
const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
const adult = (age = 30): ProfileReadResult => ({ status: "PROFILE_OK", age });
const PERSONAL_TOOL: Record<AgentId, string> = { training: "training.get_today_schedule", nutrition: "nutrition.get_target", recovery: "recovery.get_recent_sessions", progress: "progress.get_body_measurements" };
const okScript = (a: AgentId): Step[] => [use(call(PERSONAL_TOOL[a])), say(`Gợi ý chung về ${a}.`)];
/** A model response that REPORTS a huge input usage (a provider can report more than the engine estimated). */
const hugeUsage = (text: string): AgentModelResponse => ({ ...say(text), usage: { inputTokens: 70_000, outputTokens: 10 } });

// ── sentences (each is exercised by the existing precedence / hybrid tests; their routing is re-asserted below, not assumed) ──
const Q: Record<AgentId, string> = {
  progress: "Tiến độ cân nặng của tôi tháng này ra sao?", recovery: "Bắp chân tôi còn ê, mai có nên chạy tiếp không?",
  training: "Hôm nay tôi tập gì?", nutrition: "Mục tiêu calo của tôi là bao nhiêu?",
};
const Q_TN = "Tối nay nên ăn gì, và mai tập nhóm cơ nào?"; // deterministic plan: training + nutrition
const Q_PR = "Tiến độ tháng này ra sao và tôi nên nghỉ mấy ngày?"; // deterministic plan: progress + recovery
const Q_PT = "Tiến độ của tôi thế nào, hôm nay tập gì?"; // deterministic plan: progress + training; "của tôi" => an ungrounded progress answer is INSUFFICIENT_DATA
const Q_PN ="Tiến độ tháng này ra sao, và tối nay ăn gì?"; // used with a routing model that names progress + nutrition
const Q_THREE = "Tôi tập chân hôm qua và hơi mệt, hôm nay nên tập gì và ăn gì?"; // deterministic: training + nutrition, recovery deferred
const Q_THREE_HYBRID = "Hôm nay tập gì, tối ăn gì, và tôi nên đi ngủ lúc mấy giờ?"; // routing model: training + nutrition + recovery
const Q_FOUR_HYBRID = "Tiến độ tháng này ra sao, tuần sau tập gì, ăn bao nhiêu và nghỉ mấy ngày?";
const BENCH = "Mức tạ bench của tôi tháng này có nhích lên không?"; // HIGH_RISK, own-data marker "của tôi", training
const HIGH_RISK: Array<{ id: string; q: string; routerSays: string[] }> = [
  { id: "bench", q: BENCH, routerSays: ["training"] },
  { id: "bench2", q: "Mức tạ bench tháng này nhích lên được bao nhiêu?", routerSays: ["training"] },
  { id: "whey", q: "Người mới có nên uống whey không?", routerSays: ["nutrition"] },
  { id: "cut", q: "Tôi muốn giảm 5kg trong 2 tuần thì tập và ăn thế nào?", routerSays: ["nutrition"] },
];
const Q_GEN = "Protein có vai trò gì trong việc xây cơ?";
const Q_OOS = "Thời tiết ngày mai ở Hà Nội thế nào?";
const V1_BLOCKED = ["Làm sao giảm 10kg trong 1 tuần?", "Mình đang đau ngực dữ dội và khó thở, phải làm gì?", "Em 15 tuổi, cho em thực đơn tăng cơ"];
const CHANGE_TRAINING = "Xoá buổi tập hôm nay đi."; // agent-level CONFIRMATION_REQUIRED (Training)
const CHANGE_NUTRITION = "Hãy lưu thực đơn này cho tôi."; // agent-level CONFIRMATION_REQUIRED (Nutrition)
const CHANGE_TWO = "Hãy giảm khối lượng buổi tập hôm nay giúp tôi vì tôi mệt."; // recovery + training, both CONFIRMATION_REQUIRED

// ── no network / paid provider for the whole file (counted) ──────────────────────────────────────────────────────────
let netCalls = 0;
const saved = { send: bedrockRuntimeDeps.send, fetch: globalThis.fetch, get: axios.get, post: axios.post };
test.before(() => {
  bedrockRuntimeDeps.send = (async () => { netCalls++; throw new Error("paid provider blocked"); }) as typeof bedrockRuntimeDeps.send;
  globalThis.fetch = (async () => { netCalls++; throw new Error("network blocked"); }) as typeof fetch;
  (axios as unknown as Record<string, unknown>).get = async () => { netCalls++; throw new Error("network blocked"); };
  (axios as unknown as Record<string, unknown>).post = async () => { netCalls++; throw new Error("network blocked"); };
});
test.after(() => { bedrockRuntimeDeps.send = saved.send; globalThis.fetch = saved.fetch; (axios as any).get = saved.get; (axios as any).post = saved.post; });

const downSync = (): AnySessionStore => ({ load: () => { throw new Error("store down"); }, save: () => { throw new Error("store down"); } });

// ── rig: REAL supervisor + REAL bounded agents; deterministic planner, or the hybrid provider over a counting routing model ──
type Mode = "deterministic" | "always";
type Wrap = Partial<Record<AgentId, (inner: AgentRunner) => AgentRunner>>;
interface RigOptions {
  mode?: Mode; reader?: ProfileReadResult | (() => Promise<ProfileReadResult>); store?: AnySessionStore; policy?: Partial<AgentExecutionPolicy>;
  wrap?: Wrap; enabled?: boolean; world?: Partial<WorldState>; routingModel?: AgentModelProvider;
}
function rig(o: RigOptions = {}) {
  const router: MockProvider = mockProvider("router");
  const events: string[] = [];
  const reads = { n: 0 };
  const deps: Record<string, unknown> = {};
  const s = system({ deps: deps as never, world: o.world, enabled: o.enabled });
  const inner = o.routingModel ?? router;
  const model: AgentModelProvider = { modelId: inner.modelId, supportsCancellation: inner.supportsCancellation, converse: (r) => { events.push("router"); return inner.converse(r); } };
  if ((o.mode ?? "deterministic") === "always") deps.decisionProvider = createHybridDecisionProvider({ model, maxAgents: 2, mode: "always" });
  deps.profileReader = async () => { reads.n++; const r = o.reader; return typeof r === "function" ? r() : r ?? adult(); };
  if (o.store) deps.sessionStore = o.store;
  if (o.policy) deps.executionPolicy = o.policy;
  const real = createAgentRunners({ providerFor: (a) => s.prov[a], deps: { training: s.w.training, nutrition: s.w.nutrition, recovery: s.w.recovery, progress: s.w.progress }, enabled: o.enabled ?? true, now: s.clock, toolTraceSink: () => {} });
  deps.runners = real.map((r) => { const w = o.wrap?.[r.capability.agentId]; return w ? w(r) : r; });
  const turn = async (q: string, x: { sessionId?: string; history?: Array<{ role: "user" | "assistant"; text: string }>; scripts?: Partial<Record<AgentId, Step[]>>; routerSays?: string[]; routerStep?: Step; context?: unknown } = {}) => {
    router.script(x.routerStep ?? ids(x.routerSays ?? ["training"]));
    for (const a of ALL) s.prov[a].script(...(x.scripts?.[a] ?? okScript(a)));
    const readsBefore = reads.n;
    const r: SupervisorResult = await s.ask(USER_A, q, { sessionId: x.sessionId ?? `ea-${Math.random().toString(36).slice(2, 10)}`, history: x.history, context: x.context });
    for (const p of Object.values(s.prov)) p.drain();
    router.drain();
    return { r, tr: s.traces[s.traces.length - 1] as SupervisorTrace, reads: reads.n - readsBefore };
  };
  const agentRequests = () => ALL.reduce((n, a) => n + s.prov[a].requests.length, 0);
  return { ...s, router, events, reads, turn, agentRequests };
}
type Rig = ReturnType<typeof rig>;
type Turn = Awaited<ReturnType<Rig["turn"]>>;

// ── stub runners (marked in the report as "stub runner") ─────────────────────────────────────────────────────────────
const throwing = (inner: AgentRunner): AgentRunner => ({ capability: inner.capability, async run() { throw new Error("runner exploded"); } });
const usage0 = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
const crafted = (inner: AgentRunner, make: (req: AgentRequest) => Partial<AgentResult>): AgentRunner => ({
  capability: inner.capability,
  async run(req) {
    return { delegationId: req.delegationId, agentId: inner.capability.agentId, agentTurnId: null, completion: "COMPLETE", agentStatus: "ANSWERED", answer: "", evidence: [], facts: {}, guardActions: [], usage: { ...usage0 }, ...make(req) };
  },
});
const blockedStub = (inner: AgentRunner) => crafted(inner, () => ({ completion: "BLOCKED", agentStatus: "CONFIRMATION_REQUIRED", answer: "Cần xác nhận trước khi thay đổi." }));
const rogue = (inner: AgentRunner, toolId: string, personal: boolean) => crafted(inner, (req) => ({
  answer: "ROGUE-TEXT mục tiêu 2400 kcal.",
  evidence: [{ agentId: inner.capability.agentId, delegationId: req.delegationId, toolId, outcome: "ok", personal }],
  usage: { modelCalls: 1, toolCalls: 1, inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.00004, latencyMs: 1 },
}));

// ── audit table (printed with EA_TABLE=1) and the universal relationship check ───────────────────────────────────────────
const table: string[] = [];
const NOT_RAN: ReadonlySet<AgentCompletion> = new Set(["SKIPPED", "BLOCKED", "POLICY_VIOLATION"]);
const deferredOf = (tr: SupervisorTrace) => (tr.decision?.dropped ?? []).filter((d) => /:(max_agents|from_session)$/.test(d)).map((d) => d.split(":")[0]);
/** executed ⊆ attempted ⊆ selected, deferred ∩ executed = ∅, execution order, no duplicates — for EVERY turn. */
function relation(t: Turn, why: string) {
  const sel: string[] = t.r.decision?.agents ?? [];
  const attempted = t.tr.delegations.map((d) => d.agentId);
  const ex = t.r.executedAgents;
  assert.ok(Array.isArray(ex), `${why}: executedAgents is an array`);
  assert.deepEqual(attempted, attempted.length ? sel : [], `${why}: either nothing was attempted (stopped before delegation) or EVERY selected agent was attempted, in order`);
  assert.deepEqual(t.r.results.map((r) => r.agentId), attempted, `${why}: results align with delegations`);
  for (const a of ex) assert.ok(attempted.includes(a), `${why}: executed ${a} was attempted`);
  for (const d of deferredOf(t.tr)) assert.ok(!ex.includes(d as AgentId), `${why}: deferred ${d} is never listed as executed`);
  assert.equal(new Set(ex).size, ex.length, `${why}: no duplicates`);
  assert.deepEqual(ex, ALL.filter((a) => ex.includes(a)), `${why}: execution (AGENT_ORDER) order`);
  assert.ok(ex.every((a) => ALL.includes(a)), `${why}: registered agent ids only`);
  // the oracle, spelled out from the contract (independent of executedAgentsOf)
  const oracle = t.r.results.filter((r) => !NOT_RAN.has(r.completion) && r.error?.code !== "RUNNER_THREW").map((r) => r.agentId);
  assert.deepEqual(ex, oracle, `${why}: executed == results whose runner returned a real attempt`);
  assert.notEqual(ex, t.r.decision?.agents, `${why}: not the selected-agents array (no aliasing)`);
}
function check(t: Turn, label: string, e: { status: string; agents: AgentId[]; selected: AgentId[] | null }) {
  relation(t, label);
  assert.equal(t.r.status, e.status, `${label}: status`);
  assert.deepEqual(t.r.executedAgents, e.agents, `${label}: executedAgents`);
  assert.deepEqual(t.r.decision ? t.r.decision.agents : null, e.selected, `${label}: decision.agents (selected)`);
  table.push(`${label} => status=${t.r.status} agents=${JSON.stringify(t.r.executedAgents)} selected=${JSON.stringify(t.r.decision ? t.r.decision.agents : null)} attempted=${JSON.stringify(t.tr.delegations.map((d) => `${d.agentId}:${d.completionStatus}`))} dropped=${JSON.stringify(t.tr.decision?.dropped ?? null)}`);
}
/** `routing` = the routing-model calls this turn legitimately made (hybrid, before the turn stopped); everything else must be zero. */
const noAgentRan = (s: Rig, t: Turn, why: string, routing = 0) => {
  assert.equal(t.tr.delegations.length, 0, `${why}: no delegation`); assert.equal(s.agentRequests(), 0, `${why}: zero agent model calls`);
  assert.deepEqual(s.w.calls, [], `${why}: zero domain tool calls`); assert.equal(t.tr.totals.modelCallCount, routing, `${why}: only the routing calls (${routing}) in the whole turn`);
};
const MODES: Mode[] = ["deterministic", "always"];

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// executedAgentsOf — the rule, for every completion
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const res = (agentId: AgentId, completion: AgentCompletion, error?: AgentResult["error"]): AgentResult => ({
  delegationId: `d-${agentId}`, agentId, agentTurnId: null, completion, agentStatus: completion, answer: "", evidence: [], facts: {}, guardActions: [], usage: { ...usage0 }, ...(error ? { error } : {}),
});
test("EA-0 executedAgentsOf: every AgentCompletion value + RUNNER_THREW + error codes + order + empty + no mutation", () => {
  // Record<AgentCompletion, boolean> makes the compiler force this table to cover EVERY completion value
  const listed: Record<AgentCompletion, boolean> = { COMPLETE: true, INSUFFICIENT_DATA: true, FAILED: true, BUDGET_EXHAUSTED: true, SKIPPED: false, BLOCKED: false, POLICY_VIOLATION: false };
  for (const [completion, expected] of Object.entries(listed) as Array<[AgentCompletion, boolean]>) {
    assert.deepEqual(executedAgentsOf([res("training", completion)]), expected ? ["training"] : [], completion);
  }
  // a runner that threw is FAILED + RUNNER_THREW -> NOT executed (never reported as run after an exception)
  assert.deepEqual(executedAgentsOf([res("training", "FAILED", { code: "RUNNER_THREW", retryable: false })]), []);
  // RUNNER_THREW excludes whatever completion it rides on (the contract is the error code, not only FAILED)
  for (const c of Object.keys(listed) as AgentCompletion[]) assert.deepEqual(executedAgentsOf([res("recovery", c, { code: "RUNNER_THREW", retryable: false })]), [], `RUNNER_THREW on ${c}`);
  // the engine's own failure (an agent that ran and failed) is listed, whatever its non-RUNNER_THREW code
  for (const code of ["AGENT_FAILED", "AGENT_TIMEOUT", "BUDGET_EXHAUSTED"] as const) assert.deepEqual(executedAgentsOf([res("progress", "FAILED", { code, retryable: false })]), ["progress"], `FAILED + ${code}`);
  assert.deepEqual(executedAgentsOf([res("nutrition", "BUDGET_EXHAUSTED")]), ["nutrition"], "an agent that STARTED and hit its budget ran");
  assert.deepEqual(executedAgentsOf([res("nutrition", "SKIPPED", { code: "BUDGET_EXHAUSTED", retryable: false })]), [], "an agent skipped for budget never ran (same error code, different completion)");
  assert.deepEqual(executedAgentsOf([res("nutrition", "POLICY_VIOLATION", { code: "POLICY_VIOLATION", retryable: false })]), []);
  // mixed, order preserved, input untouched
  const input = [res("progress", "COMPLETE"), res("recovery", "BLOCKED"), res("training", "INSUFFICIENT_DATA"), res("nutrition", "SKIPPED", { code: "BUDGET_EXHAUSTED", retryable: false })];
  const snapshot = structuredClone(input);
  const out = executedAgentsOf(input);
  assert.deepEqual(out, ["progress", "training"]); assert.deepEqual(input, snapshot, "the input is not mutated");
  assert.notEqual(out, input as unknown); out.push("nutrition"); assert.deepEqual(input, snapshot, "the returned list is a fresh array");
  assert.deepEqual(executedAgentsOf([]), []);
  // execution order of the SUPPLIED results is preserved (it is the supervisor's AGENT_ORDER at runtime), not sorted here
  assert.deepEqual(executedAgentsOf([res("nutrition", "COMPLETE"), res("progress", "COMPLETE")]), ["nutrition", "progress"]);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ran -> listed
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const mode of MODES) {
  test(`EA-1 [${mode}] ONE agent ran (ANSWERED): the list is exactly that agent, for each of the four agents`, async () => {
    for (const a of ALL) {
      const s = rig({ mode }); const t = await s.turn(Q[a], { routerSays: [a] });
      check(t, `${mode}/single/${a}`, { status: "ANSWERED", agents: [a], selected: [a] });
      assert.deepEqual(t.tr.delegations.map((d) => d.completionStatus), ["COMPLETE"], a);
      assert.equal(s.router.requests.length, mode === "always" ? 1 : 0, `${a}: routing calls`); assert.equal(t.reads, 1, `${a}: one profile read`);
      assert.ok(s.agentRequests() > 0 && s.w.calls.length >= 1, `${a}: the agent really ran and read`);
    }
  });
}

test("EA-2 [deterministic] TWO agents ran: both, in execution order (not the planner's / the model's order)", async () => {
  const tn = rig(); const a = await tn.turn(Q_TN);
  check(a, "deterministic/two/training+nutrition", { status: "ANSWERED", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
  const pr = rig(); const b = await pr.turn(Q_PR);
  check(b, "deterministic/two/progress+recovery", { status: "ANSWERED", agents: ["progress", "recovery"], selected: ["progress", "recovery"] });
  assert.deepEqual(b.tr.delegations.map((d) => d.agentId), ["progress", "recovery"]);
});

test("EA-2b [always] TWO agents ran: the model names them in a different order, the list follows EXECUTION order (progress, recovery, training, nutrition)", async () => {
  for (const [says, q, expected] of [
    [["nutrition", "training"], Q_TN, ["training", "nutrition"]], [["nutrition", "progress"], Q_PN, ["progress", "nutrition"]], [["training", "recovery"], Q_TN, ["recovery", "training"]],
  ] as Array<[string[], string, AgentId[]]>) {
    const s = rig({ mode: "always" }); const t = await s.turn(q, { routerSays: says });
    check(t, `always/two/${says.join("+")}`, { status: "ANSWERED", agents: expected, selected: expected });
    assert.equal(s.router.requests.length, 1, "one routing call"); assert.equal(t.reads, 1);
  }
});

test("EA-3 THREE needed, cap 2: only the two that ran are listed; the deferred one is NOT listed (but stays in decision / dropped / the answer note)", async () => {
  const d = rig(); const t = await d.turn(Q_THREE);
  check(t, "deterministic/three-cap2", { status: "PARTIAL", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
  assert.deepEqual(t.tr.decision!.dropped, ["recovery:max_agents"]); assert.ok(!t.r.executedAgents.includes("recovery")); assert.match(t.r.answer, /phục hồi[^\n]*chưa được xử lý trong lượt này/);
  assert.equal(d.prov.recovery.requests.length, 0, "the deferred agent made no model call");
  const h = rig({ mode: "always" }); const u = await h.turn(Q_THREE_HYBRID, { routerSays: ["training", "nutrition", "recovery"] });
  check(u, "always/three-cap2", { status: "PARTIAL", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
  assert.ok(u.tr.decision!.dropped.includes("recovery:max_agents")); assert.deepEqual(deferredOf(u.tr), ["recovery"]);
  assert.deepEqual(u.tr.hybridRouting!.detectedAgentIds, ["training", "nutrition", "recovery"], "the router detected three");
  assert.deepEqual(u.tr.hybridRouting!.deferredAgentIds, ["recovery"]); assert.equal(h.prov.recovery.requests.length, 0);
});

test("EA-3b FOUR detected, cap 2: exactly the two selected ran; every deferred agent is absent from the list and named in dropped", async () => {
  const h = rig({ mode: "always" }); const t = await h.turn(Q_FOUR_HYBRID, { routerSays: ["progress", "training", "nutrition", "recovery"] });
  relation(t, "four");
  assert.equal(t.r.status, "PARTIAL"); assert.equal(t.r.executedAgents.length, 2); assert.deepEqual(t.r.executedAgents, t.r.decision!.agents);
  const deferred = deferredOf(t.tr); assert.equal(deferred.length, 2);
  assert.deepEqual([...t.r.executedAgents, ...deferred].sort(), [...ALL].sort(), "executed + deferred = the four, disjoint");
  for (const a of deferred) assert.equal(h.prov[a as AgentId].requests.length, 0, `${a}: deferred, no model call`);
  table.push(`always/four-cap2 => status=${t.r.status} agents=${JSON.stringify(t.r.executedAgents)} deferred=${JSON.stringify(deferred)}`);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ran but did not (fully) succeed -> still listed; the status says how it went
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const mode of MODES) {
  test(`EA-4 [${mode}] INSUFFICIENT_DATA (the agent ran, found nothing grounded) IS listed: single -> INSUFFICIENT_DATA, with a completing partner -> PARTIAL`, async () => {
    const s = rig({ mode }); const t = await s.turn(Q.progress, { routerSays: ["progress"], scripts: { progress: [say("Mình đoán tiến độ của bạn tốt.")] } });
    check(t, `${mode}/insufficient/single`, { status: "INSUFFICIENT_DATA", agents: ["progress"], selected: ["progress"] });
    assert.equal(t.r.results[0].completion, "INSUFFICIENT_DATA"); assert.equal(t.r.results[0].agentStatus, "UNGROUNDED"); assert.ok(s.agentRequests() >= 1, "it made a model call: it ran");
    const m = rig({ mode }); const u = await m.turn(Q_PT, { routerSays: ["progress", "training"], scripts: { progress: [say("Mình đoán tiến độ của bạn tốt.")] } });
    check(u, `${mode}/insufficient/with-partner`, { status: "PARTIAL", agents: ["progress", "training"], selected: ["progress", "training"] });
    assert.deepEqual(u.r.results.map((r) => r.completion), ["INSUFFICIENT_DATA", "COMPLETE"]);
  });

  test(`EA-5 [${mode}] FAILED (the agent's OWN loop failed and RETURNED: provider error) IS listed — unlike a runner that threw; single -> FAILED, with a completing partner -> PARTIAL`, async () => {
    const boom: Step = () => { throw new Error("provider exploded"); };
    const s = rig({ mode }); const t = await s.turn(Q.training, { routerSays: ["training"], scripts: { training: [boom] } });
    check(t, `${mode}/failed-returned/single`, { status: "FAILED", agents: ["training"], selected: ["training"] });
    assert.equal(t.r.results[0].completion, "FAILED"); assert.equal(t.r.results[0].agentStatus, "PROVIDER_ERROR"); assert.equal(t.r.results[0].error?.code, "AGENT_FAILED");
    const m = rig({ mode }); const u = await m.turn(Q_TN, { routerSays: ["training", "nutrition"], scripts: { training: [boom] } });
    check(u, `${mode}/failed-returned/with-partner`, { status: "PARTIAL", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
    assert.ok(!/Gợi ý chung về training/.test(u.r.answer), "the failed agent's section is a 'could not answer' note, not a fabricated answer");
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// attempted but did NOT run -> NOT listed
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const mode of MODES) {
  test(`EA-6 [${mode}] PARTIAL by budget: the first completes, the second is budget-SKIPPED -> PARTIAL, only the first listed; the skipped one stays in trace.delegations and decision`, async () => {
    const s = rig({ mode }); const t = await s.turn(Q_TN, { routerSays: ["training", "nutrition"], scripts: { training: [use(call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] } });
    check(t, `${mode}/partial-budget-skip`, { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
    assert.deepEqual(t.tr.delegations.map((d) => [d.agentId, d.completionStatus]), [["training", "COMPLETE"], ["nutrition", "SKIPPED"]], "attempted = selected, incl. the SKIPPED one");
    assert.ok(t.tr.budget.overrun.includes("maxInputTokens"), "the first agent's reported usage overran the turn budget");
    assert.equal(s.prov.nutrition.requests.length, 0, "the skipped agent made no model call"); assert.equal(t.r.results[1].error?.code, "BUDGET_EXHAUSTED");
    assert.deepEqual(t.tr.decision!.dropped, [], "nothing deferred: the skipped agent was SELECTED and attempted");
    assert.match(t.r.answer, /Phần dinh dưỡng: chưa xử lý kịp/, "the skipped part is disclosed in the answer");
  });

  test(`EA-7 [${mode}] a runner that THREW is NOT listed (FAILED + RUNNER_THREW): second throws -> PARTIAL [first]; first throws -> PARTIAL [second]; both throw -> FAILED []. No fabricated success.`, async () => {
    const a = rig({ mode, wrap: { nutrition: throwing } }); const t1 = await a.turn(Q_TN, { routerSays: ["training", "nutrition"] });
    check(t1, `${mode}/runner-threw/second`, { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
    assert.deepEqual(t1.tr.delegations.map((d) => [d.agentId, d.completionStatus, d.agentStatus]), [["training", "COMPLETE", "ANSWERED"], ["nutrition", "FAILED", "FAILED"]]);
    assert.deepEqual([t1.r.results[1].completion, t1.r.results[1].error?.code], ["FAILED", "RUNNER_THREW"]);
    assert.ok(!t1.r.answer.includes("Gợi ý chung về nutrition") && /Phần dinh dưỡng: trợ lý tạm thời chưa trả lời được/.test(t1.r.answer), "no fabricated success for the thrown agent");
    const b = rig({ mode, wrap: { training: throwing } }); const t2 = await b.turn(Q_TN, { routerSays: ["training", "nutrition"] });
    check(t2, `${mode}/runner-threw/first`, { status: "PARTIAL", agents: ["nutrition"], selected: ["training", "nutrition"] });
    const c = rig({ mode, wrap: { training: throwing, nutrition: throwing } }); const t3 = await c.turn(Q_TN, { routerSays: ["training", "nutrition"] });
    check(t3, `${mode}/runner-threw/both`, { status: "FAILED", agents: [], selected: ["training", "nutrition"] });
    assert.deepEqual(t3.r.executedAgents, [], "an exception is not an execution");
    const d = rig({ mode, wrap: { training: throwing } }); const t4 = await d.turn(Q.training, { routerSays: ["training"] });
    check(t4, `${mode}/runner-threw/single`, { status: "FAILED", agents: [], selected: ["training"] });
  });

  test(`EA-8 [${mode}] agent-level BLOCKED (the agent's own CONFIRMATION_REQUIRED gate, real engine) is NOT listed: single and double; no model call, no domain call`, async () => {
    for (const [q, says, sel] of [[CHANGE_TRAINING, ["training"], ["training"]], [CHANGE_NUTRITION, ["nutrition"], ["nutrition"]], [CHANGE_TWO, ["recovery", "training"], ["recovery", "training"]]] as Array<[string, string[], AgentId[]]>) {
      const s = rig({ mode }); const t = await s.turn(q, { routerSays: says });
      check(t, `${mode}/agent-blocked/${sel.join("+")}`, { status: "BLOCKED", agents: [], selected: sel });
      assert.ok(t.r.results.every((r) => r.completion === "BLOCKED" && r.agentStatus === "CONFIRMATION_REQUIRED"), q);
      assert.equal(s.agentRequests(), 0, `${q}: the agent refused before any model call`); assert.deepEqual(s.w.calls, [], `${q}: no domain call (and no WRITE)`);
      assert.equal(t.tr.delegations.length, sel.length, "attempted = selected");
    }
  });

  test(`EA-8b [${mode}] BLOCKED + COMPLETE in one turn (stub runner for the blocked one): PARTIAL, only the completing agent listed`, async () => {
    const s = rig({ mode, wrap: { nutrition: blockedStub } }); const t = await s.turn(Q_TN, { routerSays: ["training", "nutrition"] });
    check(t, `${mode}/blocked+complete (stub runner)`, { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
    assert.deepEqual(t.r.results.map((r) => r.completion), ["COMPLETE", "BLOCKED"]);
  });

  test(`EA-9 [${mode}] POLICY_VIOLATION (a foreign tool in evidence; stub runner) is NOT listed, its text is withheld, conflict recorded; with a completing partner -> PARTIAL`, async () => {
    const s = rig({ mode, wrap: { nutrition: (r) => rogue(r, "training.get_today_schedule", false) } }); const t = await s.turn(Q_TN, { routerSays: ["training", "nutrition"] });
    check(t, `${mode}/policy-violation/second (stub runner)`, { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
    assert.deepEqual(t.r.conflicts, ["policy_violation:nutrition"]); assert.ok(!t.r.answer.includes("ROGUE-TEXT") && !t.r.answer.includes("2400"), "the violating text never reaches the user");
    assert.deepEqual(t.r.results.map((r) => r.completion), ["COMPLETE", "POLICY_VIOLATION"]);
    const m = rig({ mode, wrap: { nutrition: (r) => rogue(r, "training.get_today_schedule", false) } }); const u = await m.turn(Q.nutrition, { routerSays: ["nutrition"] });
    check(u, `${mode}/policy-violation/single (stub runner)`, { status: "FAILED", agents: [], selected: ["nutrition"] });
    // a personal read on a GENERAL-ONLY turn (verified minor + general question) is the other policy-violation path
    const g = rig({ mode, reader: adult(16), wrap: { nutrition: (r) => rogue(r, "nutrition.get_target", true) } }); const v = await g.turn(Q_GEN, { routerSays: ["nutrition"] });
    check(v, `${mode}/policy-violation/personal-on-general (stub runner)`, { status: "FAILED", agents: [], selected: ["nutrition"] });
    assert.deepEqual(v.r.conflicts, ["policy_violation:nutrition"]); assert.ok(!v.r.answer.includes("2400"));
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// budget
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EA-10 BUDGET_EXHAUSTED before any agent ran -> []: (a) always: a routing call that eats the budget (HH-20), (b) deterministic: tiny execution budget, one and two agents, (c) routing consumed the wall time", async () => {
  // (a) hybrid: the routing usage is part of the GLOBAL budget
  const a = rig({ mode: "always" });
  const ta = await a.turn(Q.training, { routerStep: { ...ids(["training"]), usage: { inputTokens: 70_000, outputTokens: 10 } } });
  check(ta, "always/budget/routing-usage", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training"] });
  assert.deepEqual(ta.tr.delegations.map((d) => d.completionStatus), ["SKIPPED"]); assert.ok(ta.tr.budget.overrun.includes("maxInputTokens")); assert.equal(a.agentRequests(), 0); assert.deepEqual(a.w.calls, []);
  const a2 = rig({ mode: "always" });
  const ta2 = await a2.turn(Q_TN, { routerStep: { ...ids(["training", "nutrition"]), usage: { inputTokens: 70_000, outputTokens: 10 } } });
  check(ta2, "always/budget/routing-usage/two", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training", "nutrition"] });
  assert.deepEqual(ta2.tr.delegations.map((d) => d.completionStatus), ["SKIPPED", "SKIPPED"]);
  // (b) deterministic: an execution policy with no model calls left
  const none: AgentBudget = { ...SUPERVISOR_BUDGET, maxModelCalls: 0 };
  for (const [q, sel] of [[Q.training, ["training"]], [Q_TN, ["training", "nutrition"]]] as Array<[string, AgentId[]]>) {
    const b = rig({ policy: { budget: none } }); const tb = await b.turn(q);
    check(tb, `deterministic/budget/zero-model-calls/${sel.join("+")}`, { status: "BUDGET_EXHAUSTED", agents: [], selected: sel });
    assert.ok(tb.tr.delegations.every((d) => d.completionStatus === "SKIPPED"), "every delegation SKIPPED"); assert.equal(b.agentRequests(), 0); assert.deepEqual(b.w.calls, []);
    assert.equal(tb.r.answer.length > 0, true);
  }
  const zeroCost = rig({ policy: { budget: { ...SUPERVISOR_BUDGET, maxCostUsd: 0 } } }); check(await zeroCost.turn(Q.training), "deterministic/budget/zero-cost", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training"] });
  // (c) a routing call that consumes the turn's wall time: the delegations get no time
  const c = rig({ mode: "always" });
  const tc = await c.turn(Q.training, { routerStep: async () => { c.advance(59_000); return ids(["training"]); } });
  check(tc, "always/budget/routing-wall-time", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training"] });
  assert.equal(tc.tr.delegations[0]?.completionStatus, "SKIPPED"); assert.equal(c.prov.training.requests.length, 0);
});

test("EA-10b an agent that STARTED and then ran out of budget IS listed (completion BUDGET_EXHAUSTED, not SKIPPED): status BUDGET_EXHAUSTED, agents [it]", async () => {
  // one model call in total: the agent's tool round uses it, the next admission refuses -> the engine returns BUDGET_EXHAUSTED itself
  const s = rig({ policy: { budget: { ...SUPERVISOR_BUDGET, maxModelCalls: 1 } } }); const t = await s.turn(Q.training);
  check(t, "deterministic/budget/started-then-exhausted", { status: "BUDGET_EXHAUSTED", agents: ["training"], selected: ["training"] });
  assert.deepEqual([t.r.results[0].completion, t.r.results[0].agentStatus], ["BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED"]); assert.equal(t.r.results[0].error, undefined);
  assert.equal(s.prov.training.requests.length, 1, "it really made its one model call");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// turns that never reach a delegation -> [] while the selection may be non-empty
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const mode of MODES) {
  test(`EA-11 [${mode}] MINOR_PROTECTED (verified profile 16, HIGH_RISK): agents [] while decision.agents (selected) is NON-empty; nothing ran`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ mode, reader: adult(16) }); const t = await s.turn(q);
      relation(t, `${mode}/minor/${id}`);
      assert.equal(t.r.status, "MINOR_PROTECTED", id); assert.deepEqual(t.r.executedAgents, [], id); assert.ok(t.r.decision!.agents.length > 0, `${id}: selected is non-empty`);
      if (id === "bench") assert.deepEqual(t.r.decision!.agents, ["training"]);
      noAgentRan(s, t, `${mode}/minor/${id}`); assert.equal(t.reads, 1, id); assert.equal(s.router.requests.length, 0, `${id}: no routing call for a minor`);
      table.push(`${mode}/minor/${id} => status=${t.r.status} agents=[] selected=${JSON.stringify(t.r.decision!.agents)}`);
    }
    const c = rig({ mode, reader: adult(30) }); const t = await c.turn("Em 15 tuổi, mức tạ bench của em tháng này có nhích lên không?");
    assert.equal(t.r.status, "MINOR_PROTECTED"); assert.deepEqual(t.r.executedAgents, []); assert.ok(t.r.decision!.agents.length > 0); noAgentRan(c, t, "self-reported minor");
  });

  test(`EA-12 [${mode}] PROFILE_UNVERIFIED (profile denied / unavailable / reader throws; and AGE_UNKNOWN + an own-data HIGH_RISK ask): agents [] while decision.agents is NON-empty`, async () => {
    const readers: Array<[string, ProfileReadResult | (() => Promise<ProfileReadResult>), string[]]> = [
      ["denied", { status: "PROFILE_ACCESS_DENIED" }, HIGH_RISK.map((x) => x.id)], ["unavailable", { status: "PROFILE_UNAVAILABLE" }, ["bench", "whey"]],
      ["reader throws", async () => { throw new Error("reader exploded"); }, ["bench", "cut"]], ["age unknown", { status: "AGE_UNKNOWN" }, ["bench", "adult-claim"]],
    ];
    // AGE_UNKNOWN blocks a HIGH_RISK ask only when it is personal (own-data marker "của tôi"); a self-stated adult age unlocks nothing
    const asks = [...HIGH_RISK, { id: "adult-claim", q: `Tôi 30 tuổi, ${BENCH.charAt(0).toLowerCase()}${BENCH.slice(1)}`, routerSays: ["training"] }];
    for (const [name, reader, only] of readers) for (const { id, q } of asks.filter((x) => only.includes(x.id))) {
      const s = rig({ mode, reader }); const t = await s.turn(q);
      relation(t, `${mode}/${name}/${id}`);
      assert.equal(t.r.status, "PROFILE_UNVERIFIED", `${name}/${id}`); assert.deepEqual(t.r.executedAgents, [], `${name}/${id}`); assert.ok(t.r.decision!.agents.length > 0, `${name}/${id}: selected non-empty`);
      noAgentRan(s, t, `${mode}/${name}/${id}`); assert.equal(t.reads, 1, `${name}/${id}: one profile read`);
      table.push(`${mode}/${name}/${id} => status=${t.r.status} agents=[] selected=${JSON.stringify(t.r.decision!.agents)}`);
    }
  });

  test(`EA-13 [${mode}] SESSION_UNAVAILABLE (store down, sync throw and async reject): agents [] while decision.agents is NON-empty; nothing ran`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ mode, store: downSync() }); const t = await s.turn(q, { sessionId: "ea13" });
      relation(t, `${mode}/session-down/${id}`);
      assert.equal(t.r.status, "SESSION_UNAVAILABLE", id); assert.deepEqual(t.r.executedAgents, [], id); assert.ok(t.r.decision!.agents.length > 0, `${id}: selected non-empty`);
      noAgentRan(s, t, `${mode}/session-down/${id}`);
      table.push(`${mode}/session-down/${id} => status=${t.r.status} agents=[] selected=${JSON.stringify(t.r.decision!.agents)}`);
    }
    // the same store failure on a turn that states a minor age (persist-first path): SESSION_UNAVAILABLE before routing (decision null)
    const m = rig({ mode, store: downSync() }); const t = await m.turn("Em 15 tuổi, em nên uống bao nhiêu nước mỗi ngày?", { sessionId: "ea13m" });
    check(t, `${mode}/session-down/persist-minor-statement`, { status: "SESSION_UNAVAILABLE", agents: [], selected: null }); noAgentRan(m, t, "persist-first");
  });

  test(`EA-14 [${mode}] SAFETY_BLOCKED (V1 preflight; decision null), OUT_OF_SCOPE, INVALID_INPUT, UNAUTHENTICATED, DISABLED: agents []`, async () => {
    for (const q of V1_BLOCKED) for (const reader of [adult(16), adult(30), { status: "AGE_UNKNOWN" } as ProfileReadResult]) {
      assert.equal(checkInputSafety(q).safe, false, q);
      const s = rig({ mode, reader }); const t = await s.turn(q);
      check(t, `${mode}/safety-blocked/${q.slice(0, 18)}`, { status: "SAFETY_BLOCKED", agents: [], selected: null });
      assert.equal(s.reads.n, 0, "V1 block: no profile read"); assert.equal(s.router.requests.length, 0, "V1 block: no routing call"); noAgentRan(s, t, q);
    }
    const o = rig({ mode }); const to = await o.turn(Q_OOS, { routerSays: [] });
    check(to, `${mode}/out-of-scope`, { status: "OUT_OF_SCOPE", agents: [], selected: [] }); noAgentRan(o, to, "oos", o.router.requests.length); assert.equal(o.router.requests.length, mode === "always" ? 1 : 0);
    const i1 = rig({ mode }); check(await i1.turn("   "), `${mode}/invalid/blank`, { status: "INVALID_INPUT", agents: [], selected: null });
    const i2 = rig({ mode }); check(await i2.turn("a".repeat(2_001)), `${mode}/invalid/too-long`, { status: "INVALID_INPUT", agents: [], selected: null });
    const u = rig({ mode }); const tu = await u.turn(Q.training, { context: {} });
    check(tu, `${mode}/unauthenticated`, { status: "UNAUTHENTICATED", agents: [], selected: null }); assert.equal(u.reads.n, 0); assert.equal(u.router.requests.length, 0);
    const d = rig({ mode, enabled: false }); const td = await d.turn(Q.training);
    check(td, `${mode}/disabled`, { status: "DISABLED", agents: [], selected: null }); assert.equal(d.reads.n, 0); assert.equal(d.router.requests.length, 0); noAgentRan(d, td, "disabled");
  });
}

for (const [name, step, code] of [
  ["throttled", () => { throw new AgentProviderError("throttled", "429"); }, "PROVIDER_RATE_LIMITED"],
  ["invalid output", say("tôi nghĩ là training"), "INVALID_OUTPUT"],
  ["extra keys", say(JSON.stringify({ agentIds: ["training"], why: "x" })), "INVALID_OUTPUT"],
] as Array<[string, Step, string]>) {
  test(`EA-15 [always] ROUTING_UNDETERMINED (verified adult + HIGH_RISK + routing model ${name}): agents [] and nothing selected either; one routing attempt`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ mode: "always", reader: adult(30) }); const t = await s.turn(q, { routerStep: step });
      check(t, `always/routing-undetermined/${name}/${id}`, { status: "ROUTING_UNDETERMINED", agents: [], selected: [] });
      assert.equal(s.router.requests.length, 1, `${id}: one attempt`); assert.equal(t.tr.hybridRouting?.fallbackReasonCode, code, id);
      assert.equal(t.tr.totals.modelCallCount, 1, `${id}: only the routing attempt was spent`); assert.equal(s.agentRequests(), 0); assert.deepEqual(s.w.calls, []);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// selected vs executed vs deferred stay distinguishable in the internal trace — exact relationship for PARTIAL turns
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EA-16 trace relationship on PARTIAL turns: decision.agents = selected, decision.dropped = deferred codes, delegations = attempted (incl. SKIPPED / thrown), executedAgents = ran — exact sets", async () => {
  const cases: Array<{ name: string; make: () => Rig; q: string; says?: string[]; scripts?: Partial<Record<AgentId, Step[]>>; mode: Mode;
    selected: AgentId[]; dropped: string[]; attempted: Array<[AgentId, AgentCompletion]>; executed: AgentId[] }> = [
    { name: "budget-skip", make: () => rig(), mode: "deterministic", q: Q_TN, scripts: { training: [use(call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] },
      selected: ["training", "nutrition"], dropped: [], attempted: [["training", "COMPLETE"], ["nutrition", "SKIPPED"]], executed: ["training"] },
    { name: "runner-threw", make: () => rig({ wrap: { nutrition: throwing } }), mode: "deterministic", q: Q_TN,
      selected: ["training", "nutrition"], dropped: [], attempted: [["training", "COMPLETE"], ["nutrition", "FAILED"]], executed: ["training"] },
    { name: "cap-deferred", make: () => rig(), mode: "deterministic", q: Q_THREE,
      selected: ["training", "nutrition"], dropped: ["recovery:max_agents"], attempted: [["training", "COMPLETE"], ["nutrition", "COMPLETE"]], executed: ["training", "nutrition"] },
    { name: "cap-deferred + skip", make: () => rig(), mode: "deterministic", q: Q_THREE, scripts: { training: [use(call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] },
      selected: ["training", "nutrition"], dropped: ["recovery:max_agents"], attempted: [["training", "COMPLETE"], ["nutrition", "SKIPPED"]], executed: ["training"] },
    { name: "hybrid cap-deferred + thrown", make: () => rig({ mode: "always", wrap: { training: throwing } }), mode: "always", q: Q_THREE_HYBRID, says: ["training", "nutrition", "recovery"],
      selected: ["training", "nutrition"], dropped: ["recovery:max_agents"], attempted: [["training", "FAILED"], ["nutrition", "COMPLETE"]], executed: ["nutrition"] },
  ];
  for (const c of cases) {
    const s = c.make(); const t = await s.turn(c.q, { routerSays: c.says ?? c.selected, scripts: c.scripts });
    relation(t, c.name);
    assert.equal(t.r.status, "PARTIAL", c.name);
    assert.deepEqual(t.tr.decision!.agents, c.selected, `${c.name}: trace.decision.agents = selected`); assert.deepEqual(t.r.decision!.agents, c.selected, `${c.name}: result.decision.agents = selected`);
    assert.deepEqual(t.tr.decision!.dropped, c.dropped, `${c.name}: trace.decision.dropped = deferred codes`);
    assert.deepEqual(t.tr.delegations.map((d) => [d.agentId, d.completionStatus]), c.attempted, `${c.name}: trace.delegations = attempted`);
    assert.deepEqual(t.r.executedAgents, c.executed, `${c.name}: result.executedAgents = ran`);
    // selected / executed / deferred are three different sets on a partial turn: executed ⊆ selected, and the gap to the full ask is either a
    // selected-but-not-run agent (skipped / thrown) or a deferred one (cap) — never the same list
    assert.ok(c.executed.every((a) => c.selected.includes(a)), `${c.name}: executed ⊆ selected`);
    assert.ok(c.executed.length < c.selected.length || c.dropped.length > 0, `${c.name}: something selected did not run, or something was deferred`);
    table.push(`${c.name} => selected=${JSON.stringify(c.selected)} deferred=${JSON.stringify(deferredOf(t.tr))} attempted=${JSON.stringify(t.tr.delegations.map((d) => `${d.agentId}:${d.completionStatus}`))} executed=${JSON.stringify(t.r.executedAgents)}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// no extra calls, no double read; result shape; privacy; no aliasing
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EA-17 no extra model calls and no profile double read: routing calls / agent calls / profile reads are exactly what the selection implies, for ran and not-ran agents alike", async () => {
  const rows: Array<{ name: string; make: () => Rig; q: string; mode: Mode; says?: string[]; scripts?: Partial<Record<AgentId, Step[]>>; reader?: ProfileReadResult; router: number; reads: number }> = [
    { name: "single ANSWERED", make: () => rig(), mode: "deterministic", q: Q.training, router: 0, reads: 1 },
    { name: "single ANSWERED (hybrid)", make: () => rig({ mode: "always" }), mode: "always", q: Q.training, says: ["training"], router: 1, reads: 1 },
    { name: "two ANSWERED", make: () => rig(), mode: "deterministic", q: Q_TN, router: 0, reads: 1 },
    { name: "two, runner threw", make: () => rig({ wrap: { nutrition: throwing } }), mode: "deterministic", q: Q_TN, router: 0, reads: 1 },
    { name: "two, budget-skip", make: () => rig({ mode: "always" }), mode: "always", q: Q_TN, says: ["training", "nutrition"], scripts: { training: [use(call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] }, router: 1, reads: 1 },
    { name: "agent BLOCKED", make: () => rig({ mode: "always" }), mode: "always", q: CHANGE_TWO, says: ["recovery", "training"], router: 1, reads: 1 },
    { name: "minor (hybrid)", make: () => rig({ mode: "always", reader: adult(16) }), mode: "always", q: BENCH, says: ["training"], router: 0, reads: 1 },
    { name: "denied (hybrid)", make: () => rig({ mode: "always", reader: { status: "PROFILE_ACCESS_DENIED" } }), mode: "always", q: BENCH, says: ["training"], router: 0, reads: 1 },
    { name: "session down (hybrid)", make: () => rig({ mode: "always", store: downSync() }), mode: "always", q: BENCH, says: ["training"], router: 0, reads: 1 },
    { name: "V1 safety block", make: () => rig({ mode: "always" }), mode: "always", q: V1_BLOCKED[0], router: 0, reads: 0 },
  ];
  for (const r of rows) {
    const s = r.make(); const t = await s.turn(r.q, { routerSays: r.says, scripts: r.scripts, sessionId: "ea17" });
    assert.equal(s.router.requests.length, r.router, `${r.name}: routing calls`);
    assert.equal(t.reads, r.reads, `${r.name}: profile reads in the turn`); assert.equal(s.reads.n, r.reads, `${r.name}: profile reads total`);
    const delegated = t.tr.delegations.reduce((n, d) => n + d.modelCallCount, 0);
    assert.equal(s.agentRequests(), delegated, `${r.name}: every agent model call is in the delegation trace (and a thrown / skipped / blocked agent made none)`);
    assert.equal(t.tr.totals.modelCallCount, r.router + delegated, `${r.name}: totals = routing + agents — nothing added by the executed-agents list`);
    relation(t, r.name);
  }
});

test("EA-18 SupervisorResult shape: exactly the previous keys + executedAgents; executedAgents is a fresh array of AgentIds, not an alias of decision.agents", async () => {
  const KEYS = ["answer", "conflicts", "decision", "executedAgents", "provenance", "results", "status", "supervisorTraceId", "turnId"];
  for (const [label, s, q] of [["ran", rig(), Q_TN], ["blocked", rig({ reader: adult(16) }), BENCH], ["v1 block", rig(), V1_BLOCKED[0]]] as Array<[string, Rig, string]>) {
    const t = await s.turn(q);
    assert.deepEqual(Object.keys(t.r).sort(), KEYS, label);
    assert.ok(t.r.executedAgents.every((a) => ALL.includes(a)), label);
    if (t.r.decision) { t.r.executedAgents.push("progress"); assert.ok(!t.r.decision.agents.includes("progress"), `${label}: mutating the public list does not touch the selection`); }
  }
});

test("EA-19 trace privacy on executed / not-executed turns: no question text, age, bearer token or user id in any supervisor / agent trace", async () => {
  const scenarios: Array<[string, Rig, string]> = [
    ["two ran", rig(), Q_TN], ["thrown", rig({ wrap: { nutrition: throwing } }), Q_TN], ["agent blocked", rig(), CHANGE_TRAINING], ["minor 16", rig({ reader: adult(16) }), BENCH],
    ["age unknown", rig({ reader: { status: "AGE_UNKNOWN" } }), BENCH], ["hybrid", rig({ mode: "always" }), Q_PN],
  ];
  for (const [name, s, q] of scenarios) {
    await s.turn(q, { routerSays: ["progress", "nutrition"] });
    const all = JSON.stringify([s.traces, s.agentTraces]);
    for (const bad of [q, "Bearer", "tok-1111", USER_A, "Em 15 tuổi", "dateOfBirth"]) assert.ok(!all.includes(bad), `${name}: ${bad}`);
    assert.ok(!/"age"\s*:/.test(all), `${name}: no age field`); assert.ok(!/"age":\s*16/.test(all), name);
  }
});

test("EA-20 audit table (set EA_TABLE=1 to print) and zero network / Bedrock / axios calls in the whole file", () => {
  if (process.env.EA_TABLE === "1") console.log(`\n--- EA audit table (${table.length} rows) ---\n${table.join("\n")}\n---`);
  assert.ok(table.length > 40, `the audit table was filled (${table.length})`);
  assert.equal(netCalls, 0);
});
