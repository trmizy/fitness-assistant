import { z } from "zod";

/** Request body from fitness-service's POST /training-cycles/:id/complete fire-and-forget call. */
export const AnalyzeCycleRequestSchema = z.object({
  userId: z.string().min(1),
  cycle: z.object({
    cycleIndex: z.number().int(),
    goal: z.string().nullable().optional(),
    startDate: z.union([z.string(), z.date()]),
    endDate: z.union([z.string(), z.date()]),
    durationDays: z.number().int(),
    lowConfidence: z.boolean().optional(),
  }),
  progressSignals: z.object({
    overallTrend: z.enum(["PROGRESSING", "PLATEAU", "DECLINING"]),
    deltaSMM: z.number().nullable().optional(),
    deltaPBF: z.number().nullable().optional(),
    volumeChangePct: z.number().nullable().optional(),
    newPRs: z.array(z.string()).optional(),
    adherencePct: z.number().optional(),
    rpeTrend: z.string().optional(),
    laggingMuscleGroups: z.array(z.string()).optional(),
  }),
  inbody: z.object({
    series: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    start: z.record(z.string(), z.unknown()).nullable().optional(),
    end: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  currentPlan: z.record(z.string(), z.unknown()).optional(),
  priorCycles: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type AnalyzeCycleRequest = z.infer<typeof AnalyzeCycleRequestSchema>;

/** LLM output — only the branch matching `decision` needs to be non-null; the rest may be null. */
export const AnalyzeCycleOutputSchema = z.object({
  decision: z.enum(["KEEP", "ADJUST", "NEW_PLAN"]),
  cycleReview: z.object({
    bodyCompositionTrend: z.string(),
    trainingNote: z.string(),
    laggingMuscleGroups: z.array(z.string()).default([]),
    confidence: z.enum(["high", "low"]),
  }),
  keepDetails: z
    .object({
      overloadIncreasePct: z.number(),
      calorieDelta: z.number(),
      notes: z.string(),
    })
    .nullable()
    .default(null),
  adjustDetails: z
    .object({
      pumpSetTargets: z.array(z.string()).default([]),
      maxPumpSessionsPerWeek: z.number(),
      exerciseSwaps: z.array(z.unknown()).default([]),
      calorieDeltaPct: z.number(),
      notes: z.string(),
    })
    .nullable()
    .default(null),
  newPlanDraft: z
    .object({
      goal: z.string(),
      durationDays: z.number(),
      daysPerWeek: z.number(),
      splitSuggestion: z.string(),
      deloadWeekFirst: z.boolean(),
      notes: z.string(),
    })
    .nullable()
    .default(null),
  mealPlanDraft: z
    .object({
      estimatedTDEE: z.number(),
      calorieTarget: z.number(),
      macros: z.object({
        proteinG: z.number(),
        carbG: z.number(),
        fatG: z.number(),
      }),
      notes: z.string(),
    })
    .nullable()
    .default(null),
});
export type AnalyzeCycleOutput = z.infer<typeof AnalyzeCycleOutputSchema>;
