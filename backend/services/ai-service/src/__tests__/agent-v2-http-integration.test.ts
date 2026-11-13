/**
 * V2 Multi-Agent M7-P1 — LOCAL HTTP vertical slice: POST /ai/v2/ask through the REAL ai-service `app` (real requireAuth,
 * real route + flag gate, real composition root, real supervisor / four bounded agents / registries / profile reader over
 * the real V1 service client). Replaced only: auth-service token verification (authServiceClientDeps seam), the HTTP
 * transport (axios adapter — no socket is ever opened), the model (scripted mock providers), and — except in HV-22 —
 * the domain READ deps (synthetic per-user fixtures). CONTROLLER INTEGRATION TEST — not real-infrastructure E2E:
 * no DB, Redis, AWS, Bedrock or network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.m7p1.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.m7p1.invalid";
delete process.env.RATE_LIMIT_PROVIDER;
delete process.env.USER_LAMBDA_NAME;
delete process.env.FITNESS_LAMBDA_NAME;
delete process.env.AUTH_LAMBDA_NAME;
delete process.env.AI_AGENT_V2;

import type { MockProvider, WorldState } from "./m5-benchmark/harness";
// fixed values of the harness (it is imported dynamically in before(), AFTER the env above is set)
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
let hz: typeof import("./m5-benchmark/harness");
const call = (...a: Parameters<typeof hz.call>) => hz.call(...a);
const say = (t: string) => hz.say(t);
const use = (...b: Parameters<typeof hz.use>) => hz.use(...b);
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { ToolTraceEvent } from "../agent-v2/tool-registry";

const SECRET = "test-internal-secret";
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const H = 3_600_000;

// ── transport (axios adapter): profile reads per bearer; HV-22 also answers fitness READs ──────────────────────────────
type Reply = { status: number; data?: unknown } | { error: "timeout" | "network" };
const net = { calls: [] as Array<{ url: string; auth: string }>, profiles: {} as Record<string, Reply>, fitness: {} as Record<string, Reply> };
const adultProfile = (userId: string, age: number | null = 30) => ({ status: 200, data: { profile: { userId, age } } });
const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
  if ("error" in r) throw r.error === "timeout" ? new AxiosError("timeout of 3000ms exceeded", AxiosError.ECONNABORTED, config, {}) : new AxiosError("connect ECONNREFUSED", "ECONNREFUSED", config, {});
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, r.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const adapter: AxiosAdapter = async (config) => {
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
  const url = String(config.url ?? "");
  net.calls.push({ url, auth });
  if (url.endsWith("/profile/me")) return respond(config, net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} });
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const hit = Object.keys(net.fitness).find((p) => path.startsWith(p));
  if (url.startsWith("http://fitness-service.m7p1.invalid") && hit) return respond(config, net.fitness[hit]);
  return respond(config, { status: 404, data: { error: "not mocked" } });
};

let app: Express;
let seam: { factory: (() => any) | null };
let createRuntime: typeof import("../agent-v2-integration/multi-agent-runtime").createMultiAgentRuntime;
let factoryCalls = 0;
let v1AskReached = 0;
let llmCalls = 0;
let blocked = 0;
const allWriteCalls: string[] = [];

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE: model call"); };
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  // V1 /ai/ask stays the V1 controller (stubbed only to count that it is reached and to avoid a model / DB)
  const { aiController } = await import("../controllers/ai.controller");
  (aiController as any).ask = (_req: any, res: any) => { v1AskReached++; res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  assert.equal(hz.USER_A, USER_A); assert.equal(hz.T0, T0);
  ({ default: app } = await import("../app"));
  const rt = await import("../agent-v2-integration/multi-agent-runtime");
  seam = rt.multiAgentRuntimeSeam; createRuntime = rt.createMultiAgentRuntime;
});
test.after(() => { seam.factory = null; delete process.env.AI_AGENT_V2; });

/** A runtime over synthetic per-user domain data (real supervisor/agents/registries/profile reader). */
function rig(o: { now?: number; world?: Partial<WorldState>; profiles?: Record<string, Reply>; v1Deps?: boolean } = {}) {
  let t = o.now ?? T0;
  const clock = () => t;
  const w = hz.world(clock, o.world);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = []; const toolEvents: ToolTraceEvent[] = [];
  net.calls.length = 0;
  net.profiles = { "tok-a": adultProfile(USER_A), "tok-b": adultProfile(USER_B), ...(o.profiles ?? {}) };
  const runtime = createRuntime({
    providerFor: (a) => prov[a], now: clock,
    ...(o.v1Deps ? {} : { deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress } }),
    traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x), toolTraceSink: (e) => toolEvents.push(e),
  });
  seam.factory = () => { factoryCalls++; return runtime; };
  const modelRequests = () => Object.values(prov).reduce((n, p) => n + p.requests.length, 0);
  const profileReads = () => net.calls.filter((c) => c.url.endsWith("/profile/me")).length;
  const done = () => { allWriteCalls.push(...w.calls.filter((c) => c.startsWith("WRITE:"))); };
  return { w, prov, traces, agentTraces, toolEvents, modelRequests, profileReads, done, advance: (ms: number) => { t += ms; } };
}
const ask = (token: string | null, body: object, extra: Record<string, string> = {}) => {
  const r = request(app).post("/ai/v2/ask").set(extra);
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body);
};
const on = () => { process.env.AI_AGENT_V2 = "on"; };

// ── gates ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HV-1 flag OFF (unset / wrong value / production without approval): 404, the runtime is never created or called", async () => {
  rig(); const before = factoryCalls;
  delete process.env.AI_AGENT_V2;
  for (const r of [await ask("tok-a", { question: "Hôm nay tôi tập gì?" }), await ask(null, { question: "x" })]) {
    assert.equal(r.status, 404); assert.equal(r.body?.error?.code ?? r.body?.code ?? "NOT_FOUND", "NOT_FOUND");
  }
  process.env.AI_AGENT_V2 = "true";
  assert.equal((await ask("tok-a", { question: "Hôm nay tôi tập gì?" })).status, 404);
  const env = process.env.NODE_ENV;
  process.env.AI_AGENT_V2 = "on"; process.env.NODE_ENV = "production";
  try { assert.equal((await ask("tok-a", { question: "Hôm nay tôi tập gì?" })).status, 404, "production needs the second explicit approval"); }
  finally { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; delete process.env.AI_AGENT_V2; }
  assert.equal(factoryCalls, before); assert.equal(net.calls.length, 0, "nothing was read");
});

test("HV-2 authentication: missing / invalid token → 401; service call or dev bare x-user-id → refused; body identity → 400", async () => {
  on(); const s = rig(); const before = factoryCalls;
  assert.equal((await ask(null, { question: "Hôm nay tôi tập gì?" })).status, 401);
  assert.equal((await ask("tok-forged", { question: "Hôm nay tôi tập gì?" })).status, 401);
  assert.equal((await ask(null, { question: "Hôm nay tôi tập gì?" }, { "x-user-id": USER_A })).status, 401, "a bare x-user-id is never trusted");
  assert.equal((await ask(null, { question: "Hôm nay tôi tập gì?" }, { "x-internal-token": SECRET, "x-user-id": USER_A })).status, 403, "service caller without a user bearer");
  for (const body of [{ question: "Hôm nay tôi tập gì?", userId: USER_B }, { question: "" }, { question: "x".repeat(2_001) }, { question: "ok", sessionId: "../../etc" }]) {
    assert.equal((await ask("tok-a", body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(factoryCalls, before, "no runtime work for a refused request"); assert.equal(s.modelRequests(), 0);
});

// ── single / multi-agent slices ──────────────────────────────────────────────────────────────────────────────────────
test("HV-3 Training-only (JWT and gateway paths): identity from the verified context, one profile read, own data only", async () => {
  on(); const s = rig();
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  const r = await ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r.status, 200); assert.equal(r.body.data.status, "ANSWERED"); assert.deepEqual(r.body.data.agents, ["training"]);
  assert.match(r.body.data.answer, /Leg day/); assert.deepEqual(s.w.calls, ["getTodaySchedule:A"]); assert.equal(s.profileReads(), 1);
  assert.ok(r.body.data.traceId && r.body.data.turnId); assert.equal(JSON.stringify(r.body).includes(USER_A), false, "no user id echoed");
  // the Express gateway path: secret + x-user-id + the user's bearer
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi tập."));
  const g = await ask("tok-b", { question: "Hôm nay tôi tập gì?" }, { "x-internal-token": SECRET, "x-user-id": USER_B });
  assert.equal(g.body.data.status, "ANSWERED"); assert.deepEqual(s.w.calls.slice(-1), ["getTodaySchedule:B"]);
  s.done();
});

test("HV-4 Nutrition-only: authoritative target read, no workout data", async () => {
  on(); const s = rig();
  s.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const r = await ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" });
  assert.equal(r.body.data.status, "ANSWERED"); assert.deepEqual(r.body.data.agents, ["nutrition"]); assert.match(r.body.data.answer, /2400 kcal/);
  assert.deepEqual(s.w.calls, ["getNutritionTargetPreview:A"]); s.done();
});

test("HV-5..8 two-agent slices: Training+Nutrition, Recovery+Training, Progress+Training, Progress+Recovery — one profile read each", async () => {
  on();
  const cases: Array<{ q: string; agents: AgentId[]; script: (s: ReturnType<typeof rig>) => void }> = [
    { q: "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", agents: ["nutrition", "training"], script: (s) => {
      s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
      s.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ dễ tiêu, có tinh bột và một ít đạm.")); } },
    { q: "Tôi tập chân hôm qua, hôm nay nên tập gì?", agents: ["recovery", "training"], script: (s) => {
      s.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu: hôm qua bạn ghi một buổi thân dưới với RPE 8."));
      s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay buổi Leg day: giảm tạ khoảng 10% vì chân vừa tập hôm qua.")); } },
    { q: "Sức mạnh deadlift của tôi có tăng không, chương trình nên chỉnh gì?", agents: ["progress", "training"], script: (s) => {
      s.prov.progress.script(use(call("progress.get_strength_progression")), say("Ước tính sức mạnh squat giảm khoảng 4% trong 4 tuần; bench tăng nhẹ."));
      s.prov.training.script(use(call("training.get_today_schedule")), say("Giữ chương trình hiện tại và ưu tiên kỹ thuật trong buổi Leg day.")); } },
    { q: "Dạo này tôi mệt, sức mạnh của tôi có giảm không?", agents: ["progress", "recovery"], script: (s) => {
      s.prov.progress.script(use(call("progress.get_strength_progression")), say("Ước tính sức mạnh squat giảm khoảng 4% trong 4 tuần."));
      s.prov.recovery.script(use(call("recovery.get_training_load")), say("Quan sát từ dữ liệu: RPE trung bình các tuần gần đây tăng từ 7 lên 8.5.")); } },
  ];
  for (const c of cases) {
    const s = rig(); c.script(s);
    const r = await ask("tok-a", { question: c.q });
    assert.equal(r.status, 200, c.q); assert.deepEqual([...r.body.data.agents].sort(), c.agents, c.q);
    assert.ok(["ANSWERED", "PARTIAL"].includes(r.body.data.status), `${c.q}: ${r.body.data.status}`);
    assert.equal(s.traces[0].delegations.length, 2, c.q);
    assert.ok(s.traces[0].delegations.every((d) => d.completionStatus === "COMPLETE"), `${c.q}: ${JSON.stringify(s.traces[0].delegations.map((d) => d.completionStatus))}`);
    assert.equal(s.profileReads(), 1, `${c.q}: one profile read shared by both agents`);
    assert.ok(s.w.calls.every((x) => x.endsWith(":A")), `${c.q}: ${s.w.calls}`);
    assert.ok(s.traces[0].totals.modelCallCount <= 8 && s.traces[0].budget.overrun.length === 0, "global budget held");
    s.done();
  }
});

// ── Gate 1 through HTTP ──────────────────────────────────────────────────────────────────────────────────────────────
test("HV-9..13 minor / age unknown / profile 403 / profile timeout — all decided before any agent, through the real profile client", async () => {
  on();
  const minor = rig({ profiles: { "tok-a": adultProfile(USER_A, 16) } });
  const m = await ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" });
  assert.equal(m.body.data.status, "MINOR_PROTECTED"); assert.equal(minor.modelRequests(), 0); assert.deepEqual(minor.w.calls, []);
  const gen = rig({ profiles: { "tok-a": adultProfile(USER_A, 16) } });
  gen.prov.nutrition.script(say("Bạn 25 tuổi nên cần 2400 kcal mỗi ngày. Protein giúp cơ phục hồi sau tập."));
  gen.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const g = await ask("tok-a", { question: "Protein có vai trò gì trong phục hồi cơ?" });
  assert.doesNotMatch(g.body.data.answer, /25 tuổi|2400/); assert.match(g.body.data.answer, /Protein giúp cơ phục hồi sau tập/);
  assert.match(g.body.data.answer, /Vì bạn dưới 18 tuổi/); assert.deepEqual(gen.w.calls, []);
  const unknown = rig({ profiles: { "tok-a": adultProfile(USER_A, null) } });
  const u = await ask("tok-a", { question: "Tôi muốn giảm 5 kg, tiến độ cân nặng của tôi thế nào?" });
  assert.equal(u.body.data.status, "PROFILE_UNVERIFIED"); assert.equal(unknown.traces[0].profileRead, "AGE_UNKNOWN"); assert.equal(unknown.modelRequests(), 0);
  for (const [reply, read] of [[{ status: 403, data: {} }, "PROFILE_ACCESS_DENIED"], [{ error: "timeout" }, "PROFILE_UNAVAILABLE"], [{ status: 503, data: {} }, "PROFILE_UNAVAILABLE"]] as const) {
    const f = rig({ profiles: { "tok-a": reply as Reply } });
    const r = await ask("tok-a", { question: "Hôm nay tôi tập gì?" });
    assert.equal(r.body.data.status, "PROFILE_UNVERIFIED", read); assert.equal(f.traces[0].profileRead, read);
    assert.equal(f.traces[0].delegations.length, 0); assert.equal(f.modelRequests(), 0); assert.deepEqual(f.w.calls, []);
  }
});

// ── sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HV-14 cross-user session isolation: the same sessionId from another user starts empty and never sees the first user's data", async () => {
  on(); const s = rig();
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  await ask("tok-a", { question: "Hôm nay tôi tập gì?", sessionId: "shared-sess-1" });
  assert.ok((s.traces[0].session?.stored ?? 0) > 0);
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi B-Push day."));
  const b = await ask("tok-b", { question: "Hôm nay tôi tập gì?", sessionId: "shared-sess-1" });
  assert.equal(s.traces[1].session?.loaded, 0, "B's scope (B, shared-sess-1) is empty");
  assert.doesNotMatch(b.body.data.answer, /Leg day/); assert.deepEqual(s.w.calls, ["getTodaySchedule:A", "getTodaySchedule:B"]);
  s.done();
});

test("HV-15/16 multi-turn follow-up: a forecast mentioned in turn 1 is never reported as a loss in turn 2 (FORECAST ≠ observation)", async () => {
  on(); const s = rig();
  s.prov.progress.script(use(call("progress.get_roadmap_forecast")), say("Dự báo của ứng dụng là kịch bản giảm về khoảng 70.4 kg sau 8 tuần."));
  await ask("tok-a", { question: "Ứng dụng dự báo tôi giảm 2 kg.", sessionId: "sess-mt-1" });
  s.advance(60_000); s.w.state.body = "absent";
  s.prov.progress.script(use(call("progress.get_body_measurements")), say("Bạn đã giảm được 2 kg. Hiện chưa có số đo cân nặng nào được ghi nên chưa thể tính mức đã giảm."));
  const r = await ask("tok-a", { question: "Vậy tôi đã giảm được bao nhiêu?", sessionId: "sess-mt-1" });
  assert.ok((s.traces[1].session?.loaded ?? 0) > 0, "turn 2 loaded turn 1's context");
  assert.doesNotMatch(r.body.data.answer, /đã giảm được 2 kg/); assert.match(r.body.data.answer, /^Lưu ý: con số trong dự báo là kịch bản/);
  s.done();
});

test("HV-17 Vietnamese calendar boundary (01:30 VN): a 19:00-VN session yesterday matches 'tập chân hôm qua' — no false conflict", async () => {
  on(); const s = rig({ now: T0 + 9.5 * H });
  (s.w.recovery as any).getRecentWorkoutHistory = async () => ({ status: "ok", source: "FITNESS_SERVICE", fetchedAt: 0,
    value: [{ id: "w", name: "x", date: "2026-11-13T12:00:00Z", duration: 50, exercises: [{ exercise: { bodyPart: "LOWER_BODY" }, workoutSets: [{ rpe: 8, completed: true }] }] }] });
  s.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu: hôm qua bạn có một buổi thân dưới được ghi lại."));
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  const r = await ask("tok-a", { question: "Tôi tập chân hôm qua, hôm nay nên tập gì?" });
  assert.deepEqual(s.traces[0].conflicts.filter((c) => c.startsWith("user_claim")), []);
  assert.doesNotMatch(r.body.data.answer, /không có buổi tập nào được ghi vào hôm qua/); s.done();
});

// ── capability / write / network ─────────────────────────────────────────────────────────────────────────────────────
test("HV-18/19 a tool outside the agent's allowlist and any WRITE are refused before any domain call", async () => {
  on(); const s = rig();
  s.prov.nutrition.script(use(call("training.get_today_schedule"), call("training.skip_workout"), call("nutrition.get_target")), say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const r = await ask("tok-a", { question: "Mục tiêu calo của tôi là bao nhiêu?" });
  assert.equal(r.body.data.status, "ANSWERED");
  const outcomes = s.agentTraces[0].tools.map((x) => x.outcome);
  assert.equal(outcomes.filter((o) => o === "TOOL_NOT_OFFERED").length, 2, JSON.stringify(s.agentTraces[0].tools));
  assert.deepEqual(s.w.calls, ["getNutritionTargetPreview:A"], "neither the foreign READ nor the WRITE reached a domain function");
  s.done();
});

test("HV-21 /ai/ask (V1) unchanged: still reaches the V1 controller, with the V2 flag ON; V2 runtime untouched", async () => {
  on(); rig(); const before = factoryCalls; const v1 = v1AskReached;
  const r = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" });
  assert.equal(r.status, 200); assert.equal(r.body.data.v1, true); assert.equal(v1AskReached, v1 + 1); assert.equal(factoryCalls, before);
  delete process.env.AI_AGENT_V2;
  const r2 = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" });
  assert.equal(r2.status, 200); assert.equal(v1AskReached, v1 + 2);
});

test("HV-22 default V1 READ clients wired (no injected deps): schedule via the V1 domain client; a 403 is ACCESS_DENIED, not an outage", async () => {
  on();
  const s = rig({ v1Deps: true });
  net.fitness = { "/workouts/schedules": { status: 200, data: [{ id: "s-1", userId: USER_A, scheduledDate: "2026-11-13", status: "SCHEDULED", title: "Leg day", exercises: [{}, {}] }] } };
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  const r = await ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(r.body.data.status, "ANSWERED", r.body.data.answer);
  const sched = net.calls.find((c) => c.url.includes("/workouts/schedules"))!;
  assert.ok(sched && sched.auth === "Bearer tok-a", "the user's own bearer is forwarded");
  const d = rig({ v1Deps: true });
  net.fitness = { "/workouts/schedules": { status: 403, data: { error: "Forbidden" } } };
  d.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day."));
  await ask("tok-a", { question: "Hôm nay tôi tập gì?" });
  assert.equal(d.traces[0].delegations[0].evidence[0].outcome, "DOMAIN_ACCESS_DENIED");
  net.fitness = {};
});

test("HV-20 no real network / provider / model call in the whole file; no WRITE anywhere", () => {
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.deepEqual(allWriteCalls, []);
  assert.ok(net.calls.every((c) => /\.invalid\//.test(c.url)), "every transport call went to a mocked .invalid host");
});

test("HV-23 enterprise-data reader failures: a refused read (401/403 in the client message) is DOMAIN_ACCESS_DENIED; others stay SYSTEM_ERROR", async () => {
  const { createRecoveryToolRegistry, RECOVERY_AGENT_PILOT_POLICY } = await import("../agent-v2/recovery-tools");
  const { readErrorStatus } = await import("../agent-v2/tool-contract");
  for (const [msg, code] of [["Request failed with status code 403", "DOMAIN_ACCESS_DENIED"], ["Request failed with status code 401", "DOMAIN_ACCESS_DENIED"],
    ["Request failed with status code 500", "SYSTEM_ERROR"], ["timeout of 3500ms exceeded", "SYSTEM_ERROR"], ["Request failed with status code 404", "SYSTEM_ERROR"]] as const) {
    const reg = createRecoveryToolRegistry({ enabled: true, deps: { getTrainingAnalytics: async () => ({ status: "error", source: "FITNESS_SERVICE", fetchedAt: 0, message: msg }) as any,
      getRecentWorkoutHistory: async () => ({ status: "error", source: "FITNESS_SERVICE", fetchedAt: 0, message: msg }) as any }, traceSink: () => {} });
    const r = await reg.execute(RECOVERY_AGENT_PILOT_POLICY, "recovery.get_recent_sessions", {}, { userId: USER_A, authorizationHeader: "Bearer tok-a" });
    assert.equal(!r.ok && r.error.code, code, msg);
  }
  assert.equal(readErrorStatus(null), 503); assert.equal(readErrorStatus({ message: 12 }), 503);
});
