import { Request, Response, NextFunction } from "express";
import { clientPlanDraftService } from "../services/client-plan-draft.service";
import { GenerateClientPlanDraftRequestSchema } from "../schemas/client-plan-draft.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const clientPlanDraftController = {
  async generateDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const body = GenerateClientPlanDraftRequestSchema.parse(req.body);
      const result = await clientPlanDraftService.generateDraft(body);
      res.json(formatSuccessResponse(result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400),
        );
      }
      next(error);
    }
  },
};
