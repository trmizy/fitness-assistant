import { Request, Response, NextFunction } from "express";
import { roadmapDraftService } from "../services/roadmap-draft.service";
import { GenerateRoadmapDraftRequestSchema } from "../schemas/roadmap-draft.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const roadmapDraftController = {
  async generateDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const body = GenerateRoadmapDraftRequestSchema.parse(req.body);
      const result = await roadmapDraftService.generateDraft(body);
      res.json(formatSuccessResponse(result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400));
      }
      next(error);
    }
  },
};
