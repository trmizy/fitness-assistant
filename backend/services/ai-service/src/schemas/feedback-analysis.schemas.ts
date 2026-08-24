import { z } from "zod";

/** Phase 4 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — AI reads the
 * already-computed, deterministic CycleFeedbackSummary (cycle-feedback-
 * aggregator.ts, no AI involved in producing it) plus the cycle's existing
 * metrics/decision context, and produces a structured *interpretation* of
 * the feedback. This NEVER decides anything by itself — Phase 5 wires
 * `recommendedDecisionInfluence` into the Decision Engine only as one
 * signal among several, and the engine's own decision always wins. */
export const AnalyzeFeedbackRequestSchema = z.object({
  userId: z.string().min(1),
  cycle: z.object({
    name: z.string().nullable().optional(),
    goalType: z.string().nullable().optional(),
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"]).optional(),
    competesInSport: z.boolean().optional(),
  }),
  /** CycleFeedbackSummaryResult (cycle-feedback-aggregator.ts), passed
   * through as-is — every number in it is already rule-computed. */
  cycleFeedbackSummary: z.record(z.string(), z.unknown()),
  /** CycleMetricsResult, if a Decision Engine pass has already run for this
   * cycle — lets the model cross-check a complaint against real metrics
   * (e.g. "chê nặng" vs. actual adherence/RPE trend) instead of taking the
   * feedback at face value. */
  computedMetrics: z.record(z.string(), z.unknown()).optional(),
  currentDecision: z
    .object({
      value: z.enum(["KEEP", "PROGRESS", "ADJUST", "DELOAD", "REBUILD", "INSUFFICIENT_DATA"]).optional(),
      reasonCodes: z.array(z.string()).default([]),
    })
    .optional(),
});
export type AnalyzeFeedbackRequest = z.infer<typeof AnalyzeFeedbackRequestSchema>;

export const FEEDBACK_SENTIMENT_VALUES = ["positive", "negative", "neutral", "mixed", "insufficient_feedback"] as const;
export const COMPLAINT_VALIDITY_VALUES = ["supported_by_data", "partially_supported", "not_supported", "insufficient_data"] as const;
export const COMPLAINT_CATEGORY_VALUES = [
  "too_hard",
  "too_easy",
  "pain_or_injury_risk",
  "equipment_mismatch",
  "boredom_or_motivation",
  "schedule_conflict",
  "exercise_selection",
  "plan_clarity",
  "progress_dissatisfaction",
  "other",
] as const;
export const DECISION_INFLUENCE_VALUES = ["none", "minor_adjust", "adjust", "deload", "rebuild_consideration"] as const;

/** LLM output — validated with Zod, deterministic-template fallback on
 * failure (see feedback-analysis.service.ts). Belt-and-braces overrides in
 * the service layer enforce the non-negotiable product/safety rules that a
 * prompt instruction alone can't guarantee (see that file's doc comments). */
export const AnalyzeFeedbackOutputSchema = z.object({
  // .min(1): an empty string is valid JSON and would otherwise pass a bare
  // z.string() check, but a blank explanation is never actually useful to
  // show a user/coach — treat it as a validation failure so the retry/
  // deterministic-fallback path (feedback-analysis.service.ts) kicks in
  // instead of silently shipping nothing.
  feedbackInterpretation: z.string().min(1),
  sentiment: z.enum(FEEDBACK_SENTIMENT_VALUES),
  complaintValidity: z.enum(COMPLAINT_VALIDITY_VALUES),
  complaintCategories: z.array(z.enum(COMPLAINT_CATEGORY_VALUES)).default([]),
  suggestedImprovementAreas: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  recommendedDecisionInfluence: z.enum(DECISION_INFLUENCE_VALUES),
  explanationForUser: z.string().min(1),
  explanationForCoach: z.string().min(1),
});
export type AnalyzeFeedbackOutput = z.infer<typeof AnalyzeFeedbackOutputSchema>;
