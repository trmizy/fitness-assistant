import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { bookingController } from "../controllers/booking.controller";
import { ptRestrictionController } from "../controllers/pt-restriction.controller";

const router = Router();

// Everything here is admin-only. The gateway also gates /admin/* by role; this is the
// service-side check so the rule holds even if something reaches the service directly.
router.use(authMiddleware, roleMiddleware(["ADMIN"]));

// ── Disputed sessions (VĐ2) ──────────────────────────────────────────
router.get("/sessions/disputed", bookingController.listDisputed as any);
router.post("/sessions/:id/resolve", bookingController.resolveDispute as any);

// ── Temporary PT suspension (contracts are NOT touched; see pt-restriction.service.ts) ──────────
// The literal /pts/suspended is declared before the parameterised paths, though no parameterised path
// is a single segment after /pts/ so they cannot shadow it. The acting admin is req.user.id.
router.get("/pts/suspended", ptRestrictionController.listSuspended as any);
router.post("/pts/:ptUserId/suspend", ptRestrictionController.suspend as any);
router.post("/pts/:ptUserId/lift-suspension", ptRestrictionController.lift as any);
router.post("/pts/:ptUserId/restrictions/justify", ptRestrictionController.justify as any);
router.get("/pts/:ptUserId/restrictions", ptRestrictionController.history as any);
// CONTRACT scope: restrict / lift ONE contract of the PT, and change the scope of a restriction (raise / narrow).
router.post("/pts/:ptUserId/contracts/:contractId/restrict", ptRestrictionController.restrictContract as any);
router.post("/pts/:ptUserId/contracts/:contractId/lift-restriction", ptRestrictionController.liftContract as any);
router.post("/pts/:ptUserId/restrictions/change-scope", ptRestrictionController.changeScope as any);

export default router;
