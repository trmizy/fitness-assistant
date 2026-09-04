import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.middleware";
import { coachService } from "../services/coach.service";
import { createManualProgramSchema } from "../models/fitness.models";

const generatePlanDraftSchema = z.object({
  ptNotes: z.string().max(1000).optional(),
  daysPerWeek: z.number().int().min(1).max(7),
  durationWeeks: z.number().int().min(1).max(52),
});

function handleServiceError(res: Response, error: any, fallbackMessage: string): void {
  if (error?.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: fallbackMessage });
}

export const coachController = {
  // Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md
  async getClientSummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await coachService.getClientSummary(req.user!.id, req.params.clientId);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch client summary");
    }
  },

  async createAndAssignPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const input = createManualProgramSchema.parse(req.body);
      const result = await coachService.createAndAssignPlan(req.user!.id, req.params.clientId, input);
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to create and assign plan");
    }
  },

  // Phase 7 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md
  async generatePlanDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const input = generatePlanDraftSchema.parse(req.body);
      const result = await coachService.generatePlanDraft(req.user!.id, req.params.clientId, input);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to generate plan draft");
    }
  },
};
