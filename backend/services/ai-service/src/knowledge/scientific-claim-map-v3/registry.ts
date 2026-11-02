import { digest, validateClaimMap, verifyInputBundle } from "./builder";
import { ClaimV3 } from "./schema";

/** DEV/offline seam for E2. The caller owns the current trusted pins; the packet cannot self-approve. */
export function createClaimRegistry(input: unknown, candidate: unknown, trusted: { inputBundleSha256: string; ownerDecisionsSha256: string }) {
  const bundle = verifyInputBundle(input);
  if (digest(bundle) !== trusted.inputBundleSha256) throw new Error("UntrustedInputBundlePin");
  if (bundle.files.owner.sha256 !== trusted.ownerDecisionsSha256) throw new Error("StaleOwnerDecisionsPin");
  const map = validateClaimMap(bundle, candidate);
  const eligible = map.claims.filter(c => c.approval === "OWNER_ACCEPTED" && c.admission === "ADMITTED_DEV_OFFLINE");
  return Object.freeze({
    useBoundary: map.useBoundary,
    get: (id: string): ClaimV3 | null => structuredClone(eligible.find(c => c.id === id) || null),
    listForContext: (): ClaimV3[] => structuredClone(eligible.filter(c => c.audience === "DEV_COACH_CONTEXT")),
    listForRag: (): ClaimV3[] => structuredClone(eligible.filter(c => c.kind === "SCIENTIFIC" && c.audience === "DEV_COACH_CONTEXT")),
    // Grounding consumes exact claim text, citations AND scope together, never a text-only surrogate.
    resolveForGrounding: (ids: readonly string[]): ClaimV3[] => ids.map(id => {
      const claim = eligible.find(c => c.id === id);
      if (!claim) throw new Error(`ClaimNotAdmitted:${id}`);
      return structuredClone(claim);
    }),
  });
}
