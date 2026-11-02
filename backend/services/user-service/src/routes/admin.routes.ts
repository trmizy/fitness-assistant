import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { bookingController } from "../controllers/booking.controller";
import { ptRestrictionController } from "../controllers/pt-restriction.controller";
import { adminReconciliationController } from "../controllers/admin-reconciliation.controller";
import adminPtListingRoutes from "./admin-pt-listing.routes";
import disputeCaseAdminRoutes from "./dispute-case-admin.routes";
import lateOpenReconciliationRoutes from "./late-open-reconciliation.routes";
import d65bResolutionRoutes from "./d65b-resolution.routes";

const router = Router();

// Everything here is admin-only. The gateway also gates /admin/* by role; this is the
// service-side check so the rule holds even if something reaches the service directly.
router.use(authMiddleware, roleMiddleware(["ADMIN"]));

// ── Disputed sessions (VĐ2) ──────────────────────────────────────────
router.get("/sessions/disputed", bookingController.listDisputed as any);
// FH-4: read-only money reconciliation report (settlement rows needing a person, unconfirmed endings, disputes by SLA age).
router.get("/sessions/reconciliation", roleMiddleware(["ADMIN"]), adminReconciliationController.get as any);
router.post("/sessions/:id/resolve", bookingController.resolveDispute as any);

// ── Dispute Case (slice 1): investigation file of a disputed session. Records and decides; executes nothing (see dispute-case.service.ts). ──
router.use("/dispute-cases", disputeCaseAdminRoutes);

// ── Late-open reconciliation (final safety gate): the four-eyes way out for a D77-OPEN step of an ORDINARY session (no Case, no policy review). Never touches the dispute-case tables. ──
router.use("/late-open-reconciliations", lateOpenReconciliationRoutes);

// ── D65-B: four-eyes admin resolution of the money HELD for one NO_SHOW session (its refund was never paid, the contract ended). Only NOT_DELIVERED, only to the client. ──
router.use("/unconfirmed-session-resolutions", d65bResolutionRoutes);

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

// ── Listing management: review queue, decisions, direct edits and photo retire for trainers ──────────────────
// (the gym side mounts its own /listings/gyms in gym-service).
router.use("/listings/pts", adminPtListingRoutes);

export default router;
