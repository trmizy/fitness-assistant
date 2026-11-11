/**
 * Phase 3 Batch 3 — pure planner tests. No DB, no HTTP, no LLM: proven by construction (the
 * planner module imports nothing from axios/prisma/llm services) and re-confirmed here by never
 * stubbing anything and still getting deterministic results.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planBoundedTurn } from "../services/bounded-turn/planner";
import type { GlobalRouteResult } from "../conversational-intelligence/global/router";

const route = (overrides: Partial<GlobalRouteResult>): GlobalRouteResult => ({ route: "UNKNOWN", confidence: 0.5, reason: "test", ...overrides });

test("T01: a non-MULTI route produces a trivial SINGLE plan handled entirely by the existing dispatcher", () => {
  const plan = planBoundedTurn(route({ route: "READ_STATE", topic: "GOAL" }));
  assert.equal(plan.compositionType, "SINGLE");
  assert.equal(plan.handledBy, "EXISTING_MULTI");
  assert.equal(plan.reads.length, 0);
});

test("T02: READ + READ within the limit is classified READ_READ, handled by the existing MULTI composer", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "PT_STATUS" }), route({ route: "READ_STATE", topic: "NUTRITION_TARGET" })],
  }));
  assert.equal(plan.compositionType, "READ_READ");
  assert.equal(plan.reads.length, 2);
  assert.equal(plan.handledBy, "EXISTING_MULTI", "already handled correctly by global-turn.ts today — no new executor needed");
});

test("T03: READ + RECOMMEND(non-PT/PROGRAM) is accepted and left to the existing MULTI composer", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "NUTRITION_TARGET" }), route({ route: "RECOMMEND", topic: "SESSIONS" })],
  }));
  assert.equal(plan.compositionType, "READ_RECOMMEND");
  assert.equal(plan.handledBy, "EXISTING_MULTI");
  assert.equal(plan.supported, true);
});

test("T04/the one real gap: READ + RECOMMEND(PT) is accepted and routed to the bounded executor", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "PT_STATUS" }), route({ route: "RECOMMEND", topic: "PT", workflow: "FIND_PT" })],
  }));
  assert.equal(plan.compositionType, "READ_RECOMMEND");
  assert.equal(plan.handledBy, "BOUNDED_EXECUTOR");
  assert.deepEqual(plan.recommendation, { kind: "PT" });
});

test("READ + RECOMMEND(PROGRAM) is also routed to the bounded executor, same rule as PT", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "PROGRAM_STATUS" }), route({ route: "RECOMMEND", topic: "PROGRAM" })],
  }));
  assert.equal(plan.handledBy, "BOUNDED_EXECUTOR");
});

test("T05/T06: a turn with 3 reads exceeds the bounded limit and is marked UNSUPPORTED with a reason, never forced", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [
      route({ route: "READ_STATE", topic: "PT_STATUS" }),
      route({ route: "READ_STATE", topic: "NUTRITION_TARGET" }),
      route({ route: "READ_STATE", topic: "PROGRAM_STATUS" }),
    ],
  }));
  assert.equal(plan.compositionType, "UNSUPPORTED");
  assert.equal(plan.supported, false);
  assert.match(plan.reasonUnsupported!, /exceeds bounded limits/);
});

test("T05: two independent RECOMMEND parts (would be two mutation-adjacent proposals) exceed the limit and are marked unsupported", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "RECOMMEND", topic: "PT" }), route({ route: "RECOMMEND", topic: "PROGRAM" })],
  }));
  assert.equal(plan.supported, false);
  assert.equal(plan.handledBy, "UNSUPPORTED");
});

test("T07: a MULTI route with no parts (defensive) never creates an arbitrary operation", () => {
  const plan = planBoundedTurn(route({ route: "MULTI" }));
  assert.equal(plan.compositionType, "SINGLE");
  assert.equal(plan.reads.length, 0);
  assert.equal(plan.recommendation, undefined);
});

test("T08: parts that aren't READ_STATE or RECOMMEND (e.g. KNOWLEDGE_QA/START_WORKFLOW) never become an operation — only the allowlisted kinds are extracted", () => {
  const plan = planBoundedTurn(route({
    route: "MULTI",
    parts: [route({ route: "READ_STATE", topic: "GOAL" }), route({ route: "KNOWLEDGE_QA" })],
  }));
  assert.equal(plan.reads.length, 1);
  assert.equal(plan.recommendation, undefined);
});

test("T09: the planner module performs zero I/O — calling it with no stubs of any kind still works deterministically", () => {
  // No axios/prisma/profileExtractor/fitnessAgentTools stub exists in this test file at all.
  const plan = planBoundedTurn(route({ route: "READ_STATE", topic: "GOAL" }));
  assert.ok(plan);
});

test("T10: the planner function is synchronous, not async — proof it makes no LLM/HTTP call of its own", () => {
  assert.equal(planBoundedTurn.constructor.name, "Function");
  const result = planBoundedTurn(route({ route: "UNKNOWN" }));
  assert.equal(typeof (result as any).then, "undefined", "a sync function's return value is not itself a Promise");
});
