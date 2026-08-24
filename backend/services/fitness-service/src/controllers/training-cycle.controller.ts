import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import { trainingCycleService } from "../services/training-cycle.service";
import { feedbackAnalysisService } from "../services/feedback-analysis.service";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  createTrainingCycleSchema,
  updateTrainingCycleSchema,
  listAssessmentsQuerySchema,
  recommendationDecisionSchema,
  linkInBodyEntrySchema,
  sessionFeedbackSchema,
} from "../models/training-cycle.models";

function handleServiceError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({ err: error }, fallbackMessage);
  res.status(500).json({ error: fallbackMessage });
}

export const trainingCycleController = {
  async start(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = createTrainingCycleSchema.parse(req.body ?? {});
      const cycle = await trainingCycleService.startCycle(
        req.user!.id,
        body.planId ?? null,
        body.startDate,
        body.durationDays ?? 30,
        { name: body.name, status: body.status, targetMetrics: body.targetMetrics, configuration: body.configuration },
      );
      res.status(201).json(cycle);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to start training cycle");
    }
  },

  async startDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.startDraftCycle(req.params.id, req.user!.id);
      res.json(cycle);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to start draft training cycle");
    }
  },

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = updateTrainingCycleSchema.parse(req.body ?? {});
      const cycle = await trainingCycleService.updateCycle(req.params.id, req.user!.id, body);
      res.json(cycle);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to update training cycle");
    }
  },

  async progress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await trainingCycleService.getCycleProgress(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch training cycle progress");
    }
  },

  async evaluate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const assessment = await trainingCycleService.evaluateCycle(req.params.id, req.user!.id);
      res.status(202).json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to evaluate training cycle");
    }
  },

  async listAssessments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const query = listAssessmentsQuerySchema.parse(req.query ?? {});
      const result = await trainingCycleService.listAssessments(req.params.id, req.user!.id, query.page, query.limit);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to list cycle assessments");
    }
  },

  async latestAssessment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const assessment = await trainingCycleService.getLatestAssessment(req.params.id, req.user!.id);
      res.json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch latest cycle assessment");
    }
  },

  async acceptRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = recommendationDecisionSchema.parse(req.body ?? {});
      const assessment = await trainingCycleService.acceptRecommendation(req.params.id, req.user!.id, body.assessmentId);
      res.json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to accept cycle recommendation");
    }
  },

  async rejectRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = recommendationDecisionSchema.parse(req.body ?? {});
      const assessment = await trainingCycleService.rejectRecommendation(req.params.id, req.user!.id, body.assessmentId);
      res.json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to reject cycle recommendation");
    }
  },

  // Phase 2 — nutrition recommendation accept/reject, independent from the
  // training accept/reject above (spec §14/§15).
  async acceptNutritionRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = recommendationDecisionSchema.parse(req.body ?? {});
      const assessment = await trainingCycleService.acceptNutritionRecommendation(req.params.id, req.user!.id, body.assessmentId);
      res.json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to accept nutrition recommendation");
    }
  },

  async rejectNutritionRecommendation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = recommendationDecisionSchema.parse(req.body ?? {});
      const assessment = await trainingCycleService.rejectNutritionRecommendation(req.params.id, req.user!.id, body.assessmentId);
      res.json(assessment);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to reject nutrition recommendation");
    }
  },

  async linkInBodyEntry(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = linkInBodyEntrySchema.parse(req.body ?? {});
      const link = await trainingCycleService.linkInBodyEntry(req.params.id, req.user!.id, body.inbodyEntryId);
      res.status(201).json(link);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to link InBody entry to training cycle");
    }
  },

  async active(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await trainingCycleService.getActiveCycle(req.user!.id);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error fetching active training cycle");
      res.status(500).json({ error: "Failed to fetch active training cycle" });
    }
  },

  async complete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { endInbodyId } = req.body ?? {};
      const cycle = await trainingCycleService.completeCycle(
        req.params.id,
        req.user!.id,
        endInbodyId,
      );
      res.json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error completing training cycle");
      res.status(500).json({ error: "Failed to complete training cycle" });
    }
  },

  async cancel(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.cancelCycle(req.params.id, req.user!.id);
      res.json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error cancelling training cycle");
      res.status(500).json({ error: "Failed to cancel training cycle" });
    }
  },

  async approveDecision(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { nextPlanId } = req.body ?? {};
      if (!nextPlanId) {
        res.status(400).json({ error: "nextPlanId is required" });
        return;
      }
      const cycle = await trainingCycleService.approveDecision(
        req.params.id,
        req.user!.id,
        nextPlanId,
      );
      res.json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error approving cycle decision");
      res.status(500).json({ error: "Failed to approve cycle decision" });
    }
  },

  async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const cycles = await trainingCycleService.listCycles(req.user!.id, limit);
      res.json({ cycles });
    } catch (error) {
      logger.error({ err: error }, "Error listing training cycles");
      res.status(500).json({ error: "Failed to list training cycles" });
    }
  },

  async submitSessionFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = sessionFeedbackSchema.parse(req.body ?? {});
      const feedback = await trainingCycleService.submitSessionFeedback(
        req.params.id,
        req.user!.id,
        req.params.scheduleId,
        body,
      );
      res.status(201).json(feedback);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to submit session feedback");
    }
  },

  async listRecommendationAudits(req: AuthRequest, res: Response): Promise<void> {
    try {
      const audits = await trainingCycleService.listRecommendationAudits(req.params.id, req.user!.id);
      res.json({ audits });
    } catch (error: any) {
      handleServiceError(res, error, "Failed to list recommendation audits");
    }
  },

  async report(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await trainingCycleService.getCycleReport(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to build training cycle report");
    }
  },

  // Phase 3 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md
  async sessionFeedbackSummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await trainingCycleService.getSessionFeedbackSummary(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to build session feedback summary");
    }
  },

  // Phase 4 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — explicit
  // trigger (mirrors POST /evaluate) since this calls the AI service and
  // writes an audit row; never runs automatically on a GET.
  async analyzeFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await feedbackAnalysisService.analyzeCycleFeedback(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to analyze cycle feedback");
    }
  },

  async latestFeedbackAnalysis(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await feedbackAnalysisService.getLatestFeedbackAnalysis(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch latest feedback analysis");
    }
  },

  async remove(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.deleteCycle(req.params.id, req.user!.id);
      res.json({ cycleId: cycle.id, archived: true, archivedAt: cycle.archivedAt });
    } catch (error: any) {
      handleServiceError(res, error, "Failed to delete training cycle");
    }
  },

  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.getCycle(req.params.id, req.user!.id);
      res.json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error fetching training cycle");
      res.status(500).json({ error: "Failed to fetch training cycle" });
    }
  },
};
