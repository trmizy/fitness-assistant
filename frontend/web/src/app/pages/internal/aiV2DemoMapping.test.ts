/**
 * Mapping tests for the demo page (pure functions, no DOM). The frontend has no test runner configured, so this file uses node:test and is
 * run with the ai-service's tsx:  cd backend/services/ai-service && npx tsx --test ../../../frontend/web/src/app/pages/internal/aiV2DemoMapping.test.ts
 * Evidence label: TEST FIXTURE (hand-built API JSON shaped like the launcher's output; not a browser test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hasDeferredNotice, httpErrorView, mapRun, mapTurn, statusView, type DemoApiTurn, type DemoRunResponse } from "./aiV2DemoMapping";

const base = (over: Partial<DemoApiTurn>): DemoApiTurn => ({
  label: "t", request: { question: "q", actingAs: "A" }, http: { status: 200 },
  response: { data: { status: "ANSWERED", answer: "ok", agents: ["training"], turnId: "T1", traceId: "R1" } }, trace: null, ...over,
});

test("executed agents come ONLY from response.data.agents, never from the routing decision", () => {
  const v = mapTurn(base({ response: { data: { status: "PARTIAL", answer: "a", agents: ["training"] } },
    trace: { supervisorStatus: "PARTIAL", decision: { strategy: "intent-v1.3", chosen: ["training", "nutrition"], dropped: ["recovery:max_agents"], reasonCodes: [] }, delegations: [] } }));
  assert.deepEqual(v.executedAgents, ["training"]);
  assert.deepEqual(v.chosenAgents, ["training", "nutrition"]);
  assert.deepEqual(v.droppedAgents, ["recovery:max_agents"]);
});

test("a blocked turn lists no executed agent even if the trace carries a decision", () => {
  const v = mapTurn(base({ response: { data: { status: "SAFETY_BLOCKED", answer: "x", agents: [] } } }));
  assert.deepEqual(v.executedAgents, []);
  assert.equal(v.status.tone, "blocked");
});

test("turnId / traceId are shown only when the real response has them (nothing invented)", () => {
  const withIds = mapTurn(base({}));
  assert.equal(withIds.turnId, "T1"); assert.equal(withIds.traceId, "R1");
  const without = mapTurn(base({ response: { data: { status: "ANSWERED", answer: "a", agents: [] } } }));
  assert.equal("turnId" in without, false); assert.equal("traceId" in without, false);
});

test("deferred-intent notice is derived from the answer TEXT only", () => {
  assert.equal(hasDeferredNotice("Một số phần chưa được xử lý trong lượt này."), true);
  assert.equal(hasDeferredNotice("Câu trả lời bình thường."), false);
  assert.equal(hasDeferredNotice(undefined), false);
  assert.equal(mapTurn(base({ response: { data: { status: "PARTIAL", answer: "x chưa được xử lý trong lượt này", agents: ["training"] } } })).deferredNotice, true);
});

test("status mapping: PARTIAL / MINOR_PROTECTED / SESSION_UNAVAILABLE / FAILED / unknown", () => {
  assert.equal(statusView("PARTIAL").tone, "partial");
  assert.equal(statusView("MINOR_PROTECTED").tone, "blocked");
  assert.equal(statusView("SESSION_UNAVAILABLE").tone, "error");
  assert.equal(statusView("FAILED").tone, "error");
  const unknown = statusView("SOMETHING_NEW");
  assert.equal(unknown.label, "SOMETHING_NEW"); assert.equal(unknown.tone, "partial");
  assert.equal(statusView(undefined).tone, "error");
});

test("HTTP-level errors (404 flag off, 401, 400) map to an error view with the real code", () => {
  const v = httpErrorView(base({ http: { status: 404 }, response: { error: { code: "NOT_FOUND", message: "Not found" } } }));
  assert.ok(v); assert.equal(v!.label, "HTTP 404 NOT_FOUND"); assert.equal(v!.tone, "error");
  assert.equal(httpErrorView(base({})), null);
  assert.match(mapTurn(base({ http: { status: 401 }, response: { error: { code: "UNAUTHORIZED", message: "x" } } })).status.explanation, /đăng nhập/);
});

test("session / identity labels", () => {
  assert.equal(mapTurn(base({ request: { question: "q", sessionId: "s1", actingAs: "B" } })).sessionLabel, "s1");
  assert.equal(mapTurn(base({ request: { question: "q", actingAs: "none" } })).actingAs, "không token");
});

test("mapRun sums the tripwires", () => {
  const r: DemoRunResponse = { scenarioId: "x", banner: "b", notice: "n", turns: [base({})], tripwires: { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 }, durationMs: 1 };
  assert.equal(mapRun(r).tripwireTotal, 0);
  assert.equal(mapRun({ ...r, tripwires: { fetch: 1, bedrock: 0, callLLM: 2, unmockedHttp: 0 } }).tripwireTotal, 3);
});
