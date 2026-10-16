/**
 * Phase 3 Batch 4 — thin, pure wrappers over the EXISTING reference detector
 * (conversational-intelligence/signals.ts::detectReferences) and the EXISTING exclusion vocabulary
 * already proven in fitness-agent.service.ts::tryReviseWorkoutPlanDraft. Not a second semantic parser:
 * every regex here already exists in production code; this module only centralizes it for the new
 * revision call sites so both the legacy branch and this batch's new code share one definition.
 *
 * Zero I/O, zero imports from prisma/axios/llm — pure text -> structured signal.
 */
import { detectReferences } from "../../conversational-intelligence/signals";
import { normalizeAgentText } from "../fitness-agent-intent";

/** ORDINAL_ITEM (N>=2) takes priority; FIRST_ITEM ("đầu tiên"/"thứ nhất") resolves to 1. Returns null
 * when no ordinal reference is present at all — callers must never guess a position. */
export function resolveOrdinalReference(text: string): number | null {
  const refs = detectReferences(normalizeAgentText(text));
  const ordinal = refs.find((r) => r.kind === "ORDINAL_ITEM");
  if (ordinal?.ordinal) return ordinal.ordinal;
  if (refs.some((r) => r.kind === "FIRST_ITEM")) return 1;
  return null;
}

// Same vocabulary already proven in tryReviseWorkoutPlanDraft's own exclusion check
// (fitness-agent.service.ts) — centralized here, not duplicated with different wording.
const EXCLUDE_CUE_RE = /\b(khong (?:co|muon|dung|the|thich|can)|tranh|kieng|loai bo|bo)\b/;

export function detectExcludeCue(text: string): boolean {
  return EXCLUDE_CUE_RE.test(normalizeAgentText(text));
}
