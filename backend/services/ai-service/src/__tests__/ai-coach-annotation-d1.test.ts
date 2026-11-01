import test from "node:test";
import assert from "node:assert/strict";
import { AnnotationSchema, AdjudicationSchema, createAnnotationPackets, validateAnnotation } from "../evaluation/evaluation-kit/annotations";
import { pilotAnswer } from "./fixtures/pilot";
function fixture() {
  const packet = createAnnotationPackets({ question: "Synthetic fixture", facts: [{ id: "DEV_F_X" }], evidence: [{ source: { id: "TEST_SOURCE" }, excerpts: [{ id: "TEST_EXCERPT", text: "Synthetic text, not science." }] }], candidate: pilotAnswer }).reviewers[0];
  const value = { packetHash: packet.packetHash, reviewerSlot: "R1", reviewerPseudonym: "TEST_REVIEWER", authority: "TEST_FIXTURE", units: [{ unitId: "CONCLUSION", factualCorrectness: "SUPPORTED", sourceSupport: "SUPPORTED", unsupportedPersonalClaim: null, uncertainty: "NOT_APPLICABLE", abstention: "NOT_APPLICABLE", rationale: "Synthetic review only" }], usefulness: 3, submittedAt: "2026-11-02T00:00:00Z" };
  return { packet, value };
}
test("D1 valid annotation records personal/source/fact references without inferring applicability from citations", () => {
  const { packet, value } = fixture();
  const a = validateAnnotation({ ...value, units: [{ ...value.units[0], personalApplicability: "PARTIAL", unsupportedCausalInference: "NONE", references: { unitIds: ["CONCLUSION"], factIds: ["DEV_F_X"], sourceIds: ["TEST_SOURCE"], excerptIds: ["TEST_EXCERPT"] } }] }, packet);
  assert.equal(a.units[0].personalApplicability, "PARTIAL"); assert.equal(a.units[0].unsupportedPersonalClaim, null);
  assert.equal(validateAnnotation(value, packet).units[0].personalApplicability, "NOT_EVALUATED");
});
test("D1 unsupported personal application and causal overreach remain separate explicit reviewer judgements", () => {
  const { value } = fixture();
  const a = AnnotationSchema.parse({ ...value, units: [{ ...value.units[0], personalApplicability: "UNSUPPORTED", unsupportedCausalInference: "GROUP_TO_INDIVIDUAL", unsupportedPersonalClaim: true }] });
  assert.equal(a.units[0].personalApplicability, "UNSUPPORTED"); assert.equal(a.units[0].unsupportedCausalInference, "GROUP_TO_INDIVIDUAL");
  assert.ok(AdjudicationSchema.safeParse({ packetHash: value.packetHash, adjudicatorPseudonym: "TEST_THIRD", decisions: [{ unitId: "CONCLUSION", axis: "unsupportedCausalInference", decision: "PERSONAL_CAUSE_ASSERTED", rationale: "Synthetic counterexample" }], rationale: "Synthetic adjudication" }).success);
});
test("D1 old annotations default missing axes to NOT_EVALUATED and preserve explicit NA", () => {
  const { value } = fixture(); const old = AnnotationSchema.parse(value);
  assert.equal(old.units[0].personalApplicability, "NOT_EVALUATED"); assert.equal(old.units[0].unsupportedCausalInference, "NOT_EVALUATED");
  assert.equal(AnnotationSchema.parse({ ...value, units: [{ ...value.units[0], personalApplicability: "NOT_APPLICABLE", unsupportedCausalInference: "NOT_APPLICABLE" }] }).units[0].personalApplicability, "NOT_APPLICABLE");
});
test("D1 strict schema rejects unknown fields, null enum labels and references outside packet", () => {
  const { packet, value } = fixture();
  for (const unit of [{ ...value.units[0], scientificPass: true }, { ...value.units[0], personalApplicability: null }, { ...value.units[0], unsupportedCausalInference: "SUPPORTED" }]) assert.equal(AnnotationSchema.safeParse({ ...value, units: [unit] }).success, false);
  assert.equal(AnnotationSchema.safeParse({ ...value, scientificPass: true }).success, false);
  assert.throws(() => validateAnnotation({ ...value, units: [{ ...value.units[0], references: { unitIds: [], factIds: ["NOT_IN_PACKET"], sourceIds: [], excerptIds: [] } }] }, packet), /ReferenceNotInPacket/);
});
