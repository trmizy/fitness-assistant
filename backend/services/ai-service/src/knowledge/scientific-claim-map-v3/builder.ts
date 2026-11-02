import { createHash } from "node:crypto";
import { z } from "zod";
import { bundleSchema, claimSchema, mapSchema, ClaimV3, ClaimMapV3, InputBundle } from "./schema";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown): string => sha256(canonical(value));

const reviewSchema = z.object({
  sources: z.array(z.object({ id: z.string(), population: z.string(), limits: z.array(z.string()) }).passthrough()),
  claims: z.array(z.object({ id: z.string(), sourceId: z.string(), kind: z.string(), textVi: z.string(), conditions: z.array(z.string()), cannotInfer: z.array(z.string()), certainty: z.record(z.unknown()), claude: z.record(z.unknown()) }).passthrough()),
}).passthrough();
const ownerSchema = z.object({ revision: z.number(), updatedAt: z.string(), decisions: z.record(z.object({ itemId: z.string(), type: z.string(), decision: z.string(), status: z.string(), acceptedRevisionVi: z.string().nullable().optional(), sourceRef: z.object({ files: z.record(z.string()).optional() }).passthrough().optional() }).passthrough()) }).passthrough();
const bindingSchema = z.object({ claims: z.record(z.object({
  excerpts: z.array(z.object({ sourceId: z.string(), quote: z.string().min(1), locator: z.string(), role: z.string() }).strict()),
  additionalApplicability: z.array(z.string()), additionalLimitations: z.array(z.string()),
  additionalUnsupportedInferences: z.array(z.string()), unresolvedEvidence: z.array(z.string()),
}).strict()) }).passthrough();
const sourceSchema = z.object({ records: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), bodyText: z.string(), bodySha256: z.string(), rawPayloadSha256: z.string(), readScope: z.string() }).passthrough()) }).passthrough();

function normalizedWithOffsets(text: string): { text: string; start: number[]; end: number[] } {
  let result = "", position = 0;
  const start: number[] = [], end: number[] = [];
  // Captures are NFC. Do not remove words/numbers or use fuzzy semantic matching.
  for (const char of text) {
    const from = position; position += char.length;
    const clean = char.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s/g, " ").toLowerCase();
    if (clean === " " && (!result || result.endsWith(" "))) { if (result) end[end.length - 1] = position; continue; }
    result += clean;
    for (let i = 0; i < clean.length; i++) { start.push(from); end.push(position); }
  }
  return { text: result.trimEnd(), start, end };
}
export function matchQuote(body: string, quote: string): { capturedQuote: string | null; textMatch: "EXACT" | "NORMALIZED_TYPOGRAPHY_WHITESPACE_CASE" | "NOT_FOUND" } {
  if (body.includes(quote)) return { capturedQuote: quote, textMatch: "EXACT" };
  const haystack = normalizedWithOffsets(body), needle = normalizedWithOffsets(quote).text;
  const index = needle ? haystack.text.indexOf(needle) : -1;
  return index < 0 ? { capturedQuote: null, textMatch: "NOT_FOUND" } : {
    capturedQuote: body.slice(haystack.start[index], haystack.end[index + needle.length - 1]), textMatch: "NORMALIZED_TYPOGRAPHY_WHITESPACE_CASE",
  };
}

const requiredInputs = ["owner", "review", "followupReport", "followups", "engineering", "calibration", "extras", "archivedAbstracts", "sources", "bindings", "codeE1rm", "codeOutcome"];
export function verifyInputBundle(input: unknown): InputBundle {
  const bundle = bundleSchema.parse(input);
  for (const id of requiredInputs) if (!bundle.files[id]) throw new Error(`MissingInput:${id}`);
  for (const [id, file] of Object.entries(bundle.files)) if (sha256(file.text) !== file.sha256) throw new Error(`SourceHashMismatch:${id}`);
  return bundle;
}

export function buildClaimMap(input: unknown): ClaimMapV3 {
  const bundle = verifyInputBundle(input), files = bundle.files;
  const read = (id: string): unknown => JSON.parse(files[id].text);
  const review = reviewSchema.parse(read("review")), owner = ownerSchema.parse(read("owner"));
  const bindings = bindingSchema.parse(read("bindings")).claims;
  const sources = sourceSchema.parse(read("sources")).records;
  const sourceById = new Map(sources.map(source => [source.id, { ...source, kind: "PRIMARY_SCIENTIFIC" as const, sourceSha256: source.bodySha256 }]));
  if (sourceById.size !== sources.length) throw new Error("DuplicateSourceId");
  for (const source of sources) if (sha256(source.bodyText) !== source.bodySha256) throw new Error(`SourceHashMismatch:${source.id}`);
  const codeSources = new Map([
    ["CODE_E1RM", { key: "codeE1rm", title: "Gymini estimate1RM product definition" }],
    ["CODE_OUTCOME", { key: "codeOutcome", title: "Gymini outcome-support product policy" }],
  ]);
  const followup = z.object({ items: z.record(z.record(z.unknown())) }).passthrough().parse(read("followups"));
  const sourceRefKeys: Record<string, string> = { reviewJson: "review", followupMd: "followupReport", calJson: "calibration", extras: "extras", p17: "priority17", engineering: "engineering" };
  // The owner's declared input references must still bind the captured review.
  for (const [id, decision] of Object.entries(owner.decisions)) {
    if (decision.itemId !== id) throw new Error(`OwnerDecisionIdentityMismatch:${id}`);
    for (const [key, hash] of Object.entries(decision.sourceRef?.files || {})) {
      const fileId = sourceRefKeys[key];
      if (!fileId) throw new Error(`UnresolvedOwnerSourceRef:${id}:${key}`);
      if (files[fileId].sha256 !== hash) throw new Error(`OwnerSourceHashMismatch:${id}:${key}`);
    }
  }
  const unique = (values: string[]): string[] => [...new Set(values)];
  function conditions(id: string, seen = new Set<string>()): string[] {
    if (seen.has(id)) throw new Error(`CircularApplicability:${id}`);
    seen.add(id);
    const c = review.claims.find(c => c.id === id);
    if (!c) throw new Error(`UnknownApplicabilityParent:${id}`);
    return c.conditions.flatMap(condition => {
      const reference = condition.match(/^Như (C\d+)$/);
      return reference ? [condition, ...conditions(reference[1], new Set(seen))] : [condition];
    });
  }
  const claims: ClaimV3[] = [];
  if (new Set(review.claims.map(c => c.id)).size !== review.claims.length) throw new Error("DuplicateClaimId");
  for (const original of review.claims) {
    const decision = owner.decisions[original.id];
    const accepted = decision?.type === "CLAIM" && decision.status === "DECIDED" && ["APPROVE", "REVISE"].includes(decision.decision);
    const selectedText = accepted ? (decision.decision === "APPROVE" ? original.textVi : decision.acceptedRevisionVi) : null;
    const parentText = selectedText?.trim() ? selectedText : null; // Check emptiness without rewriting accepted text.
    const parts = original.id === "C32" && parentText ? parentText.split("\n") : [parentText];
    if (original.id === "C32" && parentText && (parts.length !== 3 || parts.some((part, i) => !part?.startsWith(`C32${"abc"[i]} (`)))) throw new Error("InvalidOwnerC32Segments");
    let start = 0;
    for (const part of parts) {
      const id = original.id === "C32" && parts.length === 3 ? part!.slice(0, 4) : original.id;
      const binding = bindings[id];
      // Missing binding is a held record, never implicit admission.
      const reasons = [...(binding?.unresolvedEvidence || [])];
      if (!binding?.excerpts.length) reasons.push("NO_SUPPORTING_EXCERPT");
      const references: ClaimV3["evidenceReferences"] = (binding?.excerpts || []).map(excerpt => {
        const scientific = sourceById.get(excerpt.sourceId), code = codeSources.get(excerpt.sourceId);
        const source = scientific || (code ? {
          title: code.title, url: files[code.key].origin, bodyText: files[code.key].text,
          kind: "CODE_PRODUCT_DEFINITION" as const, sourceSha256: files[code.key].sha256,
          bodySha256: files[code.key].sha256, readScope: "CODE_NOT_SCIENTIFIC_EVIDENCE",
        } : null);
        if (!source) throw new Error(`UnknownSupportingSource:${id}:${excerpt.sourceId}`);
        const match = matchQuote(source.bodyText, excerpt.quote);
        if (match.textMatch === "NOT_FOUND") reasons.push(`EXCERPT_NOT_FOUND:${excerpt.sourceId}`);
        return { ...excerpt, ...match, kind: source.kind, title: source.title, url: source.url,
          readScope: source.readScope, sourceSha256: source.sourceSha256, capturedBodySha256: source.bodySha256,
          semanticSupport: "IMPLEMENTER_BINDING_NOT_INDEPENDENTLY_VALIDATED" };
      });
      const sourceMetadata = review.sources.find(s => s.id === original.sourceId);
      if (!sourceMetadata) throw new Error(`UnknownReviewSource:${original.sourceId}`);
      if (!["SYSTEM_DEFINITION", "PRODUCT_POLICY", "APPLICATION_INFERENCE"].includes(original.kind) && !references.some(r => r.kind === "PRIMARY_SCIENTIFIC")) reasons.push("NO_PRIMARY_SCIENTIFIC_EXCERPT");
      const approval: ClaimV3["approval"] = decision?.status !== "DECIDED" ? "NOT_DECIDED" : decision.decision === "REJECT" ? "REJECTED" : accepted && part ? "OWNER_ACCEPTED" : "REVISION_OR_VERIFICATION_REQUIRED";
      const admission = approval === "REJECTED" ? "REJECTED" : approval !== "OWNER_ACCEPTED" ? "PENDING_OWNER" : reasons.length ? "HELD_EVIDENCE" : "ADMITTED_DEV_OFFLINE";
      const split = parts.length === 3;
      const originalKind = original.kind;
      claims.push(claimSchema.parse({
        id, version: 3, parentDecisionId: original.id,
        kind: originalKind === "SYSTEM_DEFINITION" ? "MEASUREMENT_DEFINITION" : originalKind === "PRODUCT_POLICY" ? "PRODUCT_POLICY" : originalKind === "APPLICATION_INFERENCE" ? "APPLICATION_INFERENCE" : "SCIENTIFIC",
        audience: original.id === "C18" ? "REVIEW_CONTEXT_ONLY" : "DEV_COACH_CONTEXT",
        approval, admission, approvedTextVi: part, originalProposedTextVi: original.textVi,
        ownerDecision: decision || null, aiProposal: { originalReview: original.claude, followup: followup.items[original.id] || null },
        provenance: {
          ownerFileSha256: files.owner.sha256, ownerRecordSha256: decision ? digest(decision) : null,
          reviewFileSha256: files.review.sha256, followupFileSha256: files.followupReport.sha256,
          pointer: `/decisions/${original.id}`, parentApprovedTextVi: parentText,
          segment: split ? { start, end: start + part!.length } : null,
          declaredSourceRefs: decision?.sourceRef?.files || {}, itemHashVerification: "PRESERVED_NOT_RECOMPUTED_USING_UI_CONTRACT",
        },
        evidenceReferences: references,
        population: split ? binding!.additionalApplicability : unique([sourceMetadata.population, ...(binding?.additionalApplicability || [])]),
        applicability: unique([...(split ? [] : conditions(original.id)), ...(binding?.additionalApplicability || [])]),
        evidenceLimitations: unique([...(split ? [] : [...sourceMetadata.limits, ...Object.values(original.certainty).filter((v): v is string => typeof v === "string").slice(1)]), ...(binding?.additionalLimitations || []), "Owner approval and substring matches are not independent scientific validation; full scientific entailment has not been automatically established."]),
        unsupportedInferences: unique([...original.cannotInfer, ...(binding?.additionalUnsupportedInferences || [])]),
        certainty: split ? { current: "NOT_INDEPENDENTLY_GRADED", originalSupersededReview: original.certainty } : original.certainty,
        scopeProvenance: { originalConditions: original.conditions, originalCannotInfer: original.cannotInfer, supersededScope: split },
        sourceHashes: Object.fromEntries(references.map(ref => [ref.sourceId, ref.sourceSha256])), admissionReasons: reasons,
      }));
      start += (part?.length || 0) + 1;
    }
  }
  const engineering = z.object({ items: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()) }).passthrough().parse(read("engineering"));
  return mapSchema.parse({
    contract: "scientific-claim-map-v3", version: 3,
    authority: "OWNER_DEVELOPER_ACCEPTED_ASSISTANT_SOURCE_MATCHED_NOT_INDEPENDENT_SCIENTIFIC_VALIDATION",
    useBoundary: "DEV_OFFLINE_ONLY_NO_PRODUCTION_ADMISSION", independentScientificValidation: false,
    baselineHead: bundle.baselineHead, inputBundleSha256: digest(bundle), ownerRevision: owner.revision, ownerUpdatedAt: owner.updatedAt,
    inputHashes: Object.fromEntries(Object.entries(files).map(([key, f]) => [key, f.sha256])), claims,
    articleDecisions: Object.values(owner.decisions).filter(d => d.type === "ARTICLE").map(d => ({ ...d, claimApprovalConferred: false, productionIndexStatus: "NOT_VERIFIED_E1" })),
    calibrationDecisions: Object.values(owner.decisions).filter(d => d.type === "CALIBRATION").map(d => ({ ...d, useAsIndependentGold: false, inferredAssessment: null })),
    pendingEngineering: engineering.items.filter(d => !owner.decisions[d.id]).map(d => ({ id: d.id, title: d.title })),
    counts: { total: claims.length, admitted: claims.filter(c => c.admission === "ADMITTED_DEV_OFFLINE").length, heldEvidence: claims.filter(c => c.admission === "HELD_EVIDENCE").length, pendingOwner: claims.filter(c => c.admission === "PENDING_OWNER").length, rejected: claims.filter(c => c.admission === "REJECTED").length },
  });
}

export function validateClaimMap(input: unknown, candidate: unknown): ClaimMapV3 {
  const actual = mapSchema.parse(candidate), expected = buildClaimMap(input);
  for (const id of new Set([...Object.keys(actual.inputHashes), ...Object.keys(expected.inputHashes)])) {
    if (actual.inputHashes[id] !== expected.inputHashes[id]) throw new Error(`SourceHashMismatch:input:${id}`);
  }
  for (const claim of actual.claims) {
    const original = expected.claims.find(c => c.id === claim.id);
    if (!original) continue; // The complete structural comparison below rejects unknown claim identities.
    for (const id of new Set([...Object.keys(claim.sourceHashes), ...Object.keys(original.sourceHashes)])) {
      if (claim.sourceHashes[id] !== original.sourceHashes[id]) throw new Error(`SourceHashMismatch:${claim.id}:${id}`);
    }
    for (const ref of claim.evidenceReferences) {
      const originalRef = original.evidenceReferences.find(r => r.sourceId === ref.sourceId);
      if (originalRef && (originalRef.sourceSha256 !== ref.sourceSha256 || originalRef.capturedBodySha256 !== ref.capturedBodySha256)) throw new Error(`SourceHashMismatch:${claim.id}:${ref.sourceId}`);
    }
  }
  if (canonical(actual) !== canonical(expected)) throw new Error("ClaimMapMismatch:owner text, decisions, scope, citations or provenance differ from pinned inputs");
  return actual;
}
