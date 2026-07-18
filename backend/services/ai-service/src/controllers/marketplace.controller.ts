import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { marketplaceService } from "../services/marketplace.service";
import { formatSuccessResponse, ApiError } from "../errors/api-error";

const publishSchema = z.object({
  sourcePlanId: z.string().uuid(),
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
});

const reviewSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const marketplaceController = {
  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const body = publishSchema.parse(req.body);
      const listing = await marketplaceService.publishPlan(
        req.context.userId,
        body.sourcePlanId,
        body.title,
        body.description,
      );
      res.status(201).json(formatSuccessResponse(listing));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400),
        );
      }
      next(error);
    }
  },

  async listMine(req: Request, res: Response, next: NextFunction) {
    try {
      const listings = await marketplaceService.listMine(req.context.userId);
      res.json(formatSuccessResponse(listings));
    } catch (error) {
      next(error);
    }
  },

  async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      await marketplaceService.withdraw(req.params.id, req.context.userId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  async listForModeration(req: Request, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const listings = await marketplaceService.listForModeration(status);
      res.json(formatSuccessResponse(listings));
    } catch (error) {
      next(error);
    }
  },

  async reviewAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, action } = req.params;
      if (action !== "APPROVE" && action !== "REJECT") {
        return next(
          new ApiError("VALIDATION_ERROR", "action must be APPROVE or REJECT", 400),
        );
      }
      const body = reviewSchema.parse(req.body ?? {});
      const listing = await marketplaceService.reviewAction(id, action, body.note);
      res.json(formatSuccessResponse(listing));
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
