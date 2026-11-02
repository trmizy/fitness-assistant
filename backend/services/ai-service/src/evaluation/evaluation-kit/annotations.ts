/** Owner-operated evaluation files. Attestations do not establish scientific gold. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { DevRequestSchema } from "../ai-coach-dev/context";
import { AnalysisEnvelopeSchema } from "../ai-coach-dev/pipeline";
import { canonical, digest } from "./identity";
import { protect } from "./representation";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ReviewerCaseSchema = z.object({
  version: z.literal("reviewer-case-v1"), caseKey: z.string().regex(/^case-[a-z0-9-]+$/), split: z.enum(["REVIEWED_DEV", "HELD_OUT"]),
  author: z.object({ pseudonym: z.string().min(1), role: z.literal("INDEPENDENT_REVIEWER"), independenceAttested: z.literal(true) }).strict(),
  request: DevRequestSchema,
  labels: z.object({ expectedOutcomeScope: z.array(z.enum(["ESTIMATED_STRENGTH", "DIRECT_STRENGTH", "MUSCLE_SIZE", "BODY_WEIGHT", "BODY_FAT", "OTHER", "UNRESOLVED"])).min(1),
    expectedAssessment: z.enum(["INSUFFICIENT_DATA", "OBSERVED_PROGRESS", "NO_OBSERVED_CHANGE"]).nullable(),
    referenceSupport: z.array(z.object({ claimScope: z.string(), sourceId: z.string(), excerptIds: z.array(z.string()), support: z.enum(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_APPLICABLE"]) }).strict()),
    safety: z.enum(["NORMAL", "CRISIS", "HEALTH_SAFETY", "OUT_OF_DOMAIN", "UNRESOLVED"]), appropriateAbstention: z.boolean(), rationale: z.string().min(1),
  }).strict(),
}).strict();
export const ManifestSchema = z.object({ version: z.literal("case-freeze-v1"), caseKey: z.string(), split: z.enum(["REVIEWED_DEV", "HELD_OUT"]), requestHash: Hash, labelHash: Hash, authorAttestationHash: Hash }).strict();
export type CaseManifest = z.infer<typeof ManifestSchema>;
function disjointDirectories(a: string, b: string) {
  const x = path.resolve(a).toLowerCase(), y = path.resolve(b).toLowerCase();
  if (x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep)) throw new Error("PublicAndPrivateDirectoriesMustBeSeparate");
}
export function freezeReviewerCase(value: unknown, manifestDirectory: string, ownerPrivateDirectory: string): CaseManifest {
  const c = ReviewerCaseSchema.parse(value); disjointDirectories(manifestDirectory, ownerPrivateDirectory);
  const salt = randomBytes(32).toString("hex");
  const manifest: CaseManifest = { version: "case-freeze-v1", caseKey: c.caseKey, split: c.split, requestHash: digest(c.request), labelHash: digest({ salt, labels: c.labels }), authorAttestationHash: digest(c.author) };
  fs.mkdirSync(manifestDirectory, { recursive: true }); fs.mkdirSync(ownerPrivateDirectory, { recursive: true });
  fs.writeFileSync(path.join(ownerPrivateDirectory, c.caseKey + ".json"), canonical({ case: c, salt }), { flag: "wx" });
  fs.writeFileSync(path.join(manifestDirectory, c.caseKey + ".manifest.json"), canonical(manifest), { flag: "wx" });
  return manifest;
}
const ReleaseSchema = z.object({ ownerPseudonym: z.string().min(1), manifestHash: Hash, purpose: z.literal("CONTROLLED_EVALUATION"), releaseHeldOut: z.boolean(), expiresAt: z.string().datetime() }).strict();
export function releaseGenerationBundle(privateValue: unknown, manifestValue: unknown, approvalValue: unknown) {
  const sealed = z.object({ case: ReviewerCaseSchema, salt: z.string().length(64) }).strict().parse(privateValue);
  const m = ManifestSchema.parse(manifestValue), approval = ReleaseSchema.parse(approvalValue), c = sealed.case;
  if (approval.manifestHash !== digest(m) || Date.parse(approval.expiresAt) <= Date.now() || (m.split === "HELD_OUT" && !approval.releaseHeldOut)) throw new Error("OwnerReleaseRequired");
  if (c.caseKey !== m.caseKey || c.split !== m.split || digest(c.request) !== m.requestHash || digest({ salt: sealed.salt, labels: c.labels }) !== m.labelHash || digest(c.author) !== m.authorAttestationHash) throw new Error("FrozenCaseOrLabelChanged");
  // Explicit allowlist: labels, author metadata and the salt cannot enter generation.
  return { version: "generation-bundle-v1" as const, request: c.request, freeze: m, releaseReceiptHash: digest(approval) };
}
export function validateGenerationBundle(value: unknown, expectedManifest: unknown, expectedReleaseReceiptHash: string) {
  const bundle = z.object({ version: z.literal("generation-bundle-v1"), request: DevRequestSchema, freeze: ManifestSchema, releaseReceiptHash: Hash }).strict().parse(value);
  const expected = ManifestSchema.parse(expectedManifest);
  if (digest(bundle.freeze) !== digest(expected) || bundle.releaseReceiptHash !== expectedReleaseReceiptHash || digest(bundle.request) !== expected.requestHash) throw new Error("GenerationRequestChangedAfterFreeze");
  return bundle;
}
export function annotationUnits(candidate: unknown) {
  const parsed = AnalysisEnvelopeSchema.safeParse(candidate);
  return parsed.success ? [
    ...parsed.data.analysis.claims.map((c, i) => ({ unitId: "CLAIM_" + i, type: c.claimType, text: c.text, factIds: c.factIds, evidenceIds: c.evidenceIds })),
    { unitId: "CONCLUSION", type: "CONCLUSION", text: parsed.data.analysis.rationaleSummary, assessment: parsed.data.analysis.assessment, assessmentBasis: parsed.data.analysis.assessmentBasis },
    ...parsed.data.analysis.missingInformation.map((q, i) => ({ unitId: "QUESTION_" + i, type: "QUESTION", text: q.question })),
  ] : [{ unitId: "INVALID_OUTPUT", type: "INVALID_OUTPUT", rawCandidate: candidate }];
}
export function createAnnotationPackets(original: { question: string; facts: unknown; evidence: unknown; candidate: unknown; redactionChanged?: boolean }) {
  const protectedInput = protect(original), input = protectedInput.value as typeof original;
  const units = annotationUnits(input.candidate);
  const instanceId = randomUUID();
  // Drop retrieval trace/status/treatment and any extra case/label metadata.
  const evidence = input.evidence && typeof input.evidence === "object" && "passages" in input.evidence ? (input.evidence as { passages: unknown }).passages : input.evidence;
  const publicEvidence = Array.isArray(evidence) ? evidence.map((value) => {
    const p = value as { source?: { id?: unknown; title?: unknown; doi?: unknown; url?: unknown; applicability?: unknown; limitations?: unknown }; excerpts?: { id?: unknown; text?: unknown; locator?: unknown; authorship?: unknown }[] };
    return { sourceId: p.source?.id ?? null, sourceMetadata: { title: p.source?.title ?? null, doi: p.source?.doi ?? null, url: p.source?.url ?? null }, originalExcerpts: (p.excerpts ?? []).map((e) => ({ id: e.id ?? null, text: e.text ?? null, locator: e.locator ?? null, authorship: e.authorship ?? "UNVERIFIED" })), assistantAuthoredInterpretation: { applicability: p.source?.applicability ?? null, limitations: p.source?.limitations ?? null } };
  }) : [];
  const body = { instanceId, question: input.question, facts: input.facts, evidence: publicEvidence, units, candidateHash: digest(input.candidate),
    representation: { version: "redacted-canonical-v1", ...protectedInput.receipt, scoringDisposition: protectedInput.receipt.changed || original.redactionChanged ? "REDACTED_NOT_SCORED" : "UNCHANGED" } };
  const packetHash = digest(body);
  return { ownerLinkage: { instanceId, packetHash, candidateHash: body.candidateHash }, reviewers: ["R1", "R2"].map((reviewerSlot) => ({ packetHash, reviewerSlot, body })) };
}
const Factual = z.enum(["SUPPORTED", "CONTRADICTED", "NOT_ESTABLISHED", "NOT_APPLICABLE", "NOT_EVALUATED"]);
export type ReviewerPacket = ReturnType<typeof createAnnotationPackets>["reviewers"][number] & { reviewerExportHashes?: Record<string, string> };
const Support = z.enum(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_APPLICABLE", "NOT_EVALUATED"]);
const Uncertainty = z.enum(["APPROPRIATE", "OVERCONFIDENT", "UNDERCONFIDENT", "NOT_APPLICABLE", "NOT_EVALUATED"]);
const Abstention = z.enum(["APPROPRIATE", "UNNECESSARY", "NEEDED_BUT_MISSING", "NOT_APPLICABLE", "NOT_EVALUATED"]);
export const PersonalApplicability = z.enum(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_APPLICABLE", "NOT_EVALUATED"]);
export const UnsupportedCausalInference = z.enum(["NONE", "PERSONAL_CAUSE_ASSERTED", "GROUP_TO_INDIVIDUAL", "STRENGTH_TO_HYPERTROPHY", "ATTENDANCE_TO_OUTCOME", "OTHER", "NOT_APPLICABLE", "NOT_EVALUATED"]);
const ReviewReferences = z.object({ unitIds: z.array(z.string()), factIds: z.array(z.string()), sourceIds: z.array(z.string()), excerptIds: z.array(z.string()) }).strict();
const emptyReferences = () => ({ unitIds: [], factIds: [], sourceIds: [], excerptIds: [] });
export const AnnotationSchema = z.object({ packetHash: Hash, reviewerSlot: z.enum(["R1", "R2"]), reviewerPseudonym: z.string().min(1), authority: z.enum(["TEST_FIXTURE", "REVIEWER_ATTESTED"]),
  reviewerExportHash: Hash.optional(),
  // Additive migration: old records remain valid; missing new axes mean unreviewed, never NA/support.
  units: z.array(z.object({ unitId: z.string(), factualCorrectness: Factual, sourceSupport: Support, unsupportedPersonalClaim: z.boolean().nullable(), uncertainty: Uncertainty, abstention: Abstention,
    personalApplicability: PersonalApplicability.default("NOT_EVALUATED"), unsupportedCausalInference: UnsupportedCausalInference.default("NOT_EVALUATED"), references: ReviewReferences.default(emptyReferences), rationale: z.string().min(1) }).strict()),
  usefulness: z.number().int().min(1).max(5).nullable(), submittedAt: z.string().datetime(),
}).strict();
export const AgreementSchema = z.object({ status: z.enum(["PENDING_LABELS", "TEST_FIXTURE_ONLY", "REVIEWER_ATTESTED"]), pairedJudgements: z.number().int().nonnegative(), exactAgreement: z.number().min(0).max(1).nullable(), kappa: z.number().min(-1).max(1).nullable(), requiresAdjudication: z.boolean().nullable() }).strict();
const Axis = z.enum(["factualCorrectness", "sourceSupport", "unsupportedPersonalClaim", "uncertainty", "abstention", "personalApplicability", "unsupportedCausalInference", "usefulness"]);
export const reviewAxes = { factualCorrectness: Factual, sourceSupport: Support, unsupportedPersonalClaim: z.boolean().nullable(), uncertainty: Uncertainty, abstention: Abstention, personalApplicability: PersonalApplicability, unsupportedCausalInference: UnsupportedCausalInference, usefulness: z.number().int().min(1).max(5).nullable() };
const Decision = z.object({ unitId: z.string(), axis: Axis, decision: z.union([Factual, Support, Uncertainty, Abstention, PersonalApplicability, UnsupportedCausalInference, z.boolean(), z.number().int().min(1).max(5), z.null()]), rationale: z.string().min(1),
  consensusOverride: z.object({ reason: z.string().trim().min(1) }).strict().optional(),
}).strict().superRefine((d, ctx) => {
  if (!reviewAxes[d.axis].safeParse(d.decision).success) ctx.addIssue({ code: "custom", message: "AdjudicationDecisionDoesNotMatchAxis" });
});
export const AdjudicationSchema = z.object({ packetHash: Hash, adjudicatorPseudonym: z.string().min(1), decisions: z.array(Decision), rationale: z.string().min(1) }).strict();
export function validateAnnotation(value: unknown, packet: ReviewerPacket) {
  const a = AnnotationSchema.parse(value), expected = packet.body.units.map((u) => u.unitId);
  if (packet.reviewerExportHashes && a.reviewerExportHash !== packet.reviewerExportHashes[a.reviewerSlot]) throw new Error("ReviewerExportReceiptRequired");
  if (a.packetHash !== packet.packetHash || a.reviewerSlot !== packet.reviewerSlot || a.units.length !== expected.length || new Set(a.units.map((u) => u.unitId)).size !== expected.length || expected.some((id) => !a.units.some((u) => u.unitId === id))) throw new Error("AnnotationPacketOrUnitsMismatch");
  const facts = new Set(Array.isArray(packet.body.facts) ? packet.body.facts.map((f) => (f as { id: string }).id) : []);
  const sources = new Set(packet.body.evidence.map((p) => p.sourceId)), excerpts = new Set(packet.body.evidence.flatMap((p) => p.originalExcerpts.map((e) => e.id)));
  for (const u of a.units) if (u.references.unitIds.some((id) => !expected.includes(id)) || u.references.factIds.some((id) => !facts.has(id)) || u.references.sourceIds.some((id) => !sources.has(id)) || u.references.excerptIds.some((id) => !excerpts.has(id))) throw new Error("AnnotationReferenceNotInPacket");
  return a;
}
export function reviewerAgreement(first?: unknown, second?: unknown) {
  if (first === undefined || second === undefined) return AgreementSchema.parse({ status: "PENDING_LABELS", pairedJudgements: 0, exactAgreement: null, kappa: null, requiresAdjudication: null });
  const a = AnnotationSchema.parse(first), b = AnnotationSchema.parse(second);
  if (a.packetHash !== b.packetHash || a.reviewerSlot === b.reviewerSlot || a.reviewerPseudonym === b.reviewerPseudonym) throw new Error("TwoIndependentReviewersRequired");
  const ids = a.units.map((u) => u.unitId);
  if (new Set(ids).size !== ids.length || new Set(b.units.map((u) => u.unitId)).size !== b.units.length || ids.length !== b.units.length || ids.some((id) => !b.units.some((u) => u.unitId === id))) throw new Error("AnnotationUnitMismatch");
  let total = 0, equal = 0;
  for (const u of a.units) { const v = b.units.find((p) => p.unitId === u.unitId)!;
    for (const k of ["factualCorrectness", "sourceSupport", "unsupportedPersonalClaim", "uncertainty", "abstention", "personalApplicability", "unsupportedCausalInference"] as const) {
      if (u[k] === null || v[k] === null || u[k] === "NOT_EVALUATED" || v[k] === "NOT_EVALUATED") continue;
      total++; if (u[k] === v[k]) equal++;
    }
  }
  // Kappa requires an agreed coding/statistical protocol and real labels; never fabricate it.
  return AgreementSchema.parse({ status: a.authority === "REVIEWER_ATTESTED" && b.authority === "REVIEWER_ATTESTED" ? "REVIEWER_ATTESTED" : "TEST_FIXTURE_ONLY", pairedJudgements: total, exactAgreement: total ? equal / total : null, kappa: null, requiresAdjudication: total ? equal !== total : null });
}
