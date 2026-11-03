/** Candidate identity check and explicit reconciliation to the official snapshot projection. No runner or scorer. */
import { z } from "zod";
import { DevRequestSchema } from "../ai-coach-dev/context";
import { digest } from "../evaluation-kit/identity";
import { bindIntakeGeneration, IntakeCaseSchema, type convertFrozenIntake } from "./converter";
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const identity={requestRef:z.string(),caseKey:z.string(),clusterId:z.string(),variantId:z.string().nullable(),kind:z.enum(["PRIMARY","WORDING","TRANSFER"])};
const Requests=z.object({format:z.literal("e3-d1-candidate-requests-v1"),sourceSnapshotId:z.string(),sourceCanonicalSha256:Hash,
  requests:z.array(z.object({...identity,request:DevRequestSchema}).strict())}).strict();
const Annotations=z.object({format:z.literal("e3-d1-candidate-owner-annotations-v1"),sourceSnapshotId:z.string(),sourceCanonicalSha256:Hash,note:z.string(),annotations:z.array(z.record(z.unknown()))}).strict();
const Metadata=z.object({schema:z.literal("e3-d1-candidate-manifest-v1"),status:z.literal("CANDIDATE_NOT_A_REVIEWER_CASE_NOT_RELEASED"),sourceSnapshotId:z.string(),sourceCanonicalSha256:Hash,sourceFrozenAt:z.string().datetime(),
  requestsSha256:Hash,annotationsSha256:Hash,counts:z.object({caseClusters:z.literal(20),primaryRequests:z.literal(20),variantRequests:z.number().int().nonnegative(),totalRequests:z.number().int().positive()}).strict(),
  recordedAtConvention:z.object({value:z.string().datetime(),rule:z.string()}).strict()}).passthrough();
export interface CandidateDocuments { manifest:unknown;requests:unknown;annotations:unknown }
function same(a:unknown,b:unknown,error:string){if(digest(a)!==digest(b))throw new Error(error);}

export function admitD1Candidate(converted: ReturnType<typeof convertFrozenIntake>, documents: CandidateDocuments, pins:{manifestHash:string}) {
  same(digest(documents.manifest),Hash.parse(pins.manifestHash),"CandidateManifestHashMismatch");
  const m=Metadata.parse(documents.manifest),r=Requests.parse(documents.requests),a=Annotations.parse(documents.annotations);
  if(digest(documents.requests)!==m.requestsSha256||digest(documents.annotations)!==m.annotationsSha256)throw new Error("CandidateDocumentHashMismatch");
  const frozen=converted.privateSidecar.source.manifest as {snapshotId:string;frozenAt:string};
  for(const v of [m,r,a])if(v.sourceSnapshotId!==frozen.snapshotId||v.sourceCanonicalSha256!==converted.privateSidecar.source.pins.canonicalHash)throw new Error("CandidateFrozenSourceMismatch");
  if(m.sourceFrozenAt!==frozen.frozenAt||m.recordedAtConvention.value!==frozen.frozenAt)throw new Error("CandidateTimestampConventionMismatch");
  const canonical=converted.privateSidecar.source.canonical as {cases:unknown[]};
  const expectedRequests:unknown[]=[],expectedAnnotations:unknown[]=[];
  const pad=(n:number)=>String(n).padStart(2,"0");
  for(const raw of canonical.cases){
    const c=IntakeCaseSchema.parse(raw),suffix=c.caseKey.slice(5),subjectId="synthetic-"+suffix,requestRef="req-"+pad(c.slot);
    // Reconstruct the published candidate convention only to check for loss/tampering, not to infer measurement times.
    const facts=c.training.sessions.map((row,i)=>({id:"DEV_F_"+suffix.toUpperCase().replace(/[^A-Z0-9]/g,"_")+"_"+pad(i+1),evidence:{domain:"TRAINING",kind:"training_log_row",
      value:{week:row.week,date:row.date,exercise:row.exercise||null,sets:row.sets,reps:row.reps,weightKg:row.weightKg,rir:row.rir,rpe:row.rpe,restSec:row.restSec,
        rom:row.rom||null,technique:row.technique||null,note:row.note||null,notAvailableFields:["sets","reps","weightKg","rir","rpe","restSec"].filter(k=>row.na[k]).join(",")||null},
      quality:c.training.dataQuality,provenance:"TRAINING_LOGS",window:c.training.windowDays?{days:c.training.windowDays}:null,claimBoundary:"DESCRIPTIVE_ONLY"}}));
    const snapshots=facts.length?[{subjectId,namespace:"TRAINING",owner:"fitness-service",recordedAt:frozen.frozenAt,facts}]:[];
    const base={dataClass:"SYNTHETIC_DEV",subjectId,snapshots};
    const labels=Object.fromEntries(["expectedOutcomeScope","expectedAssessment","safety","appropriateAbstention","rationale","idealBehavior","corpusCoverage","relevantClaimIds","evidenceTrap"].map(k=>[k,c.labels[k]]));
    const authorship={...Object.fromEntries(["aiAssisted","aiSeedUsed","copiedFromAiDraftOrCalibration","sawModelOutputBeforeAuthoring","independenceAttested"].map(k=>[k,c.authorship[k]])),ownerReviewedDeclared:c.authorship.ownerReviewed};
    const entry={requestRef,caseKey:c.caseKey,clusterId:c.clusterId,variantId:null,kind:"PRIMARY"};
    expectedRequests.push({...entry,request:{...base,caseId:"dev-"+suffix,question:c.question.text,profile:{owner:"user-service",goal:c.trainee.goal||null},conversation:c.question.conversation.map(t=>({subjectId,role:t.role,text:t.text}))}});
    expectedAnnotations.push({...entry,labels,authorship});
    for(const [i,v] of c.question.variants.entries()){
      const id={requestRef:requestRef+"-v"+(i+1),caseKey:c.caseKey,clusterId:c.clusterId,variantId:v.id,kind:v.kind};
      expectedRequests.push({...id,request:{...base,snapshots:v.usesCaseLog?snapshots:[],caseId:"dev-"+suffix+"-v"+(i+1),question:v.text,profile:{owner:"user-service",goal:v.usesCaseLog?(c.trainee.goal||null):null},conversation:[]}});
      expectedAnnotations.push({...id,labelsInheritedFromCluster:v.kind==="WORDING",variant:Object.fromEntries(["style","level","muscleGroup","exerciseType","usesCaseLog","facts","unsupported","claims","note"].map(k=>[k,v[k]])),labels:v.kind==="WORDING"?labels:null,authorship});
    }
  }
  if(r.requests.length!==expectedRequests.length||m.counts.totalRequests!==r.requests.length||m.counts.variantRequests!==r.requests.length-20)throw new Error("CandidateCountsMismatch");
  same(r.requests,expectedRequests,"CandidateRequestOrClusterMismatch");
  same(a.annotations,expectedAnnotations,"CandidateAnnotationOrClusterMismatch");
  const candidateAdmission={documents:structuredClone(documents),pins,validation:{directCurrentDevRequestSchema:true,valid:r.requests.length,invalid:0,primary:20,variants:r.requests.length-20},
    reconciliation:["Candidate freeze-time recordedAt is capture convention only; official mapping uses actual case confirmation capture time, never a measurement date.",
      "Official mapping restores training availability/no-data reason and raw empty strings, keeps dates/nulls, and assigns source-linked fact IDs.",
      "Variant request IDs are reconciled by canonical variant ID/cluster, not independent sample IDs. All original candidate bytes represented as parsed JSON remain private."]};
  const privateSidecar={...converted.privateSidecar,candidateAdmission};
  return {...converted,privateSidecar,generation:bindIntakeGeneration(converted.generation,privateSidecar,converted.privateSidecar.source.pins.manifestHash),candidateValidation:candidateAdmission.validation};
}
