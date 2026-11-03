import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { intakeSnapshot, sealIntake, intakeCandidate } from "./fixtures/intake";
import { admitD1Candidate } from "../evaluation/case-intake/candidate";
import { convertFrozenIntake } from "../evaluation/case-intake/converter";
import { convertSnapshotDirectory } from "../evaluation/case-intake/run";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { DevRequestSchema } from "../evaluation/ai-coach-dev/context";
import { validatePacketContract } from "../evaluation/evaluation-kit/annotations";
import { verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { calculatePilotPins, verifySessionPins, loadPilotPreparation, assertVerifiedPins } from "../evaluation/bedrock-pilot/pins";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig, pilotTransport } from "./fixtures/pilot";

const convert=(s= intakeSnapshot())=>convertFrozenIntake(s.manifest,s.canonical,s.pins);
test("frozen intake preserves facts/null dates, authentic capture timestamp, confirmations and false review declarations",()=>{
  const s=intakeSnapshot(),original=digest(s),result=convert(s);
  assert.equal(digest(s),original); assert.equal(result.generation.released.length,20);
  assert.equal(result.summary.ownerConfirmedInTool,20); assert.equal(result.summary.ownerReviewedDeclared,0);
  assert.deepEqual(result.privateSidecar.source.canonical,s.canonical);
  for(const [i,b] of result.generation.released.entries()){
    assert.ok(DevRequestSchema.safeParse(b.request).success);
    const snap=b.request.snapshots[0],row=snap.facts[1].evidence.value,source=s.canonical.cases[i];
    assert.equal(snap.recordedAt,source.validation.ownerConfirmedAt); assert.notEqual(snap.recordedAt,s.manifest.frozenAt);
    assert.equal(row.date,null); assert.equal(row.week,1); assert.equal(row.weightKg,60); assert.equal(row.rir,null);
    assert.equal(row.recordedAtMeaning,"CASE_CONFIRMATION_CAPTURE_NOT_MEASUREMENT_TIME");
    assert.ok(!/PRIVATE_|expectedAssessment|reviewerNotes|independenceAttested/.test(JSON.stringify(b.request)));
    assert.ok(!/e1rm|changePct|baselineKg/i.test(JSON.stringify(b.request)));
  }
  assert.equal(result.privateSidecar.source.canonical.cases.filter(c=>(c as {labels:{expectedAssessment:null|string}}).labels.expectedAssessment===null).length,4);
  assert.ok(result.privateSidecar.compatibility.every(c=>c.unmappedPersonalContext.includes("age")));
  assert.ok(result.privateSidecar.compatibility[0].fields.some(f=>f.path==="knowledge.reviewerNotes"&&f.disposition.startsWith("PRIVATE")));
});

test("WORDING inherits only opted-in facts; TRANSFER with usesCaseLog=false never inherits parent facts/profile/history or private variant facts",()=>{
  const r=convert(); assert.equal(r.privateSidecar.variantRequests.length,40); assert.equal(r.summary.scheduledVariants,0);
  for(const v of r.privateSidecar.variantRequests){
    assert.equal(v.scheduled,false); assert.equal(v.request.conversation.length,0);
    assert.equal(v.clusterId,r.privateSidecar.clusterLinkage.find(p=>p.caseKey===v.caseKey)!.clusterId);
    assert.ok(!/PRIVATE_/.test(JSON.stringify(v.request)));
    if(v.usesCaseLog) assert.equal(v.request.snapshots[0].facts[1].evidence.value.weightKg,60);
    else {assert.deepEqual(v.request.snapshots,[]);assert.equal(v.request.profile.goal,null);assert.ok(v.request.question.includes("40 kg"));}
  }
  assert.equal(r.generation.released.length,20); assert.ok(r.generation.released.every(b=>!b.request.caseId.endsWith("-v-1")));
});

test("source pins, whole snapshot, per-case hashes and content confirmations fail closed",()=>{
  const s=intakeSnapshot(); assert.throws(()=>convertFrozenIntake(s.manifest,s.canonical,{...s.pins,manifestHash:"f".repeat(64)}),/ManifestHashMismatch/);
  const raw=structuredClone(s);raw.canonical.cases[0].training.sessions[0].weightKg=90;assert.throws(()=>convert(raw),/CanonicalHashMismatch/);
  const perCase=structuredClone(s);perCase.manifest.perCase[0].sha256="f".repeat(64);perCase.pins.manifestHash=digest(perCase.manifest);assert.throws(()=>convert(perCase),/PerCaseHashMismatch/);
  const confirmation=structuredClone(s);confirmation.canonical.cases[0].validation.contentHash="f".repeat(64);
  confirmation.manifest.perCase[0].sha256=digest(confirmation.canonical.cases[0]);confirmation.pins.canonicalHash=digest(confirmation.canonical);confirmation.manifest.canonicalSha256=confirmation.pins.canonicalHash;confirmation.pins.manifestHash=digest(confirmation.manifest);
  assert.throws(()=>convert(confirmation),/ConfirmationContentMismatch/);
});

test("duplicate identities, incorrect declarations/counts and late confirmations cannot be hidden by rehashing",()=>{
  const duplicate=intakeSnapshot();duplicate.canonical.cases[1].clusterId=duplicate.canonical.cases[0].clusterId;assert.throws(()=>convert(sealIntake(duplicate.canonical.cases)),/DuplicateIntakeCluster/);
  const late=intakeSnapshot();late.canonical.cases[0].validation.ownerConfirmedAt="2026-01-03T00:00:00.000Z";assert.throws(()=>convert(sealIntake(late.canonical.cases)),/ConfirmationAfterFreeze/);
  const count=intakeSnapshot();count.manifest.variantCount++;count.pins.manifestHash=digest(count.manifest);assert.throws(()=>convert(count),/VariantCountMismatch/);
  const review=intakeSnapshot();review.manifest.provenance.ownerReviewedDeclared=20;review.pins.manifestHash=digest(review.manifest);assert.throws(()=>convert(review),/ReviewDeclarationMismatch/);
});

test("fact/string limits and availability contradictions are rejected without truncation or date/calculation imputation",()=>{
  const many=intakeSnapshot();many.canonical.cases[0].training.sessions=Array.from({length:20},(_,i)=>({...many.canonical.cases[0].training.sessions[0],id:"s-"+i}));
  assert.throws(()=>convert(sealIntake(many.canonical.cases)),/FactLimitExceeded/);
  const long=intakeSnapshot();long.canonical.cases[0].training.sessions[0].note="x".repeat(301);assert.throws(()=>convert(sealIntake(long.canonical.cases)));
  const conflict=intakeSnapshot();conflict.canonical.cases[0].training.hasData=false;assert.throws(()=>convert(sealIntake(conflict.canonical.cases)),/AvailabilityRowsConflict/);
  const unknown=intakeSnapshot();Object.assign(unknown.canonical.cases[0].training.sessions[0],{unmapped:"PRIVATE_ROW_EXTENSION"});assert.throws(()=>convert(sealIntake(unknown.canonical.cases)),/UnmappedTrainingRowField/);
});

test("unknown top-level fields remain in private archive/compatibility; empty training and explicit NA remain descriptive",()=>{
  const s=intakeSnapshot(),c=s.canonical.cases[0];Object.assign(c,{futurePrivateField:{nested:"PRIVATE_EXTENSION_SENTINEL"}});
  c.training.hasData=false;c.training.noDataReason="No log recorded";c.training.sessions=[];
  const r=convert(sealIntake(s.canonical.cases));assert.ok(r.privateSidecar.compatibility[0].fields.some(f=>f.path==="futurePrivateField.nested"));
  assert.ok(!JSON.stringify(r.generation).includes("PRIVATE_EXTENSION_SENTINEL"));
  const facts=r.generation.released[0].request.snapshots[0].facts;assert.equal(facts.length,1);assert.equal(facts[0].evidence.value.hasData,false);
});

test("offline directory conversion checks bytes, does not overwrite exports or write into owner dataset",()=>{
  const s=intakeSnapshot(),root=fs.mkdtempSync(path.join(os.tmpdir(),"intake-conversion-")),dir=path.join(root,"data/snapshots/"+s.manifest.snapshotId);
  fs.mkdirSync(dir,{recursive:true}); const manifestFile=path.join(dir,"manifest.json"),caseFile=path.join(dir,"cases.canonical.json");
  fs.writeFileSync(manifestFile,canonical(s.manifest));fs.writeFileSync(caseFile,canonical(s.canonical));const before=fs.readFileSync(caseFile,"utf8");
  assert.throws(()=>convertSnapshotDirectory(dir,path.join(root,"data/output"),s.pins),/OutsideOwnerDataset/);
  const out=path.join(root,"converted");assert.equal(convertSnapshotDirectory(dir,out,s.pins).clusters,20);
  assert.throws(()=>convertSnapshotDirectory(dir,out,s.pins),/EEXIST/);assert.equal(fs.readFileSync(caseFile,"utf8"),before);
  fs.appendFileSync(caseFile," ");assert.throws(()=>convertSnapshotDirectory(dir,path.join(root,"other"),s.pins),/CanonicalBytesMismatch/);
});

async function configuredIntakeFixture(){
  const s=intakeSnapshot(),candidate=intakeCandidate(s),converted=admitD1Candidate(convert(s),candidate.documents,candidate.pins),f=fixturePilotInput(),sf=syntheticClaimData(),privateFile=(name:string)=>path.join(f.root,"private",name);
  fs.writeFileSync(f.casesFile,JSON.stringify(converted.generation));
  fs.writeFileSync(privateFile("intake-sidecar.json"),JSON.stringify(converted.privateSidecar));
  fs.writeFileSync(privateFile("bundle.json"),JSON.stringify(sf.input));fs.writeFileSync(privateFile("map.json"),JSON.stringify(sf.map));fs.writeFileSync(privateFile("owner.json"),sf.input.files.owner.text);
  fs.writeFileSync(privateFile("registry.json"),JSON.stringify({version:"claim-registry-local-config-v1",inputBundleFile:privateFile("bundle.json"),claimMapFile:privateFile("map.json"),currentOwnerDecisionsFile:privateFile("owner.json"),trustedPins:sf.pins}));
  const config=pilotConfig();config.outputContract="CLAIM_MAP_V3";config.reviewerMode="OWNER_ONLY_EXPLORATORY";
  config.design={arms:["LAYERED_CONTEXT","LAYERED_CONTEXT_RAG"],policies:["MINIMAL"],repeats:1};config.sources={workspaceRoot:f.root,casesFile:f.casesFile,claimRegistryConfigFile:privateFile("registry.json"),intakeSidecarFile:privateFile("intake-sidecar.json")};
  config.budget={...config.budget,maxCalls:40,maxInputTokens:480000,maxOutputTokens:81920};
  const calc=await calculatePilotPins(f.root,f.casesFile,config.design,config.sources);config.pins=calc.pins;
  return {converted,f,config,calc};
}

test("intake input requires E2 registry, claim contract and owner-only mode; valid FAKE admission works without independent attestation",async()=>{
  const {f,config}=await configuredIntakeFixture();
  await assert.rejects(()=>loadPilotPreparation(f.root,f.casesFile,config.design),/INTAKE_REQUIRES_CLAIM_REGISTRY/);
  await assert.rejects(()=>verifySessionPins({...config,reviewerMode:"TWO_RATER"}),/INTAKE_REQUIRES_CLAIM_CONTRACT_AND_OWNER_ONLY/);
  await assert.rejects(()=>verifySessionPins({...config,outputContract:"LEGACY_V3"}),/INTAKE_REQUIRES_CLAIM_CONTRACT_AND_OWNER_ONLY/);
  await assert.rejects(()=>verifySessionPins({...config,mode:"LIVE"}),/INTAKE_INPUT_FAKE_ONLY/);
  const verified=await verifySessionPins(config);assert.equal(verified.status,"VERIFIED_FROM_FILES");
  const sidecarFile=config.sources!.intakeSidecarFile!,saved=fs.readFileSync(sidecarFile,"utf8");
  const tampered=JSON.parse(saved);tampered.clusterLinkage[0].clusterId="cluster-other";fs.writeFileSync(sidecarFile,JSON.stringify(tampered));
  assert.throws(()=>assertVerifiedPins(config,verified),/PIN_MISMATCH/);
  await assert.rejects(()=>verifySessionPins(config),/IntakeSidecarHashMismatch/);fs.writeFileSync(sidecarFile,saved);
});

test("existing E2 FAKE runner consumes only 20 primary cases, retains full-envelope receipts/R1 blinding and refuses intake LIVE",async()=>{
  const {config,calc,f}=await configuredIntakeFixture();
  assert.equal(calc.preparation.rows.length,40);assert.ok(!JSON.stringify(calc.preparation.rows.map(r=>r.prompt)).includes("PRIVATE_"));
  await assert.rejects(()=>verifySessionPins({...config,mode:"LIVE"}),/INTAKE_INPUT_FAKE_ONLY/);
  const raw={analysis:{version:"content-aware-v3",assessment:"INSUFFICIENT_DATA",assessmentBasis:{outcome:"UNSPECIFIED",factIds:[]},claims:[],missingInformation:[],rationaleSummary:"Synthetic plumbing only.",proposedAction:null},sourceLinks:[],claimLinks:[]};
  const base=pilotTransport(),transport={...base,async invoke(input:Parameters<typeof base.invoke>[0]){
    const p=JSON.parse(input.messages![0].content![0].text!),k=p.approvedScientificKnowledge[0];
    const refs=k?p.evidenceProvenance.filter((e:{knowledgeClaimId:string;kind:string})=>e.knowledgeClaimId===k.id&&e.kind==="PRIMARY_SCIENTIFIC"):[];
    const sources=[...new Set<string>(refs.map((e:{sourceId:string})=>e.sourceId))];
    const candidate=k?{...raw,analysis:{...raw.analysis,claims:[{claimType:"GENERAL_PRINCIPLE",text:k.displayTextVi,factIds:[],evidenceIds:sources}]},
      sourceLinks:sources.map(sourceId=>({claimIndex:0,sourceId,excerptIds:refs.filter((e:{sourceId:string})=>e.sourceId===sourceId).map((e:{excerptId:string})=>e.excerptId)})),
      claimLinks:[{claimIndex:0,knowledgeClaimId:k.id,knowledgeClaimHash:k.claimHash}]}:raw;
    return pilotTransport(JSON.stringify(candidate)).invoke(input,new AbortController().signal);
  }};
  const directory=path.join(f.root,"run"),result=await runControlledPilot({config,directory,transport});
  assert.equal(result.actualBedrockCalls,0);assert.equal(result.denominators.inferenceAttempts,40);assert.equal(result.denominators.failed,0);assert.equal(result.scientificPass,null);
  assert.equal(fs.existsSync(directory+"-reviewers/R2"),false);
  const answers=fs.readdirSync(directory).filter(n=>n.startsWith("answer-"));assert.equal(answers.length,40);
  assert.ok(answers.some(name=>JSON.parse(fs.readFileSync(path.join(directory,name),"utf8")).raw.parsedCandidate.claimLinks.length>0));
  for(const name of answers){const a=JSON.parse(fs.readFileSync(path.join(directory,name),"utf8"));assert.ok(Object.hasOwn(a.raw.parsedCandidate,"claimLinks"));assert.equal(a.candidateHash,digest(a.raw.parsedCandidate));
    assert.deepEqual(a.verification.e2.identityIssues,[]);
    const p=a.packets.reviewers[0];validatePacketContract(p);const exported=JSON.parse(fs.readFileSync(path.join(directory+"-reviewers/R1",p.body.instanceId+".json"),"utf8"));verifyReviewerExport(exported,p.reviewerExportHashes.R1);
    // Excerpts legitimately carry authorship=ORIGINAL_SCIENTIFIC_EXCERPT; owner authorship/labels remain private.
    assert.equal(Object.hasOwn(exported,"authorship"),false);
    assert.ok(!/PRIVATE_|clusterId|caseKey|ownerReviewedDeclared|sawModelOutputBeforeAuthoring|copiedFromAiDraftOrCalibration|expectedAssessment/.test(JSON.stringify(exported)));}
});
