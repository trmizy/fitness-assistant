import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { redact, protect } from "../evaluation/evaluation-kit/representation";
import { createAnnotationPackets, validatePacketContract } from "../evaluation/evaluation-kit/annotations";
import { reviewerExport, verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { digest } from "../evaluation/evaluation-kit/identity";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { pilotAnswer, pilotConfig, pilotTransport } from "./fixtures/pilot";

// Deliberately fabricated strings, never credentials or user information.
const samples = [
  { name: "aws_secret_access_key", text: "aws_secret_access_key=FAKE_AWS_SECRET_ONLY", secret: "FAKE_AWS_SECRET_ONLY" },
  { name: "token assignment", text: "token=FAKE_TOKEN_VALUE_ONLY", secret: "FAKE_TOKEN_VALUE_ONLY" },
  { name: "Basic Authorization", text: "Authorization: Basic " + Buffer.from("fixture:fake-password").toString("base64"), secret: Buffer.from("fixture:fake-password").toString("base64") },
  { name: "sk prefix", text: "sk-" + "X".repeat(24), secret: "sk-" + "X".repeat(24) },
  { name: "ghp prefix", text: "ghp_" + "Y".repeat(36), secret: "ghp_" + "Y".repeat(36) },
];
for (const sample of samples) test("redaction masks synthetic " + sample.name + " in reviewer-facing fields before sealing", () => {
  const candidate=structuredClone(pilotAnswer); candidate.analysis.rationaleSummary=sample.text;
  const packet=createAnnotationPackets({question:sample.text,facts:[{id:"F_TEST",evidence:{value:{note:sample.text,token:sample.secret,accessToken:sample.secret}}}],evidence:[{source:{id:"S_TEST",title:"Synthetic fixture source"},excerpts:[{id:"E_TEST",text:sample.text}]}],candidate}).reviewers[0];
  const exported=reviewerExport(packet);
  assert.ok(!JSON.stringify(exported.artifact).includes(sample.secret)); assert.ok(!JSON.stringify(packet).includes(sample.secret));
  assert.equal(packet.packetHash,digest(packet.body)); assert.equal(validatePacketContract(packet),"RECEIPT_V2");
  assert.equal(packet.body.representation.scoringDisposition,"REDACTED_NOT_SCORED");
  assert.deepEqual(redact(redact(candidate)),redact(candidate)); assert.equal(protect(sample.text).receipt.changed,true);
  // Token telemetry is ordinary accounting, not an auth-token field.
  assert.deepEqual(redact({inputTokens:12,outputTokens:8,token_count:20}),{inputTokens:12,outputTokens:8,token_count:20});
  assert.equal(redact("Basic training principles"),"Basic training principles");
  // Direct export/verification of older sealed content must fail rather than leak or rewrite it after sealing.
  const unsafe=structuredClone(packet); unsafe.body.question=sample.text;unsafe.packetHash=digest(unsafe.body);
  assert.throws(()=>reviewerExport(unsafe),/ReviewerExportRequiresRedactionReseal/);
  const unsafeArtifact=structuredClone(exported.artifact);unsafeArtifact.body.question=sample.text;
  assert.throws(()=>verifyReviewerExport(unsafeArtifact,digest(unsafeArtifact)),/ReviewerExportRequiresRedactionReseal/);
});

test("fake transport persists only safe secret-pattern representations and keeps resume hashes valid", async () => {
  const f=fixturePilotInput(),config=pilotConfig();config.design={arms:["LAYERED"],policies:["MINIMAL"],repeats:1};
  config.sources={workspaceRoot:f.root,casesFile:f.casesFile};config.pins=(await calculatePilotPins(f.root,f.casesFile,config.design)).pins;
  const answer=structuredClone(pilotAnswer);answer.analysis.rationaleSummary=samples.map(s=>s.text).join("; ");
  const base=pilotTransport(JSON.stringify(answer));let calls=0;
  const transport={...base,async invoke(...args:Parameters<typeof base.invoke>){calls++;return base.invoke(...args);}};
  const directory=path.join(f.root,"run"),summary=await runControlledPilot({config,directory,transport});
  assert.equal(summary.denominators.recordedOutputs,1);assert.equal(summary.denominators.redactedOutputs,1);
  for(const folder of [directory,path.join(directory+"-reviewers","R1"),path.join(directory+"-reviewers","R2")])for(const name of fs.readdirSync(folder)){
    const file=path.join(folder,name);if(!fs.statSync(file).isFile())continue;
    for(const s of samples)assert.ok(!fs.readFileSync(file,"utf8").includes(s.secret),name+": "+s.name);
  }
  const stored=JSON.parse(fs.readFileSync(path.join(directory,fs.readdirSync(directory).find(n=>n.startsWith("answer-"))!),"utf8"));
  assert.equal(stored.raw.rawTextHash,digest(stored.raw.rawText));assert.equal(stored.candidateHash,digest(stored.raw.parsedCandidate));assert.equal(stored.packets.reviewers[0].packetHash,digest(stored.packets.reviewers[0].body));
  await runControlledPilot({config,directory,transport,resume:true});assert.equal(calls,1);assert.equal(summary.scientificPass,null);
});
