/**
 * Adapter tests for the AI Coach × Multi-Agent V2 response mapping (pure functions, no DOM). The frontend has no test runner configured,
 * so this file uses node:test and is run with the ai-service's tsx:
 *   cd backend/services/ai-service && npx tsx --test ../../../frontend/web/src/app/services/coachV2Response.test.ts
 * Evidence label: TEST FIXTURE. The payload shapes are copied from the backend bridge (services/coach-bridge.middleware.ts mapV2 /
 * mapBoundary, verified by the T3 HTTP test coach-v2-route-http.test.ts) — the browser run is a separate evidence item.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { COACH_V2_ENGINE_MARKER, describeCoachFailure, describeCoachV2, describeCoachV2History, parseCoachV2 } from "./coachV2Response";

const payload = (v2: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  question: "q", answer: "a", sessionId: "s", engine: "multi-agent-v2",
  v2: { status: "ANSWERED", kind: "answered", agents: ["training"], turnId: "T1", traceId: "abcdef1234567890", replayed: false, historyRecorded: true, ...v2 }, ...over,
});

test("a V1 payload (no engine / v2 field) or a malformed one is never decorated", () => {
  assert.equal(parseCoachV2({ answer: "x", sessionId: "s", conversationId: "c" }), null);
  assert.equal(parseCoachV2(null), null);
  assert.equal(parseCoachV2("text"), null);
  assert.equal(parseCoachV2({ engine: "multi-agent-v2" }), null);
  assert.equal(parseCoachV2({ engine: "other", v2: { status: "ANSWERED", kind: "answered" } }), null);
  assert.equal(parseCoachV2(payload({ kind: "weird" })), null, "an unknown kind is rejected, not guessed");
  assert.equal(parseCoachV2(payload({ status: 5 })), null);
});

test("ANSWERED / PARTIAL / blocked / failed keep their own state — never promoted to an ordinary answer", () => {
  const cases: Array<[string, string, string]> = [
    ["ANSWERED", "answered", "ok"], ["PARTIAL", "partial", "partial"], ["INSUFFICIENT_DATA", "partial", "partial"],
    ["MINOR_PROTECTED", "blocked", "blocked"], ["SESSION_UNAVAILABLE", "blocked", "blocked"], ["SAFETY_BLOCKED", "blocked", "blocked"],
    ["PROFILE_UNVERIFIED", "blocked", "blocked"], ["ROUTING_UNDETERMINED", "blocked", "blocked"], ["OUT_OF_SCOPE", "blocked", "blocked"],
    ["BLOCKED", "blocked", "blocked"], ["INVALID_INPUT", "blocked", "blocked"], ["UNAUTHENTICATED", "blocked", "blocked"],
    ["FAILED", "unavailable", "error"], ["BUDGET_EXHAUSTED", "unavailable", "error"],
  ];
  for (const [status, kind, tone] of cases) {
    const meta = parseCoachV2(payload({ status, kind, agents: [] }));
    assert.ok(meta, status);
    const v = describeCoachV2(meta!);
    assert.equal(v.status, status); assert.equal(v.kind, kind); assert.equal(v.tone, tone, status);
    if (status !== "ANSWERED") assert.notEqual(v.tone, "ok", `${status} must not look like a normal answer`);
    assert.match(v.engineLabel, /Multi-Agent V2/);
  }
  assert.match(describeCoachV2(parseCoachV2(payload({ status: "PARTIAL", kind: "partial" }))!).statusLabel, /một phần/);
});

test("an unknown status is shown under its own name with a tone from `kind`, and an unknown 'answered' is not green", () => {
  const v = describeCoachV2(parseCoachV2(payload({ status: "SOMETHING_NEW", kind: "answered" }))!);
  assert.equal(v.statusLabel, "Trạng thái V2: SOMETHING_NEW"); assert.notEqual(v.tone, "ok");
  assert.equal(describeCoachV2(parseCoachV2(payload({ status: "NEW_BLOCK", kind: "blocked" }))!).tone, "blocked");
  assert.equal(describeCoachV2(parseCoachV2(payload({ status: "NEW_FAIL", kind: "unavailable" }))!).tone, "error");
});

test("agents, trace and history are shown only when the backend supplied them — nothing is invented", () => {
  const none = describeCoachV2(parseCoachV2(payload({ agents: [], traceId: undefined, turnId: undefined, historyRecorded: false }))!);
  assert.deepEqual(none.agents, []); assert.equal(none.traceId, undefined);
  assert.match(none.historyNote ?? "", /không được lưu/);
  const some = describeCoachV2(parseCoachV2(payload({ agents: ["training", "nutrition", 7, null], historyRecorded: true }))!);
  assert.deepEqual(some.agents, ["training", "nutrition"], "non-string entries are dropped");
  assert.equal(some.traceId, "abcdef1234567890"); assert.equal(some.historyNote, undefined);
  const view = describeCoachV2(parseCoachV2(payload({}))!) as unknown as Record<string, unknown>;
  for (const invented of ["structuredBlocks", "evidenceUsed", "safetyNotes", "conversationId", "history", "userId"]) assert.ok(!(invented in view), invented);
  assert.equal(describeCoachV2(parseCoachV2(payload({ replayed: true }))!).replayed, true);
});

test("HTTP 409 is split by the backend code: in-progress is retryable with the SAME request, a conflict is not; unknown 409 is the safe one", () => {
  const prog = describeCoachFailure(409, "OPERATION_IN_PROGRESS")!;
  assert.equal(prog.kind, "in_progress"); assert.equal(prog.canRetrySameRequest, true); assert.match(prog.message, /đang được xử lý/);
  const conflict = describeCoachFailure(409, "IDEMPOTENCY_KEY_CONFLICT")!;
  assert.equal(conflict.kind, "conflict"); assert.equal(conflict.canRetrySameRequest, false);
  assert.notEqual(prog.message, conflict.message);
  for (const code of [undefined, "SOMETHING_ELSE"]) { const u = describeCoachFailure(409, code)!; assert.equal(u.kind, "conflict", String(code)); assert.equal(u.canRetrySameRequest, false); }
});

test("401 / 403 / 404 session / 503 have their own text; other statuses are left to the existing generic handling (null)", () => {
  assert.equal(describeCoachFailure(401)!.kind, "unauthorized");
  assert.equal(describeCoachFailure(403)!.kind, "forbidden");
  assert.equal(describeCoachFailure(404, "SESSION_NOT_FOUND")!.kind, "session_not_found");
  const u = describeCoachFailure(503, "SERVICE_UNAVAILABLE")!;
  assert.equal(u.kind, "unavailable"); assert.equal(u.canRetrySameRequest, true);
  for (const s of [undefined, 400, 404, 429, 500, 502]) assert.equal(describeCoachFailure(s as number | undefined), null, String(s));
  assert.equal(describeCoachFailure(404, "OTHER"), null);
});

test("history reload: only a turn whose stored engine is the V2 marker gets a REDUCED badge — no status, no agents, no inference from the answer", () => {
  assert.equal(describeCoachV2History({ modelUsed: "multi-agent-v2", traceId: "trace-abc" })!.traceId, "trace-abc");
  const v = describeCoachV2History({ modelUsed: COACH_V2_ENGINE_MARKER, traceId: null })!;
  assert.equal(v.kind, "stored"); assert.equal(v.status, "STORED"); assert.equal(v.tone, "neutral"); assert.deepEqual(v.agents, []); assert.equal(v.traceId, undefined);
  assert.match(v.statusLabel, /không được lưu/);
  for (const r of [{}, { modelUsed: undefined }, { modelUsed: "v1-model" }, { modelUsed: "Multi-Agent-V2" }, { modelUsed: null }, { modelUsed: 5 }, { traceId: "t" }]) assert.equal(describeCoachV2History(r), null, JSON.stringify(r));
  const keys = Object.keys(v);
  for (const invented of ["block", "turnId", "historyNote"]) assert.ok(!keys.includes(invented), invented);
});
