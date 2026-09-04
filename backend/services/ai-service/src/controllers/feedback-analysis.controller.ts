import { Request, Response, NextFunction } from "express";
import { feedbackAnalysisService } from "../services/feedback-analysis.service";
import { AnalyzeFeedbackRequestSchema } from "../schemas/feedback-analysis.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const feedbackAnalysisController = {
  async analyzeFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const body = AnalyzeFeedbackRequestSchema.parse(req.body);
      const result = await feedbackAnalysisService.analyzeFeedback(body);
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
