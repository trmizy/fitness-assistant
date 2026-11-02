import { sha256 } from "./builder";

/** Reversible display projection only; never edits owner-approved canonical wording. */
export function claimPresentation(claim: { id: string; approvedTextVi: string | null }) {
  const canonicalText = claim.approvedTextVi || "";
  const colon = canonicalText.indexOf("): ");
  const offset = canonicalText.startsWith(claim.id + " (") && colon >= 0 ? colon + 3 : 0;
  return { displayTextVi: canonicalText.slice(offset), canonicalTextSha256: sha256(canonicalText),
    representation: { operation: offset ? "REMOVE_INTERNAL_PREFIX" as const : "IDENTITY" as const,
      prefix: canonicalText.slice(0, offset), start: offset, end: canonicalText.length } };
}

/** These are text identity signals, not semantic entailment judgements. */
export function textIdentity(text: string, claim: { id: string; approvedTextVi: string | null }) {
  if (text === claim.approvedTextVi) return "EXACT_CANONICAL" as const;
  if (text === claimPresentation(claim).displayTextVi) return "EXACT_DISPLAY" as const;
  return "NO_EXACT_MATCH" as const;
}
