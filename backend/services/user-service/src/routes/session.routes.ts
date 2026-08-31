import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { bookingController } from "../controllers/booking.controller";

const router = Router();

// ── Booking ──────────────────────────────────────────────────────────
router.post("/", authMiddleware, bookingController.bookSession as any);
router.get("/upcoming", authMiddleware, bookingController.getMyUpcoming as any);
router.get(
  "/pending-confirmation",
  authMiddleware,
  bookingController.listPendingConfirmation as any,
);
// Money-flow plan 4.3 — PT's side: sessions a client reported them as a no-show for.
router.get(
  "/no-show-reports",
  authMiddleware,
  bookingController.listNoShowReportsForPT as any,
);
router.get(
  "/contract/:contractId",
  authMiddleware,
  bookingController.getContractSessions as any,
);
router.get("/:id", authMiddleware, bookingController.getSessionById as any);

// ── Session actions ──────────────────────────────────────────────────
router.post("/:id/join", authMiddleware, bookingController.joinSession as any);
router.patch(
  "/:id/confirm",
  authMiddleware,
  bookingController.confirmSession as any,
);
router.patch(
  "/:id/complete",
  authMiddleware,
  bookingController.completeSession as any,
);
router.patch(
  "/:id/cancel",
  authMiddleware,
  bookingController.cancelSession as any,
);
router.patch(
  "/:id/no-show",
  authMiddleware,
  bookingController.markNoShow as any,
);
// Client-side settlement of a PT-reported session. POST (not the PT's PATCH /:id/confirm,
// which is the separate "PT accepts the booking" step) — same path, different actor and
// different point in the lifecycle.
router.post(
  "/:id/confirm",
  authMiddleware,
  bookingController.clientConfirmSession as any,
);
router.post(
  "/:id/dispute",
  authMiddleware,
  bookingController.disputeSession as any,
);
// Money-flow plan 4.3 — client reports the PT never showed up, and the PT's response to it.
router.post(
  "/:id/report-no-show",
  authMiddleware,
  bookingController.reportPtNoShow as any,
);
router.post(
  "/:id/respond-no-show",
  authMiddleware,
  bookingController.respondToNoShowReport as any,
);
router.post(
  "/:id/review",
  authMiddleware,
  bookingController.reviewSession as any,
);
// Mirror-image of the route above — PT rates the client instead of the client rating the PT.
router.post(
  "/:id/review-client",
  authMiddleware,
  bookingController.reviewClient as any,
);
router.post(
  "/:id/reschedule",
  authMiddleware,
  bookingController.requestReschedule as any,
);
// This handles responding to a reschedule request (we use the reschedule request ID here)
router.post(
  "/reschedules/:id/respond",
  authMiddleware,
  bookingController.respondToReschedule as any,
);

// The requester withdraws their own proposal (VĐ4).
router.delete(
  "/reschedules/:id",
  authMiddleware,
  bookingController.cancelReschedule as any,
);

// Full proposal history for a session — who moved it, when, and why.
router.get(
  "/:id/reschedule-history",
  authMiddleware,
  bookingController.rescheduleHistory as any,
);

export default router;
