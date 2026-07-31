import { Request, Response, NextFunction } from "express";
import { cycleAnalysisService } from "../services/cycle-analysis.service";
import { AnalyzeCycleRequestSchema } from "../schemas/cycle-analysis.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const cycleAnalysisController = {
  async analyzeCycle(req: Request, res: Response, next: NextFunction) {
    try {
      const body = AnalyzeCycleRequestSchema.parse(req.body);
      const result = await cycleAnalysisService.analyzeCycle(body);
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
