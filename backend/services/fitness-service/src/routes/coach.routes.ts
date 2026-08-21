import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { coachController } from "../controllers/coach.controller";

const router = Router();

// Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — mounted at
// /coach. Gated by the normal end-user authMiddleware (this is the PT's own
// browser session, not a service-to-service call) — the actual
// authorization ("does this caller have an ACTIVE contract with clientId")
// happens inside coachService against every request, not at the route
// layer, since it depends on the caller+clientId pair rather than a static
// role check.
router.get("/clients/:clientId/summary", authMiddleware, coachController.getClientSummary as any);
router.post("/clients/:clientId/plans", authMiddleware, coachController.createAndAssignPlan as any);
router.post("/clients/:clientId/plan-draft", authMiddleware, coachController.generatePlanDraft as any);

export default router;
