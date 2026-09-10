import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.middleware";
import { coachService } from "../services/coach.service";
import { createManualProgramSchema } from "../models/fitness.models";
import { createFitnessRoadmapSchema } from "../models/fitness-roadmap.models";
import { cycleThresholds } from "../config/cycle-thresholds.config";

const generatePlanDraftSchema = z.object({
  ptNotes: z.string().max(1000).optional(),
  daysPerWeek: z.number().int().min(1).max(7),
  durationWeeks: z.number().int().min(1).max(52),
});

const reviewNutritionRecommendationSchema = z.object({
  assessmentId: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
});

const triggerDietBreakSchema = z.object({
  note: z.string().max(1000).optional(),
});

// Safety-floor audit (2026-09-07): this used to be a bare, uncommented
// `.min(800)` — a different, unexplained number from the deterministic
// engines' own 1200 safety rail (cycleThresholds.nutritionAdaptive.
// minPrescriptionCalories). Reusing that same constant here (this is
// still just the request-shape sanity check; coachService.
// modifyNutritionRecommendation -> applyNutritionReviewDecision is the
// authoritative check, with the actionable Vietnamese error message —
// see assertCalorieFloor's doc comment).
const modifyNutritionRecommendationSchema = z.object({
  assessmentId: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
  calories: z
    .number()
    .int()
    .min(
      cycleThresholds.nutritionAdaptive.minPrescriptionCalories,
      `Calo phải từ ${cycleThresholds.nutritionAdaptive.minPrescriptionCalories} kcal trở lên`,
    )
    .max(10000, "Calo không được vượt quá 10000 kcal"),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(2000),
  fat: z.number().min(0).max(1000),
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

  async getClientProgress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await coachService.getClientProgress(req.user!.id, req.params.clientId);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch client progress");
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

  // Phase 2 — PT Approve/Modify/Reject on a client's AI nutrition
  // recommendation (spec §XXIII). `cycleId` names WHICH cycle's assessment
  // (a client may have cycle history); `assessmentId` optionally pins a
  // specific one, defaulting to the latest COMPLETED assessment.
  async approveNutritionRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { assessmentId } = reviewNutritionRecommendationSchema.parse(req.body ?? {});
      const result = await coachService.approveNutritionRecommendation(
        req.user!.id,
        req.params.clientId,
        req.params.cycleId,
        assessmentId,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to approve nutrition recommendation");
    }
  },

  async rejectNutritionRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { assessmentId, note } = reviewNutritionRecommendationSchema.parse(req.body ?? {});
      const result = await coachService.rejectNutritionRecommendation(
        req.user!.id,
        req.params.clientId,
        req.params.cycleId,
        assessmentId,
        note,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to reject nutrition recommendation");
    }
  },

  async modifyNutritionRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { assessmentId, note, calories, protein, carbs, fat } =
        modifyNutritionRecommendationSchema.parse(req.body ?? {});
      const result = await coachService.modifyNutritionRecommendation(
        req.user!.id,
        req.params.clientId,
        req.params.cycleId,
        { calories, protein, carbs, fat },
        assessmentId,
        note,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to modify nutrition recommendation");
    }
  },

  // Diet break / maintenance-phase modeling — PT-initiated trigger (2026-09-07).
  async triggerDietBreakRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { note } = triggerDietBreakSchema.parse(req.body ?? {});
      const result = await coachService.triggerDietBreakRecommendation(
        req.user!.id,
        req.params.clientId,
        req.params.cycleId,
        note,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to trigger diet break recommendation");
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

  async getClientRoadmap(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roadmap = await coachService.getClientRoadmap(req.user!.id, req.params.clientId);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch client's fitness roadmap");
    }
  },

  async createRoadmapDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const input = createFitnessRoadmapSchema.parse(req.body ?? {});
      const roadmap = await coachService.createRoadmapDraftForClient(req.user!.id, req.params.clientId, input);
      res.status(201).json(roadmap);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid input" });
        return;
      }
      handleServiceError(res, error, "Failed to create roadmap draft for client");
    }
  },
};
