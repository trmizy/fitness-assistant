import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import { trainingCycleService } from "../services/training-cycle.service";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  createTrainingCycleSchema,
  updateTrainingCycleSchema,
  listAssessmentsQuerySchema,
  recommendationDecisionSchema,
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
