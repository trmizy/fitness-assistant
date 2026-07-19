import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { trainingCycleService } from "../services/training-cycle.service";
import type { AuthRequest } from "../middleware/auth.middleware";

export const trainingCycleController = {
  async start(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { planId, startDate, durationDays } = req.body ?? {};
      const cycle = await trainingCycleService.startCycle(
        req.user!.id,
        planId ?? null,
        startDate,
        durationDays ?? 30,
      );
      res.status(201).json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error starting training cycle");
      res.status(500).json({ error: "Failed to start training cycle" });
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
