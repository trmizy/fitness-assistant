import test from "node:test";
import assert from "node:assert/strict";
import { cohensKappa, pairedClusterBootstrap } from "../evaluation/evaluation-kit/statistics";
import { analyzeOffline, gateConfusion, type OfflineAnalysisInput } from "../evaluation/evaluation-kit/offline-analysis";
import { createAnnotationPackets } from "../evaluation/evaluation-kit/annotations";
import { digest } from "../evaluation/evaluation-kit/identity";
import { attemptIdentity } from "../evaluation/bedrock-pilot/design";
import { devCases } from "../evaluation/ai-coach-dev/fixtures";
import { pilotAnswer } from "./fixtures/pilot";
function fixture(): OfflineAnalysisInput {
  const request = devCases()[0].request, c = { version: "reviewer-case-v1" as const, caseKey: "case-analysis-fixture", split: "REVIEWED_DEV" as const, author: { pseudonym: "TEST_AUTHOR", role: "INDEPENDENT_REVIEWER" as const, independenceAttested: true as const }, request,
    labels: { expectedOutcomeScope: ["ESTIMATED_STRENGTH" as const], expectedAssessment: "INSUFFICIENT_DATA" as const, referenceSupport: [], safety: "NORMAL" as const, appropriateAbstention: true, rationale: "TEST FIXTURE, NOT INDEPENDENT GOLD" } };
  const salt = "a".repeat(64), manifest = { version: "case-freeze-v1" as const, caseKey: c.caseKey, split: c.split, requestHash: digest(request), labelHash: digest({ salt, labels: c.labels }), authorAttestationHash: digest(c.author) };
  const metadata = { caseKey: c.caseKey, arm: "LAYERED" as const, policy: "MINIMAL" as const, repeatIndex: 0, configHash: digest("fixture-config"), promptHash: digest("fixture-prompt") }, attemptKey = attemptIdentity(metadata);
  const packet = createAnnotationPackets({ question: request.question, facts: request.snapshots.flatMap((s) => s.facts), evidence: [], candidate: pilotAnswer }).reviewers[0];
  const annotation = (reviewerSlot: "R1" | "R2") => ({ packetHash: packet.packetHash, reviewerSlot, reviewerPseudonym: "TEST_" + reviewerSlot, authority: "TEST_FIXTURE" as const, units: [{ unitId: "CONCLUSION", factualCorrectness: "SUPPORTED" as const, sourceSupport: "NOT_APPLICABLE" as const, unsupportedPersonalClaim: true, uncertainty: "APPROPRIATE" as const, abstention: "APPROPRIATE" as const, personalApplicability: "UNSUPPORTED" as const, unsupportedCausalInference: "GROUP_TO_INDIVIDUAL" as const, rationale: "Synthetic arithmetic probe only" }], usefulness: 2, submittedAt: "2026-11-02T00:00:00Z" });
  return { version: "offline-evaluation-v1", purpose: "TEST_FIXTURE", configHash: metadata.configHash, cases: [{ authority: "TEST_FIXTURE", manifest, sealed: { case: c, salt } }], schedule: [{ ...metadata, attemptKey }], routedBeforeGeneration: 0,
    outputs: [{ attemptKey, raw: { candidate: pilotAnswer, text: JSON.stringify(pilotAnswer), status: "GENERATED", executionMode: "FAKE", inputTokens: 12, outputTokens: 8, latencyMs: 2, estimatedUsd: 0.01 }, postGate: { decision: "BLOCKED", structuredInvariant: false, narrowTextHeuristic: true }, packet }],
    annotations: [annotation("R1"), annotation("R2")], adjudications: [{ authority: "TEST_FIXTURE", review: { packetHash: packet.packetHash, adjudicatorPseudonym: "TEST_THIRD", decisions: [], rationale: "Synthetic bad output" }, shouldBlock: true }] };
}
test("D3 Cohen kappa matches hand-calculated nominal/ordinal examples and preserves missing/NA distinctions", () => {
  const nominal = cohensKappa([[0, 0], [0, 0], [0, 0], [0, 1], [1, 0], [1, 1], [1, 1], [1, 1]]); assert.equal(nominal.kappa, 0.5); assert.equal(nominal.agreement, 0.75);
  const ordinal = cohensKappa([[1, 1], [2, 2], [3, 4], [4, 5], [5, 5]], [1, 2, 3, 4, 5]); assert.ok(Math.abs(ordinal.kappa! - 11 / 12) < 1e-12);
  assert.equal(cohensKappa([["A", "A"]]).kappa, null); assert.equal(cohensKappa([[null, "A"], ["NOT_EVALUATED", "A"]]).pairs, 0);
  assert.equal(cohensKappa([["NOT_APPLICABLE", "A"], ["A", "A"]]).pairs, 2); assert.throws(() => cohensKappa([[NaN, 1]]));
});
test("D3 paired percentile bootstrap samples case clusters with equal case weight, not repeated outputs", () => {
  const cells = [{ caseKey: "a", arm: "A", policy: "MINIMAL", value: 1 }, { caseKey: "a", arm: "B", policy: "MINIMAL", value: 0 }, { caseKey: "b", arm: "A", policy: "MINIMAL", value: 3 }, { caseKey: "b", arm: "B", policy: "MINIMAL", value: 0 }];
  const result = pairedClusterBootstrap(cells, "A", "B", "MINIMAL", { resamples: 10000, samplerSeed: 42 });
  assert.equal(result.estimate, 2); assert.equal(result.caseCount, 2); assert.deepEqual(result.interval, [1, 3]); assert.equal(result.pValue, null);
  assert.deepEqual(result, pairedClusterBootstrap(cells, "A", "B", "MINIMAL", { resamples: 10000, samplerSeed: 42 }));
  assert.throws(() => pairedClusterBootstrap([...cells, cells[0]], "A", "B", "MINIMAL"), /AggregatedByCase/);
  assert.equal(pairedClusterBootstrap(cells.slice(0, 2), "A", "B", "MINIMAL").interval, null);
});
test("D3 gate confusion uses explicit adjudicated truth; unknowns are not negatives", () => {
  const c = gateConfusion([{ truth: true, blocked: true }, { truth: true, blocked: false }, { truth: false, blocked: true }, { truth: false, blocked: false }, { truth: null, blocked: true }]);
  assert.deepEqual([c.tp, c.fn, c.fp, c.tn, c.missing], [1, 1, 1, 1, 1]); assert.equal(c.sensitivity.value, 0.5); assert.equal(c.specificity.value, 0.5); assert.equal(c.precision.value, 0.5);
});
test("D3 synthetic annotations test denominators but cannot publish model effectiveness, costs or CI", () => {
  const report = analyzeOffline(fixture()); assert.equal(report.status, "NOT_EVALUATED"); assert.equal(report.semantics, null); assert.equal(report.scientificPass, null); assert.equal(report.pairedComparisons, null);
  assert.equal(report.fixtureCalculations!.raw.unsupportedPersonalClaimRate.value, 1); assert.equal(report.fixtureCalculations!.raw.assessmentCorrectness.value, 1);
  assert.equal(report.fixtureCalculations!.postGate.assessmentCorrectness.value, null); assert.equal(report.denominators.blockedValid, 1); assert.equal(report.denominators.releasedValid, 0);
  assert.equal(report.telemetry.inputTokens.observedSum, null); assert.equal(report.telemetry.fakeAttemptsExcluded, 1);
  const wrongAuthority = fixture(); wrongAuthority.purpose = "INDEPENDENT_ANALYSIS"; assert.equal(analyzeOffline(wrongAuthority).semantics, null);
  const mislabeledMode = fixture(); mislabeledMode.outputs[0].raw.executionMode = "LIVE"; assert.equal(analyzeOffline(mislabeledMode).telemetry.estimatedUsd.observedSum, null);
});
test("D3 raw and post-gate denominators keep blocked/absent outputs separate across repeats", () => {
  const data = fixture(), first = data.outputs[0], { attemptKey: _key, ...base } = data.schedule[0], next = { ...base, repeatIndex: 1 }, key = attemptIdentity(next);
  data.schedule.push({ ...next, attemptKey: key }); const absent = { ...base, repeatIndex: 2 }; data.schedule.push({ ...absent, attemptKey: attemptIdentity(absent) });
  const request = data.cases[0].sealed.case.request;
  const packet = createAnnotationPackets({ question: request.question, facts: request.snapshots.flatMap((s) => s.facts), evidence: [], candidate: pilotAnswer }).reviewers[0];
  data.outputs.push({ ...first, attemptKey: key, packet, postGate: { decision: "ELIGIBLE", structuredInvariant: false, narrowTextHeuristic: false } });
  data.annotations.push(...data.annotations.slice(0, 2).map((a) => ({ ...a, packetHash: packet.packetHash, units: a.units.map((u) => ({ ...u, unsupportedPersonalClaim: false, personalApplicability: "SUPPORTED" as const, unsupportedCausalInference: "NONE" as const })) })));
  data.adjudications.push({ ...data.adjudications[0], shouldBlock: false, review: { ...data.adjudications[0].review, packetHash: packet.packetHash } });
  const report = analyzeOffline(data);
  assert.equal(report.denominators.scheduled, 3); assert.equal(report.denominators.missingOutputs, 1); assert.equal(report.denominators.rawRecorded, 2); assert.equal(report.denominators.coverage.value, 0.5);
  assert.equal(report.fixtureCalculations!.raw.unsupportedPersonalClaimRate.value, 0.5); assert.equal(report.fixtureCalculations!.postGate.unsupportedPersonalClaimRate.value, 0);
  assert.equal(report.fixtureCalculations!.raw.assessmentCorrectness.denominator, 2); assert.equal(report.fixtureCalculations!.postGate.assessmentCorrectness.denominator, 1);
});
test("D3 absent annotations/NA/partial labels remain missing, not zero errors or perfect support", () => {
  const data = fixture(); data.annotations = []; data.adjudications = []; const report = analyzeOffline(data);
  assert.equal(report.missingness.annotationRecords, 2); assert.equal(report.fixtureCalculations!.raw.unsupportedPersonalClaimRate.value, null); assert.equal(report.fixtureCalculations!.gate.sensitivity.value, null);
  const partial = fixture(); partial.annotations[1].units[0].unsupportedPersonalClaim = false; const mismatch = analyzeOffline(partial); assert.equal(mismatch.fixtureCalculations!.raw.unsupportedPersonalClaimRate.value, null); assert.equal(mismatch.missingness.unresolvedDisagreements, 1);
  partial.adjudications[0].review.decisions.push({ unitId: "CONCLUSION", axis: "unsupportedPersonalClaim", decision: true, rationale: "TEST FIXTURE adjudication" });
  assert.equal(analyzeOffline(partial).fixtureCalculations!.raw.unsupportedPersonalClaimRate.value, 1);
  const support = fixture(); support.annotations.forEach((a) => { a.units[0].sourceSupport = "PARTIAL"; }); assert.equal(analyzeOffline(support).fixtureCalculations!.raw.sourceSupport.value, 0);
});
test("D3 rejects changed labels, tampered packets, duplicate attempts/reviewers and self-adjudication", () => {
  const gold = fixture(); gold.cases[0].sealed.case.labels.rationale += "changed"; assert.throws(() => analyzeOffline(gold), /FrozenCaseOrLabelsChanged/);
  const raw = fixture(); raw.outputs[0].raw.candidate = {}; assert.throws(() => analyzeOffline(raw), /PacketRawOrCaseMismatch/);
  const duplicate = fixture(); duplicate.schedule.push(duplicate.schedule[0]); assert.throws(() => analyzeOffline(duplicate), /ScheduleIdentityMismatch/);
  const reviewers = fixture(); reviewers.annotations[1].reviewerPseudonym = reviewers.annotations[0].reviewerPseudonym; assert.throws(() => analyzeOffline(reviewers), /DuplicateReviewer/);
  const adj = fixture(); adj.adjudications[0].review.adjudicatorPseudonym = adj.annotations[0].reviewerPseudonym; assert.throws(() => analyzeOffline(adj), /IndependentAdjudicator/);
});

type GateCase = { status: "GENERATED" | "FAILED"; decision: "BLOCKED" | "ELIGIBLE" | "FAILED"; truth: boolean | null; parseFailure?: boolean };
function gateCases(cases: GateCase[]): OfflineAnalysisInput {
  const template = fixture(), request = template.cases[0].sealed.case.request;
  const data: OfflineAnalysisInput = { ...template, schedule: [], outputs: [], annotations: [], adjudications: [] };
  for (const [repeatIndex, c] of cases.entries()) {
    const { attemptKey: _old, ...base } = template.schedule[0], metadata = { ...base, repeatIndex }, attemptKey = attemptIdentity(metadata);
    const candidate = c.status === "GENERATED" ? pilotAnswer : c.parseFailure ? { invalid: "TEST_FIXTURE_PARSE_FAILURE" } : null;
    const text = candidate === null ? null : JSON.stringify(candidate);
    const packet = createAnnotationPackets({ question: request.question, facts: request.snapshots.flatMap((s) => s.facts), evidence: [], candidate: candidate ?? text }).reviewers[0];
    data.schedule.push({ ...metadata, attemptKey });
    data.outputs.push({ attemptKey, raw: { ...template.outputs[0].raw, status: c.status, candidate, text }, postGate: { decision: c.decision, structuredInvariant: true, narrowTextHeuristic: true }, packet });
    data.annotations.push(...template.annotations.map((a) => ({ ...a, packetHash: packet.packetHash, units: packet.body.units.map((u) => ({ ...a.units[0], unitId: u.unitId })) })));
    data.adjudications.push({ ...template.adjudications[0], shouldBlock: c.truth, review: { ...template.adjudications[0].review, packetHash: packet.packetHash } });
  }
  return data;
}
for (const c of [
  { name: "E1 FAILED with true truth must not become FN", status: "FAILED", decision: "FAILED", truth: true, expected: [0, 0, 0, 0] },
  { name: "FAILED with false truth must not become TN", status: "FAILED", decision: "FAILED", truth: false, expected: [0, 0, 0, 0] },
  { name: "GENERATED BLOCKED true is TP", status: "GENERATED", decision: "BLOCKED", truth: true, expected: [1, 0, 0, 0] },
  { name: "GENERATED BLOCKED false is FP", status: "GENERATED", decision: "BLOCKED", truth: false, expected: [0, 1, 0, 0] },
  { name: "GENERATED released ELIGIBLE true is FN", status: "GENERATED", decision: "ELIGIBLE", truth: true, expected: [0, 0, 0, 1] },
  { name: "GENERATED released ELIGIBLE false is TN", status: "GENERATED", decision: "ELIGIBLE", truth: false, expected: [0, 0, 1, 0] },
  { name: "parse failure marked BLOCKED must not become TP", status: "FAILED", decision: "BLOCKED", truth: true, parseFailure: true, expected: [0, 0, 0, 0] },
  { name: "valid generation without a gate decision is not FN", status: "GENERATED", decision: "FAILED", truth: true, expected: [0, 0, 0, 0] },
] as const) {
  test("P2-1 " + c.name, () => {
    const report = analyzeOffline(gateCases([c])), gate = report.fixtureCalculations!.gate;
    assert.deepEqual([gate.tp, gate.fp, gate.tn, gate.fn], [...c.expected]);
    assert.equal(gate.labelled, c.expected.reduce<number>((n, v) => n + v, 0));
    assert.equal(report.denominators.failed, c.status === "FAILED" ? 1 : 0);
    assert.equal(report.denominators.rawRecorded, 1);
    assert.equal(report.denominators.validGenerated, c.status === "GENERATED" ? 1 : 0);
    if (gate.labelled === 0) {
      assert.equal(gate.sensitivity.value, null); assert.equal(gate.specificity.value, null);
      assert.equal(gate.sensitivity.denominator, 0); assert.equal(gate.specificity.denominator, 0);
    } else {
      assert.equal(gate.sensitivity.denominator, gate.tp + gate.fn);
      assert.equal(gate.specificity.denominator, gate.tn + gate.fp);
      assert.equal(gate.sensitivity.value, gate.tp + gate.fn ? gate.tp / (gate.tp + gate.fn) : null);
      assert.equal(gate.specificity.value, gate.tn + gate.fp ? gate.tn / (gate.tn + gate.fp) : null);
    }
  });
}
test("P2-1 all failed outputs remain failures with no eligible confusion samples", () => {
  const report = analyzeOffline(gateCases([{ status: "FAILED", decision: "FAILED", truth: true }, { status: "FAILED", decision: "FAILED", truth: false }]));
  const gate = report.fixtureCalculations!.gate;
  assert.deepEqual([gate.tp, gate.fp, gate.tn, gate.fn, gate.labelled, gate.missing], [0, 0, 0, 0, 0, 0]);
  assert.equal(gate.sensitivity.value, null); assert.equal(gate.specificity.value, null); assert.equal(gate.precision.value, null);
  assert.equal(report.denominators.failed, 2); assert.equal(report.denominators.rawRecorded, 2); assert.equal(report.denominators.releasedValid, 0);
});
test("P2-1 mixed failures and gate outcomes count only valid decisions and keep missing truth", () => {
  const report = analyzeOffline(gateCases([
    { status: "FAILED", decision: "FAILED", truth: true }, { status: "FAILED", decision: "FAILED", truth: false },
    { status: "GENERATED", decision: "BLOCKED", truth: true }, { status: "GENERATED", decision: "BLOCKED", truth: false },
    { status: "GENERATED", decision: "ELIGIBLE", truth: true }, { status: "GENERATED", decision: "ELIGIBLE", truth: false },
    { status: "GENERATED", decision: "ELIGIBLE", truth: null },
  ]));
  const gate = report.fixtureCalculations!.gate;
  assert.deepEqual([gate.tp, gate.fp, gate.tn, gate.fn, gate.labelled, gate.missing], [1, 1, 1, 1, 4, 1]);
  assert.equal(gate.sensitivity.denominator, 2); assert.equal(gate.specificity.denominator, 2);
  assert.equal(gate.sensitivity.value, 0.5); assert.equal(gate.specificity.value, 0.5);
  assert.equal(report.denominators.failed, 2); assert.equal(report.denominators.rawRecorded, 7); assert.equal(report.denominators.validGenerated, 5);
  assert.equal(report.denominators.blockedValid, 2); assert.equal(report.denominators.releasedValid, 3); assert.equal(report.denominators.coverage.value, 3 / 5);
});
test("P2-1 absence of adjudicated truth stays NOT_EVALUATED", () => {
  const data = gateCases([{ status: "GENERATED", decision: "BLOCKED", truth: null }]); data.adjudications = [];
  const report = analyzeOffline(data), gate = report.fixtureCalculations!.gate;
  assert.equal(gate.labelled, 0); assert.equal(gate.missing, 1);
  assert.equal(gate.sensitivity.value, null); assert.equal(gate.specificity.value, null); assert.equal(report.semantics, null);
});
test("P2-1 synthetic independent-mode branch coverage also excludes failures from per-scope matrices", () => {
  // Metadata solely exercises this pure branch: no LIVE transport or independent dataset exists.
  const data = gateCases([{ status: "FAILED", decision: "FAILED", truth: true }, { status: "FAILED", decision: "FAILED", truth: false }]);
  data.purpose = "INDEPENDENT_ANALYSIS";
  data.cases.forEach((c) => { c.authority = "REVIEWER_ATTESTED"; });
  data.outputs.forEach((o) => { o.raw.executionMode = "LIVE"; });
  data.annotations.forEach((a) => { a.authority = "REVIEWER_ATTESTED"; });
  data.adjudications.forEach((a) => { a.authority = "REVIEWER_ATTESTED"; });
  const report = analyzeOffline(data);
  for (const gate of [report.semantics!.gate, ...Object.values(report.semantics!.gateByScope)]) {
    assert.deepEqual([gate.tp, gate.fp, gate.tn, gate.fn, gate.labelled], [0, 0, 0, 0, 0]);
    assert.equal(gate.sensitivity.value, null); assert.equal(gate.specificity.value, null);
  }
  assert.equal(report.denominators.failed, 2); assert.equal(report.scientificPass, null);
});
