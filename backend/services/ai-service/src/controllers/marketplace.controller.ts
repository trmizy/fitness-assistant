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

const submitReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const createPackageSchema = z.object({
  publishedPlanId: z.string().uuid(),
  name: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  durationWeeks: z.number().int().positive().optional(),
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

  async browse(req: Request, res: Response, next: NextFunction) {
    try {
      const { goal, sort, page, limit } = req.query as Record<string, string>;
      const result = await marketplaceService.browse({
        goal,
        sort: sort === "rating" ? "rating" : "recent",
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(formatSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  },

  async getDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const listing = await marketplaceService.getApprovedDetail(req.params.id);
      res.json(formatSuccessResponse(listing));
    } catch (error) {
      next(error);
    }
  },

  async submitReview(req: Request, res: Response, next: NextFunction) {
    try {
      const body = submitReviewSchema.parse(req.body);
      const review = await marketplaceService.submitReview(
        req.params.id,
        req.context.userId,
        body.rating,
        body.comment,
      );
      res.status(201).json(formatSuccessResponse(review));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400),
        );
      }
      next(error);
    }
  },

  // ── Selling packages ─────────────────────────────────────────────────────
  async createPackage(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createPackageSchema.parse(req.body);
      const pkg = await marketplaceService.createPackage(
        req.context.userId,
        body.publishedPlanId,
        body.name,
        body.price,
        body.description,
        body.durationWeeks,
      );
      res.status(201).json(formatSuccessResponse(pkg));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400),
        );
      }
      next(error);
    }
  },

  async listMyPackages(req: Request, res: Response, next: NextFunction) {
    try {
      const packages = await marketplaceService.listMyPackages(req.context.userId);
      res.json(formatSuccessResponse(packages));
    } catch (error) {
      next(error);
    }
  },

  async archivePackage(req: Request, res: Response, next: NextFunction) {
    try {
      const pkg = await marketplaceService.archivePackage(
        req.params.id,
        req.context.userId,
      );
      res.json(formatSuccessResponse(pkg));
    } catch (error) {
      next(error);
    }
  },

  async browsePackages(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query as Record<string, string>;
      const result = await marketplaceService.browsePackages({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(formatSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  },

  async purchasePackage(req: Request, res: Response, next: NextFunction) {
    try {
      const purchase = await marketplaceService.purchasePackage(
        req.params.id,
        req.context.userId,
      );
      res.status(201).json(formatSuccessResponse(purchase));
    } catch (error) {
      next(error);
    }
  },

  async listMyPurchases(req: Request, res: Response, next: NextFunction) {
    try {
      const purchases = await marketplaceService.listMyPurchases(req.context.userId);
      res.json(formatSuccessResponse(purchases));
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
