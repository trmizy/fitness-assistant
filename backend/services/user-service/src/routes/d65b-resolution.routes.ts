import { Router, type NextFunction, type Request, type Response } from "express";
import { d65bResolutionEnabled } from "../services/dispute-case/flags";
import { d65bResolutionController as c } from "../controllers/d65b-resolution.controller";

/**
 * D65-B admin resolution of the money held for a NO_SHOW session. Mounted INSIDE the admin router (admin.routes.ts), which already runs authMiddleware + roleMiddleware(["ADMIN"]); the service repeats
 * the ADMIN check, the conflict-of-interest check and the four-eyes rule. One session per call; there is no batch route.
 */
const router = Router();

/** Fail-closed feature flag: with DISPUTE_CASE_D65B_RESOLUTION_ENABLED not effective EVERY mutating route answers 409 before the controller runs - retries and resumes included. Reads stay open. */
function requireD65bEnabled(_req: Request, res: Response, next: NextFunction) {
  if (d65bResolutionEnabled()) return next();
  return res.status(409).json({ error: "Chức năng giải quyết khoản đang giữ của buổi PT vắng đang tắt", code: "D65B_RESOLUTION_DISABLED" });
}

router.get("/", c.list);
router.get("/sessions/:sessionId", c.getBySession);
router.post("/sessions/:sessionId/proposals", requireD65bEnabled, c.propose);
router.get("/:id", c.get);
router.post("/:id/approve", requireD65bEnabled, c.approve);
router.post("/:id/reject", requireD65bEnabled, c.reject);
router.post("/:id/handover", requireD65bEnabled, c.handover);

export default router;
