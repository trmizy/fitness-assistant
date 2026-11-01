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
