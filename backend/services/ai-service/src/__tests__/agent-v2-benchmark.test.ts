/**
 * V2 Multi-Agent M5 — offline benchmark as a test. Hard invariants (cross-user, WRITE, critical safety, forecast / memory
 * promotion, deferred-intent disclosure, determinism) must hold; the routing TARGETS are reported, not asserted (a missed
 * target is published in docs/ai-v2/m5, never hidden by editing labels). The execution failure list is pinned: a NEW failure
 * fails this test. OFFLINE: mock models, synthetic fixtures, controllable clock, network blocked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ROUTING_CASES_V1, MULTI_TURN_CASES_V1 } from "./m5-benchmark/dataset-v1";
import { runM5Benchmark, KNOWN_EXECUTION_FAILURES_V1 } from "./m5-benchmark/run-benchmark";
import { QUALITY_GATES_V1 } from "./m5-benchmark/gates";
import { DEFAULT_EXECUTION_POLICY, SUPERVISOR_BUDGET } from "../agent-v2/supervisor";

let result: Awaited<ReturnType<typeof runM5Benchmark>>;
test.before(async () => { result = await runM5Benchmark(); });

test("M5-1 dataset v1: size, distribution, schema completeness, unique ids", () => {
  const n = (c: string) => ROUTING_CASES_V1.filter((x) => x.category === c).length;
  assert.equal(ROUTING_CASES_V1.length, 100);
  assert.deepEqual([n("SINGLE"), n("TWO"), n("MULTI"), n("OOS_AMBIGUOUS"), n("SAFETY")], [40, 25, 15, 10, 10]);
  assert.ok(MULTI_TURN_CASES_V1.length >= 10 && MULTI_TURN_CASES_V1.length <= 15);
  assert.equal(new Set(ROUTING_CASES_V1.map((c) => c.id)).size, ROUTING_CASES_V1.length);
  for (const c of ROUTING_CASES_V1) {
    assert.ok(c.q && c.rationale && c.primaryIntent && c.fixture && c.acceptable.length, c.id);
    assert.ok(c.acceptable.every((s) => s.length <= DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn), `${c.id}: acceptable sets respect the cap`);
    // ambiguous ownership cases (T11, R08, R09) accept an alternative single agent, so the primary is in at least one set
    if (c.primaryAgent) assert.ok(c.acceptable.some((s) => s.includes(c.primaryAgent!)), `${c.id}: primary in an acceptable set`);
    if (c.category === "MULTI") assert.ok(c.expectDeferred.length > 0 && c.coverage === "PARTIAL", c.id);
  }
  for (const k of ["synonym", "compound", "no_subject", "unaccented", "slang", "cap_pressure", "progress_vs_recovery"] as const) assert.ok(ROUTING_CASES_V1.some((c) => c.features.includes(k)), k);
});

test("M5-2 gates were declared before the run and the fixed limits were not changed", () => {
  assert.deepEqual(QUALITY_GATES_V1.map((g) => `${g.id}:${g.kind}:${g.op}${g.threshold}`), [
    "G1:HARD:==0", "G2:HARD:==0", "G3:HARD:==0", "G4:HARD:==0", "G5:HARD:==0", "G6:HARD:>=100", "G7:TARGET:>=90", "G8:TARGET:>=85", "G9:HARD:==0", "G10:HARD:==1",
  ]);
  assert.deepEqual({ ...SUPERVISOR_BUDGET }, { maxWallTimeMs: 60_000, maxModelCalls: 8, maxToolCalls: 6, maxInputTokens: 60_000, maxOutputTokens: 6_000, maxCostUsd: 0.08 });
  assert.equal(DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn, 2);
});

test("M5-3 hard invariants: zero cross-user leakage, WRITE, critical safety violation, forecast/memory promotion; network blocked", () => {
  const g = Object.fromEntries(result.gates.map((x) => [x.id, x]));
  for (const id of ["G1", "G2", "G3", "G4", "G5"]) assert.ok(g[id].pass, `${id}: ${g[id].description} = ${g[id].value}`);
  assert.equal(result.execution.counters.netCalls, 0);
  assert.ok(result.execution.assertions.length > 150, "benchmark actually executed");
});

test("M5-4 100% deferred-intent disclosure in every routing configuration", () => {
  for (const m of result.routing.metrics) {
    assert.ok(m.disclosure.deferredRuns > 0, `${m.config}: some deferrals happened`);
    assert.equal(m.disclosure.pct, 100, m.config);
  }
});

test("M5-5 execution failures are exactly the published list (no new failure)", () => {
  const failed = result.executionSummary.failed.map((a) => `${a.scenario}|${a.name}`).sort();
  assert.deepEqual(failed, [...KNOWN_EXECUTION_FAILURES_V1].sort());
  assert.ok(result.executionSummary.failed.every((a) => !a.critical));
});

test("M5-6 deterministic: two runs give identical scored results", () => {
  assert.equal(result.determinism.identical, true);
});

test("M5-7 budget held: no turn exceeded a budget dimension; at most 2 agents per turn", () => {
  assert.equal(result.executionSummary.perf.overrunTurns, 0);
  assert.ok(result.execution.turns.every((t) => t.selected.length <= 2 && t.modelCalls <= 8 && t.toolCalls <= 6 && t.estimatedCostUsd <= 0.08));
  for (const o of result.routing.outcomes) assert.ok(o.selected.length <= (o.config === "single-agent" ? 1 : 2), `${o.config}/${o.caseId}`);
});

test("M5-8 routing targets are REPORTED (not asserted); the M6 decision follows the gates", () => {
  const intent = result.routing.metrics.find((m) => m.config === "intent-v1")!;
  assert.ok(intent.primaryCoverage.d > 0 && intent.exactSetLe2.d > 0);
  assert.equal(result.m6Ready, result.gates.every((g) => g.pass));
});
