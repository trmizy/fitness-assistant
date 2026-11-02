import { z } from "zod";
import { digest, validateClaimMap } from "./builder";
import { claimPresentation } from "./presentation";
import { sha256Schema } from "./schema";

const releasedClaim = z.object({ id: z.string(), version: z.literal(3), approvedTextVi: z.string(),
  displayTextVi: z.string(), canonicalTextSha256: sha256Schema,
  representation: z.object({ operation: z.enum(["IDENTITY", "REMOVE_INTERNAL_PREFIX"]), prefix: z.string(), start: z.number().int(), end: z.number().int() }).strict(),
  evidenceReferences: z.array(z.object({ sourceId: z.string(), title: z.string(), url: z.string(), capturedQuote: z.string(), locator: z.string(),
    sourceSha256: sha256Schema, kind: z.enum(["PRIMARY_SCIENTIFIC", "CODE_PRODUCT_DEFINITION"]) }).strict()).min(1),
  kind: z.string(), audience: z.string(), population: z.array(z.string()), applicability: z.array(z.string()),
  evidenceLimitations: z.array(z.string()), unsupportedInferences: z.array(z.string()),
}).strict();
export const CuratedClaimReleaseDraftSchema = z.object({ contract: z.literal("curated-claim-map-release-draft-v1"),
  status: z.literal("DRAFT_PENDING_OWNER_RELEASE_APPROVAL"), version: z.literal(3), claims: z.array(releasedClaim),
  omittedClaims: z.array(z.object({ id: z.string(), reason: z.literal("INTERNAL_NOTE_REQUIRES_CONTENT_CURATION") }).strict()), contentHash: sha256Schema,
}).strict().superRefine((draft, ctx) => {
  if (digest({ claims: draft.claims, omittedClaims: draft.omittedClaims }) !== draft.contentHash) ctx.addIssue({ code: "custom", message: "ReleaseDraftHashMismatch" });
  for (const c of draft.claims) if (JSON.stringify(claimPresentation(c)) !== JSON.stringify({ displayTextVi: c.displayTextVi, canonicalTextSha256: c.canonicalTextSha256, representation: c.representation })) ctx.addIssue({ code: "custom", message: "ReleaseDisplayMappingMismatch" });
});

/** Explicit allowlist export. Does not approve, publish, or make the draft loadable as a trusted registry. */
export function prepareCuratedReleaseDraft(input: unknown, mapValue: unknown) {
  const map = validateClaimMap(input, mapValue);
  const omittedClaims: { id: string; reason: "INTERNAL_NOTE_REQUIRES_CONTENT_CURATION" }[] = [];
  const claims = map.claims.filter(c => c.approval === "OWNER_ACCEPTED" && c.admission === "ADMITTED_DEV_OFFLINE").flatMap(c => {
    const exported = {
    id: c.id, version: c.version, approvedTextVi: c.approvedTextVi!, ...claimPresentation(c), kind: c.kind, audience: c.audience,
    evidenceReferences: c.evidenceReferences.map(e => ({ sourceId: e.sourceId, title: e.title,
      url: e.kind === "CODE_PRODUCT_DEFINITION" ? (e.sourceId === "CODE_E1RM" ? "backend/services/fitness-service/src/utils/estimated-1rm.util.ts" : "backend/services/ai-service/src/evaluation/advisory-progress/outcome-support.ts") : e.url,
      capturedQuote: e.capturedQuote!, locator: e.kind === "CODE_PRODUCT_DEFINITION" ? "Repository code excerpt" : e.locator, sourceSha256: e.sourceSha256, kind: e.kind })),
    population: c.population, applicability: c.applicability, evidenceLimitations: c.evidenceLimitations, unsupportedInferences: c.unsupportedInferences,
    };
    // Do not silently publish an exact internal owner note embedded in an otherwise allowed scope field.
    const note = c.ownerDecision?.note;
    if (typeof note === "string" && note.trim() && JSON.stringify(exported).includes(note)) {
      omittedClaims.push({ id: c.id, reason: "INTERNAL_NOTE_REQUIRES_CONTENT_CURATION" }); return [];
    }
    return [exported];
  });
  return CuratedClaimReleaseDraftSchema.parse({ contract: "curated-claim-map-release-draft-v1", status: "DRAFT_PENDING_OWNER_RELEASE_APPROVAL", version: 3, claims, omittedClaims, contentHash: digest({ claims, omittedClaims }) });
}
