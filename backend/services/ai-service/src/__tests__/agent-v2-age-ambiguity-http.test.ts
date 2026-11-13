/**
 * M7-P5A.2.3 — AMBIGUOUS self-reported age over HTTP (POST /ai/v2/ask). Lead-owned.
 *
 * See agent-v2-age-ambiguity-wiring.test.ts for the contract. Here the PUBLIC response is asserted through the real route: an ambiguous
 * sentence ("Chào anh em mười lăm tuổi") never reaches the routing model or an agent for a personal ask, never persists a minor
 * restriction, the public body keeps its five keys, and V1 /ai/ask / flag-OFF behaviour is untouched.
 *
 * Evidence label: CONTROLLER INTEGRATION over the REAL ai-service `app` with supertest (real flag gate, requireAuth, strict body,
 * composition root `createMultiAgentRuntime`, real supervisor, real hybrid provider, four bounded agents, the REAL profile reader over
 * the V1 service client). Replaced only: auth token verification, the HTTP transport (no socket), the agents' models, the ROUTING model
 * (counting mock) and the domain READ deps. NOT REAL BROWSER / REAL HTTP: no Nova, AWS, DB, Redis or network.
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

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { AgentModelResponse } from "../agent-v2/model-provider";
import type { AnySessionStore } from "../agent-v2/session-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
let hz: typeof import("./m5-benchmark/harness");
const say = (t: string) => hz.say(t);
const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
const ALL: AgentId[] = ["progress", "recovery", "training", "nutrition"];
const TOKENS: Record<string, string> = { "tok-a": USER_A };
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ALWAYS = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" };
const DETERMINISTIC = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "deterministic" };
const MODES: Array<[string, Record<string, string>]> = [["deterministic", DETERMINISTIC], ["always", ALWAYS]];
const PERSONAL_TOOL: Record<AgentId, string> = { training: "training.get_today_schedule", nutrition: "nutrition.get_target", recovery: "recovery.get_recent_sessions", progress: "progress.get_body_measurements" };


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
let createSessionStore: typeof import("../agent-v2/session-context").createInMemorySessionStore;
let blocked = 0, llmCalls = 0, v1AskReached = 0;
const v1Bodies: unknown[] = [];
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
  (aiController as any).ask = (req: any, res: any) => { v1AskReached++; v1Bodies.push(req.body); res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  ({ default: app } = await import("../app"));
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  seam = rt.multiAgentRuntimeSeam;
  ({ createInMemorySessionStore: createSessionStore } = await import("../agent-v2/session-context"));
});
test.after(() => {
  seam.factory = null;
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});


interface RigOptions { env?: Partial<Record<(typeof ENV_KEYS)[number], string>>; profiles?: Record<string, Reply>; store?: AnySessionStore }
/** Sets the process configuration, then builds the runtime LAZILY like production (REAL composition root). */
function rig(o: RigOptions = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  Object.assign(process.env, o.env ?? {});
  let t = T0;
  const clock = () => t;
  const w = hz.world(clock);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const router = hz.mockProvider("router");
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  let routerCreated = 0, runtimeCreated = 0;
  const store = o.store ?? createSessionStore();
  net.calls.length = 0;
  net.profiles = { "tok-a": profile(USER_A), ...(o.profiles ?? {}) };
  let runtime: unknown = null;
  const domain = { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress };
  seam.factory = () => (runtime ??= (runtimeCreated++, rt.createMultiAgentRuntime({
    providerFor: (a) => prov[a], now: clock, sessionStore: store, deps: domain,
    routingModelFactory: () => { routerCreated++; return router; }, traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x),
  })));
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  const agentRequests = () => ALL.reduce((k, a) => k + prov[a].requests.length, 0);
  return { w, prov, router, traces, agentTraces, store, profileReads, agentRequests, routerCreated: () => routerCreated, runtimeCreated: () => runtimeCreated };
}
type Rig = ReturnType<typeof rig>;

const BODY_KEYS = ["agents", "answer", "status", "traceId", "turnId"];
const INTERNAL_WORDS = ["dropped", "max_agents", "from_session", "deferred", "reasonCodes", "strategy", "delegation", "hybrid", "planned", "selected", "detectedAgentIds", "decision", "executedAgents", "RUNNER_THREW", "SKIPPED", "POLICY_VIOLATION", "completion", "UNROUTED_HAZARD"];

/** One HTTP turn. The routing model (hybrid, verified adult only) abstains with []; agents are scripted to make a personal read if (wrongly) run. */
async function turn(s: Rig, question: string, extra: { sessionId?: string; routerStep?: AgentModelResponse } = {}) {
  s.router.script(extra.routerStep ?? ids([]));
  for (const a of ALL) s.prov[a].script(hz.use(hz.call(PERSONAL_TOOL[a])), say(`Gợi ý về ${a}.`));
  const reads0 = s.profileReads(), routes0 = s.router.requests.length;
  const r = await request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question, ...(extra.sessionId ? { sessionId: extra.sessionId } : {}) });
  for (const p of Object.values(s.prov)) p.drain();
  s.router.drain();
  allWrites.push(...s.w.calls.filter((c) => c.startsWith("WRITE:")));
  const tr = s.traces[s.traces.length - 1];
  const data = r.body?.data as { status: string; answer: string; agents: AgentId[]; turnId: string; traceId: string };
  return { r, data, status: data?.status, agents: data?.agents, answer: data?.answer, reads: s.profileReads() - reads0, routes: s.router.requests.length - routes0, tr };
}
type Turn = Awaited<ReturnType<typeof turn>>;

const AMBIGUOUS_PREFIX = "Mình chưa chắc câu bạn vừa viết đang nói về tuổi của chính bạn";
const PERSONAL = "Chào anh em mười lăm tuổi, tôi uống mấy muỗng whey mỗi ngày?";
const GENERAL_Q = "Chào anh em mười lăm tuổi, squat là bài tập gì?";
const UNROUTED = "Chào anh em mười lăm tuổi, giảm 5 kg trong 2 tuần thế nào?";

function publicBody(t: Turn, why: string) {
  assert.equal(t.r.status, 200, why);
  assert.deepEqual(Object.keys(t.r.body).sort(), ["data", "success"], why);
  assert.deepEqual(Object.keys(t.data).sort(), BODY_KEYS, `${why}: data keys unchanged`);
  const body = JSON.stringify(t.r.body);
  for (const w of INTERNAL_WORDS) assert.ok(!body.includes(w), `${why}: internal word "${w}" leaked`);
  assert.ok(!body.includes("BLOCK_AGE_AMBIGUOUS") && !body.includes("ambiguous"), `${why}: the internal decision is not public`);
}

for (const [mode, env] of MODES) {
  test(`AH-1 [${mode}] ambiguous age + personal dose: HTTP 200, PROFILE_UNVERIFIED with the accurate text, agents [], 0 routing calls, 0 domain tool calls`, async () => {
    for (const q of [PERSONAL, UNROUTED]) {
      const s = rig({ env });
      const t = await turn(s, q);
      publicBody(t, `${mode}: ${q}`);
      assert.equal(t.status, "PROFILE_UNVERIFIED"); assert.ok(t.answer.startsWith(AMBIGUOUS_PREFIX), t.answer);
      assert.deepEqual(t.agents, []); assert.equal(t.routes, 0, "an ambiguous age is never eligible for the routing model");
      assert.equal(s.agentRequests(), 0); assert.deepEqual(s.w.calls, [], "zero domain tool calls"); assert.equal(t.tr.ageGate?.decision, "BLOCK_AGE_AMBIGUOUS");
      assert.equal(t.tr.delegations.length, 0);
    }
  });

  test(`AH-2 [${mode}] ambiguous age + a GENERAL question: answered general-only, 0 routing calls, no personal read; public agents = the agent that ran`, async () => {
    const s = rig({ env });
    const t = await turn(s, GENERAL_Q, { routerStep: ids(["training"]) });
    publicBody(t, `${mode} general`);
    assert.equal(t.routes, 0); assert.ok(t.status === "ANSWERED" || t.status === "PARTIAL" || t.status === "INSUFFICIENT_DATA", t.status);
    assert.deepEqual(s.w.calls, [], "the personal tool attempt never reached the domain");
    assert.ok(t.agents.every((a) => ["training", "nutrition", "recovery", "progress"].includes(a)));
  });

  test(`AH-3 [${mode}] the ambiguous sentence persists NOTHING: the next turn in the same session is a normal verified-adult turn (no minor restriction)`, async () => {
    const s = rig({ env });
    const sessionId = "ambiguity-session-1";
    const t1 = await turn(s, PERSONAL, { sessionId });
    assert.equal(t1.status, "PROFILE_UNVERIFIED");
    const t2 = await turn(s, "Squat là bài tập gì?", { sessionId, routerStep: ids(["training"]) });
    assert.notEqual(t2.status, "MINOR_PROTECTED"); assert.notEqual(t2.status, "PROFILE_UNVERIFIED");
    assert.notEqual(t2.tr.ageGate?.decision, "BLOCK_AGE_AMBIGUOUS"); assert.deepEqual(t2.tr.ageGate?.minorBy, []);
  });

  test(`AH-4 [${mode}] a profile minor + the ambiguous sentence stays MINOR_PROTECTED (ambiguity never downgrades a known minor)`, async () => {
    const s = rig({ env, profiles: { "tok-a": profile(USER_A, 16) } });
    const t = await turn(s, PERSONAL);
    publicBody(t, `${mode} minor`);
    assert.equal(t.status, "MINOR_PROTECTED"); assert.equal(t.routes, 0); assert.equal(s.agentRequests(), 0); assert.deepEqual(s.w.calls, []);
  });
}

test("AH-5 flag OFF: 404, no runtime, no routing model, no profile read (the ambiguous sentence changes nothing)", async () => {
  const s = rig({ env: {} });
  const r = await request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: PERSONAL });
  assert.equal(r.status, 404); assert.equal(s.runtimeCreated(), 0); assert.equal(s.router.requests.length, 0); assert.equal(s.profileReads(), 0);
});

test("AH-6 privacy: neither the public body nor any trace carries the question, the stated age or the bearer", async () => {
  const s = rig({ env: ALWAYS });
  const t = await turn(s, PERSONAL);
  const everything = JSON.stringify([t.r.body, s.traces, s.agentTraces]);
  for (const needle of ["mười lăm", "anh em", "tok-a", USER_A]) assert.ok(!everything.includes(needle), `leaked: ${needle}`);
});

test("AH-7 V1 /ai/ask is unaffected by the ambiguity wiring (the V1 controller is reached with the RAW body)", async () => {
  const s = rig({ env: ALWAYS });
  const before = v1AskReached;
  const r = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: PERSONAL });
  assert.equal(r.status, 200); assert.equal(v1AskReached, before + 1); assert.equal(s.runtimeCreated(), 0); assert.equal(s.router.requests.length, 0);
});

test("AH-8 zero network / Bedrock / V1-model calls; no WRITE anywhere", () => {
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.deepEqual(allWrites, []);
  assert.ok(everyUrl.every((u) => /\.invalid|\/profile\/me|^\/?/.test(u)));
});
