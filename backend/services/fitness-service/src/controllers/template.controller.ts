import { Response } from "express";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import { templateService } from "../services/template.service";
import {
  createTemplateFromProgramSchema,
  shareTemplateSchema,
  importTemplateSchema,
} from "../models/fitness.models";

// Roadmap P2.6 "Workout template sharing/import"
// (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
function handleServiceError(error: any, res: Response, fallbackMessage: string) {
  if (error?.name === "ZodError") {
    res.status(400).json({ error: "Invalid request", details: error.errors });
    return;
  }
  if (error?.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({ err: error }, fallbackMessage);
  res.status(500).json({ error: fallbackMessage });
}

export const templateController = {
  async createFromProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createTemplateFromProgramSchema.parse(req.body);
      const template = await templateService.createTemplateFromProgram(req.user!.id, data);
      res.status(201).json({ template });
    } catch (error: any) {
      handleServiceError(error, res, "Failed to create template");
    }
  },

  async share(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = shareTemplateSchema.parse(req.body);
      const template = await templateService.shareTemplate(req.user!.id, req.params.id, data.recipientUserId);
      res.json({ template });
    } catch (error: any) {
      handleServiceError(error, res, "Failed to share template");
    }
  },

  async listMine(req: AuthRequest, res: Response): Promise<void> {
    try {
      const templates = await templateService.listMyTemplates(req.user!.id);
      res.json({ templates });
    } catch (error: any) {
      handleServiceError(error, res, "Failed to list templates");
    }
  },

  async listSharedWithMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const templates = await templateService.listTemplatesSharedWithMe(req.user!.id);
      res.json({ templates });
    } catch (error: any) {
      handleServiceError(error, res, "Failed to list shared templates");
    }
  },

  async importTemplate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = importTemplateSchema.parse(req.body);
      const result = await templateService.importTemplate(req.user!.id, req.params.id, data);
      res.status(201).json(result);
    } catch (error: any) {
      handleServiceError(error, res, "Failed to import template");
    }
  },
};
