import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { planReviewController } from "../controllers/plan-review.controller";

const router = Router();

// Workout Plan Review & Approval. Mounted at /plan-reviews. authMiddleware only identifies the caller; the real authorization
// (owner / assigned PT / ACTIVE contract) is re-derived inside planReviewService on EVERY call, never from the route or a body.
// Static paths first so "mine" / "inbox" / "summary" are never captured by /:id.
router.post("/", authMiddleware, planReviewController.submit as any);
router.get("/mine", authMiddleware, planReviewController.mine as any);
router.get("/inbox", authMiddleware, planReviewController.inbox as any);
router.get("/summary", authMiddleware, planReviewController.summary as any);
router.get("/:id", authMiddleware, planReviewController.get as any);
router.get("/:id/events", authMiddleware, planReviewController.events as any);
router.post("/:id/start", authMiddleware, planReviewController.start as any);
router.post("/:id/decision", authMiddleware, planReviewController.decision as any);
router.post("/:id/cancel", authMiddleware, planReviewController.cancel as any);

export default router;
