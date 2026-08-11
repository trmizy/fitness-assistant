import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { contractController } from "../controllers/contract.controller";

const router = Router();

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
router.post("/", authMiddleware, contractController.create as any);
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
router.patch(
  "/:id/status",
  authMiddleware,
  contractController.updateStatus as any,
);
router.put("/:id", authMiddleware, contractController.update as any);
router.post(
  "/:id/session",
  authMiddleware,
  contractController.logSession as any,
);

// Phase 4 — client pays a PENDING_PAYMENT contract via wallet
router.post("/:id/pay", authMiddleware, contractController.pay as any);

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
