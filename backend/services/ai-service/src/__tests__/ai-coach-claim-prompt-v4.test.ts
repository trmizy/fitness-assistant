/** TEST FIXTURE / CODE AUDIT: synthetic registry and a fake Nova IO only; no AWS, no real run data, no gold labels. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { CLAIM_V4_ENUMS, ClaimAnalysisSchema, completeClaimEnvelopeV4, SERVER_DERIVED_EMPTY_ALLOWLIST, verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { AnswerV3Schema, ClaimTypeSchema, MissingInformationV3Schema } from "../evaluation/advisory-progress/content-aware-v3-schema";
import { prepareClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { createFakeNovaTransport, NOVA_MODEL, NOVA_REGION } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { digest } from "../evaluation/evaluation-kit/identity";

const fixture = syntheticClaimData(), registry = createClaimRegistry(fixture.input, fixture.map, fixture.pins);
const prepared = (arm: "LAYERED_CONTEXT" | "LAYERED_CONTEXT_RAG", version: "CLAIM_PROMPT_V3" | "CLAIM_PROMPT_V4" = "CLAIM_PROMPT_V4", scenario = 0) =>
  prepareClaimPilot(claimDevScenarios[scenario].request, registry, arm, "MINIMAL", version);
/** CAL01/CAL06-shaped synthetic cases (same fact kind, values and window as the warmup cases). */
function warmupLike(kind: "INCREASE" | "UNCHANGED") {
  const request = structuredClone(claimDevScenarios[1].request);
  request.question = kind === "INCREASE" ? "Sức mạnh squat của tôi trong 8 tuần qua thay đổi thế nào?" : "Tôi có cần tăng tạ để tiến bộ không?";
  const evidence = request.snapshots[0].facts[0].evidence;
  evidence.quality = "SUFFICIENT"; evidence.window = { days: 56 };
  evidence.value = kind === "INCREASE" ? { exercise: "Squat", unit: "kg", baselineKg: 100, currentKg: 110, changePct: 10 } : { exercise: "Bench Press", unit: "kg", baselineKg: 80, currentKg: 80, changePct: 0 };
  return prepareClaimPilot(request, registry, "LAYERED_CONTEXT", "MINIMAL", "CLAIM_PROMPT_V4");
}
const analysisFor = (p: ReturnType<typeof warmupLike>, kind: "INCREASE" | "UNCHANGED"): ClaimAnalysis["analysis"] => {
  const id = p.claimContext.personal.facts[0].id, inc = kind === "INCREASE";
  return { version: "content-aware-v3", assessment: inc ? "OBSERVED_PROGRESS" : "NO_OBSERVED_CHANGE", assessmentBasis: { outcome: "ESTIMATED_STRENGTH", factIds: [id] },
    claims: [
      { claimType: "OBSERVATION", text: inc ? "e1RM ước tính của squat từ 100 lên 110 kg, 10% trong 56 ngày." : "e1RM ước tính của bench press giữ ở 80 kg trong 56 ngày.", factIds: [id], evidenceIds: [],
        metricAssertion: { factId: id, measurement: "ESTIMATED_1RM", baselineKg: inc ? 100 : 80, currentKg: inc ? 110 : 80, changePct: inc ? 10 : 0 } },
      { claimType: "MEASUREMENT_LIMITATION", text: inc ? "e1RM là ước tính từ log, không phải kết quả kiểm tra 1RM trực tiếp." : "e1RM ước tính không đổi chưa cho biết số lần lặp, kỹ thuật hay khối lượng có thay đổi không.", factIds: [id], evidenceIds: [] }],
    missingInformation: [{ key: inc ? "outcome_measurement" : "program_load_history", question: inc ? "Bạn có kết quả kiểm tra 1RM trực tiếp để đối chiếu không?" : "Mức tạ và số lần lặp của bạn thay đổi thế nào trong 56 ngày qua?" }],
    rationaleSummary: inc ? "e1RM ước tính của squat tăng khoảng 10% trong 56 ngày; đây là ước tính, chưa phải kết quả kiểm tra 1RM." : "e1RM ước tính không đổi trong 56 ngày; chưa đủ để kết luận về việc tăng tạ hay về tiến bộ ở mọi khía cạnh.",
    proposedAction: null };
};
// Shape of the two preserved run-2 outputs (invalid assessment enum + product-policy C20 link with an invented short hash).
const run2Shaped = (p: ReturnType<typeof warmupLike>, hash = "5f4dcc3b5aa765d61d8327deb882cf99") => ({ analysis: { ...analysisFor(p, "INCREASE"), assessment: "SUFFICIENT_DATA" }, sourceLinks: [],
  claimLinks: [{ claimIndex: 0, knowledgeClaimId: "C20", knowledgeClaimHash: hash }] });

test("historical V1/V2/V3 synthetic prompts stay byte-identical; V4 reuses the V3 user payload and full private context", () => {
  // V1/V2 from the cb7d020c review (see ai-coach-claim-prompt-v3.test.ts); V3 captured from c49e0991 before V4 was added.
  const pins = {
    LAYERED_CONTEXT: { CLAIM_PROMPT_V1: "25f464fdbf15d61b42793911d89197c818abdf956a8234f0dff1cae46819a8c8", CLAIM_PROMPT_V2: "bb589b60c92296c3600aa8068b962b2145499d3159f5e7e6b3f53f67ae67503e", CLAIM_PROMPT_V3: "7c3d66819dbdf1aac5f0398d45d7ea3f3d66594f45b1cc89d415bec2e1ee4bc6" },
    LAYERED_CONTEXT_RAG: { CLAIM_PROMPT_V1: "22dc9ec4a4993476a8d39d308b0faca7224f3d92eeeec71d07667d79e003b10c", CLAIM_PROMPT_V2: "d8ea7bca57e9eb02d1a81573db1baf2af54e194ea609269aef68994147cc901c", CLAIM_PROMPT_V3: "83ddff47d52d539e6c3669ef5a834f2ff9a187c31fcc3b6ad0b0c74323996d69" },
  };
  for (const arm of ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"] as const) {
    for (const version of ["CLAIM_PROMPT_V1", "CLAIM_PROMPT_V2", "CLAIM_PROMPT_V3"] as const) {
      const h = prepareClaimPilot(claimDevScenarios[0].request, registry, arm, "MINIMAL", version);
      assert.equal(digest({ system: h.prompt.system, user: h.prompt.user }), pins[arm][version], `${arm} ${version}`);
    }
    const v3 = prepared(arm, "CLAIM_PROMPT_V3"), v4 = prepared(arm);
    assert.equal(v4.prompt.user, v3.prompt.user); assert.deepEqual(v4.claimContext, v3.claimContext); assert.deepEqual(v4.evidence, v3.evidence);
    assert.notEqual(v4.prompt.system, v3.prompt.system);
  }
  assert.equal(prepared("LAYERED_CONTEXT").prompt.system, prepared("LAYERED_CONTEXT_RAG").prompt.system, "one system message for both arms");
});

test("V4 system lists every canonical enum value, invents none, and carries no worked JSON instance or placeholder references", () => {
  const system = prepared("LAYERED_CONTEXT").prompt.system, a = AnswerV3Schema.innerType().shape;
  assert.deepEqual([...CLAIM_V4_ENUMS.assessment], [...a.assessment.options]);
  assert.deepEqual([...CLAIM_V4_ENUMS.outcome], [...a.assessmentBasis.shape.outcome.options]);
  assert.deepEqual([...CLAIM_V4_ENUMS.missingKey], [...MissingInformationV3Schema.shape.key.options]);
  assert.deepEqual([...CLAIM_V4_ENUMS.claimType], ClaimTypeSchema.options.filter(t => t !== "PERSONAL_RECOMMENDATION"));
  const enumLine = system.split("\n").find(l => l.startsWith("ENUM"))!;
  for (const v of [...CLAIM_V4_ENUMS.assessment, ...CLAIM_V4_ENUMS.outcome, ...CLAIM_V4_ENUMS.claimType, ...CLAIM_V4_ENUMS.missingKey, ...CLAIM_V4_ENUMS.measurement]) assert.ok(enumLine.includes(v), v);
  assert.doesNotMatch(system, /(?<![A-Z_])SUFFICIENT_DATA/, "no invented assessment value");
  assert.doesNotMatch(enumLine, /PERSONAL_RECOMMENDATION/);
  assert.doesNotMatch(system, /existing-|\b[a-f0-9]{32}\b|\b[a-f0-9]{64}\b/, "no placeholder or hash-like reference");
  assert.ok(!system.includes("{\"analysis\""), "no worked JSON instance to copy");
  for (const copied of ["Có phép đo trực tiếp theo cùng protocol để đối chiếu không?", "Số liệu ước tính cần được diễn giải theo đúng phương pháp"]) assert.ok(!system.includes(copied), copied);
  assert.match(system, /TOP-LEVEL: nếu allowedReferences\.knowledgeClaims và allowedReferences\.scientificSources đều rỗng/);
  assert.match(system, /productPolicies \(C20\/C23\/C24\)/); assert.match(system, /e1RM ước tính/); assert.match(system, /không phải chẩn đoán plateau/);
});

test("empty allowlists: only an analysis-only output is completed, and the completion is recorded as server-derived", () => {
  const p = warmupLike("INCREASE"), raw = { analysis: analysisFor(p, "INCREASE") }, before = digest(raw);
  assert.deepEqual(JSON.parse(p.prompt.user).allowedReferences.knowledgeClaims, []);
  const done = completeClaimEnvelopeV4(p.prompt.user, raw);
  assert.equal(digest(raw), before, "model output object is not mutated");
  assert.deepEqual(done.derivation, { version: "claim-envelope-v4", fields: { sourceLinks: SERVER_DERIVED_EMPTY_ALLOWLIST, claimLinks: SERVER_DERIVED_EMPTY_ALLOWLIST },
    basis: "MODEL_FACING_ALLOWED_REFERENCES_EMPTY", modelOutputKeys: ["analysis"] });
  assert.ok(ClaimAnalysisSchema.safeParse(done.candidate).success);
  const verified = verifyClaimAnalysis(p.claimContext, done.candidate);
  assert.equal(verified.release, "DEV_REVIEW_ONLY", JSON.stringify(verified.grounding.contentIssues)); assert.equal(verified.validationStages.semantic, "NOT_EVALUATED_REQUIRES_REVIEW");
  // Anything but the exact analysis-only shape is judged as produced (never completed or repaired).
  for (const other of [run2Shaped(p), { analysis: raw.analysis, claimLinks: [] }, { analysis: raw.analysis, extra: 1 }, [raw], "text", null])
    assert.equal(completeClaimEnvelopeV4(p.prompt.user, other).derivation, null);
  assert.equal(completeClaimEnvelopeV4(p.prompt.user, { analysis: raw.analysis, sourceLinks: [], claimLinks: [] }).derivation, null, "a full canonical envelope is accepted as the model's own");
  assert.equal(completeClaimEnvelopeV4("not json", raw).derivation, null);
});

test("non-empty allowlists (RAG): an analysis-only output is not completed and fails the canonical schema", () => {
  const p = prepared("LAYERED_CONTEXT_RAG"); assert.ok(JSON.parse(p.prompt.user).allowedReferences.knowledgeClaims.length > 0);
  const done = completeClaimEnvelopeV4(p.prompt.user, { analysis: analysisFor(warmupLike("INCREASE"), "INCREASE") });
  assert.equal(done.derivation, null); assert.equal(ClaimAnalysisSchema.safeParse(done.candidate).success, false);
});

test("run-2 failure shapes stay failures: invalid assessment enum and C20 links (short or well-formed fake hash)", () => {
  const p = warmupLike("INCREASE"), r = run2Shaped(p);
  const issues = ClaimAnalysisSchema.safeParse(r); assert.equal(issues.success, false);
  if (!issues.success) assert.deepEqual(issues.error.issues.map(i => i.path.join(".")).sort(), ["analysis.assessment", "claimLinks.0.knowledgeClaimHash"]);
  const wellFormed = { ...run2Shaped(p, "f".repeat(64)), analysis: analysisFor(p, "INCREASE") };
  const v = verifyClaimAnalysis(p.claimContext, wellFormed);
  assert.equal(v.release, "BLOCKED"); assert.ok(v.identityIssues.includes("INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM"), JSON.stringify(v.identityIssues));
});

test("valid CAL01-like (OBSERVED_PROGRESS) and CAL06-like (NO_OBSERVED_CHANGE) analysis-only answers pass; over-abstention is blocked", () => {
  for (const kind of ["INCREASE", "UNCHANGED"] as const) {
    const p = warmupLike(kind), done = completeClaimEnvelopeV4(p.prompt.user, { analysis: analysisFor(p, kind) });
    const v = verifyClaimAnalysis(p.claimContext, done.candidate);
    assert.equal(v.release, "DEV_REVIEW_ONLY", `${kind}: ${JSON.stringify(v.grounding.contentIssues)}`);
    assert.deepEqual(v.grounding.contentIssues.filter(i => i.severity === "HARD"), []);
  }
  const p = warmupLike("INCREASE"), abstain = completeClaimEnvelopeV4(p.prompt.user, { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [{ claimType: "MEASUREMENT_LIMITATION", text: "Chưa đủ dữ liệu để biết sức mạnh squat thay đổi thế nào.", factIds: [], evidenceIds: [] }],
    missingInformation: [{ key: "other", question: "Bạn có thêm dữ liệu tập luyện không?" }], rationaleSummary: "Chưa đủ dữ liệu để kết luận về thay đổi sức mạnh squat.", proposedAction: null } });
  const v = verifyClaimAnalysis(p.claimContext, abstain.candidate);
  assert.equal(v.release, "BLOCKED"); assert.ok(v.grounding.contentIssues.some(i => i.code === "FACTS_NOT_ADDRESSED"));
});

test("correct and incorrect e1RM wording both pass the deterministic gate; the distinction stays a reviewer judgement", () => {
  const p = warmupLike("INCREASE");
  for (const text of ["e1RM ước tính của squat từ 100 lên 110 kg, 10% trong 56 ngày.", "Sức mạnh squat của bạn đã tăng 10% trong 56 ngày."]) {
    const a = analysisFor(p, "INCREASE"); a.claims[0].text = text;
    const v = verifyClaimAnalysis(p.claimContext, completeClaimEnvelopeV4(p.prompt.user, { analysis: a }).candidate);
    assert.equal(v.scientificPass, null); assert.equal(v.validationStages.semantic, "NOT_EVALUATED_REQUIRES_REVIEW");
    assert.equal(v.support.find(s => s.path === "claims.0.text")!.scientificSupport, "UNKNOWN");
  }
});

test("valid RAG answer with exact claim id/hash and every bound excerpt passes; a fabricated hash is blocked", () => {
  const p = prepared("LAYERED_CONTEXT_RAG"), u = JSON.parse(p.prompt.user), k = u.approvedScientificKnowledge[0];
  const bound = u.evidenceProvenance.filter((e: any) => e.kind === "PRIMARY_SCIENTIFIC" && e.knowledgeClaimIds.includes(k.id));
  const sourceIds = [...new Set<string>(bound.map((e: any) => e.sourceId))];
  const facts = [...u.userFacts.facts, ...u.trainingObservations.facts];
  const answer: ClaimAnalysis = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [...facts.map((f: any) => ({ claimType: "OBSERVATION" as const, text: "Nhật ký ghi nhận projection: " + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [],
      ...(f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: f.id, measurement: "ESTIMATED_1RM" as const, baselineKg: Number(f.evidence.value.baselineKg), currentKg: Number(f.evidence.value.currentKg), changePct: Number(f.evidence.value.changePct) } } : {}) })),
      { claimType: "GENERAL_PRINCIPLE", text: k.displayTextVi, factIds: [], evidenceIds: sourceIds }],
    missingInformation: [{ key: "outcome_measurement", question: "Có thêm phép đo trực tiếp để đối chiếu không?" }], rationaleSummary: "Dữ liệu mô tả thay đổi trong log; chưa xác nhận sức mạnh tối đa.", proposedAction: null },
    sourceLinks: [], claimLinks: [] };
  const claimIndex = answer.analysis.claims.length - 1;
  answer.claimLinks.push({ claimIndex, knowledgeClaimId: k.id, knowledgeClaimHash: k.claimHash });
  answer.sourceLinks = sourceIds.map(sourceId => ({ claimIndex, sourceId, excerptIds: bound.filter((e: any) => e.sourceId === sourceId).map((e: any) => e.excerptId) }));
  assert.equal(completeClaimEnvelopeV4(p.prompt.user, answer).derivation, null, "RAG is never completed server-side");
  const ok = verifyClaimAnalysis(p.claimContext, answer); assert.deepEqual(ok.identityIssues, []); assert.equal(ok.release, "DEV_REVIEW_ONLY");
  const fake = structuredClone(answer); fake.claimLinks[0].knowledgeClaimHash = "0".repeat(63) + "1";
  const bad = verifyClaimAnalysis(p.claimContext, fake); assert.equal(bad.release, "BLOCKED"); assert.ok(bad.identityIssues.includes("INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM"));
});

test("session (FAKE Nova IO): V4 analysis-only output is completed with an explicit record and raw text kept; a run-2-shaped output stays SCHEMA_INVALID", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-v4-session-"));
  try {
    const p = warmupLike("INCREASE"), c = pilotConfig();
    Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY",
      promptVersion: "CLAIM_PROMPT_V4", design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
      budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
      sources: { workspaceRoot: root, casesFile: path.join(root, "unused.json"), claimRegistryConfigFile: path.join(root, "unused-registry.json") } });
    Object.assign(c.pricing, { modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null });
    c.pins.promptHashes = [digest({ system: p.prompt.system, user: p.prompt.user })];
    const outputs = [JSON.stringify({ analysis: analysisFor(p, "INCREASE") }), JSON.stringify(run2Shaped(p))];
    let i = 0;
    const transport = createFakeNovaTransport({ kind: "FAKE", async converse(r) {
      const usage = (o: number) => ({ inputTokens: 50, outputTokens: o, totalTokens: 50 + o });
      if (r.purpose === "MEASURE") return { status: 200, body: { output: { message: { role: "assistant", content: [{ text: "{" }] } }, stopReason: "max_tokens", usage: usage(1) } };
      return { status: 200, body: { output: { message: { role: "assistant", content: [{ text: outputs[i++] }] } }, stopReason: "end_turn", usage: usage(30) } };
    } });
    const session = openEvaluationSession(c, path.join(root, "run"), transport, { fixtureLedgerDirectory: path.join(root, "ledger") });
    try {
      const ok = await session.evaluate(p.prompt) as any;
      assert.equal(ok.parseError, null); assert.equal(ok.rawText, outputs[0], "raw model text unchanged");
      assert.deepEqual(ok.parsedCandidate.claimLinks, []); assert.deepEqual(ok.parsedCandidate.sourceLinks, []);
      assert.equal(ok.structuralDerivation.fields.claimLinks, SERVER_DERIVED_EMPTY_ALLOWLIST);
      const bad = await session.evaluate(p.prompt) as any;
      assert.equal(bad.parseError, "SCHEMA_INVALID"); assert.equal(bad.rawText, outputs[1]); assert.equal(bad.structuralDerivation, undefined);
    } finally { await session.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("V4 is explicit and Nova-only and requires the claim contract", () => {
  const c = pilotConfig();
  assert.throws(() => parseConfiguration({ ...c, promptVersion: "CLAIM_PROMPT_V4" }), /PROMPT_VERSION_REQUIRES_CLAIM_CONTRACT|ClaimContractSourcesRequired/);
  const claim = { ...c, outputContract: "CLAIM_MAP_V3", sources: { workspaceRoot: os.tmpdir(), casesFile: path.join(os.tmpdir(), "c.json"), claimRegistryConfigFile: path.join(os.tmpdir(), "r.json") }, promptVersion: "CLAIM_PROMPT_V4" };
  assert.throws(() => parseConfiguration(claim), /NOVA_V4_PROMPT_ONLY/);
});
