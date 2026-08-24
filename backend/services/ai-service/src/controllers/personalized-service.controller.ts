import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { personalizedServiceService, CONSENT_CATEGORIES } from "../services/personalized-service.service";
import { formatSuccessResponse, ApiError } from "../errors/api-error";

const SERVICE_TYPES = ["PERSONALIZED_WORKOUT", "PERSONALIZED_NUTRITION", "WORKOUT_AND_NUTRITION", "ONLINE_COACHING"] as const;

const createServiceSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  deliverables: z.array(z.string().min(1).max(200)).min(1).max(20),
  revisionLimit: z.number().int().min(0).max(50).nullable().optional(),
  initialDeliveryDays: z.number().int().min(1).max(30),
  supportWeeks: z.number().int().min(1).max(52).nullable().optional(),
  targetGoal: z.string().max(100).optional(),
  targetLevel: z.string().max(100).optional(),
});

const submitIntakeSchema = z.object({
  intakeData: z.record(z.unknown()),
  consentCategories: z.array(z.enum(CONSENT_CATEGORIES)).min(1),
});

// Matches fitness-service's createManualProgramSchema shape 1:1 — see
// personalized-service.service.ts's header comment on why the draft is
// stored/validated in this exact shape (one commit implementation, not two).
const draftExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  order: z.number().int().min(1).max(30).optional(),
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(100),
  restSeconds: z.number().int().min(0).max(600),
  notes: z.string().max(300).optional().nullable(),
});
const draftDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  exercises: z.array(draftExerciseSchema).min(1),
});
const deliverDraftSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(200).optional().nullable(),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repeatWeeks: z.number().int().min(1).max(52).optional(),
  selectedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  replaceExisting: z.boolean().default(true).optional(),
  days: z.array(draftDaySchema).min(1).max(7),
});

const requestRevisionSchema = z.object({
  category: z.enum(["EXERCISE", "SCHEDULE", "DIFFICULTY", "EQUIPMENT", "NUTRITION", "OTHER"]),
  comment: z.string().min(1).max(2000),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(2000) });

const checkInSchema = z.object({
  weekNumber: z.number().int().min(1).max(104).optional(),
  weight: z.number().positive().max(500).optional(),
  energyLevel: z.number().int().min(1).max(5).optional(),
  sleepQuality: z.number().int().min(1).max(5).optional(),
  stressLevel: z.number().int().min(1).max(5).optional(),
  overallRpe: z.number().min(1).max(10).optional(),
  workoutAdherence: z.number().int().min(0).max(100).optional(),
  nutritionAdherence: z.number().int().min(0).max(100).optional(),
  painOrDiscomfort: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(2000).optional(),
});

const reviewSchema = z.object({
  overallRating: z.number().int().min(1).max(5),
  communicationRating: z.number().int().min(1).max(5).optional(),
  personalizationRating: z.number().int().min(1).max(5).optional(),
  planQualityRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
});

const adminResolveRefundSchema = z.object({
  decision: z.enum(["APPROVE", "DENY"]),
  refundAmount: z.number().positive().optional(),
  note: z.string().min(1).max(2000),
});

function handleZod(error: unknown, next: NextFunction): boolean {
  if (error instanceof z.ZodError) {
    next(new ApiError("VALIDATION_ERROR", error.errors[0]?.message ?? "Invalid input", 400));
    return true;
  }
  return false;
}

export const personalizedServiceController = {
  // ── PT: manage listings ──────────────────────────────────────────────────
  async createService(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createServiceSchema.parse(req.body);
      const service = await personalizedServiceService.createService(req.context.userId, body);
      res.status(201).json(formatSuccessResponse(service));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async listMyServices(req: Request, res: Response, next: NextFunction) {
    try {
      const services = await personalizedServiceService.listMyServices(req.context.userId);
      res.json(formatSuccessResponse(services));
    } catch (error) {
      next(error);
    }
  },

  async archiveService(req: Request, res: Response, next: NextFunction) {
    try {
      const service = await personalizedServiceService.archiveService(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(service));
    } catch (error) {
      next(error);
    }
  },

  // ── Browse + detail ───────────────────────────────────────────────────────
  async browseServices(req: Request, res: Response, next: NextFunction) {
    try {
      const { serviceType, goal, level, page, limit } = req.query as Record<string, string>;
      const result = await personalizedServiceService.browseServices({
        serviceType,
        goal,
        level,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(formatSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  },

  async getServiceDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const service = await personalizedServiceService.getServiceDetail(req.params.id);
      res.json(formatSuccessResponse(service));
    } catch (error) {
      next(error);
    }
  },

  // ── Purchase ──────────────────────────────────────────────────────────────
  async purchaseService(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.purchaseService(req.params.id, req.context.userId);
      res.status(201).json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  // ── Orders ────────────────────────────────────────────────────────────────
  async listMyOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const orders = await personalizedServiceService.listMyOrders(req.context.userId);
      res.json(formatSuccessResponse(orders));
    } catch (error) {
      next(error);
    }
  },

  async listOrdersForSeller(req: Request, res: Response, next: NextFunction) {
    try {
      const orders = await personalizedServiceService.listOrdersForSeller(req.context.userId);
      res.json(formatSuccessResponse(orders));
    } catch (error) {
      next(error);
    }
  },

  async getOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.getOrder(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  async submitIntake(req: Request, res: Response, next: NextFunction) {
    try {
      const body = submitIntakeSchema.parse(req.body);
      const order = await personalizedServiceService.submitIntake(req.params.id, req.context.userId, body);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async startReview(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.startReview(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  async deliverDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const body = deliverDraftSchema.parse(req.body);
      const order = await personalizedServiceService.deliverDraft(req.params.id, req.context.userId, body);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async requestRevision(req: Request, res: Response, next: NextFunction) {
    try {
      const body = requestRevisionSchema.parse(req.body);
      const order = await personalizedServiceService.requestRevision(req.params.id, req.context.userId, body);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async startRevisionWork(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.startRevisionWork(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  async acceptOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.acceptOrder(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  async completeOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await personalizedServiceService.completeOrder(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      next(error);
    }
  },

  async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const body = reasonSchema.partial().parse(req.body ?? {});
      const order = await personalizedServiceService.cancelOrder(req.params.id, req.context.userId, body.reason);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async requestRefund(req: Request, res: Response, next: NextFunction) {
    try {
      const body = reasonSchema.parse(req.body);
      const order = await personalizedServiceService.requestRefund(req.params.id, req.context.userId, body.reason);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async openDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const body = reasonSchema.parse(req.body);
      const order = await personalizedServiceService.openDispute(req.params.id, req.context.userId, body.reason);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  // ── Plan version history (§XVIII) ────────────────────────────────────────
  async listPlanVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const versions = await personalizedServiceService.listPlanVersions(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(versions));
    } catch (error) {
      next(error);
    }
  },

  // ── Weekly check-in ───────────────────────────────────────────────────────
  async submitCheckIn(req: Request, res: Response, next: NextFunction) {
    try {
      const body = checkInSchema.parse(req.body);
      const checkIn = await personalizedServiceService.submitCheckIn(req.params.id, req.context.userId, body);
      res.status(201).json(formatSuccessResponse(checkIn));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async listCheckIns(req: Request, res: Response, next: NextFunction) {
    try {
      const checkIns = await personalizedServiceService.listCheckIns(req.params.id, req.context.userId);
      res.json(formatSuccessResponse(checkIns));
    } catch (error) {
      next(error);
    }
  },

  // ── Review ────────────────────────────────────────────────────────────────
  async submitReview(req: Request, res: Response, next: NextFunction) {
    try {
      const body = reviewSchema.parse(req.body);
      const review = await personalizedServiceService.submitReview(req.params.id, req.context.userId, body);
      res.status(201).json(formatSuccessResponse(review));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },

  async getSellerReviewSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await personalizedServiceService.getSellerReviewSummary(req.params.sellerId);
      res.json(formatSuccessResponse(summary));
    } catch (error) {
      next(error);
    }
  },

  // ── Admin refund resolution — backend-enforced, not just hidden in the UI.
  // req.context.role is populated by the gateway from the verified JWT (see
  // auth.middleware.ts) — a non-ADMIN caller is rejected here regardless of
  // what the frontend shows. ───────────────────────────────────────────────
  async listRefundRequests(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.context.role !== "ADMIN") {
        throw new ApiError("PERSONALIZED_SERVICE_ADMIN_ONLY", "Admin only", 403);
      }
      const orders = await personalizedServiceService.listRefundRequests();
      res.json(formatSuccessResponse(orders));
    } catch (error) {
      next(error);
    }
  },

  async getRefundCalculation(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.context.role !== "ADMIN") {
        throw new ApiError("PERSONALIZED_SERVICE_ADMIN_ONLY", "Admin only", 403);
      }
      const calc = await personalizedServiceService.getRefundCalculation(req.params.id);
      res.json(formatSuccessResponse(calc));
    } catch (error) {
      next(error);
    }
  },

  async adminResolveRefund(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.context.role !== "ADMIN") {
        throw new ApiError("PERSONALIZED_SERVICE_ADMIN_ONLY", "Admin only", 403);
      }
      const body = adminResolveRefundSchema.parse(req.body);
      const order = await personalizedServiceService.adminResolveRefund(req.params.id, req.context.userId, body);
      res.json(formatSuccessResponse(order));
    } catch (error) {
      if (handleZod(error, next)) return;
      next(error);
    }
  },
};
