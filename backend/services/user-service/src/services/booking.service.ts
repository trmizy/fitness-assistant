import { createHmac } from "crypto";
import { logger } from "@gym-coach/shared";
import {
  AuditEntityType,
  SessionStatus,
  SessionDisputeType,
  SessionMode,
  ContractStatus,
  DayOfWeek,
  Prisma,
} from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import {
  releaseSessionMoney,
  compensateNoShowMoney,
} from "./contract-payout.service";
import { resolveSessionOutcome } from "./session-outcome";
import { availabilityRepository } from "../repositories/availability.repository";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { contractService, getRemainingEntitlements } from "./contract.service";
import { auditService } from "./audit.service";

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How long the client has to confirm or dispute before the session auto-confirms. */
export const AUTO_CONFIRM_DAYS = Number(
  process.env.SESSION_AUTO_CONFIRM_DAYS ?? "3",
);
const AUTO_CONFIRM_MS = AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1000;

/**
 * Vòng 4 / Phase E1 — a grace window after scheduledStartAt before EITHER side may report the
 * other one no-show. Without this, a party arriving 2 minutes late could be reported the
 * instant the clock passed the scheduled time. Applies both directions — markNoShow (PT
 * reports client, or admits their own absence) and reportPtNoShow (client reports PT) —
 * neither is more lenient than the other.
 */
export const NO_SHOW_GRACE_MINUTES = Number(
  process.env.NO_SHOW_GRACE_MINUTES ?? "15",
);
const NO_SHOW_GRACE_MS = NO_SHOW_GRACE_MINUTES * 60 * 1000;

// ── Open-room online sessions ("meeting room", not a 1:1 ring call) ─────────────
// Room opens before the scheduled start so neither side has to hit the exact second, and
// closes hard at scheduledEndAt (== scheduledStartAt + the contract's own session duration) —
// no grace tail on the close, a session mid-sentence is cut exactly like a real Meet/Teams
// call would be. ROOM_LATE_GRACE_MS deliberately reuses NO_SHOW_GRACE_MINUTES (same 15
// minutes, same tunable) rather than a second constant — "how long is a reasonable grace
// window past the start time" is one policy question, not two independent numbers to keep in
// sync by hand.
export const ROOM_OPEN_BEFORE_MINUTES = Number(
  process.env.ROOM_OPEN_BEFORE_MINUTES ?? "15",
);
const ROOM_OPEN_BEFORE_MS = ROOM_OPEN_BEFORE_MINUTES * 60 * 1000;
const ROOM_LATE_GRACE_MS = NO_SHOW_GRACE_MS;

/** Collaborators of {@link deductQuotaOnce}, injectable so the once-only rule is testable. */
export interface QuotaDeps {
  claimDeduction: (sessionId: string) => Promise<boolean>;
  incrementSession: (contractId: string) => Promise<unknown>;
  checkAndCompleteContract: (contractId: string) => Promise<unknown>;
  releaseMoney: (contractId: string, sessionId: string) => Promise<void>;
}

const defaultQuotaDeps: QuotaDeps = {
  claimDeduction: (id) => sessionRepository.claimDeduction(id),
  incrementSession: (id) => contractRepository.incrementSession(id),
  checkAndCompleteContract: (id) => contractService.checkAndCompleteContract(id),
  releaseMoney: (contractId, sessionId) => releaseSessionMoney(contractId, sessionId),
};

/**
 * Consumes exactly one session of the contract's quota, once and only once, and pays out that
 * session's share of the money.
 *
 * `claimDeduction` is a guarded update on `sessionDeducted` (false → true) that reports
 * whether it actually claimed the row; the contract counter is incremented ONLY then. Two
 * concurrent confirms, a retry, or a manual confirm racing the auto-confirm sweep therefore
 * still cost the client a single session.
 *
 * The money release hangs off the same claim. Quota and payout are two views of one fact —
 * "this session was delivered" — so gating both on the single compare-and-swap is what stops
 * a retry from paying the PT twice for one session.
 *
 * Returns true when this call is the one that consumed the quota.
 */
export async function deductQuotaOnce(
  sessionId: string,
  contractId: string,
  deps: QuotaDeps = defaultQuotaDeps,
): Promise<boolean> {
  const claimed = await deps.claimDeduction(sessionId);
  if (!claimed) return false;
  await deps.incrementSession(contractId);
  await deps.releaseMoney(contractId, sessionId);
  await deps.checkAndCompleteContract(contractId);
  return true;
}

/**
 * The slot rules a booking must satisfy: inside the trainer's published hours, not on a
 * blocked date, and not overlapping another session.
 *
 * Extracted so rescheduling enforces exactly what booking does. Two copies of these checks
 * would drift, and the drift would show up as a double-booked trainer.
 */
async function assertSlotBookable(
  ptUserId: string,
  startAt: Date,
  endAt: Date,
  excludeSessionId?: string,
  db?: Prisma.TransactionClient,
): Promise<void> {
  // P0 cluster H2: db (when passed) threads through ONLY to the conflict check — the one
  // part of this function that needs to run on the SAME connection currently holding the
  // per-PT advisory lock, so its result is atomic with the write that follows it. The
  // availability/exception reads below are read-only, slow-changing data — no correctness
  // reason to route them through the transaction too.
  const conflict = await sessionRepository.findConflict(
    ptUserId,
    startAt,
    endAt,
    excludeSessionId,
    undefined,
    db,
  );
  if (conflict) throw err("Khung giờ này trùng với một buổi tập khác", 409);

  // Money-flow plan 3.5: same inversion as bookSession — no published hours now blocks
  // rather than allowing anything, so a reschedule cannot land a PT in a slot outside what
  // they have (or have not) published either.
  const ptAvailability = await availabilityRepository.findByPT(ptUserId);
  if (ptAvailability.length === 0) {
    throw err("Huấn luyện viên chưa công bố lịch rảnh — chưa thể dời lịch", 400);
  }

  const dayOfWeek = DAY_MAP[startAt.getDay()];
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const slot = ptAvailability.find(
    (a) =>
      a.dayOfWeek === dayOfWeek &&
      a.isActive &&
      a.startTime <= hhmm(startAt) &&
      a.endTime >= hhmm(endAt),
  );
  if (!slot) throw err("Thời gian này nằm ngoài khung giờ rảnh của huấn luyện viên", 400);

  const dayStart = new Date(startAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startAt);
  dayEnd.setHours(23, 59, 59, 999);
  const exceptions = await availabilityRepository.findExceptions(ptUserId, dayStart, dayEnd);
  if (exceptions.length > 0) throw err("Huấn luyện viên nghỉ vào ngày này", 400);
}

/**
 * P0 cluster B2 — serializes concurrent writes that could otherwise both pass a check before
 * either commits (the classic TOCTOU double-booking race): two clients booking the same PT's
 * time slot, or two bookings against the same contract both squeezing under the quota limit.
 *
 * `pg_advisory_xact_lock` is transaction-scoped — released automatically at commit or
 * rollback — so this needs no schema change or new migration. Locking on the PT's id
 * serializes every booking-affecting write for that PT regardless of which contract it goes
 * through; the optional contractId additionally serializes the quota check for one specific
 * contract. `hashtext` maps the id to a 32-bit lock key — a collision between two unrelated
 * PTs only costs a little unnecessary serialization, never a correctness bug, since the real
 * checks still run (for real, against post-lock committed data) inside the lock either way.
 */
async function withPtScheduleLock<T>(
  ptUserId: string,
  contractId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ptUserId}))`;
    if (contractId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contractId}))`;
    }
    return fn(tx);
  });
}

export const bookingService = {
  // ── Client books a session ──────────────────────────────────────
  async bookSession(
    clientUserId: string,
    contractId: string,
    data: {
      scheduledDate: string; // "2026-03-25"
      scheduledTime: string; // "09:00"
      sessionMode?: string;
      location?: string;
      notes?: string;
    },
  ) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);

    // Must be the client of this contract
    if (contract.clientUserId !== clientUserId) {
      throw err("Not authorized", 403);
    }

    // A suspended PT has had their contracts unwound and refunded — no new sessions on top.
    const ptProfile = await profileRepository.findByUserId(contract.ptUserId);
    if ((ptProfile as any)?.ptSuspended) {
      throw err("Huấn luyện viên hiện không nhận lịch mới", 409);
    }

    // Contract must be ACTIVE
    if (contract.status !== ContractStatus.ACTIVE) {
      throw err("Contract is not active", 400);
    }

    // BR-28: session mode must match contract mode
    if (contract.sessionMode) {
      if (!data.sessionMode) {
        data.sessionMode = contract.sessionMode as string;
      } else if (data.sessionMode !== contract.sessionMode) {
        throw err(
          `Session mode must match contract: expected ${contract.sessionMode}`,
          400,
        );
      }
    }

    // Parse datetime. Money-flow plan 3.4: duration comes ONLY from the contract's own
    // frozen snapshot, never the request body — a client calling the API directly used to be
    // able to book e.g. 180 minutes against a package sold as 60.
    const durationMin = contract.sessionDurationMinutes ?? 60;
    const startAt = new Date(`${data.scheduledDate}T${data.scheduledTime}:00`);
    if (isNaN(startAt.getTime())) {
      throw err("Invalid date/time", 400);
    }
    const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

    // Must be in the future
    if (startAt <= new Date()) {
      throw err("Cannot book a session in the past", 400);
    }

    // BR-30: must be booked at least 24 hours in advance
    if (startAt.getTime() - Date.now() < CANCEL_WINDOW_MS) {
      throw err("Sessions must be booked at least 24 hours in advance", 400);
    }

    // Check contract date range
    if (contract.endDate && startAt > contract.endDate) {
      throw err("Session date is past the contract end date", 400);
    }

    // Check PT availability. Money-flow plan 3.5: a PT who never published a weekly schedule
    // used to be treated as bookable at ANY hour ("no published hours = no constraint") — the
    // exact opposite of what an empty schedule should mean. Inverted: no published hours now
    // blocks booking entirely, with a clear message telling the client why.
    const ptAvailability = await availabilityRepository.findByPT(
      contract.ptUserId,
    );
    if (ptAvailability.length === 0) {
      throw err("Huấn luyện viên chưa công bố lịch rảnh — chưa thể đặt lịch", 400);
    }
    {
      const dayOfWeek = DAY_MAP[startAt.getDay()];
      const timeStr = `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`;
      const endTimeStr = `${String(endAt.getHours()).padStart(2, "0")}:${String(endAt.getMinutes()).padStart(2, "0")}`;

      const matchingSlot = ptAvailability.find(
        (a) =>
          a.dayOfWeek === dayOfWeek &&
          a.isActive &&
          a.startTime <= timeStr &&
          a.endTime >= endTimeStr,
      );
      if (!matchingSlot) {
        throw err("This time is outside the trainer's available hours", 400);
      }

      // Check blocked dates
      const dayStart = new Date(startAt);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startAt);
      dayEnd.setHours(23, 59, 59, 999);
      const exceptions = await availabilityRepository.findExceptions(
        contract.ptUserId,
        dayStart,
        dayEnd,
      );
      if (exceptions.length > 0) {
        throw err("The trainer is not available on this date", 400);
      }
    }

    // P0 cluster B1 + B2: the session-limit check and the PT time-conflict check both have to
    // run again right here, inside the same lock as the create — everything validated above
    // (dates, PT availability, blocked days) is static/slow-changing and does not need to be
    // re-checked under lock, but "how many active sessions does this contract have" and "does
    // the PT already have something in this slot" can both change between two concurrent
    // requests. Without the lock, two requests can each read the pre-write count/conflict
    // state, both see room, and both create — one contract oversold, or the PT double-booked.
    const session = await withPtScheduleLock(contract.ptUserId, contractId, async (tx) => {
      // Vòng 4 / Phase A3: `contract` above was read BEFORE the lock was ever acquired — by
      // the time we're in here, another session on this same contract may have completed or
      // been compensated (raising usedSessions/compensatedSessions) without that ever
      // reaching this stale copy. countActiveByContract was already reading fresh via `tx`;
      // checking a fresh count against a stale contract defeats the lock's own purpose, since
      // half the comparison still reflects pre-lock state. Re-read on this transaction's own
      // connection so both sides of the comparison are equally fresh.
      const freshContract = await contractRepository.findById(contractId, tx);
      if (!freshContract) throw err("Contract not found", 404);

      const activeSessionCount = await sessionRepository.countActiveByContract(contractId, tx);
      if (getRemainingEntitlements(freshContract) <= activeSessionCount) {
        throw err("Session limit reached for this contract", 400);
      }

      const conflict = await sessionRepository.findConflict(
        contract.ptUserId,
        startAt,
        endAt,
        undefined,
        undefined,
        tx,
      );
      if (conflict) {
        throw err("This time slot conflicts with another session", 409);
      }

      return sessionRepository.create(
        {
          contractId,
          clientUserId,
          ptUserId: contract.ptUserId,
          sessionMode: (data.sessionMode as SessionMode) || SessionMode.OFFLINE,
          scheduledStartAt: startAt,
          scheduledEndAt: endAt,
          location: data.location,
          notes: data.notes,
        },
        tx,
      );
    });

    // Notify PT
    await notificationService
      .create({
        userId: contract.ptUserId,
        text: "New session booking request",
        eventType: "SESSION_BOOKED",
        entityType: "SESSION",
        entityId: session.id,
        link: "/pt/contracts",
      })
      .catch(() => {});

    return session;
  },

  // ── PT confirms a session ───────────────────────────────────────
  /**
   * Vòng 4 / Phase A2: this used to check status/conflict once, outside any lock, then write
   * unconditionally — no re-check against contract.status/endDate/ptSuspended/entitlement at
   * all, and not run inside withPtScheduleLock the way bookSession is, so two confirms for two
   * sessions in the same PT slot could both pass the conflict check before either committed.
   * The cheap 404/403 checks below stay outside the lock (no point paying lock-acquisition
   * cost for a request that is invalid regardless); everything the lock exists to protect is
   * re-read fresh, on the transaction's own connection, INSIDE it.
   */
  async confirmSession(sessionId: string, ptUserId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.REQUESTED) {
      throw err(`Cannot confirm session in ${session.status} status`, 400);
    }

    await withPtScheduleLock(session.ptUserId, session.contractId, async (tx) => {
      const freshSession = await tx.session.findUnique({ where: { id: sessionId } });
      if (!freshSession) throw err("Session not found", 404);
      if (freshSession.status !== SessionStatus.REQUESTED) {
        throw err(`Cannot confirm session in ${freshSession.status} status`, 400);
      }

      const contract = await contractRepository.findById(freshSession.contractId, tx);
      if (!contract) throw err("Contract not found", 404);
      if (contract.status !== ContractStatus.ACTIVE) {
        throw err("Hợp đồng không còn hiệu lực", 409);
      }
      if (contract.endDate && contract.endDate < new Date()) {
        throw err("Hợp đồng đã hết hạn", 409);
      }

      // Same rule bookSession enforces before ever creating a session — a suspended PT's
      // contracts are already unwound/refunded, so nothing of theirs should progress either.
      const ptProfile = await profileRepository.findByUserId(ptUserId);
      if ((ptProfile as any)?.ptSuspended) {
        throw err("Huấn luyện viên hiện không nhận lịch mới", 409);
      }

      // This session is REQUESTED right now, one of the five statuses countActiveByContract
      // treats as still holding a claim — so it is already counted in activeSessionCount, and
      // confirming it (REQUESTED → CONFIRMED, both "holding" statuses) does not add a new
      // claim. The question here is not bookSession's "is there room for one more" (`<=`); it
      // is "does entitlement still cover everything already committed, this session included"
      // — blocked only if entitlement has fallen strictly below what is already held (e.g.
      // another session on the same contract completed/was compensated since this one was
      // requested, using up entitlement this one was counting on).
      const activeSessionCount = await sessionRepository.countActiveByContract(contract.id, tx);
      if (getRemainingEntitlements(contract) < activeSessionCount) {
        throw err("Hợp đồng không còn đủ quyền lợi cho buổi tập này", 409);
      }

      // BR-31: block if PT already has a CONFIRMED session in same slot — re-checked on tx.
      const conflict = await sessionRepository.findConflict(
        freshSession.ptUserId,
        freshSession.scheduledStartAt,
        freshSession.scheduledEndAt,
        freshSession.id,
        [SessionStatus.CONFIRMED],
        tx,
      );
      if (conflict) {
        throw err("PT has a conflicting session in this time slot", 409);
      }

      const won = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.REQUESTED],
        SessionStatus.CONFIRMED,
        undefined,
        tx,
      );
      if (!won) throw err("Buổi tập đã được xử lý", 409);
    });

    const updated = await sessionRepository.findById(sessionId);

    await notificationService
      .create({
        userId: session.clientUserId,
        text: "Your session has been confirmed",
        eventType: "SESSION_CONFIRMED",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/client/booking",
      })
      .catch(() => {});

    return updated;
  },

  // ── PT reports the session as delivered ─────────────────────────
  /**
   * Moves the session to PENDING_CLIENT_CONFIRMATION instead of COMPLETED. The PT's word
   * alone no longer consumes the client's quota — the client confirms, disputes, or the
   * auto-confirm job settles it after AUTO_CONFIRM_DAYS.
   */
  async completeSession(sessionId: string, ptUserId: string, ptNotes?: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err(`Cannot complete session in ${session.status} status`, 400);
    }
    // P0 cluster B3: "completed" means the whole session happened — gated on scheduledEndAt
    // (not scheduledStartAt), unlike the no-show checks below, which only need to establish
    // that the moment someone was due to arrive has passed. Nothing enforced this before: a
    // PT could report a session delivered seconds after confirming it, well before any actual
    // training took place.
    if (session.scheduledEndAt.getTime() > Date.now()) {
      throw err("Chưa tới giờ kết thúc buổi tập — chưa thể báo hoàn thành", 400);
    }

    const deadline = new Date(Date.now() + AUTO_CONFIRM_MS);
    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.PENDING_CLIENT_CONFIRMATION,
      {
        ptNotes: ptNotes || undefined,
        clientConfirmDeadline: deadline,
      },
    );

    await notificationService
      .create({
        userId: session.clientUserId,
        text: `PT đã báo hoàn thành buổi tập. Vui lòng xác nhận trước ${deadline.toLocaleDateString("vi-VN")} — quá hạn hệ thống sẽ tự xác nhận.`,
        eventType: "SESSION_PENDING_CONFIRMATION",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/client/booking",
      })
      .catch(() => {});

    return updated;
  },

  // ── Client confirms the session actually happened ───────────────
  async clientConfirmSession(sessionId: string, clientUserId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== clientUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.PENDING_CLIENT_CONFIRMATION) {
      throw err(`Cannot confirm a session in ${session.status} status`, 400);
    }

    const deducted = await deductQuotaOnce(sessionId, session.contractId);
    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.COMPLETED,
      { completedAt: new Date() },
    );

    await notificationService
      .create({
        userId: session.ptUserId,
        text: "Khách hàng đã xác nhận buổi tập",
        eventType: "SESSION_COMPLETED",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/pt/schedule",
      })
      .catch(() => {});

    return { ...updated, quotaDeducted: deducted };
  },

  // ── Client disputes what the PT reported ────────────────────────
  async disputeSession(
    sessionId: string,
    clientUserId: string,
    reason: string,
  ) {
    if (!reason?.trim()) throw err("Dispute reason is required", 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== clientUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.PENDING_CLIENT_CONFIRMATION) {
      throw err(`Cannot dispute a session in ${session.status} status`, 400);
    }

    // Vòng 4 / Phase E4 — audit/admin-screen only: PENDING_CLIENT_CONFIRMATION is entered from
    // two different origins (completeSession's "it happened", or markNoShow's "client
    // no-show" — see that function's own ptNotes: "Client no-show"), and disputeSession is the
    // shared exit for both. ptNotes is the only signal distinguishing which one this is.
    const disputeType: SessionDisputeType =
      session.ptNotes === "Client no-show"
        ? SessionDisputeType.CLIENT_NO_SHOW_CLAIM
        : SessionDisputeType.DELIVERY_DISPUTE;

    // Quota is deliberately left untouched — an admin decides in resolveDispute.
    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.DISPUTED,
      { disputeReason: reason.trim(), disputedAt: new Date(), disputeType },
    );

    await notificationService
      .create({
        userId: session.ptUserId,
        text: "Khách hàng đã khiếu nại buổi tập — chờ quản trị viên phân xử",
        eventType: "SESSION_DISPUTED",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/pt/schedule",
      })
      .catch(() => {});

    return updated;
  },

  // ── Admin rules on a disputed session ───────────────────────────
  /**
   * P0 cluster B5: a DISPUTED session can arrive here from either direction —
   * disputeSession (client disputes what the PT reported as delivered) or
   * respondToNoShowReport's DENY branch (PT denies a client's no-show report). The first
   * direction only ever needed COMPLETED/CANCELLED. The second needed a third outcome:
   * confirming the client was right settles exactly like markNoShow's PT-self-admit branch
   * (cash compensation, quota untouched) — CANCELLED alone left the client uncompensated for
   * a PT absence an admin had just confirmed really happened, the same session's value a
   * self-admitted no-show always pays out simply vanishing depending on which path got there.
   */
  async resolveDispute(
    sessionId: string,
    adminId: string,
    resolution: "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED",
    note: string,
  ) {
    if (!note?.trim()) throw err("Resolution note is required", 400);
    if (resolution !== "COMPLETED" && resolution !== "CANCELLED" && resolution !== "PT_NO_SHOW_CONFIRMED") {
      throw err("Resolution must be COMPLETED, CANCELLED, or PT_NO_SHOW_CONFIRMED", 400);
    }

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.status !== SessionStatus.DISPUTED) {
      throw err(`Session is not disputed (status ${session.status})`, 400);
    }

    if (resolution === "PT_NO_SHOW_CONFIRMED") {
      const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.NO_SHOW, {
        resolvedBy: adminId,
        resolutionNote: note.trim(),
        resolvedAt: new Date(),
        ptNotes: "Quản trị viên xác nhận huấn luyện viên vắng mặt",
        // Vòng 4 / Phase E2 — counts toward the client's right to terminate after 3.
        ptAtFault: true,
      });

      // Same settlement markNoShow's PT-self-admit branch uses — cash compensation, charged
      // to the three parties in proportion, the client's quota never touched.
      await compensateNoShowMoney(session.contractId, sessionId);
      await contractService.checkAndCompleteContract(session.contractId);

      for (const userId of [session.clientUserId, session.ptUserId]) {
        await notificationService
          .create({
            userId,
            text: "Quản trị viên xác nhận huấn luyện viên vắng mặt — khách được hoàn tiền một buổi, buổi tập không bị trừ",
            eventType: "SESSION_DISPUTE_RESOLVED",
            entityType: "SESSION",
            entityId: sessionId,
            link: userId === session.clientUserId ? "/client/wallet" : "/pt/schedule",
          })
          .catch(() => {});
      }

      return { ...updated, quotaDeducted: false };
    }

    // Only a COMPLETED ruling costs the client a session.
    const deducted =
      resolution === "COMPLETED"
        ? await deductQuotaOnce(sessionId, session.contractId)
        : false;

    const updated = await sessionRepository.updateStatus(
      sessionId,
      resolution === "COMPLETED"
        ? SessionStatus.COMPLETED
        : SessionStatus.CANCELLED,
      {
        resolvedBy: adminId,
        resolutionNote: note.trim(),
        resolvedAt: new Date(),
        ...(resolution === "COMPLETED"
          ? { completedAt: new Date() }
          : { cancelledBy: "ADMIN", cancellationReason: note.trim() }),
      },
    );

    for (const userId of [session.clientUserId, session.ptUserId]) {
      await notificationService
        .create({
          userId,
          text: `Quản trị viên đã phân xử buổi tập: ${resolution === "COMPLETED" ? "tính là đã hoàn thành" : "huỷ, không trừ buổi"}`,
          eventType: "SESSION_DISPUTE_RESOLVED",
          entityType: "SESSION",
          entityId: sessionId,
          link: userId === session.clientUserId ? "/client/booking" : "/pt/schedule",
        })
        .catch(() => {});
    }

    return { ...updated, quotaDeducted: deducted };
  },

  /** Sessions waiting on this client's confirmation (what the client must act on). */
  async listPendingConfirmation(clientUserId: string) {
    return sessionRepository.findByStatusForUser(clientUserId, [
      SessionStatus.PENDING_CLIENT_CONFIRMATION,
    ]);
  },

  // Money-flow plan 4.3: sessions where a client reported this PT as a no-show, awaiting the
  // PT's response.
  async listNoShowReportsForPT(ptUserId: string) {
    return sessionRepository.findByStatusForPT(ptUserId, [
      SessionStatus.PT_NO_SHOW_REPORTED,
    ]);
  },

  async listDisputed() {
    return sessionRepository.findDisputed();
  },

  // ── Cancel session (either party) ──────────────────────────────
  async cancelSession(sessionId: string, userId: string, reason: string) {
    if (!reason?.trim()) throw err("Cancellation reason is required", 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== userId && session.ptUserId !== userId) {
      throw err("Not authorized", 403);
    }
    if (
      session.status !== SessionStatus.REQUESTED &&
      session.status !== SessionStatus.CONFIRMED
    ) {
      throw err(`Cannot cancel session in ${session.status} status`, 400);
    }

    const isClient = userId === session.clientUserId;
    const otherUserId = isClient ? session.ptUserId : session.clientUserId;

    // REQUESTED (never confirmed) — nothing was ever committed, so matrix 0.1 does not apply
    // (same distinction addException makes for a not-yet-confirmed session): just cancel, no
    // money or quota either way.
    if (session.status === SessionStatus.REQUESTED) {
      // Vòng 4 / Phase A1: CAS on the read-above status, not an unconditional write — a
      // second concurrent cancel (or anything else that moved this session on) gets `false`
      // here and must stop, not repeat whatever this branch already decided.
      const won = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.REQUESTED],
        SessionStatus.CANCELLED,
        { cancelledBy: userId, cancellationReason: reason.trim(), sessionDeducted: false },
      );
      if (!won) throw err("Buổi tập đã được xử lý", 409);
      const updated = await sessionRepository.findById(sessionId);
      await notificationService
        .create({
          userId: otherUserId,
          text: isClient ? "Client cancelled a session" : "Trainer cancelled the session",
          eventType: "SESSION_CANCELLED",
          entityType: "SESSION",
          entityId: sessionId,
          link: isClient ? "/pt/contracts" : "/client/booking",
        })
        .catch(() => {});
      return updated;
    }

    // CONFIRMED — money-flow plan 3.1: routed through the single shared matrix
    // (session-outcome.ts) instead of deciding independently, so a PT cancelling directly
    // here produces the SAME outcome as blocking the whole date via addException. Before this
    // fix, a PT cancelling here NEVER compensated the client regardless of notice — the exact
    // incentive problem the plan describes.
    const hoursBeforeStart = (session.scheduledStartAt.getTime() - Date.now()) / (60 * 60 * 1000);
    const outcome = resolveSessionOutcome({
      actor: isClient ? "CLIENT" : "PT",
      event: "CANCEL",
      hoursBeforeStart,
    });

    // Vòng 4 / Phase A1 — the actual P0: `updateStatus` used to be an unconditional write with
    // NO status precondition, so two concurrent cancels on the same CONFIRMED session both
    // read CONFIRMED, both wrote CANCELLED, and both ran the DEDUCT branch below — the ONE
    // quota-increment path in the whole system that `deductQuotaOnce`'s claimDeduction guard
    // does not cover, since it goes through contractRepository.incrementSession directly. A
    // double increment here can push usedSessions + compensatedSessions past totalSessions,
    // which payment-service's contract-money.ts validate() throws on — permanently blocking
    // terminateContractMoney and leaving the contract's escrow stuck with no way out short of
    // a manual DB fix. The CAS below makes only the winning request run any side effect at all.
    const won = await sessionRepository.transitionStatus(
      sessionId,
      [SessionStatus.CONFIRMED],
      outcome.sessionStatus,
      {
        cancelledBy: userId,
        cancellationReason: reason.trim(),
        sessionDeducted: outcome.clientQuotaEffect === "DEDUCT",
      },
    );
    if (!won) throw err("Buổi tập đã được xử lý", 409);

    // Same order deductQuotaOnce uses (charge, then release/compensate, then check
    // completion) so a contract that finishes on its very last session settles with this
    // session's money already moved.
    if (outcome.clientQuotaEffect === "DEDUCT") {
      await contractRepository.incrementSession(session.contractId);
    }
    if (outcome.ptPayout) {
      await releaseSessionMoney(session.contractId, sessionId);
    }
    if (outcome.clientCompensation) {
      await compensateNoShowMoney(session.contractId, sessionId);
    }
    if (outcome.clientQuotaEffect === "DEDUCT" || outcome.ptPayout || outcome.clientCompensation) {
      await contractService.checkAndCompleteContract(session.contractId);
    }

    const updated = await sessionRepository.findById(sessionId);

    await notificationService
      .create({
        userId: otherUserId,
        text: isClient ? "Client cancelled a session" : "Trainer cancelled the session",
        eventType: "SESSION_CANCELLED",
        entityType: "SESSION",
        entityId: sessionId,
        link: isClient ? "/pt/contracts" : "/client/booking",
      })
      .catch(() => {});

    return updated;
  },

  // ── Mark no-show ────────────────────────────────────────────────
  async markNoShow(
    sessionId: string,
    userId: string,
    noShowBy: "CLIENT" | "PT",
  ) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);

    // Only PT or admin can mark no-show
    if (session.ptUserId !== userId) {
      throw err("Only the PT can mark no-show", 403);
    }
    // Money-flow plan 4.3: also reachable from PT_NO_SHOW_REPORTED — respondToNoShowReport
    // calls straight into this same function when the PT agrees with the client's report,
    // rather than re-implementing the exact same compensation logic a second time.
    if (
      session.status !== SessionStatus.CONFIRMED &&
      session.status !== SessionStatus.PT_NO_SHOW_REPORTED
    ) {
      throw err(
        `Cannot mark no-show for session in ${session.status} status`,
        400,
      );
    }
    // P0 cluster B4: reportPtNoShow (the client-reports-PT-no-show direction) has always
    // gated on scheduledStartAt — this direction (PT reports the client, or admits their own
    // absence) never did, so a PT could mark a client no-show for a session that had not
    // happened yet. Same field, same cutoff, for consistency with that existing check.
    // Vòng 4 / Phase E1: + a grace window (NO_SHOW_GRACE_MINUTES) past that cutoff.
    if (session.scheduledStartAt.getTime() + NO_SHOW_GRACE_MS > Date.now()) {
      throw err(
        `Chưa thể báo vắng mặt — cần đợi ít nhất ${NO_SHOW_GRACE_MINUTES} phút sau giờ hẹn`,
        400,
      );
    }

    const isClientNoShow = noShowBy === "CLIENT";

    // A PT admitting their own absence is not a claim against anyone: settle it straight
    // away as NO_SHOW with no quota cost. Accusing the CLIENT of not showing up DOES cost
    // the client a session, so it goes through the same confirmation window as a completed
    // session rather than being charged on the PT's say-so.
    //
    // Money-flow plan 3.1: routed through the shared matrix (session-outcome.ts) — matrix row
    // 5 always compensates a PT no-show regardless of notice, so the outcome here is fixed,
    // but this call site must still go through the SAME function as addException/cancelSession
    // rather than hardcoding the same values independently.
    if (!isClientNoShow) {
      const outcome = resolveSessionOutcome({ actor: "PT", event: "NO_SHOW", hoursBeforeStart: 0 });

      const updated = await sessionRepository.updateStatus(
        sessionId,
        outcome.sessionStatus,
        {
          sessionDeducted: outcome.clientQuotaEffect === "DEDUCT",
          ptNotes: "PT no-show",
          // Vòng 4 / Phase E2 — counts toward the client's right to terminate after 3.
          ptAtFault: true,
        },
      );

      // The client is owed one session's value in cash, charged back to the three parties.
      // Money-flow plan 1.6: this used to be uncaught on the theory that surfacing the error
      // protects the client — but the session above is already NO_SHOW by the time this runs,
      // and that status guard blocks every future retry attempt through this same endpoint. A
      // thrown error here would not undo the status change, only hide a stuck-forever
      // compensation behind a confusing "Cannot mark no-show for session in NO_SHOW status"
      // on retry. compensateNoShowMoney now records a failure for the settlement sweep to
      // retry instead of throwing — see session-settlement.service.ts.
      if (outcome.clientCompensation) {
        await compensateNoShowMoney(session.contractId, sessionId);
        await contractService.checkAndCompleteContract(session.contractId);
      }

      await notificationService
        .create({
          userId: session.clientUserId,
          text: "Huấn luyện viên vắng mặt. Bạn được hoàn tiền một buổi vào ví và buổi tập không bị trừ.",
          eventType: "SESSION_NO_SHOW_PT",
          entityType: "SESSION",
          entityId: sessionId,
          link: "/client/wallet",
        })
        .catch(() => {});

      return updated;
    }

    const deadline = new Date(Date.now() + AUTO_CONFIRM_MS);
    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.PENDING_CLIENT_CONFIRMATION,
      { ptNotes: "Client no-show", clientConfirmDeadline: deadline },
    );

    await notificationService
      .create({
        userId: session.clientUserId,
        text: `PT báo bạn vắng mặt. Nếu không đúng, hãy khiếu nại trước ${deadline.toLocaleDateString("vi-VN")} — quá hạn buổi tập sẽ bị trừ.`,
        eventType: "SESSION_PENDING_CONFIRMATION",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/client/booking",
      })
      .catch(() => {});

    return updated;
  },

  // ── Client reports the PT never showed up (money-flow plan 4.3) ──────
  // Before this, only the PT could ever call markNoShow — a client whose PT genuinely never
  // showed had no way to report it at all. Parks the session in PT_NO_SHOW_REPORTED until the
  // PT responds; nothing settles (quota untouched, no money moves) until then.
  async reportPtNoShow(sessionId: string, clientUserId: string, reason: string) {
    if (!reason?.trim()) throw err("Phải nêu lý do báo cáo", 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== clientUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err(`Cannot report a no-show for a session in ${session.status} status`, 400);
    }
    // Vòng 4 / Phase E1: same grace window as markNoShow's mirror check — both directions.
    if (session.scheduledStartAt.getTime() + NO_SHOW_GRACE_MS > Date.now()) {
      throw err(
        `Chưa thể báo huấn luyện viên vắng mặt — cần đợi ít nhất ${NO_SHOW_GRACE_MINUTES} phút sau giờ hẹn`,
        400,
      );
    }

    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.PT_NO_SHOW_REPORTED,
      { disputeReason: reason.trim(), disputedAt: new Date() },
    );

    await notificationService
      .create({
        userId: session.ptUserId,
        text: "Khách báo bạn vắng mặt buổi tập. Vui lòng phản hồi — xác nhận hoặc phản đối.",
        eventType: "SESSION_PT_NO_SHOW_REPORTED",
        entityType: "SESSION",
        entityId: sessionId,
        link: "/pt/schedule",
      })
      .catch(() => {});

    return updated;
  },

  // ── PT responds to a client's no-show report ──────────────────────────
  async respondToNoShowReport(
    sessionId: string,
    ptUserId: string,
    response: "AGREE" | "DENY",
    note?: string,
  ) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.PT_NO_SHOW_REPORTED) {
      throw err(`Cannot respond to a no-show report on a session in ${session.status} status`, 400);
    }

    if (response === "AGREE") {
      // The PT accepts the client's account — same outcome as a PT self-admitted no-show,
      // reusing that exact logic (compensation, notification) rather than duplicating it.
      return this.markNoShow(sessionId, ptUserId, "PT");
    }

    // DENY — escalate to an admin. Reuses the EXACT same DISPUTED state and admin-resolution
    // flow money-flow plan 4.2 built for the client-confirmation dispute path; the admin
    // screen there does not care which flow put a session into DISPUTED.
    const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.DISPUTED, {
      ptNotes: note?.trim() || "PT phản đối báo cáo vắng mặt của khách",
      disputedAt: new Date(),
      // Vòng 4 / Phase E4 — unambiguous here: the client's own claim was "PT no-showed"
      // (reportPtNoShow), and this is the PT contesting exactly that claim.
      disputeType: SessionDisputeType.PT_NO_SHOW_CLAIM,
    });

    return updated;
  },

  // ── Client reviews a completed session ──────────────────────────
  async reviewSession(
    sessionId: string,
    clientUserId: string,
    rating: number,
    comment?: string,
  ) {
    if (rating < 1 || rating > 5)
      throw err("Rating must be between 1 and 5", 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== clientUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.COMPLETED) {
      throw err("Can only review completed sessions", 400);
    }
    if (session.review) {
      throw err("Session already reviewed", 409);
    }

    return sessionRepository.createReview({
      sessionId,
      contractId: session.contractId,
      clientUserId,
      rating,
      comment,
    });
  },

  /** Mirror-image of reviewSession: the PT rates the CLIENT's conduct for a completed
   *  session, instead of the client rating the PT. */
  async reviewClient(
    sessionId: string,
    ptUserId: string,
    rating: number,
    comment?: string,
  ) {
    if (rating < 1 || rating > 5)
      throw err("Rating must be between 1 and 5", 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.COMPLETED) {
      throw err("Can only review completed sessions", 400);
    }
    if (session.clientReview) {
      throw err("Session already reviewed", 409);
    }

    return sessionRepository.createClientReview({
      sessionId,
      contractId: session.contractId,
      ptUserId,
      rating,
      comment,
    });
  },

  // ── Get sessions for a contract ─────────────────────────────────
  async getContractSessions(contractId: string, userId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err("Contract not found", 404);
    if (contract.clientUserId !== userId && contract.ptUserId !== userId) {
      throw err("Not authorized", 403);
    }
    return sessionRepository.findByContract(contractId);
  },

  // ── Get single session (used by chat-service to verify call permissions) ─
  async getSessionById(sessionId: string, userId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== userId && session.ptUserId !== userId) {
      throw err("Not authorized", 403);
    }
    return session;
  },

  // ── Generate join token for a coaching session call ─────────────
  async joinSession(sessionId: string, userId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);

    const isParticipant =
      session.clientUserId === userId || session.ptUserId === userId;
    if (!isParticipant) throw err("Not authorized", 403);

    if (session.status !== SessionStatus.CONFIRMED) {
      throw err("Session must be confirmed before joining", 400);
    }
    if (session.sessionMode !== SessionMode.ONLINE) {
      throw err("Session is not online — no call needed", 400);
    }

    // Open-room window: opens ROOM_OPEN_BEFORE_MINUTES early, closes hard at scheduledEndAt.
    // Re-checked on every join (not just the first), same as every other time-gated action in
    // this file — a token handed out before the room opened, or kept past close, would let a
    // stale client tab bypass the window entirely.
    const now = Date.now();
    const opensAt = session.scheduledStartAt.getTime() - ROOM_OPEN_BEFORE_MS;
    const closesAt = session.scheduledEndAt.getTime();
    if (now < opensAt) {
      throw err(
        `Phòng học mở trước giờ hẹn ${ROOM_OPEN_BEFORE_MINUTES} phút — vui lòng quay lại sau`,
        400,
      );
    }
    if (now >= closesAt) {
      throw err("Phòng học đã đóng — buổi tập đã kết thúc", 400);
    }

    // First-arrival attendance, immutable once set — see recordRoomJoin's own doc comment.
    // Best-effort: a write hiccup here must not block the join itself (the room-close sweep's
    // own resolution already treats a session with neither timestamp set conservatively, as
    // "nobody showed", so losing one write here is safe, just less generous to whoever it was).
    const isPt = session.ptUserId === userId;
    await sessionRepository
      .recordRoomJoin(sessionId, isPt ? "pt" : "client")
      .catch((e) =>
        logger.error({ error: "recordRoomJoin failed", sessionId, message: (e as Error).message }),
      );

    const otherUserId =
      session.ptUserId === userId ? session.clientUserId : session.ptUserId;

    const secret = process.env.INTERNAL_API_SECRET;
    if (!secret)
      throw err("Server misconfiguration: missing INTERNAL_API_SECRET", 500);

    const payload = {
      sessionId,
      userId,
      otherUserId,
      purpose: "JOIN_COACHING_SESSION",
      // Open-room redesign: minted right when "Tham gia buổi học" is clicked, but actually
      // spent only after the preview screen (choosing mic/cam) — a deliberate pause, not
      // meant to be rushed. 10 minutes (the old ring-call flow's value, back when clicking
      // "join" and actually joining were nearly the same instant) was too tight for that
      // gap and expired mid-preview in practice. 45 minutes comfortably covers realistic
      // deliberation time while staying a short-lived, clearly-bounded credential.
      exp: Date.now() + 45 * 60 * 1000,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");
    const joinToken = `${encoded}.${sig}`;

    return {
      sessionId,
      otherUserId,
      joinToken,
      sessionMode: session.sessionMode,
      status: session.status,
      scheduledStartAt: session.scheduledStartAt,
      scheduledEndAt: session.scheduledEndAt,
      // So the frontend's room UI (countdown, "closes in 5 min" warning) never has to
      // recompute or hardcode these constants itself.
      roomOpensAt: new Date(opensAt),
      roomClosesAt: session.scheduledEndAt,
      ptLateAfter: new Date(session.scheduledStartAt.getTime() + ROOM_LATE_GRACE_MS),
    };
  },

  // ── Get my upcoming sessions ────────────────────────────────────
  async getMyUpcoming(userId: string) {
    const sessions = await sessionRepository.findUpcomingByUser(userId);
    if (sessions.length === 0) return sessions;

    // Collect the "other party" IDs for each session
    const otherIds = [
      ...new Set(
        sessions.map((s) =>
          s.ptUserId === userId ? s.clientUserId : s.ptUserId,
        ),
      ),
    ];
    const profiles = await profileRepository.findByUserIds(otherIds);
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    return sessions.map((s) => {
      const otherId = s.ptUserId === userId ? s.clientUserId : s.ptUserId;
      const key = s.ptUserId === userId ? "clientProfile" : "ptProfile";
      return { ...s, [key]: profileMap.get(otherId) ?? null };
    });
  },

  // ── Session Rescheduling ────────────────────────────────────────

  async requestReschedule(
    sessionId: string,
    userId: string,
    data: {
      proposedStartAt: string;
      // P0 cluster H1: kept accepted-but-ignored on the input type only so a stale client
      // still sending it does not fail request validation — the actual end time is always
      // server-computed below, never read from here.
      proposedEndAt?: string;
      reason: string;
    }
  ) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);

    const isClient = session.clientUserId === userId;
    const isPT = session.ptUserId === userId;
    if (!isClient && !isPT) throw err("Not authorized", 403);

    // VĐ4: only a CONFIRMED session. A REQUESTED one has not been agreed yet — there is
    // nothing to move, and the PT can simply confirm it at a different time.
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err("Chỉ buổi tập đã xác nhận (CONFIRMED) mới được dời lịch", 400);
    }

    const now = new Date();
    if (session.scheduledStartAt.getTime() <= now.getTime()) {
      throw err("Không thể dời lịch sau khi buổi tập đã bắt đầu", 400);
    }
    const timeUntilStart = session.scheduledStartAt.getTime() - now.getTime();
    if (timeUntilStart < 12 * 60 * 60 * 1000) {
      throw err("Không thể dời lịch trong vòng 12 giờ trước buổi tập", 400);
    }

    if (!data.reason || !data.reason.trim()) {
      throw err("Phải nêu lý do dời lịch", 400);
    }
    if (data.reason.length > 500) {
      throw err("Lý do dời lịch tối đa 500 ký tự", 400);
    }

    // Only one open request per session. Without this both sides can have a proposal in
    // flight at once, and whichever is accepted second silently overwrites the first.
    const open = await sessionRepository.findOpenRescheduleRequest(sessionId);
    if (open) {
      throw err("Buổi tập này đang có một yêu cầu dời lịch chờ phản hồi", 409);
    }

    // At most two moves per session, counting both sides. Past that the honest option is to
    // cancel rather than keep pushing the booking around.
    const usedMoves = await sessionRepository.countAcceptedReschedules(sessionId);
    if (usedMoves >= 2) {
      throw err("Buổi tập này đã dời 2 lần — chỉ còn cách huỷ", 409);
    }

    const proposedStart = new Date(data.proposedStartAt);
    if (isNaN(proposedStart.getTime())) {
      throw err("Thời gian đề xuất không hợp lệ", 400);
    }
    if (proposedStart <= now) {
      throw err("Thời gian đề xuất phải ở tương lai", 400);
    }

    // P0 cluster H1: duration comes ONLY from the contract's own frozen snapshot, never the
    // request body — exactly the same discipline bookSession already follows (money-flow
    // plan 3.4). A direct-API caller used to be able to propose e.g. a 180-minute session
    // against a package sold as 60, by simply naming a different proposedEndAt.
    const contract = await contractRepository.findById(session.contractId);
    if (!contract) throw err("Contract not found", 404);
    const durationMin = contract.sessionDurationMinutes ?? 60;
    const proposedEnd = new Date(proposedStart.getTime() + durationMin * 60 * 1000);

    // The proposed slot has to survive the SAME checks a fresh booking does. Skipping this
    // was the real hole: a reschedule could put the trainer in two places at once, or outside
    // the hours they published, with no error at all.
    await assertSlotBookable(
      session.ptUserId,
      proposedStart,
      proposedEnd,
      sessionId,
    );

    const request = await sessionRepository.createRescheduleRequest({
      sessionId,
      requestedBy: isClient ? "CLIENT" : "PT",
      originalStartAt: session.scheduledStartAt,
      originalEndAt: session.scheduledEndAt,
      proposedStartAt: proposedStart,
      proposedEndAt: proposedEnd,
      reason: data.reason,
      status: "PENDING",
    });

    // The session deliberately stays CONFIRMED. A proposal is an offer, not a change: until
    // the other side accepts, the original booking is still what both parties owe each other,
    // and the old time is still the time to turn up at.
    //
    // The previous code cast "RESCHEDULE_PENDING" to SessionStatus with a comment hoping the
    // value existed. It does not, so every valid proposal died on a 500 from the status
    // update — after the request row had already been written, which is why the "only one
    // open request" rule appeared to work while nothing else did.

    await auditService.record({
      actorUserId: userId,
      action: "SESSION_RESCHEDULE_REQUESTED",
      entityType: AuditEntityType.SESSION,
      entityId: sessionId,
      metadata: {
        requestId: request.id,
        requestedBy: isClient ? "CLIENT" : "PT",
        originalStartAt: session.scheduledStartAt.toISOString(),
        proposedStartAt: proposedStart.toISOString(),
        proposedEndAt: proposedEnd.toISOString(),
        reason: data.reason,
        movesUsed: usedMoves,
      },
    });

    const targetUserId = isClient ? session.ptUserId : session.clientUserId;
    notificationService.create({
      userId: targetUserId,
      text: `Có yêu cầu dời lịch buổi tập sang ngày ${proposedStart.toLocaleString()}`,
      // "SESSION_UPDATE" is not a NotificationEventType, so Prisma rejected every one of
      // these and the .catch swallowed it: the other party was never told a proposal had
      // been made. The enum has had the right value all along.
      eventType: "SESSION_RESCHEDULE_REQUESTED",
      entityType: "SESSION",
      entityId: sessionId
    }).catch((err: unknown) =>
      logger.error({ error: "booking.service reschedule-request notification failed", sessionId, message: (err as Error)?.message }),
    );

    return request;
  },

  /**
   * The requester withdraws their own proposal. Only they may do it, and only while it is
   * still open — once the other side has answered, the answer stands.
   */
  async cancelRescheduleRequest(requestId: string, userId: string) {
    const request = await sessionRepository.findRescheduleRequestById(requestId);
    if (!request) throw err("Không tìm thấy yêu cầu dời lịch", 404);
    if (request.status !== "PENDING") {
      throw err("Yêu cầu đã được xử lý, không thể rút lại", 409);
    }

    const session = request.session;
    const requesterId =
      request.requestedBy === "CLIENT" ? session.clientUserId : session.ptUserId;
    if (requesterId !== userId) {
      throw err("Chỉ người gửi mới được rút lại yêu cầu", 403);
    }

    const withdrawn = await sessionRepository.updateRescheduleRequestStatus(
      requestId,
      "CANCELLED",
    );

    await auditService.record({
      actorUserId: userId,
      action: "SESSION_RESCHEDULE_WITHDRAWN",
      entityType: AuditEntityType.SESSION,
      entityId: request.sessionId,
      metadata: {
        requestId,
        requestedBy: request.requestedBy,
        proposedStartAt: request.proposedStartAt.toISOString(),
      },
    });

    return withdrawn;
  },

  /**
   * Every proposal ever made on a session, newest first. Exists for dispute resolution —
   * "who moved this, when, and why" has to be answerable after the fact.
   */
  async getRescheduleHistory(sessionId: string, userId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.clientUserId !== userId && session.ptUserId !== userId) {
      throw err("Not authorized", 403);
    }
    return sessionRepository.findRescheduleRequestsBySession(sessionId);
  },

  async respondToReschedule(
    requestId: string,
    userId: string,
    action: "ACCEPT" | "REJECT",
    responseNote?: string
  ) {
    const request = await sessionRepository.findRescheduleRequestById(requestId);
    if (!request) throw err("Reschedule request not found", 404);
    if (request.status !== "PENDING") {
      throw err("Request already processed", 400);
    }

    const session = request.session;
    const isClient = session.clientUserId === userId;
    const isPT = session.ptUserId === userId;

    if (!isClient && !isPT) throw err("Not authorized", 403);
    
    const expectedResponder = request.requestedBy === "CLIENT" ? "PT" : "CLIENT";
    const actualResponder = isClient ? "CLIENT" : "PT";
    if (actualResponder !== expectedResponder) {
      throw err("You cannot respond to your own reschedule request", 403);
    }

    if (action === "ACCEPT") {
      // Money-flow plan 3.2 / P0 cluster H2: requestReschedule checked this SLOT was free at
      // proposal time, but that check-then-write gap is the EXACT same race B2 closed for
      // booking itself — two concurrent accepts (or an accept racing a fresh booking) could
      // both pass the conflict check before either commits. Runs inside the same per-PT
      // advisory lock bookSession uses: the conflict re-check and both writes below are now
      // one atomic unit, not three separate statements a concurrent call can interleave with.
      await withPtScheduleLock(session.ptUserId, null, async (tx) => {
        await assertSlotBookable(
          session.ptUserId,
          request.proposedStartAt,
          request.proposedEndAt,
          session.id,
          tx,
        );

        await sessionRepository.updateRescheduleRequestStatus(
          requestId,
          "ACCEPTED",
          responseNote,
          tx,
        );
        await sessionRepository.updateStatus(
          session.id,
          SessionStatus.CONFIRMED,
          {
            scheduledStartAt: request.proposedStartAt,
            scheduledEndAt: request.proposedEndAt,
          },
          tx,
        );
      });
    } else {
      await sessionRepository.updateRescheduleRequestStatus(
        requestId,
        "REJECTED",
        responseNote
      );
      await sessionRepository.updateStatus(
        session.id,
        SessionStatus.CONFIRMED
      );
    }

    // The session's time changing is the single most disputed fact in this flow — "I was
    // never told it moved" is answered here, with who accepted and what the time was before.
    await auditService.record({
      actorUserId: userId,
      action:
        action === "ACCEPT"
          ? "SESSION_RESCHEDULE_ACCEPTED"
          : "SESSION_RESCHEDULE_REJECTED",
      entityType: AuditEntityType.SESSION,
      entityId: session.id,
      metadata: {
        requestId,
        requestedBy: request.requestedBy,
        respondedBy: isClient ? "CLIENT" : "PT",
        originalStartAt: request.originalStartAt.toISOString(),
        proposedStartAt: request.proposedStartAt.toISOString(),
        // On a rejection the session keeps its original time; spell that out rather than
        // leaving the reader to infer it from the action name.
        effectiveStartAt:
          action === "ACCEPT"
            ? request.proposedStartAt.toISOString()
            : session.scheduledStartAt.toISOString(),
        responseNote: responseNote ?? null,
      },
    });

    const requesterUserId = request.requestedBy === "CLIENT" ? session.clientUserId : session.ptUserId;
      notificationService.create({
        userId: requesterUserId,
        // The wording used to say "đã được xác nhận" on both branches, so a rejected
        // request told the requester their session had moved. It had not.
        text:
          action === "ACCEPT"
            ? `Yêu cầu dời lịch đã được chấp nhận. Giờ mới: ${request.proposedStartAt.toLocaleString("vi-VN")}`
            : `Yêu cầu dời lịch đã bị từ chối. Buổi tập giữ nguyên giờ cũ.`,
        // Same invalid enum value as on the request side — the answer never reached the
        // person who had asked. The event type has to match the branch, or an acceptance
        // and a rejection arrive looking identical to anything that filters on it.
        eventType:
          action === "ACCEPT"
            ? "SESSION_RESCHEDULE_ACCEPTED"
            : "SESSION_RESCHEDULE_REJECTED",
        entityType: "SESSION",
        entityId: request.sessionId
      }).catch((err: unknown) =>
        logger.error({ error: "booking.service reschedule-response notification failed", requestId, message: (err as Error)?.message }),
      );

    return sessionRepository.findRescheduleRequestById(requestId);
  },
};
