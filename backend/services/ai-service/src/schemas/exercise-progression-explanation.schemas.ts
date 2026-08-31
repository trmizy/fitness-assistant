import { z } from "zod";

/**
 * Exercise-progression explanation (openGym FINAL P0 CLOSURE PASS —
 * docs/TRAINING_PROGRESSION_ARCHITECTURE.md §5). Mirrors the established
 * "already-computed decision, LLM explains only" convention already proven
 * by cycle-assessment.schemas.ts/cycle-assessment.service.ts, scaled down —
 * no RAG evidence, no proposedChanges, no nutrition branch: this is a single
 * exercise's next-session target, not a whole cycle's plan. The LLM only
 * ever sees this summarized shape, never raw set-by-set history.
 */
export const ExplainExerciseProgressionRequestSchema = z.object({
  userId: z.string().min(1),
  exerciseName: z.string().min(1),
  loggingMode: z.enum(["REPS_LOAD", "BODYWEIGHT_REPS", "TIME", "TIME_LOAD", "DISTANCE_TIME"]),
  experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"]).optional(),
  status: z.enum([
    "KEEP",
    "INCREASE_LOAD",
    "INCREASE_REPS",
    "INCREASE_SETS",
    "DELOAD",
    "REVIEW",
    "INSUFFICIENT_DATA",
  ]),
  currentPerformance: z
    .object({
      weightKg: z.number().nullable(),
      reps: z.number().nullable(),
      durationSeconds: z.number().nullable(),
      distanceMeters: z.number().nullable(),
    })
    .nullable(),
  nextTarget: z
    .object({
      weightKg: z.number().nullable(),
      reps: z.number().nullable(),
      durationSeconds: z.number().nullable(),
    })
    .nullable(),
  reasonCodes: z.array(z.string()).default([]),
  cycleContext: z.string(), // CycleDecision | "NONE"
});
export type ExplainExerciseProgressionRequest = z.infer<typeof ExplainExerciseProgressionRequestSchema>;

/**
 * DELIBERATELY the only field the LLM may return. This is a structural
 * guarantee, not just a runtime check (like cycle-assessment's
 * belt-and-braces override of a stray `decision` field): the response type
 * simply has no `status`/`nextTarget`/`decision` field to overwrite in the
 * first place, so there is no code path anywhere downstream that could ever
 * read a model-proposed decision, even by a future accidental refactor.
 * Zod's default (non-.passthrough()) object parsing also drops any extra
 * keys the model hallucinates beyond this shape.
 */
export const ExplainExerciseProgressionOutputSchema = z.object({
  explanation: z.string().min(1).max(600),
});
export type ExplainExerciseProgressionOutput = z.infer<typeof ExplainExerciseProgressionOutputSchema>;
