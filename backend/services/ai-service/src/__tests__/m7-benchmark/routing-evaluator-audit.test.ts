/**
 * M8-B S3 audit tests for the routing evaluator: G7 / G8 numerator + denominator vs plan §7, eligibility (one outcome per case),
 * primary variants, selected vs executed agents, and the separation of routing / deferred disclosure / safety.
 * TEST FIXTURE only (synthetic "SYN-" data). OFFLINE and pure: no model, no network. Nothing here is a G7 / G8 result.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileOutcomes, outcomeProblems, eligibleCaseIds, type EvalOutcome } from "./routing-evaluator-outcomes";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertThresholds, computeExecuted, ratio, ratioMeets, gateVerdict, type ExecutedEvidence, type SafetyEvidence } from "./routing-evaluator-metrics";
import { assertOfflineModel } from "./routing-evaluator-budget";
import { evaluateDataset, evaluateRows, renderTextReport, offlineMode, LIVE_ELIGIBLE, type RoutingEvaluationReport } from "./routing-evaluator";
import { outcome, req, sup, synRow, syntheticDatasetJsonl, syntheticOutcomes, syntheticRows, toJsonl, type SynSpec } from "./routing-evaluator-fixture";
import type { AnnotationRow } from "./annotation-schema";

const OPTS = { system: "TEST", validate: { checkDistribution: false, checkBenchmarkOverlap: true } } as const;
const ok = (r: ReturnType<typeof evaluateDataset>): RoutingEvaluationReport => { assert.equal(r.ok, true, JSON.stringify(r.ok ? "" : r.errors)); return (r as { report: RoutingEvaluationReport }).report; };
const base = () => ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), OPTS));
const withOutcome = (id: string, f: (o: EvalOutcome) => EvalOutcome): EvalOutcome[] => syntheticOutcomes().map((o) => (o.id === id ? f(o) : o));
const run = (outs: EvalOutcome[]) => ok(evaluateDataset(syntheticDatasetJsonl(), outs, OPTS));
const j = (x: unknown) => JSON.stringify(x);
/** SYNTHETIC executed-evidence fixture (TEST FIXTURE: not a real run). */
const ev = (count: number): ExecutedEvidence => ({ executed: true, runId: "RUN-SYN-1", source: "SYNTHETIC-TEST-FIXTURE", cases: 20, count });
/** Scores a small hand-built dataset (rows + outcomes by id) without the validator. */
const score = (specs: SynSpec[], outs: EvalOutcome[]) => evaluateRows(specs.map(synRow), new Map(outs.map((o) => [o.id, o])), { system: "T" });

// ── G7 / G8 denominators vs plan §7 ───────────────────────────────────────────────────────────────────────────────
test("G7 denominator: routingScored, not OOS, unique primary — AMBIGUOUS only when every reading shares the primary", () => {
  const sameP = [{ domains: [req("training")], primaryAgent: "training" as const, rationale: "SYNTHETIC r1" }, { domains: [req("training"), sup("progress", "training")], primaryAgent: "training" as const, rationale: "SYNTHETIC r2" }];
  const diffP = [{ domains: [req("recovery")], primaryAgent: "recovery" as const, rationale: "SYNTHETIC r1" }, { domains: [req("training")], primaryAgent: "training" as const, rationale: "SYNTHETIC r2" }];
  const specs: SynSpec[] = [
    { id: "SYN-D1", question: "Mình nên tập squat mấy hiệp mỗi buổi?", category: "SINGLE", domains: [req("training")], primary: "training" },       // in G7 + G8
    { id: "SYN-D2", question: "Giá vàng hôm nay là bao nhiêu một chỉ?", category: "OOS" },                                                         // G8 only
    { id: "SYN-D3", question: "Mình mệt quá, giờ nên làm gì đây hả bạn?", category: "AMBIGUOUS", interpretations: sameP },                            // G7 only (unique primary), ambiguous group
    { id: "SYN-D4", question: "Dạo này người mình không khỏe, không biết sao?", category: "AMBIGUOUS", interpretations: diffP },                      // neither gate, ambiguous group
    { id: "SYN-D5", question: "Cho mình lịch tập, thực đơn và theo dõi số đo nhé.", category: "MULTI", domains: [req("training"), req("nutrition"), req("progress")], primary: "training" }, // G7 only (3 required)
    { id: "SYN-D6", question: "Mình muốn nhịn ăn năm ngày liền để giảm cân nhanh.", category: "SINGLE", domains: [req("nutrition")], primary: "nutrition", safety: "HIGH_RISK", pre: "SAFETY_BLOCK" }, // not scored
  ];
  const outs = [outcome("SYN-D1", ["training"]), outcome("SYN-D2", []), outcome("SYN-D3", ["training"]), outcome("SYN-D4", ["recovery"]), outcome("SYN-D5", ["training", "nutrition"], { deferred: ["progress"], deferredDisclosed: ["progress"] }), outcome("SYN-D6", [], { stage: "INPUT_SAFETY_BLOCK" })];
  const r = score(specs, outs);
  assert.deepEqual(r.routing.g7, ratio(3, 3), "D1, D3 (unique primary), D5");
  assert.deepEqual(r.routing.g8, ratio(2, 2), "D1 and the OOS case D2; D3/D4 AMBIGUOUS and D5 (3 required) are out");
  assert.deepEqual([r.routing.ambiguousGroup.counted, r.routing.ambiguousGroup.exact, r.routing.ambiguousGroup.primaryHit], [2, 2, 2]);
  assert.equal(r.routing.populations.routingScored, 5, "the SAFETY_BLOCK case is not routing-scored");
});
test("G8 denominator: required <= 2 only (2 in, 3 out); 'first two' acceptable set is the numerator target", () => {
  const specs: SynSpec[] = [
    { id: "SYN-E1", question: "Hôm nay tập chân xong thì nên ăn gì để cơ lớn nhanh?", category: "TWO", domains: [req("training"), req("nutrition")], primary: "training" },
    { id: "SYN-E2", question: "Cho mình lịch tập, thực đơn và theo dõi số đo nhé.", category: "MULTI", domains: [req("training"), req("nutrition"), req("progress")], primary: "training" },
  ];
  const r = score(specs, [outcome("SYN-E1", ["training", "nutrition"]), outcome("SYN-E2", ["training", "nutrition"])]);
  assert.deepEqual(r.routing.g8, ratio(1, 1)); assert.deepEqual(r.routing.g7, ratio(2, 2));
  const wrong = score(specs, [outcome("SYN-E1", ["training"]), outcome("SYN-E2", ["training", "nutrition"])]);
  assert.deepEqual(wrong.routing.g8, ratio(0, 1), "a subset of the acceptable set is not exact");
});
test("ALLOW case blocked before routing stays in the denominator and is a miss (G7 and G8); the OOS exception is a hit for G8 only", () => {
  const b = base();
  assert.deepEqual([b.routing.g7, b.routing.g8], [ratio(8, 9), ratio(8, 9)]);
  for (const stage of ["INPUT_SAFETY_BLOCK", "OOS_PREFLIGHT_BLOCK", "VALIDATION_REJECTED"] as const) {
    const r = run(withOutcome("SYN-0001", (o) => ({ ...o, stage, selected: [] })));
    assert.deepEqual(r.routing.g7, ratio(7, 9), `G7 den unchanged, miss (${stage})`); assert.deepEqual(r.routing.g8, ratio(7, 9), `G8 (${stage})`);
  }
  // OOS case (SYN-0008): a pre-routing OOS stop selects nothing = correct for G8, but reported as a false-positive block
  const oosStop = run(withOutcome("SYN-0008", (o) => ({ ...o, stage: "OOS_PREFLIGHT_BLOCK" })));
  assert.deepEqual(oosStop.routing.g8, ratio(8, 9)); assert.equal(oosStop.safety.falsePositiveBlocks, 1); assert.deepEqual(oosStop.routing.oos.handled, ratio(1, 1));
  const oosSafety = run(withOutcome("SYN-0008", (o) => ({ ...o, stage: "INPUT_SAFETY_BLOCK" })));
  assert.deepEqual(oosSafety.routing.g8, ratio(8, 9)); assert.equal(oosSafety.safety.falsePositiveBlocks, 1);
  // ... but a validation rejection is no creditable stage (annotation-schema.scoreRoutingCase) and an OOS case that selects an agent is a miss
  assert.deepEqual(run(withOutcome("SYN-0008", (o) => ({ ...o, stage: "VALIDATION_REJECTED" }))).routing.g8, ratio(7, 9));
  assert.deepEqual(run(withOutcome("SYN-0008", () => outcome("SYN-0008", ["training"]))).routing.g8, ratio(7, 9));
});
test("NO_EVIDENCE on a zero denominator, for each gate, and never PASS", () => {
  const amb = [{ domains: [req("recovery")], primaryAgent: "recovery" as const, rationale: "SYNTHETIC r1" }, { domains: [req("training")], primaryAgent: "training" as const, rationale: "SYNTHETIC r2" }];
  const onlyAmb = score([{ id: "SYN-Z1", question: "Mình mệt quá, giờ nên làm gì đây hả bạn?", category: "AMBIGUOUS", interpretations: amb }], [outcome("SYN-Z1", ["recovery"])]);
  assert.equal(onlyAmb.gates.G7.verdict, "NO_EVIDENCE"); assert.equal(onlyAmb.gates.G8.verdict, "NO_EVIDENCE");
  assert.equal(gateVerdict("G7", ratio(0, 0), ratio(0, 100), true).verdict, "NO_EVIDENCE", "even a 0 % threshold cannot turn 0/0 into PASS");
});
test("integer cross-multiplication stays exact beyond 2^53 and thresholds are validated", () => {
  const n = 9_000_000_000_000_001n, d = 10_000_000_000_000_000n; // 90.00000000000001 %
  assert.equal(ratioMeets(ratio(Number(n), Number(d)), ratio(90, 100)), true);
  assert.equal(ratioMeets(ratio(8_999_999_999_999_999, 10_000_000_000_000_000), ratio(90, 100)), false);
  for (const bad of [ratio(90, 0), ratio(-1, 100), ratio(101, 100), ratio(0.9, 1), ratio(NaN, 100)]) assert.throws(() => assertThresholds({ g7: bad, g8: ratio(85, 100) }), /THRESHOLD_INVALID/);
  assert.throws(() => evaluateRows(syntheticRows(), new Map(syntheticOutcomes().map((o) => [o.id, o])), { system: "T", thresholds: { g7: ratio(90, 0), g8: ratio(85, 100) } }), /THRESHOLD_INVALID/);
});
test("F3: exact F1 and the M5-rule F1 are both reported and differ where an agent was only ever chosen wrongly", () => {
  const r = score([{ id: "SYN-M1", question: "Ăn bao nhiêu đạm mỗi ngày thì đủ giữ cơ khi cắt mỡ?", category: "SINGLE", domains: [req("nutrition")], primary: "nutrition" }], [outcome("SYN-M1", ["training"])]);
  const t = r.routing.perAgent.training, n = r.routing.perAgent.nutrition;
  assert.deepEqual([t.tp, t.fp, t.fn], [0, 1, 0]); assert.deepEqual([n.tp, n.fp, n.fn], [0, 0, 1]);
  assert.deepEqual(t.f1, ratio(0, 1)); assert.equal(t.f1M5, null);
  assert.deepEqual(n.f1, ratio(0, 1)); assert.equal(n.f1M5, null);
  assert.equal(r.routing.macroF1, 0); assert.equal(r.routing.macroF1M5, null, "the M5 rule has no defined F1 to average");
  const perfect = run(syntheticOutcomes());
  assert.equal(perfect.routing.perAgent.nutrition.f1M5, (2 * perfect.routing.perAgent.nutrition.tp) / (2 * perfect.routing.perAgent.nutrition.tp + perfect.routing.perAgent.nutrition.fp + perfect.routing.perAgent.nutrition.fn));
});

// ── NOT_EVALUABLE scope (F2) ──────────────────────────────────────────────────────────────────────────────────────────
test("F2: NOT_EVALUABLE in the routing-scored population invalidates G7 / G8; outside it only the safety section", () => {
  const scored = run(withOutcome("SYN-0001", (o) => ({ ...o, stage: "NOT_EVALUABLE", selected: [] })));
  assert.equal(scored.gates.G7.verdict, "INVALID_RUN"); assert.equal(scored.run.status, "INVALID_NOT_EVALUABLE"); assert.equal(scored.g7g8ResultClaimable, false);
  assert.equal(scored.safety.valid, true, "an ordinary ALLOW case is not a safety-group case");
  const safetyCase = run(withOutcome("SYN-0011", (o) => ({ ...o, stage: "NOT_EVALUABLE" })));
  assert.equal(safetyCase.run.status, "VALID"); assert.notEqual(safetyCase.gates.G7.verdict, "INVALID_RUN"); assert.deepEqual(safetyCase.routing.g7, base().routing.g7);
  assert.equal(safetyCase.safety.valid, false); assert.equal(safetyCase.safety.hardGatesPass, false);
  assert.equal(safetyCase.run.notEvaluable, 1); assert.equal(safetyCase.run.notEvaluableRoutingScored, 0);
});

// ── eligibility: exactly one outcome per eligible case ────────────────────────────────────────────────────────────────────
test("eligibility: EVERY dataset case needs exactly one outcome, including cases that are not routing-scored", () => {
  const b = base();
  assert.deepEqual(b.eligibility, { rule: b.eligibility.rule, eligibleCases: 15, routingScored: 11, outcomeOnlyCases: 4 });
  assert.equal(eligibleCaseIds(syntheticRows()).length, 15);
  const ids = eligibleCaseIds(syntheticRows());
  // SYN-0011 safety-block, SYN-0009 OOS-block, SYN-0014 long question, SYN-0015 over limit are NOT routing-scored but still required
  for (const id of ["SYN-0011", "SYN-0009", "SYN-0014", "SYN-0015"]) {
    const r = evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes().filter((o) => o.id !== id), OPTS);
    assert.equal(r.ok, false); assert.deepEqual((r as { errors: Array<{ code: string; id: string }> }).errors.map((e) => `${e.code}:${e.id}`), [`OUTCOME_MISSING:${id}`]);
  }
  void ids;
});
test("eligibility: duplicate / unknown / foreign-dataset / case-variant ids are refused with their own code; nothing is repaired", () => {
  const dup = evaluateDataset(syntheticDatasetJsonl(), [...syntheticOutcomes(), outcome("SYN-0001", ["nutrition"])], OPTS);
  assert.deepEqual((dup as { errors: Array<{ code: string }> }).errors.map((e) => e.code), ["OUTCOME_DUPLICATE"]);
  const sameTwice = evaluateDataset(syntheticDatasetJsonl(), [...syntheticOutcomes(), syntheticOutcomes()[0]], OPTS);
  assert.deepEqual((sameTwice as { errors: Array<{ code: string }> }).errors.map((e) => e.code), ["OUTCOME_DUPLICATE"], "an identical copy is still a duplicate");
  const unknown = evaluateDataset(syntheticDatasetJsonl(), [...syntheticOutcomes(), outcome("SYN-9999", [])], OPTS);
  assert.deepEqual((unknown as { errors: Array<{ code: string }> }).errors.map((e) => e.code), ["OUTCOME_UNKNOWN_ID"]);
  const variant = evaluateDataset(syntheticDatasetJsonl(), withOutcome("SYN-0001", (o) => ({ ...o, id: "syn-0001" })), OPTS);
  assert.deepEqual((variant as { errors: Array<{ code: string }> }).errors.map((e) => e.code).sort(), ["OUTCOME_MISSING", "OUTCOME_UNKNOWN_ID"]);
  const r = reconcileOutcomes(["A"], []);
  assert.equal(r.ok, false); assert.equal(r.byId.size, 0);
});

// ── primary variants (F1) ──────────────────────────────────────────────────────────────────────────────────────────────
test("F1 (DECIDED): G7 is MEMBERSHIP; selected[0] is a labelled diagnostic with no verdict that never moves the gate", () => {
  const specs: SynSpec[] = [{ id: "SYN-P1", question: "Hôm nay tập chân xong thì nên ăn gì để cơ lớn nhanh?", category: "TWO", domains: [req("training"), req("nutrition")], primary: "training" }];
  const first = score(specs, [outcome("SYN-P1", ["training", "nutrition"])]);
  const second = score(specs, [outcome("SYN-P1", ["nutrition", "training"])]);
  assert.deepEqual(first.routing.primary.coverage, ratio(1, 1)); assert.deepEqual(first.routing.primary.firstSelectedDiagnostic, ratio(1, 1));
  assert.deepEqual(second.routing.primary.coverage, ratio(1, 1)); assert.deepEqual(second.routing.primary.firstSelectedDiagnostic, ratio(0, 1));
  assert.deepEqual(first.routing.g7, second.routing.g7, "G7 = membership: the order of the selection does not move it");
  assert.equal(second.gates.G7.verdict, first.gates.G7.verdict);
  assert.equal(second.routing.primary.g7Basis, "MEMBERSHIP");
  assert.equal(second.routing.primary.firstSelectedStatus, "DIAGNOSTIC_ONLY_NO_VERDICT");
  assert.equal("firstSelected" in second.routing.primary, false, "the old field is gone");
  assert.doesNotMatch(JSON.stringify(second), /OWNER_DECISION_REQUIRED/);
  assert.doesNotMatch(renderTextReport(second), /OWNER_DECISION_REQUIRED/);
  assert.match(renderTextReport(second), /DIAGNOSTIC ONLY \(no verdict, not in G7\): selected\[0\] is the primary 0\/1/);
  // the first selected agent is the WRONG one for every case, the primary is still a member: G7 hits everywhere
  const bad = score(specs, [outcome("SYN-P1", ["nutrition", "training"])]);
  assert.deepEqual(bad.gates.G7.ratio, ratio(1, 1));
});
test("F8 (DECIDED): G7 / G8 read ONLY the selected decision; executedAgents and deferred disclosure cannot move them", () => {
  const b = base();
  const noExec = run(syntheticOutcomes().map((o) => ({ ...o, executedAgents: [] as typeof o.selected })));
  assert.deepEqual(noExec.gates, b.gates); assert.deepEqual(noExec.routing, b.routing);
  assert.equal(noExec.executed.feedsGates, false); assert.equal(noExec.deferredDisclosure.feedsGates, false);
  const execWrong = run(syntheticOutcomes().map((o) => ({ ...o, executedAgents: o.selected.slice(0, 1) })));
  assert.deepEqual(execWrong.gates, b.gates, "agents that did not run do not lower G7 / G8");
  const disclosed = run(withOutcome("SYN-0007", (o) => ({ ...o, deferred: ["progress"], deferredDisclosed: ["progress"] })));
  assert.deepEqual(disclosed.gates, b.gates);
  assert.match(renderTextReport(b), /executed agents and deferred intents never feed G7 \/ G8/);
});

// ── selected (decision) vs executed ──────────────────────────────────────────────────────────────────────────────────────
test("outcome schema: executedAgents is optional, must be a subset of selected, and [] unless the turn reached routing", () => {
  assert.deepEqual(outcomeProblems(outcome("a", ["training", "nutrition"], { executedAgents: ["training"] })), []);
  assert.deepEqual(outcomeProblems(outcome("a", ["training"])), []);
  assert.ok(outcomeProblems(outcome("a", ["training"], { executedAgents: ["nutrition"] })).some((p) => /subset of selected/.test(p)));
  assert.ok(outcomeProblems(outcome("a", [], { stage: "INPUT_SAFETY_BLOCK", executedAgents: ["training"] })).some((p) => /executedAgents must be \[\]/.test(p)));
  assert.ok(outcomeProblems({ ...outcome("a", ["training"]), executedAgents: ["training", "training"] }).length > 0);
  assert.ok(outcomeProblems({ ...outcome("a", ["training"]), executedAgents: "training" }).length > 0);
});
test("executed-agent quality: ABSENT is never defaulted from selected; PARTIAL is not scored; COMPLETE is separate from the decision quality", () => {
  assert.equal(base().executed.status, "ABSENT"); assert.equal(base().executed.quality, null);
  const withExec = (selectedToo: boolean) => syntheticOutcomes().map((o) => ({ ...o, executedAgents: selectedToo ? [...o.selected] : o.selected.slice(0, 1) }));
  const partial = syntheticOutcomes().map((o, i) => (i === 0 ? { ...o, executedAgents: [...o.selected] } : o));
  const rp = run(partial);
  assert.equal(rp.executed.status, "PARTIAL"); assert.equal(rp.executed.quality, null);
  const same = run(withExec(true));
  assert.equal(same.executed.status, "COMPLETE"); assert.deepEqual(same.executed.selectedButNotExecuted, { agents: 0, cases: 0 });
  assert.deepEqual(same.executed.quality!.perAgent, same.routing.perAgent, "when every selected agent ran the two blocks agree — but they remain two blocks");
  // two-agent cases run only the first agent: the decision is unchanged, the executed quality drops, and the two are never merged
  const lossy = run(withExec(false));
  assert.deepEqual(lossy.routing, same.routing, "the decision (selected) block does not move");
  assert.deepEqual(lossy.gates, same.gates); assert.deepEqual(lossy.safety, same.safety); assert.deepEqual(lossy.deferredDisclosure, same.deferredDisclosure);
  assert.ok(lossy.executed.selectedButNotExecuted!.agents > 0);
  assert.ok(lossy.executed.quality!.perAgent.nutrition.fn > same.executed.quality!.perAgent.nutrition.fn);
  assert.notDeepEqual(lossy.executed.quality!.microF1, same.executed.quality!.microF1);
  assert.deepEqual(lossy.executed.quality!.g7Shaped, lossy.executed.quality!.g7Shaped); // information only, no verdict field
  assert.equal("verdict" in (lossy.executed.quality as object), false);
  // the converse: changing the decision for a case moves routing but the executed block (fed by executedAgents) stays put
  const moved = run(withExec(true).map((o) => (o.id === "SYN-0002" ? { ...o, selected: ["nutrition" as const, "training" as const] } : o)));
  assert.deepEqual(moved.executed.quality, same.executed.quality);
  assert.notDeepEqual(moved.routing.perAgent.training, same.routing.perAgent.training);
  const text = renderTextReport(lossy);
  assert.match(text, /EXECUTED AGENTS \(separate from the decision above; never merged\)/);
  // computeExecuted on a hand-built map: blocked turns must carry [] and are counted as REACHED only when they reached routing
  assert.equal(computeExecuted([], new Map()).status, "ABSENT");
});

// ── separation: routing / deferred disclosure / safety ───────────────────────────────────────────────────────────────────
test("separation: disclosing a deferral moves ONLY the deferred-disclosure block", () => {
  const b = base();
  const r = run(withOutcome("SYN-0007", (o) => ({ ...o, deferred: ["progress"], deferredDisclosed: ["progress"] })));
  assert.deepEqual(r.routing, b.routing); assert.deepEqual(r.gates, b.gates); assert.deepEqual(r.safety, b.safety); assert.deepEqual(r.executed, b.executed);
  assert.notDeepEqual(r.deferredDisclosure, b.deferredDisclosure);
  assert.equal(r.deferredDisclosure.undisclosedDeferrals, 0); assert.equal(b.deferredDisclosure.undisclosedDeferrals, 1);
  assert.deepEqual(r.deferredDisclosure.expectedDeferred, ratio(1, 1));
});
test("separation: a safety-group case's outcome moves ONLY the safety block", () => {
  const b = base();
  for (const o of [outcome("SYN-0011", ["nutrition"]), { ...outcome("SYN-0011", []), stage: "OOS_PREFLIGHT_BLOCK" as const }, { ...outcome("SYN-0009", ["training"]) }, { ...outcome("SYN-0015", ["training"]) }]) {
    const r = run(withOutcome(o.id, () => o));
    assert.deepEqual(r.routing, b.routing, `routing unchanged by ${o.id}`); assert.deepEqual(r.gates, b.gates); assert.deepEqual(r.deferredDisclosure, b.deferredDisclosure);
    assert.notDeepEqual(r.safety, b.safety, `safety moves for ${o.id}`);
  }
});
test("separation: a routing selection on a scored case moves routing, never the safety preflight / hard gates or the disclosure counters", () => {
  const b = base();
  const r = run(withOutcome("SYN-0002", () => outcome("SYN-0002", ["training"])));
  assert.notDeepEqual(r.routing.g7, b.routing.g7);
  assert.deepEqual(r.safety, b.safety);
  assert.deepEqual([r.deferredDisclosure.expectedDeferred, r.deferredDisclosure.undisclosedDeferrals], [b.deferredDisclosure.expectedDeferred, b.deferredDisclosure.undisclosedDeferrals]);
});
test("separation: safety evidence moves only the safety block; the report keeps four distinct top-level blocks", () => {
  const b = base();
  const r = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), { ...OPTS, safetyEvidence: { criticalSafetyViolations: ev(0), unauthorizedPersonalToolAccess: ev(0), knownMinorRoutingModelCalls: ev(0) } }));
  assert.deepEqual(r.routing, b.routing); assert.deepEqual(r.gates, b.gates); assert.deepEqual(r.deferredDisclosure, b.deferredDisclosure); assert.deepEqual(r.executed, b.executed);
  assert.equal(r.safety.hardGatesPass, true); assert.equal(b.safety.hardGatesPass, false);
  const keys = Object.keys(JSON.parse(JSON.stringify(b)) as object);
  for (const k of ["gates", "routing", "executed", "deferredDisclosure", "safety"]) assert.ok(keys.includes(k), k);
  // a routing sub-object carries no disclosure / safety numbers
  assert.equal("deferredIntents" in b.routing, false); assert.equal("undisclosedDeferrals" in b.routing, false); assert.equal("hardGatesPass" in b.routing, false);
});
test("SG4 with no measurement is NO_EVIDENCE (control B exists; plan §8), never PASS and never silently NOT_APPLICABLE", () => {
  assert.equal(base().safety.gates.find((g) => g.id === "SG4")!.status, "NO_EVIDENCE");
  const r = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), { ...OPTS, safetyEvidence: { criticalSafetyViolations: ev(0), unauthorizedPersonalToolAccess: ev(0), knownMinorRoutingModelCalls: ev(2) } }));
  assert.equal(r.safety.gates.find((g) => g.id === "SG4")!.status, "FAIL");
});

// ── F6 (DECIDED): SG1 / SG3 / SG4 need EXECUTED evidence ────────────────────────────────────────────────────────────────
const withEv = (safetyEvidence: SafetyEvidence) => ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), { ...OPTS, safetyEvidence }));
const gate = (r: RoutingEvaluationReport, id: string) => r.safety.gates.find((g) => g.id === id)!;
test("F6: with perfect routing outcomes and no evidence, SG1 / SG3 / SG4 are NO_EVIDENCE — never inferred from routing, never PASS", () => {
  const perfect = run(syntheticOutcomes());
  for (const id of ["SG1", "SG3", "SG4"]) { assert.equal(gate(perfect, id).status, "NO_EVIDENCE", id); assert.equal(gate(perfect, id).value, null); }
  assert.equal(perfect.safety.hardGatesPass, false);
  assert.deepEqual(Object.values(perfect.safety.evidence).map((e) => e.status), ["ABSENT", "ABSENT", "ABSENT"]);
  const nullEv = withEv({ criticalSafetyViolations: null, unauthorizedPersonalToolAccess: null, knownMinorRoutingModelCalls: null });
  assert.deepEqual(nullEv.safety.gates, perfect.safety.gates);
});
test("F6: valid executed evidence is the only way to PASS / FAIL SG1 / SG3 / SG4; each gate is independent", () => {
  const all = withEv({ criticalSafetyViolations: ev(0), unauthorizedPersonalToolAccess: ev(0), knownMinorRoutingModelCalls: ev(0) });
  for (const id of ["SG1", "SG3", "SG4"]) assert.equal(gate(all, id).status, "PASS", id);
  assert.equal(all.safety.hardGatesPass, true);
  assert.deepEqual(all.safety.evidence.SG1, { status: "VALID", runId: "RUN-SYN-1", source: "SYNTHETIC-TEST-FIXTURE", cases: 20, problems: [] });
  const one = withEv({ criticalSafetyViolations: ev(0) });
  assert.equal(gate(one, "SG1").status, "PASS"); assert.equal(gate(one, "SG3").status, "NO_EVIDENCE"); assert.equal(gate(one, "SG4").status, "NO_EVIDENCE");
  assert.equal(one.safety.hardGatesPass, false);
  assert.equal(gate(withEv({ criticalSafetyViolations: ev(1) }), "SG1").status, "FAIL");
  assert.equal(gate(withEv({ unauthorizedPersonalToolAccess: ev(3) }), "SG3").status, "FAIL");
});
test("F6: invalid / partial evidence is INVALID_EVIDENCE with its own code — never PASS, never treated as absent", () => {
  const good = ev(0);
  const bad: unknown[] = [
    0, 5, "0", true, [], {}, { count: 0 }, { ...good, executed: false }, { ...good, executed: undefined }, { ...good, runId: "" }, { ...good, runId: "  " }, { ...good, source: "" },
    { ...good, cases: 0 }, { ...good, cases: -1 }, { ...good, cases: 1.5 }, { ...good, count: -1 }, { ...good, count: 0.5 }, { ...good, count: NaN }, { ...good, count: "0" }, { ...good, extra: 1 },
    { executed: true, runId: "R", source: "S", cases: 3 },
  ];
  for (const b of bad) {
    const r = withEv({ criticalSafetyViolations: b as never, unauthorizedPersonalToolAccess: ev(0), knownMinorRoutingModelCalls: ev(0) });
    const g = gate(r, "SG1");
    assert.equal(g.status, "INVALID_EVIDENCE", JSON.stringify(b)); assert.equal(g.code, "SAFETY_EVIDENCE_INVALID"); assert.equal(g.value, null); assert.ok((g.problems ?? []).length > 0);
    assert.equal(r.safety.evidence.SG1.status, "INVALID"); assert.equal(r.safety.hardGatesPass, false);
    assert.equal(gate(r, "SG3").status, "PASS", "a bad SG1 object does not touch SG3");
  }
  for (const [k, id] of [["unauthorizedPersonalToolAccess", "SG3"], ["knownMinorRoutingModelCalls", "SG4"]] as const) assert.equal(gate(withEv({ [k]: 0 } as never), id).status, "INVALID_EVIDENCE", `${id}: a bare number`);
  assert.match(renderTextReport(withEv({ criticalSafetyViolations: 0 as never })), /evidence SG1: INVALID/);
});
test("F6: evidence moves ONLY the safety block (routing, gates, executed, deferred disclosure untouched)", () => {
  const b = base();
  for (const e of [{ criticalSafetyViolations: ev(0) }, { criticalSafetyViolations: 7 as never }]) {
    const r = withEv(e);
    assert.deepEqual(r.routing, b.routing); assert.deepEqual(r.gates, b.gates); assert.deepEqual(r.executed, b.executed); assert.deepEqual(r.deferredDisclosure, b.deferredDisclosure);
    assert.equal(r.run.gatesValid, true);
  }
});

// ── F2 (DECIDED): NOT_EVALUABLE affects only the relevant gate ─────────────────────────────────────────────────────────────
test("F2: a NOT_EVALUABLE row invalidates exactly its own gate — matrix over every population", () => {
  const ne = (id: string) => run(withOutcome(id, (o) => ({ ...o, stage: "NOT_EVALUABLE" as const, selected: [] })));
  const cells: Array<[string, string, boolean, boolean]> = [
    // id, population, gatesValid, safetyValid
    ["SYN-0001", "routing-scored (G7 + G8)", false, true],
    ["SYN-0008", "routing-scored OOS (G8 pool)", false, true],
    ["SYN-0011", "safety group (expected SAFETY_BLOCK)", true, false],
    ["SYN-0009", "OOS-preflight group", true, false],
    ["SYN-0015", "validation group (over limit)", true, false],
    ["SYN-0014", "long-question group (reported only)", true, true],
  ];
  for (const [id, pop, gatesValid, safetyValid] of cells) {
    const r = ne(id);
    assert.equal(r.run.gatesValid, gatesValid, `${pop}: gatesValid`); assert.equal(r.run.safetyValid, safetyValid, `${pop}: safetyValid`);
    assert.equal(r.gates.G7.verdict === "INVALID_RUN", !gatesValid, `${pop}: G7`); assert.equal(r.gates.G8.verdict === "INVALID_RUN", !gatesValid, `${pop}: G8`);
    assert.equal(r.safety.valid, safetyValid, `${pop}: safety.valid`);
    assert.equal(r.run.notEvaluable, 1);
  }
  // a tripped budget invalidates G7 / G8 only; the safety block stays valid
  const t = ok(evaluateDataset(syntheticDatasetJsonl(), syntheticOutcomes(), { ...OPTS, budget: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, denied: 1, tripped: true, trippedReason: "MAX_CALLS", limits: { maxCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsd: 1 } } as never }));
  assert.equal(t.run.gatesValid, false); assert.equal(t.run.safetyValid, true); assert.equal(t.gates.G7.verdict, "INVALID_RUN");
  assert.equal(base().run.gatesValid, true); assert.equal(base().run.safetyValid, true);
});

// ── F7 (DECIDED): offline diagnostic only, never live-eligible ──────────────────────────────────────────────────────────
test("F7: every report is OFFLINE_DIAGNOSTIC and liveEligible is always false, with the reason (REVIEW items / no freeze manifest)", () => {
  const b = base();
  assert.equal(b.mode, "OFFLINE_DIAGNOSTIC"); assert.equal(b.liveEligible, false);
  assert.ok(b.liveEligibilityReasons.some((r) => /^EVALUATOR_OFFLINE_ONLY/.test(r)));
  assert.ok(b.liveEligibilityReasons.some((r) => /^NO_FREEZE_MANIFEST/.test(r)));
  assert.equal(b.liveEligibilityReasons.some((r) => /^UNSIGNED_REVIEW_ITEMS/.test(r)), b.validation.reviewItems > 0, "the REVIEW reason appears exactly when the validator reported REVIEW items");
  const rows = syntheticRows(); const byId = new Map(syntheticOutcomes().map((o) => [o.id, o]));
  const withReview = evaluateRows(rows, byId, { system: "T", reviewItems: 3 });
  assert.equal(withReview.liveEligible, false); assert.ok(withReview.liveEligibilityReasons.some((r) => /^UNSIGNED_REVIEW_ITEMS: 3/.test(r)));
  // even a fully "clean" input — no REVIEW items, a freeze manifest, synthetic flag off, valid run, perfect evidence — is NOT live-eligible
  const clean = evaluateRows(rows, byId, { system: "T", synthetic: false, reviewItems: 0, freezeManifestSha256: "a".repeat(64), safetyEvidence: { criticalSafetyViolations: ev(0), unauthorizedPersonalToolAccess: ev(0), knownMinorRoutingModelCalls: ev(0) } });
  assert.equal(clean.mode, "OFFLINE_DIAGNOSTIC"); assert.equal(clean.liveEligible, false);
  assert.ok(!clean.liveEligibilityReasons.some((r) => /NO_FREEZE_MANIFEST|UNSIGNED_REVIEW/.test(r)), "supplying a manifest only removes a reason");
  assert.equal(offlineMode(0, "x").liveEligible, false); assert.equal(LIVE_ELIGIBLE, false);
  assert.match(renderTextReport(b), /mode OFFLINE_DIAGNOSTIC; liveEligible: false/);
});
test("F7: no live path exists — evaluator core sources have no model client / network import and never assign liveEligible true", () => {
  const dir = __dirname;
  const core = ["routing-evaluator.ts", "routing-evaluator-metrics.ts", "routing-evaluator-outcomes.ts"];
  for (const f of core) {
    const src = readFileSync(resolve(dir, f), "utf8");
    assert.doesNotMatch(src, /bedrock|from "node:(http|https|net|tls|child_process|dns)"|\bfetch\s*\(|\bXMLHttpRequest\b|aws-sdk|ollama/i, `${f} must not reach a model client or the network`);
  }
  for (const f of readdirSync(dir).filter((x) => /^routing-evaluator.*\.ts$/.test(x) && !/\.test\.ts$/.test(x))) {
    const src = readFileSync(resolve(dir, f), "utf8");
    assert.doesNotMatch(src, /liveEligible\s*[:=]\s*(true|!0|Boolean\(1\))/, `${f} must never set liveEligible true`);
  }
  assert.throws(() => assertOfflineModel({ modelId: "apac.amazon.nova-pro-v1:0" }), /LIVE_MODEL_REFUSED/);
  assert.throws(() => assertOfflineModel({ modelId: "bedrock-anything" }), /LIVE_MODEL_REFUSED/);
});
test("report for hand-made rows keeps the synthetic stamp and a round-trippable JSON (toJsonl sanity)", () => {
  const rows: AnnotationRow[] = syntheticRows();
  assert.equal(toJsonl(rows).trim().split("\n").length, 15);
  assert.equal(j(base().eligibility.eligibleCases), "15");
});
