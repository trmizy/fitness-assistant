import { Request, Response, NextFunction } from "express";
import { formatSuccessResponse, formatErrorResponse } from "../errors/api-error";
import { explainInBody } from "../services/inbody-explanation.service";

/**
 * POST /ai/inbody/interpret { entryId? } — "Giải thích thể trạng" for the user's latest (or the given) InBody entry.
 * Read-only. Facts are deterministic; the explanation text is AI-written or null (never canned).
 */
export const inbodyExplanationController = {
  async interpret(req: Request, res: Response, next: NextFunction): Promise<void> {
    const raw = (req.body as { entryId?: unknown })?.entryId;
    const entryId = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    if (entryId && !/^[0-9a-f-]{8,64}$/i.test(entryId)) {
      res.status(400).json(formatErrorResponse("VALIDATION_ERROR", "entryId không hợp lệ."));
      return;
    }
    try {
      const userId = (req as any).context?.userId as string;
      const result = await explainInBody(userId, req.headers.authorization, entryId);
      if (!result.facts) {
        res.status(404).json(formatErrorResponse("NOT_FOUND", result.explanationError ?? "Không có dữ liệu InBody."));
        return;
      }
      res.json(formatSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  },
};
