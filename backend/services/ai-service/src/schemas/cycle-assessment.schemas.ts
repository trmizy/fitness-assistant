import { z } from "zod";

/** Structured, already-computed input from fitness-service's Decision
 * Engine (POST /training-cycles/:id/evaluate). The LLM only ever sees this
 * summarized shape — never raw workout-set history — per spec §6. */
export const AssessCycleRequestSchema = z.object({
  userId: z.string().min(1),
  cycle: z.object({
    name: z.string().nullable().optional(),
    goalType: z.string().nullable().optional(),
    cycleIndex: z.number().int(),
    durationDays: z.number().int(),
    startDate: z.union([z.string(), z.date()]),
    endDate: z.union([z.string(), z.date()]),
    /** UserProfile.experienceLevel — drives whether the explanation may
     * mention advanced techniques (FST-7/Mountain Dog style finishers,
     * mechanical drop-sets etc.) at all. Absent/UNKNOWN is treated exactly
     * like BEGINNER (see docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0). */
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"]).optional(),
    /** UserProfile.competesInSport — ADVANCED + this flag reads as a
     * professional/competing athlete, not a 5th experienceLevel value. */
    competesInSport: z.boolean().optional(),
  }),
  dataQuality: z.object({
    dataQualityScore: z.number(),
    dataCompletenessScore: z.number(),
    qualityFlags: z.array(z.string()).default([]),
  }),
  computedMetrics: z.record(z.string(), z.unknown()), // CycleMetricsResult, passed through as-is
  decision: z.object({
    value: z.enum(["KEEP", "PROGRESS", "ADJUST", "DELOAD", "REBUILD", "INSUFFICIENT_DATA"]),
    confidenceScore: z.number(),
    recommendedActionScope: z.enum(["none", "minor_adjustment", "deload", "full_rebuild"]),
  }),
  reasonCodes: z.array(z.string()).default([]),
  safetyFlags: z
    .array(z.object({ code: z.string(), severity: z.enum(["warning", "critical"]), message: z.string() }))
    .default([]),
  currentPlanSummary: z.record(z.string(), z.unknown()).optional(),
  /** Change types the LLM is allowed to propose — fitness-service derives
   * this from recommendedActionScope (e.g. "none" -> [], "deload" -> only
   * DELOAD/VOLUME/LOAD-down). Constrains proposedChanges[].type below. */
  allowedChanges: z.array(z.enum(["VOLUME", "LOAD", "REPS", "EXERCISE", "FREQUENCY", "DELOAD"])).default([]),
});
export type AssessCycleRequest = z.infer<typeof AssessCycleRequestSchema>;

// currentValue/proposedValue are semantically strings (e.g. "8-10 reps",
// "60kg") but a numeric-only value (e.g. plain "8") is very naturally
// generated as a bare JSON number by the model — coerce rather than reject.
const stringOrNumber = z.union([z.string(), z.number()]).transform((v) => String(v));

export const ProposedChangeSchema = z.object({
  type: z.enum(["VOLUME", "LOAD", "REPS", "EXERCISE", "FREQUENCY", "DELOAD"]),
  target: z.string(),
  currentValue: stringOrNumber,
  proposedValue: stringOrNumber,
  reason: z.string(),
});

/** LLM output — validated with Zod, deterministic-template fallback on
 * failure (see cycle-assessment.service.ts). `decision` here is REQUIRED to
 * echo the Decision Engine's value; the service layer overwrites it with
 * the real engine decision regardless of what the model returns, as a
 * belt-and-braces guard against the model "changing its mind" despite the
 * prompt instruction never to. */
export const AssessCycleOutputSchema = z.object({
  decision: z.enum(["KEEP", "PROGRESS", "ADJUST", "DELOAD", "REBUILD", "INSUFFICIENT_DATA"]),
  headline: z.string(),
  summary: z.string(),
  positiveSignals: z.array(z.string()).default([]),
  warningSignals: z.array(z.string()).default([]),
  proposedChanges: z.array(ProposedChangeSchema).default([]),
  missingData: z.array(z.string()).default([]),
  safetyNotice: z.string().nullable().default(null),
  requiresConfirmation: z.boolean().default(true),
});
export type AssessCycleOutput = z.infer<typeof AssessCycleOutputSchema>;
