import { z } from "zod";

/** Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — AI reads the
 * already-computed (deterministic, rule-based) PlanQualityScoreResult +
 * raw review free-text, and produces improvement SUGGESTIONS for the
 * publisher. Advisory only — the AI never edits or publishes anything; a
 * publisher who wants to act still has to manually create a new
 * PublishedPlan version via POST /marketplace/plans/:id/republish. */
export const GeneratePlanImprovementRequestSchema = z.object({
  userId: z.string().min(1), // the publisher
  planTitle: z.string(),
  planGoal: z.string(),
  /** PlanQualityScoreResult, opaque passthrough (same convention as
   * feedback-analysis.schemas.ts's cycleFeedbackSummary). */
  qualityScoreResult: z.record(z.string(), z.unknown()),
  /** A bounded sample of review free-text (never the full history — keeps
   * the prompt small and avoids leaking reviewer-identifying detail beyond
   * what's already public on the listing). */
  reviewFreeTextSample: z.array(z.string().max(2000)).max(30).default([]),
});
export type GeneratePlanImprovementRequest = z.infer<typeof GeneratePlanImprovementRequestSchema>;

export const GeneratePlanImprovementOutputSchema = z.object({
  suggestions: z.array(z.string()).min(1),
  summary: z.string().min(1),
});
export type GeneratePlanImprovementOutput = z.infer<typeof GeneratePlanImprovementOutputSchema>;
