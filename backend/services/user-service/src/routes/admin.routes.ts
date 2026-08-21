import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { bookingController } from "../controllers/booking.controller";

const router = Router();

// Everything here is admin-only. The gateway also gates /admin/* by role; this is the
// service-side check so the rule holds even if something reaches the service directly.
router.use(authMiddleware, roleMiddleware(["ADMIN"]));

// ── Disputed sessions (VĐ2) ──────────────────────────────────────────
router.get("/sessions/disputed", bookingController.listDisputed as any);
router.post("/sessions/:id/resolve", bookingController.resolveDispute as any);

export default router;
