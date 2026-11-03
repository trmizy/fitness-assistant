/** Synthetic-only intake snapshot. Never copied from the owner's dataset. */
import { digest } from "../../evaluation/evaluation-kit/identity";
function intakeCases() {
  return Array.from({length:20},(_,i)=>({schema:"e3-case-intake-v1",caseKey:"case-intake-fixture-"+(i+1),slot:i+1,family:"fixture-family-"+(i%8),clusterId:"cluster-intake-fixture-"+(i+1),revision:1,
    createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-02T00:00:00.000Z",template:{fixtureOnly:true},
    meta:{title:"SYNTHETIC FIXTURE",contextDescription:"PRIVATE_CONTEXT_SENTINEL"},
    trainee:{goal:"sức mạnh",age:30,experience:"PRIVATE_EXPERIENCE_SENTINEL",conditionsNote:"PRIVATE_UNMAPPED_SENTINEL"},
    training:{hasData:true,noDataReason:"",dataQuality:"PARTIAL",windowDays:28,sessions:[{id:"s-1",week:1,date:null,exercise:"Bench press",sets:3,reps:8,weightKg:60,rir:null,rpe:null,restSec:null,rom:"",technique:"",note:"SYNTHETIC_LOG_VISIBLE",na:{sets:false,reps:false,weightKg:false,rir:true,rpe:true,restSec:true},copyPending:false}]},
    question:{text:"Tôi chưa tăng tạ nhưng số lần lặp tăng. Progressive overload có chỉ là tăng tạ không?",conversation:[{role:"user",text:"SYNTHETIC_HISTORY_VISIBLE"}],variants:[
      {id:"v-1",kind:"WORDING",usesCaseLog:true,style:null,level:null,muscleGroup:null,exerciseType:null,text:"Tập bench press như thế có tiến bộ chưa?",facts:["PRIVATE_VARIANT_FACT_SENTINEL"],unsupported:["PRIVATE_UNSUPPORTED_SENTINEL"],claims:["PRIVATE_CLAIM_SENTINEL"],note:"PRIVATE_VARIANT_NOTE_SENTINEL"},
      {id:"v-2",kind:"TRANSFER",usesCaseLog:false,style:null,level:null,muscleGroup:null,exerciseType:null,text:"Squat 40 kg được 5 lần; đã tăng cơ chưa?",facts:["PRIVATE_TRANSFER_FACT_SENTINEL"],unsupported:[],claims:[],note:"PRIVATE_TRANSFER_NOTE_SENTINEL"}]},
    knowledge:{reviewerNotes:"PRIVATE_REVIEWER_SENTINEL",conflictingInformation:["PRIVATE_CONFLICT_SENTINEL"]},
    labels:{expectedAssessment:[1,5,10,12].includes(i)?null:"INSUFFICIENT_DATA",rationale:"PRIVATE_LABEL_SENTINEL",expectedOutcomeScope:["UNRESOLVED"],safety:"NORMAL",appropriateAbstention:true,idealBehavior:"ASK",corpusCoverage:"PARTIAL",relevantClaimIds:["PRIVATE_RELEVANT_CLAIM"],evidenceTrap:{kind:null,targetClaimIds:[],note:"PRIVATE_TRAP"}},
    authorship:{authorType:"OWNER_AUTHORED_AI_ASSISTED",sourceType:"SYNTHETIC_FROM_AI_SEED",isSynthetic:true,aiAssisted:true,aiSeedUsed:true,ownerReviewed:false,independenceAttested:false,casePurpose:"OWNER_EXPLORATORY",copiedFromAiDraftOrCalibration:i===0,sawModelOutputBeforeAuthoring:i===0},
    validation:{ownerConfirmedAt:"2026-01-02T00:00:00.000Z",contentHash:""}}));
}
export function intakeSnapshot() { return sealIntake(intakeCases()); }
export function sealIntake(cases: ReturnType<typeof intakeCases>) {
  for(const c of cases){const q={...c.question}; const content=Object.fromEntries(["meta","trainee","training","question","knowledge","labels","authorship"].map(k=>[k,(c as Record<string,unknown>)[k]]));
    if(!q.variants.length){const {variants:_v,...rest}=q;content.question=rest;} c.validation.contentHash=digest(content);}
  const canonical={schema:"e3-case-intake-v1",cases};
  const manifest={schema:"e3-case-intake-freeze-manifest-v1",snapshotId:"freeze-001-20260102T010000Z",datasetId:"11111111-1111-4111-8111-111111111111",workingRevision:1,frozenAt:"2026-01-02T01:00:00.000Z",caseCount:20,
    canonicalSha256:digest(canonical),familyCounts:cases.reduce((a,c)=>({...a,[c.family]:(a[c.family]||0)+1}),{} as Record<string,number>),perCase:cases.map(c=>({caseKey:c.caseKey,slot:c.slot,family:c.family,sha256:digest(c)})),
    independentHeldOut:false,goldLabels:false,runnerReleased:false,variantCount:cases.reduce((n,c)=>n+c.question.variants.length,0),provenance:{ownerConfirmedInTool:20,ownerReviewedDeclared:cases.filter(c=>c.authorship.ownerReviewed).length,total:20}};
  return {manifest,canonical,pins:{manifestHash:digest(manifest),canonicalHash:digest(canonical)}};
}

/** Independently authored synthetic candidate with the published intake v1 projection convention. */
export function intakeCandidate(s: ReturnType<typeof intakeSnapshot>) {
  const requests:unknown[]=[],annotations:unknown[]=[];
  for(const c of s.canonical.cases){
    const suffix=c.caseKey.slice(5),subjectId="synthetic-"+suffix,requestRef="req-"+String(c.slot).padStart(2,"0");
    const facts=c.training.sessions.map((row,i)=>({id:"DEV_F_"+suffix.toUpperCase().replace(/[^A-Z0-9]/g,"_")+"_"+String(i+1).padStart(2,"0"),evidence:{domain:"TRAINING",kind:"training_log_row",value:{week:row.week,date:row.date,exercise:row.exercise,sets:row.sets,reps:row.reps,weightKg:row.weightKg,rir:row.rir,rpe:row.rpe,restSec:row.restSec,rom:null,technique:null,note:row.note,notAvailableFields:"rir,rpe,restSec"},quality:row?c.training.dataQuality:null,provenance:"TRAINING_LOGS",window:{days:c.training.windowDays},claimBoundary:"DESCRIPTIVE_ONLY"}}));
    const base={dataClass:"SYNTHETIC_DEV",subjectId,snapshots:[{subjectId,namespace:"TRAINING",owner:"fitness-service",recordedAt:s.manifest.frozenAt,facts}]};
    const flags={aiAssisted:true,aiSeedUsed:true,ownerReviewedDeclared:false,copiedFromAiDraftOrCalibration:c.authorship.copiedFromAiDraftOrCalibration,sawModelOutputBeforeAuthoring:c.authorship.sawModelOutputBeforeAuthoring,independenceAttested:false};
    const primary={requestRef,caseKey:c.caseKey,clusterId:c.clusterId,variantId:null,kind:"PRIMARY"};
    requests.push({...primary,request:{...base,caseId:"dev-"+suffix,question:c.question.text,profile:{owner:"user-service",goal:c.trainee.goal},conversation:c.question.conversation.map(t=>({...t,subjectId}))}});
    annotations.push({...primary,labels:c.labels,authorship:flags});
    c.question.variants.forEach((v,i)=>{const entry={requestRef:requestRef+"-v"+(i+1),caseKey:c.caseKey,clusterId:c.clusterId,variantId:v.id,kind:v.kind};
      requests.push({...entry,request:{...base,snapshots:v.usesCaseLog?base.snapshots:[],caseId:"dev-"+suffix+"-v"+(i+1),question:v.text,profile:{owner:"user-service",goal:v.usesCaseLog?c.trainee.goal:null},conversation:[]}});
      const {id:_id,kind:_kind,text:_text,...variant}=v;
      annotations.push({...entry,labelsInheritedFromCluster:v.kind==="WORDING",variant,labels:v.kind==="WORDING"?c.labels:null,authorship:flags});});
  }
  const source={sourceSnapshotId:s.manifest.snapshotId,sourceCanonicalSha256:s.manifest.canonicalSha256};
  const req={format:"e3-d1-candidate-requests-v1",...source,requests},ann={format:"e3-d1-candidate-owner-annotations-v1",...source,note:"TEST FIXTURE NOT GOLD",annotations};
  const manifest={schema:"e3-d1-candidate-manifest-v1",status:"CANDIDATE_NOT_A_REVIEWER_CASE_NOT_RELEASED",...source,sourceFrozenAt:s.manifest.frozenAt,requestsSha256:digest(req),annotationsSha256:digest(ann),counts:{caseClusters:20,primaryRequests:20,variantRequests:requests.length-20,totalRequests:requests.length},recordedAtConvention:{value:s.manifest.frozenAt,rule:"Fixture capture time, not measurement"}};
  return {documents:{manifest,requests:req,annotations:ann},pins:{manifestHash:digest(manifest)}};
}
