/**
 * V2 Multi-Agent M7-P4.3 — hybrid router wired into the runtime, tested through the REAL ai-service `app` (POST /ai/v2/ask:
 * real flag gate, requireAuth, strict body, composition root, supervisor, four bounded agents, registries, profile reader
 * over the real V1 service client). Replaced only: auth token verification, the HTTP transport (axios adapter, no socket),
 * the agents' models and the ROUTING model (scripted mocks, or the real Bedrock adapter over a FAKE transport), and the
 * domain READ deps (synthetic per-user fixtures). CONTROLLER INTEGRATION TEST — no Nova, AWS, DB, Redis or network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.m7p43.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.m7p43.invalid";
delete process.env.RATE_LIMIT_PROVIDER;
delete process.env.USER_LAMBDA_NAME;
delete process.env.FITNESS_LAMBDA_NAME;
delete process.env.AUTH_LAMBDA_NAME;
for (const k of ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED"]) delete process.env[k];

import type { MockProvider, WorldState } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { AgentModelProvider, AgentModelResponse } from "../agent-v2/model-provider";
import { createInMemoryMinorRestrictionStore } from "../agent-v2/minor-restriction";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
let hz: typeof import("./m5-benchmark/harness");
const say = (t: string) => hz.say(t);
const call = (...a: Parameters<typeof hz.call>) => hz.call(...a);
const use = (...b: Parameters<typeof hz.use>) => hz.use(...b);
const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
const ALL: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

// ── transport: profile reads per bearer; everything else 404 (no socket) ─────────────────────────────────────────────
type Reply = { status: number; data?: unknown };
const net = { calls: [] as Array<{ url: string; auth: string }>, profiles: {} as Record<string, Reply> };
const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const adapter: AxiosAdapter = async (config) => {
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
  const url = String(config.url ?? "");
  net.calls.push({ url, auth });
  if (url.endsWith("/profile/me")) return respond(config, net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} });
  return respond(config, { status: 404, data: { error: "not mocked" } });
};
const profile = (userId: string, age: number | null = 30): Reply => ({ status: 200, data: { profile: { userId, age } } });

let app: Express;
let seam: { factory: (() => any) | null };
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let createSessionStore: typeof import("../agent-v2/session-context").createInMemorySessionStore;
let createBedrock: typeof import("../agent-v2/bedrock-converse-adapter").createBedrockConverseProvider;
let blocked = 0, llmCalls = 0, v1AskReached = 0;
const allWrites: string[] = [];

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
  (aiController as any).ask = (_req: any, res: any) => { v1AskReached++; res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  ({ default: app } = await import("../app"));
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  seam = rt.multiAgentRuntimeSeam;
  ({ createInMemorySessionStore: createSessionStore } = await import("../agent-v2/session-context"));
  ({ createBedrockConverseProvider: createBedrock } = await import("../agent-v2/bedrock-converse-adapter"));
});
test.after(() => {
  seam.factory = null;
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

/** Sets the process configuration (the flag gate and the runtime both read it), then builds the runtime LAZILY like production. */
function rig(o: { env?: Partial<Record<(typeof ENV_KEYS)[number], string>>; world?: Partial<WorldState>; profiles?: Record<string, Reply>; routingModel?: () => AgentModelProvider } = {}) {
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
  net.calls.length = 0;
  net.profiles = { "tok-a": profile(USER_A), "tok-b": profile(USER_B), ...(o.profiles ?? {}) };
  let runtime: ReturnType<typeof rt.createMultiAgentRuntime> | null = null;
  seam.factory = () => (runtime ??= (runtimeCreated++, rt.createMultiAgentRuntime({
    providerFor: (a) => prov[a], now: clock, sessionStore: createSessionStore(),
    // M8-A2: a production runtime REQUIRES a restriction store (none is persistent yet → 503 without one); like sessionStore, injected here
    restrictionStore: createInMemoryMinorRestrictionStore(),
    deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
    routingModelFactory: () => { routerCreated++; return o.routingModel ? o.routingModel() : router; },
    traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x),
  })));
  /** One HTTP turn; every agent gets a plain scripted answer (unused scripts are discarded after the turn). */
  const ask = async (token: string | null, body: object, extra: { headers?: Record<string, string>; query?: string; script?: () => void } = {}) => {
    if (extra.script) extra.script(); else for (const a of ALL) prov[a].script(say(`Gợi ý về ${a}.`));
    const r0 = request(app).post(`/ai/v2/ask${extra.query ?? ""}`).set(extra.headers ?? {});
    const r = await (token ? r0.set("Authorization", `Bearer ${token}`) : r0).send(body);
    for (const p of Object.values(prov)) p.drain();
    allWrites.push(...w.calls.filter((c) => c.startsWith("WRITE:")));
    return r;
  };
  const last = () => traces[traces.length - 1];
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  return { w, prov, router, traces, agentTraces, ask, last, profileReads, routerCreated: () => routerCreated, runtimeCreated: () => runtimeCreated, advance: (ms: number) => { t += ms; } };
}
const routerText = (m: MockProvider, i = 0) => m.requests[i].messages[0].content.map((b) => (b.type === "text" ? b.text : "")).join("");

// ── 1–9 configuration and activation gates ──────────────────────────────────────────────────────────────────────────
test("HH-1 V2 flag OFF (even with a routing mode configured): 404, no runtime, no routing provider", async () => {
  const s = rig({ env: { AI_AGENT_V2_ROUTING_MODE: "always" } });
  const r = await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r.status, 404); assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(net.calls.length, 0);
});

test("HH-2/3 default and explicit deterministic: intent-v1.3, no routing provider created, no routing call", async () => {
  for (const env of [{ AI_AGENT_V2: "on" }, { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "deterministic" }]) {
    const s = rig({ env });
    const r = await s.ask("tok-a", { question: "Bắp chân tôi còn ê, mai có nên chạy tiếp không?" });
    assert.equal(r.status, 200); assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0);
    assert.equal(s.last().decision?.strategy, "intent-v1.3"); assert.equal(s.last().hybridRouting ?? null, null);
    assert.deepEqual(s.last().routingMode, { requested: "deterministic", effective: "deterministic", reason: env.AI_AGENT_V2_ROUTING_MODE ? "CONFIGURED" : "DEFAULT" });
  }
});

test("HH-4 selective: the routing model is called only when the selector fires", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "selective" } });
  await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(s.router.requests.length, 0); assert.equal(s.last().hybridRouting?.selection, "KEEP_DETERMINISTIC");
  s.router.script(ids(["recovery", "training"]));
  const r = await s.ask("tok-a", { question: "Bắp chân tôi còn ê từ hôm chạy dài, mai có nên chạy tiếp không?" });
  assert.equal(s.router.requests.length, 1); assert.deepEqual([...r.body.data.agents].sort(), ["recovery", "training"]);
  assert.equal(s.last().routingMode?.effective, "selective"); assert.equal(s.routerCreated(), 1);
});

test("HH-5 always: exactly one routing call per valid turn", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(ids(["training"]), ids(["training"]));
  await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(s.router.requests.length, 2); assert.ok(s.traces.every((t) => t.hybridRouting?.routingModelCalled && t.hybridRouting.selection === "MODEL_ASSISTED"));
});

test("HH-6/7 production: V2 approved but hybrid NOT approved → deterministic only, no provider; both approvals → hybrid", async () => {
  const base = { AI_AGENT_V2: "on", NODE_ENV: "production", AI_AGENT_V2_PRODUCTION_APPROVED: "yes", AI_AGENT_V2_ROUTING_MODE: "always" };
  const s = rig({ env: base });
  const r = await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r.status, 200); assert.equal(process.env.NODE_ENV, "production"); assert.equal(s.runtimeCreated(), 1, "V2 itself runs");
  assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0); assert.equal(s.last().decision?.strategy, "intent-v1.3");
  assert.deepEqual(s.last().routingMode, { requested: "always", effective: "deterministic", reason: "HYBRID_PRODUCTION_NOT_APPROVED" });
  for (const v of ["true", "YES", "1"]) {
    const x = rig({ env: { ...base, AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED: v } });
    await x.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
    assert.equal(x.routerCreated(), 0, `approval value ${v} is not "yes"`);
  }
  const ok = rig({ env: { ...base, AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED: "yes" } }); ok.router.script(ids(["training"]));
  await ok.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(ok.routerCreated(), 1); assert.equal(ok.router.requests.length, 1); assert.equal(ok.last().routingMode?.effective, "always");
  // the hybrid approval alone never opens the endpoint (the V2 production approval is still required)
  const closed = rig({ env: { AI_AGENT_V2: "on", NODE_ENV: "production", AI_AGENT_V2_ROUTING_MODE: "always", AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED: "yes" } });
  assert.equal((await closed.ask("tok-a", { question: "Hôm nay tôi tập gì?" })).status, 404); assert.equal(closed.routerCreated(), 0);
});

test("HH-8 invalid routing mode: refused (503), nothing created, nothing read — never a silent switch to model routing", async () => {
  for (const v of ["Always", "hybrid", "true", " selective", "deterministic,always"]) {
    const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: v } });
    const r = await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
    assert.equal(r.status, 503, v); assert.equal(s.routerCreated(), 0, v); assert.equal(s.profileReads(), 0, v);
    assert.ok(!JSON.stringify(r.body).includes(v.trim()) || v.trim() === "true", "the configured value is not echoed");
  }
});

test("HH-9 the client cannot choose the routing mode (body → 400; query / header ignored)", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on" } });
  assert.equal((await s.ask("tok-a", { question: "Hôm nay tôi tập gì?", routingMode: "always" })).status, 400);
  const r = await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" }, { query: "?routingMode=always&mode=always", headers: { "x-routing-mode": "always", "x-ai-agent-v2-routing-mode": "always" } });
  assert.equal(r.status, 200); assert.equal(s.routerCreated(), 0); assert.equal(s.last().routingMode?.effective, "deterministic");
});

// ── 10–11 refused requests never reach routing ──────────────────────────────────────────────────────────────────────
test("HH-10 unauthorized: 401 / 403, no runtime work, no routing", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  assert.equal((await s.ask(null, { question: "Hôm nay tôi tập gì?" })).status, 401);
  assert.equal((await s.ask("tok-forged", { question: "Hôm nay tôi tập gì?" })).status, 401);
  assert.equal((await s.ask(null, { question: "Hôm nay tôi tập gì?" }, { headers: { "x-internal-token": "test-internal-secret", "x-user-id": USER_A } })).status, 403);
  assert.equal(s.router.requests.length, 0); assert.equal(s.runtimeCreated(), 0);
});

test("HH-11 minor: a preflight-blocked minor request never routes; a profile minor makes ZERO routing calls and is protected by Gate 1 with no domain read", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  const r = await s.ask("tok-a", { question: "Em 16 tuổi, cho em thực đơn để giảm cân thật nhanh" });
  assert.equal(r.body.data.status, "SAFETY_BLOCKED"); assert.equal(s.router.requests.length, 0);
  // CONTRACT CHANGE (M7-P5A.2 control B): a verified-minor profile used to reach the routing model once (`<= 1`) before Gate 1;
  // it now makes EXACTLY ZERO routing calls (routing-model clearance), the one profile read is shared with Gate 1, and Gate 1
  // still protects. The "no age in the routing prompt" claim is kept on a verified adult (distinctive age 37), where a call happens.
  const p = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" }, profiles: { "tok-a": profile(USER_A, 16) } });
  p.router.script(ids(["nutrition"]));
  const m = await p.ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" });
  assert.equal(m.body.data.status, "MINOR_PROTECTED"); assert.equal(p.router.requests.length, 0); assert.equal(p.profileReads(), 1);
  assert.deepEqual(p.w.calls, []); assert.equal(p.last().delegations.length, 0);
  const a = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" }, profiles: { "tok-a": profile(USER_A, 37) } });
  a.router.script(ids(["nutrition"]));
  await a.ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" });
  assert.equal(a.router.requests.length, 1); assert.ok(!/\b37\b|tuổi/.test(routerText(a.router)));
});

// ── 12–15 model-assisted selection, cap and deferral ────────────────────────────────────────────────────────────────
test("HH-12..15 one / two / three / four detected domains: cap 2 after identification, the rest deferred and disclosed", async () => {
  const cases: Array<[string[], string, string[], string]> = [
    [["training"], "Squat sâu quá có hại khớp gối không?", [], "ANSWERED"],
    [["nutrition", "training"], "Tối nay ăn gì, và mai tập nhóm cơ nào?", [], "ANSWERED"],
    [["training", "nutrition", "recovery"], "Hôm nay tập gì, tối ăn gì, và tôi nên đi ngủ lúc mấy giờ?", ["recovery"], "PARTIAL"],
    [["progress", "training", "nutrition", "recovery"], "Tiến độ tháng này ra sao, tuần sau tập gì, ăn bao nhiêu và nghỉ mấy ngày?", ["nutrition", "recovery"], "PARTIAL"],
  ];
  for (const [model, q, deferred, status] of cases) {
    const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } }); s.router.script(ids(model));
    const r = await s.ask("tok-a", { question: q });
    assert.equal(r.body.data.status, status, q); assert.deepEqual(r.body.data.agents.length, Math.min(2, model.length), q);
    assert.deepEqual(s.last().hybridRouting?.detectedAgentIds, model, q); assert.deepEqual(s.last().hybridRouting?.deferredAgentIds, deferred, q);
    for (const a of deferred) assert.ok(s.last().decision!.dropped.includes(`${a}:max_agents`), `${q}: ${a}`);
    if (deferred.length) assert.match(r.body.data.answer, /chưa được xử lý trong lượt này/);
    assert.equal(s.profileReads(), 1, q);
  }
});

// ── 16–21 failures, budget, undetermined ────────────────────────────────────────────────────────────────────────────
test("HH-16/17 invalid JSON and unknown agent id: rejected by the strict validator, safe deterministic fallback", async () => {
  for (const [out, status] of [[say("training và nutrition"), "INVALID_JSON"], [ids(["training", "billing"]), "UNKNOWN_AGENT"]] as const) {
    const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } }); s.router.script(out);
    const r = await s.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
    assert.equal(s.last().hybridRouting?.routingValidationStatus, status); assert.equal(s.last().hybridRouting?.selection, "DETERMINISTIC_FALLBACK");
    assert.deepEqual(r.body.data.agents, ["training"]); assert.ok(!JSON.stringify(r.body).includes("billing"));
  }
});

test("HH-18 provider timeout (4 s routing timeout): one attempt, counted, fallback", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(() => new Promise<AgentModelResponse>(() => {}));
  const t = Date.now();
  const r = await s.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
  const took = Date.now() - t;
  assert.ok(took >= 3_900 && took < 9_000, String(took)); assert.equal(s.router.requests.length, 1);
  assert.equal(s.last().hybridRouting?.fallbackReasonCode, "ROUTING_TIMEOUT"); assert.equal(s.last().hybridRouting?.routingTimeoutMs, 4_000);
  assert.ok(s.last().totals.modelCallCount >= 1); assert.equal(r.status, 200);
});

test("HH-19 provider unavailable: no internal error / credential text reaches the client or the trace", async () => {
  const leak = "AccessDeniedException: arn:aws:iam::123456789012:role/secret-role AKIAFAKEKEY";
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(() => { throw new Error(leak); });
  const r = await s.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
  assert.equal(r.status, 200); assert.equal(s.last().hybridRouting?.fallbackReasonCode, "PROVIDER_UNAVAILABLE");
  for (const x of ["arn:aws", "AKIA", "AccessDenied", "secret-role"]) { assert.ok(!JSON.stringify(r.body).includes(x), x); assert.ok(!JSON.stringify(s.traces).includes(x), x); }
});

test("HH-20 budget: routing usage is part of the GLOBAL budget — an expensive or slow routing call leaves the agents nothing extra", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script({ ...ids(["training"]), usage: { inputTokens: 70_000, outputTokens: 10 } });
  const r = await s.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r.body.data.status, "BUDGET_EXHAUSTED"); assert.ok(s.last().budget.overrun.includes("maxInputTokens"));
  assert.equal(s.prov.training.requests.length, 0, "no agent model call after the routing call exhausted the budget"); assert.deepEqual(s.w.calls, []);
  // a routing call that consumes the turn's wall time: the delegations get no extra time
  const slow = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  slow.router.script(async () => { slow.advance(59_000); return ids(["training"]); });
  const r2 = await slow.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r2.body.data.status, "BUDGET_EXHAUSTED"); assert.equal(slow.prov.training.requests.length, 0);
  assert.equal(slow.last().delegations[0]?.completionStatus, "SKIPPED");
  // a normal routing call: totals = routing + agents, within every ceiling
  const n = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } }); n.router.script(ids(["training"]));
  await n.ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  const tr = n.last();
  assert.equal(tr.totals.modelCallCount, 1 + tr.delegations.reduce((k, d) => k + d.modelCallCount, 0)); assert.deepEqual(tr.budget.overrun, []);
});

test("HH-21 ROUTING_UNDETERMINED: a HIGH_RISK personal request with the router unavailable runs nothing and reads no domain data", async () => {
  const { AgentProviderError } = await import("../agent-v2/model-provider");
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(() => { throw new AgentProviderError("throttled", "x"); });
  const r = await s.ask("tok-a", { question: "Tôi muốn giảm 5kg trong 2 tuần thì tập và ăn thế nào?" });
  assert.equal(r.status, 200); assert.equal(r.body.data.status, "ROUTING_UNDETERMINED"); assert.deepEqual(r.body.data.agents, []);
  // CONTRACT CHANGE (M7-P5A.2 control B): the profile is now read ONCE, before the routing call, for clearance (a verified
  // adult here). That read is the only one (Gate 1 is never reached), and still no domain read happens.
  assert.equal(s.profileReads(), 1); assert.deepEqual(s.w.calls, []); assert.equal(s.last().hybridRouting?.fallbackReasonCode, "PROVIDER_RATE_LIMITED");
});

// ── 22–26 sessions, isolation, permissions, trace privacy ───────────────────────────────────────────────────────────
test("HH-22/23 multi-turn and cross-user: routing prompts carry codes only; the same sessionId of another user starts empty", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(ids(["training"]), ids(["nutrition"]), ids(["training"]));
  await s.ask("tok-a", { question: "Hôm nay tôi tập gì?", sessionId: "hy-sess-1" }, { script: () => { s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài.")); } });
  await s.ask("tok-a", { question: "Vậy trước buổi đó nên ăn gì?", sessionId: "hy-sess-1" });
  const follow = JSON.parse(routerText(s.router, 1)) as { recentDomains: string[] };
  assert.ok((s.traces[1].session?.loaded ?? 0) > 0, "turn 2 really loaded turn 1's session");
  assert.deepEqual(follow.recentDomains, ["training"], "the fresh session domain travels as a CODE");
  const b = await s.ask("tok-b", { question: "Hôm nay tôi tập gì?", sessionId: "hy-sess-1" }, { script: () => { s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi B-Push day.")); } });
  assert.equal(s.last().session?.loaded, 0); assert.doesNotMatch(b.body.data.answer, /Leg day/);
  assert.deepEqual(JSON.parse(routerText(s.router, 2)).recentDomains, [], "B sees none of A's session");
  const prompts = JSON.stringify(s.router.requests);
  for (const x of [USER_A, USER_B, "Bearer", "tok-a", "tok-b", "Leg day", "B-Push"]) assert.ok(!prompts.includes(x), x);
  assert.ok(s.w.calls.every((c) => c.startsWith("WRITE:") || /:(A|B)$/.test(c))); assert.ok(s.w.calls.filter((c) => c.endsWith(":B")).length >= 1);
});

test("HH-24/25 permissions: a model routing to the wrong domain only reaches that agent's allowlist; WRITE and foreign tools refused", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(ids(["training"]));
  await s.ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" }, { script: () => {
    s.prov.training.script(use(call("nutrition.get_target"), call("training.skip_workout"), call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day."));
  } });
  const outcomes = s.agentTraces[0].tools.map((x) => x.outcome);
  assert.equal(outcomes.filter((o) => o === "TOOL_NOT_OFFERED").length, 2, JSON.stringify(s.agentTraces[0].tools));
  assert.deepEqual(s.w.calls, ["getTodaySchedule:A"], "neither the nutrition READ nor the WRITE reached a domain function");
  // the routing model itself cannot act: a tool call from it is rejected and nothing is executed
  const t = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  t.router.script(use(call("training.skip_workout", { userId: USER_B })));
  await t.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
  assert.equal(t.last().hybridRouting?.routingValidationStatus, "NON_TEXT_OUTPUT"); assert.deepEqual(t.router.requests[0].tools, []);
  assert.ok(!t.w.calls.some((c) => c.startsWith("WRITE:")));
});

test("HH-26 trace privacy: no question text, prompt, raw routing output, bearer or user id in any supervisor trace", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  s.router.script(say("RAW-ROUTER-OUTPUT-7731 training"));
  const q = "Squat sâu quá có hại khớp gối không?";
  await s.ask("tok-a", { question: q });
  const tr = JSON.stringify(s.traces);
  for (const x of [q, "Squat sâu", "RAW-ROUTER-OUTPUT-7731", "routing classifier", "Bearer", "tok-a", USER_A]) assert.ok(!tr.includes(x), x);
  // CONTRACT CHANGE (M7-P5A.2): the trace-safe allowlist gains `routingClearance` (a code) and `redactions` (two counts).
  assert.deepEqual(Object.keys(s.last().hybridRouting!).sort(), ["boundedLatencyMs", "deferredAgentIds", "detectedAgentIds", "deterministicAgentIds", "estimatedTokenUsage", "fallbackReasonCode", "mode", "redactions", "routingClearance", "routingModelCalled", "routingStrategy", "routingTimeoutMs", "routingValidationStatus", "selectedAgentIds", "selection", "signals"]);
});

// ── 27–28 V1 unchanged, no network; Bedrock adapter compatibility ────────────────────────────────────────────────────
test("HH-27 V1 /ai/ask unchanged with a hybrid routing mode configured: V1 controller reached, V2 runtime untouched", async () => {
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" } });
  const before = v1AskReached;
  const r = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" });
  assert.equal(r.status, 200); assert.equal(r.body.data.v1, true); assert.equal(v1AskReached, before + 1);
  assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(s.router.requests.length, 0);
});

test("HH-29 the existing Bedrock Converse adapter satisfies the routing contract (FAKE transport — no AWS)", async () => {
  const seen: any[] = [];
  const fake = (out: unknown) => async (input: any, opts: any) => { seen.push({ input, opts }); if (out instanceof Error) throw out; return out; };
  const ok = { output: { message: { role: "assistant", content: [{ text: "{\"agentIds\":[\"training\",\"recovery\"]}" }] } }, stopReason: "end_turn", usage: { inputTokens: 381, outputTokens: 9 } };
  const s = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" }, routingModel: () => createBedrock({ modelId: "fake-model", transport: fake(ok) }) });
  const r = await s.ask("tok-a", { question: "Bắp chân tôi còn ê từ hôm chạy dài, mai có nên chạy tiếp không?" });
  assert.deepEqual([...r.body.data.agents].sort(), ["recovery", "training"]); assert.equal(s.last().hybridRouting?.selection, "MODEL_ASSISTED");
  assert.deepEqual(s.last().hybridRouting?.estimatedTokenUsage, { input: 381, output: 9 }, "provider-reported usage is what is accounted");
  const sent = seen[0].input;
  assert.equal(sent.toolConfig, undefined, "no tool is offered to the routing model"); assert.deepEqual(sent.inferenceConfig, { maxTokens: 40, temperature: 0 });
  assert.equal(seen[0].opts.maxAttempts, 1, "no SDK retry"); assert.ok(seen[0].opts.abortSignal);
  const throttled = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" }, routingModel: () => createBedrock({ modelId: "fake-model", transport: fake(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" })) }) });
  await throttled.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
  assert.equal(throttled.last().hybridRouting?.fallbackReasonCode, "PROVIDER_RATE_LIMITED");
  const fenced = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" }, routingModel: () => createBedrock({ modelId: "fake-model", transport: fake({ ...ok, output: { message: { content: [{ text: "```json\n{\"agentIds\":[\"training\"]}\n```" }] } } }) }) });
  await fenced.ask("tok-a", { question: "Squat sâu quá có hại khớp gối không?" });
  assert.equal(fenced.last().hybridRouting?.routingValidationStatus, "INVALID_JSON", "the strict parser is unchanged behind the adapter");
});

test("HH-28 zero network / Bedrock / V1 model calls in the whole file; no WRITE anywhere", () => {
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.deepEqual(allWrites, []);
  assert.ok(net.calls.every((c) => /\.invalid\//.test(c.url)));
});
