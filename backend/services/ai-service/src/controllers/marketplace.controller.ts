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

const COMPLAINT_TAG_VALUES = [
  "too_hard",
  "too_easy",
  "equipment_mismatch",
  "unclear_instructions",
  "boring",
  "time_commitment_too_high",
  "not_matching_goal",
  "injury_risk",
  "other",
] as const;

const submitReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
  // Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — all optional.
  goalFit: z.number().int().min(1).max(5).optional(),
  difficultyFit: z.enum(["too_easy", "just_right", "too_hard"]).optional(),
  enjoyment: z.number().int().min(1).max(5).optional(),
  clarity: z.number().int().min(1).max(5).optional(),
  equipmentFit: z.number().int().min(1).max(5).optional(),
  timeFit: z.number().int().min(1).max(5).optional(),
  resultsPerception: z.enum(["better_than_expected", "as_expected", "worse_than_expected", "too_early_to_tell"]).optional(),
  wouldUseAgain: z.boolean().optional(),
  complaintTags: z.array(z.enum(COMPLAINT_TAG_VALUES)).max(10).optional(),
  freeText: z.string().max(2000).optional(),
});

const republishSchema = z.object({
  sourcePlanId: z.string().uuid().optional(),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
  changelog: z.string().min(1).max(2000),
  improvementReason: z.string().max(2000).optional(),
});

const customizedExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  name: z.string().min(1),
  sets: z.number().int().positive(),
  reps: z.string().min(1),
  restSeconds: z.number().int().positive().optional(),
});

const adoptPlanSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  repeatWeeks: z.number().int().min(1).max(52).optional(),
  selectedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  replaceExisting: z.boolean().optional(),
  // Phase 8 follow-up: lets the adopter trim/adjust exercises before import
  // instead of always getting a rigid, unchangeable copy of the listing.
  customizedWeeklySchedule: z
    .array(
      z.object({
        day: z.string().min(1),
        exercises: z.array(customizedExerciseSchema).min(1),
      }),
    )
    .optional(),
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
        req.context.role,
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
      const { goal, sort, page, limit, daysPerWeek, durationWeeksMax } = req.query as Record<string, string>;
      const sortValue =
        sort === "rating" || sort === "quality" || sort === "recommended" ? sort : "recent";
      const result = await marketplaceService.browse({
        goal,
        sort: sortValue,
        daysPerWeek: daysPerWeek ? Number(daysPerWeek) : undefined,
        durationWeeksMax: durationWeeksMax ? Number(durationWeeksMax) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        viewerId: sortValue === "recommended" ? req.context.userId : undefined,
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
      const { rating, comment, ...dimensions } = body;
      const review = await marketplaceService.submitReview(
        req.params.id,
        req.context.userId,
        rating,
        comment,
        dimensions,
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

  // ── Phase 8: versioning ──────────────────────────────────────────────────
  async republish(req: Request, res: Response, next: NextFunction) {
    try {
      const body = republishSchema.parse(req.body);
      const listing = await marketplaceService.republishVersion(
        req.context.userId,
        req.params.id,
        body,
        req.context.role,
      );
      res.status(201).json(formatSuccessResponse(listing));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400));
      }
      next(error);
    }
  },

  async getVersionHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await marketplaceService.listVersionHistory(req.params.id);
      res.json(formatSuccessResponse(history));
    } catch (error) {
      next(error);
    }
  },

  // ── Phase 8: adopt ───────────────────────────────────────────────────────
  async adopt(req: Request, res: Response, next: NextFunction) {
    try {
      const body = adoptPlanSchema.parse(req.body);
      const result = await marketplaceService.adoptPlan(req.context.userId, req.params.id, body);
      res.status(201).json(formatSuccessResponse(result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400));
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

  // ── Phase 8: AI improvement suggestions (advisory only) ──────────────────
  async generateImprovementSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await marketplaceService.generateImprovementSuggestions(req.context.userId, req.params.id);
      res.status(201).json(formatSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  },

  async listImprovementSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await marketplaceService.listImprovementSuggestions(req.context.userId, req.params.id);
      res.json(formatSuccessResponse(result));
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
      const listing = await marketplaceService.reviewAction(id, action, body.note, req.context.userId);
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
