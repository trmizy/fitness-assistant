import { Request, Response, NextFunction } from "express";
import { cycleAssessmentService } from "../services/cycle-assessment.service";
import { AssessCycleRequestSchema } from "../schemas/cycle-assessment.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const cycleAssessmentController = {
  async assessCycle(req: Request, res: Response, next: NextFunction) {
    try {
      const body = AssessCycleRequestSchema.parse(req.body);
      const result = await cycleAssessmentService.assessCycle(body);
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
