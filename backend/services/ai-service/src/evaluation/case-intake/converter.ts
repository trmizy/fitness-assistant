/** Offline intake conversion only. No ingestion, model, scientific calculation or owner mutation. */
import { z } from "zod";
import { DevRequestSchema, type DevRequest } from "../ai-coach-dev/context";
import { digest } from "../evaluation-kit/identity";
import { ManifestSchema, validateGenerationBundle } from "../evaluation-kit/annotations";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Variant = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), kind: z.enum(["WORDING", "TRANSFER"]), usesCaseLog: z.boolean(), text: z.string().min(1).max(3000) }).passthrough();
export const IntakeCaseSchema = z.object({ schema: z.literal("e3-case-intake-v1"), caseKey: z.string().regex(/^case-[a-z0-9-]+$/), slot: z.number().int().positive(), family: z.string(), clusterId: z.string().min(1),
  meta: z.record(z.unknown()), trainee: z.object({ goal: z.string().max(200).nullable() }).passthrough(),
  training: z.object({ hasData: z.boolean(), noDataReason: z.string(), dataQuality: z.enum(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]), windowDays: z.number().int().positive().max(365).nullable(),
    sessions: z.array(z.object({ id: z.string(), week: z.number().int().positive().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      exercise: z.string(), sets: z.number().finite().nullable(), reps: z.number().finite().nullable(), weightKg: z.number().finite().nullable(), rir: z.number().finite().nullable(), rpe: z.number().finite().nullable(), restSec: z.number().finite().nullable(),
      rom: z.string(), technique: z.string(), note: z.string(), na: z.record(z.boolean()), copyPending: z.boolean() }).passthrough()) }).passthrough(),
  question: z.object({ text: z.string().min(1).max(3000), conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }).passthrough()).max(6), variants: z.array(Variant).default([]) }).passthrough(),
  knowledge: z.record(z.unknown()), labels: z.object({ expectedAssessment: z.enum(["INSUFFICIENT_DATA", "OBSERVED_PROGRESS", "NO_OBSERVED_CHANGE"]).nullable() }).passthrough(),
  authorship: z.object({ isSynthetic: z.literal(true), aiAssisted: z.boolean(), ownerReviewed: z.boolean(), independenceAttested: z.literal(false), casePurpose: z.literal("OWNER_EXPLORATORY"), copiedFromAiDraftOrCalibration: z.boolean(), sawModelOutputBeforeAuthoring: z.boolean() }).passthrough(),
  validation: z.object({ ownerConfirmedAt: z.string().datetime(), contentHash: Hash }).passthrough(),
}).passthrough();
const Freeze = z.object({ schema: z.literal("e3-case-intake-freeze-manifest-v1"), snapshotId: z.string().regex(/^freeze-\d{3}-\d{8}T\d{6}Z$/), datasetId: z.string().uuid(), workingRevision: z.number().int().positive(),
  frozenAt: z.string().datetime(), caseCount: z.literal(20), canonicalSha256: Hash, familyCounts: z.record(z.number().int().positive()),
  perCase: z.array(z.object({ caseKey: z.string(), slot: z.number(), family: z.string(), sha256: Hash }).passthrough()).length(20),
  independentHeldOut: z.literal(false), goldLabels: z.literal(false), runnerReleased: z.literal(false), variantCount: z.number().int().nonnegative(),
  provenance: z.object({ ownerConfirmedInTool: z.literal(20), ownerReviewedDeclared: z.number().int().min(0).max(20), total: z.literal(20) }).passthrough(),
}).passthrough();
type IntakeCase = z.infer<typeof IntakeCaseSchema>;
const contentKeys = ["meta", "trainee", "training", "question", "knowledge", "labels", "authorship"];
function content(c: Record<string, unknown>) {
  const result = Object.fromEntries(contentKeys.map(k => [k, c[k]]));
  // Match intake's historical no-variant fingerprint compatibility.
  const q = { ...result.question as Record<string, unknown> };
  if (!Array.isArray(q.variants) || !q.variants.length) delete q.variants;
  return { ...result, question: q };
}
function fail(message: string): never { throw new Error(message); }
function assertUnique(values: unknown[], what: string) { if (new Set(values).size !== values.length) fail("DuplicateIntake" + what); }
const record = (r: unknown) => z.record(z.union([z.number().finite(), z.string().max(300), z.boolean(), z.null()])).parse(r);

function requestFor(c: IntakeCase): DevRequest {
  const subjectId = "synthetic-" + c.caseKey.slice(5), prefix = "DEV_F_" + c.slot;
  // recordedAt is the actual CASE CONFIRMATION record time, never an invented measurement/session date.
  const temporal = { recordedAtMeaning: "CASE_CONFIRMATION_CAPTURE_NOT_MEASUREMENT_TIME", measurementDatesKnown: c.training.sessions.every(r => r.date !== null) && c.training.sessions.length > 0 };
  const fact = (id: string, kind: string, value: unknown) => ({ id, evidence: { domain: "TRAINING" as const, kind, value: record(value), quality: c.training.dataQuality,
    provenance: "TRAINING_LOGS" as const, window: c.training.windowDays === null ? null : { days: c.training.windowDays }, claimBoundary: "DESCRIPTIVE_ONLY" as const } });
  const rows = c.training.sessions.map((r,i) => {
    if (r.copyPending) fail("UnconfirmedCopiedTrainingRow");
    const { id: _id, na, copyPending: _pending, ...values } = r;
    if (Object.keys(values).some(k => !["week","date","exercise","sets","reps","weightKg","rir","rpe","restSec","rom","technique","note"].includes(k))) fail("UnmappedTrainingRowField");
    return fact(prefix + "_ROW_" + (i+1), "training_log_row", { ...values, ...temporal,
      missingFields: Object.keys(na).filter(k => na[k]).join(",") || null });
  });
  const availability = fact(prefix + "_CONTEXT", "intake_training_context", { hasData: c.training.hasData, noDataReason: c.training.noDataReason || null, ...temporal });
  // No aggregation, truncation, inferred e1RM, outcome or date imputation.
  if (rows.length + 1 > 20) fail("IntakeFactLimitExceeded");
  if (!c.training.hasData && rows.length) fail("TrainingAvailabilityRowsConflict");
  return DevRequestSchema.parse({ dataClass: "SYNTHETIC_DEV", caseId: "dev-" + c.caseKey.slice(5), subjectId, question: c.question.text,
    profile: { owner: "user-service", goal: c.trainee.goal || null },
    snapshots: [{ subjectId, namespace: "TRAINING", owner: "fitness-service", recordedAt: c.validation.ownerConfirmedAt, facts: [availability,...rows] }],
    conversation: c.question.conversation.map(turn => ({ subjectId, role:turn.role, text:turn.text })) });
}
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && Object.keys(value).length) return Object.entries(value).flatMap(([k,v]) => leafPaths(v, prefix ? prefix + "." + k : k));
  return [prefix];
}
function disposition(p: string) {
  if (/^question\.variants\./.test(p)) return "PRIVATE_VARIANT_ARCHIVE_NOT_SCHEDULED";
  if (/^question\.(text|conversation\.)/.test(p) || p === "trainee.goal" || /^training\.(hasData|noDataReason|dataQuality|windowDays|sessions\.)/.test(p)) return "GENERATION_ALLOWLIST_PROJECTION_WITH_RAW_PRESERVED";
  if (p === "validation.ownerConfirmedAt") return "CASE_CAPTURE_TIMESTAMP_ONLY_NOT_MEASUREMENT";
  if (/^trainee\./.test(p)) return "UNMAPPED_PERSONAL_CONTEXT_PRIVATE_ONLY";
  return "PRIVATE_PROVENANCE_LABEL_OR_UNMAPPED_FIELD";
}

/** Caller-owned pins are separate from untrusted frozen input. This does not issue model/spend authorization. */
export function convertFrozenIntake(manifestValue: unknown, canonicalValue: unknown, pins: { manifestHash: string; canonicalHash: string }) {
  if (digest(manifestValue) !== Hash.parse(pins.manifestHash)) fail("IntakeManifestHashMismatch");
  if (digest(canonicalValue) !== Hash.parse(pins.canonicalHash)) fail("IntakeCanonicalHashMismatch");
  const m = Freeze.parse(manifestValue), canonical = z.object({ schema:z.literal("e3-case-intake-v1"), cases:z.array(z.unknown()).length(20) }).strict().parse(canonicalValue);
  if (m.canonicalSha256 !== pins.canonicalHash) fail("IntakeManifestCanonicalMismatch");
  const rawCases = canonical.cases as Record<string,unknown>[];
  const cases = rawCases.map(v=>IntakeCaseSchema.parse(v));
  assertUnique(cases.map(c=>c.caseKey),"CaseKey"); assertUnique(cases.map(c=>c.clusterId),"ClusterId"); assertUnique(cases.map(c=>c.slot),"Slot"); assertUnique(m.perCase.map(p=>p.caseKey),"ManifestKey");
  const families:Record<string,number> = {};
  for (const [i,c] of cases.entries()) {
    const entry=m.perCase.find(p=>p.caseKey===c.caseKey);
    if (!entry || entry.sha256!==digest(rawCases[i]) || entry.slot!==c.slot || entry.family!==c.family) fail("IntakePerCaseHashMismatch");
    if (digest(content(rawCases[i]))!==c.validation.contentHash) fail("IntakeConfirmationContentMismatch");
    if (Date.parse(c.validation.ownerConfirmedAt)>Date.parse(m.frozenAt)) fail("IntakeConfirmationAfterFreeze");
    assertUnique(c.question.variants.map(v=>v.id),"VariantId");
    families[c.family]=(families[c.family]||0)+1;
  }
  if (digest(families)!==digest(m.familyCounts)) fail("IntakeFamilyCountsMismatch");
  if (cases.reduce((n,c)=>n+c.question.variants.length,0)!==m.variantCount) fail("IntakeVariantCountMismatch");
  const declared=cases.filter(c=>c.authorship.ownerReviewed).length;
  if (m.provenance.ownerReviewedDeclared!==declared) fail("IntakeReviewDeclarationMismatch");
  const primaries=cases.map(c=>({ caseKey:c.caseKey, clusterId:c.clusterId, request:requestFor(c) }));
  const variantRequests=cases.flatMap((c,i)=>c.question.variants.map(v=>({ caseKey:c.caseKey, clusterId:c.clusterId, variantId:v.id, kind:v.kind, usesCaseLog:v.usesCaseLog,
    scheduled:false, request:DevRequestSchema.parse({ ...structuredClone(primaries[i].request), caseId:primaries[i].request.caseId + "-" + v.id, question:v.text,
      // A variant has only its own question facts unless it explicitly opts into the case log. No parent conversation.
      ...(v.usesCaseLog ? {} : { profile:{owner:"user-service",goal:null}, snapshots:[] }), conversation:[] }) })));
  const compatibility=cases.map((c,i)=>({ caseKey:c.caseKey, clusterId:c.clusterId, fields:leafPaths(rawCases[i]).map(p=>({path:p,disposition:disposition(p)})),
    unmappedPersonalContext:Object.keys(c.trainee).filter(k=>k!=="goal"),
    warning:"D1 independent ReviewerCaseSchema not used. Variant facts/unsupported/claims/notes are reviewer-only; only variant question text and explicitly inherited log reach generation." }));
  const privateSidecar={ version:"intake-private-sidecar-v1", source:{ manifest:structuredClone(manifestValue), canonical:structuredClone(canonicalValue), pins },
    provenance:{ ownerConfirmedInTool:20,ownerReviewedDeclared:declared,aiAssisted:cases.filter(c=>c.authorship.aiAssisted).length,independenceAttested:false,
      purpose:"OWNER_CONFIRMED_EXPLORATORY_NOT_INDEPENDENT_GOLD", legacyRunnerReviewMode:"EXPLORATORY_OWNER_REVIEWED_IS_MODE_NAME_NOT_REVIEW_ATTESTATION" },
    clusterLinkage:primaries.map(p=>({caseKey:p.caseKey,clusterId:p.clusterId,requestHash:digest(p.request)})),variantRequests,compatibility,
    temporalConvention:"snapshot.recordedAt = actual ownerConfirmedAt capture time; all measurement/session dates remain exact/null; no inferred dates or calculations",
    d3Admission:"PENDING_OWNER_EXPLORATORY_CONTRACT_NO_INDEPENDENT_KAPPA_OR_CI" };
  const provenanceHash=digest(privateSidecar);
  const expectedManifests=primaries.map((p,i)=>ManifestSchema.parse({version:"case-freeze-v1",caseKey:p.caseKey,split:"REVIEWED_DEV",requestHash:digest(p.request),
    labelHash:digest(cases[i].labels),authorAttestationHash:digest(cases[i].authorship)}));
  const releaseReceipt=digest({authority:"USER_REQUEST_OFFLINE_FAKE_CONVERSION_ONLY",manifestHash:pins.manifestHash,provenanceHash,variantsScheduled:false,liveAuthorized:false});
  const released=primaries.map((p,i)=>({version:"generation-bundle-v1",request:p.request,freeze:expectedManifests[i],releaseReceiptHash:releaseReceipt}));
  released.forEach((v,i)=>validateGenerationBundle(v,expectedManifests[i],releaseReceipt));
  return { generation:{version:"released-intake-fake-input-v1" as const,scope:"OWNER_CONFIRMED_EXPLORATORY_FAKE_ONLY" as const,provenanceHash,
    released,expectedManifests,ownerReceiptHashes:released.map(()=>releaseReceipt)},privateSidecar,
    summary:{status:"CONVERTED_FAKE_ONLY_NOT_RELEASED_FOR_LIVE",clusters:primaries.length,primaryCases:released.length,archivedVariants:variantRequests.length,scheduledVariants:0,
      ownerConfirmedInTool:20,ownerReviewedDeclared:declared,scientificGold:false,independentHeldOut:false,modelCalls:0} };
}

/** Narrow additive runner file contract; labels/full provenance are only in the separate private sidecar. */
export const IntakeFakeFileSchema=z.object({version:z.literal("released-intake-fake-input-v1"),scope:z.literal("OWNER_CONFIRMED_EXPLORATORY_FAKE_ONLY"),provenanceHash:Hash,
  released:z.array(z.unknown()).length(20),expectedManifests:z.array(z.unknown()).length(20),ownerReceiptHashes:z.array(Hash).length(20)}).strict();

export function bindIntakeGeneration(generation: ReturnType<typeof convertFrozenIntake>["generation"], sidecar: unknown, manifestHash: string) {
  const provenanceHash=digest(sidecar);
  const receipt=digest({authority:"USER_REQUEST_OFFLINE_FAKE_CONVERSION_ONLY",manifestHash,provenanceHash,variantsScheduled:false,liveAuthorized:false});
  return {...generation,provenanceHash, released:generation.released.map(b=>({...b,releaseReceiptHash:receipt})),ownerReceiptHashes:generation.ownerReceiptHashes.map(()=>receipt)};
}
