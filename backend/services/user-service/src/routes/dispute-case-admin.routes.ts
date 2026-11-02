import { Router } from "express";
import { disputeCaseController as c } from "../controllers/dispute-case.controller";

/**
 * Dispute Case (slice 1), ADMIN side. Mounted INSIDE the admin router (admin.routes.ts), which already runs authMiddleware + roleMiddleware(["ADMIN"]);
 * the service repeats the ADMIN check, and each action also checks the assigned-investigator / four-eyes rules.
 * Mutating routes accept an `Idempotency-Key` header.
 */
const router = Router();

router.post("/", c.open);
router.get("/", c.list);
router.get("/:id", c.get);
router.post("/:id/assign", c.assign);
router.post("/:id/recollect", c.recollect);
router.post("/:id/transition", c.transition);
router.post("/:id/request-more", c.requestMore);
router.post("/:id/classify", c.classify);
router.post("/:id/claims", c.addClaim);
router.post("/:id/issues", c.addIssue);
router.post("/:id/assessments", c.addAssessment);
router.post("/:id/findings", c.recordFinding);
router.post("/:id/proposals", c.propose);
router.post("/:id/approvals", c.decide);
router.post("/:id/evidence-change-ack", c.acknowledgeEvidenceChange);
// D-NEW-12 (B-1 release gate): ONE contract per call (the case's own); no batch route, no list, no "all".
router.post("/:id/policy-eligibility", c.proposePolicyEligibility);
router.post("/:id/policy-eligibility/:reviewId/approve", c.approvePolicyEligibility);
router.post("/:id/shares", c.share);
// Slice 2 / S2.8: an ADMIN who is not a party reads a stored evidence file (logged). Flag-gated like the upload.
router.get("/:id/evidence/:evidenceId/file", c.evidenceFile);
// Slice 2 (flag-gated, fail-closed): execute the approved decision / reconcile an execution left half-way.
router.post("/:id/execute", c.execute);
router.post("/:id/reconcile-execution", c.reconcileExecution);

export default router;
