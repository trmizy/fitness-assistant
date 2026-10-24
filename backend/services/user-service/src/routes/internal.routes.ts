import { Router } from "express";
import { logger } from "@gym-coach/shared";
import { serviceSecretMiddleware } from "../middleware/serviceSecret.middleware";
import { contractController } from "../controllers/contract.controller";
import { profileService } from "../services/profile.service";
import { profileRepository } from "../repositories/profile.repository";
import { inbodyService } from "../services/inbody.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { notificationService } from "../services/notification.service";
import { pushService } from "../services/push.service";
import { contractRepository } from "../repositories/contract.repository";
import { sessionRepository } from "../repositories/session.repository";
import { vietnamDayRange } from "../utils/vi-datetime.util";
import { PtRestrictionError, getActiveRestriction, ptRestrictionService } from "../services/pt-restriction.service";
import { parsePtGymSessionsQuery, ptGymSessionsService } from "../services/pt-gym-sessions.service";
import gymBookedClientsRoutes from "./internal-gym-booked-clients.routes";

const router = Router();

// All routes under /internal are protected by service-secret. Not exposed to public via the gateway.
router.use(serviceSecretMiddleware);

// D15: lễ tân xem khách có lịch tập PT tại chi nhánh (chỉ id khách, chỉ đọc) - route nằm ở file riêng.
router.use("/gyms", gymBookedClientsRoutes);

/**
 * Parses the lock command auth-service relays. `seq` is auth-service's durable per-command number
 * (PtDeactivationCall.seq): without it the receiver cannot order this command against a later
 * unlock, so a body without one is refused rather than guessed at. `reason` is optional — the
 * admin screens do not send one yet — and stored as null when absent.
 */
function parseLockCommand(req: { params: { ptUserId: string }; body?: any }) {
  const { adminId, reason, seq } = req.body ?? {};
  if (seq === undefined || seq === null || !/^\d+$/.test(String(seq))) return null;
  return {
    ptUserId: req.params.ptUserId,
    adminId: typeof adminId === "string" && adminId ? adminId : "SYSTEM",
    reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null,
    seq: BigInt(String(seq)),
  };
}

/**
 * auth-service calls this right after an admin disables a PT's account: disabling only
 * blocked the login, leaving live contracts, booked sessions and a searchable profile
 * behind. Unwinds every open contract with a prorated refund and hides the PT.
 *
 * 200 means "nothing left for this command to do": every contract done, or the command was
 * superseded by a later one (`stale: true`). Anything else is an error status, so the relay keeps
 * the command FAILED and calls again; the body lists each contract's outcome either way.
 */
router.post("/pt/:ptUserId/deactivate", async (req, res) => {
  try {
    const cmd = parseLockCommand(req);
    if (!cmd) {
      res.status(400).json({ error: "seq (số thứ tự lệnh) là bắt buộc" });
      return;
    }
    const result = await ptDeactivationService.deactivatePT(cmd);
    if (!result.complete) {
      const pending = result.outcomes.filter((o) => o.status === "FAILED").length;
      res.status(500).json({ error: `${pending} hợp đồng chưa xử lý xong — cần thử lại`, ...result });
      return;
    }
    res.json(result);
  } catch (error: any) {
    logger.error(error, "PT deactivation failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Re-enabling the account lifts the discovery/booking block. Contracts are NOT restored.
 * A repeated unlock answers `duplicate: true`; one older than the last applied command answers
 * `stale: true` and changes nothing.
 */
router.post("/pt/:ptUserId/reactivate", async (req, res) => {
  try {
    const cmd = parseLockCommand(req);
    if (!cmd) {
      res.status(400).json({ error: "seq (số thứ tự lệnh) là bắt buộc" });
      return;
    }
    res.json(await ptDeactivationService.reactivatePT(cmd));
  } catch (error: any) {
    logger.error(error, "PT reactivation failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * The ONE internal read for "is this PT restricted right now, and how" — what gym-service's future
 * PT coaching check-in (and any other service) must ask before giving a PT coaching access:
 *   { ptUserId, restricted, type: TEMPORARY_SUSPENSION | PERMANENT_BAN | null, since, mayCoach, mayTakeNewBusiness,
 *     restrictedContractIds }
 * Reads only; the answer comes from the restriction record (a flag-only lock fails closed).
 *
 * `restricted` / `mayCoach` here are about the PT as a WHOLE (account restriction): a restriction on ONE
 * contract must not stop the PT teaching another client. For a check-in that is about a session of a
 * specific contract pass `?contractId=`: the answer then also carries { contractId, contractRestricted,
 * scope } and `mayCoach` is false when the account is restricted OR that contract is. A contractId that is
 * not this PT's answers 404 CONTRACT_NOT_FOUND.
 */
router.get("/pt/:ptUserId/restriction", async (req, res) => {
  try {
    const contractId = typeof req.query.contractId === "string" && req.query.contractId ? req.query.contractId : null;
    res.json(await ptRestrictionService.internalStatus(req.params.ptUserId, contractId));
  } catch (error: any) {
    if (error instanceof PtRestrictionError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    logger.error(error, "PT restriction read failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * PT QR check-in (Phase 2 / P2.1, D16 / D17 / D38 / D59 / D70) - READ-ONLY. gym-service asks, per scan, which of this PT's
 * face-to-face sessions at `gymId` touch the window [from, to) (the UTC instants of the local day, computed by gym-service):
 *   { ptUserId, gymId, ptActive, ptBlockedReason: null | PT_NOT_FOUND | NOT_A_PT | PT_ACCOUNT_RESTRICTED | PT_BANNED,
 *     sessions: [{ sessionId, contractId, status, scheduledStartAt, scheduledEndAt }] }
 * 400 INVALID_QUERY: gymId missing, from/to not ISO-8601 instants with a zone, from >= to, or a window over 48 h. No client
 * identity is returned and nothing is written - see pt-gym-sessions.service.ts for the exact rules.
 */
router.get("/pt/:ptUserId/gym-sessions", async (req, res) => {
  const q = parsePtGymSessionsQuery(req.query);
  if (!q.ok) {
    res.status(400).json({ error: q.error, code: "INVALID_QUERY" });
    return;
  }
  try {
    res.json(await ptGymSessionsService.list(req.params.ptUserId, q.gymId, q.from, q.to));
  } catch (error: any) {
    logger.error(error, "PT gym-sessions read failed");
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

// ai-service asks this before it starts a personalized-service checkout (BR-27: no second live contract with the
// same PT while one is requested, awaiting payment or running).
router.get(
  "/contracts/pair-conflict",
  contractController.hasStandingPtContract as any,
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
  // A PT who is restricted right now (temporarily suspended, or banned) is NOT offered for new business:
  // ai-service gates personalized-service publishing, browsing and purchase on this flag.
  const restriction = profile?.isPT === true ? await getActiveRestriction(req.params.userId) : null;
  const isApprovedPt = profile?.isPT === true && application?.status === "APPROVED" && restriction === null;

  res.json({
    userId: req.params.userId,
    isApprovedPt,
    ptRestricted: restriction !== null,
    ptRestrictionType: restriction?.type ?? null,
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

// Gymini Adaptive Roadmap Production Closure — bounded single-row lookup.
// A more specific path than /inbody/:userId above (an extra segment), so
// it never collides with that route's matching regardless of
// registration order. `before` is required — omitting it would just be
// "the latest ever", already served by GET /inbody/:userId/latest's
// sibling-less equivalent (fetchLatestInBodyOnOrBefore's own callers
// always have a real cutoff in hand).
router.get("/inbody/:userId/latest", async (req, res) => {
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  if (!before || Number.isNaN(before.getTime())) {
    res.status(400).json({ error: "Query param 'before' must be a valid ISO date" });
    return;
  }
  const entry = await inbodyService.getLatestOnOrBefore(req.params.userId, before);
  res.json(entry ?? null);
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

// Mobile E2/E3 — chat-service's realtime phone nudges (incoming call, new chat message). Push
// only: no notifications row (the bell list would drown, and the conversation already records
// both). Answers 202 at once; delivery is best-effort and never fails the caller.
router.post("/push", (req, res) => {
  const { userId, title, body, kind, link, data, tag, ttlSeconds } = req.body ?? {};
  const okData =
    data === undefined ||
    (data && typeof data === "object" && !Array.isArray(data) && Object.values(data).every((v) => typeof v === "string"));
  if (
    typeof userId !== "string" || !userId ||
    typeof title !== "string" || !title ||
    typeof body !== "string" || !body ||
    (kind !== "CALL" && kind !== "CHAT") ||
    !okData ||
    (tag !== undefined && typeof tag !== "string") ||
    (ttlSeconds !== undefined && (typeof ttlSeconds !== "number" || ttlSeconds <= 0))
  ) {
    res.status(400).json({ error: "userId, title, body, kind (CALL|CHAT) are required; data values must be strings" });
    return;
  }
  void pushService.sendRaw({
    userId,
    title: title.slice(0, 120),
    body: body.slice(0, 240),
    kind,
    link: typeof link === "string" ? link : null,
    data,
    tag,
    ttlSeconds,
  });
  res.status(202).json({ accepted: true });
});

// Phase 5 (quản lý đối tác phòng tập) — gym-service gọi trước khi cho admin xác nhận
// "Chấm dứt hợp tác", để hiện đúng số hợp đồng PT đang chạy tại các chi nhánh sắp bị ảnh
// hưởng (đặc tả: "không được để admin bấm chấm dứt mà không biết mình đang ảnh hưởng tới
// bao nhiêu người").
router.post("/contracts/count-active-by-gyms", async (req, res) => {
  const gymIds = req.body?.gymIds;
  if (!Array.isArray(gymIds)) {
    res.status(400).json({ error: "gymIds phải là một mảng" });
    return;
  }
  try {
    const count = await contractRepository.countActiveByGyms(gymIds);
    res.json({ count });
  } catch (error: any) {
    logger.error(error, "count-active-by-gyms failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * B30: the admin dashboard's "sessions today" KPI. Read-only; the gateway calls it with the service secret.
 * Counts coaching sessions that start today in Vietnam time (UTC+7), excluding cancelled and still-unanswered
 * (REQUESTED) ones. Answers { count, date } where date is the Vietnam day as YYYY-MM-DD.
 */
router.get("/admin/sessions/today-count", async (_req, res) => {
  try {
    const { start, end } = vietnamDayRange(new Date());
    const count = await sessionRepository.countScheduledBetween(start, end);
    const date = new Date(start.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    res.json({ count, date });
  } catch (error: any) {
    logger.error(error, "sessions today-count failed");
    res.status(500).json({ error: "Không đếm được số buổi tập hôm nay" });
  }
});

export default router;
