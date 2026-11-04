/** TEST FIXTURE / CODE AUDIT: public synthetic registry only; no AWS, real run data or independent gold. */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { buildClaimPrompt, ClaimAnalysisSchema, verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { prepareClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { digest } from "../evaluation/evaluation-kit/identity";
import { approvedConfigurationHash, parseConfiguration } from "../evaluation/bedrock-pilot/config";

const fixture = syntheticClaimData(), registry = createClaimRegistry(fixture.input, fixture.map, fixture.pins);
const prepared = (arm: "LAYERED_CONTEXT" | "LAYERED_CONTEXT_RAG", scenario = 0) =>
  prepareClaimPilot(claimDevScenarios[scenario].request, registry, arm, "MINIMAL", "CLAIM_PROMPT_V3");

function response(p: ReturnType<typeof prepared>, withScience = false): ClaimAnalysis {
  const u = JSON.parse(p.prompt.user), facts = [...u.userFacts.facts, ...u.trainingObservations.facts];
  const claims: ClaimAnalysis["analysis"]["claims"] = facts.map((f: any) => ({ claimType: "OBSERVATION", text: "Nhật ký ghi nhận projection: " + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [],
    ...(f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: f.id, measurement: "ESTIMATED_1RM" as const,
      baselineKg: Number(f.evidence.value.baselineKg), currentKg: Number(f.evidence.value.currentKg), changePct: Number(f.evidence.value.changePct) } } : {}) }));
  const answer: ClaimAnalysis = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims, missingInformation: [{ key: "outcome_measurement", question: "Có thêm phép đo trực tiếp theo cùng điều kiện để đối chiếu không?" }],
    rationaleSummary: "Dữ liệu mô tả thay đổi trong log; chưa xác nhận sức mạnh tối đa hay kích thước cơ.", proposedAction: null }, sourceLinks: [], claimLinks: [] };
  if (withScience) {
    const k = u.approvedScientificKnowledge[0]; assert.ok(k, "synthetic RAG must have a scientific claim");
    const bound = u.evidenceProvenance.filter((e: any) => e.kind === "PRIMARY_SCIENTIFIC" && e.knowledgeClaimIds.includes(k.id));
    const sourceIds = [...new Set<string>(bound.map((e: any) => e.sourceId))]; assert.ok(sourceIds.length);
    const claimIndex = answer.analysis.claims.length;
    answer.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: k.displayTextVi, factIds: [], evidenceIds: sourceIds });
    answer.claimLinks.push({ claimIndex, knowledgeClaimId: k.id, knowledgeClaimHash: k.claimHash });
    answer.sourceLinks = sourceIds.map(sourceId => ({ claimIndex, sourceId, excerptIds: bound.filter((e: any) => e.sourceId === sourceId).map((e: any) => e.excerptId) }));
  }
  return answer;
}
function identityBlocked(p: ReturnType<typeof prepared>, candidate: unknown, reason: string) {
  const before = digest(candidate), result = verifyClaimAnalysis(p.claimContext, candidate);
  assert.equal(result.contractValidity, "VALID", "identity errors are distinct from schema errors");
  assert.equal(result.release, "BLOCKED"); assert.ok(result.identityIssues.includes(reason), JSON.stringify(result.identityIssues));
  assert.equal(result.candidate, null); assert.equal(result.raw, candidate); assert.equal(digest(candidate), before, "never repair raw output");
  assert.equal(result.scientificPass, null); return result;
}

test("V3 rejects product-policy C20 as a scientific claimLink even when its shape is valid", () => {
  const p = prepared("LAYERED_CONTEXT"), answer = response(p);
  assert.deepEqual(JSON.parse(p.prompt.user).allowedReferences.knowledgeClaims, []);
  assert.ok(p.claimContext.payload.productPolicies.some(c => c.id === "C20"));
  answer.claimLinks = [{ claimIndex: 0, knowledgeClaimId: "C20", knowledgeClaimHash: "a".repeat(64) }];
  identityBlocked(p, answer, "INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM");
});

test("V3 rejects a fabricated 64-hex hash for an otherwise allowed scientific claim", () => {
  const p = prepared("LAYERED_CONTEXT_RAG"), answer = response(p, true);
  assert.notEqual(answer.claimLinks[0].knowledgeClaimHash, "f".repeat(64));
  answer.claimLinks[0].knowledgeClaimHash = "f".repeat(64);
  identityBlocked(p, answer, "INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM");
});

test("missing or malformed claimLinks is a schema failure, not an eligible scientific response", () => {
  const p = prepared("LAYERED_CONTEXT"), answer = response(p), { claimLinks: _removed, ...missing } = answer;
  for (const invalid of [missing, { ...answer, claimLinks: "C20" }, { ...answer, claimLinks: [{ claimIndex: 0, knowledgeClaimId: "C20", knowledgeClaimHash: "not-a-hash" }] }]) {
    const before = digest(invalid), result = verifyClaimAnalysis(p.claimContext, invalid);
    assert.equal(result.contractValidity, "INVALID"); assert.equal(result.release, "BLOCKED");
    assert.ok(result.schemaIssues.some(i => i.path.startsWith("claimLinks"))); assert.equal(result.candidate, null);
    assert.equal(result.raw, invalid); assert.equal(digest(invalid), before); assert.equal(result.scientificPass, null);
  }
});

test("V3 rejects sourceLinks that name an unavailable excerpt", () => {
  const p = prepared("LAYERED_CONTEXT_RAG"), answer = response(p, true);
  answer.sourceLinks[0].excerptIds = ["EXCERPT_NOT_PROVIDED"];
  identityBlocked(p, answer, "INVALID_EXCERPT_BINDING");
});

test("empty scientific knowledge cannot support fabricated evidence IDs", () => {
  const p = prepared("LAYERED_CONTEXT"), answer = response(p), user = JSON.parse(p.prompt.user);
  assert.deepEqual(user.approvedScientificKnowledge, []); assert.deepEqual(user.allowedReferences.scientificSources, []);
  answer.analysis.claims[0].evidenceIds = ["SCIENCE_NOT_PROVIDED"];
  identityBlocked(p, answer, "INVALID_REFERENCE_NAMESPACE");
});

test("a valid Context response uses only provided facts and empty scientific links", () => {
  const p = prepared("LAYERED_CONTEXT"), answer = response(p), result = verifyClaimAnalysis(p.claimContext, answer);
  assert.ok(ClaimAnalysisSchema.safeParse(answer).success); assert.equal(result.contractValidity, "VALID");
  assert.deepEqual(result.identityIssues, []); assert.equal(result.release, "DEV_REVIEW_ONLY");
  assert.deepEqual(answer.claimLinks, []); assert.deepEqual(answer.sourceLinks, []); assert.equal(result.raw, answer);
  assert.equal(result.scientificPass, null); assert.equal(result.independentScientificValidation, false);
});

test("a valid RAG response uses exact allowed claim hashes and bound scientific excerpts", () => {
  const p = prepared("LAYERED_CONTEXT_RAG"), answer = response(p, true), result = verifyClaimAnalysis(p.claimContext, answer);
  const allowed = JSON.parse(p.prompt.user).allowedReferences;
  for (const link of answer.claimLinks) assert.ok(allowed.knowledgeClaims.some((k: any) => k.id === link.knowledgeClaimId && k.hash === link.knowledgeClaimHash));
  for (const link of answer.sourceLinks) for (const excerptId of link.excerptIds) assert.ok(allowed.scientificSources.some((s: any) => s.sourceId === link.sourceId && s.excerptId === excerptId));
  assert.equal(result.contractValidity, "VALID"); assert.deepEqual(result.identityIssues, []); assert.equal(result.release, "DEV_REVIEW_ONLY");
  assert.equal(result.raw, answer); assert.equal(result.scientificPass, null, "reference identity is not scientific entailment");
});

test("V3 provides a directly schema-valid JSON example and explicit reference/measurement instructions", () => {
  for (const arm of ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"] as const) {
    const p = prepared(arm), lines = p.prompt.system.split("\n").filter(l => l.startsWith("Output contract"));
    assert.equal(lines.length, 1); const example = JSON.parse(lines[0].slice(lines[0].indexOf("{")));
    assert.ok(ClaimAnalysisSchema.safeParse(example).success, JSON.stringify(ClaimAnalysisSchema.safeParse(example).error?.issues));
    assert.ok(Array.isArray(example.analysis.assessmentBasis.factIds)); assert.ok(Array.isArray(example.sourceLinks)); assert.ok(Array.isArray(example.claimLinks));
    const system = p.prompt.system;
    for (const identifier of ["allowedReferences.knowledgeClaims", "C20", "C23", "C24", "ESTIMATED_1RM", "DIRECT_1RM", "e1RM"]) assert.ok(system.includes(identifier), identifier);
    assert.match(system, /claimLinks\s*:\s*\[\s*\]/); assert.match(system, /sourceLinks\s*:\s*\[\s*\]/);
  }
});

test("structured e1RM cannot become DIRECT_1RM; copied metrics never verify prose or causal claims", () => {
  const p = prepared("LAYERED_CONTEXT", 1), answer = response(p);
  answer.analysis.claims[0].text = "Sức mạnh thực sự đã tăng chắc chắn nhờ hiệu quả chương trình tập luyện.";
  answer.analysis.rationaleSummary = "Chương trình gây ra sự tăng sức mạnh thực sự của bạn.";
  const review = verifyClaimAnalysis(p.claimContext, answer);
  assert.equal(review.support.length, review.coverage.accountedTextUnits);
  for (const path of ["claims.0.text", "rationaleSummary"]) {
    const unit = review.support.find(s => s.path === path); assert.ok(unit);
    assert.equal(unit.scientificSupport, "UNKNOWN"); assert.equal(unit.personalSupport, "UNKNOWN");
    assert.equal(unit.verifiedSupport, "UNVERIFIED");
  }
  assert.equal(review.scientificPass, null); assert.equal(review.verificationDisposition, "REQUIRES_SEMANTIC_REVIEW");
  answer.analysis.claims[0].metricAssertion!.measurement = "DIRECT_1RM";
  const contradicted = verifyClaimAnalysis(p.claimContext, answer);
  assert.equal(contradicted.contractValidity, "VALID"); assert.equal(contradicted.release, "BLOCKED");
  assert.equal(contradicted.raw, answer); assert.equal(contradicted.scientificPass, null);
});

test("an e1RM observation does not force the scope of a muscle-size assessment", () => {
  const p = prepared("LAYERED_CONTEXT", 4);
  assert.match(p.claimContext.personal.request.question, /cơ ngực/);
  for (const outcome of ["MUSCLE_SIZE", "UNSPECIFIED"] as const) {
    const answer = response(p);
    answer.analysis.assessmentBasis = { outcome, factIds: [] };
    const result = verifyClaimAnalysis(p.claimContext, answer);
    assert.equal(result.contractValidity, "VALID");
    assert.deepEqual(result.identityIssues, []);
    assert.equal(result.release, "DEV_REVIEW_ONLY");
    assert.equal(result.scientificPass, null);
  }
  assert.match(p.prompt.system, /Chọn assessmentBasis\.outcome theo câu hỏi\/assessmentTask/);
});

test("historical V1/V2 synthetic prompts remain byte-identical to reviewed cb7d020c outputs", () => {
  // Captured from untouched e3-nova-live-pinned checkout before V3 implementation, not regenerated expected values.
  const pins = {
    LAYERED_CONTEXT: { CLAIM_PROMPT_V1: "25f464fdbf15d61b42793911d89197c818abdf956a8234f0dff1cae46819a8c8", CLAIM_PROMPT_V2: "bb589b60c92296c3600aa8068b962b2145499d3159f5e7e6b3f53f67ae67503e" },
    LAYERED_CONTEXT_RAG: { CLAIM_PROMPT_V1: "22dc9ec4a4993476a8d39d308b0faca7224f3d92eeeec71d07667d79e003b10c", CLAIM_PROMPT_V2: "d8ea7bca57e9eb02d1a81573db1baf2af54e194ea609269aef68994147cc901c" },
  };
  for (const arm of ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"] as const) for (const version of ["CLAIM_PROMPT_V1", "CLAIM_PROMPT_V2"] as const) {
    const historical = prepareClaimPilot(claimDevScenarios[0].request, registry, arm, "MINIMAL", version);
    assert.equal(digest({ system: historical.prompt.system, user: historical.prompt.user }), pins[arm][version]);
    const v3 = prepared(arm); assert.deepEqual(v3.claimContext, historical.claimContext); assert.deepEqual(v3.evidence, historical.evidence);
  }
});

test("V3 is explicit and Nova-only; changing prompt version invalidates the historical configuration binding", () => {
  assert.throws(() => buildClaimPrompt(prepared("LAYERED_CONTEXT").claimContext, "CLAIM_PROMPT_UNKNOWN" as never), /CLAIM_PROMPT_VERSION_UNSUPPORTED/);
  const c = pilotConfig();
  Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", region: "us-east-1", promptVersion: "CLAIM_PROMPT_V3", outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY",
    design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
    budget: { ...c.budget, maxCalls: 8, maxOutputTokens: 16388 },
    sources: { workspaceRoot: process.cwd(), casesFile: path.join(process.cwd(), "synthetic-unused-cases.json"), claimRegistryConfigFile: path.join(process.cwd(), "synthetic-unused-registry.json") } });
  c.pricing.region = "us-east-1";
  assert.equal(parseConfiguration(c).promptVersion, "CLAIM_PROMPT_V3");
  const historical = { ...c, promptVersion: "CLAIM_PROMPT_V2" as const };
  assert.equal(parseConfiguration(historical).promptVersion, "CLAIM_PROMPT_V2");
  assert.notEqual(approvedConfigurationHash(c), approvedConfigurationHash(historical), "V2 approval configHash cannot authorize V3; no approval is created here");
  assert.throws(() => parseConfiguration({ ...c, transportProtocol: undefined }), /NOVA_V3_PROMPT_ONLY/);
  assert.throws(() => parseConfiguration({ ...c, transportProtocol: "MANTLE_MESSAGES", modelId: "anthropic.claude-haiku-4-5", region: "us-east-2" }), /NOVA_V3_PROMPT_ONLY/);
  assert.throws(() => parseConfiguration({ ...c, promptVersion: undefined }), /NOVA_PROMPT_VERSION_REQUIRED/);
  assert.throws(() => parseConfiguration({ ...c, promptVersion: "CLAIM_PROMPT_V1" }), /NOVA_PROMPT_VERSION_REQUIRED/);
  assert.throws(() => parseConfiguration({ ...c, mode: "LIVE", liveOptIn: true }));
  assert.throws(() => parseConfiguration({ ...c, parameters: { ...c.parameters, retries: 1 } }), /CONFIG_INVALID/);
});
