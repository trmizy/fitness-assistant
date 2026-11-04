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
// Fixed paths BEFORE "/:id".
router.get("/queue", c.queue);
router.get("/capabilities", c.capabilities);
router.get("/contracts/:contractId/policy-eligibility", c.policyReviewsOfContract);
// D-NEW-12 contract-level review (NO Case needed), four-eyes, references resolved by the server; and the read-only classifier (never unlocks a ruling).
router.post("/contracts/:contractId/policy-eligibility", c.proposeContractPolicy);
router.post("/contracts/:contractId/policy-eligibility/:reviewId/approve", c.approveContractPolicy);
router.get("/contracts/:contractId/policy-classification", c.classifyContractPolicy);
router.get("/:id", c.get);
router.get("/:id/access-log", c.accessLog);
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
router.get("/:id/policy-eligibility", c.policyReviewsOfCase);
router.post("/:id/policy-eligibility", c.proposePolicyEligibility);
router.post("/:id/policy-eligibility/:reviewId/approve", c.approvePolicyEligibility);
router.post("/:id/shares", c.share);
// Slice 2 / S2.8: an ADMIN who is not a party reads a stored evidence file (logged). Flag-gated like the upload.
router.get("/:id/evidence/:evidenceId/file", c.evidenceFile);
// Slice 2 (flag-gated, fail-closed): execute the approved decision / reconcile an execution left half-way.
router.post("/:id/execute", c.execute);
router.post("/:id/reconcile-execution", c.reconcileExecution);
// Backend completion: a NEEDS_HUMAN execution acknowledged by a person (moves no money; stays locked unless the decision is already applied), and the two ways to close a
// case WITHOUT a decision (orphan: its session left dispute; a not-a-dispute finding). Neither moves money.
router.post("/:id/acknowledge-needs-human", c.acknowledgeNeedsHuman);
router.post("/:id/close-orphan", c.closeOrphan);
router.post("/:id/close-not-a-dispute", c.closeNotADispute);
router.post("/:id/close-executed", c.closeExecuted);

export default router;
