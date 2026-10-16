import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { contractReadController } from "../controllers/contract-read.controller";

/**
 * Phase 3 (P3.4 / P3.5) - read-only contract endpoints. Mounted from contract.routes.ts BEFORE its
 * `/:id` route, so `/gym-options` is not swallowed as a contract id.
 */
const router = Router();

router.get("/gym-options", authMiddleware, contractReadController.gymOptions as any);
router.get("/:id/checkout-context", authMiddleware, contractReadController.checkoutContext as any);

export default router;
