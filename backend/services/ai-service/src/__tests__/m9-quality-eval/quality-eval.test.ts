/**
 * M9.4-T1 — AI Coach V1 vs Multi-Agent V2: paired SYNTHETIC evaluation (offline, mock dependencies, no live model, no real data).
 * Run:  FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/m9-quality-eval/quality-eval.test.ts
 * Print the metric table:  M9_EVAL_PRINT=1 FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/m9-quality-eval/quality-eval.test.ts
 *
 * What this proves: deterministic code behaviour of both engines on identical facts (routing, eligibility, data reachability, guards, safety,
 * access, affinity). What it does NOT prove: ANSWER QUALITY (every model is a script) — see docs/ai-v2/coach-integration/M9-QUALITY-EVALUATION.md.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CASES, CASE_COUNT, MARKERS, type MarkerKey } from "./cases";
import { createRunner, type RunResult } from "./runner";
import { checksFor, evaluateAll, summarize, type CaseEval } from "./evaluate";

let ev: CaseEval[] = [];
let results: RunResult[] = [];
let runner: Awaited<ReturnType<typeof createRunner>>;
let parity: Record<MarkerKey, { v2: boolean; v1: boolean }>;

test.before(async () => {
  runner = await createRunner();
  parity = await runner.fixtureParity();
  results = await runner.runAll();
  ev = evaluateAll(results);
});
test.after(() => runner?.close());

test("QE-1 the suite is 45 synthetic cases (40 of M9.4-T1 + 5 weight-grounding cases of M9.4-T2) over the 7 required groups, with unique ids and a ground-truth statement each", () => {
  assert.equal(CASE_COUNT, 45);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 45);
  assert.deepEqual([...new Set(CASES.map((c) => c.group))].sort(), ["multi", "nutrition", "progress", "recovery", "safety", "training", "v1only"]);
  for (const c of CASES) { assert.ok(c.truth.length > 20, c.id); assert.ok(c.expect.routeBasis && (c.expect.v2?.basis ?? c.expect.v1?.basis), `${c.id} has a basis`); }
  // required situations are present
  const has = (f: (c: (typeof CASES)[number]) => boolean) => assert.ok(CASES.some(f));
  has((c) => c.world?.body === "absent"); has((c) => c.world?.body === "stale"); has((c) => c.world?.history === "error"); has((c) => c.sessionState === "v1_existing");
  has((c) => c.sessionState === undefined || c.sessionState === "new"); has((c) => c.otherUsersSession === true); has((c) => c.allowlisted === false); has((c) => c.user === "M"); has((c) => c.user === "U");
  has((c) => c.group === "multi" && (c.expect.v2?.deferred ?? false));
});

test("QE-2 FIXTURE PARITY: every marker fact exists in BOTH fixture channels (V2 world deps and V1 HTTP fixture) — neither side is handed data the other lacks", () => {
  for (const k of Object.keys(MARKERS) as MarkerKey[]) { assert.equal(parity[k].v2, true, `V2 channel lacks ${k}`); assert.equal(parity[k].v1, true, `V1 channel lacks ${k}`); }
});

test("QE-3 every case ran on both engines through the real app: V1's real chain was entered for the V1 run, V2's runtime only for V2-routed requests", () => {
  for (const r of results) {
    assert.equal(r.v1run.ragEntered, true, `${r.id}: V1 real chain entered`);
    const c = CASES.find((x) => x.id === r.id)!;
    if (c.expect.route === "V2" && c.expect.http === undefined) assert.equal(r.v2run.v1Entered, false, `${r.id}: a V2-served request never entered V1`);
  }
  assert.equal(results.length, 45);
});

test("QE-4 every expectation holds, except the DECLARED known gaps; and every declared gap still fails (a fix would be noticed)", () => {
  const bad = ev.filter((x) => x.unexpectedFailures.length || x.missedKnownGaps.length).map((x) => `${x.c.id}: unexpected=[${x.unexpectedFailures}] missedKnownGaps=[${x.missedKnownGaps}] ${x.checks.filter((k) => !k.pass).map((k) => `${k.name}(${k.detail})`).join("; ")}`);
  assert.deepEqual(bad, []);
});

test("QE-5 SAFETY INVARIANTS across all 45 cases: no V2 write reached a dep; a blocked V2 outcome never fell back to V1; blocked turns are not written to history; ≤ 2 agents", () => {
  for (const x of ev) {
    const a = x.r.v2run;
    assert.deepEqual(a.writes, [], `${x.c.id}: no WRITE reached any dep`);
    assert.ok(a.agents.length <= 2, `${x.c.id}: ≤ 2 agents`);
    if (a.handledBy === "V2" && ["SAFETY_BLOCKED", "MINOR_PROTECTED", "PROFILE_UNVERIFIED"].includes(a.status)) { assert.equal(a.v1Entered, false, `${x.c.id}: no fallback to V1 after a V2 block`); assert.equal(a.historyTurns, 0, `${x.c.id}: blocked turn not persisted`); assert.deepEqual(a.agents, [], `${x.c.id}: no agent ran`); }
  }
});

test("QE-6 no external call: fetch / Bedrock never used; every V1 HTTP read went to the two internal .invalid service hosts through the fake transport", () => {
  assert.equal(runner.trip.fetch, 0); assert.equal(runner.trip.bedrock, 0);
  assert.deepEqual([...runner.trip.v1HttpHosts].sort(), ["fitness-service.m9eval.invalid", "user-service.m9eval.invalid"]);
});

test("QE-7 the checks are not vacuous: a mutated result makes them fail", () => {
  const t01 = results.find((r) => r.id === "T01")!; const c = CASES.find((x) => x.id === "T01")!;
  assert.equal(checksFor(c, t01).every((k) => k.pass), true);
  const mut = (f: (r: RunResult) => void) => { const copy = structuredClone(t01); f(copy); return checksFor(c, copy).filter((k) => !k.pass).map((k) => k.name); };
  assert.ok(mut((r) => { r.v2run.agents = ["nutrition"]; }).includes("v2-agents"));
  assert.ok(mut((r) => { r.v2run.status = "PARTIAL"; }).includes("v2-status"));
  assert.ok(mut((r) => { r.v2run.writes = ["WRITE:x"]; }).includes("v2-no-write"));
  assert.ok(mut((r) => { r.v2run.markersVisible = []; }).includes("v2-markers-visible"));
  assert.ok(mut((r) => { r.v1run.answer = "không có gì"; }).includes("v1-answer-has:Leg day"));
  const s05 = results.find((r) => r.id === "S05")!; const c5 = CASES.find((x) => x.id === "S05")!;
  const cp = structuredClone(s05); cp.v2run.answer = "dữ liệu của người khác"; assert.ok(checksFor(c5, cp).filter((k) => !k.pass).map((k) => k.name).includes("no-cross-user"));
});

test("QE-8 metrics are computed with explicit denominators, NOT_EVALUABLE where a real model would be needed, and no production threshold is applied", () => {
  const s = summarize(ev);
  if (process.env.M9_EVAL_PRINT === "1") {
    console.log("M9_EVAL_JSON " + JSON.stringify({ cases: s.cases, comparable: s.comparable, metrics: s.metrics, perCapability: s.perCapability,
      perCase: ev.map((x) => ({ id: x.c.id, group: x.c.group, route: x.c.expect.route, v2: { by: x.r.v2run.handledBy, status: x.r.v2run.status, agents: x.r.v2run.agents, tools: x.r.v2run.toolsOk, vis: x.r.v2run.markersVisible, mc: x.r.v2run.modelCalls }, v1: { http: x.r.v1run.http, llm: x.r.v1run.llmCalls, reads: x.r.v1run.readPaths.length, prompt: x.r.v1run.markersInPrompt }, failed: x.failed, comparable: x.c.comparable !== false })) }));
  }
  assert.equal(s.cases, 45); assert.equal(s.comparable, 44, "T07 is excluded: its fixtures are not equivalent");
  assert.deepEqual(s.metrics.map((m) => m.id), ["M1", "M2a", "M2b", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"]);
  for (const m of s.metrics) { assert.ok(m.denominator && m.rule && m.evidence, m.id); assert.doesNotMatch(JSON.stringify(m), /threshold|PASS|G7|G8/i, `${m.id}: no threshold / official-gate claim`); }
  assert.ok(s.metrics.find((m) => m.id === "M6")!.v1.startsWith("NOT_EVALUABLE"));
  assert.ok(s.metrics.find((m) => m.id === "M10")!.notEvaluable);
});
