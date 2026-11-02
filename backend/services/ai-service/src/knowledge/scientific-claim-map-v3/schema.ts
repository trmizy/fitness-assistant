import { z } from "zod";

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const bundleSchema = z.object({
  version: z.literal("scientific-claim-map-input-v3"),
  baselineHead: z.string(),
  files: z.record(z.object({ origin: z.string(), sha256: sha256Schema, text: z.string() }).strict()),
}).strict();
export type InputBundle = z.infer<typeof bundleSchema>;

export const claimSchema = z.object({
  id: z.string(), version: z.literal(3), parentDecisionId: z.string(),
  kind: z.enum(["SCIENTIFIC", "PRODUCT_POLICY", "MEASUREMENT_DEFINITION", "APPLICATION_INFERENCE"]),
  audience: z.enum(["DEV_COACH_CONTEXT", "REVIEW_CONTEXT_ONLY"]),
  approval: z.enum(["OWNER_ACCEPTED", "REJECTED", "REVISION_OR_VERIFICATION_REQUIRED", "NOT_DECIDED"]),
  admission: z.enum(["ADMITTED_DEV_OFFLINE", "HELD_EVIDENCE", "REJECTED", "PENDING_OWNER"]),
  approvedTextVi: z.string().nullable(),
  originalProposedTextVi: z.string(),
  ownerDecision: z.record(z.unknown()).nullable(),
  aiProposal: z.record(z.unknown()),
  provenance: z.object({
    ownerFileSha256: sha256Schema, ownerRecordSha256: sha256Schema.nullable(),
    reviewFileSha256: sha256Schema, followupFileSha256: sha256Schema,
    pointer: z.string(), parentApprovedTextVi: z.string().nullable(),
    segment: z.object({ start: z.number().int(), end: z.number().int() }).nullable(),
    declaredSourceRefs: z.record(z.string()),
    itemHashVerification: z.literal("PRESERVED_NOT_RECOMPUTED_USING_UI_CONTRACT"),
  }).strict(),
  evidenceReferences: z.array(z.object({
    sourceId: z.string(), kind: z.enum(["PRIMARY_SCIENTIFIC", "CODE_PRODUCT_DEFINITION"]),
    title: z.string(), url: z.string(), readScope: z.string(),
    sourceSha256: sha256Schema, capturedBodySha256: sha256Schema,
    quote: z.string(), capturedQuote: z.string().nullable(), locator: z.string(), role: z.string(),
    textMatch: z.enum(["EXACT", "NORMALIZED_TYPOGRAPHY_WHITESPACE_CASE", "NOT_FOUND"]),
    semanticSupport: z.literal("IMPLEMENTER_BINDING_NOT_INDEPENDENTLY_VALIDATED"),
  }).strict()),
  population: z.array(z.string()), applicability: z.array(z.string()),
  evidenceLimitations: z.array(z.string()), unsupportedInferences: z.array(z.string()),
  certainty: z.record(z.unknown()),
  scopeProvenance: z.object({ originalConditions: z.array(z.string()), originalCannotInfer: z.array(z.string()), supersededScope: z.boolean() }).strict(),
  sourceHashes: z.record(sha256Schema), admissionReasons: z.array(z.string()),
}).strict();
export type ClaimV3 = z.infer<typeof claimSchema>;

export const mapSchema = z.object({
  contract: z.literal("scientific-claim-map-v3"), version: z.literal(3),
  authority: z.literal("OWNER_DEVELOPER_ACCEPTED_ASSISTANT_SOURCE_MATCHED_NOT_INDEPENDENT_SCIENTIFIC_VALIDATION"),
  useBoundary: z.literal("DEV_OFFLINE_ONLY_NO_PRODUCTION_ADMISSION"),
  independentScientificValidation: z.literal(false),
  baselineHead: z.string(), inputBundleSha256: sha256Schema, ownerRevision: z.number(), ownerUpdatedAt: z.string(),
  inputHashes: z.record(sha256Schema), claims: z.array(claimSchema),
  articleDecisions: z.array(z.record(z.unknown())), calibrationDecisions: z.array(z.record(z.unknown())),
  pendingEngineering: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
  counts: z.object({ total: z.number(), admitted: z.number(), heldEvidence: z.number(), pendingOwner: z.number(), rejected: z.number() }).strict(),
}).strict();
export type ClaimMapV3 = z.infer<typeof mapSchema>;
