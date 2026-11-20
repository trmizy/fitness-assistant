import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import { planReviewService } from "../services/plan-review";
import { kickPlanReviewNotifications } from "../services/plan-review/plan-review.notifier";
import { PLAN_REVIEW_STATUSES } from "../services/plan-review/plan-review.engine";

// Identity comes ONLY from the verified session (req.user). Nothing in a body/query/param can name the caller or their role.
// `.strict()` rejects unknown keys, so a smuggled clientUserId / role / status is a 400, not silently ignored.
const submitSchema = z
  .object({
    ptUserId: z.string().min(1).max(100),
    programId: z.string().uuid().optional(),
    /** The monotonic program version the caller saw (e.g. an AI-chat confirmation card): a newer plan => 409, never a silent send. */
    expectedVersion: z.number().int().min(1).optional(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    clientNote: z.string().max(1000).nullish(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT"]),
    note: z.string().max(1000).nullish(),
    expectedRevision: z.number().int().min(1).optional(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

function actor(req: AuthRequest) {
  const user = req.user!;
  return { id: user.id, role: user.role };
}

function handle(res: Response, error: any, fallback: string): void {
  if (error?.status && error?.code) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error?.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({ err: error?.message }, `[plan-review] ${fallback}`);
  res.status(500).json({ error: fallback });
}

export const planReviewController = {
  /** POST /plan-reviews */
  async submit(req: AuthRequest, res: Response) {
    try {
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Dữ liệu không hợp lệ", code: "VALIDATION", details: parsed.error.flatten() });
      }
      const header = req.headers["idempotency-key"];
      const idempotencyKey = parsed.data.idempotencyKey ?? (Array.isArray(header) ? header[0] : header);
      const result = await planReviewService.submit(actor(req), { ...parsed.data, idempotencyKey });
      res.status(result.replayed ? 200 : 201).json(result);
      kickPlanReviewNotifications(); // best-effort, after the response; the periodic sweep retries anything this misses
    } catch (error) {
      handle(res, error, "Không thể gửi kế hoạch cho PT");
    }
  },

  /** GET /plan-reviews/mine?programId= */
  async mine(req: AuthRequest, res: Response) {
    try {
      const subjectId = typeof req.query.programId === "string" ? req.query.programId : undefined;
      res.json({ requests: await planReviewService.listMine(actor(req), { subjectId }) });
    } catch (error) {
      handle(res, error, "Không thể tải danh sách yêu cầu");
    }
  },

  /** GET /plan-reviews/inbox?status=PENDING_REVIEW,IN_REVIEW */
  async inbox(req: AuthRequest, res: Response) {
    try {
      let statuses: any;
      if (typeof req.query.status === "string" && req.query.status.length > 0) {
        statuses = req.query.status.split(",").map((s) => s.trim());
        if (!statuses.every((s: string) => (PLAN_REVIEW_STATUSES as readonly string[]).includes(s))) {
          return void res.status(400).json({ error: "status không hợp lệ", code: "VALIDATION" });
        }
      }
      res.json({ requests: await planReviewService.listInbox(actor(req), { statuses }) });
    } catch (error) {
      handle(res, error, "Không thể tải hộp thư duyệt kế hoạch");
    }
  },

  /** GET /plan-reviews/summary */
  async summary(req: AuthRequest, res: Response) {
    try {
      res.json(await planReviewService.summary(actor(req)));
    } catch (error) {
      handle(res, error, "Không thể tải tổng quan");
    }
  },

  /** GET /plan-reviews/:id */
  async get(req: AuthRequest, res: Response) {
    try {
      res.json({ request: await planReviewService.get(actor(req), req.params.id) });
    } catch (error) {
      handle(res, error, "Không thể tải yêu cầu");
    }
  },

  /** GET /plan-reviews/:id/events */
  async events(req: AuthRequest, res: Response) {
    try {
      res.json({ events: await planReviewService.events(actor(req), req.params.id) });
    } catch (error) {
      handle(res, error, "Không thể tải lịch sử");
    }
  },

  /** POST /plan-reviews/:id/start — PT opens the request (PENDING_REVIEW → IN_REVIEW). */
  async start(req: AuthRequest, res: Response) {
    try {
      res.json({ request: await planReviewService.start(actor(req), req.params.id) });
    } catch (error) {
      handle(res, error, "Không thể mở yêu cầu");
    }
  },

  /** POST /plan-reviews/:id/decision */
  async decision(req: AuthRequest, res: Response) {
    try {
      const parsed = decisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Dữ liệu không hợp lệ", code: "VALIDATION", details: parsed.error.flatten() });
      }
      const { decision, ...input } = parsed.data;
      const a = actor(req);
      const result =
        decision === "APPROVE"
          ? await planReviewService.approve(a, req.params.id, input)
          : decision === "REQUEST_CHANGES"
            ? await planReviewService.requestChanges(a, req.params.id, input)
            : await planReviewService.reject(a, req.params.id, input);
      res.json(result);
      kickPlanReviewNotifications();
    } catch (error) {
      handle(res, error, "Không thể ghi nhận quyết định");
    }
  },

  /** POST /plan-reviews/:id/cancel */
  async cancel(req: AuthRequest, res: Response) {
    try {
      res.json(await planReviewService.cancel(actor(req), req.params.id));
      kickPlanReviewNotifications();
    } catch (error) {
      handle(res, error, "Không thể huỷ yêu cầu");
    }
  },
};
