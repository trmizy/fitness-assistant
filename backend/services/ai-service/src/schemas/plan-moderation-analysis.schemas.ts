import { z } from "zod";

/** AI reads the already-computed (deterministic) rule flags/stats + a
 * summarized exercise list, and produces a REPORT for the admin — never a
 * decision. moderationStatus only ever changes via an explicit admin
 * reviewAction call; this analysis is advisory context attached to that
 * decision, same principle as feedback-analysis.schemas.ts. */
export const AnalyzePlanModerationRequestSchema = z.object({
  userId: z.string().min(1), // the publisher, for LLM logging only
  planTitle: z.string(),
  planGoal: z.string(),
  computedStats: z.record(z.string(), z.unknown()),
  ruleFlags: z.array(z.string()),
  similarListings: z.array(z.object({ title: z.string(), similarityScore: z.number() })).default([]),
  /** Compact day-by-day exercise name summary — never raw catalog ids, the
   * model only needs to reason about structure (what/how much), not
   * validate real catalog membership (unlike client-plan-draft.schemas.ts,
   * this flow never writes anything the model produces). */
  daySummaries: z.array(z.string()).max(7),
});
export type AnalyzePlanModerationRequest = z.infer<typeof AnalyzePlanModerationRequestSchema>;

export const PLAN_MODERATION_RECOMMENDATION_VALUES = ["likely_safe", "needs_review", "likely_unsafe"] as const;

export const AnalyzePlanModerationOutputSchema = z.object({
  concerns: z.array(z.string()).default([]),
  confidenceScore: z.number().min(0).max(1),
  recommendation: z.enum(PLAN_MODERATION_RECOMMENDATION_VALUES),
  explanationForAdmin: z.string().min(1),
});
export type AnalyzePlanModerationOutput = z.infer<typeof AnalyzePlanModerationOutputSchema>;
