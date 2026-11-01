import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { input, answer, observation } from "./advisory-content-v3.fixtures";
import type { AdvisoryInput } from "../evaluation/advisory-progress/experiment";

const attendance: AdvisoryInput = { ...input, facts: input.facts.filter((f) => f.id === "F_ADHERENCE"), question: "Tôi tập đều. Sức mạnh của tôi tiến bộ chưa?" };
const a = () => ({ ...answer(), claims: [{ claimType: "OBSERVATION" as const, text: "Dữ liệu hiện có chỉ mô tả tham gia tập luyện.", factIds: ["F_ADHERENCE"], evidenceIds: [] }] });
test("attendance cannot establish progress or no change, regardless of declared basis", () => {
  for (const assessment of ["OBSERVED_PROGRESS", "NO_OBSERVED_CHANGE"] as const) for (const outcome of ["ESTIMATED_STRENGTH", "MUSCLE_SIZE", "UNSPECIFIED"] as const) {
    const result = evaluateContentV3(attendance, { ...a(), assessment, assessmentBasis: { outcome, factIds: ["F_ADHERENCE"] } });
    assert.ok(result.contentIssues.some((i) => i.code === "ASSESSMENT_WITHOUT_OUTCOME_MEASUREMENT" && i.severity === "HARD"));
  }
  assert.notEqual(evaluateContentV3(attendance, { ...a(), assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] } }).contentGate, "BLOCKED");
});
test("muscle-size outcome cannot be established by e1RM, even with a false model basis", () => {
  const result = evaluateContentV3({ ...input, question: "e1RM tăng, kích thước cơ của tôi đã tăng chưa?" }, answer());
  assert.ok(result.contentIssues.some((i) => i.code === "ASSESSMENT_WITHOUT_OUTCOME_MEASUREMENT" && i.severity === "HARD"));
});
test("valid weight trajectory is an outcome; unknown measured kinds require review rather than blanket block", () => {
  const measured: AdvisoryInput = { ...attendance, question: "Cân nặng của tôi có thay đổi không?", facts: [{ id: "BODY", evidence: { domain: "BODY", kind: "OBSERVED_WEIGHT_TRAJECTORY", provenance: "MEASURED_INBODY", quality: "PARTIAL", window: { days: 28 }, claimBoundary: "DESCRIPTIVE_ONLY", value: { firstKg: 70, latestKg: 70, observations: 4 } } }] };
  const candidate = { ...a(), assessment: "NO_OBSERVED_CHANGE", assessmentBasis: { outcome: "UNSPECIFIED", factIds: ["BODY"] }, claims: [{ ...a().claims[0], factIds: ["BODY"] }] };
  assert.notEqual(evaluateContentV3(measured, candidate).contentGate, "BLOCKED");
  measured.facts[0].evidence.kind = "FUTURE_MEASURED_OUTCOME";
  assert.ok(evaluateContentV3(measured, candidate).contentIssues.some((i) => i.code === "OUTCOME_ADAPTER_REQUIRED"));
});
test("known projection with stale quality cannot establish current progress", () => {
  const stale = { ...input, facts: input.facts.map((f) => ({ ...f, evidence: { ...f.evidence, quality: "STALE" as const } })) };
  assert.ok(evaluateContentV3(stale, answer()).contentIssues.some((i) => i.code === "ASSESSMENT_WITHOUT_OUTCOME_MEASUREMENT"));
});
test("structured metric rejects exercise and unit mismatches", () => {
  for (const extra of [{ exerciseName: "Squat" }, { unit: "lb" as const }]) {
    const result = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), metricAssertion: { ...observation().metricAssertion!, ...extra } }] });
    assert.equal(result.contentGate, "BLOCKED");
    assert.ok(result.contentIssues.some((i) => /METRIC_(EXERCISE|UNIT)_MISMATCH/.test(i.code)));
  }
});
