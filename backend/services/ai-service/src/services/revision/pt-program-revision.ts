/**
 * Phase 3 Batch 4 (docs/ai-product/phase3-batch4-conversational-revision.md) — conversational
 * revision of the latest PT/PROGRAM recommendation in this session: candidate exclusion
 * ("Không thích người thứ hai") and constraint refinement for turns that do NOT contain the "pt"/
 * "chương trình" keyword the legacy intent parser requires to even reach the recommend flow.
 *
 * Calls the SAME, unmodified retrieval -> scorePT/scoreTrainingProgramV2 -> narrate -> persist
 * pipeline (`buildAndPersistRecommendation`, injected — see PtProgramRevisionDeps below for why it's
 * injected rather than imported: fitness-agent.service.ts is this module's own caller, so a direct
 * import back would be circular, exactly the design constraint Batch 3's executor.ts already
 * documented and solved the same way).
 *
 * Deliberately does NOT go through target-resolution.ts's generic pending-draft-first ladder: that
 * tier is for genuinely domain-ambiguous turns, but a PT/PROGRAM revision signal (ordinal + exclude
 * cue, or a recognized constraint phrase) is already domain-specific by construction — an unrelated
 * pending WORKOUT/NUTRITION draft in the same session must never block a PT/PROGRAM revision (and a
 * cross-domain regression test now exercises exactly this).
 */
import { prisma } from "../../repositories/conversation.repository";
import { logger, type AgentPreferences } from "@gym-coach/shared";
import type { AgentIdentity } from "../fitness-agent-tools";
import type { AgentBlock } from "../fitness-agent.service";
import { resolveOrdinalReference, detectExcludeCue } from "./reference-resolution";
import { parseConstraintPhrase, normalizeAgentText } from "../fitness-agent-intent";
import type { RecommendationDiff } from "./diff";

// Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 4): parseConstraintPhrase's
// own `days` extraction only recognizes EXPLICIT weekday mentions ("T2, T4, T6"), never a bare
// session-COUNT ("4 buổi thôi") — so a program-recommendation day-count refine silently did nothing.
// Scoped to require the literal unit word "buổi" (unlike agent-workflow/slot-values.ts's own looser
// parseSessionsPerWeek, which matches a bare digit with no unit at all and would misread "2" out of
// "dưới 2 triệu thôi" as a session count) — safe to reuse standalone on arbitrary free text.
const DAY_COUNT_RE = /\b([1-7])\s*buoi\b/;

export interface PtProgramRevisionDeps {
  getUserFitnessContext: (identity: AgentIdentity) => Promise<{ profile: any; coach: any }>;
  build: (
    identity: AgentIdentity, sessionId: string, kind: "PT" | "PROGRAM",
    preferences: AgentPreferences, context: { profile: any; coach: any }, excludeIds?: string[],
  ) => Promise<{ answer: string; blocks: AgentBlock[] }>;
}

function logRevision(identity: AgentIdentity, fields: Record<string, unknown>) {
  logger.info({ userId: identity.userId, ...fields }, "coach_revision");
}

/** Returns null whenever this turn isn't a PT/PROGRAM recommendation revision at all — the caller's
 * existing dispatch chain (generic chat / the legacy PT-kind re-search) remains the fallback. */
export async function tryReviseRecommendation(
  question: string, identity: AgentIdentity, sessionId: string, deps: PtProgramRevisionDeps,
): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
  const ordinal = resolveOrdinalReference(question);
  const exclude = detectExcludeCue(question);
  const constraintChanges = parseConstraintPhrase(question);
  const dayCountMatch = constraintChanges.days ? null : normalizeAgentText(question).match(DAY_COUNT_RE);
  const hasConstraintChange = Object.keys(constraintChanges).length > 0 || !!dayCountMatch;

  // Neither an exclusion reference nor a recognized constraint phrase — not a revision turn at all
  // (e.g. a plain unrelated question). Let the existing dispatch chain continue.
  if (!((exclude && ordinal) || hasConstraintChange)) return null;

  const recommendation = await prisma.fitnessRecommendation.findFirst({
    where: { userId: identity.userId, sessionId, type: { in: ["PT", "PROGRAM"] } }, orderBy: { createdAt: "desc" },
  });
  if (!recommendation) return null;
  const kind = recommendation.type as "PT" | "PROGRAM";
  const candidateIds = recommendation.candidateIds;

  let excludeTargetId: string | undefined;
  if (exclude) {
    if (!ordinal || ordinal > candidateIds.length) {
      logRevision(identity, { targetType: kind, revisionKinds: ["EXCLUDE"], resolvedReference: false, requiresClarification: true, createdProposal: false, supersededProposal: false, llmCalls: 0 });
      return {
        answer: `Mình chưa xác định được bạn muốn loại ${kind === "PT" ? "PT" : "chương trình"} nào — bạn nói rõ số thứ tự (ví dụ "${kind === "PT" ? "PT" : "chương trình"} thứ 2") giúp mình nhé.`,
        blocks: [],
      };
    }
    excludeTargetId = candidateIds[ordinal - 1];
  }

  const previousExcludeIds: string[] = (recommendation.contextSnapshot as any)?.excludeIds ?? [];
  const excludeIds = excludeTargetId ? [...new Set([...previousExcludeIds, excludeTargetId])] : previousExcludeIds;

  const previousPreferences = (recommendation.contextSnapshot as any)?.preferences ?? {};
  const context = await deps.getUserFitnessContext(identity);
  let derivedDays: number[] | undefined;
  if (dayCountMatch) {
    const n = Number(dayCountMatch[1]);
    const prevDays: number[] = previousPreferences.days ?? [];
    derivedDays = prevDays.length >= n ? prevDays.slice(0, n) : [...prevDays, ...[1, 2, 3, 4, 5, 6, 7].filter((d) => !prevDays.includes(d))].slice(0, n);
  }
  const preferences = { ...previousPreferences, ...constraintChanges, ...(derivedDays ? { days: derivedDays } : {}) } as AgentPreferences;
  if (!preferences.goal || !preferences.days?.length) return null; // never guess — fall back

  const result = await deps.build(identity, sessionId, kind, preferences, context, excludeIds);

  const effectiveConstraintChanges = derivedDays ? { ...constraintChanges, days: derivedDays } : constraintChanges;
  const diff: RecommendationDiff = {
    excludedCandidateIds: excludeTargetId ? [excludeTargetId] : [],
    constraintChanges: effectiveConstraintChanges,
    previousCandidateIds: candidateIds,
    newCandidateIds: (result.blocks[0]?.candidates as Array<{ id: string }> | undefined)?.map((c) => c.id) ?? [],
  };
  logRevision(identity, {
    targetType: kind,
    revisionKinds: [...(excludeTargetId ? ["EXCLUDE"] : []), ...Object.keys(effectiveConstraintChanges)],
    resolvedReference: !!excludeTargetId || hasConstraintChange,
    requiresClarification: false, createdProposal: true, supersededProposal: true, llmCalls: 1,
  });
  // Prose prefix is templated FROM the structured diff above, never asked of an LLM to infer
  // (brief §22/§23) — the diff is computed first and is authoritative over this sentence.
  const prefix = diff.excludedCandidateIds.length
    ? `Mình đã bỏ lựa chọn bạn không thích và tìm thêm phương án khác. `
    : `Mình đã cập nhật theo yêu cầu mới của bạn. `;
  return { ...result, answer: prefix + result.answer };
}
