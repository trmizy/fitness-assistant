import { z } from "zod";

export const createTrainingCycleSchema = z.object({
  planId: z.string().min(1).optional(),
  startDate: z.string().optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  name: z.string().min(1).max(200).optional(),
  /** Defaults to ACTIVE (existing behavior, unchanged). Pass "DRAFT" to
   * create without immediately starting the cycle — activate later via
   * POST /:id/start. */
  status: z.enum(["DRAFT", "ACTIVE"]).optional(),
  targetMetrics: z.record(z.string(), z.unknown()).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTrainingCycleInput = z.infer<typeof createTrainingCycleSchema>;

export const updateTrainingCycleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  targetMetrics: z.record(z.string(), z.unknown()).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTrainingCycleInput = z.infer<typeof updateTrainingCycleSchema>;

export const listAssessmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const recommendationDecisionSchema = z.object({
  /** Optional — defaults to the latest COMPLETED assessment for the cycle. */
  assessmentId: z.string().min(1).optional(),
});

export const linkInBodyEntrySchema = z.object({
  inbodyEntryId: z.string().min(1, "inbodyEntryId is required"),
});

export const sessionFeedbackSchema = z.object({
  readinessScore: z.number().int().min(1).max(10).optional(),
  sessionRpe: z.number().min(1).max(10).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(1000).optional(),
});
export type SessionFeedbackInput = z.infer<typeof sessionFeedbackSchema>;
