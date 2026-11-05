import { Router, type NextFunction, type Request, type Response } from "express";
import { decisionReplacementEnabled } from "../services/dispute-case/flags";
import { decisionReplacementController as c } from "../controllers/dispute-case-replacement.controller";

/**
 * A4: replacement of an approved Case decision that has had no effect. Mounted INSIDE the admin router (admin.routes.ts) at /dispute-cases/:caseId/replacements, BEFORE the dispute-cases router, which
 * already runs authMiddleware + roleMiddleware(["ADMIN"]). One case per call.
 */
const router = Router({ mergeParams: true });

/** Fail-closed feature flag: while DISPUTE_CASE_DECISION_REPLACEMENT_ENABLED is not effective EVERY mutating route answers 409 before the controller runs (retries included). Reads stay open. */
function requireEnabled(_req: Request, res: Response, next: NextFunction) {
  if (decisionReplacementEnabled()) return next();
  return res.status(409).json({ error: "Chức năng thay thế quyết định đã duyệt đang tắt", code: "DECISION_REPLACEMENT_DISABLED" });
}

router.get("/", c.list);
router.post("/", requireEnabled, c.propose);
router.post("/:replacementId/approve", requireEnabled, c.approve);
router.post("/:replacementId/reject", requireEnabled, c.reject);

export default router;
