import { Request, Response, NextFunction } from "express";
import { formatSuccessResponse, formatErrorResponse } from "../errors/api-error";
import { estimateDayMacros } from "../services/day-macro-estimate";

/** POST /ai/nutrition/day-estimate { text } — read-only estimate; saving is the client's explicit POST /nutrition per item. */
export const dayMacroEstimateController = {
  async estimate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const text = String((req.body as { text?: unknown })?.text ?? "").trim();
    if (text.length < 3 || text.length > 1500) {
      res.status(400).json(formatErrorResponse("VALIDATION_ERROR", "Mô tả cần từ 3 đến 1500 ký tự."));
      return;
    }
    try {
      const userId = (req as any).context?.userId as string;
      const estimate = await estimateDayMacros({ userId, authorizationHeader: req.headers.authorization }, text);
      res.json(formatSuccessResponse(estimate));
    } catch (err) {
      next(err);
    }
  },
};
