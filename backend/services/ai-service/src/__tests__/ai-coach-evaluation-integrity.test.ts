import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAnnotationPackets, validateAnnotation } from "../evaluation/evaluation-kit/annotations";
import { reviewerExport, verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { redact, protect } from "../evaluation/evaluation-kit/representation";
import { digest } from "../evaluation/evaluation-kit/identity";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { analyzeOffline } from "../evaluation/evaluation-kit/offline-analysis";
import { pilotAnswer, pilotConfig, pilotTransport } from "./fixtures/pilot";
import { fixturePilotInput } from "./fixtures/pilot-input";

test("blind export is a separate strict allowlist with opaque identity and an integrity receipt", () => {
  const packets = createAnnotationPackets({ question: "Synthetic question", facts: [{ id: "F1", value: 42 }], evidence: { trace: { arm: "LAYERED_CONTEXT_RAG" }, expectedAssessment: "hidden", passages: [{ source: { id: "S1", title: "Fixture source", arm: "hidden" }, excerpts: [{ id: "E1", text: "Exact fixture excerpt", locator: "abstract" }] }] }, candidate: pilotAnswer });
  const packet = packets.reviewers[0], exported = reviewerExport(packet);
  assert.equal(exported.artifact.opaqueId, packet.body.instanceId);
  assert.equal(exported.artifact.body.evidence[0] && (exported.artifact.body.evidence[0] as { originalExcerpts: {text: string}[] }).originalExcerpts[0].text, "Exact fixture excerpt");
  assert.ok(!/arm|expectedAssessment|retrievalTrace|candidateHash|ownerLinkage/.test(JSON.stringify(exported.artifact)));
  assert.deepEqual(verifyReviewerExport(exported.artifact, exported.hash), exported.artifact);
  const tampered = structuredClone(exported.artifact); tampered.body.question += "changed";
  assert.throws(() => verifyReviewerExport(tampered, exported.hash), /ReviewerExportIntegrityFailed/);
  for (const field of ["arm", "policy", "repeatIndex", "expectedAssessment", "postGate", "trace"]) {
    const p = createAnnotationPackets({ question: "Synthetic", facts: [{ nested: { [field]: "hidden" } }], evidence: [], candidate: pilotAnswer }).reviewers[0];
    assert.throws(() => reviewerExport(p), /ReviewerTreatmentLeak/);
  }
  for (const arm of ["FLAT_LAYOUT", "LAYERED", "LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG", "LAYERED_CONTEXT_PLACEBO", "LAYERED_CONTEXT_WRONG_EXCERPT"]) {
    const p = createAnnotationPackets({ question: "Synthetic", facts: [{ nested: { text: "treatment " + arm } }], evidence: [], candidate: pilotAnswer }).reviewers[0];
    assert.throws(() => reviewerExport(p), /ReviewerTreatmentLeak/);
    const keyed = createAnnotationPackets({ question: "Synthetic", facts: [{ [arm]: 42 }], evidence: [], candidate: pilotAnswer }).reviewers[0];
    assert.throws(() => reviewerExport(keyed), /ReviewerTreatmentLeak/);
  }
});

test("redaction is idempotent and hashes exactly the stored representation without plaintext secrets", () => {
  const fakeKey = "AKIA" + "Z".repeat(16), fakeEmail = "fixture@example.invalid", fakeToken = "FAKE_TEST_TOKEN";
  const raw = { text: `${fakeKey} ${fakeEmail} Bearer ${fakeToken} api_key=FAKE_ONLY`, credentials: { value: "FAKE_ONLY" } };
  const p = protect(raw);
  assert.equal(p.receipt.originalHash, digest(raw)); assert.equal(p.receipt.storedHash, digest(p.value)); assert.equal(p.receipt.changed, true);
  assert.deepEqual(redact(p.value), p.value); assert.ok(!JSON.stringify(p.value).includes(fakeKey)); assert.ok(!JSON.stringify(p.value).includes(fakeEmail)); assert.ok(!JSON.stringify(p.value).includes(fakeToken));
});

test("new packet annotations bind the R1/R2 export receipts; legacy packets stay explicitly compatible", () => {
  const packets = createAnnotationPackets({ question: "Synthetic", facts: [], evidence: [], candidate: pilotAnswer });
  const hashes = Object.fromEntries(packets.reviewers.map(p => [p.reviewerSlot, reviewerExport(p).hash]));
  const packet = { ...packets.reviewers[1], reviewerExportHashes: hashes };
  const a = { packetHash: packet.packetHash, reviewerSlot: "R2", reviewerPseudonym: "TEST_R2", authority: "TEST_FIXTURE", units: packet.body.units.map(u => ({ unitId: u.unitId, factualCorrectness: "NOT_EVALUATED", sourceSupport: "NOT_EVALUATED", unsupportedPersonalClaim: null, uncertainty: "NOT_EVALUATED", abstention: "NOT_EVALUATED", rationale: "Fixture only" })), usefulness: null, submittedAt: "2026-11-02T00:00:00Z" };
  assert.throws(() => validateAnnotation(a, packet), /ReviewerExportReceiptRequired/);
  assert.throws(() => validateAnnotation({ ...a, reviewerExportHash: hashes.R1 }, packet), /ReviewerExportReceiptRequired/);
  assert.equal(validateAnnotation({ ...a, reviewerExportHash: hashes.R2 }, packet).reviewerSlot, "R2");
  const changed = { ...packet, reviewerExportHashes: { ...hashes, R2: digest("tampered receipt") } };
  assert.throws(() => validateAnnotation({ ...a, reviewerExportHash: changed.reviewerExportHashes.R2 }, changed), /ReviewerExportReceiptChanged/);
  assert.equal(validateAnnotation(a, packets.reviewers[1]).reviewerSlot, "R2");
});

test("fake transport normal/key/email-token responses persist and analyze with canonical hashes; resume detects tampering", async () => {
  // These private files are authored entirely by this test, never owner review data.
  const f = fixturePilotInput(), config = pilotConfig(); config.design = { repeats: 3, arms: ["LAYERED"], policies: ["MINIMAL"] };
  config.sources = { workspaceRoot: f.root, casesFile: f.casesFile }; config.pins = (await calculatePilotPins(f.root, f.casesFile, config.design)).pins;
  const fakeKey = "AKIA" + "Z".repeat(16), fakeEmail = "fixture@example.invalid", fakeToken = "FAKE_TEST_TOKEN";
  const texts = ["Normal fixture response", `Synthetic api_key=${fakeKey}`, `Synthetic ${fakeEmail} Bearer ${fakeToken}`]; let calls = 0;
  const transport = { ...pilotTransport(), async invoke(...args: Parameters<ReturnType<typeof pilotTransport>["invoke"]>) {
    const answer = structuredClone(pilotAnswer); answer.analysis.rationaleSummary = texts[calls++]; return pilotTransport(JSON.stringify(answer)).invoke(...args);
  } };
  const directory = path.join(f.root, "run");
  const summary = await runControlledPilot({ config, directory, transport }); assert.equal(calls, 3); assert.equal(summary.scientificPass, null); assert.equal(summary.denominators.redactedOutputs,2);
  const answers = fs.readdirSync(directory).filter(n => n.startsWith("answer-")).map(n => JSON.parse(fs.readFileSync(path.join(directory,n),"utf8")));
  for (const a of answers) {
    assert.equal(a.raw.rawTextHash, digest(a.raw.rawText)); assert.equal(a.candidateHash, digest(a.raw.parsedCandidate));
    assert.equal(a.packets.reviewers[0].packetHash, digest(a.packets.reviewers[0].body));
    for (const slot of ["R1","R2"]) {
      const p = a.packets.reviewers.find((p: {reviewerSlot: string}) => p.reviewerSlot === slot);
      const file = path.join(directory + "-reviewers", slot, p.body.instanceId + ".json");
      verifyReviewerExport(JSON.parse(fs.readFileSync(file,"utf8")), p.reviewerExportHashes[slot]);
    }
  }
  for (const folder of [directory, path.join(directory+"-reviewers","R1"), path.join(directory+"-reviewers","R2")]) for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder,name); if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file,"utf8"); for (const value of [fakeKey, fakeEmail, fakeToken]) assert.ok(!text.includes(value));
  }
  const released = JSON.parse(fs.readFileSync(f.casesFile,"utf8")), manifest = released.expectedManifests[0];
  const sealed = JSON.parse(fs.readFileSync(path.join(f.root,"private",manifest.caseKey+".json"),"utf8"));
  const report = analyzeOffline({ version: "offline-evaluation-v1", purpose: "TEST_FIXTURE", configHash: summary.configHash, cases: [{authority:"TEST_FIXTURE",manifest,sealed}], schedule: JSON.parse(fs.readFileSync(path.join(directory,"schedule.json"),"utf8")), routedBeforeGeneration:0,
    outputs: answers.map(a => ({attemptKey:a.attemptKey,raw:{candidate:a.raw.parsedCandidate,text:a.raw.rawText,status:"GENERATED",executionMode:"FAKE",inputTokens:a.raw.inputTokens,outputTokens:a.raw.outputTokens,latencyMs:a.raw.latencyMs,estimatedUsd:a.raw.estimatedUsd},postGate:{decision:a.verification.blocked?"BLOCKED":"ELIGIBLE",structuredInvariant:!!a.verification.blockerScopes.structuredInvariant.length,narrowTextHeuristic:!!a.verification.blockerScopes.narrowTextHeuristic.length},packet:a.packets.reviewers[0]})), annotations:[],adjudications:[] });
  assert.equal(report.denominators.rawRecorded,3); assert.equal(report.missingness.redactedOutputs,2); assert.equal(report.fixtureCalculations!.raw.usefulness.value,null);
  await runControlledPilot({ config, directory, transport, resume:true }); assert.equal(calls,3);
  const p = answers[0].packets.reviewers[0], file = path.join(directory+"-reviewers","R1",p.body.instanceId+".json");
  const changed = JSON.parse(fs.readFileSync(file,"utf8")); changed.body.question += "tampered"; fs.writeFileSync(file,JSON.stringify(changed));
  await assert.rejects(() => runControlledPilot({config,directory,transport,resume:true}),/ReviewerExportIntegrityFailed/); assert.equal(calls,3);
});

test("reviewer export persistence failure retains a sealed internal answer and resumes without repeating inference", async () => {
  const f=fixturePilotInput(), config=pilotConfig(); config.design={repeats:1,arms:["LAYERED"],policies:["MINIMAL"]};
  config.sources={workspaceRoot:f.root,casesFile:f.casesFile}; config.pins=(await calculatePilotPins(f.root,f.casesFile,config.design)).pins;
  const answer=structuredClone(pilotAnswer); answer.analysis.rationaleSummary="Synthetic api_key=FAKE_PERSIST_SECRET";
  const base=pilotTransport(JSON.stringify(answer)); let calls=0;
  const transport={...base,async invoke(...args:Parameters<typeof base.invoke>){calls++;return base.invoke(...args);}};
  const directory=path.join(f.root,"run"), original=fs.linkSync;
  fs.linkSync=((from,to)=>{if(String(to).includes("-reviewers"))throw new Error("FAKE_EXPORT_PERSIST_FAILURE");return original(from,to);}) as typeof fs.linkSync;
  try {await assert.rejects(()=>runControlledPilot({config,directory,transport}),/FAKE_EXPORT_PERSIST_FAILURE/);} finally {fs.linkSync=original;}
  assert.equal(calls,1); const files=fs.readdirSync(directory).filter(f=>f.startsWith("answer-")); assert.equal(files.length,1);
  const stored=JSON.parse(fs.readFileSync(path.join(directory,files[0]),"utf8")); assert.equal(digest(stored.packets.reviewers[0].body),stored.packets.reviewers[0].packetHash);
  assert.ok(!fs.readFileSync(path.join(directory,"results.jsonl"),"utf8").includes("FAKE_PERSIST_SECRET"));
  const answerFile=path.join(directory,files[0]), originalBytes=fs.readFileSync(answerFile);
  for (const packet of stored.packets.reviewers) { packet.body.units[0].text += "tampered"; packet.packetHash=digest(packet.body); }
  const forgedHashes=Object.fromEntries(stored.packets.reviewers.map((p: Parameters<typeof reviewerExport>[0])=>[p.reviewerSlot,reviewerExport(p).hash]));
  for (const packet of stored.packets.reviewers) packet.reviewerExportHashes=forgedHashes;
  fs.writeFileSync(answerFile,JSON.stringify(stored));
  await assert.rejects(()=>runControlledPilot({config,directory,transport,resume:true}),/PacketRawOrCaseMismatch/); assert.equal(calls,1);
  fs.writeFileSync(answerFile,originalBytes); // Restore only this test-owned fault injection.
  const resumed=await runControlledPilot({config,directory,transport,resume:true}); assert.equal(calls,1); assert.equal(resumed.denominators.finishedOutputs,1);
});
