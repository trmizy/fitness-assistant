import { Request, Response, NextFunction } from "express";
import { exerciseProgressionExplanationService } from "../services/exercise-progression-explanation.service";
import { ExplainExerciseProgressionRequestSchema } from "../schemas/exercise-progression-explanation.schemas";
import { formatSuccessResponse, ApiError } from "../errors/api-error";
import { z } from "zod";

export const exerciseProgressionExplanationController = {
  async explain(req: Request, res: Response, next: NextFunction) {
    try {
      const body = ExplainExerciseProgressionRequestSchema.parse(req.body);
      const result = await exerciseProgressionExplanationService.explain(body);
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
