import { randomUUID } from "crypto";
import { logger } from "@gym-coach/shared";
import {
  AuditEntityType,
  ContractStatus,
  ContractSource,
  PackageType,
  SessionMode,
  Prisma,
  SessionSettlementKind,
} from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { profileRepository } from "../repositories/profile.repository";
import { enrichProfilesWithAuthNames } from "./profile.service";
import { notificationService } from "./notification.service";
import { eSignService } from "./esign.service";
import { generateContractPdf } from "./contractPdf.service";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { availabilityService } from "./availability.service";
import { auditService } from "./audit.service";
import { terminateContractMoney } from "./contract-payout.service";
import { settleTracked } from "./session-settlement.service";

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/**
 * Money-flow plan 1.5 — the single shared formula for "how many sessions does this contract
 * still owe". `totalSessions` (purchasedSessions in the plan's naming) is immutable once
 * signed; `usedSessions` counts sessions the client actually trained (or was charged for by
 * cancelling late); `compensatedSessions` counts PT no-shows the client was already paid cash
 * for. Every caller — the completion check below, the booking quota gate in booking.service.ts
 * — must go through this instead of re-deriving it, so a data model change only has to update
 * arithmetic in one place.
 */
export interface SessionAccounting {
  totalSessions: number;
  usedSessions: number;
  compensatedSessions: number;
}

export function getRemainingEntitlements(contract: SessionAccounting): number {
  const consumed = contract.usedSessions + contract.compensatedSessions;
  return Math.max(0, contract.totalSessions - consumed);
}

/** Collaborators of {@link contractService.checkAndCompleteContract}, injectable so the
 * money-flow plan 1.2 fix (natural completion must settle money) is testable without a DB
 * or an HTTP call — same pattern as `QuotaDeps` in booking.service.ts. */
export interface CompleteContractDeps {
  findById: (id: string) => Promise<
    ({ id: string; status: ContractStatus } & SessionAccounting) | null
  >;
  updateStatus: (id: string, status: ContractStatus, extra: { completedAt: Date }) => Promise<unknown>;
  settleMoney: (id: string, reason: "COMPLETED") => Promise<unknown>;
}

const defaultCompleteContractDeps: CompleteContractDeps = {
  findById: (id) => contractRepository.findById(id),
  updateStatus: (id, status, extra) => contractRepository.updateStatus(id, status, extra),
  // Money-flow plan 1.6: tracked, because by the time this runs updateStatus has already
  // committed the contract to COMPLETED — there is no going back to retry a failed settlement
  // through any status-gated endpoint, so the sweep is the only path left for it.
  settleMoney: (id, reason) =>
    settleTracked(
      { kind: SessionSettlementKind.CONTRACT_TERMINATION, idempotencyKey: `CONTRACT_TERMINATE:${id}`, contractId: id, reason },
      () => terminateContractMoney(id, reason),
    ),
};

/** The subset of a PTServicePackage a contract copies. */
export interface SnapshotSource {
  id: string;
  name: string;
  sessionCount: number;
  price: Prisma.Decimal | number | string;
  sessionMode: SessionMode;
  sessionDurationMinutes: number;
  /** Money-flow plan 3.6: null = no expiry, matching the package's own field. */
  validityDays?: number | null;
}

export interface PackageSnapshot {
  packageId: string;
  packageName: string;
  packageSourceName: string;
  totalSessions: number;
  price: number;
  sessionMode: SessionMode;
  sessionDurationMinutes: number;
  validityDays: number | null;
}

/**
 * Copy a package's commercial terms onto a contract.
 *
 * Takes ONLY the package. That is the security property, not a style choice: the client's
 * request body is the one place these values must never come from, because a caller who can
 * name their own `price` buys a ten-session package for a đồng. Keeping the request out of
 * this function's signature means no future edit can quietly start trusting it.
 *
 * It is also a copy, not a reference. The PT may reprice or archive the package tomorrow;
 * a contract already signed is unaffected — the same rule the revenue split follows
 * (docs/money-flow.md §12).
 *
 * `price` is narrowed to a JS number because that is what the contract repository takes.
 * Safe here rather than by luck: the column is Decimal(14,2), so the largest representable
 * value is 10^12 with two decimals — 10^14 in minor units, well inside the 2^53 integers a
 * double represents exactly. Arithmetic on money still belongs in payment-service, in
 * Decimal; this is a verbatim carry-across, not a calculation.
 */
export function buildPackageSnapshot(pkg: SnapshotSource): PackageSnapshot {
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    packageSourceName: pkg.name,
    totalSessions: pkg.sessionCount,
    price: Number(pkg.price),
    sessionMode: pkg.sessionMode,
    sessionDurationMinutes: pkg.sessionDurationMinutes,
    validityDays: pkg.validityDays ?? null,
  };
}

/**
 * Record a contract changing state, with the state it came from.
 *
 * The "from" half is what makes the row useful: "cancelled" alone leaves open whether the
 * client walked away from an active contract they had paid for or declined one that was
 * still awaiting signature — two very different arguments to settle.
 */
async function auditContractStatus(
  actorUserId: string,
  contractId: string,
  from: ContractStatus,
  to: ContractStatus,
  extra?: Record<string, unknown>,
): Promise<void> {
  await auditService.record({
    actorUserId,
    action: `CONTRACT_${to}`,
    entityType: AuditEntityType.CONTRACT,
    entityId: contractId,
    metadata: { from, to, ...extra },
  });
}

/**
 * The other party on each contract, keyed by userId, always nameable.
 *
 * Two gaps have to be closed or the UI ends up showing a raw UUID where a person belongs:
 * a UserProfile row is created lazily (a client who never opened the profile screen has
 * none), and even an existing row usually has null firstName/lastName/email because the
 * identity of record lives in auth-service. So stub the missing rows, then enrich the lot.
 */
async function counterpartyProfiles(
  userIds: string[],
): Promise<Map<string, any>> {
  const ids = [...new Set(userIds)];
  const rows = await profileRepository.findByUserIds(ids);
  const byId = new Map<string, any>(rows.map((p) => [p.userId, p as any]));
  for (const id of ids) {
    if (!byId.has(id)) {
      byId.set(id, {
        userId: id,
        firstName: null,
        lastName: null,
        email: null,
      });
    }
  }
  await enrichProfilesWithAuthNames([...byId.values()]);
  return byId;
}

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001";
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || "";

// Money-flow plan 5.2: e-signing is paused as a settled product decision (docs/money-flow.md's
// scope section), set to "false" in docker-compose.dev.yml — not a temporary testing bypass
// anymore. When off, a contract goes straight from PENDING_REVIEW to PENDING_PAYMENT on
// PT-accept, the same destination the signing webhook would otherwise lead to. The Dropbox
// Sign integration itself is untouched (its webhook route is unregistered instead — see
// app.ts — while this flag is off, rather than left reachable with unverified signatures).
const REQUIRE_CONTRACT_ESIGN = process.env.REQUIRE_CONTRACT_ESIGN !== "false";

/** Fire-and-forget: a notification email must never fail the flow that triggered it. */
async function sendConfirmationEmail(to: string, subject: string, text: string): Promise<void> {
  try {
    const { default: axios } = await import("axios");
    await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/send-email`,
      { to, subject, text },
      { headers: { "x-service-secret": INTERNAL_SERVICE_SECRET }, timeout: 5000 },
    );
  } catch (e: any) {
    logger.error({ to, err: e?.message }, "Failed to send contract confirmation email");
  }
}

async function getUserInfo(userId: string): Promise<{
  email: string;
  firstName: string | null;
  lastName: string | null;
} | null> {
  try {
    const { default: axios } = await import("axios");
    const { data } = await axios.get(
      `${AUTH_SERVICE_URL}/auth/internal/users/${userId}`,
      {
        headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
        timeout: 3000,
      },
    );
    const u = data?.user;
    if (!u?.email) return null;
    return {
      email: u.email,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
    };
  } catch (e: any) {
    const status = e?.response?.status;
    if (status !== 404) {
      logger.warn(
        { status, code: e?.code },
        "getUserInfo: auth-service lookup failed",
      );
    }
    return null;
  }
}

function fullName(
  info: { firstName: string | null; lastName: string | null } | null,
  fallback: string,
): string {
  if (!info) return fallback;
  return [info.firstName, info.lastName].filter(Boolean).join(" ") || fallback;
}

/**
 * Best-effort check whether a user is active (auth.users.isActive).
 * Returns `true` if the column does not yet exist (pre-migration) or if auth
 * is unreachable — i.e. fail-open for compatibility, but log so admins notice.
 * After the migration BUG-002 lands, this becomes the source of truth.
 */
async function isUserActive(userId: string): Promise<boolean> {
  try {
    const { default: axios } = await import("axios");
    const { data } = await axios.get(
      `${AUTH_SERVICE_URL}/auth/internal/users/${userId}`,
      {
        headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
        timeout: 3000,
      },
    );
    const u = data?.user;
    if (!u) return true;
    if (typeof u.isActive === "boolean") return u.isActive;
    return true; // pre-migration: treat as active
  } catch {
    return true; // fail-open; alternative would block everything on auth outage
  }
}

export const contractService = {
  // ── Client requests a contract with a PT ─────────────────────────
  //
  // SECURITY: price and totalSessions are NOT accepted from the client.
  // They are read from PTServicePackage and snapshotted into the contract.
  // Accepting these from the client is a classic price-manipulation vulnerability.
  async requestContract(
    clientUserId: string,
    data: {
      ptUserId: string;
      /** ID of the PTServicePackage the client selected. Replaces the old price/totalSessions fields. */
      packageId: string;
      clientMessage?: string;
      /** The gym the client picked on the "where do you train?" step, if any. */
      gymId?: string;
      /**
       * When true, the client has seen and acknowledged the low-availability warning.
       * Required when availableSlotsNext28Days < package.sessionCount.
       */
      acknowledgedLowAvailability?: boolean;
    },
  ) {
    // 1. Load the package (source of truth for price/sessions/mode)
    //
    // Guard the id before it reaches Prisma: findUnique({ where: { id: undefined } }) is a
    // validation error, not a miss, so a request that simply forgot packageId surfaced as a
    // 500 with a raw Prisma stack instead of telling the caller what was wrong.
    if (!data.packageId) throw err("Thiếu packageId — hãy chọn gói dịch vụ", 400);
    const pkg = await ptServicePackageRepository.findById(data.packageId);
    if (!pkg) throw err("Gói dịch vụ không tồn tại", 404);
    if (!pkg.isActive || pkg.archivedAt) throw err("Gói dịch vụ này đã ngừng bán", 422);
    if (pkg.ptUserId !== data.ptUserId)
      throw err("Gói dịch vụ không thuộc PT này", 400);

    // 2. Check PT profile
    const ptProfile = await profileRepository.findByUserId(data.ptUserId);
    if (!ptProfile || !ptProfile.isPT)
      throw err("PT không tồn tại hoặc chưa được duyệt", 404);
    if (ptProfile.ptSuspended)
      throw err("PT đang bị tạm ngưng, không thể tạo hợp đồng", 422);
    if (!(ptProfile as any).isAcceptingClients)
      throw err("PT hiện đang tạm ngưng nhận khách mới", 422);

    // 3. Slot availability warning (L3 from plan)
    //    Count available slots; if fewer than package.sessionCount, require acknowledgement.
    const availableSlots = await availabilityService.countAvailableSlotsForPT(
      data.ptUserId,
      pkg.sessionDurationMinutes,
    );
    if (availableSlots < pkg.sessionCount && !data.acknowledgedLowAvailability) {
      // Nearest opening, so the warning has a next step instead of just a number. Only
      // computed on this already-slow-path — the happy path above never pays for it.
      const nearestAvailableSlot = await availabilityService.findEarliestAvailableSlot(
        data.ptUserId,
        pkg.sessionDurationMinutes,
      );
      // Return 409 with machine-readable code — NOT a successful contract creation.
      // The client UI shows a warning dialog and re-submits with acknowledgedLowAvailability=true.
      throw Object.assign(
        new Error("LOW_AVAILABILITY"),
        {
          status: 409,
          code: "LOW_AVAILABILITY",
          availableSlots,
          packageSessions: pkg.sessionCount,
          nearestAvailableSlot,
        },
      );
    }

    // 4. Resolve revenue split BEFORE any DB write — money-flow plan §1.4/B1.
    let rates: { platformRate: string; ptRate: string; gymRate: string };
    let source: ContractSource = ContractSource.INDEPENDENT;
    if (data.gymId) {
      if (pkg.sessionMode === SessionMode.ONLINE) {
        throw err(
          "Buổi tập trực tuyến không thể gắn với phòng gym cụ thể — chọn hình thức Offline hoặc bỏ chọn phòng gym",
          400,
        );
      }
      let collab;
      try {
        collab = await gymClient.getActiveCollaboration(data.gymId, data.ptUserId);
      } catch (e) {
        if (e instanceof GymServiceUnavailableError) {
          throw err(
            "Không thể xác nhận thoả thuận hợp tác với phòng gym lúc này, vui lòng thử lại",
            503,
          );
        }
        throw e;
      }
      if (!collab) {
        throw err(
          "PT chưa có thoả thuận hợp tác với phòng gym này — không thể tạo hợp đồng qua phòng gym",
          400,
        );
      }
      rates = { platformRate: collab.platformRate, ptRate: collab.ptRate, gymRate: collab.gymRate };
      source = ContractSource.GYM;
    } else {
      rates = { platformRate: "0.10", ptRate: "0.90", gymRate: "0" };
    }

    // 5. No duplicate active/pending contract with same PT (BR-27)
    const existing = await contractRepository.findActiveByPair(data.ptUserId, clientUserId);
    if (existing) {
      throw err("You already have an active or pending contract with this PT", 409);
    }

    // 6. Create contract — price/sessions/mode come from the PACKAGE SNAPSHOT, not from
    //    the client request. This is the security-critical step.
    const snapshot = buildPackageSnapshot(pkg);
    const contract = await contractRepository.create({
      ptUserId: data.ptUserId,
      clientUserId,
      status: ContractStatus.PENDING_REVIEW,
      packageType: PackageType.PACKAGE,
      // Snapshot fields — same principle as the revenue split above. Note what is NOT here:
      // anything out of `data`. Price and session count come from the package alone.
      packageName: snapshot.packageName,
      totalSessions: snapshot.totalSessions,
      price: snapshot.price,
      sessionMode: snapshot.sessionMode,
      clientMessage: data.clientMessage,
      gymId: data.gymId,
      source,
      platformRate: rates.platformRate,
      ptRate: rates.ptRate,
      gymRate: rates.gymRate,
      // Package audit trail + slot warning evidence
      ...({
        packageId: snapshot.packageId,
        packageSourceName: snapshot.packageSourceName,
        sessionDurationMinutes: snapshot.sessionDurationMinutes,
        validityDays: snapshot.validityDays,
        lowAvailabilityWarned: availableSlots < pkg.sessionCount,
        slotsAtPurchase: availableSlots < pkg.sessionCount ? availableSlots : undefined,
      } as any),
    });

    // 7. Notify PT
    await notificationService
      .create({
        userId: data.ptUserId,
        text: "New coaching request received",
        eventType: "CONTRACT_REQUESTED",
        entityType: "CONTRACT",
        entityId: contract.id,
        link: "/pt/contracts",
      })
      .catch(() => {});

    return contract;
  },

  /**
   * Internal-only — called by ai-service right after a Marketplace
   * Personalized PT Service purchase is paid (wallet-transfer already
   * succeeded there), NOT by any end-user-facing route. Unlike
   * requestContract above, this skips PENDING_REVIEW/PENDING_SIGNATURE/
   * PENDING_PAYMENT entirely and creates the Contract already ACTIVE —
   * payment happened before this call, and a marketplace listing purchase
   * is not a PT-negotiated session package that needs e-signature. This is
   * the ONLY reason Contract.status===ACTIVE (the authorization condition
   * every PT/coach endpoint already checks — coach.service.ts,
   * computeChatEligibility, isActivePtClientRelationship) becomes true for
   * a marketplace-originated relationship — no parallel authorization
   * surface, see ContractSource.MARKETPLACE's schema comment.
   */
  async createMarketplaceContract(data: {
    ptUserId: string;
    clientUserId: string;
    packageName: string;
    description?: string;
    price: number;
    paymentTransactionId?: string;
  }) {
    return contractRepository.create({
      ptUserId: data.ptUserId,
      clientUserId: data.clientUserId,
      status: ContractStatus.ACTIVE,
      source: ContractSource.MARKETPLACE,
      packageType: PackageType.PACKAGE,
      packageName: data.packageName,
      description: data.description,
      totalSessions: 0, // marketplace personalized services are not session-count-based
      price: data.price,
      startDate: new Date(),
      paymentTransactionId: data.paymentTransactionId,
    });
  },

  // ── PT accepts a pending contract ─────────────────────────────────
  async acceptContract(contractId: string, ptUserId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot accept contract in ${contract.status} status`, 400);
    }

    // 1. Fetch real emails + names (fail-fast: e-sign requires real emails)
    const [ptInfo, clientInfo] = await Promise.all([
      getUserInfo(ptUserId),
      getUserInfo(contract.clientUserId),
    ]);
    if (!ptInfo?.email)
      throw err("PT account not found or email unavailable", 500);
    if (!clientInfo?.email)
      throw err("Client account not found or email unavailable", 500);

    const ptName = fullName(ptInfo, "Personal Trainer");
    const clientName = fullName(clientInfo, "Client");

    // 2. Atomic claim: PENDING_REVIEW → PENDING_SIGNATURE (BEFORE generating PDF), or
    // straight to PENDING_PAYMENT when e-sign is bypassed — same target as the webhook
    // reaches once both parties actually sign (see dropboxSignWebhook.service.ts).
    // Prevents double PDF generation on concurrent requests. No startDate — not ACTIVE yet.
    const claimTarget = REQUIRE_CONTRACT_ESIGN
      ? ContractStatus.PENDING_SIGNATURE
      : ContractStatus.PENDING_PAYMENT;
    const affected = await contractRepository.updateWhereStatus(
      contractId,
      ContractStatus.PENDING_REVIEW,
      claimTarget,
      {
        clientSignerEmail: clientInfo.email,
        ptSignerEmail: ptInfo.email,
        eSignTestMode: process.env.DROPBOX_SIGN_TEST_MODE === "true",
        ...(REQUIRE_CONTRACT_ESIGN ? {} : { eSignStatus: "SKIPPED" }),
      },
    );
    if (affected.count === 0) {
      throw err("Contract already being processed by another request", 409);
    }

    // 3. Generate PDF (after claim — only 1 request reaches here)
    let relativePdfPath: string;
    try {
      relativePdfPath = await generateContractPdf({
        contractId,
        packageName: contract.packageName,
        totalSessions: contract.totalSessions,
        // The PDF generator formats numbers; money is Decimal in the DB.
        price: contract.price != null ? Number(contract.price) : null,
        pricePerSession: contract.pricePerSession != null ? Number(contract.pricePerSession) : null,
        startDate: contract.startDate ?? null,
        endDate: contract.endDate ?? null,
        terms: contract.terms ?? null,
        notes: contract.notes ?? null,
        clientName,
        clientEmail: clientInfo.email,
        ptName,
        ptEmail: ptInfo.email,
        createdAt: contract.createdAt,
      });
      await contractRepository.update(contractId, {
        contractPdfPath: relativePdfPath,
      });
    } catch (e: any) {
      const shortMsg = (e?.message || "PDF generation failed")
        .toString()
        .slice(0, 240);
      logger.error(
        { contractId, message: shortMsg },
        "PDF generation failed in acceptContract",
      );
      await contractRepository
        .update(contractId, { eSignStatus: "ERROR", eSignError: shortMsg })
        .catch(() => {});
      throw err("Failed to generate contract PDF", 500);
    }

    // 4. Send e-sign (fail-safe: stays PENDING_SIGNATURE, eSignStatus=ERROR if send fails).
    // Skipped entirely while REQUIRE_CONTRACT_ESIGN=false — the contract already claimed
    // PENDING_PAYMENT in step 2, so there is nothing to wait on here.
    if (REQUIRE_CONTRACT_ESIGN) {
      try {
        const result = await eSignService.send({
          contractId,
          title: `Coaching Contract - ${contract.packageName}`,
          subject: "Please sign your coaching contract",
          message:
            "Your coaching contract is ready. Please review and sign to activate.",
          testMode: process.env.DROPBOX_SIGN_TEST_MODE === "true",
          signers: [
            { name: ptName, email: ptInfo.email, role: "pt" },
            { name: clientName, email: clientInfo.email, role: "client" },
          ],
          pdfPath: relativePdfPath,
        });
        await contractRepository.update(contractId, {
          eSignProvider: result.provider,
          eSignRequestId: result.requestId,
          eSignStatus: "SENT",
          eSignSentAt: new Date(),
          eSignError: null,
        });
      } catch (e: any) {
        const shortMsg = (e?.message || "unknown e-sign error")
          .toString()
          .slice(0, 240);
        logger.error(
          { contractId, message: shortMsg },
          "e-sign send failed in acceptContract",
        );
        await contractRepository
          .update(contractId, {
            eSignStatus: "ERROR",
            eSignError: shortMsg,
          })
          .catch(() => {});
      }
    }

    await auditContractStatus(ptUserId, contractId, contract.status, claimTarget);

    // 5. Notify client
    await notificationService
      .create({
        userId: contract.clientUserId,
        text: REQUIRE_CONTRACT_ESIGN
          ? "Your coaching request was accepted! Please check your email to sign the contract."
          : "Your coaching request was accepted! You can proceed to payment.",
        eventType: "CONTRACT_ACCEPTED",
        entityType: "CONTRACT",
        entityId: contractId,
        link: "/client/schedule",
      })
      .catch(() => {});

    return contractRepository.findById(contractId);
  },

  // ── PT rejects a pending contract ─────────────────────────────────
  async rejectContract(contractId: string, ptUserId: string, reason: string) {
    if (!reason?.trim()) throw err("Rejection reason is required", 400);

    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot reject contract in ${contract.status} status`, 400);
    }

    const updated = await contractRepository.updateStatus(
      contractId,
      ContractStatus.REJECTED,
      {
        rejectionReason: reason.trim(),
      },
    );

    await auditContractStatus(ptUserId, contractId, contract.status, ContractStatus.REJECTED, {
      reason: reason.trim(),
    });

    await notificationService
      .create({
        userId: contract.clientUserId,
        text: "Your coaching request was declined",
        eventType: "CONTRACT_REJECTED",
        entityType: "CONTRACT",
        entityId: contractId,
        link: "/client/contracts",
      })
      .catch(() => {});

    return updated;
  },

  // ── Cancel contract (either party) — PRE-MONEY only ────────────────
  // Money-flow plan 2.3: this is a plain status flip, nothing more — it never calls
  // terminateContractMoney. It used to also accept ACTIVE, which meant a paid contract
  // cancelled through this path left its escrowed money in PENDING forever, unreleased and
  // unrefunded. An ACTIVE contract has money in escrow and MUST go through
  // POST /:id/terminate instead, which settles it per the termination reason's formula.
  async cancelContract(contractId: string, userId: string, reason: string) {
    if (!reason?.trim()) throw err("Cancellation reason is required", 400);

    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== userId && contract.clientUserId !== userId) {
      throw err("Not authorized", 403);
    }
    if (
      contract.status !== ContractStatus.PENDING_REVIEW &&
      contract.status !== ContractStatus.PENDING_PAYMENT
    ) {
      throw err(
        `Cannot cancel a contract in ${contract.status} status through this endpoint` +
          (contract.status === ContractStatus.ACTIVE ? " — use terminate instead, which settles the escrowed money" : ""),
        400,
      );
    }

    const updated = await contractRepository.updateStatus(
      contractId,
      ContractStatus.CANCELLED,
      {
        cancelledBy: userId,
        cancellationReason: reason.trim(),
      },
    );

    await auditContractStatus(userId, contractId, contract.status, ContractStatus.CANCELLED, {
      reason: reason.trim(),
      cancelledBy: userId === contract.ptUserId ? "PT" : "CLIENT",
    });

    // Notify the other party
    const otherUserId =
      userId === contract.ptUserId ? contract.clientUserId : contract.ptUserId;
    const isClient = userId === contract.clientUserId;
    await notificationService
      .create({
        userId: otherUserId,
        text: isClient
          ? "Client cancelled the contract"
          : "Trainer cancelled the contract",
        eventType: "CONTRACT_CANCELLED",
        entityType: "CONTRACT",
        entityId: contractId,
        link: isClient ? "/pt/contracts" : "/client/contracts",
      })
      .catch(() => {});

    return updated;
  },

  // ── Auto-complete when sessions exhausted ──────────────────────────
  /**
   * Money-flow plan 1.2: a contract that simply runs out of sessions — the ordinary,
   * happy-path way a PT contract ends — must settle its money exactly like an explicit
   * `terminate` call. Before this fix, this function only flipped `status`; nothing here
   * ever called `terminateContractMoney`, so the escrow behind a naturally-completed
   * contract stayed in the pending buckets forever.
   *
   * Best-effort on the money side: the session lifecycle has already moved on (`status`
   * flips to COMPLETED first), so a payment-service outage here must not leave the contract
   * stuck ACTIVE — it is retried safely later, since `terminateContractMoney` carries the
   * `CONTRACT_TERMINATE:<id>` idempotency key (plan 1.1) and the reconciliation sweep (plan
   * 1.6) picks up anything a first attempt missed.
   */
  async checkAndCompleteContract(
    contractId: string,
    deps: CompleteContractDeps = defaultCompleteContractDeps,
  ) {
    const contract = await deps.findById(contractId);
    if (!contract || contract.status !== ContractStatus.ACTIVE) return null;
    if (getRemainingEntitlements(contract) <= 0) {
      const updated = await deps.updateStatus(contractId, ContractStatus.COMPLETED, {
        completedAt: new Date(),
      });
      try {
        await deps.settleMoney(contractId, "COMPLETED");
      } catch (e) {
        logger.error({
          error: "money settlement failed for a naturally completed contract",
          contractId,
          message: (e as Error).message,
        });
      }
      return updated;
    }
    return null;
  },

  // ── Existing CRUD methods (kept for backward compat) ───────────────

  async create(
    ptUserId: string,
    data: {
      clientUserId: string;
      packageName: string;
      description?: string;
      totalSessions: number;
      price?: number;
      startDate?: string;
      endDate?: string;
      terms?: string;
      notes?: string;
    },
  ) {
    return contractRepository.create({
      ...data,
      ptUserId,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
    });
  },

  async getByPT(ptUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    const contracts = await contractRepository.findByPT(ptUserId, s);
    if (contracts.length === 0) return contracts;

    const profileMap = await counterpartyProfiles(
      contracts.map((c) => c.clientUserId),
    );

    return contracts.map((c) => ({
      ...c,
      clientProfile: profileMap.get(c.clientUserId) ?? null,
    }));
  },

  async getByClient(clientUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    const contracts = await contractRepository.findByClient(clientUserId, s);
    if (contracts.length === 0) return contracts;

    const profileMap = await counterpartyProfiles(
      contracts.map((c) => c.ptUserId),
    );

    return contracts.map((c) => ({
      ...c,
      ptProfile: profileMap.get(c.ptUserId) ?? null,
    }));
  },

  async getById(id: string) {
    return contractRepository.findByIdWithSessions(id);
  },

  async updateStatus(
    id: string,
    userId: string,
    newStatus: string,
    userRole?: string,
  ) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err("Contract not found", 404);

    const isAdmin = userRole === "ADMIN";
    if (
      !isAdmin &&
      contract.ptUserId !== userId &&
      contract.clientUserId !== userId
    ) {
      throw err("Not authorized", 403);
    }

    // Admin fail-safe: force past a broken e-sign (PENDING_SIGNATURE/PENDING_REVIEW →
    // PENDING_PAYMENT, NOT ACTIVE — payment is still required; this bypass only skips the
    // broken e-sign step). Emit audit log so the manual override is traceable.
    if (
      isAdmin &&
      newStatus === "ACTIVE" &&
      (contract.status === ContractStatus.PENDING_SIGNATURE ||
        contract.status === ContractStatus.PENDING_REVIEW)
    ) {
      logger.warn(
        {
          event: "CONTRACT_FORCE_PENDING_PAYMENT",
          contractId: id,
          adminUserId: userId,
          prevStatus: contract.status,
        },
        "Admin manually bypassed e-sign (contract moved to PENDING_PAYMENT, still requires payment)",
      );
      return contractRepository.updateStatus(
        id,
        ContractStatus.PENDING_PAYMENT,
        {},
      );
    }

    // PT accepts a PENDING_REVIEW contract → ACTIVE
    if (
      newStatus === "ACTIVE" &&
      contract.status === ContractStatus.PENDING_REVIEW &&
      contract.ptUserId === userId
    ) {
      return this.acceptContract(id, userId);
    }

    // Either party can cancel; admin can also force-cancel.
    if (newStatus === "CANCELLED") {
      return this.cancelContract(id, userId, "Status changed to cancelled");
    }

    // PT or admin can mark expired
    if (newStatus === "EXPIRED" && (contract.ptUserId === userId || isAdmin)) {
      return contractRepository.updateStatus(id, ContractStatus.EXPIRED);
    }

    throw err(
      `Invalid status transition: ${contract.status} → ${newStatus}`,
      400,
    );
  },

  /**
   * Resend (or send) the e-sign request for a contract in PENDING_SIGNATURE.
   * The MVP build simplifies acceptContract to set status=ACTIVE directly, so this
   * method is rarely reached. When it IS reached:
   *  - if provider throws upstream error → persist eSignStatus='ERROR' + eSignError,
   *    return err with status=502 (Bad Gateway).
   *  - if local/config error → persist eSignStatus='ERROR', return err with status=500.
   *  - logs are sanitized: only short error message + provider/status, never API key/URL/PII.
   */
  async resendESign(
    contractId: string,
  ): Promise<{ requestId: string; provider: string }> {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.status !== ContractStatus.PENDING_SIGNATURE) {
      throw err("Contract is not in PENDING_SIGNATURE state", 400);
    }
    // Controller already guards ERROR/EXPIRED, but service enforces for defense-in-depth
    if (!["ERROR", "EXPIRED"].includes(contract.eSignStatus || "")) {
      throw err(
        "E-sign is not eligible for resend — status must be ERROR or EXPIRED",
        400,
      );
    }
    if (!contract.clientSignerEmail || !contract.ptSignerEmail) {
      throw err(
        "Signer emails not set — please contact admin to reset the contract",
        400,
      );
    }
    if (!contract.contractPdfPath) {
      throw err(
        "Contract PDF missing — please contact admin to regenerate",
        400,
      );
    }

    try {
      const result = await eSignService.send({
        contractId,
        title: `Coaching Contract - ${contract.packageName}`,
        subject: "Please sign your coaching contract",
        message:
          "Your coaching contract is ready. Please review and sign to activate.",
        testMode: process.env.DROPBOX_SIGN_TEST_MODE === "true",
        signers: [
          { name: "Client", email: contract.clientSignerEmail, role: "client" },
          { name: "PT", email: contract.ptSignerEmail, role: "pt" },
        ],
        pdfPath: contract.contractPdfPath,
      });

      await contractRepository.update(contractId, {
        eSignProvider: result.provider,
        eSignRequestId: result.requestId,
        eSignStatus: "SENT",
        eSignSentAt: new Date(),
        eSignError: null,
      });

      return result;
    } catch (e: any) {
      const shortMsg = (e?.message || "unknown e-sign error")
        .toString()
        .slice(0, 240);
      const upstreamStatus = e?.response?.status || e?.statusCode;
      const isUpstream =
        typeof upstreamStatus === "number" && upstreamStatus >= 400;
      await contractRepository
        .update(contractId, {
          eSignStatus: "ERROR",
          eSignError: shortMsg,
        })
        .catch(() => {});
      logger.error(
        {
          eSignProvider: process.env.ESIGN_PROVIDER || "DROPBOX_SIGN",
          upstreamStatus,
          code: e?.code,
          message: shortMsg,
        },
        "e-sign resend failed",
      );
      if (isUpstream)
        throw err(`E-sign provider error (${upstreamStatus})`, 502);
      throw err(`E-sign error: ${shortMsg}`, 500);
    }
  },

  /**
   * Money-flow plan 2.2: `data` used to go straight to the repository with no field
   * allowlist — a PT who genuinely owns the contract could rewrite `price`, `totalSessions`,
   * or any of the three revenue-split rates on a contract the client already accepted (or
   * paid for). Only the descriptive fields below are ever editable, and only while the
   * contract is still PENDING_REVIEW — once the client has accepted/signed/paid, they are
   * relying on exactly what they saw, and it must not shift under them afterward.
   */
  async update(id: string, ptUserId: string, data: Record<string, unknown>) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) {
      throw err("Only the PT can edit this contract", 403);
    }
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot edit a contract in ${contract.status} status — only PENDING_REVIEW contracts may still be edited`, 400);
    }
    const EDITABLE_FIELDS = ["description", "notes", "terms"] as const;
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in data) patch[field] = data[field];
    }
    return contractRepository.update(id, patch);
  },

  async incrementSession(id: string, ptUserId: string) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) {
      throw err("Only the PT can log sessions", 403);
    }
    if (contract.status !== "ACTIVE") {
      throw err("Contract is not active", 400);
    }
    const updated = await contractRepository.incrementSession(id);
    await this.checkAndCompleteContract(id);
    return updated;
  },

  // ── Expire overdue contracts ───────────────────────────────────────
  async expireContracts() {
    const expired = await contractRepository.findExpiredContracts();
    let count = 0;
    for (const c of expired) {
      await contractRepository.updateStatus(c.id, ContractStatus.EXPIRED);
      count++;
    }
    return count;
  },

  // ── Check relationship (for call permission) ─────────────────────
  async checkRelationship(userAId: string, userBId: string) {
    // Calls no longer require a contract — only block if either account is deactivated.
    const [aActive, bActive] = await Promise.all([
      isUserActive(userAId),
      isUserActive(userBId),
    ]);
    const blocked = aActive === false || bActive === false;
    return { blocked };
  },

  // Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — INTERNAL, called
  // by fitness-service to authorize every PT/coach client-data or
  // plan-assignment request. Strictly ACTIVE + PT->client direction, unlike
  // checkRelationship above (which is direction-agnostic and includes
  // PENDING_SIGNATURE/COMPLETED — fine for chat eligibility, not fine for
  // "can this PT write training data for this client").
  async checkActivePtClientRelationship(ptUserId: string, clientUserId: string) {
    const contract = await contractRepository.findActivePtClientPair(ptUserId, clientUserId);
    return { active: !!contract, contractId: contract?.id ?? null };
  },

  /**
   * BR-29 (loosened): a CUSTOMER may chat with an APPROVED PT even before signing
   * a contract (discovery / pre-sale consultation). Returns a structured verdict so
   * the caller (chat-service) can show a clear reason but cannot deduce private
   * state when denied.
   */
  async computeChatEligibility(
    fromUserId: string,
    toUserId: string,
  ): Promise<{
    allowed: boolean;
    reason:
      | "ACTIVE_CONTRACT"
      | "APPROVED_PT_DISCOVERY"
      | "INACTIVE_USER"
      | "NO_RELATIONSHIP_OR_NOT_APPROVED_PT";
  }> {
    // 1) Any existing contract relationship between the two parties is always allowed.
    //    findRelationshipByPair matches both directions and any non-terminal status.
    const contract = await contractRepository.findRelationshipByPair(
      fromUserId,
      toUserId,
    );
    if (contract) {
      // Honor isActive on both sides if known. We import the auth helper lazily to
      // avoid a circular module load at startup.
      const [fromActive, toActive] = await Promise.all([
        isUserActive(fromUserId),
        isUserActive(toUserId),
      ]);
      if (fromActive === false || toActive === false) {
        return { allowed: false, reason: "INACTIVE_USER" };
      }
      return { allowed: true, reason: "ACTIVE_CONTRACT" };
    }

    // 2) No contract — only allow if toUser is an APPROVED PT and both users are active.
    const toApp = await profileRepository.findPTApplicationByUserId(toUserId);
    const toProfile = await profileRepository.findByUserId(toUserId);
    const isApprovedPT = !!toProfile?.isPT && toApp?.status === "APPROVED";
    if (!isApprovedPT) {
      return { allowed: false, reason: "NO_RELATIONSHIP_OR_NOT_APPROVED_PT" };
    }

    const [fromActive, toActive] = await Promise.all([
      isUserActive(fromUserId),
      isUserActive(toUserId),
    ]);
    if (fromActive === false || toActive === false) {
      return { allowed: false, reason: "INACTIVE_USER" };
    }
    return { allowed: true, reason: "APPROVED_PT_DISCOVERY" };
  },

  // ── PT earnings aggregate ──────────────────────────────────────────
  async getEarnings(ptUserId: string) {
    const contracts = await contractRepository.findByPT(ptUserId);
    const active = contracts.filter((c) => c.status === "ACTIVE");
    const completed = contracts.filter((c) => c.status === "COMPLETED");

    // Summed as Decimal — these are money totals shown to a PT, and floats drift.
    const sumPrice = (list: typeof contracts) =>
      list.reduce((sum, c) => sum.plus(c.price ?? 0), new Prisma.Decimal(0));
    const totalEarned = Number(sumPrice(completed));
    const activeRevenue = Number(sumPrice(active));

    return {
      totalContracts: contracts.length,
      activeContracts: active.length,
      completedContracts: completed.length,
      totalEarned,
      activeRevenue,
    };
  },

  // ── Payment gate (Phase 4) ──────────────────────────────────────────

  /** Client pays a PENDING_PAYMENT contract via wallet-transfer (client -> PT wallet). */
  /**
   * Start payment for a contract at the payer's chosen gateway.
   *
   * Returns a redirect rather than a completed payment: the client settles with the gateway,
   * and the contract only goes ACTIVE once payment-service receives the signed webhook and
   * has split the price into escrow and the parties' pending buckets. Nothing here touches
   * money — that would mean trusting the browser's word for it.
   */
  async pay(contractId: string, clientUserId: string, provider?: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.clientUserId !== clientUserId)
      throw err("Not authorized", 403);
    if (
      contract.status === ContractStatus.ACTIVE ||
      contract.paymentTransactionId
    ) {
      throw err("ALREADY_PAID", 409);
    }
    if (contract.status !== ContractStatus.PENDING_PAYMENT) {
      throw err(`Cannot pay for contract in ${contract.status} status`, 400);
    }
    if (!contract.price) throw err("Contract has no price set", 400);

    // Each attempt gets its own key: an abandoned checkout must not block a fresh one, and
    // the gateway itself dedupes a genuine double-submit by transaction id.
    const attemptId = randomUUID();
    const idempotencyKey = `pt-contract:${contract.id}:attempt:${attemptId}`;

    const result = await paymentClient.checkout({
      relatedEntityId: contract.id,
      amount: Number(contract.price),
      rates: {
        platformRate: contract.platformRate.toString(),
        ptRate: contract.ptRate.toString(),
        gymRate: contract.gymRate.toString(),
      },
      parties: {
        ptUserId: contract.ptUserId,
        gymId: contract.gymId,
        clientUserId,
      },
      idempotencyKey,
      initiatedBy: clientUserId,
      provider,
      orderInfo: `Hop dong PT ${contract.packageName}`.slice(0, 100),
    });

    return {
      contract: await contractRepository.findById(contract.id),
      payment: result,
    };
  },

  /** Called by the internal /activate-after-payment endpoint — verifies the transaction first. */
  async activateAfterPayment(contractId: string, transactionId: string) {
    const txn = await paymentClient.getTransaction(transactionId);
    if (
      !txn ||
      txn.status !== "PAID" ||
      txn.relatedEntityType !== "PT_CONTRACT" ||
      txn.relatedEntityId !== contractId
    ) {
      throw err("Transaction verification failed", 400);
    }
    const before = await contractRepository.findById(contractId);
    const wasAlreadyActive = before?.status === ContractStatus.ACTIVE;
    const activated = await contractRepository.activateIfPending(contractId, transactionId);

    // Payment confirmation is where the two parties currently have the least confirmation
    // they've actually got a deal — send the notice here rather than at signing, since
    // signing may itself be bypassed (REQUIRE_CONTRACT_ESIGN). Only on the transition that
    // actually just happened: activateIfPending is called again on webhook retries, and a
    // retry must not re-email both parties.
    if (activated && !wasAlreadyActive && activated.status === ContractStatus.ACTIVE) {
      const [ptInfo, clientInfo] = await Promise.all([
        getUserInfo(activated.ptUserId),
        getUserInfo(activated.clientUserId),
      ]);
      const subject = `Hợp đồng "${activated.packageName}" đã được kích hoạt`;
      const body = (name: string) =>
        [
          `Chào ${name},`,
          "",
          `Hợp đồng "${activated.packageName}" (${activated.totalSessions} buổi) đã thanh toán thành công và chính thức có hiệu lực.`,
          `Số tiền: ${Number(activated.price).toLocaleString("vi-VN")}đ.`,
          "",
          "Hai bên có thể bắt đầu đặt lịch buổi tập.",
        ].join("\n");
      if (clientInfo?.email) {
        await sendConfirmationEmail(clientInfo.email, subject, body(fullName(clientInfo, "bạn")));
      }
      if (ptInfo?.email) {
        await sendConfirmationEmail(ptInfo.email, subject, body(fullName(ptInfo, "bạn")));
      }
    }

    return activated;
  },

  /** Called by the internal /cancel-after-refund endpoint — verifies both transactions first. */
  async cancelAfterRefund(
    contractId: string,
    originalTransactionId: string,
    refundTransactionId: string,
  ) {
    const [original, refund] = await Promise.all([
      paymentClient.getTransaction(originalTransactionId),
      paymentClient.getTransaction(refundTransactionId),
    ]);
    if (
      !original ||
      original.status !== "REFUNDED" ||
      original.relatedEntityId !== contractId
    ) {
      throw err("Original transaction verification failed", 400);
    }
    if (
      !refund ||
      refund.status !== "PAID" ||
      refund.refundOfTransactionId !== originalTransactionId
    ) {
      throw err("Refund transaction verification failed", 400);
    }
    return contractRepository.cancelAfterRefund(contractId);
  },
};
