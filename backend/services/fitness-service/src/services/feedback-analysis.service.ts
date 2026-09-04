/**
 * Phase 4 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — orchestrates the
 * deterministic CycleFeedbackSummary (cycle-feedback-aggregator.ts) into an
 * AI interpretation call (ai-service POST /ai/analyze-feedback), then
 * persists the result as an audit row. Advisory-only: nothing here decides
 * anything — Phase 5 wires `recommendedDecisionInfluence` into the Decision
 * Engine as one signal among several, and the engine's own decision (not
 * this analysis) is always final.
 */
import { prisma } from "../repositories/prisma";
import { logger } from "@gym-coach/shared";
import { fetchUserProfile } from "../clients/user.client";
import { analyzeFeedbackSafe, type AnalyzeFeedbackResult } from "../clients/ai.client";
import { cycleFeedbackAggregator } from "./cycle-feedback-aggregator";

export const feedbackAnalysisService = {
  /** Ownership-checked (via the cycle lookup below), computes/refreshes the
   * rule-based cycle feedback summary, calls the AI interpretation, and
   * persists an audit row regardless of whether the LLM call succeeded
   * (the fallback path still produces a genuinely useful, conservative
   * result — see feedback-analysis.service.ts in ai-service). */
  async analyzeCycleFeedback(cycleId: string, userId: string): Promise<AnalyzeFeedbackResult & { auditId: string }> {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };

    const summary = await cycleFeedbackAggregator.computeAndPersist(cycleId);

    const profile = await fetchUserProfile(userId);
    const experienceLevel = (profile?.experienceLevel ?? "UNKNOWN") as
      | "BEGINNER"
      | "INTERMEDIATE"
      | "ADVANCED"
      | "UNKNOWN";
    const competesInSport = profile?.competesInSport === true;

    // Latest completed assessment, if any — gives the AI real
    // computedMetrics/decision context to cross-check complaints against,
    // without forcing a fresh Decision Engine run just for this call.
    const latestAssessment = await prisma.cycleAssessment.findFirst({
      where: { cycleId, status: "COMPLETED" },
      orderBy: { assessmentVersion: "desc" },
    });

    const aiResult = await analyzeFeedbackSafe(userId, {
      userId,
      cycle: {
        name: cycle.name,
        goalType: cycle.goal,
        experienceLevel,
        competesInSport,
      },
      cycleFeedbackSummary: summary,
      computedMetrics: latestAssessment?.computedMetrics ?? undefined,
      currentDecision: latestAssessment
        ? { value: latestAssessment.decision as any, reasonCodes: (latestAssessment.reasonCodes as any) ?? [] }
        : undefined,
    });

    // ai-service unreachable/errored entirely (not "LLM returned bad JSON,
    // used its own internal fallback" — that case still returns a result
    // here with usedFallback=true). This outer null case still needs a
    // safe, conservative result rather than throwing, matching the rest of
    // this codebase's "never let an AI outage break a real user flow" rule.
    const result: AnalyzeFeedbackResult =
      aiResult ?? {
        feedbackInterpretation:
          "Không thể kết nối tới dịch vụ phân tích AI lúc này — dưới đây là số liệu đã tính trực tiếp từ phản hồi của bạn.",
        sentiment: (summary.feedbackSentimentByRules as AnalyzeFeedbackResult["sentiment"]) ?? "insufficient_feedback",
        complaintValidity: summary.feedbackSubmittedCount < 2 ? "insufficient_data" : "partially_supported",
        complaintCategories: [],
        suggestedImprovementAreas: [],
        riskFlags: [...(summary.safetyFlags as string[])],
        recommendedDecisionInfluence: "none",
        explanationForUser: "Chưa thể phân tích chi tiết lúc này. Phản hồi của bạn đã được ghi nhận.",
        explanationForCoach: "ai-service unreachable — analyze-feedback call failed entirely.",
        citations: [],
        usedFallback: true,
      };

    if (aiResult === null) {
      logger.warn({ userId, cycleId }, "[feedback-analysis] analyze-feedback call failed entirely — using local conservative fallback");
    }

    const audit = await prisma.cycleFeedbackAnalysisAudit.create({
      data: {
        userId,
        cycleId,
        cycleFeedbackSummarySnapshot: summary as any,
        feedbackInterpretation: result.feedbackInterpretation,
        sentiment: result.sentiment,
        complaintValidity: result.complaintValidity,
        complaintCategories: result.complaintCategories as any,
        suggestedImprovementAreas: result.suggestedImprovementAreas as any,
        riskFlags: result.riskFlags as any,
        recommendedDecisionInfluence: result.recommendedDecisionInfluence,
        explanationForUser: result.explanationForUser,
        explanationForCoach: result.explanationForCoach,
        aiFallback: result.usedFallback,
      },
    });

    return { ...result, auditId: audit.id };
  },

  /** Most recent analysis for a cycle, if one has ever been run — does NOT
   * trigger a new AI call (that's analyzeCycleFeedback above, explicit). */
  async getLatestFeedbackAnalysis(cycleId: string, userId: string) {
    const cycle = await prisma.trainingCycle.findFirst({ where: { id: cycleId, userId } });
    if (!cycle) throw { status: 404, message: "Training cycle not found" };
    return prisma.cycleFeedbackAnalysisAudit.findFirst({
      where: { cycleId },
      orderBy: { createdAt: "desc" },
    });
  },
};
