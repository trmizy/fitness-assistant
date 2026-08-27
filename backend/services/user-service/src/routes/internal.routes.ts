import { Router } from "express";
import { logger } from "@gym-coach/shared";
import { serviceSecretMiddleware } from "../middleware/serviceSecret.middleware";
import { contractController } from "../controllers/contract.controller";
import { profileService } from "../services/profile.service";
import { profileRepository } from "../repositories/profile.repository";
import { inbodyService } from "../services/inbody.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { notificationService } from "../services/notification.service";

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

// fitness-service calls this before every PT/coach client-data or
// plan-assignment request (Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md).
router.get(
  "/contracts/active-relationship",
  contractController.checkActivePtClientRelationship as any,
);

// ai-service calls this right after a Marketplace Personalized PT Service
// purchase is paid, to create the ACTIVE Contract that the whole existing
// PT-client authorization surface (coach.service.ts, chat eligibility) is
// keyed on — see ContractSource.MARKETPLACE's schema comment.
router.post(
  "/contracts/marketplace",
  contractController.createMarketplaceContract as any,
);

// ai-service workers run without an end-user bearer token. These read-only
// endpoints expose the same user-owned context after service-secret validation.
router.get("/profile/:userId", async (req, res) => {
  const result = await profileService.getProfile(req.params.userId);
  res.json(result);
});

router.get("/pt-marketplace-eligibility/:userId", async (req, res) => {
  const profile = await profileRepository.findPtMarketplaceEligibilityByUserId(req.params.userId);
  const application = profile?.ptApplication ?? null;
  const isApprovedPt = profile?.isPT === true && application?.status === "APPROVED";

  res.json({
    userId: req.params.userId,
    isApprovedPt,
    isPT: profile?.isPT === true,
    ptApplicationStatus: application?.status ?? null,
    approvedAt: application?.approvedAt ?? null,
    displayName: profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null : null,
    mainSpecialties: application?.mainSpecialties ?? [],
    yearsOfExperience: application?.yearsOfExperience ?? null,
    professionalBio: application?.professionalBio ?? null,
  });
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

// Gym-onboarding project — fitness-service calls this after every write to
// its normalized UserEquipment table, to keep UserProfile.availableEquipment
// (this service, legacy free-text field still read by the AI coach chat's
// advisory prompt/regex-based routine builder) in sync WITHOUT relying on
// frontend code remembering to update both. UserEquipment stays the single
// canonical source of truth for equipment availability; this is a
// backend-to-backend sync of the read-only compatibility copy, never the
// other way around.
router.put("/profile/:userId/available-equipment", async (req, res) => {
  const { availableEquipment } = req.body as { availableEquipment?: unknown };
  if (!Array.isArray(availableEquipment) || !availableEquipment.every((v) => typeof v === "string")) {
    res.status(400).json({ error: "availableEquipment must be an array of strings" });
    return;
  }
  const result = await profileService.upsertProfile(req.params.userId, { availableEquipment });
  res.json(result);
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

// Roadmap P4.1 "Notifications/reminders" (§27) — fitness-service calls
// this to persist a real, listable notification (never had a write path
// into this table before — see notification.client.ts's own doc comment
// in fitness-service for the disclosed gap this closes). Reuses
// notificationService.create UNCHANGED — same preference-gating,
// same real-time push, as every other notification source in this app.
router.post("/notifications", async (req, res) => {
  const { userId, text, eventType, entityType, entityId, link } = req.body ?? {};
  if (!userId || !text || !eventType || !entityType || !entityId) {
    res.status(400).json({ error: "userId, text, eventType, entityType, entityId are required" });
    return;
  }
  try {
    const notification = await notificationService.create({ userId, text, eventType, entityType, entityId, link });
    res.json({ notification });
  } catch (error: any) {
    logger.error(error, "Internal notification create failed");
    res.status(500).json({ error: error.message });
  }
});

export default router;
