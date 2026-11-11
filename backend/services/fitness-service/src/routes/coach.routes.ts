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
// PT Copilot (Phase 4): roster-wide adherence for the caller's OWN active clients. Registered before the /clients/:clientId/* routes; the
// path has no :clientId on purpose — which clients are visible is decided by the PT's contracts, never by a request parameter.
router.get("/clients/adherence", authMiddleware, coachController.getRosterAdherence as any);
router.get("/clients/:clientId/summary", authMiddleware, coachController.getClientSummary as any);
// PT Copilot (Phase 4, step 2): audit of a PT's approve/dismiss of an AI-drafted proposal. Re-verifies the PT-client relationship; writes no client data.
router.post("/clients/:clientId/ai-proposals/decision", authMiddleware, coachController.recordAiProposalDecision as any);
// PT Coaching Workspace phase §23 — lazy-loaded InBody/progress, separate
// from the always-loaded summary above (§32: load detailed sections on
// tab activation, not up front).
router.get("/clients/:clientId/progress", authMiddleware, coachController.getClientProgress as any);
router.get("/clients/:clientId/workout-schedules", authMiddleware, coachController.getClientWorkoutSchedules as any);
router.post("/clients/:clientId/plans", authMiddleware, coachController.createAndAssignPlan as any);
router.post("/clients/:clientId/plan-draft", authMiddleware, coachController.generatePlanDraft as any);
router.post(
  "/clients/:clientId/cycles/:cycleId/recommendation/approve",
  authMiddleware,
  coachController.approveTrainingRecommendation as any,
);
router.post(
  "/clients/:clientId/cycles/:cycleId/recommendation/reject",
  authMiddleware,
  coachController.rejectTrainingRecommendation as any,
);

// Phase 2 — PT Approve/Modify/Reject on a client's AI nutrition
// recommendation (spec §XXIII).
router.post(
  "/clients/:clientId/cycles/:cycleId/nutrition-recommendation/approve",
  authMiddleware,
  coachController.approveNutritionRecommendation as any,
);
router.post(
  "/clients/:clientId/cycles/:cycleId/nutrition-recommendation/reject",
  authMiddleware,
  coachController.rejectNutritionRecommendation as any,
);
router.post(
  "/clients/:clientId/cycles/:cycleId/nutrition-recommendation/modify",
  authMiddleware,
  coachController.modifyNutritionRecommendation as any,
);
// FitnessRoadmap PT-assisted integration (Phase E). A PT may only view a
// client's current roadmap and create a new DRAFT for later client review
// — never activate/advance/rebuild/archive it directly (those stay
// 100% client-initiated, same as an AI-generated draft).
router.get("/clients/:clientId/roadmap", authMiddleware, coachController.getClientRoadmap as any);
router.post("/clients/:clientId/roadmap/draft", authMiddleware, coachController.createRoadmapDraft as any);

// Diet break / maintenance-phase modeling — PT-initiated trigger (2026-09-07).
router.post(
  "/clients/:clientId/cycles/:cycleId/nutrition-recommendation/trigger-diet-break",
  authMiddleware,
  coachController.triggerDietBreakRecommendation as any,
);

export default router;
