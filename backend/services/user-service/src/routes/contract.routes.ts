import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { contractController } from "../controllers/contract.controller";

const router = Router();

/**
 * Money-flow redesign plan 2.3 — locks a route with zero real callers left anywhere in the
 * monorepo (frontend/web, backend services, scripts — audited in
 * legacy-contract-endpoints.test.ts's header comment) without deleting the controller/service
 * code behind it yet, per the plan's explicit "khoá endpoint cũ (410), chưa xoá" instruction.
 * 410 Gone rather than 404, so a caller who DOES still exist somewhere gets a clear signal this
 * was intentionally retired, not that the URL was mistyped.
 */
function gone(newPath: string) {
  return (_req: Request, res: Response) => {
    res.status(410).json({
      error: "GONE",
      message: `This endpoint was retired (money-flow redesign plan 2.3) — use ${newPath} instead.`,
    });
  };
}

// ── New contract request flow ─────────────────────────────────────
router.post(
  "/request",
  authMiddleware,
  contractController.requestContract as any,
);
router.patch(
  "/:id/accept",
  authMiddleware,
  contractController.acceptContract as any,
);
router.patch(
  "/:id/reject",
  authMiddleware,
  contractController.rejectContract as any,
);
router.patch(
  "/:id/cancel",
  authMiddleware,
  contractController.cancelContract as any,
);

// ── Relationship check (for call permission) ─────────────────────
router.get(
  "/check-relationship",
  authMiddleware,
  contractController.checkRelationship as any,
);

// ── PT earnings ───────────────────────────────────────────────────
router.get(
  "/pt/earnings",
  authMiddleware,
  contractController.getEarnings as any,
);

// ── PT endpoints ──────────────────────────────────────────────────
// Retired (money-flow plan 2.3) — zero real callers found; the PT-facing flow is entirely
// POST /contracts/request (client requests) now. contractController.create/contractService.create
// still exist, unreferenced by any route, kept for the follow-up cleanup pass.
router.post("/", authMiddleware, gone("POST /contracts/request"));
router.get("/pt", authMiddleware, contractController.getByPT as any);

// ── Client endpoints ──────────────────────────────────────────────
router.get("/client", authMiddleware, contractController.getByClient as any);

// ── E-sign endpoints (must be before /:id to avoid route conflict) ───
router.post(
  "/:id/esign/send",
  authMiddleware,
  contractController.sendESign as any,
);
router.get(
  "/:id/esign",
  authMiddleware,
  contractController.getESignStatus as any,
);
router.get(
  "/:id/pdf",
  authMiddleware,
  contractController.getContractPdf as any,
);

// ── Shared endpoints ──────────────────────────────────────────────
router.get("/:id", authMiddleware, contractController.getById as any);
// Retired (money-flow plan 2.3) — zero real callers; every status transition now has its own
// endpoint (accept/reject/cancel/terminate below), each with the reason-specific validation a
// generic "set any status" endpoint cannot enforce.
router.patch("/:id/status", authMiddleware, gone("PATCH /:id/accept, /:id/reject, /:id/cancel, or POST /:id/terminate"));
// Retired (money-flow plan 2.3) — zero real callers, and no supported replacement: editing a
// contract's description/notes/terms after creation is not currently exposed by any UI.
router.put("/:id", authMiddleware, gone("no replacement — contract details are not editable after creation"));
// Retired (money-flow plan 2.3) — the MOST dangerous of this group: it incremented
// usedSessions directly, bypassing the entire session lifecycle (booking, PT/client
// confirmation, and money release). Zero real callers found. The real flow is
// POST /sessions to book, then POST /sessions/:id/confirm.
router.post("/:id/session", authMiddleware, gone("POST /sessions, then POST /sessions/:id/confirm"));

// Phase 4 — client pays a PENDING_PAYMENT contract via wallet
router.post("/:id/pay", authMiddleware, contractController.pay as any);
// Roadmap P4.1 "Notifications/reminders" — PT-only, enforced service-side
// in contractService.sendFeedback (contract.ptUserId !== ptUserId -> 403).
router.post("/:id/feedback", authMiddleware, contractController.sendFeedback as any);

// Money view of a contract: what has been released, what is still pending, and what the
// client would get back if they cancelled right now. Read-only, both parties may see it.
router.get(
  "/:id/money-breakdown",
  authMiddleware,
  contractController.moneyBreakdown as any,
);

// End a contract and settle everyone. The reason selects the refund formula — see
// docs/money-flow.md — so it is required and validated server-side.
router.post(
  "/:id/terminate",
  authMiddleware,
  contractController.terminate as any,
);

export default router;
