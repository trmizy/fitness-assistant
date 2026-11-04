/** TEST FIXTURE only: V3 must not force over-caution. Deterministic gate outcomes for a bounded e1RM answer and an
 * over-abstaining answer on the same SUFFICIENT e1RM fact. Neither outcome is semantic validation or usefulness scoring. */
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { prepareClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";

const fixture = syntheticClaimData(), registry = createClaimRegistry(fixture.input, fixture.map, fixture.pins);
function setup() {
  const request = structuredClone(claimDevScenarios[1].request);
  request.question = "Sức mạnh squat của tôi trong 8 tuần qua thay đổi thế nào?";
  const evidence = request.snapshots[0].facts[0].evidence;
  evidence.window = { days: 56 }; evidence.value = { exercise: "Squat", unit: "kg", baselineKg: 100, currentKg: 110, changePct: 10 };
  return prepareClaimPilot(request, registry, "LAYERED_CONTEXT", "MINIMAL", "CLAIM_PROMPT_V3");
}
const envelope = (analysis: ClaimAnalysis["analysis"]): ClaimAnalysis => ({ analysis, sourceLinks: [], claimLinks: [] });

test("a bounded estimated-1RM answer using the asked 8-week window is not blocked by the deterministic gate", () => {
  const p = setup(), id = p.claimContext.personal.facts[0].id;
  const result = verifyClaimAnalysis(p.claimContext, envelope({ version: "content-aware-v3", assessment: "OBSERVED_PROGRESS", assessmentBasis: { outcome: "ESTIMATED_STRENGTH", factIds: [id] },
    claims: [
      { claimType: "OBSERVATION", text: "e1RM ước tính của squat tăng từ 100 lên 110 kg, tương ứng 10% trong 8 tuần.", factIds: [id], evidenceIds: [], metricAssertion: { factId: id, measurement: "ESTIMATED_1RM", baselineKg: 100, currentKg: 110, changePct: 10 } },
      { claimType: "MEASUREMENT_LIMITATION", text: "e1RM là ước tính từ log, không phải kết quả kiểm tra 1RM trực tiếp.", factIds: [id], evidenceIds: [] }],
    missingInformation: [{ key: "outcome_measurement", question: "Bạn có kết quả kiểm tra 1RM trực tiếp để đối chiếu không?" }],
    rationaleSummary: "Trong 8 tuần, e1RM ước tính của squat tăng khoảng 10%; đây là ước tính, chưa phải kết quả kiểm tra 1RM.", proposedAction: null }));
  assert.equal(result.release, "DEV_REVIEW_ONLY", JSON.stringify(result.grounding.contentIssues));
  assert.deepEqual(result.grounding.contentIssues.filter(i => i.severity === "HARD"), []);
  assert.equal(result.validationStages.semantic, "NOT_EVALUATED_REQUIRES_REVIEW"); assert.equal(result.scientificPass, null);
});

test("an answer that abstains although a SUFFICIENT estimated-1RM fact answers the question is blocked (facts not addressed)", () => {
  const p = setup();
  const result = verifyClaimAnalysis(p.claimContext, envelope({ version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [{ claimType: "MEASUREMENT_LIMITATION", text: "Chưa đủ dữ liệu để biết sức mạnh squat thay đổi thế nào.", factIds: [], evidenceIds: [] }],
    missingInformation: [{ key: "other", question: "Bạn có thêm dữ liệu tập luyện không?" }],
    rationaleSummary: "Chưa đủ dữ liệu để kết luận về thay đổi sức mạnh squat.", proposedAction: null }));
  assert.equal(result.release, "BLOCKED");
  assert.ok(result.grounding.contentIssues.some(i => i.severity === "HARD" && i.code === "FACTS_NOT_ADDRESSED"), JSON.stringify(result.grounding.contentIssues));
});
