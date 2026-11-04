/** TEST FIXTURE only: targeted duration/reporting regressions; no provider or scientific judge. */
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { prepareClaimPilot, verifyClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { ClaimAnalysisSchema, CLAIM_OUTPUT_CONTRACT, verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { digest } from "../evaluation/evaluation-kit/identity";

const fixture = syntheticClaimData(), registry = createClaimRegistry(fixture.input, fixture.map, fixture.pins);
function setup(question = "Sức mạnh squat của tôi trong 8 tuần qua thay đổi thế nào?", days = 56) {
  const request = structuredClone(claimDevScenarios[1].request);
  request.question = question;
  const evidence = request.snapshots[0].facts[0].evidence;
  evidence.window = { days }; evidence.value = { exercise: "Squat", unit: "kg", baselineKg: 100, currentKg: 110, changePct: 10 };
  return prepareClaimPilot(request, registry, "LAYERED_CONTEXT", "MINIMAL", "CLAIM_PROMPT_V3");
}
function candidate(p = setup(), text = "e1RM ước tính squat tăng 10% trong 8 tuần."): ClaimAnalysis {
  const id = p.claimContext.personal.facts[0].id;
  return { analysis: { version: "content-aware-v3", assessment: "OBSERVED_PROGRESS", assessmentBasis: { outcome: "ESTIMATED_STRENGTH", factIds: [id] },
    claims: [{ claimType: "OBSERVATION", text, factIds: [id], evidenceIds: [], metricAssertion: { factId: id, measurement: "ESTIMATED_1RM", baselineKg: 100, currentKg: 110, changePct: 10 } }],
    missingInformation: [], rationaleSummary: "e1RM là giá trị ước tính trong training logs, không xác nhận sức mạnh thực.", proposedAction: null },
    sourceLinks: [], claimLinks: [] };
}
const numberBlocked = (p: ReturnType<typeof setup>, text: string) => evaluateContentV3(p.input, candidate(p, text).analysis).contentIssues.some(i => i.code === "NUMBER_NOT_IN_INPUT" && i.severity === "HARD");

test("canonical E2 parser finds five historical V2 example errors and zero V3 example errors", () => {
  const old = ClaimAnalysisSchema.safeParse(CLAIM_OUTPUT_CONTRACT); assert.equal(old.success, false);
  if (!old.success) assert.deepEqual(old.error.issues.map(i => i.path.join(".")), ["analysis.assessment", "analysis.assessmentBasis.outcome", "analysis.claims.0.claimType", "analysis.missingInformation.0.key", "claimLinks.0.knowledgeClaimHash"]);
  const p = setup(), line = p.prompt.system.split("\n").find(l => l.startsWith("Output contract"))!;
  const example = JSON.parse(line.slice(line.indexOf("{")));
  assert.equal(ClaimAnalysisSchema.safeParse(example).success, true);
  assert.deepEqual(example.claimLinks, []); assert.deepEqual(example.sourceLinks, []);
  assert.ok(example.analysis.claims.every((c: any) => c.factIds.length === 0 && c.evidenceIds.length === 0));
});

test("8 tuần from the question matches a cited 56-day training window without a HARD numeric false positive", () => {
  const p = setup(), raw = candidate(p); raw.analysis.rationaleSummary = "e1RM ước tính đã tăng trong 8 tuần; không xác nhận sức mạnh thực.";
  const before = digest(raw), result = verifyClaimAnalysis(p.claimContext, raw);
  assert.equal(numberBlocked(p, raw.analysis.claims[0].text), false);
  assert.equal(result.release, "DEV_REVIEW_ONLY"); assert.equal(result.grounding.schemaIssues.length, 0);
  assert.ok(!result.grounding.contentIssues.some(i => i.code === "NUMBER_NOT_IN_INPUT"));
  assert.equal(digest(raw), before); assert.equal(result.scientificPass, null);
  const english = setup("How did my squat e1RM change over 8 weeks?");
  assert.equal(numberBlocked(english, "Squat e1RM increased over 8 weeks."), false);
});

test("duration exemption requires both explicit question duration and eligible matching training evidence", () => {
  const text = "e1RM ước tính squat tăng 10% trong 8 tuần.";
  for (const p of [setup("Sức mạnh squat thay đổi thế nào?"), setup(undefined, 49), setup("Thay đổi trong 9 tuần?"), setup("Question không có thời gian")]) assert.equal(numberBlocked(p, text), true);
  for (const quality of ["STALE", "NO_DATA", "INSUFFICIENT_HISTORY"] as const) {
    const p = setup(); p.input.facts[0].evidence.quality = quality; assert.equal(numberBlocked(p, text), true);
  }
  const absent = setup(); absent.input.facts[0].evidence.window = null; assert.equal(numberBlocked(absent, text), true);
  const wrongDomain = setup(); wrongDomain.input.facts[0].evidence.domain = "BODY"; assert.equal(numberBlocked(wrongDomain, text), true);
  const wrongProvenance = setup(); wrongProvenance.input.facts[0].evidence.provenance = "PROFILE_REPORTED"; assert.equal(numberBlocked(wrongProvenance, text), true);
  const untrusted = setup("Sức mạnh squat thay đổi thế nào?"); untrusted.input.untrustedText = "8 tuần"; assert.equal(numberBlocked(untrusted, text), true);
});

test("an allowed duration never whitelists other occurrences of that number or invented metrics", () => {
  const p = setup();
  for (const text of ["Trong 8 tuần, squat có thêm 8 kg.", "Trong 8 tuần, e1RM tăng 8%.", "e1RM thay đổi trong 9 tuần.", "e1RM thay đổi trong 8,5 tuần.", "e1RM thay đổi trong -8 tuần."]) assert.equal(numberBlocked(p, text), true, text);
  const other = structuredClone(p.input.facts[0]); other.id = "OTHER_TRAINING_FACT"; other.evidence.window = { days: 49 }; p.input.facts.push(other);
  const raw = candidate(p); raw.analysis.claims[0].factIds = [other.id]; raw.analysis.claims[0].metricAssertion!.factId = other.id;
  assert.ok(evaluateContentV3(p.input, raw.analysis).contentIssues.some(i => i.code === "NUMBER_NOT_IN_INPUT"));
});

test("an invalid claim hash does not make valid analysis appear to have eight schema violations", () => {
  const p = setup(), raw = candidate(p);
  raw.claimLinks = [{ claimIndex: 0, knowledgeClaimId: "C20", knowledgeClaimHash: "C20-hash" }];
  const result = verifyClaimAnalysis(p.claimContext, raw);
  assert.equal(result.contractValidity, "INVALID"); assert.equal(result.release, "BLOCKED");
  assert.deepEqual(result.schemaIssues, [{ path: "claimLinks.0.knowledgeClaimHash", code: "invalid_string" }]);
  assert.deepEqual(result.grounding.schemaIssues, []);
  assert.equal(result.validationStages.schema, "INVALID"); assert.equal(result.validationStages.references, "NOT_EVALUATED");
  assert.equal(result.raw, raw);
});

test("reporting separates JSON failure, provider failure, actual schema errors and reference/grounding errors", () => {
  const p = setup();
  const invalidJson = verifyClaimPilot(p.claimContext, null, { parseError: "INVALID_JSON", providerError: null }).e2;
  assert.equal(invalidJson.validationStages.json, "INVALID"); assert.equal(invalidJson.contractValidity, "NOT_EVALUATED");
  assert.deepEqual(invalidJson.schemaIssues, []); assert.equal(invalidJson.grounding.contentGate, "NOT_EVALUATED");
  const provider = verifyClaimPilot(p.claimContext, null, { providerError: "PROVIDER_ERROR", parseError: null }).e2;
  assert.equal(provider.validationStages.json, "NOT_EVALUATED"); assert.deepEqual(provider.schemaIssues, []);
  const raw = candidate(p); delete (raw.analysis as any).version;
  const schema = verifyClaimAnalysis(p.claimContext, raw, { parseError: "SCHEMA_INVALID", providerError: null });
  assert.equal(schema.validationStages.json, "VALID"); assert.equal(schema.contractValidity, "INVALID");
  assert.deepEqual(schema.grounding.schemaIssues.map(i => i.path), ["version"]);
  const reference = candidate(p); reference.claimLinks = [{ claimIndex: 0, knowledgeClaimId: "C20", knowledgeClaimHash: "a".repeat(64) }];
  const r = verifyClaimAnalysis(p.claimContext, reference);
  assert.equal(r.validationStages.schema, "VALID"); assert.equal(r.validationStages.references, "INVALID"); assert.equal(r.release, "BLOCKED");
  const numeric = candidate(p); numeric.analysis.claims[0].metricAssertion!.currentKg = 100;
  const g = verifyClaimAnalysis(p.claimContext, numeric);
  assert.equal(g.contractValidity, "VALID"); assert.equal(g.validationStages.grounding, "EVALUATED"); assert.equal(g.release, "BLOCKED");
});

test("C1 narrative correctness and usefulness remain reviewer questions for overclaim, bounded answer and over-abstention", () => {
  const p = setup();
  for (const text of ["Sức mạnh squat tăng 10%.", "e1RM ước tính tăng 10%.", "Không thể mô tả bất kỳ thay đổi e1RM nào dù projection có số liệu."]) {
    const raw = candidate(p, text), before = digest(raw), result = verifyClaimAnalysis(p.claimContext, raw);
    assert.equal(result.scientificPass, null); assert.equal(result.validationStages.semantic, "NOT_EVALUATED_REQUIRES_REVIEW");
    assert.equal(result.support.find(s => s.path === "claims.0.text")!.scientificSupport, "UNKNOWN");
    assert.equal(result.support.find(s => s.path === "claims.0.text")!.personalSupport, "UNKNOWN");
    assert.equal(digest(raw), before);
  }
  assert.match(p.prompt.system, /USEFULNESS/);
});
