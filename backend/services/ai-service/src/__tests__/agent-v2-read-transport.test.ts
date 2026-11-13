/**
 * V2 Multi-Agent M7-P2 — cross-service READ transport. Offline.
 *   Unit: agent-v2-integration/domain-read-transport.ts over the REAL V1 service client (requestService) — HTTP via the
 *         real axios pipeline (adapter-level mock), Lambda via the real invokeHttpLambda with the AWS SDK's
 *         LambdaClient.prototype.send stubbed (the command input is captured and the event is replayed through
 *         fitness-service's OWN serverless-http 4.0.0 to prove the receiver library parses it).
 *   HTTP: POST /ai/v2/ask through the real app with the DEFAULT domain deps (no injected readers): Recovery+Training over
 *         HTTP, Progress+Training over Lambda Invoke, Nutrition-only, flag OFF, /ai/ask unchanged.
 * MOCKED SDK / TRANSPORT ONLY — NOT VERIFIED BY REAL INFRASTRUCTURE (no AWS, no network, no Lambda, no IAM), NOT VERIFIED
 * BY LIVE MODEL (scripted mock models).
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { createRequire } from "node:module";
import path from "node:path";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.USER_SERVICE_URL = "http://user-service.m7p2.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.m7p2.invalid";
process.env.AWS_REGION = "ap-southeast-1";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2"]) delete process.env[k];

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const BEARER = "Bearer tok-a";

// ── synthetic fitness / user responses (the real contract shapes) ────────────────────────────────────────────────────
const WINDOW = {
  period: { from: "", to: "", days: 28 }, adherence: { state: "MEASURED", scheduledSessions: 12, completedSessions: 10, missedSessions: 2, completionRate: 0.83, dataQuality: "SUFFICIENT" },
  frequency: { completedPerWeek: 2.5, scheduledPerWeek: 3, trainingDaysLogged: 10, weeklyVolumeConsistency: 0.8, dataQuality: "SUFFICIENT" },
  volume: { totalVolumeLoadKg: 1, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: -8, completedSetCount: 1, loadedSetCount: 1, dataQuality: "SUFFICIENT" },
  progression: { exercises: [{ exerciseId: "e-sq", exerciseName: "Barbell Squat", baselineE1rmKg: 100, currentE1rmKg: 96, changePct: -4, weeksObserved: 4, dataQuality: "SUFFICIENT" }], dataQuality: "SUFFICIENT" },
  plateau: { status: "NOT_AVAILABLE", reason: "x" },
  effort: { rpe: { observedSets: 1, totalCompletedSets: 1, weeklyAvg: [7, 8.5], trend: "increasing", dataQuality: "SUFFICIENT" }, rir: { observedSets: 1, totalCompletedSets: 1, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    sessionFeedback: { feedbackCount: 3, averageSessionRpe: 8.4, sessionRpeSource: "session_feedback", averagePainScore: 0.5, recoveryScore: 0.7, dataQuality: "PARTIAL" } },
  signals: [], dataQuality: "SUFFICIENT",
};
const BODY = {
  asOf: "2026-11-13T00:00:00Z", lookbackDays: 90,
  body: { dataQuality: "SUFFICIENT", observations: { totalOnRecord: 5, inLookback: 4, comparableInLookback: 4, firstAt: "2026-09-15", latestAt: "2026-11-10" },
    latest: { measuredAt: "2026-11-10T07:00:00Z", weightKg: 72.4, bodyFatPct: 18.5, muscleMassKg: 33.1, source: "EXTRACTED", excludedFromTrend: false }, previous: null, latestAgeDays: 3,
    trends: { weight: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.4, dataPoints: 4 }, bodyFat: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.3, dataPoints: 4 }, muscleMass: { status: "AVAILABLE", direction: "UP", changePerWeek: 0.1, dataPoints: 4 } },
    quality: { outlierCount: 0, intervalWarningCount: 0, mixedSources: false, confidenceMultiplier: 1, flags: [] }, muscleMassSemantics: "UNRESOLVED", muscleMassProvenance: { extracted: 4, manual: 0, unknown: 0 }, profileReportedWeight: null },
  goal: { type: "WEIGHT_LOSS", currentTarget: { state: "AVAILABLE", weightKg: 68, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" }, startingState: { state: "NOT_AVAILABLE", reason: "NO_ACTIVE_CYCLE" }, profileStartingWeightKg: 75,
    gap: { state: "AVAILABLE", currentKg: 72.4, targetKg: 68, differenceKg: -4.4, absoluteKg: 4.4, currentSource: "MEASURED_INBODY", currentAsOf: "2026-11-10", alternateCurrent: null },
    trajectory: { observed: { state: "NOT_AVAILABLE" }, onTrack: { status: "NOT_EVALUABLE", reasons: [], classification: "DEFERRED" } }, roadmap: { state: "NONE" }, dataQuality: "SUFFICIENT" },
};
const workouts = (userId: string) => [{ id: "w-1", userId, name: "x", date: new Date(T0 - 86_400_000).toISOString(), duration: 50, exercises: [{ exercise: { bodyPart: "LOWER_BODY" }, workoutSets: [{ rpe: 8, completed: true }] }] }];
const schedules = (userId: string) => [{ id: "s-1", userId, scheduledDate: "2026-11-13", status: "SCHEDULED", title: "Leg day", exercises: [{}, {}] }];

type Reply = { status: number; data?: unknown } | { error: "timeout" | "network" } | { hang: true };
/** Route table shared by both transports: (path, bearer) → reply. Default: the user's own synthetic data. */
const routes = { override: {} as Record<string, Reply> };
function answer(path: string, auth: string): Reply {
  const user = TOKENS[auth.replace(/^Bearer /, "")];
  if (routes.override[path]) return routes.override[path];
  if (!user) return { status: 401, data: { error: "Invalid token" } };
  if (path === "/profile/me") return { status: 200, data: { profile: { userId: user, age: 30 } } };
  if (path === "/workouts/schedules") return { status: 200, data: schedules(user) };
  if (path === "/workouts") return { status: 200, data: workouts(user) };
  if (path === "/stats/training-window") return { status: 200, data: WINDOW };
  if (path === "/stats/body-goal-state") return { status: 200, data: BODY };
  if (path === "/nutrition/target-preview") return { status: 200, data: { status: "ACTIVE_GOAL", goalId: "g-1", calories: 2400, protein: 140, carbs: 280, fat: 70 } };
  if (path === "/training-cycles/active" || path === "/fitness-roadmaps/current/forecast") return { status: 404, data: { error: "none" } };
  return { status: 404, data: { error: "not mocked" } };
}

// HTTP transport (axios adapter = only the socket is replaced; the real axios settle/validateStatus runs)
const http = { calls: [] as Array<{ url: string; method: string; headers: Record<string, unknown>; params: unknown }> };
const respond = (config: InternalAxiosRequestConfig, r: Reply): Promise<AxiosResponse> | AxiosResponse => {
  if ("hang" in r) return new Promise<AxiosResponse>(() => {});
  if ("error" in r) throw r.error === "timeout" ? new AxiosError("timeout of 3500ms exceeded", AxiosError.ECONNABORTED, config, {}) : new AxiosError("connect ECONNREFUSED", "ECONNREFUSED", config, {});
  const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
  if (!config.validateStatus || config.validateStatus(r.status)) return response;
  throw new AxiosError(`Request failed with status code ${r.status}`, r.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const adapter: AxiosAdapter = async (config) => {
  const raw = config.headers as any;
  const headers: Record<string, unknown> = typeof raw?.toJSON === "function" ? raw.toJSON() : { ...raw };
  const url = String(config.url ?? "");
  http.calls.push({ url, method: String(config.method), headers, params: config.params });
  return respond(config, answer(url.replace(/^https?:\/\/[^/]+/, "").split("?")[0], String(headers.Authorization ?? "")));
};

// Lambda transport (AWS SDK send stubbed; the command input is what the real InvokeCommand carries)
const lambda = { calls: [] as Array<{ FunctionName: string; event: any }>, sdkError: null as null | Error, rawPayload: null as null | string };

let app: Express;
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let tr: typeof import("../agent-v2-integration/domain-read-transport");
let hz: typeof import("./m5-benchmark/harness");
let requestService: typeof import("../clients/service-lambda.client").requestService;
let blocked = 0; let llmCalls = 0; let v1AskReached = 0;

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const { LambdaClient } = await import("@aws-sdk/client-lambda");
  (LambdaClient.prototype as any).send = async function (command: any) {
    const input = command.input;
    const event = JSON.parse(Buffer.from(input.Payload).toString("utf-8"));
    lambda.calls.push({ FunctionName: input.FunctionName, event });
    if (lambda.sdkError) throw lambda.sdkError;
    if (lambda.rawPayload !== null) return { StatusCode: 200, Payload: Buffer.from(lambda.rawPayload) };
    const r = answer(event.rawPath, String(event.headers?.Authorization ?? ""));
    if ("hang" in r) return new Promise(() => {});
    if ("error" in r) throw Object.assign(new Error("socket"), { name: r.error === "timeout" ? "TimeoutError" : "NetworkingError" });
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ statusCode: r.status, body: JSON.stringify(r.data) })) };
  };
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE"); };
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token]; if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  const { aiController } = await import("../controllers/ai.controller");
  (aiController as any).ask = (_req: any, res: any) => { v1AskReached++; res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  ({ requestService } = await import("../clients/service-lambda.client"));
  ({ default: app } = await import("../app"));
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  tr = await import("../agent-v2-integration/domain-read-transport");
});
test.after(() => { rt.multiAgentRuntimeSeam.factory = null; delete process.env.AI_AGENT_V2; delete process.env.FITNESS_LAMBDA_NAME; delete process.env.USER_LAMBDA_NAME; });
const reset = () => { http.calls.length = 0; lambda.calls.length = 0; lambda.sdkError = null; lambda.rawPayload = null; routes.override = {}; };
const useLambda = (on: boolean) => {
  if (on) { process.env.FITNESS_LAMBDA_NAME = "fitness-assistant-dev-fitness"; process.env.USER_LAMBDA_NAME = "fitness-assistant-dev-user"; }
  else { delete process.env.FITNESS_LAMBDA_NAME; delete process.env.USER_LAMBDA_NAME; }
};
const idA = { userId: USER_A, authorizationHeader: BEARER };
const kindOf = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e: any) { return e?.kind ?? `untyped:${e?.message}`; } };

// ── unit: transport ─────────────────────────────────────────────────────────────────────────────────────────────────
test("RT-1 local HTTP READ: allowlisted GET to FITNESS_SERVICE_URL with ONLY the user's bearer — no x-user-id, no secret", async () => {
  reset(); useLambda(false);
  const t = tr.createDomainReadTransport();
  const w = await t.getTrainingAnalytics(idA, { days: 28 });
  assert.equal(w.status, "ok");
  const h = await t.getRecentWorkoutHistory(idA, 7);
  assert.equal(h.status, "ok"); assert.equal((h as any).value[0].userId, USER_A);
  assert.equal((await t.getBodyGoalState(idA)).status, "ok");
  assert.deepEqual(http.calls.map((c) => [c.method, c.url]), [["get", "http://fitness-service.m7p2.invalid/stats/training-window"], ["get", "http://fitness-service.m7p2.invalid/workouts"], ["get", "http://fitness-service.m7p2.invalid/stats/body-goal-state"]]);
  for (const c of http.calls) {
    assert.equal(c.headers.Authorization, BEARER);
    for (const k of ["x-user-id", "x-gateway-secret", "x-internal-token"]) assert.ok(!(k in c.headers), `${k} must not be sent`);
  }
  assert.deepEqual(http.calls[0].params, { days: 28 }); assert.deepEqual(http.calls[1].params, { limit: 7 });
});

test("RT-2 Lambda READ: real invokeHttpLambda builds an API Gateway v2 event that fitness-service's own serverless-http parses correctly", async () => {
  reset(); useLambda(true);
  const t = tr.createDomainReadTransport();
  const h = await t.getRecentWorkoutHistory(idA, 7);
  assert.equal(h.status, "ok"); assert.equal(http.calls.length, 0, "no HTTP when FITNESS_LAMBDA_NAME is set");
  assert.equal(lambda.calls.length, 1);
  const { FunctionName, event } = lambda.calls[0];
  assert.equal(FunctionName, "fitness-assistant-dev-fitness");
  assert.equal(event.version, "2.0"); assert.equal(event.rawPath, "/workouts"); assert.equal(event.rawQueryString, "limit=7");
  assert.equal(event.requestContext.http.method, "GET"); assert.equal(event.headers.Authorization, BEARER);
  for (const k of ["x-user-id", "x-gateway-secret", "x-internal-token"]) assert.ok(!(k in event.headers), k);
  // replay through the receiver's library (fitness-service/node_modules/serverless-http 4.0.0) into an Express app
  const fitnessRequire = createRequire(path.resolve(__dirname, "../../../fitness-service/package.json"));
  const serverless = fitnessRequire("serverless-http") as any;
  assert.equal(fitnessRequire("serverless-http/package.json").version, "4.0.0", "the receiver's own copy");
  const express = (await import("express")).default;
  const seen: any = {};
  const mini = express(); mini.get("/workouts", (req, res) => { Object.assign(seen, { path: req.path, limit: req.query.limit, auth: req.headers.authorization, uid: req.headers["x-user-id"] }); res.json([]); });
  const out = await serverless(mini, { provider: "aws" })(event, {});
  assert.equal(out.statusCode, 200); assert.deepEqual(seen, { path: "/workouts", limit: "7", auth: BEARER, uid: undefined });
  useLambda(false);
});

test("RT-3..12 typed error mapping on both transports: 401/403, 404 (absent for these reads), 500, timeout, network, invalid payload", async () => {
  for (const viaLambda of [false, true]) {
    reset(); useLambda(viaLambda);
    const t = tr.createDomainReadTransport();
    const cases: Array<[Reply, string]> = [
      [{ status: 401, data: {} }, "ACCESS_DENIED"], [{ status: 403, data: {} }, "ACCESS_DENIED"], [{ status: 500, data: {} }, "UNAVAILABLE"],
      [{ status: 502, data: {} }, "UNAVAILABLE"], [{ status: 504, data: {} }, "TIMEOUT"], [{ status: 400, data: {} }, "INVALID_RESPONSE"],
      [{ error: "timeout" }, "TIMEOUT"], [{ error: "network" }, viaLambda ? "UNAVAILABLE" : "UNAVAILABLE"],
      [{ status: 200, data: { not: "a window" } }, "INVALID_RESPONSE"], [{ status: 200, data: "<html>gateway</html>" }, "INVALID_RESPONSE"],
    ];
    for (const [reply, kind] of cases) {
      routes.override = { "/stats/training-window": reply };
      assert.equal(await kindOf(t.getTrainingAnalytics(idA)), kind, `${viaLambda ? "lambda" : "http"} ${JSON.stringify(reply)}`);
    }
    routes.override = { "/stats/training-window": { status: 404, data: {} }, "/workouts": { status: 200, data: [] } };
    assert.equal((await t.getTrainingAnalytics(idA)).status, "absent", "404 → absent (V1 reader contract), not an error");
    assert.equal((await t.getRecentWorkoutHistory(idA, 7)).status, "absent", "an empty list → absent");
  }
  // hard timeout on a hanging transport (the Lambda path has no client timeout of its own) — own clock, short budget
  reset(); useLambda(false);
  const hang = tr.createDomainReadTransport({ request: () => new Promise(() => {}) as any });
  const started = Date.now();
  const res = await Promise.race([kindOf(hang.getTrainingAnalytics(idA)), new Promise((r) => setTimeout(() => r("TEST_TIMEOUT"), 6_000))]);
  assert.equal(res, "TIMEOUT"); assert.ok(Date.now() - started < 5_000);
});

test("RT-Lambda AWS SDK failures are classified as caller CONFIGURATION, not as the user's access or as 'no data'", async () => {
  reset(); useLambda(true);
  const t = tr.createDomainReadTransport();
  for (const [name, kind] of [["ResourceNotFoundException", "CONFIGURATION_ERROR"], ["AccessDeniedException", "CONFIGURATION_ERROR"], ["CredentialsProviderError", "CONFIGURATION_ERROR"],
    ["TooManyRequestsException", "UNAVAILABLE"], ["ServiceException", "UNAVAILABLE"], ["TimeoutError", "TIMEOUT"]] as const) {
    lambda.sdkError = Object.assign(new Error(name), { name });
    assert.equal(await kindOf(t.getBodyGoalState(idA)), kind, name);
  }
  lambda.sdkError = null; lambda.rawPayload = "not json at all";
  assert.equal(await kindOf(t.getBodyGoalState(idA)), "INVALID_RESPONSE", "a non-JSON Lambda payload is never a success");
  useLambda(false);
});

test("RT-13/15/16 identity + allowlist: no bearer → refused before sending; inputs strict (no userId); only three GET reads exist; no WRITE in default deps", async () => {
  reset(); useLambda(false);
  const t = tr.createDomainReadTransport();
  for (const id of [{ userId: USER_A }, { userId: USER_A, authorizationHeader: "tok-a" }, { userId: USER_A, authorizationHeader: "Bearer " }]) {
    assert.equal(await kindOf(t.getTrainingAnalytics(id as any)), "ACCESS_DENIED");
  }
  assert.equal(await kindOf(t.getTrainingAnalytics(idA, { days: 28, userId: USER_B } as any)), "INVALID_RESPONSE", "a userId in the input is rejected (strict schema)");
  assert.equal(await kindOf(t.getTrainingAnalytics(idA, { days: 5000 })), "INVALID_RESPONSE");
  assert.equal(http.calls.length, 0, "nothing was sent for any refused call");
  assert.deepEqual(Object.keys(t).sort(), ["getBodyGoalState", "getRecentWorkoutHistory", "getTrainingAnalytics"]);
  assert.ok(Object.isFrozen(tr.READ_OPERATIONS)); assert.deepEqual(Object.values(tr.READ_OPERATIONS).map((o) => o.path), ["/stats/training-window", "/workouts", "/stats/body-goal-state"]);
  const deps = rt.defaultDomainDeps();
  const WRITE_NAMES = /update|import|skip|cancel|evaluate|start|advance|create|save|delete|log/i;
  for (const [agent, d] of Object.entries(deps)) for (const k of Object.keys(d as object)) assert.doesNotMatch(k, WRITE_NAMES, `${agent}.${k}`);
});

test("RT-3/4/5 /internal Training READs: valid secret passes; missing secret refused caller-side (nothing sent); receiver token mismatch → ACCESS_DENIED", async () => {
  let sent = 0;
  const fn = async (_id: unknown, ids: string[]) => { sent++; return ids; };
  assert.deepEqual(await tr.requireInternalSecret(fn, { INTERNAL_SERVICE_SECRET: "s3cret" })(idA, ["e1"]), ["e1"]);
  for (const env of [{}, { INTERNAL_SERVICE_SECRET: "" }, { INTERNAL_SERVICE_SECRET: "   " }]) {
    assert.equal(await kindOf(tr.requireInternalSecret(fn, env)(idA, ["e1"])), "CONFIGURATION_ERROR");
  }
  assert.equal(sent, 1, "a missing secret never sends an empty x-internal-token");
  const mismatch = async () => { throw Object.assign(new Error("Request must originate from a trusted internal service"), { status: 401 }); };
  const unconfigured = async () => { throw Object.assign(new Error("Service authentication is not configured"), { status: 500 }); };
  assert.equal(await kindOf(tr.requireInternalSecret(mismatch, { INTERNAL_SERVICE_SECRET: "s3cret" })()), "ACCESS_DENIED");
  assert.equal(await kindOf(tr.requireInternalSecret(unconfigured, { INTERNAL_SERVICE_SECRET: "s3cret" })()), "UNAVAILABLE", "receiver fail-closed 500 stays an outage, never data");
});

test("RT-registry: typed kinds reach the tool registry as distinct codes; nothing is parsed from message text", async () => {
  const { createRecoveryToolRegistry, RECOVERY_AGENT_PILOT_POLICY } = await import("../agent-v2/recovery-tools");
  for (const [kind, code] of [["ACCESS_DENIED", "DOMAIN_ACCESS_DENIED"], ["TIMEOUT", "TOOL_TIMEOUT"], ["INVALID_RESPONSE", "OUTPUT_INVALID"], ["CONFIGURATION_ERROR", "CONFIGURATION_ERROR"], ["UNAVAILABLE", "SYSTEM_ERROR"]] as const) {
    const err = tr.readError(kind);
    err.message = "Request failed with status code 403"; // misleading text must not win over the typed kind
    const reg = createRecoveryToolRegistry({ enabled: true, deps: { getTrainingAnalytics: async () => { throw err; }, getRecentWorkoutHistory: async () => { throw err; } } as any, traceSink: () => {} });
    const r = await reg.execute(RECOVERY_AGENT_PILOT_POLICY, "recovery.get_recent_sessions", {}, { userId: USER_A, authorizationHeader: BEARER });
    assert.equal(!r.ok && r.error.code, code, kind);
  }
});

// ── HTTP through the app with the DEFAULT deps ───────────────────────────────────────────────────────────────────────
function rig() {
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  const runtime = rt.createMultiAgentRuntime({ providerFor: (a) => prov[a], now: () => T0, traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x) });
  rt.multiAgentRuntimeSeam.factory = () => runtime;
  return { prov, traces, agentTraces };
}
const ask = (q: string, token = "tok-a") => request(app).post("/ai/v2/ask").set("Authorization", `Bearer ${token}`).send({ question: q });

test("RT-18 Recovery + Training over local HTTP with the default deps (V2 transport + V1 domain client)", async () => {
  process.env.AI_AGENT_V2 = "on"; reset(); useLambda(false); const s = rig();
  s.prov.recovery.script(hz.use(hz.call("recovery.get_recent_sessions")), hz.say("Quan sát từ dữ liệu: hôm qua bạn ghi một buổi thân dưới với RPE 8."));
  s.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay buổi Leg day: giảm tạ khoảng 10% vì chân vừa tập hôm qua."));
  const r = await ask("Tôi tập chân hôm qua, hôm nay nên tập gì?");
  assert.equal(r.status, 200); assert.deepEqual([...r.body.data.agents].sort(), ["recovery", "training"]);
  assert.ok(s.traces[0].delegations.every((d) => d.completionStatus === "COMPLETE"), JSON.stringify(s.traces[0].delegations.map((d) => d.evidence)));
  const paths = http.calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
  assert.deepEqual(paths.sort(), ["/profile/me", "/workouts", "/workouts/schedules"]);
  assert.ok(http.calls.every((c) => c.headers.Authorization === BEARER), "every downstream read carries the caller's own bearer");
  assert.equal(lambda.calls.length, 0);
});

test("RT-19 Progress + Training over Lambda Invoke (mocked SDK) with the default deps — every read is an Invoke, none is HTTP", async () => {
  process.env.AI_AGENT_V2 = "on"; reset(); useLambda(true); const s = rig();
  s.prov.progress.script(hz.use(hz.call("progress.get_strength_progression")), hz.say("Ước tính sức mạnh squat giảm khoảng 4% trong 4 tuần."));
  s.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Giữ chương trình hiện tại và ưu tiên kỹ thuật trong buổi Leg day."));
  const r = await ask("Sức mạnh deadlift của tôi có tăng không, chương trình nên chỉnh gì?");
  assert.equal(r.status, 200); assert.deepEqual([...r.body.data.agents].sort(), ["progress", "training"]);
  assert.ok(s.traces[0].delegations.every((d) => d.completionStatus === "COMPLETE"), JSON.stringify(s.traces[0].delegations.map((d) => d.evidence)));
  assert.equal(http.calls.length, 0, "no HTTP when the Lambda names are configured");
  assert.deepEqual(lambda.calls.map((c) => `${c.FunctionName}:${c.event.rawPath}`).sort(),
    ["fitness-assistant-dev-fitness:/stats/training-window", "fitness-assistant-dev-fitness:/workouts/schedules", "fitness-assistant-dev-user:/profile/me"]);
  // the V1 domain client (schedules) sends the gateway secret + x-user-id (its existing contract); the V2 transport and the profile read send the bearer only
  const byPath = Object.fromEntries(lambda.calls.map((c) => [c.event.rawPath, c.event.headers]));
  assert.ok(!("x-user-id" in byPath["/stats/training-window"]) && !("x-user-id" in byPath["/profile/me"]));
  assert.equal(byPath["/workouts/schedules"]["x-user-id"], USER_A, "V1 domain client: identity from the verified context, never from the client");
  useLambda(false);
});

test("RT-14/17 cross-user rows are withheld; a refused profile read fails closed before any agent (Lambda path)", async () => {
  process.env.AI_AGENT_V2 = "on"; reset(); useLambda(false); const s = rig();
  routes.override = { "/workouts": { status: 200, data: workouts(USER_B) } };
  s.prov.recovery.script(hz.use(hz.call("recovery.get_recent_sessions")), hz.say("Quan sát từ dữ liệu: buổi gần nhất được ghi là hôm qua."));
  s.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay bạn có buổi Leg day."));
  await ask("Tôi tập chân hôm qua, hôm nay nên tập gì?");
  const rec = s.traces[0].delegations.find((d) => d.agentId === "recovery")!;
  assert.equal(rec.evidence[0].outcome, "CROSS_USER_DATA");
  reset(); useLambda(true); const p = rig();
  routes.override = { "/profile/me": { status: 403, data: {} } };
  const r = await ask("Hôm nay tôi tập gì?");
  assert.equal(r.body.data.status, "PROFILE_UNVERIFIED"); assert.equal(p.traces[0].profileRead, "PROFILE_ACCESS_DENIED");
  assert.deepEqual(lambda.calls.map((c) => c.event.rawPath), ["/profile/me"], "nothing but the profile read was invoked");
  useLambda(false);
});

test("RT-20 Nutrition-only over the default deps; RT-21 flag OFF; RT-22 /ai/ask unchanged", async () => {
  process.env.AI_AGENT_V2 = "on"; reset(); useLambda(false); const s = rig();
  s.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const r = await ask("Mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(r.body.data.status, "ANSWERED"); assert.match(r.body.data.answer, /2400 kcal/);
  assert.ok(http.calls.some((c) => c.url.endsWith("/nutrition/target-preview")));
  delete process.env.AI_AGENT_V2; reset();
  assert.equal((await ask("Mục tiêu calo của tôi là bao nhiêu?")).status, 404); assert.equal(http.calls.length + lambda.calls.length, 0);
  const before = v1AskReached;
  const v1 = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" });
  assert.equal(v1.status, 200); assert.equal(v1AskReached, before + 1);
});

test("RT-23 no real network / AWS / provider / model call in the whole file", () => {
  assert.equal(blocked, 0); assert.equal(llmCalls, 0);
  assert.ok(http.calls.every((c) => /\.invalid\//.test(c.url)));
  void requestService;
});
