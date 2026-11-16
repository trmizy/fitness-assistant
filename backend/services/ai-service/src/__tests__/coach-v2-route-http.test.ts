/**
 * M9.2-T3 — AI Coach V1/V2 bridge wired into POST /ai/ask. HTTP INTEGRATION over the REAL ai-service `app` (supertest, in-process,
 * loopback only): real requireAuth, shared ask rate limiter, AskRequestSchema validation, bindRequestIdentity, the bridge
 * middleware, the continuity layer (idempotency + history over FAKE ports), the V2 executor, and — through the existing
 * composition root — the REAL Supervisor, Router (deterministic intent-v1.3), four bounded agents, tool registries and profile
 * reader. Replaced ONLY: token verification (authServiceClientDeps seam), the HTTP transport (axios adapter, no socket), the
 * agents' models (scripted M5 mock providers), the domain READ deps (synthetic per-user fixtures), the idempotency store and the
 * history repository (in-memory fakes), and the V1 controller (stubbed to COUNT that V1 was reached — no model, no DB).
 *
 * Evidence label: CONTROLLER INTEGRATION / TEST FIXTURE. It is NOT REAL HTTP against a deployed service and NOT a REAL BROWSER run.
 * No bearer is real, no DB / Redis / AWS / Bedrock / network is touched (fetch, the Bedrock client and the V1 model are blocked
 * and counted; the last test asserts 0).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.t3.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.t3.invalid";
delete process.env.RATE_LIMIT_PROVIDER;
for (const k of ["USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED"]) delete process.env[k];

import type { MockProvider, WorldState } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { AnySessionStore } from "../agent-v2/session-context";
import type { CoachBridgeSeam } from "../services/coach-bridge.middleware";
import { fakeStore, fakeHistory } from "./coach-continuity-fakes";

const SRC = path.resolve(__dirname, "..");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const SECRET = "test-internal-secret";
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const Q_TODAY = "Hôm nay tôi tập gì?";
const Q_THREE = "Tôi tập chân hôm qua và hơi mệt, hôm nay nên tập gì và ăn gì?";
const Q_BENCH = "Mức tạ bench của tôi tháng này có nhích lên không?";
const Q_SAFETY = "Làm sao giảm 10kg trong 1 tuần?";
const Q_CALO = "Mục tiêu calo của tôi là bao nhiêu?";
const V1_BODY = { success: true, data: { v1: true } };

let hz: typeof import("./m5-benchmark/harness");
const call = (...a: Parameters<typeof hz.call>) => hz.call(...a);
const say = (t: string) => hz.say(t);
const use = (...b: Parameters<typeof hz.use>) => hz.use(...b);

// ── transport (axios adapter): profile reads per bearer; no socket is ever opened ────────────────────────────────────────
type Reply = { status: number; data?: unknown } | { error: "timeout" | "network" };
const net = { calls: [] as Array<{ url: string; auth: string }>, profiles: {} as Record<string, Reply>, gate: null as Promise<void> | null };
const adultProfile = (userId: string, age: number | null = 30) => ({ status: 200, data: { profile: { userId, age } } });
const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
  if ("error" in r) throw new AxiosError("timeout of 3000ms exceeded", AxiosError.ECONNABORTED, config, {});
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, r.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const adapter: AxiosAdapter = async (config) => {
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
  const url = String(config.url ?? "");
  net.calls.push({ url, auth });
  if (url.endsWith("/profile/me")) {
    if (net.gate) await net.gate; // lets a test hold V2 in flight while duplicates arrive
    return respond(config, net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} });
  }
  return respond(config, { status: 404, data: { error: "not mocked" } });
};

let app: Express;
let seam: CoachBridgeSeam;
let rtSeam: { factory: (() => any) | null };
let createRuntime: typeof import("../agent-v2-integration/multi-agent-runtime").createMultiAgentRuntime;
let createCoachV2Executor: typeof import("../agent-v2-integration/multi-agent-runtime").createCoachV2Executor;
let V2NotStartedError: typeof import("../services/coach-v2-bridge").V2NotStartedError;
let v1Ask = 0, v1Stream = 0, llmCalls = 0, blocked = 0, loaderCalls = 0, factoryCalls = 0;
let realLoader: (() => Promise<any>) | null = null;

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE: V1 model call"); };
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  // V1 controller stubs — captured by the route at import, exactly as the existing V2 HTTP tests do. They only COUNT.
  const { aiController } = await import("../controllers/ai.controller");
  (aiController as any).ask = (_req: any, res: any) => { v1Ask++; res.status(200).json(V1_BODY); };
  (aiController as any).askStream = (_req: any, res: any) => { v1Stream++; res.status(200).type("text/event-stream").end('data: {"type":"done"}\n\n'); };
  hz = await import("./m5-benchmark/harness");
  ({ default: app } = await import("../app"));
  const rt = await import("../agent-v2-integration/multi-agent-runtime");
  rtSeam = rt.multiAgentRuntimeSeam; createRuntime = rt.createMultiAgentRuntime; createCoachV2Executor = rt.createCoachV2Executor;
  ({ V2NotStartedError } = await import("../services/coach-v2-bridge"));
  seam = (await import("../services/coach-bridge.middleware")).coachBridgeSeam;
  realLoader = seam.loadExecutor;
  assert.ok(realLoader, "routes/ai-v2.routes.ts registers the lazy executor loader");
  seam.loadExecutor = async () => { loaderCalls++; return realLoader!(); }; // count real loads; still the real loader
});
test.after(() => { rtSeam.factory = null; seam.ports = null; seam.overrides = {}; for (const k of ["AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS"]) delete process.env[k]; });

const downSync = (): AnySessionStore => ({ load: () => { throw new Error("down"); }, save: () => { throw new Error("down"); } });

function rig(o: { world?: Partial<WorldState>; profiles?: Record<string, Reply>; store?: AnySessionStore; defaultSinks?: boolean; ports?: boolean; fakes?: { failCreateTurnTimes?: number } } = {}) {
  const clock = () => T0;
  const w = hz.world(clock, o.world);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = [];
  net.calls.length = 0; net.gate = null;
  net.profiles = { "tok-a": adultProfile(USER_A), "tok-b": adultProfile(USER_B), ...(o.profiles ?? {}) };
  const runtime = createRuntime({
    providerFor: (a) => prov[a], now: clock, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
    ...(o.store ? { sessionStore: o.store } : {}),
    ...(o.defaultSinks ? {} : { traceSink: (x: SupervisorTrace) => traces.push(x) }),
  });
  rtSeam.factory = () => { factoryCalls++; return runtime; };
  const s = fakeStore(); const h = fakeHistory(o.fakes ?? {});
  seam.ports = o.ports === false ? null : { idempotency: s.store, history: h.history };
  seam.overrides = { now: clock, newSessionId: (() => { let n = 0; return () => `00000000-0000-4000-8000-0000000000${String(++n).padStart(2, "0")}`; })() };
  v1Ask = 0; v1Stream = 0; loaderCalls = 0; factoryCalls = 0; llmCalls = 0;
  const modelRequests = () => Object.values(prov).reduce((n, p) => n + p.requests.length, 0);
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  return { w, prov, traces, store: s, hist: h, modelRequests, profileReads };
}
const bridgeOn = (users: string = USER_A) => { process.env.AI_COACH_V2_BRIDGE = "on"; process.env.AI_COACH_V2_BRIDGE_USERS = users; process.env.AI_AGENT_V2 = "on"; };
const allOff = () => { for (const k of ["AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE"]) delete process.env[k]; };
let reqSeq = 0;
const key = (n?: string) => `req-${n ?? ++reqSeq}-0000001`;
const ask = (token: string | null, body: object, extra: Record<string, string> = {}) => {
  const r = request(app).post("/ai/ask").set(extra);
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body);
};
const stream = (token: string | null, body: object) => {
  const r = request(app).post("/ai/ask/stream");
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body);
};
const scriptToday = (s: ReturnType<typeof rig>, text = "Hôm nay bạn có buổi Leg day với 2 bài.") =>
  s.prov.training.script(use(call("training.get_today_schedule")), say(text));
const touched = (s: ReturnType<typeof rig>) => s.store.recs.size + s.hist.turns.length + s.hist.sessions.size + s.modelRequests() + s.profileReads() + loaderCalls + factoryCalls;

// ══ V1 stays V1 ════════════════════════════════════════════════════════════════════════════════════════════════════════
test("T3-1 flag OFF (unset / wrong value): /ai/ask is V1 exactly as before — same body, nothing read, nothing loaded", async () => {
  for (const v of [undefined, "true", "ON", "1", "off"]) {
    allOff(); if (v !== undefined) process.env.AI_COACH_V2_BRIDGE = v;
    process.env.AI_COACH_V2_BRIDGE_USERS = USER_A; process.env.AI_AGENT_V2 = "on"; // everything else is ON: only the bridge flag decides
    const s = rig();
    const r = await ask("tok-a", { question: Q_TODAY, clientRequestId: key() });
    assert.equal(r.status, 200); assert.deepEqual(r.body, V1_BODY, String(v));
    assert.equal(v1Ask, 1); assert.equal(touched(s), 0, `flag=${String(v)}: no V2 work of any kind`);
  }
  allOff();
});

test("T3-2 SSE /ai/ask/stream is never bridged: V1 with the flag ON for an eligible user and an eligible question", async () => {
  bridgeOn(); const s = rig();
  const r = await stream("tok-a", { question: Q_TODAY, clientRequestId: key() });
  assert.equal(r.status, 200); assert.match(r.headers["content-type"], /text\/event-stream/);
  assert.equal(v1Stream, 1); assert.equal(v1Ask, 0); assert.equal(touched(s), 0);
  allOff();
});

test("T3-3 flag ON but not eligible → V1: not allowlisted, V1-only capability (command / confirmation / create), no valid key, service caller, conversation on V1, ports absent", async () => {
  bridgeOn(); let s = rig();
  const cases: Array<[string, () => Promise<{ status: number; body: unknown }>]> = [
    ["not allowlisted", () => ask("tok-b", { question: Q_TODAY, clientRequestId: key() })],
    ["command (change exercise)", () => ask("tok-a", { question: "Đổi bài squat sang bài khác giúp tôi", clientRequestId: key() })],
    ["create workflow", () => ask("tok-a", { question: "Tạo lịch tập 5 buổi cho tôi", clientRequestId: key() })],
    ["confirmation", () => ask("tok-a", { question: "Xác nhận", clientRequestId: key() })],
    ["statement of intent", () => ask("tok-a", { question: "Tôi muốn tạo lịch tập mới", clientRequestId: key() })],
    ["no clientRequestId", () => ask("tok-a", { question: Q_TODAY })],
    ["malformed clientRequestId", () => ask("tok-a", { question: Q_TODAY, clientRequestId: "bad id!" })],
    ["service caller without a user bearer", () => ask(null, { question: Q_TODAY, clientRequestId: key() }, { "x-internal-token": SECRET, "x-user-id": USER_A })],
  ];
  for (const [name, go] of cases) { v1Ask = 0; const r = await go(); assert.equal(r.status, 200, name); assert.deepEqual(r.body, V1_BODY, name); assert.equal(v1Ask, 1, name); assert.equal(touched(s), 0, `${name}: nothing started (rec ${s.store.recs.size} turn ${s.hist.turns.length} sess ${s.hist.sessions.size} model ${s.modelRequests()} prof ${s.profileReads()} loader ${loaderCalls} factory ${factoryCalls})`); }
  assert.equal(touched(s), 0, "none of the above started V2, claimed a key, read a profile or loaded the runtime");
  // a conversation that already has V1 turns stays on V1
  s = rig(); s.hist.sessions.set("33333333-3333-4333-8333-333333333333", { id: "33333333-3333-4333-8333-333333333333", userId: USER_A, archivedAt: null });
  s.hist.legacyEngines.set("33333333-3333-4333-8333-333333333333", ["some-v1-model"]);
  const onV1 = await ask("tok-a", { question: Q_TODAY, clientRequestId: key(), sessionId: "33333333-3333-4333-8333-333333333333" });
  assert.deepEqual(onV1.body, V1_BODY); assert.equal(touched(s), 1, "only the pre-seeded session exists: no claim, no model, no read, no write");
  // ports (idempotency store + history) not configured in this process: V2 can never run, V1 answers
  s = rig({ ports: false });
  const noPorts = await ask("tok-a", { question: Q_TODAY, clientRequestId: key() });
  assert.deepEqual(noPorts.body, V1_BODY); assert.equal(touched(s), 0, "the executor was not even loaded");
  allOff();
});

test("T3-4 authentication / validation are unchanged and run BEFORE the bridge: 401 for no / forged token and a bare x-user-id; 400 for a bad body; V2 never runs", async () => {
  bridgeOn(); const s = rig();
  assert.equal((await ask(null, { question: Q_TODAY, clientRequestId: key() })).status, 401);
  assert.equal((await ask("tok-forged", { question: Q_TODAY, clientRequestId: key() })).status, 401);
  assert.equal((await ask(null, { question: Q_TODAY, clientRequestId: key() }, { "x-user-id": USER_A })).status, 401, "a body/header user id is never trusted");
  for (const body of [{ question: "" }, { question: "x".repeat(2_001) }, { sessionId: "not-a-uuid", question: "ok" }, {}]) assert.equal((await ask("tok-a", body)).status, 400, JSON.stringify(body).slice(0, 40));
  assert.equal(v1Ask, 0); assert.equal(touched(s), 0);
  allOff();
});

// ══ V2 through the real route ═════════════════════════════════════════════════════════════════════════════════════════
test("T3-5 eligible question → V2: the REAL Supervisor / Router / agent / tool registry / profile reader execute (mock model + fixtures); history written once", async () => {
  bridgeOn(); const s = rig(); scriptToday(s);
  const id = key();
  const r = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  const d = r.body.data;
  assert.equal(d.engine, "multi-agent-v2"); assert.equal(d.question, Q_TODAY); assert.match(d.answer, /Leg day/);
  assert.deepEqual([d.v2.status, d.v2.kind, d.v2.replayed, d.v2.historyRecorded], ["ANSWERED", "answered", false, true]);
  assert.deepEqual(d.v2.agents, ["training"]); assert.ok(d.v2.turnId && d.v2.traceId);
  assert.match(d.sessionId, UUID);
  assert.equal(v1Ask, 0, "the V1 controller did not run");
  // proof the multi-agent machinery ran (not a static fixture): supervisor trace, the agent's model loop, a registry tool call, the profile read WITH the user's bearer
  assert.equal(s.traces.length, 1); assert.equal(s.traces[0].delegations.length, 1); assert.equal(s.traces[0].delegations[0].agentId, "training");
  assert.ok(s.prov.training.requests.length >= 2, "agent model loop: tool call then answer");
  assert.deepEqual(s.w.calls, ["getTodaySchedule:A"]);
  assert.deepEqual(net.calls.filter((c) => c.url.endsWith("/profile/me")).map((c) => c.auth), ["Bearer tok-a"]);
  assert.equal(loaderCalls, 1, "the runtime was loaded once, lazily, after every gate");
  // history: one session + one turn, linked by the id V2 used; nothing invented
  assert.equal(s.hist.sessions.size, 1); assert.equal(s.hist.turns.length, 1);
  const t = s.hist.turns[0];
  assert.deepEqual([t.userId, t.sessionId, t.clientRequestId, t.modelUsed, t.answer], [USER_A, d.sessionId, id, "multi-agent-v2", d.answer]);
  for (const invented of ["structuredBlocks", "routeIntent", "responseLanguage", "relevance", "evidenceUsed"]) assert.ok(!(invented in t), invented);
  assert.ok(!("structuredBlocks" in d) && !("evidenceUsed" in d) && !("conversationId" in d), "no V1-only metadata is fabricated into the response");
  assert.equal(JSON.stringify(r.body).includes(USER_A), false, "no user id echoed"); assert.equal(JSON.stringify(r.body).includes("tok-a"), false);
  allOff();
});

test("T3-6 duplicate clientRequestId → V2 ran ONCE: the retry is answered from the stored result, no second run, no second history row", async () => {
  bridgeOn(); const s = rig(); scriptToday(s);
  const id = key();
  const first = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
  const reqs = s.modelRequests(), reads = s.profileReads(), loads = loaderCalls;
  for (let i = 0; i < 3; i++) {
    const again = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
    assert.equal(again.status, 200); assert.equal(again.body.data.v2.replayed, true);
    assert.equal(again.body.data.answer, first.body.data.answer); assert.equal(again.body.data.sessionId, first.body.data.sessionId);
    assert.equal(again.body.data.v2.traceId, first.body.data.v2.traceId);
  }
  assert.equal(s.traces.length, 1); assert.equal(s.modelRequests(), reqs); assert.equal(s.profileReads(), reads); assert.equal(loaderCalls, loads);
  assert.equal(s.hist.turns.length, 1); assert.equal(s.hist.sessions.size, 1); assert.equal(v1Ask, 0);
  allOff();
});

test("T3-7 CONCURRENT duplicates → exactly one V2 run: one 200, the others 409 OPERATION_IN_PROGRESS; afterwards a retry replays", async () => {
  bridgeOn(); const s = rig(); scriptToday(s);
  let claims = 0; const claim = s.store.store.claim;
  s.store.store.claim = async (...a) => { claims++; return claim(...a); };
  let open!: () => void; net.gate = new Promise<void>((r) => { open = r; });
  const id = key("conc");
  const burst = Promise.all(Array.from({ length: 4 }, () => ask("tok-a", { question: Q_TODAY, clientRequestId: id }).then((r) => r)));
  for (let i = 0; i < 400 && claims < 4; i++) await new Promise((r) => setTimeout(r, 5)); // wait until every duplicate has reached the claim while V2 is held in flight
  assert.equal(claims, 4, "all four duplicates reached the claim");
  open();
  const rs = await burst;
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409, 409]);
  for (const r of rs.filter((x) => x.status === 409)) { assert.equal(r.body.error.code, "OPERATION_IN_PROGRESS"); assert.ok(r.headers["retry-after"]); }
  assert.equal(s.traces.length, 1, "V2 did not run twice"); assert.equal(s.profileReads(), 1); assert.equal(s.hist.turns.length, 1); assert.equal(v1Ask, 0);
  const retry = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
  assert.equal(retry.status, 200); assert.equal(retry.body.data.v2.replayed, true); assert.equal(s.traces.length, 1);
  allOff();
});

test("T3-8 same clientRequestId with a different question / session → 409 IDEMPOTENCY_KEY_CONFLICT (or 404 for a foreign session); V2 is not re-run", async () => {
  bridgeOn(); const s = rig(); scriptToday(s);
  const id = key();
  await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
  const other = await ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu hôm nay?", clientRequestId: id });
  assert.equal(other.status, 409); assert.equal(other.body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  const foreign = await ask("tok-a", { question: Q_TODAY, clientRequestId: id, sessionId: "99999999-9999-4999-8999-999999999999" });
  assert.equal(foreign.status, 404); assert.equal(foreign.body.error.code, "SESSION_NOT_FOUND");
  assert.equal(s.traces.length, 1); assert.equal(s.hist.turns.length, 1);
  allOff();
});

test("T3-9 cross-user isolation: the same key under another user is its own action with its own data; another user's session does not exist for you", async () => {
  bridgeOn(`${USER_A},${USER_B}`); const s = rig(); scriptToday(s);
  const id = key("shared");
  const a = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
  scriptToday(s, "Hôm nay bạn có buổi B-Push day.");
  const b = await ask("tok-b", { question: Q_TODAY, clientRequestId: id });
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(b.body.data.v2.replayed, false);
  assert.match(a.body.data.answer, /Leg day/); assert.match(b.body.data.answer, /B-Push/); assert.doesNotMatch(b.body.data.answer, /Leg day/, "never user A's cached response");
  assert.deepEqual(s.w.calls, ["getTodaySchedule:A", "getTodaySchedule:B"]);
  assert.equal(s.traces.length, 2); assert.equal(s.hist.turns.length, 2);
  assert.deepEqual(s.hist.turns.map((t) => t.userId).sort(), [USER_A, USER_B]);
  assert.notEqual(a.body.data.sessionId, b.body.data.sessionId);
  const steal = await ask("tok-b", { question: Q_TODAY, clientRequestId: key(), sessionId: a.body.data.sessionId });
  assert.equal(steal.status, 404); assert.equal(steal.body.error.code, "SESSION_NOT_FOUND");
  assert.equal(s.traces.length, 2);
  allOff();
});

// ══ V2 decisions are final ════════════════════════════════════════════════════════════════════════════════════════════
test("T3-10 V2 safety block / minor restriction / profile unverified / session unavailable: the V2 state is returned as is — V1 is NEVER used, nothing is written to history, a retry replays the same decision", async () => {
  const scenarios: Array<{ name: string; q: string; status: string; block: string; rigOpts?: Parameters<typeof rig>[0]; models0?: boolean }> = [
    { name: "safety", q: Q_SAFETY, status: "SAFETY_BLOCKED", block: "SAFETY" },
    { name: "minor", q: Q_CALO, status: "MINOR_PROTECTED", block: "MINOR", rigOpts: { profiles: { "tok-a": adultProfile(USER_A, 16) } } },
    { name: "profile unavailable", q: Q_TODAY, status: "PROFILE_UNVERIFIED", block: "MINOR", rigOpts: { profiles: { "tok-a": { error: "timeout" } } } },
    { name: "session store down", q: Q_BENCH, status: "SESSION_UNAVAILABLE", block: "PERSISTENCE", rigOpts: { store: downSync() } },
  ];
  for (const sc of scenarios) {
    bridgeOn(); const s = rig(sc.rigOpts);
    const id = key();
    const r = await ask("tok-a", { question: sc.q, clientRequestId: id });
    assert.equal(r.status, 200, sc.name); assert.equal(r.body.data.engine, "multi-agent-v2", sc.name);
    assert.equal(r.body.data.v2.status, sc.status, sc.name); assert.equal(r.body.data.v2.kind, "blocked", sc.name); assert.equal(r.body.data.v2.block, sc.block, sc.name);
    assert.ok(r.body.data.answer.length > 0, sc.name); assert.deepEqual(r.body.data.v2.agents, [], `${sc.name}: no agent ran`);
    assert.equal(v1Ask, 0, `${sc.name}: no fallback to V1`); assert.equal(s.modelRequests(), 0, `${sc.name}: no model was called`); assert.deepEqual(s.w.calls, [], sc.name);
    assert.equal(s.hist.turns.length + s.hist.sessions.size, 0, `${sc.name}: a blocked turn is not written to history`);
    assert.equal(r.body.data.v2.historyRecorded, false); assert.ok(!("sessionId" in r.body.data), `${sc.name}: no session is exposed for an unpersisted turn`);
    const traces = s.traces.length; const again = await ask("tok-a", { question: sc.q, clientRequestId: id });
    assert.equal(again.body.data.v2.status, sc.status); assert.equal(again.body.data.v2.replayed, true); assert.equal(s.traces.length, traces, `${sc.name}: not re-run`); assert.equal(v1Ask, 0);
    allOff();
  }
});

test("T3-11 PARTIAL stays PARTIAL (never ANSWERED): deferred domain disclosed, executed agents listed, not written to history by default", async () => {
  bridgeOn(); const s = rig();
  scriptToday(s); s.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ có tinh bột và một ít đạm."));
  const r = await ask("tok-a", { question: Q_THREE, clientRequestId: key() });
  assert.equal(r.status, 200); assert.equal(r.body.data.v2.status, "PARTIAL"); assert.equal(r.body.data.v2.kind, "partial");
  assert.deepEqual([...r.body.data.v2.agents].sort(), ["nutrition", "training"]); assert.match(r.body.data.answer, /chưa được xử lý trong lượt này/);
  assert.equal(r.body.data.v2.historyRecorded, false); assert.equal(s.hist.turns.length, 0); assert.ok(!("sessionId" in r.body.data)); assert.equal(v1Ask, 0);
  // D-P12 switch: persisting PARTIAL records it ONCE, still reported as partial
  const s2 = rig(); seam.overrides = { ...seam.overrides, persistPartial: true };
  scriptToday(s2); s2.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ có tinh bột và một ít đạm."));
  const id = key(); const p = await ask("tok-a", { question: Q_THREE, clientRequestId: id });
  await ask("tok-a", { question: Q_THREE, clientRequestId: id });
  assert.equal(p.body.data.v2.kind, "partial"); assert.equal(p.body.data.v2.historyRecorded, true); assert.equal(s2.hist.turns.length, 1);
  allOff();
});

test("T3-12 V2 failure after it started (runtime cannot be created / throws mid-turn) → 503, never V1; the key is in doubt, V2 is not re-run, a NEW key is a new attempt", async () => {
  for (const mode of ["factory throws (required state unconfigured)", "ask rejects mid-turn"] as const) {
    bridgeOn(); const s = rig();
    const { ApiError } = await import("../errors/api-error");
    rtSeam.factory = mode.startsWith("factory")
      ? () => { factoryCalls++; throw new ApiError("SERVICE_UNAVAILABLE", "The assistant's session storage is not configured", 503); }
      : () => { factoryCalls++; return { ask: async () => { throw new Error("boom: internal detail"); } }; };
    const id = key();
    const r = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
    assert.equal(r.status, 503, mode); assert.equal(r.body.error.code, "SERVICE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(r.body), /boom|storage is not configured|internal/i, "no internal detail leaks");
    assert.equal(v1Ask, 0, `${mode}: no V1 fallback`); assert.equal(s.hist.turns.length + s.hist.sessions.size, 0);
    const retry = await ask("tok-a", { question: Q_TODAY, clientRequestId: id });
    assert.equal(retry.status, 409, "the failed action is not silently re-run"); assert.equal(factoryCalls, 1, `${mode}: V2 not re-run`); assert.equal(v1Ask, 0);
    const fresh = await ask("tok-a", { question: Q_TODAY, clientRequestId: key() });
    assert.equal(fresh.status, 503); assert.equal(factoryCalls, 2, "a new key is a new attempt"); assert.equal(v1Ask, 0);
    allOff();
  }
});

test("T3-13 V2 provably not started (its own flag closed) → V1 answers and the idempotency claim is released; production approval of V2 still applies to the bridge", async () => {
  process.env.AI_COACH_V2_BRIDGE = "on"; process.env.AI_COACH_V2_BRIDGE_USERS = USER_A; delete process.env.AI_AGENT_V2;
  const s = rig();
  const r = await ask("tok-a", { question: Q_TODAY, clientRequestId: key() });
  assert.deepEqual(r.body, V1_BODY); assert.equal(v1Ask, 1);
  assert.equal(s.store.recs.size, 0, "claim released"); assert.equal(s.hist.turns.length + s.hist.sessions.size, 0); assert.equal(factoryCalls, 0); assert.equal(s.profileReads(), 0);
  // adapter level: V2's own HTTP gate (flag + production second approval) is honoured by the executor
  const runtime = { ask: async () => ({ status: "ANSWERED", answer: "x" }) as any };
  const input = { question: Q_TODAY, userId: USER_A, authorizationHeader: "Bearer tok-a" };
  await assert.rejects(createCoachV2Executor({ runtime: () => runtime, env: { AI_AGENT_V2: "on", NODE_ENV: "production" } }).ask(input), (e: unknown) => e instanceof V2NotStartedError);
  await assert.rejects(createCoachV2Executor({ runtime: () => runtime, env: {} }).ask(input), (e: unknown) => e instanceof V2NotStartedError);
  assert.equal((await createCoachV2Executor({ runtime: () => runtime, env: { AI_AGENT_V2: "on", NODE_ENV: "production", AI_AGENT_V2_PRODUCTION_APPROVED: "yes" } }).ask(input)).status, "ANSWERED");
  allOff();
});

test("T3-14 logs carry codes only: no bearer, user id, question or answer text appears in anything the shared logger was given while a V2 turn (default sinks) and a blocked turn ran", async () => {
  bridgeOn(); const s = rig({ defaultSinks: true }); scriptToday(s);
  const chunks: string[] = [];
  const { logger } = await import("@gym-coach/shared");
  const methods = ["trace", "debug", "info", "warn", "error"] as const;
  const originals = methods.map((m) => (logger as any)[m]);
  methods.forEach((m) => { (logger as any)[m] = (...a: unknown[]) => { try { chunks.push(JSON.stringify(a)); } catch { chunks.push(String(a)); } }; });
  try {
    const ok = await ask("tok-a", { question: Q_TODAY, clientRequestId: key() });
    const bad = await ask("tok-a", { question: Q_SAFETY, clientRequestId: key() });
    assert.equal(ok.status, 200); assert.equal(bad.status, 200);
  } finally { methods.forEach((m, i) => { (logger as any)[m] = originals[i]; }); }
  const log = chunks.join("");
  assert.match(log, /coach_bridge_decision/, "the capture works and the bridge logs its decision codes"); assert.match(log, /agent_v2_supervisor_turn/, "the V2 supervisor default sink logged too");
  for (const secret of ["tok-a", "Bearer", USER_A, Q_TODAY, Q_SAFETY, "Leg day", SECRET]) assert.equal(log.includes(secret), false, `log must not contain ${secret.slice(0, 12)}`);
  allOff();
});

// ══ pins for what is deliberately unchanged ═══════════════════════════════════════════════════════════════════════════
test("T3-15 V1 files: the route diff vs the pre-bridge baseline is exactly one import + one handler (+comments) on POST /ask; /ask/stream and the controller are untouched", () => {
  const root = path.resolve(SRC, "..", "..", "..", "..");
  const rel = (f: string) => `backend/services/ai-service/src/${f}`;
  const diff = execFileSync("git", ["diff", "-U0", "a6b517cd", "--", rel("routes/ai.routes.ts")], { cwd: root, encoding: "utf8" })
    .split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  assert.deepEqual(diff.filter((l) => l.startsWith("-")), [], "nothing in the V1 route was removed or edited");
  assert.deepEqual(diff.filter((l) => l.startsWith("+") && !/^\+\s*\/\//.test(l)), ['+import { coachBridgeAsk } from "../services/coach-bridge.middleware";', "+  coachBridgeAsk,"]);
  const routes = fs.readFileSync(path.join(SRC, "routes", "ai.routes.ts"), "utf8");
  assert.match(routes, /"\/ask",\s*askRateLimiter,\s*validateBody\(AskRequestSchema\),\s*bindRequestIdentity,[\s\S]*?coachBridgeAsk,\s*aiController\.ask,/, "after auth (router.use), the shared rate limiter, validation and request identity");
  assert.match(routes, /"\/ask\/stream",\s*askRateLimiter,\s*validateBody\(AskRequestSchema\),\s*bindRequestIdentity,\s*aiController\.askStream,/);
  const untouched = execFileSync("git", ["diff", "--name-only", "a6b517cd", "--", rel("controllers/ai.controller.ts"), rel("services/rag.service.ts"), rel("services/request-identity.ts"), rel("routes/fitness-agent.routes.ts"), rel("app.ts")], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(untouched, "", "controller, V1 idempotency, vision/agent routes and app.ts are byte-identical");
});

test("T3-16 isolation: V1 files never import agent-v2; the V2 runtime is reached only by the dynamic import in routes/ai-v2.routes.ts", () => {
  const mw = fs.readFileSync(path.join(SRC, "services", "coach-bridge.middleware.ts"), "utf8");
  assert.doesNotMatch(mw, /from\s+["'][^"']*agent-v2|import\(\s*["'][^"']*agent-v2|require\(\s*["'][^"']*agent-v2|AI_AGENT_V2/);
  const v2routes = fs.readFileSync(path.join(SRC, "routes", "ai-v2.routes.ts"), "utf8");
  assert.match(v2routes, /coachBridgeSeam\.loadExecutor = async \(\) => \(await import\("\.\.\/agent-v2-integration\/multi-agent-runtime"\)\)\.createCoachV2Executor\(\);/);
  assert.doesNotMatch(v2routes, /^import .*agent-v2/m);
  assert.equal(coachBridgeSeamIsEmptyByDefault(), true);
});
function coachBridgeSeamIsEmptyByDefault(): boolean {
  const src = fs.readFileSync(path.join(SRC, "services", "coach-bridge.middleware.ts"), "utf8");
  return /coachBridgeSeam: CoachBridgeSeam = \{ loadExecutor: null, ports: null, overrides: \{\} \}/.test(src);
}

test("T3-17 no external network, model or provider call happened in this file, and nothing was enabled by default", () => {
  assert.equal(blocked, 0, "fetch / Bedrock were never called"); assert.equal(llmCalls, 0, "the V1 model was never called");
  allOff();
  assert.equal(process.env.AI_COACH_V2_BRIDGE, undefined); assert.equal(process.env.AI_AGENT_V2, undefined);
  assert.equal(seam.overrides.enabled, undefined, "no test-only enable override");
});
