/**
 * Phase 3 Batch 4 — bounded target-resolution priority ladder (brief §9):
 *   1. a PENDING workout/nutrition draft action for this session;
 *   2. the latest PT/PROGRAM fitnessRecommendation for this session;
 *   3. UNKNOWN.
 * Always scoped by the caller's own identity.userId — never resolves another user's draft/
 * recommendation (brief §28/cross-user isolation).
 *
 * "Active workflow draft" (brief's tier 2) is deliberately not a separate tier here: an
 * AgentWorkflowSession mid-slot-filling turn is already intercepted earlier in tryTurnUnguarded
 * (runWorkflowTurn), before this module ever runs — so by the time target resolution executes, no
 * mid-slot-filling workflow can be the right answer.
 */
import { prisma } from "../../repositories/conversation.repository";
import type { AgentIdentity } from "../fitness-agent-tools";
import type { RevisionTarget } from "./types";

export async function resolveRevisionTarget(identity: AgentIdentity, sessionId: string): Promise<RevisionTarget> {
  const draft = await prisma.fitnessAgentAction.findFirst({
    where: {
      userId: identity.userId, sessionId,
      kind: { in: ["CREATE_WORKOUT_PLAN", "CREATE_NUTRITION_PLAN"] },
      status: "PENDING", expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (draft) {
    return { class: draft.kind === "CREATE_WORKOUT_PLAN" ? "WORKOUT_DRAFT" : "NUTRITION_DRAFT", actionId: draft.id };
  }
  const recommendation = await prisma.fitnessRecommendation.findFirst({
    where: { userId: identity.userId, sessionId, type: { in: ["PT", "PROGRAM"] } },
    orderBy: { createdAt: "desc" },
  });
  if (recommendation) {
    return {
      class: recommendation.type === "PT" ? "PT_RECOMMENDATION" : "PROGRAM_RECOMMENDATION",
      recommendationId: recommendation.id, candidateIds: recommendation.candidateIds,
    };
  }
  return { class: "UNKNOWN" };
}
