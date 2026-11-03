/** TEST FIXTURE only: synthetic claim registry; CPU preparation; no provider, AWS or network. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { pilotConfig } from "./fixtures/pilot";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { buildClaimPrompt, CLAIM_OUTPUT_CONTRACT, ClaimAnalysisSchema, modelFacingClaimPayload, verifyClaimAnalysis, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { OUTPUT_CONTRACT } from "../evaluation/ai-coach-dev/pipeline";
import { prepareClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { loadConfiguredClaimRegistry } from "../knowledge/scientific-claim-map-v3/load";
import type { ClaimContext } from "../evaluation/ai-coach-claim-dev/context";

function registry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-prompt-v2-")), f = (n: string) => path.join(root, n), fixture = syntheticClaimData();
  fs.writeFileSync(f("bundle.json"), JSON.stringify(fixture.input)); fs.writeFileSync(f("map.json"), JSON.stringify(fixture.map)); fs.writeFileSync(f("owner.json"), fixture.input.files.owner.text);
  fs.writeFileSync(f("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: f("bundle.json"), claimMapFile: f("map.json"), currentOwnerDecisionsFile: f("owner.json"), trustedPins: fixture.pins }));
  const r = loadConfiguredClaimRegistry(f("registry.json")).registry; fs.rmSync(root, { recursive: true, force: true }); return r;
}
const reg = registry();
const rag = (version?: "CLAIM_PROMPT_V2") => prepareClaimPilot(claimDevScenarios[0].request, reg, "LAYERED_CONTEXT_RAG", "MINIMAL", version);
const contractOf = (system: string) => { const line = system.split("\n").filter(l => l.startsWith("Output contract")); assert.equal(line.length, 1); return JSON.parse(line[0].slice(line[0].indexOf("{"))); };
const HASH_FIELDS = ["sourceSha256", "capturedBodySha256", "ownerFileSha256", "ownerRecordSha256", "reviewFileSha256", "followupFileSha256", "sourceHashes", "canonicalTextSha256", "capturedQuote", "knowledgeClaimHash", "textMatch", "requiredScope", "suppliedFactIds", "parentApprovedTextVi"];
function keysOf(v: unknown, acc = new Set<string>()): Set<string> { if (Array.isArray(v)) v.forEach(x => keysOf(x, acc)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { acc.add(k); keysOf(x, acc); } return acc; }

test("CLAIM_PROMPT_V1 remains the default and byte-identical; V2 changes only the model-facing prompt", () => {
  const v1 = rag(), v2 = rag("CLAIM_PROMPT_V2");
  assert.deepEqual(v1.prompt, buildClaimPrompt(v1.claimContext, "CLAIM_PROMPT_V1"));
  assert.ok(v1.prompt.system.includes(JSON.stringify(OUTPUT_CONTRACT))); assert.equal("claimLinks" in contractOf(v1.prompt.system), false);
  assert.notEqual(v2.prompt.user, v1.prompt.user); assert.notEqual(v2.prompt.system, v1.prompt.system);
  // Verification inputs and private context are identical across versions.
  assert.deepEqual(v2.claimContext, v1.claimContext); assert.deepEqual(v2.input, v1.input); assert.deepEqual(v2.evidence, v1.evidence);
});

test("V2 contract example has exactly the ClaimAnalysisSchema top level, including claimLinks, and parses once enums are chosen", () => {
  const contract = contractOf(rag("CLAIM_PROMPT_V2").prompt.system);
  assert.deepEqual(contract, CLAIM_OUTPUT_CONTRACT); assert.deepEqual(Object.keys(contract).sort(), Object.keys(ClaimAnalysisSchema.shape).sort());
  // The inherited claim example lists every claimType with factIds=[]; pick the alternative valid with empty factIds.
  const concrete = JSON.parse(JSON.stringify(contract), (k, v) => typeof v !== "string" ? v : k === "knowledgeClaimHash" ? "a".repeat(64) : k === "claimType" ? "MEASUREMENT_LIMITATION" : v.includes("|") ? v.split("|")[0] : v);
  assert.ok(ClaimAnalysisSchema.safeParse(concrete).success, JSON.stringify(ClaimAnalysisSchema.safeParse(concrete).error?.issues));
  // Consistent with the instruction "OBSERVATION cần factIds": the parser rejects an OBSERVATION without facts.
  assert.equal(ClaimAnalysisSchema.safeParse({ ...concrete, analysis: { ...concrete.analysis, claims: [{ ...concrete.analysis.claims[0], claimType: "OBSERVATION" }] } }).success, false);
  const { claimLinks: _omit, ...missing } = concrete;
  for (const bad of [missing, { ...concrete, claimLinks: [{ ...concrete.claimLinks[0], knowledgeClaimHash: "not-a-hash" }] }, { ...concrete, claimLinks: [{ claimIndex: -1, knowledgeClaimId: "x", knowledgeClaimHash: "a".repeat(64) }] },
    { ...concrete, claimLinks: "C21" }, { ...concrete, extraField: true }, { ...concrete, claimLinks: [{ ...concrete.claimLinks[0], extra: 1 }] }])
    assert.equal(ClaimAnalysisSchema.safeParse(bad).success, false);
  const system = rag("CLAIM_PROMPT_V2").prompt.system;
  assert.match(system, /role SUPPORTING_CONTEXT là ngữ cảnh/); assert.match(system, /CODE_NOT_SCIENTIFIC_EVIDENCE là định nghĩa sản phẩm/);
});

test("V2 projection keeps every grounding field and binding, drops only traceability metadata; private context keeps it all", () => {
  const v1 = rag(), v2 = rag("CLAIM_PROMPT_V2"), u1 = JSON.parse(v1.prompt.user), u2 = JSON.parse(v2.prompt.user), ctx = v2.claimContext;
  assert.ok(u1.evidenceProvenance.length > 0 && u2.approvedScientificKnowledge.length > 0, "fixture must retrieve sourced claims");
  for (const k of ["question", "assessmentTask", "userFacts", "trainingObservations", "uncertainty", "untrustedContent", "allowedReferences"]) assert.deepEqual(u2[k], u1[k], k);
  u1.approvedScientificKnowledge.forEach((a: any, i: number) => { const b = u2.approvedScientificKnowledge[i];
    for (const k of ["id", "version", "approvedTextVi", "displayTextVi", "claimHash", "ownerApproval", "population", "applicability", "evidenceLimitations", "unsupportedInferences"]) assert.deepEqual(b[k], a[k], k);
    assert.deepEqual(b.applicabilityReview, { status: a.applicabilityReview.status, personalSupport: a.applicabilityReview.personalSupport, limitation: a.applicabilityReview.limitation }); });
  u1.productPolicies.forEach((a: any, i: number) => { const { provenance: _p, ...rest } = a; assert.deepEqual(u2.productPolicies[i], rest); });
  const bindings1 = new Set(u1.evidenceProvenance.map((e: any) => e.knowledgeClaimId + "|" + e.excerptId)), bindings2 = new Set(u2.evidenceProvenance.flatMap((e: any) => e.knowledgeClaimIds.map((id: string) => id + "|" + e.excerptId)));
  assert.deepEqual([...bindings2].sort(), [...bindings1].sort());
  for (const e of u2.evidenceProvenance) { const src = u1.evidenceProvenance.find((x: any) => x.excerptId === e.excerptId);
    assert.equal(e.quote, src.capturedQuote); assert.equal(e.originalQuote, src.quote === src.capturedQuote ? undefined : src.quote);
    for (const k of ["sourceId", "kind", "title", "readScope", "locator", "role", "semanticSupport"]) assert.equal(e[k], src[k], k);
    assert.equal(e.url, /^https:\/\//.test(src.url ?? "") ? src.url : undefined); }
  assert.equal(new Set(u2.evidenceProvenance.map((e: any) => e.excerptId)).size, u2.evidenceProvenance.length, "excerpts deduplicated");
  const dropped = HASH_FIELDS.filter(k => keysOf(u2).has(k)); assert.deepEqual(dropped, []);
  assert.ok(ctx.payload.evidenceProvenance.every(e => "sourceSha256" in e && "capturedQuote" in e && "ownerFileSha256" in e), "private provenance kept");
  assert.ok(ctx.payload.approvedScientificKnowledge.every(c => c.provenance && c.sourceHashes), "private claim provenance kept");
});

test("no absolute local path can reach the model: non-web URLs are omitted, any other local path fails closed", () => {
  const ctx = rag("CLAIM_PROMPT_V2").claimContext;
  const withUrl = structuredClone(ctx) as ClaimContext; (withUrl.payload.evidenceProvenance[0] as { url?: string }).url = "C:\\Users\\someone\\project\\src\\file.ts";
  assert.equal(modelFacingClaimPayload(withUrl).evidenceProvenance.find(e => e.excerptId === withUrl.payload.evidenceProvenance[0].excerptId)!.url, undefined);
  for (const bad of ["C:\\D_Backup\\x\\y.ts", "D:/work/file.ts", "\\\\server\\share\\f.ts", "see /Users/someone/f.ts", "/home/someone/f.ts"]) {
    const c = structuredClone(ctx) as ClaimContext; (c.payload.evidenceProvenance[0] as { locator?: string }).locator = bad;
    assert.throws(() => modelFacingClaimPayload(c), /MODEL_FACING_LOCAL_PATH/, bad);
  }
  for (const ok of ["backend/services/fitness-service/src/utils/estimated-1rm.util.ts", "https://pubmed.ncbi.nlm.nih.gov/1/", "PMID 1, abstract", "10:30 a.m."]) {
    const c = structuredClone(ctx) as ClaimContext; (c.payload.evidenceProvenance[0] as { locator?: string }).locator = ok; assert.doesNotThrow(() => modelFacingClaimPayload(c), ok);
  }
});

test("a candidate built only from the V2 model-facing input passes E2 claimLinks/sourceLinks identity checks", () => {
  const v2 = rag("CLAIM_PROMPT_V2"), u = JSON.parse(v2.prompt.user), k = u.approvedScientificKnowledge[0];
  const bound = u.evidenceProvenance.filter((e: any) => e.knowledgeClaimIds.includes(k.id) && e.kind === "PRIMARY_SCIENTIFIC");
  const sources = [...new Set<string>(bound.map((e: any) => e.sourceId))], facts = [...u.userFacts.facts, ...u.trainingObservations.facts];
  const candidate: ClaimAnalysis = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [...facts.map((f: any) => ({ claimType: "OBSERVATION" as const, text: "Projection ghi nhận: " + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [] })),
      { claimType: "GENERAL_PRINCIPLE" as const, text: k.displayTextVi, factIds: [], evidenceIds: sources }],
    missingInformation: [{ key: "other", question: "Có thêm dữ liệu theo cùng protocol không?" }], rationaleSummary: "Cần thêm dữ liệu để xác nhận kết quả cá nhân.", proposedAction: null },
    sourceLinks: sources.map(sourceId => ({ claimIndex: facts.length, sourceId, excerptIds: bound.filter((e: any) => e.sourceId === sourceId).map((e: any) => e.excerptId) })),
    claimLinks: [{ claimIndex: facts.length, knowledgeClaimId: k.id, knowledgeClaimHash: k.claimHash }] };
  const e2 = verifyClaimAnalysis(v2.claimContext, candidate);
  assert.equal(e2.contractValidity, "VALID"); assert.deepEqual(e2.identityIssues, []);
  const broken = { ...candidate, claimLinks: [{ ...candidate.claimLinks[0], knowledgeClaimHash: "b".repeat(64) }] };
  assert.ok(verifyClaimAnalysis(v2.claimContext, broken).identityIssues.includes("INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM"));
});

test("promptVersion is pinned through config: Nova requires V2, V2 needs the claim contract, and V1/V2 pins differ", async () => {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-prompt-v2-a"), fixture = syntheticClaimData(), file = (n: string) => path.join(a.root, "private", n);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(fixture.input)); fs.writeFileSync(file("map.json"), JSON.stringify(fixture.map)); fs.writeFileSync(file("owner.json"), fixture.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: fixture.pins }));
  const sources = { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") }, design = { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"] as ("LAYERED_CONTEXT" | "LAYERED_CONTEXT_RAG")[], policies: ["MINIMAL" as const], repeats: 1 };
  const p1 = await calculatePilotPins(a.root, a.casesFile, design, sources), p2 = await calculatePilotPins(a.root, a.casesFile, design, sources, "CLAIM_PROMPT_V2");
  assert.equal(p1.pins.promptHashes.length, p2.pins.promptHashes.length); assert.ok(p1.pins.promptHashes.every((h, i) => h !== p2.pins.promptHashes[i]));
  assert.deepEqual(p1.pins.cases, p2.pins.cases); assert.deepEqual(p1.pins.corpus, p2.pins.corpus);
  const noRegistry = {}; await assert.rejects(calculatePilotPins(a.root, a.casesFile, design, noRegistry, "CLAIM_PROMPT_V2"), /PROMPT_VERSION_REQUIRES_CLAIM_REGISTRY/);
  const c = pilotConfig(); Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: "amazon.nova-pro-v1:0", region: "us-east-1", inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY",
    design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 }, budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 }, sources });
  Object.assign(c.pricing, { modelId: "amazon.nova-pro-v1:0", region: "us-east-1" });
  assert.throws(() => parseConfiguration(c), /NOVA_PROMPT_VERSION_REQUIRED/);
  assert.doesNotThrow(() => parseConfiguration({ ...c, promptVersion: "CLAIM_PROMPT_V2" }));
  assert.throws(() => parseConfiguration({ ...c, promptVersion: "CLAIM_PROMPT_V1" }), /NOVA_PROMPT_VERSION_REQUIRED/);
  assert.throws(() => parseConfiguration({ ...pilotConfig(), promptVersion: "CLAIM_PROMPT_V2" }), /PROMPT_VERSION_REQUIRES_CLAIM_CONTRACT/);
});
