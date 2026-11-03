import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig, pilotTransport } from "./fixtures/pilot";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { calculatePilotPins, verifySessionPins, assertVerifiedPins } from "../evaluation/bedrock-pilot/pins";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { inferenceTarget } from "../evaluation/bedrock-pilot/session";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { ClaimAnalysisSchema, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import type { ClaimContext } from "../evaluation/ai-coach-claim-dev/context";
import { projectClaimAnalysis } from "../evaluation/ai-coach-claim-dev/projection";
import { annotationUnits, validatePacketContract } from "../evaluation/evaluation-kit/annotations";
import { reviewerExport, verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { analyzeOffline, type OfflineAnalysisInput } from "../evaluation/evaluation-kit/offline-analysis";
import { digest } from "../evaluation/evaluation-kit/identity";
import { verifyClaimPilot } from "../evaluation/bedrock-pilot/claim-adapter";

async function prepared(repeats = 2) {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-claim-a"), b = fixturePilotInput(claimDevScenarios[1].request, "case-claim-b");
  const first = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) first[key].push(...second[key]);
  fs.writeFileSync(a.casesFile, JSON.stringify(first));
  const fixture = syntheticClaimData(), file = (s: string) => path.join(a.root, "private", s);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(fixture.input)); fs.writeFileSync(file("map.json"), JSON.stringify(fixture.map));
  fs.writeFileSync(file("owner.json"), fixture.input.files.owner.text);
  const registryConfig = { version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: fixture.pins };
  fs.writeFileSync(file("registry.json"), JSON.stringify(registryConfig)); fs.writeFileSync(file("protocol.json"), JSON.stringify({ authority: "TEST_FIXTURE", revision: 1 }));
  const config = pilotConfig(); config.modelId = "anthropic.claude-haiku-4-5-20251001-v1:0";
  config.inferenceProfile = "global.anthropic.claude-haiku-4-5-20251001-v1:0"; config.region = "us-east-2";
  config.pricing.modelId = config.modelId; config.pricing.inferenceProfile = config.inferenceProfile; config.pricing.region = config.region;
  config.outputContract = "CLAIM_MAP_V3"; config.reviewerMode = "OWNER_ONLY_EXPLORATORY";
  config.design = { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats };
  config.sources = { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json"), protocolDecisionsFile: file("protocol.json") };
  config.budget.maxCalls = 8;
  const calculation = await calculatePilotPins(a.root, a.casesFile, config.design, config.sources); config.pins = calculation.pins;
  return { ...a, b, config, calculation, file };
}

function candidateFor(user: string): ClaimAnalysis {
  const p = JSON.parse(user), knowledge = p.approvedScientificKnowledge[0], refs = knowledge ? p.evidenceProvenance.filter((e: { knowledgeClaimId: string }) => e.knowledgeClaimId === knowledge.id && "excerptId" in e) : [];
  const facts: ClaimContext["personal"]["facts"] = [...p.userFacts.facts, ...p.trainingObservations.facts];
  const observations: ClaimAnalysis["analysis"]["claims"] = facts.map(f => ({ claimType: "OBSERVATION", text: (f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? "e1RM là ước tính; projection: " : "Projection ghi nhận: ") + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [],
    ...(f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: f.id, measurement: "ESTIMATED_1RM" as const, baselineKg: Number(f.evidence.value.baselineKg), currentKg: Number(f.evidence.value.currentKg), changePct: Number(f.evidence.value.changePct) } } : {}) }));
  const claimIndex = observations.length;
  return { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [...observations, ...(knowledge ? [{ claimType: "GENERAL_PRINCIPLE" as const, text: knowledge.displayTextVi, factIds: [], evidenceIds: [...new Set<string>(refs.map((e: { sourceId: string }) => e.sourceId))] }] : [])],
    missingInformation: [{ key: "other", question: "Có thêm dữ liệu đo lường theo cùng protocol không?" }], rationaleSummary: "Cần thêm dữ liệu để xác nhận kết quả cá nhân.", proposedAction: null },
    sourceLinks: [...new Set<string>(refs.map((e: { sourceId: string }) => e.sourceId))].map(sourceId => ({ claimIndex, sourceId, excerptIds: refs.filter((e: { sourceId: string }) => e.sourceId === sourceId).map((e: { excerptId: string }) => e.excerptId) })),
    claimLinks: knowledge ? [{ claimIndex, knowledgeClaimId: knowledge.id, knowledgeClaimHash: knowledge.claimHash }] : [] };
}
function transport(mutate?: (c: ReturnType<typeof candidateFor>) => unknown) {
  let calls = 0; const inputs: string[] = [], base = pilotTransport();
  return { get calls() { return calls; }, inputs, provider: { ...base, async invoke(input: Parameters<typeof base.invoke>[0]) {
    calls++; const user = input.messages![0].content![0].text!; inputs.push(user);
    const raw = candidateFor(user), value = mutate ? mutate(raw) : raw;
    return { $metadata: {}, output: { message: { role: "assistant" as const, content: [{ text: typeof value === "string" ? value : JSON.stringify(value) }] } }, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, metrics: { latencyMs: 0 }, stopReason: "end_turn" as const };
  } } };
}
const answers = (directory: string) => fs.readdirSync(directory).filter(f => f.startsWith("answer-")).map(f => JSON.parse(fs.readFileSync(path.join(directory, f), "utf8")));

test("E2 prepare uses common policy/facts and exact E1 excerpts, no legacy corpus or generation labels", async () => {
  const f = await prepared(), rows = f.calculation.preparation.rows;
  assert.equal(rows.length, 8);
  for (const row of rows) {
    const result = verifyClaimPilot(row.claimContext!, candidateFor(row.prompt.user));
    assert.equal(result.blocked, false, JSON.stringify(result.e2.grounding.contentIssues));
  }
  for (const caseKey of new Set(rows.map(r => r.caseKey))) {
    const pairs = rows.filter(r => r.caseKey === caseKey && r.repeatIndex === 0), a = JSON.parse(pairs[0].prompt.user), b = JSON.parse(pairs[1].prompt.user);
    assert.equal(pairs[0].prompt.system, pairs[1].prompt.system);
    assert.deepEqual(a.userFacts, b.userFacts); assert.deepEqual(a.trainingObservations, b.trainingObservations);
    assert.equal(a.approvedScientificKnowledge.length, 0); assert.ok(b.approvedScientificKnowledge.length > 0 && b.approvedScientificKnowledge.length <= 2);
    assert.ok(!JSON.stringify(pairs.map(p => p.prompt)).includes("PRIVATE_GOLD_FIXTURE"));
    assert.ok(!JSON.stringify(pairs.map(p => p.prompt)).includes("expectedAssessment"));
    assert.ok(pairs.every(p => p.claimContext));
    assert.ok(pairs[1].verificationContext.evidence.passages.every(p => p.excerpts.every(e => b.evidenceProvenance.some((r: { capturedQuote: string }) => r.capturedQuote === e.text))));
    for (const match of pairs[1].claimContext!.retrieval.matches) for (const ref of match.claim.evidenceReferences.filter(e => e.kind === "PRIMARY_SCIENTIFIC")) {
      const source = pairs[1].verificationContext.evidence.passages.find(p => p.source.id === ref.sourceId)!.source;
      assert.ok([...match.claim.population, ...match.claim.applicability].every(t => source.applicability.includes(t)));
      assert.ok([...match.claim.evidenceLimitations, ...match.claim.unsupportedInferences].every(t => source.limitations.includes(t)));
    }
  }
});

test("8 E2 FAKE calls retain full claimLinks/raw/projection; D1 receipts bind full candidate; R1-only export; resume adds no calls", async () => {
  const f = await prepared(), t = transport(), directory = path.join(f.root, "run"), summary = await runControlledPilot({ config: f.config, directory, transport: t.provider });
  assert.equal(t.calls, 8); assert.equal(summary.denominators.failed, 0); assert.equal(summary.denominators.blocked, 0);
  assert.equal(summary.reviewAuthority, "EXPLORATORY_OWNER_REVIEWED"); assert.equal(summary.actualBedrockCalls, 0); assert.equal(summary.scientificPass, null);
  const records = answers(directory); assert.equal(records.length, 8);
  assert.ok(records.some(r => r.raw.parsedCandidate.claimLinks.length > 0));
  for (const r of records) {
    assert.ok(ClaimAnalysisSchema.safeParse(r.raw.parsedCandidate).success);
    assert.deepEqual(r.claimRepresentation, projectClaimAnalysis(r.raw.parsedCandidate));
    assert.equal(r.candidateHash, digest(r.raw.parsedCandidate));
    for (const packet of r.packets.reviewers) {
      assert.equal(packet.body.candidateHash, r.candidateHash); assert.notEqual(packet.body.units[0].type, "INVALID_OUTPUT");
      assert.doesNotThrow(() => validatePacketContract(packet));
    }
    const p = r.packets.reviewers[0], exported = JSON.parse(fs.readFileSync(path.join(directory + "-reviewers/R1", p.body.instanceId + ".json"), "utf8"));
    verifyReviewerExport(exported, p.reviewerExportHashes.R1);
    assert.ok(!/claimContext|claimRepresentation|claimLinks|configHash|caseKey|LAYERED_CONTEXT|evidenceIdentity/.test(JSON.stringify(exported)));
  }
  assert.equal(fs.existsSync(directory + "-reviewers/R2"), false);
  for (const caseKey of new Set(records.map(r => r.caseKey))) assert.equal(new Set(records.filter(r => r.caseKey === caseKey).map(r => digest(r.packets.reviewers[0].body.evidence))).size, 1);
  const again = await runControlledPilot({ config: f.config, directory, transport: t.provider, resume: true }); assert.deepEqual(again, summary); assert.equal(t.calls, 8);
});

test("E2 malformed/missing claimLinks never downgrades; failure denominator and failure cap preserved", async () => {
  const f = await prepared(), t = transport(c => { const { claimLinks: _links, ...legacy } = c; return legacy; });
  const summary = await runControlledPilot({ config: f.config, directory: path.join(f.root, "invalid"), transport: t.provider });
  assert.equal(t.calls, 2); assert.equal(summary.denominators.failed, 2); assert.equal(summary.denominators.blocked, 0); assert.equal(summary.denominators.notAttempted, 6);
  assert.ok(answers(path.join(f.root, "invalid")).every(r => r.raw.parseError === "SCHEMA_INVALID" && r.generationStatus === "FAILED" && r.postGate.decision === "FAILED"));
});

test("wrong claim binding is a valid generated but BLOCKED candidate, not a provider/parse failure", async () => {
  const f = await prepared(1), t = transport(c => { c.claimLinks.forEach(l => { l.knowledgeClaimHash = "f".repeat(64); }); return c; });
  const summary = await runControlledPilot({ config: f.config, directory: path.join(f.root, "wrong"), transport: t.provider });
  assert.equal(summary.denominators.failed, 0); assert.equal(summary.denominators.blocked, 2); assert.equal(summary.denominators.postGateEligible, 2);
  const blocked = answers(path.join(f.root, "wrong")).filter(r => r.lifecycle.blocked);
  assert.ok(blocked.every(r => r.raw.parsedCandidate.claimLinks.length && r.verification.e2.identityIssues.includes("INVALID_OR_EXCLUDED_KNOWLEDGE_CLAIM")));
});

test("registry/map/owner/protocol drift rejects pinned admission; unsupported E2 design and LIVE remain closed", async () => {
  const f = await prepared(1); assert.doesNotThrow(() => parseConfiguration(f.config));
  const receipt = await verifySessionPins(f.config);
  for (const filename of ["map.json", "bundle.json", "owner.json", "protocol.json", "registry.json"]) {
    const file = f.file(filename), saved = fs.readFileSync(file); fs.appendFileSync(file, " ");
    assert.throws(() => assertVerifiedPins(f.config, receipt), /PIN_MISMATCH|StaleOwnerDecisionsPin/); fs.writeFileSync(file, saved);
  }
  const bad = structuredClone(f.config); bad.outputContract = "LEGACY_V3"; assert.throws(() => parseConfiguration(bad), /ClaimContractSourcesRequired/);
  await assert.rejects(() => calculatePilotPins(f.root, f.casesFile, { ...f.config.design!, policies: ["FULL"] }, f.config.sources), /UnsupportedClaimPilotDesign/);
  const live = { ...f.config, mode: "LIVE" as const }; assert.throws(() => inferenceTarget(live), /CLAIM_PILOT_LIVE_NOT_READY/);
});

test("redaction retains full E2 identity and receipt validation; no secret archive or sealed-packet mutation", async () => {
  const f = await prepared(1), t = transport(c => { c.analysis.rationaleSummary = "token=FAKE_SECRET_VALUE trong fixture để kiểm tra redaction."; return c; });
  const dir = path.join(f.root, "secret"); await runControlledPilot({ config: f.config, directory: dir, transport: t.provider });
  for (const r of answers(dir)) {
    assert.ok(!JSON.stringify(r).includes("FAKE_SECRET_VALUE"));
    assert.equal(r.packets.reviewers[0].body.representation.scoringDisposition, "REDACTED_NOT_SCORED");
    validatePacketContract(r.packets.reviewers[0]); reviewerExport(r.packets.reviewers[0]);
    const noReceipt = structuredClone(r.packets.reviewers[0]); delete noReceipt.reviewerExportHashes;
    assert.throws(() => validatePacketContract(noReceipt), /ReviewerExportReceiptRequired/);
  }
});

test("D3 consumes the full E2 candidate with D1 units; no annotations means NOT_EVALUATED, hash tampering fails", async () => {
  const f = await prepared(1), t = transport(), dir = path.join(f.root, "d3"); await runControlledPilot({ config: f.config, directory: dir, transport: t.provider });
  const readCase = (root: string, id: string) => { const sealed = JSON.parse(fs.readFileSync(path.join(root, "private", id + ".json"), "utf8")); return { authority: "TEST_FIXTURE" as const, sealed, manifest: JSON.parse(fs.readFileSync(path.join(root, "public", id + ".manifest.json"), "utf8")) }; };
  const data: OfflineAnalysisInput = { version: "offline-evaluation-v1", purpose: "TEST_FIXTURE", configHash: digest(f.config),
    cases: [readCase(f.root, "case-claim-a"), readCase(f.b.root, "case-claim-b")], schedule: JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8")), routedBeforeGeneration: 0,
    outputs: answers(dir).map(r => ({ attemptKey: r.attemptKey, raw: { candidate: r.raw.parsedCandidate, text: r.raw.rawText, status: r.generationStatus, executionMode: "FAKE" as const, inputTokens: 12, outputTokens: 8, latencyMs: 0, estimatedUsd: null }, postGate: r.postGate, packet: r.packets.reviewers[0] })), annotations: [], adjudications: [] };
  data.configHash = data.schedule[0].configHash;
  const result = analyzeOffline(data); assert.equal(result.denominators.rawRecorded, 4); assert.equal(result.fixtureCalculations!.gate.labelled, 0); assert.equal(result.fixtureCalculations!.gate.sensitivity.value, null);
  assert.ok(data.outputs.some(o => annotationUnits(o.raw.candidate).some(u => u.type === "GENERAL_PRINCIPLE")));
  const linked = data.outputs.find(o => (o.raw.candidate as { claimLinks: unknown[] }).claimLinks.length)!;
  (linked.raw.candidate as { claimLinks: { knowledgeClaimHash: string }[] }).claimLinks[0].knowledgeClaimHash = "e".repeat(64);
  assert.throws(() => analyzeOffline(data), /PacketRawOrCaseMismatch/);
});
