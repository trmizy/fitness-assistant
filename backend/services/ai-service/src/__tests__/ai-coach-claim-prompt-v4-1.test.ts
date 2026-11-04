/**
 * TEST FIXTURE / CODE AUDIT: synthetic registry and FAKE Nova IO only; no AWS, no gold labels. The failure shapes reproduce the
 * run-3 (CLAIM_PROMPT_V4) outputs on synthetic IDs: excerptIds in evidenceIds, a product-code excerpt cited as evidence,
 * missing bound excerpts, a missing proposedAction and a max_tokens truncation. The verifier is unchanged from V4.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { ClaimAnalysisSchema, citationManifest, completeClaimEnvelopeV4, verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { prepareClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { converseInput, openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { createFakeNovaTransport, serializeNova, NOVA_MODEL, NOVA_REGION } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { digest } from "../evaluation/evaluation-kit/identity";

type Arm = "LAYERED_CONTEXT" | "LAYERED_CONTEXT_RAG";
const V41 = "CLAIM_PROMPT_V4_1" as const;
const base = syntheticClaimData(), registry = createClaimRegistry(base.input, base.map, base.pins);
// Real-corpus C21 shape: several excerpts of its own source, one excerpt shared with another claim (C06) and a
// CODE_E1RM product definition (CODE_PRODUCT_DEFINITION), which the verifier never accepts as a citation.
const passage = (id: string) => `Synthetic non-scientific passage ${id}: progressive overload volume weekly sets strength repetition maximum hypertrophy tempo failure repetitions in reserve protein. No real study supports this fixture.`;
const shaped = syntheticClaimData({ excerptOverrides: { C21: [
  { sourceId: "SYNTH_C21", quote: "Synthetic non-scientific passage C21: progressive overload volume weekly sets", locator: "synthetic fixture", role: "SYNTHETIC_SUPPORT" },
  { sourceId: "SYNTH_C21", quote: "strength repetition maximum hypertrophy tempo failure", locator: "synthetic fixture", role: "SUPPORTING_CONTEXT" },
  { sourceId: "SYNTH_C06", quote: passage("C06"), locator: "synthetic fixture", role: "SYNTHETIC_SUPPORT" },
  { sourceId: "CODE_E1RM", quote: "synthetic product definition", locator: "synthetic fixture", role: "SYNTHETIC_SUPPORT" },
] } });
const shapedRegistry = createClaimRegistry(shaped.input, shaped.map, shaped.pins);
const prepared = (arm: Arm, version: "CLAIM_PROMPT_V4" | typeof V41 = V41, scenario = 0, reg = registry) => prepareClaimPilot(claimDevScenarios[scenario].request, reg, arm, "MINIMAL", version);
const rag = () => prepared("LAYERED_CONTEXT_RAG", V41, 1, shapedRegistry);
type Manifest = ReturnType<typeof citationManifest>;

/** A RAG answer that copies the typed manifest exactly (one citing GENERAL_PRINCIPLE claim per knowledge claim). */
function manifestAnswer(p: ReturnType<typeof rag>): ClaimAnalysis {
  const u = JSON.parse(p.prompt.user), manifest: Manifest = u.allowedReferences.citationManifest;
  const known = new Map<string, string>(u.approvedScientificKnowledge.map((k: { id: string; displayTextVi: string }) => [k.id, k.displayTextVi]));
  const facts = [...u.userFacts.facts, ...u.trainingObservations.facts];
  const answer: ClaimAnalysis = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: facts.map((f: any) => ({ claimType: "OBSERVATION" as const, text: "Nhật ký ghi nhận projection: " + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [],
      ...(f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: f.id, measurement: "ESTIMATED_1RM" as const, baselineKg: Number(f.evidence.value.baselineKg), currentKg: Number(f.evidence.value.currentKg), changePct: Number(f.evidence.value.changePct) } } : {}) })),
    missingInformation: [{ key: "outcome_measurement", question: "Có thêm phép đo trực tiếp để đối chiếu không?" }], rationaleSummary: "Dữ liệu mô tả thay đổi trong log; chưa xác nhận sức mạnh tối đa.", proposedAction: null },
    sourceLinks: [], claimLinks: [] };
  for (const m of manifest) {
    const claimIndex = answer.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: known.get(m.knowledgeClaimId)!, factIds: [], evidenceIds: [...m.evidenceIds] }) - 1;
    answer.claimLinks.push({ claimIndex, knowledgeClaimId: m.knowledgeClaimId, knowledgeClaimHash: m.knowledgeClaimHash });
    for (const l of m.sourceLinks) answer.sourceLinks.push({ claimIndex, sourceId: l.sourceId, excerptIds: [...l.excerptIds] });
  }
  return answer;
}
const indexOfKnowledge = (a: ClaimAnalysis, id: string) => a.claimLinks.find(l => l.knowledgeClaimId === id)!.claimIndex;

function warmupLike(kind: "INCREASE" | "UNCHANGED") {
  const request = structuredClone(claimDevScenarios[1].request);
  request.question = kind === "INCREASE" ? "Sức mạnh squat của tôi trong 8 tuần qua thay đổi thế nào?" : "Tôi có cần tăng tạ để tiến bộ không?";
  const evidence = request.snapshots[0].facts[0].evidence;
  evidence.quality = "SUFFICIENT"; evidence.window = { days: 56 };
  evidence.value = kind === "INCREASE" ? { exercise: "Squat", unit: "kg", baselineKg: 100, currentKg: 110, changePct: 10 } : { exercise: "Bench Press", unit: "kg", baselineKg: 80, currentKg: 80, changePct: 0 };
  return prepareClaimPilot(request, registry, "LAYERED_CONTEXT", "MINIMAL", V41);
}
const analysisFor = (p: ReturnType<typeof warmupLike>, kind: "INCREASE" | "UNCHANGED"): ClaimAnalysis["analysis"] => {
  const id = p.claimContext.personal.facts[0].id, inc = kind === "INCREASE";
  return { version: "content-aware-v3", assessment: inc ? "OBSERVED_PROGRESS" : "NO_OBSERVED_CHANGE", assessmentBasis: { outcome: "ESTIMATED_STRENGTH", factIds: [id] },
    claims: [
      { claimType: "OBSERVATION", text: inc ? "e1RM ước tính của squat từ 100 kg lên 110 kg, 10% trong 56 ngày." : "e1RM ước tính của bench press giữ ở 80 kg trong 56 ngày.", factIds: [id], evidenceIds: [],
        metricAssertion: { factId: id, measurement: "ESTIMATED_1RM", baselineKg: inc ? 100 : 80, currentKg: inc ? 110 : 80, changePct: inc ? 10 : 0 } },
      { claimType: "MEASUREMENT_LIMITATION", text: inc ? "e1RM ước tính tăng không chứng minh sức mạnh tối đa thực tăng cùng tỷ lệ." : "e1RM ước tính không đổi không chứng minh không có tiến bộ ở khía cạnh khác.", factIds: [id], evidenceIds: [] }],
    missingInformation: [{ key: inc ? "outcome_measurement" : "program_load_history", question: inc ? "Bạn có kết quả kiểm tra 1RM trực tiếp để đối chiếu không?" : "Mức tạ và số lần lặp của bạn thay đổi thế nào trong 56 ngày qua?" }],
    rationaleSummary: inc ? "e1RM ước tính của squat tăng 10% trong 56 ngày; đây là ước tính, chưa phải kết quả kiểm tra 1RM." : "e1RM ước tính không đổi trong 56 ngày; chưa đủ để kết luận về tiến bộ ở mọi khía cạnh.",
    proposedAction: null };
};

test("historical V1–V4 synthetic prompts stay byte-identical; V4.1 user = V4 user + citable flags + citationManifest only", () => {
  // V4 pins captured at 203edc2f before V4.1 was added (V1–V3 pins are asserted in ai-coach-claim-prompt-v4.test.ts).
  const v4Pins = { LAYERED_CONTEXT: "604200794e37ee9ea537ce82a3e525d5571bc75c52649997801d575a3fc8f0e3", LAYERED_CONTEXT_RAG: "54c3c861a690fba012b495606a9a603a2301f44a572ffb9ddd3323d6bd9f720b" };
  for (const arm of ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"] as const) {
    const v4 = prepared(arm, "CLAIM_PROMPT_V4"), v41 = prepared(arm);
    assert.equal(digest({ system: v4.prompt.system, user: v4.prompt.user }), v4Pins[arm], arm);
    const u = JSON.parse(v41.prompt.user);
    assert.ok(u.evidenceProvenance.every((e: { kind: string; citable: boolean }) => e.citable === (e.kind === "PRIMARY_SCIENTIFIC")));
    u.evidenceProvenance = u.evidenceProvenance.map(({ citable: _c, ...rest }: { citable: boolean }) => rest);
    const { citationManifest: _m, ...allowed } = u.allowedReferences; u.allowedReferences = allowed;
    assert.equal(JSON.stringify(u), v4.prompt.user, "nothing else in the user payload changed");
    assert.deepEqual(v41.claimContext, v4.claimContext, "private context, allowlists and verifier inputs unchanged");
  }
  assert.equal(prepared("LAYERED_CONTEXT").prompt.system, prepared("LAYERED_CONTEXT_RAG").prompt.system, "one system message for both arms");
});

test("V4.1 system: explicit ID namespaces, manifest copy rule, citable rule, required keys and compact format; no placeholder IDs", () => {
  const v4 = prepared("LAYERED_CONTEXT", "CLAIM_PROMPT_V4").prompt.system, system = prepared("LAYERED_CONTEXT").prompt.system;
  assert.match(system, /evidenceIds của một claim CHỈ chứa sourceId, không bao giờ chứa excerptId/);
  assert.match(system, /allowedReferences\.citationManifest/); assert.match(system, /Mỗi knowledgeClaimId chỉ được dẫn bởi một claim/);
  assert.match(system, /citable=false/); assert.match(system, /CODE_PRODUCT_DEFINITION/);
  assert.doesNotMatch(system, /sourceLinks của mỗi claim có nguồn phải gồm mọi excerptId được bind/, "the V2 line contradicting the allowlist is gone");
  assert.match(system, /REQUIRED KEYS: .*proposedAction/); assert.match(system, /FORMAT: .*một dòng/);
  assert.match(system, /từ <baselineKg> kg lên <currentKg> kg, mỗi số chỉ kèm đơn vị một lần/); assert.doesNotMatch(system, /từ <baselineKg> lên <currentKg> kg/);
  assert.doesNotMatch(system, /existing-|\b[a-f0-9]{32}\b|\b[a-f0-9]{64}\b/, "no placeholder or hash-like reference");
  assert.ok(!system.includes("{\"analysis\""), "no worked JSON instance");
  for (const line of v4.split("\n").filter(l => l.startsWith("ENUM") || l.startsWith("OUTPUT SHAPE") || l.startsWith("TOP-LEVEL") || l.startsWith("productPolicies") || l.startsWith("ASSESSMENT:")))
    assert.ok(system.includes(line), "V4 contract line kept: " + line.slice(0, 40));
});

test("citation manifest: evidenceIds are sourceIds, excerpts match the verifier binding, product code is excluded, shared excerpts listed per claim", () => {
  const p = rag(), u = JSON.parse(p.prompt.user), manifest: Manifest = u.allowedReferences.citationManifest;
  assert.deepEqual(manifest, citationManifest(p.claimContext));
  const c21 = manifest.find(m => m.knowledgeClaimId === "C21")!, c06 = manifest.find(m => m.knowledgeClaimId === "C06")!;
  assert.deepEqual(c21.evidenceIds, ["SYNTH_C21", "SYNTH_C06"]); assert.ok(manifest.every(m => m.evidenceIds.every(id => !id.includes(":"))));
  assert.equal(c21.sourceLinks.find(l => l.sourceId === "SYNTH_C21")!.excerptIds.length, 2);
  const shared = c06.sourceLinks[0].excerptIds[0];
  assert.deepEqual(c21.sourceLinks.find(l => l.sourceId === "SYNTH_C06")!.excerptIds, [shared], "same excerpt bound to two knowledge claims");
  assert.ok(!JSON.stringify(manifest).includes("CODE_E1RM"));
  const code = u.evidenceProvenance.find((e: { sourceId: string }) => e.sourceId === "CODE_E1RM");
  assert.equal(code.citable, false); assert.deepEqual(code.knowledgeClaimIds, ["C21"]);
  assert.ok(!u.allowedReferences.scientificSources.some((s: { sourceId: string }) => s.sourceId === "CODE_E1RM"));
  // Every verifier expectation (PRIMARY_SCIENTIFIC reference of the matched claim) is in the manifest, and nothing else.
  for (const match of p.claimContext.retrieval.matches) {
    const m = manifest.find(x => x.knowledgeClaimId === match.claim.id)!, refs = match.claim.evidenceReferences.filter(r => r.kind === "PRIMARY_SCIENTIFIC");
    assert.deepEqual(new Set(m.evidenceIds), new Set(refs.map(r => r.sourceId)));
    assert.equal(m.sourceLinks.flatMap(l => l.excerptIds).length, new Set(refs.map(r => r.sourceId + r.capturedQuote)).size);
  }
});

test("a RAG answer that copies the manifest passes; the shared excerpt may appear under two citing claims", () => {
  const p = rag(), a = manifestAnswer(p), v = verifyClaimAnalysis(p.claimContext, a);
  assert.ok(ClaimAnalysisSchema.safeParse(a).success);
  assert.deepEqual(v.identityIssues, []); assert.equal(v.release, "DEV_REVIEW_ONLY", JSON.stringify(v.grounding.contentIssues));
  assert.equal(v.scientificPass, null); assert.equal(completeClaimEnvelopeV4(p.prompt.user, a).derivation, null, "RAG is never completed server-side");
});

test("run-3 failure shapes stay BLOCKED by the unchanged verifier (namespace, unknown source, product code, missing excerpt)", () => {
  const p = rag(), good = manifestAnswer(p), c21 = indexOfKnowledge(good, "C21");
  const variant = (edit: (a: ClaimAnalysis) => void) => { const a = structuredClone(good); edit(a); return verifyClaimAnalysis(p.claimContext, a); };
  // A (run-3 #2/#3/#7): excerptIds written into evidenceIds.
  const ns = variant(a => { a.analysis.claims[c21].evidenceIds = a.sourceLinks.filter(l => l.claimIndex === c21).flatMap(l => l.excerptIds); });
  assert.equal(ns.release, "BLOCKED"); assert.ok(ns.identityIssues.includes("INVALID_REFERENCE_NAMESPACE"), JSON.stringify(ns.identityIssues));
  // B: a sourceId that is not in the input.
  const unknown = variant(a => { a.analysis.claims[c21].evidenceIds.push("SYNTH_NOT_PROVIDED"); });
  assert.equal(unknown.release, "BLOCKED"); assert.ok(unknown.identityIssues.includes("INVALID_REFERENCE_NAMESPACE"));
  // C/D (run-3 #3/#6): the bound product-code excerpt cited as evidence.
  const codeExcerpt = JSON.parse(p.prompt.user).evidenceProvenance.find((e: { sourceId: string }) => e.sourceId === "CODE_E1RM").excerptId;
  const code = variant(a => { a.analysis.claims[c21].evidenceIds.push("CODE_E1RM"); a.sourceLinks.push({ claimIndex: c21, sourceId: "CODE_E1RM", excerptIds: [codeExcerpt] }); });
  assert.equal(code.release, "BLOCKED"); assert.ok(code.identityIssues.includes("INVALID_EXCERPT_BINDING"), JSON.stringify(code.identityIssues));
  // Missing one required scientific excerpt (run-3 #3 dropped all of them).
  const missing = variant(a => { const l = a.sourceLinks.find(x => x.claimIndex === c21 && x.sourceId === "SYNTH_C21")!; l.excerptIds = l.excerptIds.slice(1); });
  assert.equal(missing.release, "BLOCKED"); assert.ok(missing.identityIssues.includes("MISSING_BOUND_EXCERPT"));
  // Duplicate expansion inside one list is invalid (schema for evidenceIds, identity for excerptIds).
  const dupEvidence = structuredClone(good); dupEvidence.analysis.claims[c21].evidenceIds.push(dupEvidence.analysis.claims[c21].evidenceIds[0]);
  assert.equal(ClaimAnalysisSchema.safeParse(dupEvidence).success, false);
  const dupExcerpt = variant(a => { const l = a.sourceLinks.find(x => x.claimIndex === c21)!; l.excerptIds.push(l.excerptIds[0]); });
  assert.ok(dupExcerpt.identityIssues.includes("INVALID_EXCERPT_BINDING"));
});

test("duplicate reference expansion: citing one knowledge claim from two claims (run-3 #6 shape) is larger than the manifest copy", () => {
  const p = rag(), good = manifestAnswer(p), c21 = indexOfKnowledge(good, "C21"), expanded = structuredClone(good);
  const at = expanded.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: "Giới hạn của e1RM ước tính.", factIds: [], evidenceIds: [...good.analysis.claims[c21].evidenceIds] }) - 1;
  expanded.claimLinks.push({ ...good.claimLinks.find(l => l.claimIndex === c21)!, claimIndex: at });
  for (const l of good.sourceLinks.filter(x => x.claimIndex === c21)) expanded.sourceLinks.push({ ...l, claimIndex: at, excerptIds: [...l.excerptIds] });
  // The verifier does not forbid it (the prompt does); the cost is size, the reason run-3 #6 hit max_tokens.
  assert.deepEqual(verifyClaimAnalysis(p.claimContext, expanded).identityIssues, []);
  const pretty = (a: unknown) => JSON.stringify(a, null, 2).length, compact = (a: unknown) => JSON.stringify(a).length;
  assert.ok(compact(good) < pretty(good) && pretty(good) < pretty(expanded), `${compact(good)} < ${pretty(good)} < ${pretty(expanded)}`);
});

test("Context arm: empty references stay server-derived only for analysis-only output; the manifest is empty", () => {
  for (const kind of ["INCREASE", "UNCHANGED"] as const) {
    const p = warmupLike(kind), u = JSON.parse(p.prompt.user);
    assert.deepEqual(u.allowedReferences.citationManifest, []); assert.deepEqual(u.evidenceProvenance, []);
    const raw = { analysis: analysisFor(p, kind) }, before = digest(raw), done = completeClaimEnvelopeV4(p.prompt.user, raw);
    assert.equal(digest(raw), before); assert.equal(done.derivation?.fields.claimLinks, "SERVER_DERIVED_EMPTY_ALLOWLIST");
    const v = verifyClaimAnalysis(p.claimContext, done.candidate);
    assert.equal(v.release, "DEV_REVIEW_ONLY", `${kind}: ${JSON.stringify(v.grounding.contentIssues)}`);
  }
});

test("missing proposedAction (run-3 #8) stays SCHEMA_INVALID: never filled by the server", () => {
  const p = warmupLike("INCREASE"), { proposedAction: _drop, ...analysis } = analysisFor(p, "INCREASE");
  const done = completeClaimEnvelopeV4(p.prompt.user, { analysis });
  assert.ok(done.derivation, "only the empty link arrays are derived");
  assert.equal(Object.prototype.hasOwnProperty.call((done.candidate as ClaimAnalysis).analysis, "proposedAction"), false);
  const parsed = ClaimAnalysisSchema.safeParse(done.candidate); assert.equal(parsed.success, false);
  if (!parsed.success) assert.deepEqual(parsed.error.issues.map(i => i.path.join(".")), ["analysis.proposedAction"]);
  const v = verifyClaimAnalysis(p.claimContext, done.candidate, { parseError: "SCHEMA_INVALID", providerError: null });
  assert.equal(v.release, "BLOCKED"); assert.equal(v.validationStages.schema, "INVALID"); assert.equal(v.validationStages.references, "NOT_EVALUATED");
});

test("over-abstention is blocked for CAL01-like and CAL06-like cases; correct and incorrect e1RM wording are both reviewer-only", () => {
  for (const kind of ["INCREASE", "UNCHANGED"] as const) {
    const p = warmupLike(kind), abstain = completeClaimEnvelopeV4(p.prompt.user, { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
      claims: [{ claimType: "MEASUREMENT_LIMITATION", text: "Chưa đủ dữ liệu để trả lời.", factIds: [], evidenceIds: [] }],
      missingInformation: [{ key: "other", question: "Bạn có thêm dữ liệu tập luyện không?" }], rationaleSummary: "Chưa đủ dữ liệu để kết luận về câu hỏi này.", proposedAction: null } });
    const v = verifyClaimAnalysis(p.claimContext, abstain.candidate);
    assert.equal(v.release, "BLOCKED", kind); assert.ok(v.grounding.contentIssues.some(i => i.code === "FACTS_NOT_ADDRESSED"), kind);
  }
  const p = warmupLike("INCREASE");
  for (const text of ["e1RM ước tính của squat từ 100 kg lên 110 kg, 10% trong 56 ngày.", "Sức mạnh squat của bạn đã tăng 10% trong 56 ngày.", "e1RM ước tính của squat từ 100 kg lên 110 kg kg, 10% trong 56 ngày."]) {
    const a = analysisFor(p, "INCREASE"); a.claims[0].text = text;
    const v = verifyClaimAnalysis(p.claimContext, completeClaimEnvelopeV4(p.prompt.user, { analysis: a }).candidate);
    assert.equal(v.scientificPass, null); assert.equal(v.validationStages.semantic, "NOT_EVALUATED_REQUIRES_REVIEW");
  }
});

function novaConfig(root: string, promptHash: string) {
  const c = pilotConfig();
  Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY",
    promptVersion: V41, design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
    budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    sources: { workspaceRoot: root, casesFile: path.join(root, "unused.json"), claimRegistryConfigFile: path.join(root, "unused-registry.json") } });
  Object.assign(c.pricing, { modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null });
  c.pins.promptHashes = [promptHash];
  return c;
}

test("session (FAKE Nova IO): truncated JSON (max_tokens) and a missing proposedAction are counted failures with raw text kept", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-v41-session-"));
  try {
    const p = warmupLike("INCREASE"), c = novaConfig(root, digest({ system: p.prompt.system, user: p.prompt.user }));
    const { proposedAction: _drop, ...noAction } = analysisFor(p, "INCREASE");
    const truncated = JSON.stringify({ analysis: analysisFor(p, "INCREASE") }).slice(0, 120), missing = JSON.stringify({ analysis: noAction });
    const replies = [{ text: truncated, stop: "max_tokens" }, { text: missing, stop: "end_turn" }]; let i = 0;
    const transport = createFakeNovaTransport({ kind: "FAKE", async converse(r) {
      const usage = (o: number) => ({ inputTokens: 50, outputTokens: o, totalTokens: 50 + o });
      if (r.purpose === "MEASURE") return { status: 200, body: { output: { message: { role: "assistant", content: [{ text: "{" }] } }, stopReason: "max_tokens", usage: usage(1) } };
      const reply = replies[i++];
      return { status: 200, body: { output: { message: { role: "assistant", content: [{ text: reply.text }] } }, stopReason: reply.stop, usage: usage(30) } };
    } });
    const session = openEvaluationSession(c, path.join(root, "run"), transport, { fixtureLedgerDirectory: path.join(root, "ledger") });
    try {
      const cut = await session.evaluate(p.prompt) as any;
      assert.equal(cut.providerError, "NOVA_STOP_REASON_MAX_TOKENS"); assert.equal(cut.parsedCandidate ?? null, null);
      const rejected = (session.records() as any[]).find(r => r.event === "PROVIDER_RESPONSE_REJECTED");
      assert.ok(JSON.stringify(rejected.providerResponse).includes(JSON.stringify(truncated).slice(1, 60)), "truncated raw text preserved");
      const bad = await session.evaluate(p.prompt) as any;
      assert.equal(bad.parseError, "SCHEMA_INVALID"); assert.equal(bad.rawText, missing);
      assert.equal(Object.prototype.hasOwnProperty.call(bad.parsedCandidate.analysis, "proposedAction"), false, "not repaired");
      assert.equal(session.state().failures, 2); assert.equal(session.state().stopped, true);
    } finally { await session.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const A = "case-warmup-cal01", B = "case-warmup-cal06", CTX = "LAYERED_CONTEXT", RAG = "LAYERED_CONTEXT_RAG";
const OWNER_ORDER = [[A, CTX, 0], [B, RAG, 0], [A, RAG, 0], [B, CTX, 0], [B, CTX, 1], [A, RAG, 1], [B, RAG, 1], [A, CTX, 1]] as const;
async function warmup() {
  const a = fixturePilotInput(claimDevScenarios[0].request, A), b = fixturePilotInput(claimDevScenarios[1].request, B);
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(shaped.input)); fs.writeFileSync(file("map.json"), JSON.stringify(shaped.map)); fs.writeFileSync(file("owner.json"), shaped.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: shaped.pins }));
  const c = pilotConfig();
  Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion: V41,
    design: { arms: [CTX, RAG], policies: ["MINIMAL"], repeats: 2 }, budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    sources: { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") } });
  Object.assign(c.pricing, { modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null });
  const p = await calculatePilotPins(a.root, a.casesFile, c.design, c.sources, V41); c.pins = p.pins;
  const label = new Map(p.preparation.rows.map(r => [serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash, `${r.caseKey}/${r.arm}`]));
  return { root: a.root, config: c, label, close: () => fs.rmSync(a.root, { recursive: true, force: true }) };
}
/** FAKE Nova: RAG rows get the run-3 namespace error (valid schema, BLOCKED); Context rows get `contextText`. */
function fakeNova(contextText: string) {
  const inference: string[] = [];
  const provider = createFakeNovaTransport({ kind: "FAKE", async converse(r) {
    const t = Math.ceil(Buffer.byteLength(JSON.stringify(JSON.parse(r.body).messages), "utf8") / 4);
    const body = (text: string, out: number, stop: string) => ({ output: { message: { role: "assistant", content: [{ text }] } }, stopReason: stop, usage: { inputTokens: t, outputTokens: out, totalTokens: t + out } });
    if (r.purpose === "MEASURE") return { status: 200, body: body("{", 1, "max_tokens") };
    inference.push(r.identity.tokenPayloadHash);
    const user = JSON.parse(JSON.parse(r.body).messages[0].content[0].text), manifest: Manifest = user.allowedReferences.citationManifest;
    if (!manifest.length) return { status: 200, body: body(contextText, 20, "end_turn") };
    const m = manifest[0], excerpts = m.sourceLinks.flatMap(l => l.excerptIds);
    const blocked = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
      claims: [{ claimType: "GENERAL_PRINCIPLE", text: "Nguyên tắc chung trong fixture.", factIds: [], evidenceIds: excerpts }], missingInformation: [],
      rationaleSummary: "Synthetic run-3-shaped RAG output.", proposedAction: null },
      sourceLinks: m.sourceLinks.map(l => ({ claimIndex: 0, ...l })), claimLinks: [{ claimIndex: 0, knowledgeClaimId: m.knowledgeClaimId, knowledgeClaimHash: m.knowledgeClaimHash }] };
    return { status: 200, body: body(JSON.stringify(blocked), 20, "end_turn") };
  } });
  return { provider, inference };
}
const contextOk = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [],
  rationaleSummary: "Synthetic interleave fixture, no scientific conclusion.", proposedAction: null } });

test("runner (V4.1): owner interleave kept; BLOCKED outputs are not operational failures, so all 8 inferences run", async () => {
  const w = await warmup(), t = fakeNova(contextOk);
  try {
    const dir = path.join(w.root, "run"), summary = await runControlledPilot({ config: w.config, directory: dir, transport: t.provider });
    const schedule = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    assert.deepEqual(schedule.map((s: any) => [s.caseKey, s.arm, s.repeatIndex]), OWNER_ORDER.map(o => [...o]));
    assert.deepEqual(t.inference.map(h => w.label.get(h)), OWNER_ORDER.map(([c, arm]) => `${c}/${arm}`));
    assert.equal(summary.budget.failures, 0); assert.equal(summary.budget.inferenceCalls, 8); assert.equal(summary.status, "FAKE_COMPLETED_REVIEW_ONLY");
    assert.equal(summary.denominators.parseOrProviderFailures, 0); assert.ok(summary.denominators.blocked >= 4, JSON.stringify(summary.denominators));
    for (const name of fs.readdirSync(dir).filter(n => n.startsWith("answer-"))) {
      const answer = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (answer.arm === RAG) { assert.equal(answer.postGate.decision, "BLOCKED"); assert.ok(answer.verification.e2.identityIssues.includes("INVALID_REFERENCE_NAMESPACE")); }
    }
  } finally { w.close(); }
});

test("runner (V4.1): two schema failures stop the run while BLOCKED rows in between do not count", async () => {
  const { proposedAction: _drop, ...noAction } = JSON.parse(contextOk).analysis;
  const w = await warmup(), t = fakeNova(JSON.stringify({ analysis: noAction }));
  try {
    const summary = await runControlledPilot({ config: w.config, directory: path.join(w.root, "run"), transport: t.provider });
    assert.equal(summary.status, "STOPPED"); assert.equal(summary.budget.failures, 2);
    assert.deepEqual(t.inference.map(h => w.label.get(h)), [`${A}/${CTX}`, `${B}/${RAG}`, `${A}/${RAG}`, `${B}/${CTX}`], "stops at the 2nd failure (4th row); the 2 RAG BLOCKED rows are not failures");
    assert.equal(summary.denominators.notAttempted, 4);
  } finally { w.close(); }
});

test("V4.1 is explicit and Nova-only and requires the claim contract", () => {
  const c = pilotConfig();
  assert.throws(() => parseConfiguration({ ...c, promptVersion: V41 }), /PROMPT_VERSION_REQUIRES_CLAIM_CONTRACT|ClaimContractSourcesRequired/);
  const claim = { ...c, outputContract: "CLAIM_MAP_V3", sources: { workspaceRoot: os.tmpdir(), casesFile: path.join(os.tmpdir(), "c.json"), claimRegistryConfigFile: path.join(os.tmpdir(), "r.json") }, promptVersion: V41 };
  assert.throws(() => parseConfiguration(claim), /NOVA_V4_1_PROMPT_ONLY/);
});
