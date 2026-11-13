/**
 * V2 hybrid router — SAFETY MESSAGE PRECEDENCE (owner decision M7-P5A.2.1). HTTP level.
 *
 * See agent-v2-safety-precedence.test.ts for the decision and the priority order:
 *   (1) V1 input safety block  (2) known minor -> Minor Gate outcome  (3) unverified eligibility -> accurate response for the
 *   ACTUAL failure  (4) ROUTING_UNDETERMINED only for genuine routing uncertainty.
 *
 * Evidence label: CONTROLLER INTEGRATION over the REAL ai-service `app` with supertest (POST /ai/v2/ask: real flag gate,
 * requireAuth, strict body, composition root with `routingModelFactory` selected by AI_AGENT_V2_ROUTING_MODE, real supervisor,
 * real hybrid provider, four bounded agents, registries, the REAL profile reader over the V1 service client). Replaced only:
 * auth token verification, the HTTP transport (axios adapter, no socket — answers GET /profile/me per bearer), the agents'
 * models, the ROUTING model (counting mock) and the domain READ deps (synthetic fixtures). NOT a REAL BROWSER / REAL HTTP run:
 * no Nova, AWS, DB, Redis or network. fetch / Bedrock / the V1 model are blocked and counted; the last test asserts 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.sp.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.sp.invalid";
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
import type { AnySessionStore, ContextEntry, VersionedSessionStore } from "../agent-v2/session-context";
import { checkInputSafety } from "../agent-v2/answer-guards";
import { PROFILE_UNVERIFIED_MESSAGE } from "../agent-v2/minor-gate";
import { safetyGuard } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
let hz: typeof import("./m5-benchmark/harness");
const say = (t: string) => hz.say(t);
const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
const ALL: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ALWAYS = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "always" };
const SELECTIVE = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "selective" };
const DETERMINISTIC = { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "deterministic" };
const MODES: Array<[string, Record<string, string>]> = [["always", ALWAYS], ["selective", SELECTIVE]];

// sentences re-verified 2026-11-14 (see the supervisor-level file, SP-0): V1-safe, HIGH_RISK, routed to a personal agent
const BENCH = "Mức tạ bench của tôi tháng này có nhích lên không?";
const BENCH_2 = "Mức tạ bench tháng này nhích lên được bao nhiêu?";
const WHEY = "Người mới có nên uống whey không?";
const CUT = "Tôi muốn giảm 5kg trong 2 tuần thì tập và ăn thế nào?";
const HIGH_RISK: Array<{ id: string; q: string; routerSays: string[] }> = [
  { id: "bench", q: BENCH, routerSays: ["training"] }, { id: "bench2", q: BENCH_2, routerSays: ["training"] },
  { id: "whey", q: WHEY, routerSays: ["nutrition"] }, { id: "cut", q: CUT, routerSays: ["nutrition"] },
];
const REPHRASINGS: Record<string, string[]> = {
  bench: [BENCH, "Tháng này mức tạ bench của tôi có tăng không?", "Bench của tôi tháng này tăng được bao nhiêu kg?", "Muc ta bench cua toi thang nay co nhich len khong?"],
  whey: [WHEY, "Mới tập thì có nên uống whey không?", "Người mới tập gym có nên dùng whey protein không?", "Nguoi moi co nen uong whey khong?"],
  cut: [CUT, "Làm thế nào để tôi giảm 5kg trong 2 tuần, tập và ăn ra sao?", "Giảm 5kg trong 2 tuần thì tập và ăn kiểu gì?", "Tôi cần giảm 5 kg trong hai tuần, hãy chỉ tôi cách tập và ăn"],
};
const Q_MINOR_BENCH = "Em 15 tuổi, mức tạ bench của em tháng này có nhích lên không?"; // self-report < 18 + HIGH_RISK, V1-safe
const Q_MINOR_WATER = "Em 15 tuổi, em nên uống bao nhiêu nước mỗi ngày?"; // states an age < 18, V1-safe
const Q_ADULT_BENCH = "Tôi 30 tuổi, mức tạ bench của tôi tháng này có nhích lên không?";
const Q_GEN = "Protein có vai trò gì trong việc xây cơ?";
const V1_BLOCKED = ["Làm sao giảm 10kg trong 1 tuần?", "Mình đang đau ngực dữ dội và khó thở, phải làm gì?", "Em 15 tuổi, cho em thực đơn tăng cơ"];

const MINOR_TEXT = (safetyGuard.minorAgeResult() as { messageVi: string }).messageVi;
const AGE_REQUIRED_TEXT = "Hồ sơ của bạn chưa có tuổi, nên mình chưa thể tư vấn cá nhân cho yêu cầu này (mục tiêu thay đổi cơ thể, cường độ tối đa hoặc các yêu cầu có rủi ro). Bạn hãy cập nhật tuổi trong hồ sơ rồi hỏi lại nhé; câu hỏi kiến thức chung thì mình vẫn trả lời được.";
const SESSION_UNAVAILABLE_TEXT = "Mình chưa đọc được ngữ cảnh cuộc trò chuyện này nên chưa thể tư vấn cá nhân lúc này. Bạn thử lại sau ít phút, hoặc hỏi kiến thức chung nhé.";
const ROUTING_UNDETERMINED_TEXT = "Mình chưa xác định chắc chắn bạn đang hỏi về phần nào (tập luyện, dinh dưỡng, phục hồi hay tiến độ), nên chưa tư vấn cá nhân lúc này. Bạn hỏi lại cụ thể hơn giúp mình nhé.";
/** Precise on purpose (AGE_REQUIRED says "rồi hỏi lại nhé" AFTER updating the age; PROFILE_UNVERIFIED says "thử lại sau ít phút"): a STATE change, not a rewording. */
const REPHRASE = /diễn đạt|cụ thể hơn|hỏi lại cụ thể|xác định chắc chắn|bạn hỏi lại/i;
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
let SessionStoreErrorCtor: typeof import("../agent-v2/session-context").SessionStoreError;
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
  ({ createInMemorySessionStore: createSessionStore, SessionStoreError: SessionStoreErrorCtor } = await import("../agent-v2/session-context"));
});
test.after(() => {
  seam.factory = null;
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

function versionedStore() {
  const m = new Map<string, { entries: ContextEntry[]; v: number }>();
  const st = { failRead: false };
  const key = (o: string, s: string) => JSON.stringify([o, s]);
  const store: VersionedSessionStore = {
    versioned: true,
    async read(o, s) { if (st.failRead) throw new SessionStoreErrorCtor("UNAVAILABLE"); const c = m.get(key(o, s)); return { entries: c ? structuredClone(c.entries) : [], version: String(c?.v ?? 0) }; },
    async write(o, s, expected, entries) { const c = m.get(key(o, s)); if (String(c?.v ?? 0) !== expected) return false; m.set(key(o, s), { entries: structuredClone(entries), v: (c?.v ?? 0) + 1 }); return true; },
  };
  return { store, st };
}
const downSync = (): AnySessionStore => ({ load: () => { throw new Error("down"); }, save: () => { throw new Error("down"); } });

type Meta = NonNullable<SupervisorTrace["hybridRouting"]>;
type TraceClearance = { requested: boolean; reason: string | null };
const clearanceOf = (t: SupervisorTrace): TraceClearance | undefined => (t as unknown as { routingClearance?: TraceClearance }).routingClearance;
const metaOf = (t: SupervisorTrace): Meta | null => (t.hybridRouting as Meta | null | undefined) ?? null;
const META_KEYS = ["boundedLatencyMs", "deferredAgentIds", "detectedAgentIds", "deterministicAgentIds", "estimatedTokenUsage", "fallbackReasonCode", "mode", "redactions", "routingClearance", "routingModelCalled", "routingStrategy", "routingTimeoutMs", "routingValidationStatus", "selectedAgentIds", "selection", "signals"];

/** Sets the process configuration, then builds N runtimes LAZILY like production; all instances share ONE session store. */
function rig(o: { env?: Partial<Record<(typeof ENV_KEYS)[number], string>>; world?: Partial<WorldState>; profiles?: Record<string, Reply>; routingModel?: (instance: number) => AgentModelProvider; store?: AnySessionStore; instances?: number } = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  Object.assign(process.env, o.env ?? {});
  let t = T0;
  const clock = () => t;
  const n = o.instances ?? 1;
  const w = hz.world(clock, o.world);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const routers = Array.from({ length: n }, (_, i) => hz.mockProvider(`router${i}`));
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  let routerCreated = 0, runtimeCreated = 0, current = 0;
  const store = o.store ?? createSessionStore();
  net.calls.length = 0;
  net.profiles = { "tok-a": profile(USER_A), "tok-b": profile(USER_B), ...(o.profiles ?? {}) };
  const runtimes: Array<ReturnType<typeof rt.createMultiAgentRuntime> | null> = Array.from({ length: n }, () => null);
  seam.factory = () => {
    const i = current;
    return (runtimes[i] ??= (runtimeCreated++, rt.createMultiAgentRuntime({
      providerFor: (a) => prov[a], now: clock, sessionStore: store,
      deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
      routingModelFactory: () => { routerCreated++; return o.routingModel ? o.routingModel(i) : routers[i]; },
      traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x),
    })));
  };
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  const routerCalls = () => routers.reduce((k, r) => k + r.requests.length, 0);
  const agentRequests = () => ALL.reduce((k, a) => k + prov[a].requests.length, 0);
  const domainReads = () => w.calls.filter((c) => !c.startsWith("WRITE:"));
  return { w, prov, router: routers[0], routers, traces, agentTraces, store, profileReads, routerCalls, agentRequests, domainReads,
    use: (i: number) => { current = i; }, routerCreated: () => routerCreated, runtimeCreated: () => runtimeCreated };
}
type Rig = ReturnType<typeof rig>;

/** One HTTP turn. Every agent is scripted to make a PERSONAL read first, so an agent that (wrongly) ran would show in the world log. */
async function turn(s: Rig, token: string, question: string, extra: { sessionId?: string; says?: string[]; routerStep?: Parameters<MockProvider["script"]>[0]; body?: object } = {}) {
  for (const r of s.routers) r.script(extra.routerStep ?? ids(extra.says ?? ["training"]));
  for (const a of ALL) s.prov[a].script(hz.use(hz.call(PERSONAL_TOOL[a])), say(`Gợi ý về ${a}.`));
  const reads0 = s.profileReads();
  const r = await request(app).post("/ai/v2/ask").set("Authorization", `Bearer ${token}`).send({ question, ...(extra.sessionId ? { sessionId: extra.sessionId } : {}), ...(extra.body ?? {}) });
  for (const p of Object.values(s.prov)) p.drain();
  for (const rr of s.routers) rr.drain();
  allWrites.push(...s.w.calls.filter((c) => c.startsWith("WRITE:")));
  const tr = s.traces[s.traces.length - 1];
  return { r, status: r.body?.data?.status as string, answer: r.body?.data?.answer as string, reads: s.profileReads() - reads0, tr, clr: clearanceOf(tr), h: metaOf(tr) };
}
type Turn = Awaited<ReturnType<typeof turn>>;

const notRephrase = (text: string, why: string) => { assert.notEqual(text, ROUTING_UNDETERMINED_TEXT, `${why}: ROUTING_UNDETERMINED text`); assert.ok(!REPHRASE.test(text), `${why}: asks to rephrase: ${String(text).slice(0, 100)}`); };
/** The restricted-turn invariants: zero routing calls, zero personal work, one /profile/me, routing meta explains why. */
function restricted(s: Rig, t: Turn, mode: string, reason: string, why: string) {
  assert.equal(t.r.status, 200, why);
  assert.equal(s.routerCalls(), 0, `${why}: routing model invoked`);
  assert.equal(s.agentRequests(), 0, `${why}: zero agent model calls`); assert.deepEqual(s.w.calls, [], `${why}: zero domain tool calls`); assert.equal(t.tr.delegations.length, 0, why);
  assert.equal(t.reads, 1, `${why}: exactly one /profile/me`);
  assert.deepEqual(t.clr, { requested: true, reason }, `${why}: trace clearance`);
  assert.equal(t.h?.mode, mode, why); assert.equal(t.h?.selection, "DETERMINISTIC_FALLBACK", why); assert.equal(t.h?.fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE", why);
  assert.equal(t.h?.routingClearance, reason, why); assert.equal(t.h?.routingModelCalled, false, why); assert.equal(t.h?.routingValidationStatus, "NOT_CALLED", why);
  assert.ok(t.h!.signals.includes("SENSITIVE_REQUEST"), `${why}: the selector fires`);
  assert.ok(!t.tr.decision!.reasonCodes.includes("routing_undetermined"), why);
  assert.notEqual(t.status, "ROUTING_UNDETERMINED", why); notRephrase(t.answer, why);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// (2) KNOWN MINOR
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  const m = mode;
  test(`SH-1 [${m}] HIGH_RISK + VERIFIED MINOR profile (16): 200 MINOR_PROTECTED with the V1 minor message, 0 routing calls, nothing personal ran, one /profile/me, the age never reaches the client`, async () => {
    for (const { id, q } of HIGH_RISK) {
      const s = rig({ env, profiles: { "tok-a": profile(USER_A, 16) } });
      const t = await turn(s, "tok-a", q);
      restricted(s, t, m, "MINOR_RESTRICTION", id);
      assert.equal(t.status, "MINOR_PROTECTED", id); assert.equal(t.answer, MINOR_TEXT, id); assert.deepEqual([t.tr.ageGate?.status, t.tr.ageGate?.decision, t.tr.ageGate?.minorBy], ["MINOR", "BLOCK", ["PROFILE"]], id);
      const { turnId: _a, traceId: _b, ...rest } = t.r.body.data as Record<string, unknown>;
      assert.ok(!/\b16\b|16 tuổi/.test(JSON.stringify({ ...t.r.body, data: rest })), `${id}: the age never reaches the client`);
    }
  });

  test(`SH-2 [${m}] HIGH_RISK + self-reported minor in the CURRENT question (adult profile): 0 routing calls, MINOR_PROTECTED, with and without a sessionId`, async () => {
    for (const sessionId of [undefined, "sh2-sess"]) {
      const s = rig({ env });
      const t = await turn(s, "tok-a", Q_MINOR_BENCH, { sessionId });
      restricted(s, t, m, "MINOR_RESTRICTION", String(sessionId));
      assert.equal(t.status, "MINOR_PROTECTED"); assert.equal(t.answer, MINOR_TEXT); assert.ok(t.tr.ageGate?.minorBy.includes("CURRENT_TURN")); assert.equal(t.tr.ageGate?.conflict, true);
    }
  });

  test(`SH-3 [${m}] HIGH_RISK + SESSION minor restriction (turn 1 states the age, turn 2 asks), ACROSS INSTANCES sharing one store: 0 routing calls on both; an adult claim does not lift it; another session routes normally`, async () => {
    for (const { id, q, routerSays } of HIGH_RISK) {
      const { store } = versionedStore();
      const s = rig({ env, instances: 2, store });
      s.use(0); const t1 = await turn(s, "tok-a", Q_MINOR_WATER, { sessionId: "sh3" });
      assert.equal(t1.clr?.reason, "MINOR_RESTRICTION", `${id}: precondition`);
      s.use(1); const t2 = await turn(s, "tok-a", q, { sessionId: "sh3" });
      restricted(s, t2, m, "MINOR_RESTRICTION", `${id} turn 2 on instance 2`);
      assert.equal(t2.status, "MINOR_PROTECTED", id); assert.equal(t2.answer, MINOR_TEXT, id); assert.deepEqual(t2.tr.ageGate?.minorBy, ["HISTORY"], id);
      s.use(0); const t3 = await turn(s, "tok-a", Q_ADULT_BENCH, { sessionId: "sh3" });
      assert.equal(t3.status, "MINOR_PROTECTED", `${id}: an adult claim cannot lift the restriction`); assert.equal(s.routerCalls(), 0);
      const t4 = await turn(s, "tok-a", q, { sessionId: "sh3-other", says: routerSays });
      assert.equal(s.routerCalls(), 1, `${id}: another session of the same verified adult routes (one call)`); assert.equal(t4.status, "ANSWERED", id);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // (3) UNVERIFIED ELIGIBILITY
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  test(`SH-4 [${m}] HIGH_RISK + AGE_UNKNOWN (age null / no saved profile): 0 routing calls, PROFILE_UNVERIFIED + the age-required text; never "minor", never ROUTING_UNDETERMINED; a self-stated adult age unlocks nothing`, async () => {
    for (const [name, reply] of [["age null", profile(USER_A, null)], ["no saved profile", { status: 200, data: { profile: null } }]] as Array<[string, Reply]>) {
      for (const q of [...REPHRASINGS.bench, Q_ADULT_BENCH]) {
        const s = rig({ env, profiles: { "tok-a": reply } });
        const t = await turn(s, "tok-a", q);
        const why = `${name}/${q}`;
        restricted(s, t, m, "AGE_UNKNOWN", why);
        assert.equal(t.status, "PROFILE_UNVERIFIED", why); assert.equal(t.answer, AGE_REQUIRED_TEXT, why); assert.notEqual(t.answer, MINOR_TEXT, `${why}: never labelled a confirmed minor`);
        assert.deepEqual([t.tr.ageGate?.status, t.tr.ageGate?.decision, t.tr.profileRead], ["UNKNOWN", "BLOCK_AGE_UNKNOWN", "AGE_UNKNOWN"], why);
      }
    }
  });

  test(`SH-5 [${m}] HIGH_RISK + profile not verifiable (403 / 401 / 503 / transport timeout / another user's profile): 0 routing calls, PROFILE_UNVERIFIED + the profile-unverified text (not "minor"), one /profile/me, no retry`, async () => {
    const cases: Array<[string, Reply]> = [["403", { status: 403, data: {} }], ["401", { status: 401, data: {} }], ["503", { status: 503, data: {} }], ["transport timeout", { status: 0, network: true }], ["profile of another user", profile(USER_B, 30)]];
    for (const [name, reply] of cases) for (const { id, q } of HIGH_RISK) {
      const s = rig({ env, profiles: { "tok-a": reply } });
      const t = await turn(s, "tok-a", q);
      const why = `${name}/${id}`;
      restricted(s, t, m, "PROFILE_UNVERIFIED", why);
      assert.equal(t.status, "PROFILE_UNVERIFIED", why); assert.equal(t.answer, PROFILE_UNVERIFIED_MESSAGE, why); assert.notEqual(t.answer, MINOR_TEXT, why); assert.notEqual(t.answer, AGE_REQUIRED_TEXT, why);
      assert.equal(t.tr.ageGate?.status, "UNVERIFIED", why);
    }
  });

  test(`SH-6 [${m}] HIGH_RISK + session store unavailable (async read rejects / sync load throws): 0 routing calls, SESSION_UNAVAILABLE with its own text, nothing personal ran`, async () => {
    const v = versionedStore(); v.st.failRead = true;
    for (const [name, store] of [["versioned read rejects", v.store], ["sync load throws", downSync()]] as const) for (const { id, q } of HIGH_RISK) {
      const s = rig({ env, store });
      const t = await turn(s, "tok-a", q, { sessionId: "sh6" });
      const why = `${name}/${id}`;
      restricted(s, t, m, "SESSION_UNAVAILABLE", why);
      assert.equal(t.status, "SESSION_UNAVAILABLE", why); assert.equal(t.answer, SESSION_UNAVAILABLE_TEXT, why); assert.equal(t.tr.session?.store, "UNAVAILABLE", why);
      assert.equal(t.tr.ageGate?.decision, "BLOCK_SESSION_UNAVAILABLE", why);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // verified adult: no regression; genuine uncertainty
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  test(`SH-7 [${m}] HIGH_RISK + VERIFIED ADULT: exactly one routing call, model-assisted, ANSWERED with the personal read, one /profile/me`, async () => {
    for (const { id, q, routerSays } of HIGH_RISK) {
      const s = rig({ env, profiles: { "tok-a": profile(USER_A, 30) } });
      const t = await turn(s, "tok-a", q, { says: routerSays });
      assert.equal(t.r.status, 200, id); assert.equal(s.routerCalls(), 1, id); assert.equal(t.status, "ANSWERED", id); assert.deepEqual(t.r.body.data.agents, routerSays, id);
      assert.deepEqual(t.clr, { requested: true, reason: "VERIFIED_ADULT" }, id);
      assert.deepEqual([t.h?.selection, t.h?.routingModelCalled, t.h?.routingClearance, t.h?.fallbackReasonCode], ["MODEL_ASSISTED", true, "VERIFIED_ADULT", "NONE"], id);
      assert.equal(t.reads, 1, id); assert.ok(s.agentRequests() > 0 && s.domainReads().length >= 1, `${id}: the agent ran and read`); notRephrase(t.answer, id);
    }
  });

  test(`SH-8 [${m}] GENUINE uncertainty: verified adult + HIGH_RISK + routing model throttled / invalid output -> ROUTING_UNDETERMINED over HTTP (one attempt, nothing read, nothing personal ran)`, async () => {
    const { AgentProviderError } = await import("../agent-v2/model-provider");
    for (const [name, step, code] of [["throttled", () => { throw new AgentProviderError("throttled", "429"); }, "PROVIDER_RATE_LIMITED"], ["invalid output", say("tôi nghĩ là training"), "INVALID_OUTPUT"]] as const) {
      for (const { id, q } of HIGH_RISK) {
        const s = rig({ env });
        const t = await turn(s, "tok-a", q, { routerStep: step as Parameters<MockProvider["script"]>[0] });
        const why = `${name}/${id}`;
        assert.equal(t.r.status, 200, why); assert.equal(s.routerCalls(), 1, `${why}: one attempt`); assert.equal(t.status, "ROUTING_UNDETERMINED", why); assert.equal(t.answer, ROUTING_UNDETERMINED_TEXT, why);
        assert.deepEqual([t.h?.selection, t.h?.fallbackReasonCode, t.h?.routingClearance, t.h?.routingModelCalled], ["UNDETERMINED", code, "VERIFIED_ADULT", true], why);
        assert.deepEqual(t.r.body.data.agents, [], why); assert.equal(s.agentRequests(), 0, why); assert.deepEqual(s.w.calls, [], why); assert.equal(t.tr.delegations.length, 0, why);
      }
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// (1) V1 input safety first
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of [...MODES, ["deterministic", DETERMINISTIC] as [string, Record<string, string>]]) {
  test(`SH-9 [${mode}] V1 preflight block (each of 3) with a minor / unknown / denied / adult profile: SAFETY_BLOCKED, 0 routing calls, 0 /profile/me, the V1 message verbatim (routing never overrides it)`, async () => {
    const profiles: Array<[string, Reply]> = [["minor 16", profile(USER_A, 16)], ["age unknown", profile(USER_A, null)], ["denied", { status: 403, data: {} }], ["adult 30", profile(USER_A, 30)]];
    for (const q of V1_BLOCKED) for (const [name, reply] of profiles) {
      const s = rig({ env, profiles: { "tok-a": reply } });
      const t = await turn(s, "tok-a", q, { sessionId: "sh9" });
      const why = `${q.slice(0, 20)}/${name}`;
      assert.equal(t.r.status, 200, why); assert.equal(t.status, "SAFETY_BLOCKED", why); assert.equal(t.answer, checkInputSafety(q).message, `${why}: the V1 message verbatim`); notRephrase(t.answer, why);
      assert.equal(s.routerCalls(), 0, why); assert.equal(s.profileReads(), 0, `${why}: no /profile/me`); assert.equal(s.agentRequests(), 0, why); assert.deepEqual(s.w.calls, [], why);
      assert.equal(t.tr.hybridRouting ?? null, null, why); assert.equal(t.tr.profileRead, "NOT_READ", why);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// general-knowledge question with a restricted user
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  test(`SH-10 [${mode}] general-knowledge question with a minor / unknown / unverifiable profile: 0 routing calls, 200 ANSWERED exactly as in deterministic mode, never ROUTING_UNDETERMINED`, async () => {
    const profiles: Array<[string, Reply]> = [["minor 16", profile(USER_A, 16)], ["age unknown", profile(USER_A, null)], ["403", { status: 403, data: {} }], ["503", { status: 503, data: {} }]];
    for (const [name, reply] of profiles) {
      const h = rig({ env, profiles: { "tok-a": reply } }); const th = await turn(h, "tok-a", Q_GEN, { says: ["nutrition"] });
      const hCalls = [...h.w.calls]; const hRouter = h.routerCalls();
      const d = rig({ env: DETERMINISTIC, profiles: { "tok-a": reply } }); const td = await turn(d, "tok-a", Q_GEN);
      assert.equal(hRouter, 0, name); assert.equal(th.status, td.status, `${name}: same status as deterministic mode`); assert.equal(th.answer, td.answer, `${name}: same answer as deterministic mode`);
      assert.notEqual(th.status, "ROUTING_UNDETERMINED", name); notRephrase(th.answer, name); assert.deepEqual(hCalls, d.w.calls, `${name}: same domain tool calls as deterministic mode`); assert.equal(th.reads, 1, name);
      if (name !== "age unknown") assert.deepEqual(hCalls, [], `${name}: general-only — no personal read`);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// no repeat loop; deterministic parity; privacy; isolation
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
for (const [mode, env] of MODES) {
  test(`SH-11 [${mode}] no repeat-question loop over HTTP: rephrasing a HIGH_RISK question as a restricted user gives the SAME restriction outcome every time; the text never asks to rephrase; one /profile/me per turn`, async () => {
    const scenarios: Array<{ name: string; make: () => Rig; status: string; text: string; reason: string; sets: string[]; sessionId?: string; prime?: string }> = [
      { name: "verified minor", make: () => rig({ env, profiles: { "tok-a": profile(USER_A, 16) } }), status: "MINOR_PROTECTED", text: MINOR_TEXT, reason: "MINOR_RESTRICTION", sets: ["bench", "whey", "cut"] },
      { name: "age unknown", make: () => rig({ env, profiles: { "tok-a": profile(USER_A, null) } }), status: "PROFILE_UNVERIFIED", text: AGE_REQUIRED_TEXT, reason: "AGE_UNKNOWN", sets: ["bench"] },
      { name: "profile 403", make: () => rig({ env, profiles: { "tok-a": { status: 403, data: {} } } }), status: "PROFILE_UNVERIFIED", text: PROFILE_UNVERIFIED_MESSAGE, reason: "PROFILE_UNVERIFIED", sets: ["bench", "whey", "cut"] },
      { name: "session minor restriction", make: () => rig({ env }), status: "MINOR_PROTECTED", text: MINOR_TEXT, reason: "MINOR_RESTRICTION", sets: ["bench", "whey", "cut"], sessionId: "sh11", prime: Q_MINOR_WATER },
      { name: "session store down", make: () => rig({ env, store: downSync() }), status: "SESSION_UNAVAILABLE", text: SESSION_UNAVAILABLE_TEXT, reason: "SESSION_UNAVAILABLE", sets: ["bench", "whey", "cut"], sessionId: "sh11" },
    ];
    for (const sc of scenarios) for (const set of sc.sets) {
      const s = sc.make();
      if (sc.prime) await turn(s, "tok-a", sc.prime, { sessionId: sc.sessionId });
      const outcomes: string[] = [];
      for (const q of REPHRASINGS[set]) {
        const t = await turn(s, "tok-a", q, { sessionId: sc.sessionId });
        const why = `${sc.name}/${set}/${q}`;
        assert.equal(t.status, sc.status, why); assert.equal(t.answer, sc.text, why); notRephrase(t.answer, why); assert.equal(t.clr?.reason, sc.reason, why); assert.equal(t.reads, 1, `${why}: one /profile/me`);
        outcomes.push(`${t.status}|${t.answer}`);
      }
      assert.equal(new Set(outcomes).size, 1, `${sc.name}/${set}: identical for every rephrasing`);
      assert.equal(s.routerCalls(), 0, `${sc.name}/${set}`); assert.deepEqual(s.w.calls, [], `${sc.name}/${set}`); assert.equal(s.agentRequests(), 0, `${sc.name}/${set}`);
    }
  });

  test(`SH-12 [${mode}] hybrid == deterministic mode for every restricted state (status, answer, domain reads): the routing mode cannot change a safety outcome`, async () => {
    const states: Array<[string, Reply, string]> = [["minor 16", profile(USER_A, 16), BENCH], ["age unknown", profile(USER_A, null), BENCH], ["403", { status: 403, data: {} }, WHEY], ["503", { status: 503, data: {} }, CUT], ["minor 16 (cut)", profile(USER_A, 16), CUT]];
    for (const [name, reply, q] of states) {
      const h = rig({ env, profiles: { "tok-a": reply } }); const th = await turn(h, "tok-a", q);
      const d = rig({ env: DETERMINISTIC, profiles: { "tok-a": reply } }); const td = await turn(d, "tok-a", q);
      assert.deepEqual([th.status, th.answer, h.w.calls, h.agentRequests(), th.tr.ageGate], [td.status, td.answer, d.w.calls, d.agentRequests(), td.tr.ageGate], name);
      assert.equal(h.routerCalls(), 0, name); assert.equal(d.routerCalls(), 0, name);
    }
  });

  test(`SH-13 [${mode}] trace / response privacy on restricted turns: no question text, age, bearer or user id anywhere; hybridRouting keys = the allowlist; clearance keys = {requested, reason}`, async () => {
    const scenarios: Array<[string, Reply, string, string?]> = [["minor", profile(USER_A, 16), BENCH], ["minor claim", profile(USER_A, 37), Q_MINOR_BENCH, "sh13"], ["unknown", profile(USER_A, null), CUT], ["denied", { status: 403, data: {} }, WHEY]];
    for (const [name, reply, q, sessionId] of scenarios) {
      const s = rig({ env, profiles: { "tok-a": reply } });
      const t = await turn(s, "tok-a", q, { sessionId });
      const out = JSON.stringify([t.r.body, s.traces, s.agentTraces]);
      for (const bad of [q, "Bearer", "tok-a", USER_A, "Em 15 tuổi", "dateOfBirth"]) assert.ok(!out.includes(bad), `${name}: ${bad}`);
      assert.ok(!/"age"\s*:/.test(out), `${name}: no age field`);
      assert.deepEqual(Object.keys(t.h!).sort(), [...META_KEYS].sort(), `${name}: HybridRoutingMeta keys unchanged`); assert.deepEqual(Object.keys(t.clr!).sort(), ["reason", "requested"], name);
      assert.deepEqual(t.h!.redactions, { email: 0, phone: 0 }, name); assert.deepEqual(t.h!.estimatedTokenUsage, { input: 0, output: 0 }, name);
    }
  });
}

test("SH-14 V1 /ai/ask is unaffected: the V1 controller is reached with the RAW body (no clearance, no V2 runtime / profile read / routing model)", async () => {
  const s = rig({ env: ALWAYS, profiles: { "tok-a": profile(USER_A, 16) } });
  const before = v1AskReached;
  for (const q of [BENCH, Q_MINOR_BENCH, V1_BLOCKED[0]]) {
    const r = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: q });
    assert.equal(r.status, 200); assert.equal(r.body.data.v1, true);
    assert.equal((v1Bodies[v1Bodies.length - 1] as { question: string }).question, q, "the raw body");
  }
  assert.equal(v1AskReached, before + 3);
  assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(s.routerCalls(), 0); assert.equal(s.profileReads(), 0);
});

test("SH-15 flag OFF: /ai/v2/ask is 404 even for a restricted user — no runtime, no routing model, no profile read", async () => {
  const s = rig({ env: { AI_AGENT_V2_ROUTING_MODE: "always" }, profiles: { "tok-a": profile(USER_A, 16) } });
  const r = await request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: BENCH });
  assert.equal(r.status, 404); assert.equal(s.runtimeCreated(), 0); assert.equal(s.routerCreated(), 0); assert.equal(s.routerCalls(), 0); assert.equal(s.profileReads(), 0);
});

test("SH-Z zero network / Bedrock / V1-model calls in the whole file; no WRITE anywhere; every transport call went to a .invalid host", () => {
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.deepEqual(allWrites, []);
  assert.ok(everyUrl.length > 0 && everyUrl.every((u) => /\.invalid\//.test(u)), JSON.stringify(everyUrl.filter((u) => !/\.invalid\//.test(u))));
});
