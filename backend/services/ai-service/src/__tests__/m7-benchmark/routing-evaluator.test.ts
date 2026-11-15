/**
 * M8-A4 routing evaluator tests. TEST FIXTURE only (synthetic "SYN-" data, fake models). OFFLINE: fetch and the Bedrock send are
 * blocked and counted. Nothing here is a G7 / G8 result.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bedrockRuntimeDeps } from "../../services/bedrock.client";
import { validateRoutingAnnotations } from "./annotation-validator";
import { reconcileOutcomes, parseOutcomesJsonl, outcomeProblems, type EvalOutcome } from "./routing-evaluator-outcomes";
import { createBudgetGuard, GuardedRoutingModel, assertOfflineModel, createFakeRoutingModel, estimateCall } from "./routing-evaluator-budget";
import { createDeterministicAdapter, createModelAlwaysAdapter, createHybridSelectiveAdapter, createReplayAdapter, runSystem, observeTurn } from "./routing-evaluator-adapters";
import { ratio, ratioMeets, gateVerdict, pctDisplay } from "./routing-evaluator-metrics";
import { evaluateDataset, evaluateRows, renderTextReport, SYNTHETIC_STAMP, type RoutingEvaluationReport } from "./routing-evaluator";
import { outcome, req, synRow, syntheticDatasetJsonl, syntheticModelAnswers, syntheticOutcomes, syntheticRows, toJsonl } from "./routing-evaluator-fixture";
import type { AnnotationRow } from "./annotation-schema";

let netCalls = 0;
const saved = { send: bedrockRuntimeDeps.send, fetch: globalThis.fetch };
test.before(() => {
  bedrockRuntimeDeps.send = (async () => { netCalls++; throw new Error("paid provider blocked"); }) as typeof bedrockRuntimeDeps.send;
  globalThis.fetch = (async () => { netCalls++; throw new Error("network blocked"); }) as typeof fetch;
});
test.after(() => { bedrockRuntimeDeps.send = saved.send; globalThis.fetch = saved.fetch; assert.equal(netCalls, 0, "no network / paid-provider call may happen"); });

const OPTS = { system: "TEST", validate: { checkDistribution: false, checkBenchmarkOverlap: true } } as const;
const ok = (r: ReturnType<typeof evaluateDataset>): RoutingEvaluationReport => { assert.equal(r.ok, true, JSON.stringify(r.ok ? "" : r.errors)); return (r as { report: RoutingEvaluationReport }).report; };
const IDS = ["SYN-1", "SYN-2", "SYN-3"];
const good = (id: string): EvalOutcome => outcome(id, ["training"]);

// ── outcome reconciliation ──────────────────────────────────────────────────────────────────────────────────────────
test("outcomes: exactly one per case passes", () => {
  const r = reconcileOutcomes(IDS, IDS.map(good));
  assert.equal(r.ok, true); assert.equal(r.byId.size, 3);
});
test("outcomes: missing / duplicate / unknown id / schema-invalid each get their OWN code", () => {
  const r = reconcileOutcomes(IDS, [good("SYN-1"), good("SYN-1"), good("SYN-9"), { id: "SYN-2", stage: "NOPE", selected: [], deferred: [], deferredDisclosed: [] }]);
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => `${e.code}:${e.id}`).sort();
  assert.deepEqual(codes, ["OUTCOME_DUPLICATE:SYN-1", "OUTCOME_MISSING:SYN-3", "OUTCOME_SCHEMA_INVALID:SYN-2", "OUTCOME_UNKNOWN_ID:SYN-9"]);
  assert.equal(r.byId.size, 0, "nothing is usable when any error exists");
});
test("outcomes: schema problems are strict", () => {
  const bad: unknown[] = [
    null, [], { ...good("a"), extra: 1 }, { ...good("a"), id: "" }, { ...good("a"), selected: ["swimming"] }, { ...good("a"), selected: ["training", "training"] },
    { ...good("a"), stage: "INPUT_SAFETY_BLOCK", selected: ["training"] }, { ...good("a"), deferred: ["training"] }, { ...good("a"), deferred: ["nutrition"], deferredDisclosed: ["recovery"] },
    { ...good("a"), usage: { modelCalls: -1, inputTokens: 0, outputTokens: 0, costUsd: 0 } }, { ...good("a"), usage: { modelCalls: 1 } },
  ];
  for (const b of bad) assert.ok(outcomeProblems(b).length > 0, JSON.stringify(b));
  assert.deepEqual(outcomeProblems(good("a")), []);
});
test("outcomes: malformed JSONL line -> OUTCOME_MALFORMED_JSON, refused", () => {
  const p = parseOutcomesJsonl(`${JSON.stringify(good("SYN-1"))}\n{not json\n`);
  assert.equal(p.errors[0].code, "OUTCOME_MALFORMED_JSON");
  const r = reconcileOutcomes(["SYN-1"], p.raw, p.errors);
  assert.equal(r.ok, false);
});

// ── dataset path (existing validator) ───────────────────────────────────────────────────────────────────────────────
test("fixture dataset passes the EXISTING m7-p5a2 validator (no distribution check)", () => {
  const v = validateRoutingAnnotations(syntheticDatasetJsonl(), { checkDistribution: false, checkBenchmarkOverlap: true });
  assert.deepEqual(v.errors, []);
  assert.equal(v.stats.cases, 15);
});
test("an invalid dataset is refused before any outcome is looked at", () => {
  const r = evaluateDataset(syntheticDatasetJsonl().replace('"m7-p5a2"', '"m7-p5a1"'), syntheticOutcomes(), OPTS);
  assert.equal(r.ok, false); assert.equal((r as { stage: string }).stage, "DATASET_INVALID");
});
test("evaluateDataset refuses bad outcome sets with OUTCOMES_INVALID", () => {
  const outs = syntheticOutcomes();
  const r = evaluateDataset(syntheticDatasetJsonl(), outs.slice(1), OPTS);
  assert.equal(r.ok, false); assert.equal((r as { stage: string }).stage, "OUTCOMES_INVALID");
  assert.equal((r as { errors: Array<{ code: string }> }).errors[0].code, "OUTCOME_MISSING");
});

// ── metrics on the synthetic fixture (numbers derived by hand from the fixture labels) ──────────────────────────────
test("fixture report: exact counts, G7 / G8 verdicts, safety kept separate, SYNTHETIC stamp", () => {
  const rep = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), OPTS));
  assert.equal(rep.stamp, SYNTHETIC_STAMP); assert.equal(rep.synthetic, true); assert.equal(rep.g7g8ResultClaimable, false);
  assert.equal(rep.routing.populations.routingScored, 11);
  assert.deepEqual(rep.routing.g7, ratio(8, 9)); assert.deepEqual(rep.routing.g8, ratio(8, 9));
  assert.equal(rep.gates.G7.verdict, "FAIL");   // 88.9 % < 90 %
  assert.equal(rep.gates.G8.verdict, "PASS");   // 88.9 % >= 85 %
  assert.deepEqual(rep.routing.requiredIntentCoverage, ratio(11, 13));
  assert.deepEqual(rep.routing.requiredIntentFullCases, ratio(7, 9));
  assert.deepEqual(rep.routing.primaryFirstCorrect, ratio(9, 10));
  assert.deepEqual(rep.deferredDisclosure.expectedDeferred, ratio(0, 1)); assert.equal(rep.deferredDisclosure.undisclosedDeferrals, 1);
  assert.deepEqual(rep.routing.oos.handled, ratio(1, 1));
  assert.equal(rep.routing.falsePositives.extraAgents, 1); assert.equal(rep.routing.falsePositives.casesWithExtra, 1);
  assert.deepEqual({ tp: rep.routing.perAgent.training.tp, fp: rep.routing.perAgent.training.fp, fn: rep.routing.perAgent.training.fn }, { tp: 5, fp: 1, fn: 0 });
  assert.deepEqual({ tp: rep.routing.perAgent.progress.tp, fp: rep.routing.perAgent.progress.fp, fn: rep.routing.perAgent.progress.fn }, { tp: 1, fp: 0, fn: 1 });
  assert.deepEqual(rep.routing.microF1, ratio(24, 26));
  assert.equal(rep.routing.byCategory.MULTI.routingScored, 1);
  assert.equal(rep.routing.longQuestionGroup.rows, 1);
  // safety section
  assert.deepEqual([rep.safety.preflight.safetyGate.pass, rep.safety.preflight.safetyGate.cases], [1, 1]);
  assert.deepEqual([rep.safety.preflight.oosPreflight.pass, rep.safety.preflight.oosPreflight.cases], [1, 1]);
  assert.deepEqual([rep.safety.preflight.validationGroup.pass, rep.safety.preflight.validationGroup.cases], [1, 1]);
  const sg = Object.fromEntries(rep.safety.gates.map((g) => [g.id, g.status]));
  assert.deepEqual(sg, { SG1: "NO_EVIDENCE", SG2: "PASS", SG3: "NO_EVIDENCE", SG4: "NO_EVIDENCE", SG5: "REPORTED" });
  assert.equal(rep.safety.hardGatesPass, false);
  const text = renderTextReport(rep);
  assert.ok(text.startsWith(`*** ${SYNTHETIC_STAMP} ***`) && text.trimEnd().endsWith(`*** ${SYNTHETIC_STAMP} ***`));
});
test("safety result never changes routing quality: an unsafe pass-through leaves G7/G8 untouched, a blocked ALLOW row is a miss in the denominator", () => {
  const base = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), OPTS));
  const outs = syntheticOutcomes().map((o) => (o.id === "SYN-0011" ? outcome("SYN-0011", ["nutrition"]) : o)); // expected SAFETY_BLOCK reached routing
  const r = ok(evaluateDataset(syntheticDatasetJsonl(), outs, OPTS));
  assert.deepEqual(r.routing.g7, base.routing.g7); assert.deepEqual(r.routing.g8, base.routing.g8);
  assert.equal(r.safety.gates.find((g) => g.id === "SG2")!.status, "FAIL");
  const blocked = syntheticOutcomes().map((o) => (o.id === "SYN-0001" ? { ...o, stage: "INPUT_SAFETY_BLOCK" as const, selected: [] } : o));
  const b = ok(evaluateDataset(syntheticDatasetJsonl(), blocked, OPTS));
  assert.deepEqual(b.routing.g7, ratio(7, 9)); assert.equal(b.safety.falsePositiveBlocks, 1);
});
test("NOT_EVALUABLE outcome or tripped budget -> INVALID_RUN (no verdict)", () => {
  const outs = syntheticOutcomes().map((o) => (o.id === "SYN-0001" ? { ...o, stage: "NOT_EVALUABLE" as const, selected: [] } : o));
  const r = ok(evaluateDataset(syntheticDatasetJsonl(), outs, OPTS));
  assert.equal(r.gates.G7.verdict, "INVALID_RUN"); assert.equal(r.run.valid, false);
  const g = createBudgetGuard({ maxCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsd: 1 });
  g.authorize({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
  const t = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), { ...OPTS, budget: g.snapshot() }));
  assert.equal(t.gates.G8.verdict, "INVALID_RUN");
});
test("no evidence: a dataset with no G7 / G8 population is NO_EVIDENCE, never PASS", () => {
  const rows = [synRow({ id: "SYN-OOS1", question: "Hôm nay trời mưa không", category: "OOS" })];
  const rep = evaluateRows(rows, new Map([["SYN-OOS1", outcome("SYN-OOS1", [])]]), { system: "T" });
  assert.equal(rep.gates.G7.verdict, "NO_EVIDENCE");
  assert.equal(rep.gates.G8.verdict, "PASS"); // OOS is in the G8 denominator (1/1)
});
test("SYN- ids force the synthetic stamp even if synthetic:false is passed", () => {
  const rep = evaluateRows(syntheticRows(), new Map(syntheticOutcomes().map((o) => [o.id, o])), { system: "T", synthetic: false });
  assert.equal(rep.synthetic, true);
});

// ── G7 / G8 on RAW ratios: boundary tests where rounding would mislead ──────────────────────────────────────────────
test("ratioMeets: integer cross-multiplication at/just-below/just-above the thresholds", () => {
  const t90 = ratio(90, 100), t85 = ratio(85, 100);
  assert.equal(ratioMeets(ratio(8999, 10000), t90), false); assert.equal(ratioMeets(ratio(9000, 10000), t90), true); assert.equal(ratioMeets(ratio(9001, 10000), t90), true);
  assert.equal(ratioMeets(ratio(8499, 10000), t85), false); assert.equal(ratioMeets(ratio(8500, 10000), t85), true); assert.equal(ratioMeets(ratio(8501, 10000), t85), true);
  assert.equal(ratioMeets(ratio(9, 10), t90), true); assert.equal(ratioMeets(ratio(0, 0), t90), false);
  // a rounding trap: 89.95 % displays as 90.0 % but is below 90 %
  assert.equal(pctDisplay(ratio(1799, 2000)), "90.0%"); assert.equal(ratioMeets(ratio(1799, 2000), t90), false);
  assert.equal(pctDisplay(ratio(849, 1000)), "84.9%"); assert.equal(ratioMeets(ratio(849, 1000), t85), false);
  assert.equal(gateVerdict("G7", ratio(1799, 2000), t90, true).verdict, "FAIL");
});
function bulk(n: number, hits: number): { rows: AnnotationRow[]; byId: Map<string, EvalOutcome> } {
  const rows: AnnotationRow[] = []; const byId = new Map<string, EvalOutcome>();
  for (let i = 0; i < n; i++) {
    const id = `SYN-B${String(i).padStart(5, "0")}`;
    rows.push(synRow({ id, question: `câu hỏi tổng hợp số ${i}`, category: "SINGLE", domains: [req("training")], primary: "training" }));
    byId.set(id, outcome(id, i < hits ? ["training"] : ["nutrition"]));
  }
  return { rows, byId };
}
test("G7 boundary through the evaluator: 899 / 900 / 901 of 1000 (and the rounding trap 1799/2000)", () => {
  for (const [hits, verdict] of [[899, "FAIL"], [900, "PASS"], [901, "PASS"]] as const) {
    const { rows, byId } = bulk(1000, hits);
    const g = evaluateRows(rows, byId, { system: "T" }).gates.G7;
    assert.deepEqual(g.ratio, ratio(hits, 1000)); assert.equal(g.verdict, verdict, `G7 ${hits}/1000`);
  }
  const { rows, byId } = bulk(2000, 1799);
  const g = evaluateRows(rows, byId, { system: "T" }).gates.G7;
  assert.equal(g.display, "90.0%"); assert.equal(g.verdict, "FAIL");
});
test("G8 boundary through the evaluator: 849 / 850 / 851 of 1000", () => {
  for (const [hits, verdict] of [[849, "FAIL"], [850, "PASS"], [851, "PASS"]] as const) {
    const { rows, byId } = bulk(1000, hits);
    const g = evaluateRows(rows, byId, { system: "T" }).gates.G8;
    assert.deepEqual(g.ratio, ratio(hits, 1000)); assert.equal(g.verdict, verdict, `G8 ${hits}/1000`);
  }
});
test("thresholds are parametrised (flag F4)", () => {
  const { rows, byId } = bulk(1000, 920);
  const r = evaluateRows(rows, byId, { system: "T", thresholds: { g7: ratio(95, 100), g8: ratio(90, 100) } });
  assert.equal(r.gates.G7.verdict, "FAIL"); assert.equal(r.gates.G8.verdict, "PASS");
});

// ── budget guard ────────────────────────────────────────────────────────────────────────────────────────────────────
test("budget guard is fail-closed: invalid limits throw, first denial trips permanently", () => {
  for (const bad of [null, {}, { maxCalls: NaN, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsd: 1 }, { maxCalls: -1, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsd: 1 }, { maxCalls: 1, maxInputTokens: 1, maxOutputTokens: 1 }]) {
    assert.throws(() => createBudgetGuard(bad as never), /BUDGET_INVALID_LIMITS/);
  }
  const g = createBudgetGuard({ maxCalls: 2, maxInputTokens: 1000, maxOutputTokens: 100, maxCostUsd: 1 });
  const e = { inputTokens: 100, outputTokens: 10, costUsd: 0.0001 };
  assert.equal(g.authorize(e).allowed, true); assert.equal(g.authorize(e).allowed, true);
  assert.deepEqual(g.authorize(e), { allowed: false, reason: "MAX_CALLS" });
  assert.deepEqual(g.authorize({ inputTokens: 0, outputTokens: 0, costUsd: 0 }), { allowed: false, reason: "BUDGET_TRIPPED" });
  assert.equal(g.snapshot().tripped, true);
});
test("budget guard: token / cost ceilings and bad estimates", () => {
  assert.deepEqual(createBudgetGuard({ maxCalls: 9, maxInputTokens: 50, maxOutputTokens: 9, maxCostUsd: 1 }).authorize({ inputTokens: 51, outputTokens: 1, costUsd: 0 }), { allowed: false, reason: "MAX_INPUT_TOKENS" });
  assert.deepEqual(createBudgetGuard({ maxCalls: 9, maxInputTokens: 50, maxOutputTokens: 9, maxCostUsd: 1 }).authorize({ inputTokens: 1, outputTokens: 10, costUsd: 0 }), { allowed: false, reason: "MAX_OUTPUT_TOKENS" });
  assert.deepEqual(createBudgetGuard({ maxCalls: 9, maxInputTokens: 50, maxOutputTokens: 9, maxCostUsd: 0.001 }).authorize({ inputTokens: 1, outputTokens: 1, costUsd: 0.0010001 }), { allowed: false, reason: "MAX_COST" });
  assert.equal(createBudgetGuard({ maxCalls: 9, maxInputTokens: 50, maxOutputTokens: 9, maxCostUsd: 0.001 }).authorize({ inputTokens: 1, outputTokens: 1, costUsd: 0.001 }).allowed, true);
  assert.deepEqual(createBudgetGuard({ maxCalls: 9, maxInputTokens: 50, maxOutputTokens: 9, maxCostUsd: 1 }).authorize({ inputTokens: NaN, outputTokens: 1, costUsd: 0 }), { allowed: false, reason: "INVALID_ESTIMATE" });
  // settle: actual usage above the limit trips the guard
  const g = createBudgetGuard({ maxCalls: 9, maxInputTokens: 100, maxOutputTokens: 9, maxCostUsd: 1 });
  const est = { inputTokens: 10, outputTokens: 1, costUsd: 0 };
  g.authorize(est); g.settle(est, { inputTokens: 500, outputTokens: 1, costUsd: 0 });
  assert.equal(g.snapshot().trippedReason, "MAX_INPUT_TOKENS");
});
test("guarded model: a denied call never reaches the inner model; a live-looking model id is refused", async () => {
  const inner = createFakeRoutingModel(new Map());
  const guard = createBudgetGuard({ maxCalls: 1, maxInputTokens: 100000, maxOutputTokens: 1000, maxCostUsd: 1 });
  const gm = new GuardedRoutingModel(inner, guard);
  const rq = { system: "s", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: JSON.stringify({ question: "q" }) }] }], tools: [], maxOutputTokens: 40, temperature: 0, signal: new AbortController().signal };
  await gm.converse(rq);
  await assert.rejects(() => gm.converse(rq), /BUDGET_GUARD_DENIED:MAX_CALLS/);
  assert.equal(inner.calls(), 1);
  assert.throws(() => assertOfflineModel({ modelId: "apac.amazon.nova-pro-v1:0" }), /LIVE_MODEL_REFUSED/);
  assert.throws(() => new GuardedRoutingModel({ modelId: "bedrock-nova", supportsCancellation: false, converse: async () => { throw new Error("x"); } }, guard), /LIVE_MODEL_REFUSED/);
  assert.throws(() => createModelAlwaysAdapter({ model: inner } as never), /BUDGET_GUARD_REQUIRED/);
  assert.ok(estimateCall(rq).costUsd > 0);
});

// ── adapters (OFFLINE: real supervisor with stub runners, fake models) ──────────────────────────────────────────────
const CASES = syntheticRows().slice(0, 13).map((r) => ({ id: r.id, question: r.question }));
test("adapter A (deterministic): no model, schema-valid outcomes, one per case", async () => {
  const a = createDeterministicAdapter();
  assert.equal(a.usesModel, false);
  const outs = await runSystem(a, CASES);
  assert.equal(reconcileOutcomes(CASES.map((c) => c.id), outs).ok, true);
  const o1 = await observeTurn("SYN-0001", CASES[0].question, (await import("../../agent-v2/routing-planner")).createIntentDecisionProvider({ maxAgents: 2 }));
  assert.equal(o1.stage, "REACHED_ROUTING");
});
test("adapter B (model always, FAKE): one guarded call per routable case, usage recorded", async () => {
  const model = createFakeRoutingModel(syntheticModelAnswers());
  const guard = createBudgetGuard({ maxCalls: 1000, maxInputTokens: 1_000_000, maxOutputTokens: 100_000, maxCostUsd: 5 });
  const b = createModelAlwaysAdapter({ model, guard });
  const outs = await runSystem(b, CASES);
  assert.equal(reconcileOutcomes(CASES.map((c) => c.id), outs).ok, true);
  const first = outs[0];
  assert.deepEqual(first.selected, ["training"]); assert.equal(first.usage?.modelCalls, 1);
  assert.equal(model.calls(), guard.snapshot().calls);
  assert.equal(guard.snapshot().tripped, false);
});
test("adapter C (hybrid selective, FAKE) never calls the model more often than B on the same cases", async () => {
  const mk = () => ({ model: createFakeRoutingModel(syntheticModelAnswers()), guard: createBudgetGuard({ maxCalls: 1000, maxInputTokens: 1_000_000, maxOutputTokens: 100_000, maxCostUsd: 5 }) });
  const mb = mk(), mc = mk();
  await runSystem(createModelAlwaysAdapter(mb), CASES); await runSystem(createHybridSelectiveAdapter(mc), CASES);
  assert.ok(mc.model.calls() <= mb.model.calls(), `C ${mc.model.calls()} vs B ${mb.model.calls()}`);
});
test("a model-backed run that exhausts its budget is flagged INVALID_RUN end to end", async () => {
  const model = createFakeRoutingModel(syntheticModelAnswers());
  const guard = createBudgetGuard({ maxCalls: 1, maxInputTokens: 1_000_000, maxOutputTokens: 100_000, maxCostUsd: 5 });
  const b = createModelAlwaysAdapter({ model, guard });
  const outs = await runSystem(b, CASES.slice(0, 3));
  assert.equal(model.calls(), 1, "the guard stopped every call after the first");
  assert.equal(guard.snapshot().tripped, true);
  const rows = syntheticRows().slice(0, 3);
  const rep = evaluateRows(rows, new Map(outs.map((o) => [o.id, o])), { system: "B", budget: guard.snapshot() });
  assert.equal(rep.gates.G7.verdict, "INVALID_RUN"); assert.ok((rep.budget?.denied ?? 0) >= 1);
});
test("replay adapter returns recorded outcomes and fails loudly on a missing id", async () => {
  const rec = new Map(syntheticOutcomes().map((o) => [o.id, o]));
  const a = createReplayAdapter(rec);
  assert.deepEqual((await a.route({ id: "SYN-0001", question: "x" })).selected, ["training"]);
  await assert.rejects(() => a.route({ id: "SYN-XXXX", question: "x" }), /REPLAY_MISSING/);
});
test("report JSON round-trips and carries the stamp", () => {
  const rep = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), OPTS));
  const back = JSON.parse(JSON.stringify(rep)) as RoutingEvaluationReport;
  assert.equal(back.stamp, SYNTHETIC_STAMP); assert.equal(toJsonl(syntheticRows()).length > 0, true);
});
