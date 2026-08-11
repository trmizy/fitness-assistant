import { Router } from "express";
import { logger } from "@gym-coach/shared";
import { serviceSecretMiddleware } from "../middleware/serviceSecret.middleware";
import { contractController } from "../controllers/contract.controller";
import { profileService } from "../services/profile.service";
import { profileRepository } from "../repositories/profile.repository";
import { inbodyService } from "../services/inbody.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";

const router = Router();

// All routes under /internal are protected by service-secret. Not exposed to public via the gateway.
router.use(serviceSecretMiddleware);

/**
 * auth-service calls this right after an admin disables a PT's account: disabling only
 * blocked the login, leaving live contracts, booked sessions and a searchable profile
 * behind. Unwinds every open contract with a prorated refund and hides the PT.
 */
router.post("/pt/:ptUserId/deactivate", async (req, res) => {
  try {
    const { adminId, reason } = req.body ?? {};
    const result = await ptDeactivationService.deactivatePT(
      req.params.ptUserId,
      adminId || "SYSTEM",
      reason,
    );
    res.json(result);
  } catch (error: any) {
    logger.error(error, "PT deactivation failed");
    res.status(500).json({ error: error.message });
  }
});

/** Re-enabling the account lifts the discovery/booking block. Contracts are NOT restored. */
router.post("/pt/:ptUserId/reactivate", async (req, res) => {
  try {
    const found = await ptDeactivationService.setPtSuspended(
      req.params.ptUserId,
      false,
    );
    res.json({ reactivated: found });
  } catch (error: any) {
    logger.error(error, "PT reactivation failed");
    res.status(500).json({ error: error.message });
  }
});

/** Contracts that would block winding a PT down — powers the resign-PT precondition. */
router.get("/pt/:ptUserId/blocking-contracts", async (req, res) => {
  try {
    res.json(
      await ptDeactivationService.findBlockingContracts(req.params.ptUserId),
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chat-service calls this to decide whether a (from, to) pair can chat.
// Implements BR-29 (loosened): client → APPROVED PT discovery chat is allowed even without contract.
router.get("/chat-eligibility", contractController.chatEligibility as any);

// ai-service calls this to verify that a contractId belongs to the given client and is ACTIVE.
// Returns { ptUserId, contractId } or { ptUserId: null }.
router.get(
  "/contracts/active-pt",
  contractController.getActivePTForClient as any,
);

// ai-service workers run without an end-user bearer token. These read-only
// endpoints expose the same user-owned context after service-secret validation.
router.get("/profile/:userId", async (req, res) => {
  const result = await profileService.getProfile(req.params.userId);
  res.json(result);
});

router.get("/inbody/:userId", async (req, res) => {
  const history = await inbodyService.getHistory(req.params.userId);
  res.json(history);
});

// gym-service resolves a client's typed referral code to a PT userId here at membership
// purchase time (money-flow plan §2.1). A miss is a plain 404, not an error — an invalid
// code is an ordinary user-input case the caller must surface, not fail on.
router.get("/profile/by-referral-code/:code", async (req, res) => {
  const profile = await profileRepository.findByReferralCode(req.params.code);
  if (!profile) {
    res.status(404).json({ error: "REFERRAL_CODE_NOT_FOUND" });
    return;
  }
  res.json({ userId: profile.userId });
});

// Phase 4 — payment-service calls these after wallet-transfer PAID / refund reversal.
// Both are idempotent and verify the transaction against payment-service before mutating.
router.post(
  "/contracts/:id/activate-after-payment",
  contractController.activateAfterPayment as any,
);
router.post(
  "/contracts/:id/cancel-after-refund",
  contractController.cancelAfterRefund as any,
);

export default router;
