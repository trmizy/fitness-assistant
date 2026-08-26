import { Response } from "express";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import { importService } from "../services/import.service";
import { previewHevyImportSchema, commitImportBatchSchema } from "../models/fitness.models";

// Roadmap P2 "Canonical import framework" + P2.1 "Hevy import"
// (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
export const importController = {
  async previewHevy(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = previewHevyImportSchema.parse(req.body);
      const result = await importService.previewHevyImport(req.user!.id, data.fileName, data.csvContent);
      res.status(result.blocked ? 400 : 201).json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid import request", details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error previewing Hevy import");
      res.status(500).json({ error: "Failed to preview import" });
    }
  },

  async commit(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = commitImportBatchSchema.parse(req.body);
      const result = await importService.commitImportBatch(req.user!.id, req.params.batchId, data.resolutions);
      res.json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid commit request", details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message, candidates: error.candidates });
        return;
      }
      logger.error({ err: error }, "Error committing import batch");
      res.status(500).json({ error: "Failed to commit import" });
    }
  },

  async cancel(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await importService.cancelImportBatch(req.user!.id, req.params.batchId);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error cancelling import batch");
      res.status(500).json({ error: "Failed to cancel import" });
    }
  },

  async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const batches = await importService.listImportBatches(req.user!.id);
      res.json({ batches });
    } catch (error: any) {
      logger.error({ err: error }, "Error listing import batches");
      res.status(500).json({ error: "Failed to list import batches" });
    }
  },
};
