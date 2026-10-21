import { randomUUID } from "crypto";
import { logger } from "@gym-coach/shared";
import {
  AuditEntityType,
  ContractStatus,
  ContractSource,
  PackageType,
  SessionMode,
  Prisma,
  PtRestrictionScope,
} from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { sessionRepository } from "../repositories/session.repository";
import { paymentClient } from "../clients/payment.client";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { enrichProfilesWithAuthNames } from "./profile.service";
import { notificationService } from "./notification.service";
import { eSignService } from "./esign.service";
import { generateContractPdf } from "./contractPdf.service";
import { ptServicePackageRepository, type LockedPackageRow } from "../repositories/pt_service_package.repository";
import { clientReviewRepository } from "../repositories/clientReview.repository";
import { availabilityService } from "./availability.service";
import { auditService, SYSTEM_ACTOR } from "./audit.service";
import { completeContractRecordingEnding, recordTerminationAttemptFailed, releaseHoldbackMoney, terminateContractMoney } from "./contract-payout.service";
import { PT_HOLDBACK_IDLE_DAYS, resolvePtHoldbackRate } from "./pt-holdback-rate";
import { ptTermsService } from "./pt-terms.service";
import { PT_TERMS_VERSION } from "./pt-terms";
import { assertClientMayRequestGymContract, assertGymContractStillCovered, hasFixedDuration, GYM_CONTRACT_REQUIRES_FIXED_DURATION } from "./contract-gym-membership.service";
import { toPublicPtPackageDto } from "./pt-public-dto";
import { recordClientCompatEvent } from "./client-compat.service";
import { deriveForCompletedContract } from "./client-journey-derivation.service";
import {
  activeRestrictedContractIds,
  activeRestrictedPtUserIds,
  assertPtAcceptsNewBusiness,
  assertPtMayAct,
  assertPtMayActOnContract,
  getActiveRestriction,
  getBlockingRestriction,
  getEffectiveContractStatuses,
  isContractRestricted,
  idleCutoffExcludingRestrictions,
} from "./pt-restriction.service";

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** Machine-readable code of the 409 activate-after-payment answers when the contract cannot be
 * activated by the payment that just landed. payment-service matches on it to refund the
 * client — keep the two in step (payment-service reconciliation.service.ts). */
export const CONTRACT_NOT_ACTIVATABLE = "CONTRACT_NOT_ACTIVATABLE";

/** Vòng 4 / Phase E2 — how many confirmed PT no-shows on one contract earn the client the
 * right to terminate it themselves for a full refund (TerminationReason PT_REPEATED_NO_SHOW,
 * enforced in contract.controller.ts's terminate()). */
export const PT_REPEATED_NO_SHOW_THRESHOLD = 3;

/** Hạn thanh toán: một hợp đồng phải được trả trong vòng bao nhiêu giờ kể từ lúc nó VÀO
 * PENDING_PAYMENT. Quá hạn mà chưa trả thì contract-expiry-sweep tự huỷ (và `pay` từ chối từ
 * lúc quá hạn, không đợi sweep). Cấu hình qua env, mặc định 12 giờ. */
export const CONTRACT_PAYMENT_DEADLINE_HOURS = (() => {
  const n = Number(process.env.CONTRACT_PAYMENT_DEADLINE_HOURS ?? 12);
  return Number.isFinite(n) && n > 0 ? n : 12;
})();

/** Thời gian (phút) mà một checkout cổng thanh toán đã khởi tạo vẫn có thể được hoàn tất. `pay`
 * đẩy `paymentDueAt` tới ít nhất `now + giá trị này` để sweep không huỷ hợp đồng khi học viên còn
 * đang ở trang ngân hàng (tiền về sau khi hợp đồng đã CANCELLED = đã trả mà bị huỷ). Phải >= hạn
 * checkout dài nhất của các cổng trong payment-service + độ trễ webhook/polling (5 phút).
 * VNPay đặt vnp_ExpireDate = +15 phút; ZaloPay/PayOS/MoMo không truyền hạn nên dùng mặc định của
 * cổng (không đọc được từ code). Mặc định 60 phút, cấu hình qua env. */
export const CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES = (() => {
  const n = Number(process.env.CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES ?? 60);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

/** D13 (owner decision APPROVED): a contract's payment deadline is extended by a checkout AT MOST ONCE (one 60-minute extension per contract).
 * ON by default. Only an explicit `false` (CHECKOUT_EXTENSION_ONCE=false, trimmed, case-insensitive) turns it off - an emergency switch that
 * restores the old unlimited extension and is warned about every time it is used. Read on every call so tests and ops can flip it. */
export function checkoutExtensionOnce(): boolean {
  return (process.env.CHECKOUT_EXTENSION_ONCE ?? "").trim().toLowerCase() !== "false";
}

/** Giá trị `paymentDueAt` cho một hợp đồng vừa vào PENDING_PAYMENT lúc `from`. Mọi đường đi vào
 * PENDING_PAYMENT (PT chấp nhận, webhook ký xong, admin bỏ qua e-sign) phải đặt cột này. */
export function computePaymentDueAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + CONTRACT_PAYMENT_DEADLINE_HOURS * 60 * 60 * 1000);
}

/** Lỗi mang mã máy đọc được (`code`) — controller chuyển `code` ra response. */
function codedErr(message: string, status: number, code: string) {
  return Object.assign(err(message, status), { code });
}

/**
 * D25/D74 - THE one terms gate for taking a NEW contract: the PT of a PENDING_REVIEW request must have confirmed the CURRENT PT
 * terms. Used by acceptContract (the PT) AND by the admin "skip e-sign" path in updateStatus: an admin may skip e-sign but can never
 * accept the terms on the PT's behalf, so that path asks the SAME question about the contract's PT (never about the admin).
 * A contract past PENDING_REVIEW was already accepted (under the terms of its time) and is not asked again.
 * Refuses with 409 PT_TERMS_NOT_ACCEPTED and writes nothing.
 */
async function assertPtTermsForNewContract(contract: { ptUserId: string; status: ContractStatus }): Promise<void> {
  if (contract.status !== ContractStatus.PENDING_REVIEW) return;
  await ptTermsService.assertAcceptedCurrent(contract.ptUserId);
}

export const GYM_NOT_ACCEPTING_CONTRACTS = "GYM_NOT_ACCEPTING_CONTRACTS";
export const GYM_TERMS_CHANGED = "GYM_TERMS_CHANGED";
export const PAYMENT_DEADLINE_PASSED = "PAYMENT_DEADLINE_PASSED";

/**
 * Hợp đồng gắn phòng gym: hỏi lại gym-service xem thoả thuận PT–gym còn dùng được cho hợp đồng
 * MỚI không. `requestContract` chỉ hỏi một lần lúc tạo yêu cầu; trong lúc chờ PT chấp nhận /
 * khách thanh toán, gym có thể bị đóng / ngừng hoạt động hoặc thoả thuận bắt đầu bị chấm dứt.
 * Chỉ hợp đồng ĐÃ TRẢ TIỀN mới là cam kết đã có — hợp đồng chưa trả vẫn là "mới".
 *
 *  - gym-service không với tới được → 503 (không bao giờ coi "không kiểm tra được" là hợp lệ
 *    hay không hợp lệ).
 *  - không còn thoả thuận → 409 GYM_NOT_ACCEPTING_CONTRACTS, hợp đồng giữ nguyên trạng thái.
 *  - còn thoả thuận nhưng 3 tỷ lệ khác bản đã chụp vào hợp đồng → 409 GYM_TERMS_CHANGED; không
 *    bao giờ ghi đè tỷ lệ của hợp đồng, không bao giờ đi tiếp với tỷ lệ lệch.
 * Hợp đồng không có gymId: không gọi gym-service.
 */
export async function assertGymStillAcceptsContract(contract: {
  gymId: string | null;
  ptUserId: string;
  platformRate: Prisma.Decimal | string;
  ptRate: Prisma.Decimal | string;
  gymRate: Prisma.Decimal | string;
}): Promise<void> {
  if (!contract.gymId) return;
  let collab;
  try {
    collab = await gymClient.getActiveCollaboration(contract.gymId, contract.ptUserId);
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
    throw codedErr(
      "Phòng gym này hiện không còn nhận hợp đồng PT mới. Vui lòng chọn phòng gym khác hoặc hình thức tập khác.",
      409,
      GYM_NOT_ACCEPTING_CONTRACTS,
    );
  }
  // So sánh dạng số thập phân, không so chuỗi ("0.5" bằng "0.5000").
  const same =
    new Prisma.Decimal(collab.platformRate).equals(contract.platformRate) &&
    new Prisma.Decimal(collab.ptRate).equals(contract.ptRate) &&
    new Prisma.Decimal(collab.gymRate).equals(contract.gymRate);
  if (!same) {
    throw codedErr(
      "Điều khoản hợp tác giữa PT và phòng gym đã thay đổi kể từ lúc yêu cầu được tạo. Vui lòng huỷ yêu cầu này và tạo yêu cầu mới.",
      409,
      GYM_TERMS_CHANGED,
    );
  }
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
  /** docs/adr-client-journey-attribution.md — best-effort, injectable the
   * same way settleMoney is so this function's own tests can stay DB-free
   * (see contract-natural-completion-settles-money.test.ts's own "no DB,
   * no HTTP" design note above). */
  deriveClientJourney: (id: string) => Promise<unknown>;
}

const defaultCompleteContractDeps: CompleteContractDeps = {
  findById: (id) => contractRepository.findById(id),
  // F4: guarded - only an ACTIVE contract is completed. A contract that was ended another way between the read and this write
  // (client cancel, expiry, ban) is NOT rewritten to COMPLETED (null = lost the race; checkAndCompleteContract then stops).
  // FH-3b (DQ-8): the CONTRACT_TERMINATION intent is written in the SAME transaction as the status flip, so a crash right after
  // "COMPLETED" can no longer leave a completed contract the settlement sweep does not know about. (`status` is always COMPLETED here.)
  updateStatus: (id, _status, extra) => completeContractRecordingEnding(id, extra),
  deriveClientJourney: (id) => deriveForCompletedContract(id),
  // Money-flow plan 1.6: tracked, because by the time this runs updateStatus has already
  // committed the contract to COMPLETED — there is no going back to retry a failed settlement
  // through any status-gated endpoint, so the sweep is the only path left for it. The CONTRACT_TERMINATION intent row was
  // written together with that status (FH-3b); the ending here carries it through and settles it on payment-service's
  // confirmation. recordTerminationAttemptFailed stays as a belt-and-braces upsert for a contract with no row (it is a no-op
  // for a row that exists) so the sweep still finds the ending if the ending itself died before it could look at the row.
  settleMoney: async (id, reason) => {
    try {
      return await terminateContractMoney(id, reason);
    } catch (e) {
      await recordTerminationAttemptFailed(id, reason, (e as Error).message).catch(() => undefined);
      throw e;
    }
  },
};

/**
 * 409 PACKAGE_CHANGED: the package the client showed is not the package the server would sell. Carries the CURRENT
 * package (public shape, with its version) so the UI can show the new terms and let the person decide again.
 */
function packageChangedError(current: LockedPackageRow | NonNullable<Awaited<ReturnType<typeof ptServicePackageRepository.findById>>>) {
  return Object.assign(new Error("Gói dịch vụ đã thay đổi. Hãy xem lại giá và nội dung mới trước khi tiếp tục."), {
    status: 409,
    code: "PACKAGE_CHANGED",
    package: toPublicPtPackageDto(current),
  });
}

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
    await authServiceClient.internalPost(
      "/auth/internal/send-email",
      { to, subject, text },
      { timeoutMs: 5000 },
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
    const { data } = await authServiceClient.internalGet(
      `/auth/internal/users/${userId}`,
      { timeoutMs: 3000 },
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
 * Whether a user's account is active (auth.users.isActive), asked of auth-service.
 *
 * FAILS CLOSED. If auth-service cannot answer (unreachable, timeout, 5xx, rejected service secret) this THROWS
 * AuthServiceUnavailableError - it never guesses "active". The two callers (chat eligibility, call permission)
 * exist precisely to keep deactivated/banned accounts out, so treating an outage as "active" let a banned user chat or
 * call for as long as auth-service was down. The controllers turn the error into 503, and chat-service denies on a
 * failed check. Only "auth-service answered and has no such user" (404) or "answered with no isActive column yet"
 * (pre-migration) count as active, because in those cases nothing says the account is blocked.
 */
async function isUserActive(userId: string): Promise<boolean> {
  try {
    const { data } = await authServiceClient.internalGet(
      `/auth/internal/users/${userId}`,
      { timeoutMs: 3000 },
    );
    const u = data?.user;
    if (!u) return true;
    if (typeof u.isActive === "boolean") return u.isActive;
    return true; // pre-migration: treat as active
  } catch (e: any) {
    if (e?.response?.status === 404) return true; // auth-service has no such account: nothing marks it blocked
    logger.warn({ status: e?.response?.status, code: e?.code }, "isUserActive: auth-service check failed - failing closed");
    throw e instanceof AuthServiceUnavailableError ? e : new AuthServiceUnavailableError(e);
  }
}

/** Account-status codes on the contract paths (Codex #4). */
export const ACCOUNT_STATUS_UNAVAILABLE = "ACCOUNT_STATUS_UNAVAILABLE";
export const ACCOUNT_INACTIVE = "ACCOUNT_INACTIVE";

function accountStatusUnavailable() {
  return codedErr(
    "Chưa xác minh được trạng thái tài khoản lúc này, vui lòng thử lại sau ít phút",
    503,
    ACCOUNT_STATUS_UNAVAILABLE,
  );
}
function accountInactive() {
  return codedErr(
    "Không thể tạo hoặc chấp nhận hợp đồng vì một trong hai tài khoản hiện không hoạt động",
    403,
    ACCOUNT_INACTIVE,
  );
}

/**
 * Codex #4 - both parties of a NEW contract must be active accounts, asked of auth-service, and the answer must be an answer:
 * unreachable / timeout / 5xx / rejected service secret -> 503 ACCOUNT_STATUS_UNAVAILABLE (never "assume active"); a deactivated
 * (banned) account -> 403 ACCOUNT_INACTIVE. Called before anything is written. Deliberately NOT used by createMarketplaceContract:
 * that runs after the order is paid, and refusing there would strand the money.
 */
async function assertContractPartiesActive(userIds: string[]): Promise<void> {
  let results: boolean[];
  try {
    results = await Promise.all(userIds.map((id) => isUserActive(id)));
  } catch (e) {
    if (e instanceof AuthServiceUnavailableError) throw accountStatusUnavailable();
    throw e;
  }
  if (results.some((active) => active === false)) throw accountInactive();
}

/**
 * auth-service's record of an account (e-mail, name, isActive) for acceptContract, which needs the e-mails anyway - one lookup
 * per party, so the active check and the e-mail come from the same answer. STRICT, unlike getUserInfo: an outage is a 503 (the
 * lookup used to collapse into null and surface as a misleading 500 "account not found"); only "auth-service has no such user"
 * (404) returns null.
 */
async function getUserInfoStrict(userId: string): Promise<{
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
} | null> {
  try {
    const { data } = await authServiceClient.internalGet(`/auth/internal/users/${userId}`, { timeoutMs: 3000 });
    const u = data?.user;
    if (!u?.email) return null;
    return {
      email: u.email,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      isActive: typeof u.isActive === "boolean" ? u.isActive : true, // pre-migration: no column yet
    };
  } catch (e: any) {
    if (e?.response?.status === 404) return null;
    logger.warn({ status: e?.response?.status, code: e?.code }, "getUserInfoStrict: auth-service lookup failed - failing closed");
    throw accountStatusUnavailable();
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
      /**
       * The `version` of the package the client was showing when the person pressed buy. When it no longer matches
       * the package row the contract would snapshot, the request is refused 409 PACKAGE_CHANGED with the current
       * package. Absent (an old app) -> the request proceeds with the package as it is right now and is counted in
       * client_compat_events (PACKAGE_VERSION_MISSING).
       */
      expectedPackageVersion?: number;
    },
    agent?: { actionId: string; expectedPrice: number; expectedSessions: number; expectedMinutes: number; expectedMode: string },
    ctx?: { clientHeader?: string | null },
  ) {
    if (agent) {
      const prior = await prisma.contract.findUnique({ where: { agentActionId: agent.actionId } });
      if (prior) {
        if (prior.clientUserId !== clientUserId) throw err("Action not found", 404);
        return prior;
      }
    }
    // 1. Load the package (source of truth for price/sessions/mode)
    //
    // Guard the id before it reaches Prisma: findUnique({ where: { id: undefined } }) is a
    // validation error, not a miss, so a request that simply forgot packageId surfaced as a
    // 500 with a raw Prisma stack instead of telling the caller what was wrong.
    if (!data.packageId) throw err("Thiếu packageId — hãy chọn gói dịch vụ", 400);
    const pkg = await ptServicePackageRepository.findById(data.packageId);
    if (!pkg) throw err("Gói dịch vụ không tồn tại", 404);
    if (agent && (Number(pkg.price) !== agent.expectedPrice || pkg.sessionCount !== agent.expectedSessions ||
      pkg.sessionDurationMinutes !== agent.expectedMinutes || pkg.sessionMode !== agent.expectedMode)) {
      throw err("PACKAGE_CHANGED: hãy xem và xác nhận lại gói dịch vụ", 409);
    }
    if (!pkg.isActive || pkg.archivedAt) throw err("Gói dịch vụ này đã ngừng bán", 422);
    if (pkg.ptUserId !== data.ptUserId)
      throw err("Gói dịch vụ không thuộc PT này", 400);

    // expectedPackageVersion: fail fast on the cheap read (a stale buyer should not wait for the slow checks below);
    // the AUTHORITATIVE comparison is repeated inside the transaction against the locked row (step 6).
    const expectedPackageVersion = data.expectedPackageVersion;
    if (expectedPackageVersion !== undefined && expectedPackageVersion !== null) {
      if (!Number.isInteger(expectedPackageVersion) || expectedPackageVersion < 1)
        throw err("expectedPackageVersion phải là số nguyên >= 1", 400);
      if (expectedPackageVersion !== pkg.version) throw packageChangedError(pkg);
    } else if (!agent) {
      // An app that predates the listing flow does not send the version: it still gets its contract (at the price
      // the row has right now, snapshotted atomically below) - but every such request is counted, so the
      // compatibility behaviour can be retired with evidence rather than on a guess.
      await recordClientCompatEvent({
        route: "POST /contracts/request",
        actorUserId: clientUserId,
        clientHeader: ctx?.clientHeader ?? null,
        outcome: "PACKAGE_VERSION_MISSING",
      });
    }

    // 2. Check PT profile
    const ptProfile = await profileRepository.findByUserId(data.ptUserId);
    if (!ptProfile || !ptProfile.isPT)
      throw err("PT không tồn tại hoặc chưa được duyệt", 404);
    // A restricted PT (temporarily suspended OR banned) takes no new business. The restriction record
    // decides (pt-restriction.service.ts); the profile flag is only its mirror and fails closed there.
    await assertPtAcceptsNewBusiness(data.ptUserId, "REQUEST_CONTRACT");
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
    // Phase 3 / P3.2 — which agreement the rates came from, snapshotted beside them. All null for an
    // independent contract, and for any field gym-service did not send (never guessed).
    let gymSnapshot: {
      gymBrandId: string | null;
      gymAgreementId: string | null;
      gymAgreementScope: string | null;
      gymMembershipId: string | null;
    } = { gymBrandId: null, gymAgreementId: null, gymAgreementScope: null, gymMembershipId: null };
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
      gymSnapshot = {
        gymBrandId: collab.brandId ?? null,
        gymAgreementId: collab.collaborationId ?? null,
        gymAgreementScope: collab.agreementScope ?? null,
        gymMembershipId: null, // set just below, once the membership check passes
      };
      // Phase 3 / P3.3 (D18, D67): the client must hold an active membership at this gym's brand that
      // lasts at least as long as the contract would. Nothing has been written yet - a refusal here
      // (422 MEMBERSHIP_REQUIRED / MEMBERSHIP_DOES_NOT_COVER_CONTRACT, 503 if gym-service is down)
      // leaves no contract row. Contracts without a gym (online / independent) never reach this.
      const membership = await assertClientMayRequestGymContract({
        clientUserId,
        gymId: data.gymId,
        brandId: collab.brandId,
        validityDays: pkg.validityDays,
      });
      gymSnapshot.gymMembershipId = membership.membershipId;
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
    //
    //    ATOMIC with the package: the package row is read, checked and snapshotted inside ONE transaction that holds
    //    `SELECT ... FOR SHARE` on it. The listing-apply transaction takes FOR UPDATE on the package rows, so the
    //    two serialise: a contract created before the apply carries the OLD price and version, one created after it
    //    carries the NEW ones - never new terms with an old version (or the reverse). The slow checks above
    //    (availability, gym collaboration, membership) deliberately stay outside; only the version check and the
    //    snapshot live in here.
    // Codex #4: both accounts must be active, and auth-service must actually have said so. Nothing has been written yet.
    await assertContractPartiesActive([clientUserId, data.ptUserId]);

    const ptHoldbackRate = await resolvePtHoldbackRate(data.ptUserId);
    const contract = await prisma.$transaction(async (tx) => {
      // BR-27 race guard. The pre-check at step 5 is a fast refusal, not a guarantee: two concurrent requests
      // for the same PT-client pair both pass it. Serialise on the pair here and look again - the loser waits for
      // the winner's commit, sees its row and is refused (the partial unique index is the last-resort backstop).
      await contractRepository.lockPtClientPair(tx, data.ptUserId, clientUserId);
      if (await contractRepository.findActiveByPair(data.ptUserId, clientUserId, tx)) {
        throw err("You already have an active or pending contract with this PT", 409);
      }
      const locked = await ptServicePackageRepository.findByIdForShare(data.packageId, tx);
      if (!locked) throw err("Gói dịch vụ không tồn tại", 404);
      if (!locked.isActive || locked.archivedAt) throw err("Gói dịch vụ này đã ngừng bán", 422);
      if (locked.ptUserId !== data.ptUserId) throw err("Gói dịch vụ không thuộc PT này", 400);
      if (expectedPackageVersion !== undefined && expectedPackageVersion !== null && expectedPackageVersion !== locked.version) {
        throw packageChangedError(locked);
      }
      if (data.gymId && locked.sessionMode === SessionMode.ONLINE) {
        // The package may have been switched to ONLINE after the pre-check above.
        throw err(
          "Buổi tập trực tuyến không thể gắn với phòng gym cụ thể — chọn hình thức Offline hoặc bỏ chọn phòng gym",
          400,
        );
      }

      if (data.gymId) {
        // Codex #6 on the LOCKED row (the pre-check above read the package earlier): a package edited to "no duration" in between, or to a
        // longer one than the membership was checked against, must not slip into a gym contract. Nothing has been written yet.
        if (!hasFixedDuration(locked.validityDays)) {
          throw Object.assign(
            new Error("Hợp đồng PT tại phòng gym phải có thời hạn cố định, nhưng gói PT này chưa có thời hạn. Hãy chọn gói PT có thời hạn cụ thể, hoặc tập không qua phòng gym."),
            { status: 409, code: GYM_CONTRACT_REQUIRES_FIXED_DURATION },
          );
        }
        if (pkg.validityDays != null && locked.validityDays > pkg.validityDays) throw packageChangedError(locked);
      }

      const snapshot = buildPackageSnapshot(locked);
      return contractRepository.create(
        {
          agentActionId: agent?.actionId,
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
          ...gymSnapshot,
          // PT holdback — a snapshot like the rates above, from the one place that decides it
          // (today always "0": the rule is built but switched off).
          ptHoldbackRate,
          // Package audit trail + slot warning evidence
          ...({
            packageId: snapshot.packageId,
            packageSourceName: snapshot.packageSourceName,
            sessionDurationMinutes: snapshot.sessionDurationMinutes,
            validityDays: snapshot.validityDays,
            lowAvailabilityWarned: availableSlots < locked.sessionCount,
            slotsAtPurchase: availableSlots < locked.sessionCount ? availableSlots : undefined,
          } as any),
        },
        tx,
      );
    });

    // 7. Notify PT
    await notificationService
      .create({
        userId: data.ptUserId,
        text: "Bạn có yêu cầu huấn luyện mới từ học viên",
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
    // The order is ALREADY PAID when this runs, so a conflicting PT contract is never refused here (that would strand
    // the money): the conflict check lives before payment (ai-service purchaseService -> hasStandingPtContract).
    // What this does guarantee, under the pair lock: a retry of the same paid order returns its contract instead of
    // creating a second one.
    return prisma.$transaction(async (tx) => {
      await contractRepository.lockPtClientPair(tx, data.ptUserId, data.clientUserId);
      if (data.paymentTransactionId) {
        const prior = await contractRepository.findByPaymentTransactionId(data.paymentTransactionId, tx);
        if (prior && prior.ptUserId === data.ptUserId && prior.clientUserId === data.clientUserId) return prior;
      }
      return contractRepository.create(
        {
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
        },
        tx,
      );
    });
  },

  /**
   * Internal-only - ai-service asks this BEFORE it starts a personalized-service checkout. True when the pair already
   * has a live PT contract (any non-terminal status, PENDING_PAYMENT included) that is not itself a marketplace one.
   */
  async hasStandingPtContract(ptUserId: string, clientUserId: string): Promise<boolean> {
    return !!(await contractRepository.findNonMarketplaceActiveByPair(ptUserId, clientUserId));
  },

  // ── PT accepts a pending contract ─────────────────────────────────
  async acceptContract(contractId: string, ptUserId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) throw err("Not authorized", 403);
    // Restricted mode: a suspended PT cannot take on a new contract (the request waits, the client may cancel it).
    await assertPtMayAct(ptUserId);
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot accept contract in ${contract.status} status`, 400);
    }

    // D25: a PT takes a NEW contract only after confirming the CURRENT PT terms. Refused here, before the claim,
    // the PDF, any notification or any money step - nothing is written. Contracts already accepted/active are never
    // read by this check (they are past PENDING_REVIEW), so they keep running on the terms they were accepted under.
    await assertPtTermsForNewContract(contract);

    // 0. Gym-tied: the partnership may have been closed/terminated since the request was made, and the client's membership
    //    may have ended or been cancelled (Codex #6: a gym contract needs a fixed duration the membership covers).
    await assertGymStillAcceptsContract(contract);
    await assertGymContractStillCovered(contract, "PT");

    // 1. Fetch real emails + names (fail-fast: e-sign requires real emails)
    //    Codex #4: the same lookup tells us whether either account is deactivated; an auth-service outage is a 503 and
    //    nothing has been claimed or written yet.
    const [ptInfo, clientInfo] = await Promise.all([
      getUserInfoStrict(ptUserId),
      getUserInfoStrict(contract.clientUserId),
    ]);
    if (ptInfo?.isActive === false || clientInfo?.isActive === false) throw accountInactive();
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
        ...(REQUIRE_CONTRACT_ESIGN
          ? {}
          : { eSignStatus: "SKIPPED", paymentDueAt: computePaymentDueAt() }),
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

    await auditContractStatus(ptUserId, contractId, contract.status, claimTarget, { ptTermsVersion: PT_TERMS_VERSION });

    // 5. Notify client
    await notificationService
      .create({
        userId: contract.clientUserId,
        text: REQUIRE_CONTRACT_ESIGN
          ? "Huấn luyện viên đã chấp nhận yêu cầu của bạn. Vui lòng kiểm tra email để ký hợp đồng."
          : "Huấn luyện viên đã chấp nhận yêu cầu của bạn. Bạn có thể thanh toán ngay.",
        eventType: "CONTRACT_ACCEPTED",
        entityType: "CONTRACT",
        entityId: contractId,
        // Where the client pays. "/client/schedule" was never a route on web — the bell opened
        // a blank page (mobile happened to map it).
        link: "/client/contracts",
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
    await assertPtMayAct(ptUserId); // restricted mode
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
        text: "Huấn luyện viên đã từ chối yêu cầu huấn luyện của bạn",
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
    // Restricted mode applies to the PT acting for themselves; the CLIENT may always withdraw their own unpaid contract.
    if (contract.ptUserId === userId) await assertPtMayAct(userId);
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

    // Ghi có điều kiện theo đúng trạng thái vừa đọc: nếu trong lúc đó một khoản thanh toán đã kích
    // hoạt hợp đồng (PENDING_PAYMENT -> ACTIVE), lệnh huỷ này KHÔNG được đè lên — sẽ thành một
    // hợp đồng đã trả tiền mà bị huỷ không hoàn tiền. Hợp đồng ACTIVE phải đi qua terminate.
    const updated = await contractRepository.updateStatusIfCurrent(
      contractId,
      contract.status,
      ContractStatus.CANCELLED,
      {
        cancelledBy: userId,
        cancellationReason: reason.trim(),
      },
    );
    if (!updated) {
      throw err("The contract changed while you were cancelling it — reload and check its status", 409);
    }

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
   * flips to COMPLETED first, in the same transaction that records the durable CONTRACT_TERMINATION
   * intent - FH-3b), so a payment-service outage here must not leave the contract
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
      if (updated === null) return null; // ended another way meanwhile - that ending owns the contract and its money
      try {
        await deps.settleMoney(contractId, "COMPLETED");
      } catch (e) {
        logger.error({
          error: "money settlement failed for a naturally completed contract",
          contractId,
          message: (e as Error).message,
        });
      }
      // ClientJourney population (docs/ai-agent-system-feasibility-audit.md
      // §2.4, docs/adr-client-journey-attribution.md) — best-effort, same
      // isolation principle as the money settlement above: this is an
      // analytics derivation, never allowed to affect the contract
      // completion that already happened. deriveForCompletedContract()
      // itself never throws (internal try/catch), this outer one is belt-
      // and-braces only.
      try {
        await deps.deriveClientJourney(contractId);
      } catch (e) {
        logger.error({
          error: "client journey derivation failed for a naturally completed contract",
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
    const rawContracts = await contractRepository.findByPT(ptUserId, s);
    if (rawContracts.length === 0) return rawContracts;
    // `effectiveStatus` (ACTIVE vs PAUSED_BY_ADMIN) rides along; `status` keeps its stored value.
    const contracts = await getEffectiveContractStatuses(rawContracts);

    const clientIds = contracts.map((c) => c.clientUserId);
    const [profileMap, ratingMap] = await Promise.all([
      counterpartyProfiles(clientIds),
      // Lets a PT reviewing a PENDING_REVIEW request see how this client behaved with OTHER
      // PTs before — the counterpart to a client already seeing a PT's rating up front.
      clientReviewRepository.aggregateForClients(clientIds),
    ]);

    return contracts.map((c) => ({
      ...c,
      clientProfile: profileMap.get(c.clientUserId) ?? null,
      clientRating: ratingMap.get(c.clientUserId) ?? {
        avgRating: null,
        ratingCount: 0,
      },
    }));
  },

  async getByClient(clientUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    const rawContracts = await contractRepository.findByClient(clientUserId, s);
    if (rawContracts.length === 0) return rawContracts;
    const contracts = await getEffectiveContractStatuses(rawContracts);

    const profileMap = await counterpartyProfiles(
      contracts.map((c) => c.ptUserId),
    );

    return contracts.map((c) => ({
      ...c,
      ptProfile: profileMap.get(c.ptUserId) ?? null,
    }));
  },

  async getById(id: string) {
    const contract = await contractRepository.findByIdWithSessions(id);
    if (!contract) return contract;
    const [withEffective] = await getEffectiveContractStatuses([contract]);
    return withEffective;
  },

  /**
   * Vòng 4 / Phase E2 — how close a contract is to the client's own right to terminate for
   * repeated PT no-shows. Extracted out of contract.controller.ts's terminate() so the count
   * check that actually GATES the money-moving action is unit-testable on its own (the rest of
   * terminate() is plain HTTP/authorization glue, same as the other five termination reasons,
   * none of which have dedicated unit tests either).
   */
  async repeatedNoShowEligibility(contractId: string) {
    const count = await sessionRepository.countPtAtFaultByContract(contractId);
    return { count, threshold: PT_REPEATED_NO_SHOW_THRESHOLD, eligible: count >= PT_REPEATED_NO_SHOW_THRESHOLD };
  },

  // Roadmap P4.1 "Notifications/reminders" (§27) — "PT feedback" is one
  // of §27's own listed notification types, but no PT-sends-feedback
  // mechanism existed anywhere in this codebase before this pass (real
  // audit finding, not assumed). Scoped minimally and deliberately: a
  // single free-text message a PT sends about a specific ACTIVE
  // contract, delivered as a real, listable Notification — not a new
  // threaded conversation/reply feature (that already exists separately,
  // via chat). Anchored to Contract (not a specific workout) since that
  // is the one relationship this service already has a real, verified
  // trust boundary for — no cross-service call into fitness-service
  // needed at all.
  async sendFeedback(contractId: string, ptUserId: string, text: string) {
    const trimmed = text?.trim();
    if (!trimmed) throw err("Feedback text is required", 400);
    if (trimmed.length > 1000) throw err("Feedback text must be 1000 characters or fewer", 400);

    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.ptUserId !== ptUserId) throw err("Not authorized", 403);
    await assertPtMayActOnContract(ptUserId, contractId); // restricted mode: no coaching messages while suspended (account or this contract)
    if (contract.status !== ContractStatus.ACTIVE) {
      throw err("Feedback can only be sent on an active contract", 409);
    }

    const notification = await notificationService.create({
      userId: contract.clientUserId,
      text: `PT gửi phản hồi: ${trimmed}`,
      eventType: "PT_FEEDBACK_RECEIVED",
      entityType: "CONTRACT",
      entityId: contractId,
      link: `/client/services`,
    });

    return { notification };
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
      // D74: skipping e-sign is the admin's power; accepting the PT terms for the PT is not. Same gate as acceptContract.
      await assertPtTermsForNewContract(contract);
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
        { paymentDueAt: computePaymentDueAt() },
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
  /**
   * P0 cluster A3: a contract past its endDate used to just flip to EXPIRED with zero money
   * movement — whatever was still sitting in the three parties' pending buckets for
   * never-booked sessions stayed there forever, and the reconciliation invariant kept holding
   * (escrow still equalled the sum of claims) but nobody could actually withdraw that value:
   * the PT/gym's claim was real yet unreachable, since nothing had released it out of pending.
   *
   * Policy decision (confirmed with the user rather than invented): natural expiry ALWAYS
   * settles as 'EXPIRED' (zero refund to the client) — a PT-caused no-show is already
   * compensated in cash the moment it happens via compensateNoShowMoney/compensatedSessions,
   * not deferred to whenever the contract eventually lapses, so there is no separate
   * "PT-caused expiry" case left to distinguish here.
   *
   * Each contract is settled independently, same discipline as ptDeactivationService — one
   * failure (payment-service unreachable, bad data) must not stop the rest of the sweep from
   * expiring the contracts that ARE settleable.
   *
   * Deliberately NOT wrapped in settleTracked (unlike the sweep-retried session-level
   * settlements): findExpiredContracts() re-queries "still ACTIVE, endDate already passed"
   * fresh on every tick, so a contract whose termination fails this tick is simply
   * rediscovered and retried the next tick — no separate tracking row is needed, and
   * terminateContractMoney's own stable `CONTRACT_TERMINATE:<contractId>` key already makes a
   * retry safe against double settlement.
   */
  async expireContracts() {
    // A contract whose PT is restricted is PAUSED_BY_ADMIN (getEffectiveContractStatus): its clock is
    // stopped, so it must never be ended as EXPIRED — that settles with a zero refund and hands the
    // whole unused value to the PT/gym/platform, i.e. it would make the client pay for the pause.
    // The end date is moved forward by the blocked time when the restriction is lifted.
    // A contract paused on its own (CONTRACT-scope restriction) has the same stopped clock, for that contract only.
    const restricted = await activeRestrictedPtUserIds();
    const expired = await contractRepository.findExpiredContracts(restricted, await activeRestrictedContractIds());
    let count = 0;
    for (const c of expired) {
      try {
        // Re-check right before the money call: a suspension may have begun since the list was read.
        if (await isContractRestricted(c)) continue;
        await terminateContractMoney(c.id, "EXPIRED");
        count++;
      } catch (e) {
        logger.error({
          error: "Failed to settle an expired contract's money",
          contractId: c.id,
          message: (e as Error).message,
        });
      }
    }
    return count;
  },

  /**
   * Huỷ hợp đồng PENDING_PAYMENT quá hạn thanh toán (paymentDueAt đã qua). Chưa có đồng nào
   * được chuyển cho hợp đồng ở trạng thái này nên đây là huỷ thường — cùng dạng với
   * cancelContract (status CANCELLED + cancelledBy + cancellationReason + audit + thông báo),
   * không đi qua terminateContractMoney.
   *
   * Cập nhật có điều kiện (xem contractRepository.cancelIfPaymentOverdue): chỉ ăn nếu dòng vẫn
   * là PENDING_PAYMENT, chưa có paymentTransactionId và vẫn quá hạn ở thời điểm ghi — nên một
   * lần thanh toán vừa thành công không bao giờ bị biến thành "đã huỷ mà đã trả tiền".
   * Lỗi từng hợp đồng được bắt riêng để không chặn cả lượt.
   */
  async cancelOverduePaymentContracts(): Promise<number> {
    const overdue = await contractRepository.findOverduePendingPayment(new Date());
    let count = 0;
    for (const c of overdue) {
      try {
        const reason = `Quá hạn thanh toán ${CONTRACT_PAYMENT_DEADLINE_HOURS} giờ kể từ khi PT chấp nhận`;
        const { count: affected } = await contractRepository.cancelIfPaymentOverdue(
          c.id,
          new Date(),
          reason,
        );
        if (affected === 0) continue; // vừa được trả / huỷ ở nơi khác — không động vào
        count++;
        await auditContractStatus(
          SYSTEM_ACTOR,
          c.id,
          ContractStatus.PENDING_PAYMENT,
          ContractStatus.CANCELLED,
          { reason, cancelledBy: "SYSTEM", paymentDueAt: c.paymentDueAt?.toISOString() ?? null },
        );
        await Promise.all([
          notificationService
            .create({
              userId: c.clientUserId,
              text: "Hợp đồng PT của bạn đã bị huỷ vì quá hạn thanh toán. Bạn có thể gửi yêu cầu mới.",
              eventType: "CONTRACT_CANCELLED",
              entityType: "CONTRACT",
              entityId: c.id,
              link: "/client/contracts",
            })
            .catch(() => {}),
          notificationService
            .create({
              userId: c.ptUserId,
              text: "Hợp đồng đã bị huỷ vì học viên không thanh toán trong thời hạn.",
              eventType: "CONTRACT_CANCELLED",
              entityType: "CONTRACT",
              entityId: c.id,
              link: "/pt/contracts",
            })
            .catch(() => {}),
        ]);
      } catch (e) {
        logger.error({
          error: "Failed to cancel a payment-overdue contract",
          contractId: c.id,
          message: (e as Error).message,
        });
      }
    }
    return count;
  },

  /**
   * Idle release of the PT holdback: a contract with a holdback that has had no session for
   * PT_HOLDBACK_IDLE_DAYS (the exact rule is contractRepository.findIdleHoldbackCandidates) hands
   * the held-back amount to the PT, and carries on WITHOUT a holdback from then on.
   *
   * Per contract and in this order, so a failure at any step is retried by the next tick and
   * nothing can fire twice:
   *   1. re-check that the contract still qualifies (a session may have been booked since the
   *      candidate list was read);
   *   2. payment-service releases the held amount — idempotent per contract, so a repeat call (a
   *      crash before step 3, or an overlapping run) replays the first result;
   *   3. a guarded update records holdbackReleasedAt and adds what was released to releasedToPt in
   *      the same statement — it affects 0 rows if anyone got there first, so the amount is counted
   *      once.
   * Errors are caught per contract so one bad contract does not block the rest of the batch.
   * Returns how many contracts THIS run released.
   */
  async releaseIdleHoldbacks(now: Date = new Date()): Promise<number> {
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - PT_HOLDBACK_IDLE_DAYS * dayMs);
    const window = { activatedBefore: cutoff, sessionsSince: cutoff };
    // A restricted PT's held amount is never released by the idle clock: nothing is "idle" while the
    // PT is paused by an admin. (The list excludes them; the per-contract check below re-reads.)
    const restricted = await activeRestrictedPtUserIds();
    const candidates = await contractRepository.findIdleHoldbackCandidates({
      ...window,
      excludePtUserIds: restricted,
      excludeContractIds: await activeRestrictedContractIds(),
    });
    let count = 0;
    for (const c of candidates) {
      try {
        if (await isContractRestricted(c)) continue;
        // Suspended time does not count toward the idle days: the window is pushed back by the time
        // this PT spent restricted, so PT_HOLDBACK_IDLE_DAYS of NON-suspended days are required.
        // ...counting only what blocked THIS contract: the PT's account episodes and this contract's own — never
        // another contract's (a restriction on a different client's contract does not stop this clock).
        const episodes = await prisma.ptRestriction.findMany({
          where: {
            OR: [
              { ptUserId: c.ptUserId, scope: PtRestrictionScope.ACCOUNT },
              { contractId: c.id, scope: PtRestrictionScope.CONTRACT },
            ],
          },
          select: { startedAt: true, endedAt: true },
        });
        const idleSince = idleCutoffExcludingRestrictions(now, PT_HOLDBACK_IDLE_DAYS * dayMs, episodes);
        const stillIdle = await contractRepository.findIdleHoldbackCandidates({
          activatedBefore: idleSince,
          sessionsSince: idleSince,
          id: c.id,
          limit: 1,
        });
        if (stillIdle.length === 0) continue;

        const result = await releaseHoldbackMoney(c.id);
        if (!result) continue; // not payable (no transaction) — nothing to release
        const { count: marked } = await contractRepository.markHoldbackReleased(
          c.id,
          new Prisma.Decimal(result.released),
          now,
        );
        if (marked === 0) continue; // someone else recorded it first
        count++;
        logger.info(
          `[HoldbackSweep] Contract ${c.id} idle for ${PT_HOLDBACK_IDLE_DAYS}+ days — released ${result.released} to the PT, holdback ended`,
        );
      } catch (e) {
        logger.error({
          error: "Failed to release an idle contract's PT holdback",
          contractId: c.id,
          message: (e as Error).message,
        });
      }
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
    // A PAUSED_BY_ADMIN contract is not a working coaching relationship: fitness-service (which asks
    // this before every PT client-data / plan-assignment request) must refuse a restricted PT.
    if (contract && (await getBlockingRestriction({ id: contract.id, ptUserId }))) {
      return { active: false, contractId: null, reason: "PT_RESTRICTED" as const };
    }
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
  async pay(
    contractId: string, clientUserId: string, provider?: string, platform?: "web" | "mobile", returnBaseUrl?: string,
  ) {
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

    // No new business with a restricted PT: payment is refused BEFORE any checkout exists, so the
    // client is never charged. The contract itself is left exactly as it is — its payment deadline
    // keeps running and the deadline sweep may cancel it.
    await assertPtAcceptsNewBusiness(contract.ptUserId, "PAY_CONTRACT");

    // Quá hạn thanh toán thì từ chối ngay, không đợi sweep kịp huỷ.
    if (contract.paymentDueAt && contract.paymentDueAt.getTime() <= Date.now()) {
      throw codedErr(
        `Hợp đồng đã quá hạn thanh toán (${CONTRACT_PAYMENT_DEADLINE_HOURS} giờ kể từ khi PT chấp nhận) nên không thể thanh toán. Vui lòng tạo yêu cầu mới.`,
        409,
        PAYMENT_DEADLINE_PASSED,
      );
    }

    // Gym-tied: re-check the partnership BEFORE any money can move (the checkout below is the
    // first point at which the client's money is touched).
    await assertGymStillAcceptsContract(contract);
    // Codex #6: and the membership must still cover the whole fixed-duration contract (nothing is charged on a refusal).
    await assertGymContractStillCovered(contract, "CLIENT");

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
      platform,
      returnBaseUrl,
    });

    // Checkout đã khởi tạo thành công: từ giờ học viên có thể trả tiền thêm một lúc nữa, nên dời
    // hạn tới ít nhất now + grace (không bao giờ lùi hạn). Cập nhật có điều kiện — chỉ khi hợp
    // đồng còn PENDING_PAYMENT. Thất bại ở đây KHÔNG làm hỏng yêu cầu thanh toán (checkout đã
    // tạo, học viên cần link): chỉ log; hậu quả là hạn cũ giữ nguyên và sweep có thể huỷ hợp đồng
    // trong lúc checkout còn mở.
    if (contract.paymentDueAt) {
      try {
        const extendTo = new Date(Date.now() + CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES * 60 * 1000);
        const once = checkoutExtensionOnce();
        if (!once) {
          logger.warn(
            { contractId: contract.id },
            "pay: CHECKOUT_EXTENSION_ONCE=false - the one-extension-per-contract rule (D13) is DISABLED, the payment deadline can be extended again and again",
          );
        }
        const { count } = await contractRepository.extendPaymentDueAt(contract.id, extendTo, { once });
        if (once && count === 0 && contract.paymentDueAt.getTime() < extendTo.getTime()) {
          logger.info({ contractId: contract.id }, "pay: payment deadline NOT extended again (CHECKOUT_EXTENSION_ONCE: one extension per contract)");
        }
      } catch (e) {
        logger.error(
          { contractId: contract.id, err: (e as Error)?.message },
          "pay: failed to extend paymentDueAt after checkout creation",
        );
      }
    }

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
    // A payment that was already in flight when the PT got restricted must not start a new contract:
    // answered with the definite 409 CONTRACT_NOT_ACTIVATABLE so payment-service refunds the client in
    // full (the existing path). A replay of a payment that ALREADY activated the contract (status
    // ACTIVE with this transaction) is not "new business" and falls through to the idempotent branch.
    // (prisma directly, like activateIfPendingGuarded below: this is a read of the row, not a repository seam)
    const beforeActivation = await prisma.contract.findUnique({ where: { id: contractId }, select: { status: true, ptUserId: true } });
    if (beforeActivation?.status === ContractStatus.PENDING_PAYMENT && (await getActiveRestriction(beforeActivation.ptUserId))) {
      logger.warn(
        { contractId, transactionId },
        "activate-after-payment: PT is restricted — refusing the activation, payment-service will refund the client",
      );
      throw Object.assign(
        err("Contract cannot be activated by this payment (the trainer is temporarily unavailable)", 409),
        { code: CONTRACT_NOT_ACTIVATABLE, currentStatus: beforeActivation.status },
      );
    }
    // Một lần ghi có điều kiện (WHERE status = PENDING_PAYMENT) thay cho đọc-rồi-ghi: một lệnh huỷ
    // chen vào giữa không thể bị ghi đè thành ACTIVE. `flipped` chỉ đúng cho lần gọi thực sự
    // chuyển trạng thái — các lần webhook/sweep gọi lại không gửi lại email.
    const { contract: current, flipped } = await contractRepository.activateIfPendingGuarded(
      contractId,
      transactionId,
    );

    // Câu trả lời PHẢI phân biệt được cho payment-service (nó đã chuyển tiền vào escrow TRƯỚC khi
    // gọi tới đây): chỉ coi là kích hoạt khi hợp đồng đang ACTIVE bằng đúng giao dịch NÀY (vừa
    // chuyển, hoặc phát lại cùng giao dịch). Mọi trường hợp khác — đã huỷ/từ chối/hết hạn/hoàn
    // thành, chưa tới bước thanh toán, hoặc ACTIVE bằng một giao dịch KHÁC — là câu trả lời dứt
    // khoát "không kích hoạt được" (409), không phải lỗi 5xx, để payment-service hoàn tiền cho
    // học viên thay vì đánh dấu đã kích hoạt rồi để tiền kẹt.
    const activatedByThisPayment =
      current?.status === ContractStatus.ACTIVE && current.paymentTransactionId === transactionId;
    if (!activatedByThisPayment) {
      const currentStatus = current?.status ?? "NOT_FOUND";
      logger.warn(
        { contractId, transactionId, currentStatus, activePaymentTransactionId: current?.paymentTransactionId ?? null },
        "activate-after-payment: contract cannot be activated by this payment — payment-service will refund it",
      );
      throw Object.assign(
        err(`Contract cannot be activated by this payment (status ${currentStatus})`, 409),
        { code: CONTRACT_NOT_ACTIVATABLE, currentStatus },
      );
    }
    const activated = current;

    // Payment confirmation is where the two parties currently have the least confirmation
    // they've actually got a deal — send the notice here rather than at signing, since
    // signing may itself be bypassed (REQUIRE_CONTRACT_ESIGN). Only on the transition that
    // actually just happened: activateIfPending is called again on webhook retries, and a
    // retry must not re-email both parties.
    if (flipped) {
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
