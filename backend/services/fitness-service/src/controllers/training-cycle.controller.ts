import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { trainingCycleService } from "../services/training-cycle.service";
import type { AuthRequest } from "../middleware/auth.middleware";

export const trainingCycleController = {
  async start(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { sourcePlanId, startDate } = req.body ?? {};
      const cycle = await trainingCycleService.startCycle(
        req.user!.id,
        sourcePlanId,
        startDate,
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

  async current(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await trainingCycleService.getCurrentCycle(
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error fetching current training cycle");
      res.status(500).json({ error: "Failed to fetch current training cycle" });
    }
  },

  async close(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.closeCycle(
        req.params.id,
        req.user!.id,
      );
      res.json(cycle);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error closing training cycle");
      res.status(500).json({ error: "Failed to close training cycle" });
    }
  },

  async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;
      const cycles = await trainingCycleService.listCycles(
        req.user!.id,
        limit,
      );
      res.json({ cycles });
    } catch (error) {
      logger.error({ err: error }, "Error listing training cycles");
      res.status(500).json({ error: "Failed to list training cycles" });
    }
  },

  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cycle = await trainingCycleService.getCycle(
        req.params.id,
        req.user!.id,
      );
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
