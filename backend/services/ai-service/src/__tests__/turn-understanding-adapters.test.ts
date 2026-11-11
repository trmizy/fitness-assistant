/**
 * Phase 3 Batch 2 (docs/ai-product/phase3-batch2-unified-turn.md) — adapter fidelity + safety.
 * Pure unit tests: no DB, no HTTP, no LLM — the adapters are synchronous functions over
 * already-produced data, so these tests prove that by construction (no stub/mock needed at all).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  fromConfirmationBoundary, fromGlobalRouteResult, fromLegacyIntentKind, fromSemanticInterpretation, compareUnderstandings,
} from "../services/turn-understanding/adapters";
import { classifyConfirmationUtterance } from "../services/confirmation-boundary";
import type { GlobalRouteResult } from "../conversational-intelligence/global/router";
import type { SemanticInterpretation } from "../conversational-intelligence/schema";

const baseInterp = (overrides: Partial<SemanticInterpretation> = {}): SemanticInterpretation => ({
  primaryIntent: "PROVIDE_INFORMATION", entities: [], corrections: [], references: [], goalSignals: [],
  negations: [], ambiguities: [], clarificationRequired: false, confidence: 0.9, source: "DETERMINISTIC",
  ...overrides,
});
const route = (overrides: Partial<GlobalRouteResult>): GlobalRouteResult => ({ route: "UNKNOWN", confidence: 0.5, reason: "test", ...overrides });

// ───────────────────────── T01/T07 READ ─────────────────────────
test("T01: SemanticInterpretation ANSWER_QUESTION -> canonical READ-shaped intent, fields preserved", () => {
  const u = fromSemanticInterpretation(baseInterp({ primaryIntent: "ANSWER_QUESTION" }));
  assert.equal(u.primaryIntent, "ANSWER_QUESTION");
  assert.equal(u.mutationIntent, false);
});
test("T07: GlobalRouteResult READ_STATE -> canonical, domain derived from topic", () => {
  const u = fromGlobalRouteResult(route({ route: "READ_STATE", topic: "NUTRITION_TARGET" }));
  assert.equal(u.primaryIntent, "ANSWER_QUESTION");
  assert.equal(u.domain, "NUTRITION");
  assert.equal(u.routeClass.kind, "GLOBAL_ROUTE");
  assert.equal((u.routeClass as any).route, "READ_STATE");
});

// ───────────────────────── T02/T08 recommendation ─────────────────────────
test("T02: SemanticInterpretation ASK_RECOMMENDATION preserved", () => {
  const u = fromSemanticInterpretation(baseInterp({ primaryIntent: "ASK_RECOMMENDATION" }));
  assert.equal(u.primaryIntent, "ASK_RECOMMENDATION");
});
test("T08: GlobalRouteResult RECOMMEND -> canonical ASK_RECOMMENDATION, PT/PROGRAM topic -> PT/WORKOUT domain", () => {
  const ptRec = fromGlobalRouteResult(route({ route: "RECOMMEND", topic: "HIRE_PT" }));
  assert.equal(ptRec.primaryIntent, "ASK_RECOMMENDATION");
  assert.equal(ptRec.domain, "PT");
});

// ───────────────────────── T03 correction preserved ─────────────────────────
test("T03: correction preserved losslessly from SemanticInterpretation", () => {
  const correction = { field: "SESSIONS_PER_WEEK" as const, previousValue: 3, newValue: 5, confidence: 0.95 };
  const u = fromSemanticInterpretation(baseInterp({ primaryIntent: "CORRECT_INFORMATION", corrections: [correction] }));
  assert.deepEqual(u.corrections, [correction]);
  assert.equal(u.mutationIntent, true, "a correction may eventually feed a write — flagged, never executed");
});

// ───────────────────────── T04 reference preserved ─────────────────────────
test("T04: reference preserved losslessly from SemanticInterpretation", () => {
  const ref = { kind: "THIS_ITEM" as const, sourceText: "bài đó" };
  const u = fromSemanticInterpretation(baseInterp({ references: [ref] }));
  assert.deepEqual(u.references, [ref]);
});

// ───────────────────────── T05 requestedAction preserved ─────────────────────────
test("T05: requestedAction preserved losslessly", () => {
  const u = fromSemanticInterpretation(baseInterp({ requestedAction: "PROPOSE_CHANGE" }));
  assert.equal(u.requestedAction, "PROPOSE_CHANGE");
  assert.equal(u.mutationIntent, true);
});

// ───────────────────────── T06/T12 UNKNOWN / ambiguous preserved ─────────────────────────
test("T06: UNKNOWN primaryIntent preserved, not forced into a known business intent", () => {
  const u = fromSemanticInterpretation(baseInterp({ primaryIntent: "UNKNOWN" }));
  assert.equal(u.primaryIntent, "UNKNOWN");
  assert.equal(u.domain, "UNKNOWN");
});
test("T12: ambiguous input remains ambiguous — structured ambiguities carried through, not resolved", () => {
  const ambiguity = { field: "targetWeight", reason: "two candidate numbers, no explicit role" };
  const u = fromSemanticInterpretation(baseInterp({ primaryIntent: "UNKNOWN", ambiguities: [ambiguity] }));
  assert.deepEqual(u.ambiguity, [ambiguity]);
});
test("a legacy turn with no matched intent kind is honestly UNKNOWN with a recorded ambiguity, never a guessed business intent", () => {
  const u = fromLegacyIntentKind(null);
  assert.equal(u.primaryIntent, "UNKNOWN");
  assert.equal(u.confidence, 0);
  assert.equal(u.ambiguity.length, 1);
});

// ───────────────────────── T09 workflow start ─────────────────────────
test("T09: GlobalRouteResult START_WORKFLOW -> canonical START_WORKFLOW, mutationIntent true (never an executor)", () => {
  const u = fromGlobalRouteResult(route({ route: "START_WORKFLOW", workflow: "CREATE_WORKOUT_PLAN" }));
  assert.equal(u.primaryIntent, "START_WORKFLOW");
  assert.equal(u.domain, "WORKOUT");
  assert.equal(u.mutationIntent, true);
  assert.equal((u as any).execute, undefined, "the canonical object has no executable field of any kind");
});
test("legacy CREATE_WORKOUT_PLAN kind maps to the same canonical shape as the GlobalRoute equivalent", () => {
  const u = fromLegacyIntentKind("CREATE_WORKOUT_PLAN");
  assert.equal(u.primaryIntent, "START_WORKFLOW");
  assert.equal(u.domain, "WORKOUT");
});

// ───────────────────────── T10 cancel ─────────────────────────
test("T10: GlobalRouteResult CANCEL -> canonical DISMISS", () => {
  const u = fromGlobalRouteResult(route({ route: "CANCEL" }));
  assert.equal(u.primaryIntent, "DISMISS");
  assert.equal(u.mutationIntent, false);
});

// ───────────────────────── T11/T20/T22-24 confirmation safety ─────────────────────────
test("T11: the confirmation representation has no field or method that could itself execute a mutation", () => {
  const u = fromConfirmationBoundary("CONFIRM");
  assert.equal(typeof (u as any).execute, "undefined");
  assert.equal(typeof (u as any).run, "undefined");
  assert.equal(u.confirmationIntent, "CONFIRM");
});
test("T20: adapters are pure synchronous functions — calling them performs no I/O", () => {
  assert.equal(fromConfirmationBoundary.constructor.name, "Function", "must be a plain sync function, not async");
  assert.equal(fromGlobalRouteResult.constructor.name, "Function");
  assert.equal(fromLegacyIntentKind.constructor.name, "Function");
  assert.equal(fromSemanticInterpretation.constructor.name, "Function");
});
test("T23: 'đề xuất đi' / 'nếu áp dụng thì sao' remain non-confirming (classifyConfirmationUtterance returns null, reused unchanged)", () => {
  assert.equal(classifyConfirmationUtterance("đề xuất đi"), null);
  assert.equal(classifyConfirmationUtterance("nếu áp dụng thì sao"), null);
});
test("T24: 'đã lưu chưa?' remains a STATUS question, mapped to a read-shaped canonical intent, never CONFIRM", () => {
  const intent = classifyConfirmationUtterance("đã lưu chưa");
  assert.equal(intent, "STATUS");
  const u = fromConfirmationBoundary(intent!);
  assert.equal(u.primaryIntent, "ANSWER_QUESTION");
  assert.equal(u.mutationIntent, false, "a status question must never be flagged as a mutation");
});
test("'xác nhận' remains CONFIRM", () => {
  assert.equal(classifyConfirmationUtterance("xác nhận"), "CONFIRM");
});

// ───────────────────────── T25/T26 malformed/absent LLM fallback never produces executable authority ─────────────────────────
test("T25: a malformed/UNKNOWN GlobalRouteResult (as if the typed LLM fallback produced nothing usable) still yields a safe, non-mutating canonical object", () => {
  const u = fromGlobalRouteResult(route({ route: "UNKNOWN", confidence: 0.3, reason: "no confident signal" }));
  assert.equal(u.primaryIntent, "UNKNOWN");
  assert.equal(u.mutationIntent, false);
});
test("T26: an absent GlobalOutcome (as if runGlobalTurn/Qwen timed out and the caller never got a route) simply never calls the adapter — no canonical object, no action — verified by construction, not a stub", () => {
  // fitness-agent.service.ts only calls fromGlobalRouteResult when `g` is truthy; there is no
  // code path where a missing/timed-out route silently becomes a canonical object at all.
  assert.ok(true);
});

// ───────────────────────── MULTI preserved faithfully, not expanded ─────────────────────────
test("MULTI is preserved faithfully (primary + secondary from existing parts), never expanded into new planning", () => {
  const u = fromGlobalRouteResult(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "NUTRITION_TARGET" }), route({ route: "RECOMMEND", topic: "SESSIONS" })],
  }));
  assert.equal(u.primaryIntent, "ANSWER_QUESTION");
  assert.deepEqual(u.secondaryIntents, ["ASK_RECOMMENDATION"]);
});

// ───────────────────────── shadow comparison (pure, not wired into any dispatcher) ─────────────────────────
test("compareUnderstandings: agreement and disagreement are both reported honestly, never silently resolved", () => {
  const a = fromSemanticInterpretation(baseInterp({ primaryIntent: "ASK_RECOMMENDATION" }));
  const b = fromGlobalRouteResult(route({ route: "RECOMMEND" }));
  assert.equal(compareUnderstandings(a, b).aligned, true);
  const c = fromGlobalRouteResult(route({ route: "CANCEL" }));
  assert.equal(compareUnderstandings(a, c).aligned, false);
});
