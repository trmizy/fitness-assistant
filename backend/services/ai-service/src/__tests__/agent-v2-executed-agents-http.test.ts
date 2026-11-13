/**
 * V2 PUBLIC `agents` = EXECUTED agents only (owner decision B, M7-P5A.2.2). HTTP level.
 *
 * See agent-v2-executed-agents.test.ts for the contract. Here the same matrix is driven through POST /ai/v2/ask and the PUBLIC
 * response body is what is asserted: `data.agents` lists only the agents whose runner actually ran (COMPLETE / INSUFFICIENT_DATA /
 * FAILED-and-returned / started-then-BUDGET_EXHAUSTED); never the selected, planned or deferred ones, and never an agent that was
 * budget-skipped, blocked by its own gate, withheld for a policy violation, or whose runner threw.
 *
 * Evidence label: CONTROLLER INTEGRATION over the REAL ai-service `app` with supertest (real flag gate, requireAuth, strict body,
 * composition root `createMultiAgentRuntime` with `routingModelFactory` chosen by AI_AGENT_V2_ROUTING_MODE, real supervisor, real
 * hybrid provider, four bounded agents, registries, the REAL profile reader over the V1 service client). Replaced only: auth token
 * verification, the HTTP transport (axios adapter, no socket), the agents' models, the ROUTING model (counting mock) and the domain
 * READ deps (synthetic fixtures). Rows marked "TEST FIXTURE composition" use a hand-built runtime (REAL route + REAL supervisor +
 * REAL catalog runners + REAL profile reader) around which ONE runner is replaced by a stub (a runner that throws / a policy
 * violation / a crafted BLOCKED) or the execution budget is tightened — createMultiAgentRuntime offers no seam for either. NOT a
 * REAL BROWSER / REAL HTTP run: no Nova, AWS, DB, Redis or network. fetch / Bedrock / the V1 model are blocked and counted; the
 * last test asserts 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.ea.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.ea.invalid";
delete process.env.RATE_LIMIT_PROVIDER;
delete process.env.USER_LAMBDA_NAME;
delete process.env.FITNESS_LAMBDA_NAME;
delete process.env.AUTH_LAMBDA_NAME;
for (const k of ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED"]) delete process.env[k];

import type { MockProvider, WorldState } from "./m5-benchmark/harness";
import type { AgentCompletion, AgentExecutionPolicy, AgentId, AgentRequest, AgentResult, AgentRunner } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { AgentModelResponse } from "../agent-v2/model-provider";
import type { AnySessionStore } from "../agent-v2/session-context";
import { checkInputSafety } from "../agent-v2/answer-guards";
import { safetyGuard } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
let hz: typeof import("./m5-benchmark/harness");
const say = (t: string) => hz.say(t);
const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
type Step = Parameters<MockProvider["script"]>[0];
const hugeUsage = (t: string): AgentModelResponse => ({ ...say(t), usage: { inputTokens: 70_000, outputTokens: 10 } });
const ALL: AgentId[] = ["progress", "recovery", "training", "nutrition"]; // execution order
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ALWAYS = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" };
const DETERMINISTIC = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "deterministic" };
const MODES: Array<[string, Record<string, string>]> = [["deterministic", DETERMINISTIC], ["always", ALWAYS]];
const PERSONAL_TOOL: Record<AgentId, string> = { training: "training.get_today_schedule", nutrition: "nutrition.get_target", recovery: "recovery.get_recent_sessions", progress: "progress.get_body_measurements" };

const Q: Record<AgentId, string> = {
  progress: "Tiến độ cân nặng của tôi tháng này ra sao?", recovery: "Bắp chân tôi còn ê, mai có nên chạy tiếp không?",
  training: "Hôm nay tôi tập gì?", nutrition: "Mục tiêu calo của tôi là bao nhiêu?",
};
const Q_TN = "Tối nay nên ăn gì, và mai tập nhóm cơ nào?";
const Q_PR = "Tiến độ tháng này ra sao và tôi nên nghỉ mấy ngày?";
const Q_PT = "Tiến độ của tôi thế nào, hôm nay tập gì?";
const Q_PN = "Tiến độ tháng này ra sao, và tối nay ăn gì?";
const Q_THREE = "Tôi tập chân hôm qua và hơi mệt, hôm nay nên tập gì và ăn gì?";
const Q_THREE_HYBRID = "Hôm nay tập gì, tối ăn gì, và tôi nên đi ngủ lúc mấy giờ?";
const Q_FOUR_HYBRID = "Tiến độ tháng này ra sao, tuần sau tập gì, ăn bao nhiêu và nghỉ mấy ngày?";
const BENCH = "Mức tạ bench của tôi tháng này có nhích lên không?";
const HIGH_RISK: Array<{ id: string; q: string; routerSays: string[] }> = [
  { id: "bench", q: BENCH, routerSays: ["training"] }, { id: "bench2", q: "Mức tạ bench tháng này nhích lên được bao nhiêu?", routerSays: ["training"] },
  { id: "whey", q: "Người mới có nên uống whey không?", routerSays: ["nutrition"] }, { id: "cut", q: "Tôi muốn giảm 5kg trong 2 tuần thì tập và ăn thế nào?", routerSays: ["nutrition"] },
];
const Q_ADULT_BENCH = "Tôi 30 tuổi, mức tạ bench của tôi tháng này có nhích lên không?";
const Q_MINOR_BENCH = "Em 15 tuổi, mức tạ bench của em tháng này có nhích lên không?";
const Q_MINOR_WATER = "Em 15 tuổi, em nên uống bao nhiêu nước mỗi ngày?";
const Q_GEN = "Protein có vai trò gì trong việc xây cơ?";
const Q_OOS = "Thời tiết ngày mai ở Hà Nội thế nào?";
const V1_BLOCKED = ["Làm sao giảm 10kg trong 1 tuần?", "Mình đang đau ngực dữ dội và khó thở, phải làm gì?", "Em 15 tuổi, cho em thực đơn tăng cơ"];
const CHANGE_TRAINING = "Xoá buổi tập hôm nay đi.";
const CHANGE_NUTRITION = "Hãy lưu thực đơn này cho tôi.";
const CHANGE_TWO = "Hãy giảm khối lượng buổi tập hôm nay giúp tôi vì tôi mệt.";
const MINOR_TEXT = (safetyGuard.minorAgeResult() as { messageVi: string }).messageVi;

// ── transport: profile reads per bearer; everything else 404 (no socket) ─────────────────────────────────────────────
type Reply = { status: number; data?: unknown; network?: boolean };
const net = { calls: [] as Array<{ url: string; auth: string }>, profiles: {} as Record<string, Reply> };
const everyUrl: string[] = [];
const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const adapter: AxiosAdapter = async (config) => {
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
  const url = String(config.url ?? "");
  net.calls.push({ url, auth }); everyUrl.push(url);
  if (url.endsWith("/profile/me")) {
    const r = net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} };
    if (r.network) throw new AxiosError("timeout of 3000ms exceeded", AxiosError.ECONNABORTED, config);
    return respond(config, r);
  }
  return respond(config, { status: 404, data: { error: "not mocked" } });
};
const profile = (userId: string, age: number | null = 30): Reply => ({ status: 200, data: { profile: { userId, age } } });

let app: Express;
let seam: { factory: (() => any) | null };
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let sup: typeof import("../agent-v2/supervisor");
let catalog: typeof import("../agent-v2/agent-catalog");
let profileReaderMod: typeof import("../agent-v2/profile-reader");
let serviceClient: typeof import("../clients/service-lambda.client");
let createSessionStore: typeof import("../agent-v2/session-context").createInMemorySessionStore;
let blocked = 0, llmCalls = 0, v1AskReached = 0;
const v1Bodies: unknown[] = [];
const allWrites: string[] = [];
const table: string[] = [];

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE"); };
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  const { aiController } = await import("../controllers/ai.controller");
  (aiController as any).ask = (req: any, res: any) => { v1AskReached++; v1Bodies.push(req.body); res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  ({ default: app } = await import("../app"));
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  sup = await import("../agent-v2/supervisor");
  catalog = await import("../agent-v2/agent-catalog");
  profileReaderMod = await import("../agent-v2/profile-reader");
  serviceClient = await import("../clients/service-lambda.client");
  seam = rt.multiAgentRuntimeSeam;
  ({ createInMemorySessionStore: createSessionStore } = await import("../agent-v2/session-context"));
});
test.after(() => {
  seam.factory = null;
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

const downSync = (): AnySessionStore => ({ load: () => { throw new Error("down"); }, save: () => { throw new Error("down"); } });

type Wrap = Partial<Record<AgentId, (inner: AgentRunner) => AgentRunner>>;
interface RigOptions {
  env?: Partial<Record<(typeof ENV_KEYS)[number], string>>; world?: Partial<WorldState>; profiles?: Record<string, Reply>; store?: AnySessionStore;
  /** TEST FIXTURE composition: replace one runner / tighten the execution policy (deterministic routing only). */
  wrap?: Wrap; policy?: Partial<AgentExecutionPolicy>;
}
/** Sets the process configuration, then builds the runtime LAZILY like production. */
function rig(o: RigOptions = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  Object.assign(process.env, o.env ?? {});
  let t = T0;
  const clock = () => t;
  const w = hz.world(clock, o.world);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const router = hz.mockProvider("router");
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  let routerCreated = 0, runtimeCreated = 0;
  const store = o.store ?? createSessionStore();
  net.calls.length = 0;
  net.profiles = { "tok-a": profile(USER_A), "tok-b": profile(USER_B), ...(o.profiles ?? {}) };
  let runtime: unknown = null;
  const domain = { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress };
  seam.factory = () => (runtime ??= (runtimeCreated++, (o.wrap || o.policy)
    ? (() => {
      const real = catalog.createAgentRunners({ providerFor: (a) => prov[a], deps: domain, now: clock, toolTraceSink: () => {} });
      const runners = real.map((r) => { const f = o.wrap?.[r.capability.agentId]; return f ? f(r) : r; });
      const profileReader = profileReaderMod.createProfileReader({ get: (req) => serviceClient.requestService(req), now: clock });
      return { ask: (i: { question: string; identity: { userId: string; authorizationHeader?: string }; sessionId?: string }) => sup.runSupervisorTurn(
        { question: i.question, context: { userId: i.identity.userId, ...(i.identity.authorizationHeader ? { authorizationHeader: i.identity.authorizationHeader } : {}) }, ...(i.sessionId ? { sessionId: i.sessionId } : {}) },
        { runners, profileReader, sessionStore: store, now: clock, ...(o.policy ? { executionPolicy: o.policy } : {}), traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x) }) };
    })()
    : rt.createMultiAgentRuntime({
      providerFor: (a) => prov[a], now: clock, sessionStore: store, deps: domain,
      routingModelFactory: () => { routerCreated++; return router; }, traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x),
    })));
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  const agentRequests = () => ALL.reduce((k, a) => k + prov[a].requests.length, 0);
  return { w, prov, router, traces, agentTraces, store, profileReads, agentRequests, routerCreated: () => routerCreated, runtimeCreated: () => runtimeCreated };
}
type Rig = ReturnType<typeof rig>;

const NOT_RAN: ReadonlySet<AgentCompletion> = new Set(["SKIPPED", "BLOCKED", "POLICY_VIOLATION"]);
const BODY_KEYS = ["agents", "answer", "status", "traceId", "turnId"];
/** Words of the INTERNAL trace that must never appear in the public body. */
const INTERNAL_WORDS = ["dropped", "max_agents", "from_session", "deferred", "reasonCodes", "strategy", "delegation", "hybrid", "planned", "selected", "detectedAgentIds", "decision", "executedAgents", "RUNNER_THREW", "SKIPPED", "POLICY_VIOLATION", "completion"];

/** One HTTP turn. Every agent is scripted to make a PERSONAL read first and then answer, unless `scripts` says otherwise. */
async function turn(s: Rig, token: string, question: string, extra: { sessionId?: string; says?: string[]; routerStep?: Step; scripts?: Partial<Record<AgentId, Step[]>>; body?: object } = {}) {
  s.router.script(extra.routerStep ?? ids(extra.says ?? ["training"]));
  for (const a of ALL) s.prov[a].script(...(extra.scripts?.[a] ?? [hz.use(hz.call(PERSONAL_TOOL[a])), say(`Gợi ý về ${a}.`)]));
  const reads0 = s.profileReads(), routes0 = s.router.requests.length;
  const r = await request(app).post("/ai/v2/ask").set("Authorization", `Bearer ${token}`).send({ question, ...(extra.sessionId ? { sessionId: extra.sessionId } : {}), ...(extra.body ?? {}) });
  for (const p of Object.values(s.prov)) p.drain();
  s.router.drain();
  allWrites.push(...s.w.calls.filter((c) => c.startsWith("WRITE:")));
  const tr = s.traces[s.traces.length - 1];
  const data = r.body?.data as { status: string; answer: string; agents: AgentId[]; turnId: string; traceId: string };
  return { r, data, status: data?.status, agents: data?.agents, answer: data?.answer, reads: s.profileReads() - reads0, routes: s.router.requests.length - routes0, tr };
}
type Turn = Awaited<ReturnType<typeof turn>>;

/**
 * The public-response contract, checked on EVERY turn: schema unchanged, `agents` = ran, never selected / deferred / attempted-but-not-run,
 * nothing internal leaks; the internal trace keeps selected / deferred / attempted distinguishable.
 */
function contract(t: Turn, why: string, o: { threw?: AgentId[] } = {}) {
  assert.equal(t.r.status, 200, why);
  assert.deepEqual(Object.keys(t.r.body).sort(), ["data", "success"], `${why}: envelope keys unchanged`);
  assert.equal(t.r.body.success, true, why);
  assert.deepEqual(Object.keys(t.data).sort(), BODY_KEYS, `${why}: data keys unchanged (no extra field)`);
  assert.ok(Array.isArray(t.agents), `${why}: agents is an array`);
  assert.ok(t.agents.every((a) => typeof a === "string" && ALL.includes(a)), `${why}: only registered agent ids: ${JSON.stringify(t.agents)}`);
  assert.equal(new Set(t.agents).size, t.agents.length, `${why}: no duplicates`);
  assert.deepEqual(t.agents, ALL.filter((a) => t.agents.includes(a)), `${why}: execution order`);
  assert.equal(typeof t.data.turnId, "string"); assert.equal(typeof t.data.traceId, "string");
  assert.equal(t.data.traceId, t.tr.supervisorTraceId, `${why}: traceId joins the supervisor trace`); assert.equal(t.data.turnId, t.tr.turnId, why);
  const body = JSON.stringify(t.r.body);
  for (const w of INTERNAL_WORDS) assert.ok(!body.includes(w), `${why}: internal word "${w}" leaked into the public body`);
  // the relationship, from the internal trace
  const selected: string[] = t.tr.decision?.agents ?? [];
  const attempted = t.tr.delegations.map((d) => d.agentId);
  const deferred = (t.tr.decision?.dropped ?? []).filter((d) => /:(max_agents|from_session)$/.test(d)).map((d) => d.split(":")[0]);
  assert.deepEqual(attempted, attempted.length ? selected : [], `${why}: nothing attempted, or every selected agent attempted`);
  const ran = t.tr.delegations.filter((d) => !NOT_RAN.has(d.completionStatus) && !(o.threw ?? []).includes(d.agentId)).map((d) => d.agentId);
  assert.deepEqual(t.agents, ran, `${why}: public agents == delegations whose runner returned a real attempt`);
  for (const a of t.agents) assert.ok(attempted.includes(a), `${why}: ${a} was attempted`);
  for (const d of deferred) assert.ok(!t.agents.includes(d as AgentId), `${why}: deferred ${d} not listed`);
}
function check(t: Turn, label: string, e: { status: string; agents: AgentId[]; selected: AgentId[] | null }, o: { threw?: AgentId[] } = {}) {
  contract(t, label, o);
  assert.equal(t.status, e.status, `${label}: status`);
  assert.deepEqual(t.agents, e.agents, `${label}: data.agents`);
  assert.deepEqual(t.tr.decision ? t.tr.decision.agents : null, e.selected, `${label}: trace.decision.agents (selected)`);
  table.push(`${label} => http=${t.r.status} status=${t.status} agents=${JSON.stringify(t.agents)} selected=${JSON.stringify(t.tr.decision ? t.tr.decision.agents : null)} attempted=${JSON.stringify(t.tr.delegations.map((d) => `${d.agentId}:${d.completionStatus}`))}`);
}
const nothingRan = (s: Rig, t: Turn, why: string, routing = 0) => {
  assert.equal(t.tr.delegations.length, 0, `${why}: no delegation`); assert.equal(s.agentRequests(), 0, `${why}: zero agent model calls`);
  assert.deepEqual(s.w.calls, [], `${why}: zero domain tool calls`); assert.equal(t.tr.totals.modelCallCount, routing, `${why}: only ${routing} routing call(s) in the turn`);
};

// stub runners (TEST FIXTURE composition)
const usage0 = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
const throwing = (inner: AgentRunner): AgentRunner => ({ capability: inner.capability, async run() { throw new Error("runner exploded"); } });
const crafted = (inner: AgentRunner, make: (req: AgentRequest) => Partial<AgentResult>): AgentRunner => ({
  capability: inner.capability,
  async run(req) { return { delegationId: req.delegationId, agentId: inner.capability.agentId, agentTurnId: null, completion: "COMPLETE", agentStatus: "ANSWERED", answer: "", evidence: [], facts: {}, guardActions: [], usage: { ...usage0 }, ...make(req) }; },
});
const blockedStub = (inner: AgentRunner) => crafted(inner, () => ({ completion: "BLOCKED", agentStatus: "CONFIRMATION_REQUIRED", answer: "Cần xác nhận trước khi thay đổi." }));
const rogue = (inner: AgentRunner) => crafted(inner, (req) => ({
  answer: "ROGUE-TEXT mục tiêu 2400 kcal.",
  evidence: [{ agentId: inner.capability.agentId, delegationId: req.delegationId, toolId: "training.get_today_schedule", outcome: "ok", personal: false }],
  usage: { modelCalls: 1, toolCalls: 1, inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.00004, latencyMs: 1 },
}));

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ran -> listed
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  test(`EH-1 [${mode}] ONE agent ran (ANSWERED): data.agents is exactly that agent, for each of the four agents; one /profile/me; routing calls = ${mode === "always" ? 1 : 0}`, async () => {
    for (const a of ALL) {
      const s = rig({ env }); const t = await turn(s, "tok-a", Q[a], { says: [a] });
      check(t, `${mode}/single/${a}`, { status: "ANSWERED", agents: [a], selected: [a] });
      assert.equal(t.reads, 1, a); assert.equal(t.routes, mode === "always" ? 1 : 0, a); assert.ok(s.agentRequests() > 0, `${a}: it really ran`);
    }
  });

  test(`EH-2 [${mode}] TWO agents ran: both, in execution order, whatever order the planner / routing model named them`, async () => {
    const cases: Array<[string, string[], AgentId[]]> = mode === "always"
      ? [[Q_TN, ["nutrition", "training"], ["training", "nutrition"]], [Q_PN, ["nutrition", "progress"], ["progress", "nutrition"]], [Q_TN, ["training", "recovery"], ["recovery", "training"]]]
      : [[Q_TN, [], ["training", "nutrition"]], [Q_PR, [], ["progress", "recovery"]]];
    for (const [q, says, expected] of cases) {
      const s = rig({ env }); const t = await turn(s, "tok-a", q, { says });
      check(t, `${mode}/two/${expected.join("+")}`, { status: "ANSWERED", agents: expected, selected: expected }); assert.equal(t.reads, 1);
    }
  });

  test(`EH-3 [${mode}] THREE needed, cap 2: data.agents lists only the two that ran; the deferred agent is not listed (answer discloses it, trace keeps it as dropped)`, async () => {
    const s = rig({ env });
    const t = await turn(s, "tok-a", mode === "always" ? Q_THREE_HYBRID : Q_THREE, { says: ["training", "nutrition", "recovery"] });
    check(t, `${mode}/three-cap2`, { status: "PARTIAL", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
    assert.deepEqual(t.tr.decision!.dropped, ["recovery:max_agents"]); assert.match(t.answer, /phục hồi[^\n]*chưa được xử lý trong lượt này/); assert.equal(s.prov.recovery.requests.length, 0);
    assert.ok(!t.agents.includes("recovery"));
    if (mode === "always") {
      const f = rig({ env }); const u = await turn(f, "tok-a", Q_FOUR_HYBRID, { says: ["progress", "training", "nutrition", "recovery"] });
      contract(u, "always/four-cap2"); assert.equal(u.status, "PARTIAL"); assert.equal(u.agents.length, 2); assert.deepEqual(u.agents, u.tr.decision!.agents);
      table.push(`always/four-cap2 => status=${u.status} agents=${JSON.stringify(u.agents)} dropped=${JSON.stringify(u.tr.decision!.dropped)}`);
    }
  });

  test(`EH-4 [${mode}] INSUFFICIENT_DATA (the agent ran, nothing grounded) and FAILED-and-returned (its provider failed) ARE listed; status says how it went`, async () => {
    const a = rig({ env }); const t1 = await turn(a, "tok-a", Q.progress, { says: ["progress"], scripts: { progress: [say("Mình đoán tiến độ của bạn tốt.")] } });
    check(t1, `${mode}/insufficient/single`, { status: "INSUFFICIENT_DATA", agents: ["progress"], selected: ["progress"] });
    const b = rig({ env }); const t2 = await turn(b, "tok-a", Q_PT, { says: ["progress", "training"], scripts: { progress: [say("Mình đoán tiến độ của bạn tốt.")] } });
    check(t2, `${mode}/insufficient/with-partner`, { status: "PARTIAL", agents: ["progress", "training"], selected: ["progress", "training"] });
    const boom: Step = () => { throw new Error("provider exploded"); };
    const c = rig({ env }); const t3 = await turn(c, "tok-a", Q.training, { says: ["training"], scripts: { training: [boom] } });
    check(t3, `${mode}/failed-returned/single`, { status: "FAILED", agents: ["training"], selected: ["training"] });
    const d = rig({ env }); const t4 = await turn(d, "tok-a", Q_TN, { says: ["training", "nutrition"], scripts: { training: [boom] } });
    check(t4, `${mode}/failed-returned/with-partner`, { status: "PARTIAL", agents: ["training", "nutrition"], selected: ["training", "nutrition"] });
    assert.ok(!t4.answer.includes("Gợi ý về training"), "the failed agent's section is a 'could not answer' note");
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// attempted but did NOT run -> NOT listed
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  test(`EH-5 [${mode}] PARTIAL by budget: first completes, second budget-SKIPPED -> status PARTIAL, data.agents = [first] only`, async () => {
    const s = rig({ env });
    const t = await turn(s, "tok-a", Q_TN, { says: ["training", "nutrition"], scripts: { training: [hz.use(hz.call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] } });
    check(t, `${mode}/partial-budget-skip`, { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
    assert.deepEqual(t.tr.delegations.map((d) => [d.agentId, d.completionStatus]), [["training", "COMPLETE"], ["nutrition", "SKIPPED"]]);
    assert.ok(t.tr.budget.overrun.includes("maxInputTokens")); assert.equal(s.prov.nutrition.requests.length, 0); assert.match(t.answer, /Phần dinh dưỡng: chưa xử lý kịp/);
    assert.ok(!t.agents.includes("nutrition"), "a SKIPPED agent is never reported as having run");
  });

  test(`EH-6 [${mode}] agent-level BLOCKED (its own CONFIRMATION_REQUIRED gate, real engine): status BLOCKED, data.agents [] while the agent was selected; no model call, no domain call`, async () => {
    for (const [q, says, sel] of [[CHANGE_TRAINING, ["training"], ["training"]], [CHANGE_NUTRITION, ["nutrition"], ["nutrition"]], [CHANGE_TWO, ["recovery", "training"], ["recovery", "training"]]] as Array<[string, string[], AgentId[]]>) {
      const s = rig({ env }); const t = await turn(s, "tok-a", q, { says });
      check(t, `${mode}/agent-blocked/${sel.join("+")}`, { status: "BLOCKED", agents: [], selected: sel });
      assert.equal(s.agentRequests(), 0, q); assert.deepEqual(s.w.calls, [], q); assert.equal(t.tr.delegations.length, sel.length, q);
    }
  });
}

test("EH-7 TEST FIXTURE composition: a runner that THREW is NOT listed (no fabricated success); second / first / both / single; the real route, real supervisor, real catalog runners", async () => {
  const a = rig({ env: DETERMINISTIC, wrap: { nutrition: throwing } }); const t1 = await turn(a, "tok-a", Q_TN);
  check(t1, "http/runner-threw/second", { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] }, { threw: ["nutrition"] });
  assert.deepEqual(t1.tr.delegations.map((d) => [d.agentId, d.completionStatus]), [["training", "COMPLETE"], ["nutrition", "FAILED"]]);
  assert.ok(!t1.answer.includes("Gợi ý về nutrition") && /Phần dinh dưỡng: trợ lý tạm thời chưa trả lời được/.test(t1.answer));
  const b = rig({ env: DETERMINISTIC, wrap: { training: throwing } }); check(await turn(b, "tok-a", Q_TN), "http/runner-threw/first", { status: "PARTIAL", agents: ["nutrition"], selected: ["training", "nutrition"] }, { threw: ["training"] });
  const c = rig({ env: DETERMINISTIC, wrap: { training: throwing, nutrition: throwing } }); check(await turn(c, "tok-a", Q_TN), "http/runner-threw/both", { status: "FAILED", agents: [], selected: ["training", "nutrition"] }, { threw: ["training", "nutrition"] });
  const d = rig({ env: DETERMINISTIC, wrap: { training: throwing } }); check(await turn(d, "tok-a", Q.training), "http/runner-threw/single", { status: "FAILED", agents: [], selected: ["training"] }, { threw: ["training"] });
});

test("EH-7b TEST FIXTURE composition: BLOCKED + COMPLETE -> PARTIAL [completing agent]; POLICY_VIOLATION (foreign tool) not listed and its text never sent; personal read on a general-only turn not listed", async () => {
  const a = rig({ env: DETERMINISTIC, wrap: { nutrition: blockedStub } }); check(await turn(a, "tok-a", Q_TN), "http/blocked+complete (stub runner)", { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
  const b = rig({ env: DETERMINISTIC, wrap: { nutrition: rogue } }); const t = await turn(b, "tok-a", Q_TN);
  check(t, "http/policy-violation/second (stub runner)", { status: "PARTIAL", agents: ["training"], selected: ["training", "nutrition"] });
  assert.ok(!JSON.stringify(t.r.body).includes("ROGUE-TEXT") && !JSON.stringify(t.r.body).includes("2400"));
  const c = rig({ env: DETERMINISTIC, wrap: { nutrition: rogue } }); check(await turn(c, "tok-a", Q.nutrition), "http/policy-violation/single (stub runner)", { status: "FAILED", agents: [], selected: ["nutrition"] });
  const g = rig({ env: DETERMINISTIC, profiles: { "tok-a": profile(USER_A, 16) }, wrap: { nutrition: (r) => crafted(r, (req) => ({ answer: "ROGUE-TEXT 2400", evidence: [{ agentId: "nutrition", delegationId: req.delegationId, toolId: "nutrition.get_target", outcome: "ok", personal: true }], usage: { modelCalls: 1, toolCalls: 1, inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.00004, latencyMs: 1 } })) } });
  const tg = await turn(g, "tok-a", Q_GEN);
  check(tg, "http/policy-violation/personal-on-general (stub runner)", { status: "FAILED", agents: [], selected: ["nutrition"] }); assert.ok(!JSON.stringify(tg.r.body).includes("2400"));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// budget
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EH-8 BUDGET_EXHAUSTED before any agent ran -> []: [always] routing usage eats the budget (one and two agents); TEST FIXTURE composition: zero model-call budget; an agent that STARTED then ran out IS listed", async () => {
  const a = rig({ env: ALWAYS }); const t1 = await turn(a, "tok-a", Q.training, { routerStep: { ...ids(["training"]), usage: { inputTokens: 70_000, outputTokens: 10 } } });
  check(t1, "always/budget/routing-usage", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training"] }); assert.equal(a.agentRequests(), 0); assert.deepEqual(a.w.calls, []);
  const b = rig({ env: ALWAYS }); const t2 = await turn(b, "tok-a", Q_TN, { routerStep: { ...ids(["training", "nutrition"]), usage: { inputTokens: 70_000, outputTokens: 10 } } });
  check(t2, "always/budget/routing-usage/two", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training", "nutrition"] });
  assert.deepEqual(t2.tr.delegations.map((d) => d.completionStatus), ["SKIPPED", "SKIPPED"]);
  const none = { ...sup.SUPERVISOR_BUDGET, maxModelCalls: 0 };
  const c = rig({ env: DETERMINISTIC, policy: { budget: none } }); const t3 = await turn(c, "tok-a", Q_TN);
  check(t3, "http/budget/zero-model-calls (tight policy)", { status: "BUDGET_EXHAUSTED", agents: [], selected: ["training", "nutrition"] }); assert.equal(c.agentRequests(), 0);
  const d = rig({ env: DETERMINISTIC, policy: { budget: { ...sup.SUPERVISOR_BUDGET, maxModelCalls: 1 } } }); const t4 = await turn(d, "tok-a", Q.training);
  check(t4, "http/budget/started-then-exhausted (tight policy)", { status: "BUDGET_EXHAUSTED", agents: ["training"], selected: ["training"] });
  assert.deepEqual(t4.tr.delegations.map((x) => x.completionStatus), ["BUDGET_EXHAUSTED"]); assert.equal(d.prov.training.requests.length, 1);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// turns that never reach a delegation -> []
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  test(`EH-9 [${mode}] MINOR_PROTECTED (profile 16, and a self-reported minor): 200 with data.agents [] while the trace SELECTED an agent; V1 minor message; nothing ran; one /profile/me; no routing call`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ env, profiles: { "tok-a": profile(USER_A, 16) } }); const t = await turn(s, "tok-a", q, { says: ["training"] });
      contract(t, `${mode}/minor/${id}`);
      assert.equal(t.status, "MINOR_PROTECTED", id); assert.equal(t.answer, MINOR_TEXT, id); assert.deepEqual(t.agents, [], id); assert.ok(t.tr.decision!.agents.length > 0, `${id}: selected non-empty`);
      nothingRan(s, t, `${mode}/minor/${id}`); assert.equal(t.reads, 1, id); assert.equal(t.routes, 0, `${id}: a minor never reaches the routing model`);
      assert.ok(!/\b16\b/.test(JSON.stringify(t.r.body)), `${id}: the age never reaches the client`);
      table.push(`${mode}/minor/${id} => http=200 status=${t.status} agents=[] selected=${JSON.stringify(t.tr.decision!.agents)}`);
    }
    const c = rig({ env }); const u = await turn(c, "tok-a", Q_MINOR_BENCH, { sessionId: "eh9" });
    contract(u, `${mode}/minor-claim`); assert.equal(u.status, "MINOR_PROTECTED"); assert.deepEqual(u.agents, []); assert.ok(u.tr.decision!.agents.length > 0); nothingRan(c, u, "minor-claim"); assert.equal(u.routes, 0);
  });

  test(`EH-10 [${mode}] PROFILE_UNVERIFIED (403 / 401 / 503 / transport timeout / another user's profile; AGE_UNKNOWN + an own-data HIGH_RISK ask): data.agents [] while the trace SELECTED an agent`, async () => {
    const replies: Array<[string, Reply, typeof HIGH_RISK]> = [
      ["403", { status: 403, data: {} }, HIGH_RISK], ["401", { status: 401, data: {} }, HIGH_RISK.slice(0, 1)], ["503", { status: 503, data: {} }, HIGH_RISK.slice(2)],
      ["transport timeout", { status: 0, network: true }, HIGH_RISK.slice(0, 1)], ["another user's profile", profile(USER_B, 30), HIGH_RISK.slice(0, 1)],
      ["age null", profile(USER_A, null), [HIGH_RISK[0], { id: "adult-claim", q: Q_ADULT_BENCH, routerSays: ["training"] }]],
      ["no saved profile", { status: 200, data: { profile: null } }, HIGH_RISK.slice(0, 1)],
    ];
    for (const [name, reply, asks] of replies) for (const { id, q } of asks) {
      const s = rig({ env, profiles: { "tok-a": reply } }); const t = await turn(s, "tok-a", q, { says: ["training"] });
      contract(t, `${mode}/${name}/${id}`);
      assert.equal(t.status, "PROFILE_UNVERIFIED", `${name}/${id}`); assert.deepEqual(t.agents, [], `${name}/${id}`); assert.ok(t.tr.decision!.agents.length > 0, `${name}/${id}: selected non-empty`);
      nothingRan(s, t, `${mode}/${name}/${id}`); assert.equal(t.reads, 1, `${name}/${id}: one /profile/me, no retry`); assert.equal(t.routes, 0, `${name}/${id}: no routing call`);
      table.push(`${mode}/${name}/${id} => http=200 status=${t.status} agents=[] selected=${JSON.stringify(t.tr.decision!.agents)}`);
    }
  });

  test(`EH-11 [${mode}] SESSION_UNAVAILABLE (store down, sync throw): data.agents [] while the trace SELECTED an agent; nothing ran`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ env, store: downSync() }); const t = await turn(s, "tok-a", q, { sessionId: "eh11", says: ["training"] });
      contract(t, `${mode}/session-down/${id}`);
      assert.equal(t.status, "SESSION_UNAVAILABLE", id); assert.deepEqual(t.agents, [], id); assert.ok(t.tr.decision!.agents.length > 0, `${id}: selected non-empty`);
      nothingRan(s, t, `${mode}/session-down/${id}`); assert.equal(t.routes, 0, id);
      table.push(`${mode}/session-down/${id} => http=200 status=${t.status} agents=[] selected=${JSON.stringify(t.tr.decision!.agents)}`);
    }
    const m = rig({ env, store: downSync() }); const u = await turn(m, "tok-a", Q_MINOR_WATER, { sessionId: "eh11m" });
    check(u, `${mode}/session-down/persist-minor-statement`, { status: "SESSION_UNAVAILABLE", agents: [], selected: null }); nothingRan(m, u, "persist-first");
  });

  test(`EH-12 [${mode}] SAFETY_BLOCKED (V1 preflight; decision null) and OUT_OF_SCOPE: data.agents []; V1 block makes 0 profile reads and 0 routing calls`, async () => {
    for (const q of V1_BLOCKED) for (const reply of [profile(USER_A, 16), profile(USER_A, 30), { status: 403, data: {} }] as Reply[]) {
      assert.equal(checkInputSafety(q).safe, false);
      const s = rig({ env, profiles: { "tok-a": reply } }); const t = await turn(s, "tok-a", q, { sessionId: "eh12" });
      check(t, `${mode}/safety-blocked/${q.slice(0, 18)}`, { status: "SAFETY_BLOCKED", agents: [], selected: null });
      assert.equal(t.answer, checkInputSafety(q).message, "the V1 message verbatim"); assert.equal(t.reads, 0); assert.equal(t.routes, 0); nothingRan(s, t, q);
    }
    const o = rig({ env }); const t = await turn(o, "tok-a", Q_OOS, { says: [] });
    check(t, `${mode}/out-of-scope`, { status: "OUT_OF_SCOPE", agents: [], selected: [] }); nothingRan(o, t, "oos", mode === "always" ? 1 : 0);
  });
}

test("EH-13 [always] ROUTING_UNDETERMINED (verified adult + HIGH_RISK + routing model throttled / invalid output): 200 with data.agents [], nothing selected; one routing attempt; nothing read", async () => {
  const { AgentProviderError } = await import("../agent-v2/model-provider");
  for (const [name, step] of [["throttled", () => { throw new AgentProviderError("throttled", "429"); }], ["invalid output", say("tôi nghĩ là training")]] as Array<[string, Step]>) {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ env: ALWAYS }); const t = await turn(s, "tok-a", q, { routerStep: step });
      check(t, `always/routing-undetermined/${name}/${id}`, { status: "ROUTING_UNDETERMINED", agents: [], selected: [] });
      assert.equal(t.routes, 1, `${id}: one attempt`); assert.equal(s.agentRequests(), 0); assert.deepEqual(s.w.calls, []); assert.equal(t.tr.totals.modelCallCount, 1);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// HTTP-level refusals: no agents field at all
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EH-14 HTTP-level refusals never carry `agents`: 401 (no / bad token), 400 (blank, too long, unknown key, bad sessionId, wrong type) — runtime, profile and routing untouched", async () => {
  const s = rig({ env: ALWAYS });
  const cases: Array<[string, () => Promise<request.Response>, number]> = [
    ["no token", () => request(app).post("/ai/v2/ask").send({ question: Q.training }), 401],
    ["bad token", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer nope").send({ question: Q.training }), 401],
    ["blank question", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: "   " }), 400],
    ["too long (2001)", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: "a".repeat(2_001) }), 400],
    ["unknown key", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: Q.training, userId: USER_B }), 400],
    ["bad sessionId", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: Q.training, sessionId: "bad id!" }), 400],
    ["wrong type", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: 42 }), 400],
    ["missing question", () => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({}), 400],
  ];
  for (const [name, send, status] of cases) {
    const r = await send();
    assert.equal(r.status, status, name); assert.equal(r.body.success, false, name); assert.equal(r.body.data, undefined, `${name}: no data`);
    assert.ok(!JSON.stringify(r.body).includes("\"agents\""), `${name}: no agents field`); assert.ok(!/"agents"/.test(r.text), name);
    table.push(`http-refusal/${name} => http=${r.status} (no data.agents)`);
  }
  assert.equal(s.runtimeCreated(), 0, "no runtime was built for a refused request"); assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0); assert.equal(s.profileReads(), 0); assert.deepEqual(s.w.calls, []);
});

test("EH-15 flag OFF (even with a routing mode set, and for a restricted user): 404, no `agents`, no runtime, no routing model, no profile read, no agent", async () => {
  for (const env of [{ AI_AGENT_V2_ROUTING_MODE: "always" }, {}, { AI_AGENT_V2: "off" }]) {
    const s = rig({ env, profiles: { "tok-a": profile(USER_A, 16) } });
    const r = await request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: BENCH });
    assert.equal(r.status, 404); assert.equal(r.body.success, false); assert.equal(r.body.data, undefined); assert.ok(!/"agents"/.test(r.text));
    assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0); assert.equal(s.profileReads(), 0); assert.equal(s.agentRequests(), 0);
    table.push(`flag-off(${JSON.stringify(env)}) => http=404 (no data.agents)`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// no extra calls; privacy; V1 untouched
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test("EH-16 no extra model calls and no profile double read over HTTP: routing calls, agent calls and /profile/me reads are exactly what the selection implies (ran or not)", async () => {
  const rows: Array<{ name: string; make: () => Rig; q: string; says?: string[]; scripts?: Partial<Record<AgentId, Step[]>>; router: number; reads: number }> = [
    { name: "single ANSWERED", make: () => rig({ env: DETERMINISTIC }), q: Q.training, router: 0, reads: 1 },
    { name: "single ANSWERED (hybrid)", make: () => rig({ env: ALWAYS }), q: Q.training, says: ["training"], router: 1, reads: 1 },
    { name: "two ANSWERED", make: () => rig({ env: DETERMINISTIC }), q: Q_TN, router: 0, reads: 1 },
    { name: "two, budget-skip (hybrid)", make: () => rig({ env: ALWAYS }), q: Q_TN, says: ["training", "nutrition"], scripts: { training: [hz.use(hz.call(PERSONAL_TOOL.training)), hugeUsage("Hôm nay tập chân nhé.")] }, router: 1, reads: 1 },
    { name: "agent BLOCKED (hybrid)", make: () => rig({ env: ALWAYS }), q: CHANGE_TWO, says: ["recovery", "training"], router: 1, reads: 1 },
    { name: "minor (hybrid)", make: () => rig({ env: ALWAYS, profiles: { "tok-a": profile(USER_A, 16) } }), q: BENCH, router: 0, reads: 1 },
    { name: "denied (hybrid)", make: () => rig({ env: ALWAYS, profiles: { "tok-a": { status: 403, data: {} } } }), q: BENCH, router: 0, reads: 1 },
    { name: "session down (hybrid)", make: () => rig({ env: ALWAYS, store: downSync() }), q: BENCH, router: 0, reads: 1 },
    { name: "V1 safety block", make: () => rig({ env: ALWAYS }), q: V1_BLOCKED[0], router: 0, reads: 0 },
  ];
  for (const r of rows) {
    const s = r.make(); const t = await turn(s, "tok-a", r.q, { says: r.says, scripts: r.scripts, sessionId: "eh16" });
    contract(t, r.name);
    assert.equal(t.routes, r.router, `${r.name}: routing calls`); assert.equal(t.reads, r.reads, `${r.name}: /profile/me reads`);
    const delegated = t.tr.delegations.reduce((n, d) => n + d.modelCallCount, 0);
    assert.equal(s.agentRequests(), delegated, `${r.name}: every agent model call is in the delegation trace`);
    assert.equal(t.tr.totals.modelCallCount, r.router + delegated, `${r.name}: totals = routing + agents`);
  }
});

test("EH-17 privacy: neither the public body nor any trace carries the question, the age, the bearer or a user id; the body has no planned / selected / deferred detail", async () => {
  // rig() sets process-wide state (env + the runtime seam): build each one lazily, right before its turn
  const scenarios: Array<[string, () => Rig, string]> = [
    ["two ran", () => rig({ env: DETERMINISTIC }), Q_TN], ["cap-deferred", () => rig({ env: ALWAYS }), Q_THREE_HYBRID], ["agent blocked", () => rig({ env: DETERMINISTIC }), CHANGE_TRAINING],
    ["minor", () => rig({ env: ALWAYS, profiles: { "tok-a": profile(USER_A, 16) } }), BENCH], ["age unknown", () => rig({ env: DETERMINISTIC, profiles: { "tok-a": profile(USER_A, null) } }), BENCH],
    ["thrown (fixture)", () => rig({ env: DETERMINISTIC, wrap: { nutrition: throwing } }), Q_TN],
  ];
  for (const [name, make, q] of scenarios) {
    const s = make();
    const t = await turn(s, "tok-a", q, { says: ["training", "nutrition", "recovery"] });
    const out = JSON.stringify([t.r.body, s.traces, s.agentTraces]);
    for (const bad of [q, "Bearer", "tok-a", USER_A, "Em 15 tuổi", "dateOfBirth"]) assert.ok(!out.includes(bad), `${name}: ${bad}`);
    assert.ok(!/"age"\s*:/.test(out), `${name}: no age field`);
    contract(t, name, name.startsWith("thrown") ? { threw: ["nutrition"] } : {});
  }
});

test("EH-18 V1 /ai/ask is unaffected: the V1 controller is reached with the RAW body (no `agents` contract, no V2 runtime / profile read / routing model)", async () => {
  const s = rig({ env: ALWAYS, profiles: { "tok-a": profile(USER_A, 16) } });
  const before = v1AskReached;
  for (const q of [BENCH, Q_MINOR_BENCH, V1_BLOCKED[0], Q_TN]) {
    const r = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: q });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { success: true, data: { v1: true } }); assert.ok(!/"agents"/.test(r.text));
    assert.equal((v1Bodies[v1Bodies.length - 1] as { question: string }).question, q, "the raw body");
  }
  assert.equal(v1AskReached, before + 4);
  assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0); assert.equal(s.profileReads(), 0); assert.equal(s.agentRequests(), 0);
});

test("EH-19 isolation across users on one runtime: user B's turn never lists / reads for user A (agents come from the authenticated turn only)", async () => {
  const s = rig({ env: DETERMINISTIC });
  const a = await turn(s, "tok-a", Q_TN, { sessionId: "same-sess" });
  const b = await turn(s, "tok-b", Q.training, { sessionId: "same-sess" });
  contract(a, "A"); contract(b, "B");
  assert.deepEqual(a.agents, ["training", "nutrition"]); assert.deepEqual(b.agents, ["training"]);
  assert.ok(s.w.calls.every((c) => /:(A|B)$/.test(c)), "domain reads were made as A or B only");
  assert.deepEqual(s.w.calls.filter((c) => c.endsWith(":B")).map((c) => c.split(":")[0]), ["getTodaySchedule"], "B's turn read exactly the training schedule, as B");
});

test("EH-20 audit table (set EA_TABLE=1 to print) and zero network / Bedrock / V1-model calls in the whole file; no WRITE anywhere; every transport call went to a .invalid host", () => {
  if (process.env.EA_TABLE === "1") console.log(`\n--- EH audit table (${table.length} rows) ---\n${table.join("\n")}\n---`);
  assert.ok(table.length > 40, `the audit table was filled (${table.length})`);
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.deepEqual(allWrites, []);
  assert.ok(everyUrl.length > 0 && everyUrl.every((u) => /\.invalid\//.test(u)), JSON.stringify(everyUrl.filter((u) => !/\.invalid\//.test(u))));
});
