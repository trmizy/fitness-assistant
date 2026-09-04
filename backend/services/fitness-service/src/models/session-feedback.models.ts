import { z } from "zod";

/** Phase 2 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — richer session
 * feedback addressable directly by workoutScheduleId (not nested under a
 * cycle route, since a session can exist outside any cycle). Superset of
 * the existing `sessionFeedbackSchema` (training-cycle.models.ts) fields —
 * that endpoint stays untouched for backward compatibility; this is the
 * new, richer surface. All fields optional: a partial submission (e.g. just
 * a star rating) is valid, matching "feedback should be low-friction."
 */

export const exerciseFeedbackItemSchema = z.object({
  exerciseId: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  issueType: z
    .enum([
      "too_heavy",
      "too_light",
      "too_many_sets",
      "too_few_sets",
      "uncomfortable",
      "pain",
      "boring",
      "liked",
      "confusing",
      "equipment_unavailable",
    ])
    .optional(),
  note: z.string().max(500).optional(),
});

/** Feedback for a COMPLETED / PARTIALLY_COMPLETED session. */
export const completionFeedbackSchema = z.object({
  // Reuse the existing readiness/RPE/pain fields (already read by
  // cycle-metrics.engine.ts) alongside the new richer ones.
  readinessScore: z.number().int().min(1).max(10).optional(),
  sessionRpe: z.number().min(1).max(10).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(1000).optional(), // sessionComment

  sessionRating: z.number().int().min(1).max(5).optional(),
  difficulty: z.enum(["too_easy", "just_right", "too_hard"]).optional(),
  enjoyment: z.enum(["low", "medium", "high"]).optional(),
  fatigueAfterSession: z.number().int().min(1).max(10).optional(),
  painLocation: z.string().max(200).optional(),
  wouldRepeatSession: z.enum(["yes", "no", "unsure"]).optional(),
  perceivedProgress: z.enum(["better_than_last_time", "same", "worse", "unsure"]).optional(),
  exerciseFeedback: z.array(exerciseFeedbackItemSchema).max(50).optional(),
});

/** Feedback for a SKIPPED / CANCELLED session — a distinct, shorter form. */
export const skipCancelFeedbackSchema = z.object({
  skipReason: z.enum([
    "fatigue",
    "pain",
    "schedule_conflict",
    "motivation",
    "illness",
    "equipment_unavailable",
    "too_hard_previous_session",
    "other",
  ]),
  notes: z.string().max(1000).optional(),
  shouldAdjustPlan: z.boolean().optional(),
  userAvailableMakeupDay: z.string().optional(), // ISO date string
});

/** Discriminated at the service layer by the WorkoutSchedule's actual
 * status (not by the client — a client could lie about which form it's
 * submitting). This schema just validates "the request body is a plausible
 * shape of one or the other," the service picks which fields it actually
 * persists based on real status. */
export const sessionFeedbackInputSchema = z.union([completionFeedbackSchema, skipCancelFeedbackSchema]);
export type CompletionFeedbackInput = z.infer<typeof completionFeedbackSchema>;
export type SkipCancelFeedbackInput = z.infer<typeof skipCancelFeedbackSchema>;
export type ExerciseFeedbackItem = z.infer<typeof exerciseFeedbackItemSchema>;

export const dismissFeedbackSchema = z.object({
  dismissed: z.literal(true),
});
