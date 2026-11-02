import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freezeReviewerCase, releaseGenerationBundle, validateGenerationBundle, createAnnotationPackets, reviewerAgreement, validateAnnotation, AdjudicationSchema } from "../evaluation/evaluation-kit/annotations";
import { digest } from "../evaluation/evaluation-kit/identity";
import { devCases } from "../evaluation/ai-coach-dev/fixtures";
import { prepareReleasedPilot } from "../evaluation/bedrock-pilot/prepare";
import { createFixtureIo } from "../evaluation/ai-coach-dev/retrieval";
const makeCase = () => ({ version: "reviewer-case-v1", caseKey: "case-test-001", split: "HELD_OUT", author: { pseudonym: "TEST_REVIEWER", role: "INDEPENDENT_REVIEWER", independenceAttested: true }, request: devCases()[0].request,
  labels: { expectedOutcomeScope: ["ESTIMATED_STRENGTH"], expectedAssessment: "NO_OBSERVED_CHANGE", referenceSupport: [], safety: "NORMAL", appropriateAbstention: false, rationale: "EXPECTED_ANSWER_SECRET_TEST_FIXTURE" } });
function frozen() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-labels-"));
  const manifestDir = path.join(root, "public"), privateDir = path.join(root, "owner-private");
  const manifest = freezeReviewerCase(makeCase(), manifestDir, privateDir);
  const sealed = JSON.parse(fs.readFileSync(path.join(privateDir, "case-test-001.json"), "utf8"));
  const approval = { ownerPseudonym: "TEST_OWNER", manifestHash: digest(manifest), purpose: "CONTROLLED_EVALUATION", releaseHeldOut: true, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  return { manifestDir, privateDir, manifest, sealed, approval };
}
test("case freeze publishes only hashes and keeps salted labels and held-out content private", () => {
  const f = frozen(), publicText = fs.readFileSync(path.join(f.manifestDir, "case-test-001.manifest.json"), "utf8");
  assert.ok(!publicText.includes("EXPECTED_ANSWER_SECRET")); assert.ok(!publicText.includes(f.sealed.case.request.question));
  assert.throws(() => freezeReviewerCase(makeCase(), f.manifestDir, f.manifestDir), /Separate/);
  assert.throws(() => freezeReviewerCase(makeCase(), f.manifestDir, f.privateDir));
});
test("held-out release requires owner receipt and rejects changed facts or labels", () => {
  const f = frozen();
  assert.throws(() => releaseGenerationBundle(f.sealed, f.manifest, { ...f.approval, releaseHeldOut: false }), /OwnerRelease/);
  const tampered = structuredClone(f.sealed); tampered.case.labels.expectedAssessment = "OBSERVED_PROGRESS";
  assert.throws(() => releaseGenerationBundle(tampered, f.manifest, f.approval), /FrozenCaseOrLabelChanged/);
  const bundle = releaseGenerationBundle(f.sealed, f.manifest, f.approval);
  assert.ok(!JSON.stringify(bundle).includes("EXPECTED_ANSWER_SECRET"));
  assert.ok(!JSON.stringify(bundle).includes("expectedOutcomeScope"));
  assert.ok(validateGenerationBundle(bundle, f.manifest, digest(f.approval)));
  const wrong = structuredClone(bundle); wrong.request.question = "changed";
  assert.throws(() => validateGenerationBundle(wrong, f.manifest, digest(f.approval)), /ChangedAfterFreeze/);
});
test("blind packets whitelist input fields and cover claims, conclusion and questions", () => {
  const candidate = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [{ claimType: "OBSERVATION", text: "A synthetic fact.", factIds: ["DEV_F_ATTENDANCE"], evidenceIds: [] }], missingInformation: [{ key: "other", question: "What is missing?" }], rationaleSummary: "Synthetic bounded conclusion.", proposedAction: null }, sourceLinks: [] };
  const input = { question: "Synthetic question", facts: [], evidence: { passages: [{ source: { id: "S", title: "Synthetic test" }, excerpts: [{ id: "E", text: "Fixture only", expectedAnswer: "DO_NOT_LEAK" }] }], status: "DO_NOT_LEAK", trace: "DO_NOT_LEAK", expectedAnswer: "DO_NOT_LEAK" }, candidate, expectedAnswer: "DO_NOT_LEAK", arm: "DO_NOT_LEAK", policy: "DO_NOT_LEAK" };
  const packets = createAnnotationPackets(input);
  assert.equal(packets.reviewers.length, 2); assert.ok(!JSON.stringify(packets.reviewers).includes("DO_NOT_LEAK"));
  assert.deepEqual(packets.reviewers[0].body.units.map((u) => u.unitId), ["CLAIM_0", "CONCLUSION", "QUESTION_0"]);
});
test("missing labels give null agreement/kappa, never fabricated scientific gold", () => {
  assert.equal(reviewerAgreement().exactAgreement, null); assert.equal(reviewerAgreement().kappa, null);
});
test("annotations require complete packet units and distinct reviewer identities", () => {
  const packet = createAnnotationPackets({ question: "Synthetic", facts: [], evidence: [], candidate: {} }).reviewers[0];
  const a = { packetHash: packet.packetHash, reviewerExportHash: packet.reviewerExportHashes.R1, reviewerSlot: "R1", reviewerPseudonym: "TEST_A", authority: "TEST_FIXTURE", units: [{ unitId: "INVALID_OUTPUT", factualCorrectness: "NOT_APPLICABLE", sourceSupport: "NOT_APPLICABLE", unsupportedPersonalClaim: null, uncertainty: "NOT_APPLICABLE", abstention: "NOT_APPLICABLE", rationale: "Fixture only" }], usefulness: null, submittedAt: new Date().toISOString() };
  assert.ok(validateAnnotation(a, packet)); assert.throws(() => validateAnnotation({ ...a, units: [] }, packet));
  assert.throws(() => reviewerAgreement(a, a), /TwoIndependentReviewers/);
  const b = { ...a, reviewerSlot: "R2", reviewerPseudonym: "TEST_B" };
  const agreement = reviewerAgreement(a, b); assert.equal(agreement.status, "TEST_FIXTURE_ONLY"); assert.equal(agreement.kappa, null);
  assert.ok(AdjudicationSchema.safeParse({ packetHash: packet.packetHash, adjudicatorPseudonym: "TEST_C", decisions: [], rationale: "No disagreement in this fixture" }).success);
  const decision = { unitId: "INVALID_OUTPUT", axis: "factualCorrectness", decision: "NOT_ESTABLISHED", rationale: "Fixture uncertainty" };
  assert.ok(AdjudicationSchema.safeParse({ packetHash: packet.packetHash, adjudicatorPseudonym: "TEST_C", decisions: [decision], rationale: "Fixture only" }).success);
  assert.equal(AdjudicationSchema.safeParse({ packetHash: packet.packetHash, adjudicatorPseudonym: "TEST_C", decisions: [{ ...decision, decision: "APPROPRIATE" }], rationale: "Fixture only" }).success, false);
});
test("released independent-case interface prepares six prompt layouts without labels or model calls", async () => {
  const f = frozen(), bundle = releaseGenerationBundle(f.sealed, f.manifest, f.approval);
  const pilot = await prepareReleasedPilot([bundle], [f.manifest], [digest(f.approval)], { corpus: [], io: createFixtureIo([]).io });
  assert.equal(pilot.rows.length, 6); assert.equal(pilot.modelCalls, 0);
  assert.ok(!JSON.stringify(pilot).includes("EXPECTED_ANSWER_SECRET"));
  assert.ok(!JSON.stringify(pilot.rows.map((r) => r.prompt)).includes("expectedOutcomeScope"));
  assert.ok(!JSON.stringify(pilot.rows.map((r) => r.prompt)).includes("TEST_REVIEWER"));
});
