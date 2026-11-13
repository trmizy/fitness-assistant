/**
 * V2 Multi-Agent M7-P0 — the real Gate 1 profile reader (4 states) wired into the supervisor.
 *
 * Boundary: the REAL V1 service client (clients/service-lambda.client.ts → axios.get) runs unchanged; only axios's transport
 * adapter is replaced, and it reproduces axios's own settle() (validateStatus → AxiosError with `response`), timeout
 * (ECONNABORTED) and network (ECONNREFUSED) errors. The Lambda transport's error is produced by the REAL
 * throwForLambdaHttpError. OFFLINE: USER_SERVICE_URL points at an .invalid host, USER_LAMBDA_NAME is unset, fetch and the
 * Bedrock client are blocked and counted; mock models; no DB / Redis / AWS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { requestService } from "../clients/service-lambda.client";
import { throwForLambdaHttpError } from "../clients/lambda-http.client";
import { bedrockRuntimeDeps } from "../services/bedrock.client";
import {
  ageFromDateOfBirth, classifyProfileReadError, createProfileReader, interpretProfileResponse, PROFILE_READ_TIMEOUT_MS,
  type ProfileServiceGet,
} from "../agent-v2/profile-reader";
import { runSupervisorTurn, createBoundedAgentRunner, trainingFacts, recoveryFacts, progressFacts, nutritionFacts, type SupervisorTrace } from "../agent-v2/supervisor";
import { runTrainingAgentTurn } from "../agent-v2/training-agent";
import { createTrainingToolRegistry } from "../agent-v2/training-tools";
import { runNutritionAgentTurn } from "../agent-v2/nutrition-agent";
import { createNutritionToolRegistry } from "../agent-v2/nutrition-tools";
import { runRecoveryAgentTurn } from "../agent-v2/recovery-agent";
import { createRecoveryToolRegistry } from "../agent-v2/recovery-tools";
import { runProgressAgentTurn } from "../agent-v2/progress-agent";
import { createProgressToolRegistry } from "../agent-v2/progress-tools";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { TurnTrace } from "../agent-v2/turn-trace";
import { CAP, call, mockProvider, say, T0, use, USER_A, USER_B, world, type MockProvider } from "./m5-benchmark/harness";

const TOKEN_A = "Bearer tok-A-m7p0";
/** Profile values that must never reach a trace. */
const PRIVATE = { dobAdult: "1979-03-14", name: "PRIVATE_NAME_ZZ", phone: "0900000777" } as const;

// ── HTTP boundary (axios transport only) ─────────────────────────────────────────────────────────────────────────────
type Reply = { status: number; data?: unknown } | { error: "timeout" | "network" } | { hang: true };
const net = { calls: [] as Array<{ method?: string; url?: string; auth?: string; timeout?: number; params?: unknown }>, next: { status: 200, data: { profile: null } } as Reply };
const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  net.calls.push({ method: config.method, url: config.url, auth: String(h?.get?.("Authorization") ?? h?.Authorization ?? ""), timeout: config.timeout, params: config.params });
  const r = net.next;
  if ("hang" in r) return new Promise<AxiosResponse>(() => {});
  if ("error" in r) {
    if (r.error === "timeout") throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, AxiosError.ECONNABORTED, config, {});
    throw new AxiosError("connect ECONNREFUSED 10.0.0.1:3004", "ECONNREFUSED", config, {});
  }
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  // axios settle(): validateStatus decides; 4xx → ERR_BAD_REQUEST, 5xx → ERR_BAD_RESPONSE, the response is attached
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, r.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
/** The real V1 client, unchanged — the composition root's injection. */
const realGet: ProfileServiceGet = (req) => requestService(req);

let blockedCalls = 0;
const saved = { adapter: axios.defaults.adapter, fetch: globalThis.fetch, send: bedrockRuntimeDeps.send, lambda: process.env.USER_LAMBDA_NAME, url: process.env.USER_SERVICE_URL };
test.before(() => {
  axios.defaults.adapter = adapter;
  delete process.env.USER_LAMBDA_NAME;
  process.env.USER_SERVICE_URL = "http://user-service.m7p0.invalid";
  globalThis.fetch = (async () => { blockedCalls++; throw new Error("network blocked (M7-P0)"); }) as typeof fetch;
  bedrockRuntimeDeps.send = (async () => { blockedCalls++; throw new Error("paid provider blocked (M7-P0)"); }) as any;
});
test.after(() => {
  axios.defaults.adapter = saved.adapter; globalThis.fetch = saved.fetch; bedrockRuntimeDeps.send = saved.send;
  if (saved.lambda === undefined) delete process.env.USER_LAMBDA_NAME; else process.env.USER_LAMBDA_NAME = saved.lambda;
  if (saved.url === undefined) delete process.env.USER_SERVICE_URL; else process.env.USER_SERVICE_URL = saved.url;
});

const profile = (p: Record<string, unknown> | null, userId = USER_A) =>
  ({ status: 200, data: { profile: p === null ? null : { id: "prof-1", userId, gender: "MALE", fullName: PRIVATE.name, phone: PRIVATE.phone, ...p } } });

// ── the real supervisor + four bounded agents, profile read through the reader above ─────────────────────────────────
function sys(reply: Reply, o: { enabled?: boolean; timeoutMs?: number } = {}) {
  const clock = () => T0;
  const w = world(clock);
  const prov: Record<AgentId, MockProvider> = { training: mockProvider("training"), nutrition: mockProvider("nutrition"), recovery: mockProvider("recovery"), progress: mockProvider("progress") };
  const enabled = o.enabled ?? true;
  const runners = [
    createBoundedAgentRunner(CAP.training, runTrainingAgentTurn, { provider: prov.training, registry: createTrainingToolRegistry({ enabled, deps: w.training, traceSink: () => {} }), facts: trainingFacts }),
    createBoundedAgentRunner(CAP.nutrition, runNutritionAgentTurn, { provider: prov.nutrition, registry: createNutritionToolRegistry({ enabled, deps: w.nutrition, traceSink: () => {} }), facts: nutritionFacts }),
    createBoundedAgentRunner(CAP.recovery, runRecoveryAgentTurn, { provider: prov.recovery, registry: createRecoveryToolRegistry({ enabled, deps: w.recovery, traceSink: () => {} }), facts: (i, d) => recoveryFacts(i, d, clock()) }),
    createBoundedAgentRunner(CAP.progress, runProgressAgentTurn, { provider: prov.progress, registry: createProgressToolRegistry({ enabled, deps: w.progress, traceSink: () => {} }), facts: progressFacts }),
  ];
  net.calls.length = 0; net.next = reply;
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  const profileReader = createProfileReader({ get: realGet, now: clock, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
  const ask = (question: string, extra: { history?: Array<{ role: "user" | "assistant"; text: string }>; context?: unknown } = {}) => runSupervisorTurn(
    { question, context: extra.context ?? { userId: USER_A, authorizationHeader: TOKEN_A }, history: extra.history },
    { runners, profileReader, enabled, now: clock, traceSink: (t) => traces.push(t), agentTraceSink: (t) => agentTraces.push(t) });
  const modelRequests = () => Object.values(prov).reduce((n, p) => n + p.requests.length, 0);
  return { ask, prov, w, traces, agentTraces, modelRequests };
}

const PERSONAL_Q = "Mục tiêu calo của tôi là bao nhiêu?";
const HIGH_RISK_Q = "Tôi muốn giảm 5 kg, tiến độ cân nặng của tôi thế nào?";
const GENERAL_Q = "Protein có vai trò gì trong phục hồi cơ?";
const SUPERVISION = /Vì bạn dưới 18 tuổi/;

// ── 1. pure mapping (unit) ──────────────────────────────────────────────────────────────────────────────────────────
test("PR-1 four-state mapping: response shapes, invalid ages, identity mismatch, date of birth (pure)", () => {
  const ok = (data: unknown, status = 200) => interpretProfileResponse({ status, data }, USER_A, T0);
  assert.deepEqual(ok({ profile: { userId: USER_A, age: 30 } }), { status: "PROFILE_OK", age: 30 });
  assert.deepEqual(ok({ profile: null }), { status: "AGE_UNKNOWN" }, "no saved profile is a successful read, not an error");
  for (const age of [undefined, null, 0, -3, 121, 17.5, "16", NaN]) assert.deepEqual(ok({ profile: { userId: USER_A, age } }), { status: "AGE_UNKNOWN" }, String(age));
  for (const bad of [null, "<html>502</html>", [], {}, { data: { age: 30 } }, { profile: "x" }, { profile: [] }]) assert.deepEqual(ok(bad), { status: "PROFILE_UNAVAILABLE" }, JSON.stringify(bad));
  assert.deepEqual(ok({ profile: { userId: USER_B, age: 30 } }), { status: "PROFILE_ACCESS_DENIED" }, "another user's profile is refused");
  assert.deepEqual(ok({ profile: { age: 30 } }, 204), { status: "PROFILE_OK", age: 30 });
  assert.deepEqual(ok({ profile: { age: 30 } }, 403), { status: "PROFILE_ACCESS_DENIED" }, "a non-throwing transport's 403");
  assert.deepEqual(ok({ profile: { age: 30 } }, 503), { status: "PROFILE_UNAVAILABLE" });
  assert.deepEqual(interpretProfileResponse(undefined, USER_A, T0), { status: "PROFILE_UNAVAILABLE" });
  // date of birth (UTC calendar, T0 = 2026-11-13): birthday tomorrow → still the lower age
  assert.equal(ageFromDateOfBirth("2008-11-14T00:00:00.000Z", T0), 17); assert.equal(ageFromDateOfBirth("2008-11-13", T0), 18);
  for (const d of ["2030-01-01", "not-a-date", 19990101, "", null]) assert.equal(ageFromDateOfBirth(d, T0), null, String(d));
  assert.deepEqual(ok({ profile: { userId: USER_A, age: null, dateOfBirth: "1996-05-01T00:00:00.000Z" } }), { status: "PROFILE_OK", age: 30 });
});

test("PR-2 error mapping: 401/403 → ACCESS_DENIED; every other failure → UNAVAILABLE (never an empty profile)", () => {
  const axiosErr = (status: number) => new AxiosError("x", status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, undefined, {}, { status, data: {}, statusText: "", headers: {}, config: {} as InternalAxiosRequestConfig });
  const lambdaErr = (statusCode: number) => { try { throwForLambdaHttpError({ statusCode, body: { error: { message: "x" } } }); } catch (e) { return e; } throw new Error("did not throw"); };
  for (const make of [axiosErr, lambdaErr]) {
    for (const s of [401, 403]) assert.deepEqual(classifyProfileReadError(make(s)), { status: "PROFILE_ACCESS_DENIED" }, `${make.name} ${s}`);
    for (const s of [400, 404, 409, 429, 500, 502, 503, 504]) assert.deepEqual(classifyProfileReadError(make(s)), { status: "PROFILE_UNAVAILABLE" }, `${make.name} ${s}`);
  }
  for (const e of [new AxiosError("timeout", AxiosError.ECONNABORTED), new AxiosError("t", AxiosError.ETIMEDOUT), new AxiosError("n", AxiosError.ERR_NETWORK), new Error("boom"), null, undefined, "str"]) {
    assert.deepEqual(classifyProfileReadError(e), { status: "PROFILE_UNAVAILABLE" }, String(e));
  }
});

// ── 2. reader through the real V1 client + axios pipeline ───────────────────────────────────────────────────────────
test("PR-3 real client boundary: one GET /profile/me with the caller's own token, no user id in the request; 9 outcomes", async () => {
  const read = createProfileReader({ get: realGet, now: () => T0 });
  const cases: Array<[string, Reply, unknown]> = [
    ["adult", profile({ age: 30, dateOfBirth: "1996-05-01T00:00:00.000Z" }), { status: "PROFILE_OK", age: 30 }],
    ["minor", profile({ age: 16 }), { status: "PROFILE_OK", age: 16 }],
    ["no age", profile({ age: null }), { status: "AGE_UNKNOWN" }],
    ["no profile", profile(null), { status: "AGE_UNKNOWN" }],
    ["401", { status: 401, data: { error: "Unauthorized" } }, { status: "PROFILE_ACCESS_DENIED" }],
    ["403", { status: 403, data: { error: "Forbidden" } }, { status: "PROFILE_ACCESS_DENIED" }],
    ["500", { status: 500, data: { error: "Internal server error" } }, { status: "PROFILE_UNAVAILABLE" }],
    ["timeout", { error: "timeout" }, { status: "PROFILE_UNAVAILABLE" }],
    ["network", { error: "network" }, { status: "PROFILE_UNAVAILABLE" }],
  ];
  for (const [name, reply, expected] of cases) {
    net.calls.length = 0; net.next = reply;
    assert.deepEqual(await read({ userId: USER_A, authorizationHeader: TOKEN_A }), expected, name);
    assert.equal(net.calls.length, 1, name);
    const c = net.calls[0];
    assert.equal(c.method, "get"); assert.equal(c.url, "http://user-service.m7p0.invalid/profile/me", name);
    assert.equal(c.auth, TOKEN_A); assert.equal(c.timeout, PROFILE_READ_TIMEOUT_MS);
    assert.ok(!JSON.stringify(c).includes(USER_A), "the user id never travels in the request (the service resolves it from the token)");
  }
  assert.equal(blockedCalls, 0);
});

test("PR-4 conflicting ages + identity: lower of stored age / date of birth; another user's profile, missing token → DENIED", async () => {
  const read = createProfileReader({ get: realGet, now: () => T0 });
  net.next = profile({ age: 18, dateOfBirth: "2009-06-01T00:00:00.000Z" }); // stored 18, DOB → 17
  assert.deepEqual(await read({ userId: USER_A, authorizationHeader: TOKEN_A }), { status: "PROFILE_OK", age: 17 });
  net.next = profile({ age: 16, dateOfBirth: "1990-01-01T00:00:00.000Z" }); // stored 16 wins over DOB 36 (stricter)
  assert.deepEqual(await read({ userId: USER_A, authorizationHeader: TOKEN_A }), { status: "PROFILE_OK", age: 16 });
  net.next = profile({ age: 30 }, USER_B);
  assert.deepEqual(await read({ userId: USER_A, authorizationHeader: TOKEN_A }), { status: "PROFILE_ACCESS_DENIED" });
  net.calls.length = 0;
  for (const ctx of [{ userId: USER_A }, { userId: USER_A, authorizationHeader: "  " }, { userId: "" , authorizationHeader: TOKEN_A }, null]) {
    assert.deepEqual(await read(ctx as any), { status: "PROFILE_ACCESS_DENIED" }, JSON.stringify(ctx));
  }
  assert.equal(net.calls.length, 0, "no credentials → no request at all");
});

test("PR-5 timeout is enforced by the reader itself (a hanging transport, e.g. Lambda Invoke) and a throwing client never escapes", async () => {
  net.calls.length = 0; net.next = { hang: true };
  const t0 = Date.now();
  assert.deepEqual(await createProfileReader({ get: realGet, timeoutMs: 40 })({ userId: USER_A, authorizationHeader: TOKEN_A }), { status: "PROFILE_UNAVAILABLE" });
  assert.ok(Date.now() - t0 < 2_000);
  assert.equal(net.calls[0].timeout, 40);
  const throwsSync: ProfileServiceGet = () => { throw new Error("sync"); };
  assert.deepEqual(await createProfileReader({ get: throwsSync })({ userId: USER_A, authorizationHeader: TOKEN_A }), { status: "PROFILE_UNAVAILABLE" });
  // the budget can be lowered, never raised above V1's 3 s
  net.next = profile({ age: 30 });
  await createProfileReader({ get: realGet, timeoutMs: 60_000 })({ userId: USER_A, authorizationHeader: TOKEN_A });
  assert.equal(net.calls.at(-1)!.timeout, PROFILE_READ_TIMEOUT_MS);
});

// ── 3. wired into the supervisor (Gate 1 before any delegation) ─────────────────────────────────────────────────────
test("PR-6 adult profile: Gate 1 PROCEED, personal read allowed, exactly one profile read for the turn", async () => {
  const s = sys(profile({ age: 30 }));
  s.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const r = await s.ask(PERSONAL_Q);
  assert.equal(r.status, "ANSWERED", r.answer);
  assert.equal(s.traces[0].profileRead, "PROFILE_OK"); assert.equal(s.traces[0].ageGate?.status, "ADULT"); assert.equal(s.traces[0].ageGate?.decision, "PROCEED");
  assert.deepEqual(s.w.calls, ["getNutritionTargetPreview:A"]); assert.equal(net.calls.length, 1);
});

test("PR-7 minor profile: MINOR_PROTECTED before any model / tool; a self-stated adult age does not lift it", async () => {
  for (const [q, history] of [[PERSONAL_Q, undefined], ["Tôi 25 tuổi rồi, mục tiêu calo của tôi là bao nhiêu?", undefined], [PERSONAL_Q, [{ role: "user" as const, text: "Mình 22 tuổi nhé." }]]] as const) {
    const s = sys(profile({ age: 16 }));
    const r = await s.ask(q, { history: history as any });
    assert.equal(r.status, "MINOR_PROTECTED", q);
    assert.equal(s.modelRequests(), 0); assert.deepEqual(s.w.calls, []); assert.equal(s.traces[0].delegations.length, 0);
    assert.deepEqual(s.traces[0].ageGate?.minorBy, ["PROFILE"]); assert.equal(s.traces[0].ageGate?.status, "MINOR");
  }
  // profile adult, the user stated a minor age earlier → minor wins (conflict recorded). (A minor age stated in the CURRENT
  // turn is already stopped by V1 input safety before routing — SAFETY_BLOCKED, the M6 S02 behaviour — so no read happens.)
  const c = sys(profile({ age: 30 }));
  const cr = await c.ask(PERSONAL_Q, { history: [{ role: "user", text: "Em 15 tuổi ạ." }] });
  assert.equal(cr.status, "MINOR_PROTECTED"); assert.equal(c.traces[0].ageGate?.conflict, true); assert.deepEqual(c.traces[0].ageGate?.minorBy, ["HISTORY"]);
  assert.deepEqual(c.w.calls, []); assert.equal(c.modelRequests(), 0);
  const now = sys(profile({ age: 30 }));
  assert.equal((await now.ask("Em 15 tuổi, mục tiêu calo của em là bao nhiêu?")).status, "SAFETY_BLOCKED"); assert.equal(net.calls.length, 0);
  // the date of birth alone can make the user a minor (stored age missing)
  const d = sys(profile({ age: null, dateOfBirth: "2010-02-01T00:00:00.000Z" }));
  assert.equal((await d.ask(PERSONAL_Q)).status, "MINOR_PROTECTED");
});

test("PR-8 missing age: AGE_UNKNOWN is never adult — high-risk personal fails closed; the same question proceeds for an adult", async () => {
  for (const reply of [profile({ age: null }), profile(null)]) {
    const s = sys(reply);
    const r = await s.ask(HIGH_RISK_Q);
    assert.equal(r.status, "PROFILE_UNVERIFIED"); assert.equal(s.traces[0].profileRead, "AGE_UNKNOWN");
    assert.equal(s.traces[0].ageGate?.status, "UNKNOWN"); assert.equal(s.traces[0].ageGate?.decision, "BLOCK_AGE_UNKNOWN");
    assert.equal(s.modelRequests(), 0); assert.deepEqual(s.w.calls, []);
    const self = sys(reply);
    assert.equal((await self.ask(`Tôi 25 tuổi, ${HIGH_RISK_Q.toLowerCase()}`)).status, "PROFILE_UNVERIFIED", "a self-stated adult age does not unlock it");
  }
  const adult = sys(profile({ age: 30 }));
  adult.prov.progress.script(say("Cân nặng của bạn đang giảm dần theo các lần đo."));
  await adult.ask(HIGH_RISK_Q);
  assert.equal(adult.traces[0].ageGate?.decision, "PROCEED"); assert.notEqual(adult.traces[0].status, "PROFILE_UNVERIFIED");
});

test("PR-9 401 / 403 / 500 / timeout / network: fail closed BEFORE delegation — no model call, no personal tool, no agent", async () => {
  const cases: Array<[Reply, string]> = [
    [{ status: 401, data: {} }, "PROFILE_ACCESS_DENIED"], [{ status: 403, data: {} }, "PROFILE_ACCESS_DENIED"],
    [{ status: 500, data: {} }, "PROFILE_UNAVAILABLE"], [{ status: 503, data: {} }, "PROFILE_UNAVAILABLE"],
    [{ error: "timeout" }, "PROFILE_UNAVAILABLE"], [{ error: "network" }, "PROFILE_UNAVAILABLE"], [{ hang: true }, "PROFILE_UNAVAILABLE"],
  ];
  for (const [reply, status] of cases) {
    for (const q of [PERSONAL_Q, "Hôm nay tôi tập gì?", HIGH_RISK_Q]) {
      const s = sys(reply, { timeoutMs: 40 });
      const r = await s.ask(q);
      const label = `${JSON.stringify(reply)} ${q}`;
      assert.equal(r.status, "PROFILE_UNVERIFIED", label); assert.equal(s.traces[0].profileRead, status, label);
      assert.equal(s.traces[0].ageGate?.status, "UNVERIFIED", label);
      assert.equal(s.modelRequests(), 0, label); assert.deepEqual(s.w.calls, [], label); assert.equal(s.traces[0].delegations.length, 0, label);
      assert.equal(net.calls.length, 1, label);
    }
  }
  // a general question may still be answered — non-personal tools only, nothing about the user is read
  const g = sys({ status: 403, data: {} });
  g.prov.nutrition.script(say("Protein giúp cơ phục hồi sau tập."));
  g.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const gr = await g.ask(GENERAL_Q);
  assert.equal(g.traces[0].ageGate?.decision, "GENERAL_ONLY"); assert.deepEqual(g.w.calls, []);
  assert.deepEqual(g.prov.nutrition.requests[0].tools.map((t) => t.name), ["nutrition__search_food"]);
  assert.ok(g.traces[0].delegations.every((d) => d.evidence.every((e) => !e.personal)), "no personal evidence on a general-only turn");
  assert.ok(["ANSWERED", "PARTIAL"].includes(gr.status), gr.status);
});

test("PR-10 the model cannot change the age or the identity: a minor general turn stays MINOR; tool input userId/age ignored", async () => {
  const s = sys(profile({ age: 16 }));
  s.prov.nutrition.script(
    use(call("nutrition.get_target", { userId: USER_B, age: 25 })),
    say("Protein giúp cơ phục hồi sau tập."),
  );
  s.prov.recovery.script(use(call("recovery.get_recent_workout_history", { userId: USER_B, age: 25 })), say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const r = await s.ask(GENERAL_Q);
  assert.equal(s.traces[0].ageGate?.status, "MINOR"); assert.equal(s.traces[0].ageGate?.decision, "GENERAL_ONLY");
  assert.deepEqual(s.w.calls, [], "the personal tools were not even offered; nothing was read, for A or B");
  assert.equal(net.calls.length, 1, "the model cannot trigger another profile read");
  assert.match(r.answer, SUPERVISION, "the minor supervision line stays on the answer");
  for (const p of [s.prov.nutrition, s.prov.recovery]) for (const req of p.requests) {
    assert.ok(req.tools.every((t) => !/get_target|get_recent_workout_history|get_active_state|get_training_analytics/.test(t.name)), "personal tools are never offered on a minor general turn");
  }
  // the age the model claims never reaches the gate of a later turn either (no state carried between turns by the reader)
  const s2 = sys(profile({ age: 16 }));
  assert.equal((await s2.ask(PERSONAL_Q, { history: [{ role: "assistant", text: "Bạn 25 tuổi." }] })).status, "MINOR_PROTECTED", "assistant text is never an age source");
});

// MG-1 (found by M7-P0, fixed in M7-P0.1): model TEXT claiming an adult age / a personal target on a minor GENERAL_ONLY turn
// is removed by the general-only output policy (agent-v2-minor-output.test.ts covers the rules).
test("PR-10b MG-1 regression: model text claiming an adult age / a personal figure on a minor general-only turn is removed", async () => {
  const s = sys(profile({ age: 16 }));
  s.prov.nutrition.script(say("Bạn 25 tuổi nên có thể theo mục tiêu 2400 kcal. Protein giúp cơ phục hồi sau tập."));
  s.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const r = await s.ask(GENERAL_Q);
  assert.doesNotMatch(r.answer, /25 tuổi|2400/);
  assert.match(r.answer, /Protein giúp cơ phục hồi sau tập/); assert.match(r.answer, SUPERVISION);
  assert.deepEqual(s.w.calls, []); assert.equal(net.calls.length, 1);
});

test("PR-11 trace privacy: traces carry the read STATUS only — no age, date of birth, profile fields or token", async () => {
  const runs: Array<ReturnType<typeof sys>> = [];
  const a = sys(profile({ age: 47, dateOfBirth: `${PRIVATE.dobAdult}T00:00:00.000Z` }));
  a.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  await a.ask("Hôm nay tôi tập gì?"); runs.push(a);
  const m = sys(profile({ age: 16, dateOfBirth: "2010-02-01T00:00:00.000Z" })); await m.ask(PERSONAL_Q); runs.push(m);
  const d = sys({ status: 403, data: { error: "Forbidden", detail: PRIVATE.name } }); await d.ask(PERSONAL_Q); runs.push(d);
  for (const s of runs) {
    const json = JSON.stringify({ t: s.traces, a: s.agentTraces });
    for (const bad of [PRIVATE.dobAdult, "2010-02-01", PRIVATE.name, PRIVATE.phone, "MALE", TOKEN_A, "tok-A", "Bearer", '"age"', ":47", ":16,"]) {
      assert.ok(!json.includes(bad), `trace contains ${bad}`);
    }
    assert.ok(["PROFILE_OK", "PROFILE_ACCESS_DENIED"].includes(s.traces[0].profileRead));
  }
});

test("PR-12 four-agent routing unchanged with the real reader: two agents, ONE profile read shared by every delegation", async () => {
  const s = sys(profile({ age: 30 }));
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  s.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ dễ tiêu, có tinh bột và một ít đạm."));
  const r = await s.ask("Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?");
  assert.deepEqual([...r.decision!.agents].sort(), ["nutrition", "training"]);
  assert.equal(s.traces[0].delegations.length, 2);
  assert.equal(net.calls.length, 1, "agents reuse the supervisor's single read (no re-read per agent)");
  assert.equal(s.traces[0].profileRead, "PROFILE_OK");
  // out-of-scope / unsafe turns stop before the read (no personal request → no read at all)
  const o = sys(profile({ age: 30 }));
  assert.equal((await o.ask("Có nên mua thảm tập yoga loại dày không?")).status, "OUT_OF_SCOPE"); assert.equal(net.calls.length, 0);
});

test("PR-13 flag OFF: DISABLED, the profile is never read; unauthenticated: never read", async () => {
  const off = sys(profile({ age: 30 }), { enabled: false });
  assert.equal((await off.ask(PERSONAL_Q)).status, "DISABLED"); assert.equal(net.calls.length, 0); assert.equal(off.modelRequests(), 0);
  const anon = sys(profile({ age: 30 }));
  assert.equal((await anon.ask(PERSONAL_Q, { context: { authorizationHeader: TOKEN_A } })).status, "UNAUTHENTICATED"); assert.equal(net.calls.length, 0);
  // an authenticated user id without a token: the reader refuses without a request → fail closed
  const noTok = sys(profile({ age: 30 }));
  const nr = await noTok.ask(PERSONAL_Q, { context: { userId: USER_A } });
  assert.equal(nr.status, "PROFILE_UNVERIFIED"); assert.equal(noTok.traces[0].profileRead, "PROFILE_ACCESS_DENIED"); assert.equal(net.calls.length, 0);
  assert.equal(blockedCalls, 0, "no fetch / provider call in the whole file");
});
