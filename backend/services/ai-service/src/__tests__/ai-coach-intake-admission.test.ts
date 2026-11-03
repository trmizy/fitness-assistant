import test from "node:test";
import assert from "node:assert/strict";
import { intakeSnapshot,intakeCandidate } from "./fixtures/intake";
import { convertFrozenIntake,bindIntakeGeneration } from "../evaluation/case-intake/converter";
import { admitD1Candidate } from "../evaluation/case-intake/candidate";
import { validateIntakeAdmission } from "../evaluation/case-intake/admission";
import { digest } from "../evaluation/evaluation-kit/identity";
function fixture(){const s=intakeSnapshot(),c=intakeCandidate(s),base=convertFrozenIntake(s.manifest,s.canonical,s.pins);return {s,c,base};}
function repin(c:ReturnType<typeof intakeCandidate>){c.documents.manifest.requestsSha256=digest(c.documents.requests);c.documents.manifest.annotationsSha256=digest(c.documents.annotations);c.pins.manifestHash=digest(c.documents.manifest);}

test("candidate admission directly validates every request and preserves private labels/provenance without independent author fabrication",()=>{
  const {c,base}=fixture(),r=admitD1Candidate(base,c.documents,c.pins);
  assert.deepEqual(r.candidateValidation,{directCurrentDevRequestSchema:true,valid:60,invalid:0,primary:20,variants:40});
  assert.deepEqual(r.privateSidecar.candidateAdmission.documents,c.documents);
  assert.equal(r.privateSidecar.provenance.ownerReviewedDeclared,0);
  assert.equal(r.generation.released.length,20);assert.equal(r.privateSidecar.variantRequests.length,40);
  assert.ok(!JSON.stringify(r.generation.released.map(b=>b.request)).includes("PRIVATE_"));
  assert.ok(!JSON.stringify(r.generation).includes("INDEPENDENT_REVIEWER"));
  assert.doesNotThrow(()=>validateIntakeAdmission(r.generation,r.privateSidecar));
});
test("candidate changed hashes, stale format and stale snapshot source fail closed",()=>{
  const {c,base}=fixture();
  assert.throws(()=>admitD1Candidate(base,c.documents,{manifestHash:"f".repeat(64)}),/ManifestHashMismatch/);
  const changed=structuredClone(c);Object.assign(changed.documents.requests.requests[0] as object,{clusterId:"cluster-wrong"});assert.throws(()=>admitD1Candidate(base,changed.documents,changed.pins),/DocumentHashMismatch/);
  const stale=structuredClone(c);stale.documents.requests.format="e3-d1-candidate-requests-v0";repin(stale);assert.throws(()=>admitD1Candidate(base,stale.documents,stale.pins));
  const wrong=structuredClone(c);for(const d of [wrong.documents.manifest,wrong.documents.requests,wrong.documents.annotations])d.sourceSnapshotId="freeze-999-20250101T000000Z";repin(wrong);
  assert.throws(()=>admitD1Candidate(base,wrong.documents,wrong.pins),/FrozenSourceMismatch/);
});
test("unknown request field, schema-valid reviewer text leakage and unique-but-wrong cluster all reject after rehash",()=>{
  for(const mutation of [
    (row:unknown)=>Object.assign((row as {request:object}).request,{expectedAssessment:"OBSERVED_PROGRESS"}),
    (row:unknown)=>Object.assign((row as {request:object}).request,{question:"PRIVATE_REVIEWER_SENTINEL"}),
    (row:unknown)=>Object.assign(row as object,{clusterId:"cluster-other-unique"}),
  ]){const {c,base}=fixture();mutation(c.documents.requests.requests[0]);repin(c);assert.throws(()=>admitD1Candidate(base,c.documents,c.pins));}
});
test("review declaration/cluster labels cannot be rewritten; transfer labels remain null",()=>{
  const {c,base}=fixture();
  assert.equal((c.documents.annotations.annotations[2] as {labels:unknown}).labels,null);
  const tampered=structuredClone(c);Object.assign((tampered.documents.annotations.annotations[0] as {authorship:object}).authorship,{ownerReviewedDeclared:true});repin(tampered);
  assert.throws(()=>admitD1Candidate(base,tampered.documents,tampered.pins),/AnnotationOrClusterMismatch/);
  const wrong=structuredClone(c);Object.assign((wrong.documents.requests.requests[2] as {request:object}).request,{snapshots:base.generation.released[0].request.snapshots});repin(wrong);
  assert.throws(()=>admitD1Candidate(base,wrong.documents,wrong.pins),/RequestOrClusterMismatch/);
});
test("private sidecar hash and canonical cluster linkage are enforced, including rehashed tampering",()=>{
  const {c,base}=fixture(),r=admitD1Candidate(base,c.documents,c.pins),bad=structuredClone(r.privateSidecar);
  bad.clusterLinkage[0].clusterId="unique-but-wrong";
  assert.throws(()=>validateIntakeAdmission(r.generation,bad),/SidecarHashMismatch/);
  const rebound=bindIntakeGeneration(r.generation,bad,base.privateSidecar.source.pins.manifestHash);
  assert.throws(()=>validateIntakeAdmission(rebound,bad),/SidecarSourceOrClusterMismatch/);
  const generation=structuredClone(r.generation);generation.released[0].request.question="PRIVATE_LABEL_SENTINEL";
  assert.throws(()=>validateIntakeAdmission(generation,r.privateSidecar),/GenerationSourceMismatch/);
});
