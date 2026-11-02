import { Router, type NextFunction, type Request, type Response } from "express";
import { lateOpenReconciliationEnabled } from "../services/dispute-case/flags";
import { lateOpenReconciliationController as c } from "../controllers/late-open-reconciliation.controller";

/**
 * Late-open reconciliation (final safety gate), ADMIN side. Mounted INSIDE the admin router (admin.routes.ts), which already runs authMiddleware + roleMiddleware(["ADMIN"]); the service repeats the
 * ADMIN check and the four-eyes rule. One row per call: there is no batch route. Mutating routes accept an `Idempotency-Key` header.
 */
const router = Router();

/** Fail-closed feature flag: with DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED not effective every MUTATING route answers 409 before the controller runs (reads stay open). */
function requireLateOpenReconciliationEnabled(_req: Request, res: Response, next: NextFunction) {
  if (lateOpenReconciliationEnabled()) return next();
  return res.status(409).json({ error: "Chức năng đối soát khoản bồi thường mở đang tắt", code: "LATE_OPEN_RECONCILIATION_DISABLED" });
}

router.get("/", c.list);
// proposal-level actions (three path segments) are declared before the row-level ones
router.post("/proposals/:proposalId/approve", requireLateOpenReconciliationEnabled, c.approve);
router.post("/proposals/:proposalId/reject", requireLateOpenReconciliationEnabled, c.reject);
router.post("/proposals/:proposalId/retry", requireLateOpenReconciliationEnabled, c.retry);
router.post("/proposals/:proposalId/recoveries", requireLateOpenReconciliationEnabled, c.openRecovery);
router.post("/recoveries/:recoveryId/approve", requireLateOpenReconciliationEnabled, c.approveRecovery);
router.post("/recoveries/:recoveryId/reject", requireLateOpenReconciliationEnabled, c.rejectRecovery);
router.get("/:rowId", c.get);
router.post("/:rowId/handover", requireLateOpenReconciliationEnabled, c.handover);
router.post("/:rowId/claim", requireLateOpenReconciliationEnabled, c.claim);
router.post("/:rowId/proposals", requireLateOpenReconciliationEnabled, c.propose);

export default router;
