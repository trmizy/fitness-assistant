import { Router } from "express";
import { adminController } from "../controllers/admin.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/requireRole.middleware";

const router = Router();

// All admin endpoints require a verified gateway identity.
// The API gateway enforces ADMIN role before forwarding to this service —
// requireRole below is defense-in-depth for that same check, not a
// replacement for it: it protects this route the same way if ai-service is
// ever reached through a path that forwards x-user-role without having
// verified it first (e.g. a misconfigured API Gateway integration in the
// AWS deployment — see the AWS deployment audit, section 17).
router.use(requireAuth);
router.use(requireRole(["ADMIN"]));

/** GET /admin/ai/overview — aggregate stats */
router.get("/overview", adminController.getOverview);

/** GET /admin/ai/requests — paginated conversation list */
router.get("/requests", adminController.listRequests);

/** GET /admin/ai/requests/:id — full conversation trace detail */
router.get("/requests/:id", adminController.getRequest);

/** GET /admin/ai/queue — plan queue + BullMQ live counts */
router.get("/queue", adminController.getQueue);

/** GET /admin/ai/errors — failed plans + high-warning conversations */
router.get("/errors", adminController.getErrors);

router.get("/knowledge", adminController.getKnowledgePipeline);
router.post("/knowledge/jobs/:kind", adminController.enqueueKnowledgePipeline);
router.post(
  "/knowledge/review/:reviewId/approve",
  adminController.approveKnowledgeReviewItem,
);
router.post(
  "/knowledge/review/:reviewId/reject",
  adminController.rejectKnowledgeReviewItem,
);
router.post("/knowledge/schedule", adminController.scheduleKnowledgePipeline);
router.delete("/knowledge/schedule", adminController.clearKnowledgeSchedule);

export default router;
