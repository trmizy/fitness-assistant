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
  releaseOrResolveSessionMoney,
  compensateNoShowMoney,
  isContractEnded,
  resolveUnresolvedSessionMoney,
  recordReleaseIntent,
  recordNoShowIntent,
  recordResolutionIntent,
} from "./contract-payout.service";
import { resolveSessionOutcome } from "./session-outcome";
import { availabilityRepository } from "../repositories/availability.repository";
import { profileRepository } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { contractService, getRemainingEntitlements } from "./contract.service";
import { auditService } from "./audit.service";
import {
  withContractLock,
  withRunningContract,
  withPtScheduleLock,
  assertNotEnding,
  throwSessionRaceLost,
  contractEndedError,
  sessionAlreadyProcessedError,
  codedError,
  SESSION_STATE_NOT_ALLOWED,
  CONTRACT_ENDED,
  CONTRACT_ENDING,
} from "./contract-lock";
import { endOpenRoomCall } from "./open-room-call.service";
import { assertContractAcceptsClientAction, assertPtMayActOnContract, getBlockingRestriction } from "./pt-restriction.service";

/**
 * An online session that is no longer CONFIRMED has no room any more — end the call row its
 * room may have left behind (see open-room-call.service.ts for what happens when nobody does).
 */
function closeRoomOf(session: { id: string; sessionMode: SessionMode | null }, reason: string): void {
  if (session.sessionMode === SessionMode.ONLINE) endOpenRoomCall(session.id, reason);
}

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

/**
 * D45 / L2 - the contract the session belongs to has ended (completed, expired, cancelled, ...). A PT's (or
 * the sweeps') money-triggering session actions - cancelling late, admitting/claiming a no-show, answering a
 * no-show report, reporting a session delivered, joining a room (which feeds the late/no-show sweep) - are
 * refused there, so a session left behind on an ended contract can never trigger a compensation or a payout
 * a second time. (The ending itself calls such sessions off, see contract-session-closure.ts; this is the
 * guard for legacy leftovers and for the instant between the ending's read and its write.)
 */
export { CONTRACT_ENDED, CONTRACT_ENDING };
/** The session is not in a state this action works from (another request, a sweep or the contract's ending already moved it): 400 + a machine-readable code, never a bare string. */
function stateNotAllowed(message: string) {
  return codedError(message, 400, SESSION_STATE_NOT_ALLOWED);
}
async function assertContractRunning(contractId: string, db?: Prisma.TransactionClient): Promise<void> {
  const contract = await contractRepository.findById(contractId, db);
  if (!contract) throw err("Contract not found", 404);
  if (contract.status !== ContractStatus.ACTIVE) throw contractEndedError();
  // D59: the ending was accepted but its money is not confirmed yet - nothing that creates or changes an obligation runs.
  await assertNotEnding(contractId, db);
}

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

/** What a delivery claim moves the session from / to (always to COMPLETED) - see sessionRepository.claimDelivery. */
export interface DeliveryTransition {
  from: SessionStatus[];
  extra?: Record<string, unknown>;
}

/** Collaborators of {@link deductQuotaOnce}, injectable so the once-only rule is testable. */
export interface QuotaDeps {
  /**
   * The compare-and-set on the session. The real one (sessionRepository.claimDelivery) runs on the contract-locked
   * transaction `tx`, moves the status when a transition is given and says whether the contract had already ended
   * (`endedAtClaim`: the value is one the ending HELD). A plain boolean is the legacy shape.
   */
  claimDeduction: (
    sessionId: string,
    contractId: string,
    tx?: Prisma.TransactionClient,
    transition?: DeliveryTransition,
  ) => Promise<boolean | { claimed: boolean; endedAtClaim: boolean }>;
  /** `tx` = the decision's contract-locked transaction: the count commits or rolls back TOGETHER with the claim. */
  incrementSession: (contractId: string, tx?: Prisma.TransactionClient) => Promise<unknown>;
  /**
   * Records the money step's INTENT row inside the decision's transaction (Phase 0 / D58), so "this session was delivered"
   * and "its release is owed" are one fact. Absent (unit tests with fake deps): nothing is recorded; the money step below
   * records it itself.
   */
  recordMoneyIntent?: (tx: Prisma.TransactionClient, contractId: string, sessionId: string, endedAtClaim?: boolean) => Promise<void>;
  checkAndCompleteContract: (contractId: string) => Promise<unknown>;
  /** Runs AFTER the decision committed, with no lock and no transaction around it (it calls payment-service). */
  releaseMoney: (contractId: string, sessionId: string, endedAtClaim?: boolean) => Promise<void>;
  /**
   * Runs the DECISION (claim + counter + intent) as ONE short transaction under the contract lock, so an ending that is in
   * flight snapshots {used sessions, already released, awaiting / disputed} either wholly before or wholly after it, and a
   * contract whose ending is recorded refuses it (409 CONTRACT_ENDING). Without it (unit tests) the steps simply run in sequence.
   */
  exclusive?: <T>(contractId: string, fn: (tx?: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}

const defaultQuotaDeps: QuotaDeps = {
  claimDeduction: async (id, contractId, tx, transition) => {
    if (!tx) throw new Error("claimDeduction needs the contract-locked transaction");
    return sessionRepository.claimDelivery(tx, id, contractId, transition);
  },
  incrementSession: (id, tx) => contractRepository.incrementSession(id, tx),
  recordMoneyIntent: (tx, contractId, sessionId, endedAtClaim) => recordReleaseIntent(tx, contractId, sessionId, endedAtClaim),
  checkAndCompleteContract: (id) => contractService.checkAndCompleteContract(id),
  // On a contract that has ENDED (any reason), a delivered session settles against the value payment-service HELD
  // for it; on a running contract this is the ordinary release.
  releaseMoney: (contractId, sessionId, endedAtClaim) => releaseOrResolveSessionMoney(contractId, sessionId, endedAtClaim),
  exclusive: (contractId, fn) => withContractLock(contractId, (tx) => fn(tx)),
};

/**
 * Consumes exactly one session of the contract's quota, once and only once, and pays out that
 * session's share of the money.
 *
 * `claimDeduction` is a guarded update on `sessionDeducted` (false → true) - and, given a `transition`, on the
 * session's STATUS too - that reports whether it actually claimed the row; the contract counter is incremented ONLY
 * then. Two concurrent confirms, a retry, or a manual confirm racing the auto-confirm sweep or an admin ruling
 * therefore still cost the client a single session, and a session that was cancelled / disputed / settled meanwhile
 * is never overwritten (F3).
 *
 * The money release hangs off the same claim, in the same contract-locked step. Quota and payout are two views of one
 * fact — "this session was delivered" — so gating both on the single compare-and-swap is what stops a retry from
 * paying the PT twice for one session, and what orders the release against a contract ending concurrently.
 * (The completion check runs AFTER the step: it may itself end the contract, which takes the same lock.)
 *
 * Returns true when this call is the one that consumed the quota.
 */
export async function deductQuotaOnce(
  sessionId: string,
  contractId: string,
  deps: QuotaDeps = defaultQuotaDeps,
  transition?: DeliveryTransition,
): Promise<boolean> {
  const exclusive = deps.exclusive ?? (async <T>(_c: string, fn: (tx?: Prisma.TransactionClient) => Promise<T>) => fn());
  let endedAtClaim: boolean | undefined;
  // THE DECISION: claim + counter + money intent commit together, in one short transaction, and the lock is released
  // BEFORE payment-service is called (a crash after this leaves a durable intent that is repeated with the same key;
  // a crash before it leaves nothing - the claim, the count and the intent roll back together).
  const won = await exclusive(contractId, async (tx) => {
    if (tx) await assertNotEnding(contractId, tx); // D59: the ending is recorded but unconfirmed - nothing is delivered / released now
    const claim = await deps.claimDeduction(sessionId, contractId, tx, transition);
    const claimed = typeof claim === "boolean" ? claim : claim.claimed;
    if (!claimed) return false;
    endedAtClaim = typeof claim === "boolean" ? undefined : claim.endedAtClaim;
    await deps.incrementSession(contractId, tx); // same transaction: the ending's snapshot sees the claim AND the count
    if (tx && deps.recordMoneyIntent) await deps.recordMoneyIntent(tx, contractId, sessionId, endedAtClaim);
    return true;
  });
  if (!won) return false;
  // The money step (idempotent on the intent's key; a failure is recorded on the row and retried, never lost).
  await deps.releaseMoney(contractId, sessionId, endedAtClaim);
  // After the lock: completing the contract takes it.
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

    // A restricted PT (temporarily suspended, or banned) takes no new sessions: the contract stays
    // ACTIVE but is PAUSED_BY_ADMIN. Machine-readable refusal; re-checked under the PT's lock below.
    // Also refused while THIS contract has its own restriction (scope CONTRACT): other contracts of the PT are unaffected.
    await assertContractAcceptsClientAction(contract, "BOOK_SESSION");

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
      throw err("Buổi tập cần được đặt trước ít nhất 24 giờ", 400);
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
      // The ending may have been recorded since the unlocked check above (D59: refused, not queued).
      if (freshContract.status !== ContractStatus.ACTIVE) throw contractEndedError();
      await assertNotEnding(contractId, tx);
      // The suspension takes this same lock: a booking that passed the check above before the PT was
      // suspended cannot create its session after the suspension has called the PT's sessions off.
      await assertContractAcceptsClientAction(contract, "BOOK_SESSION", tx);

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
        text: "Học viên vừa gửi yêu cầu đặt buổi tập",
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
      await assertNotEnding(contract.id, tx); // D59
      if (contract.endDate && contract.endDate < new Date()) {
        throw err("Hợp đồng đã hết hạn", 409);
      }

      // Restricted mode (same lock the suspension takes): a suspended PT confirms nothing.
      await assertPtMayActOnContract(ptUserId, freshSession.contractId, tx);

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
      if (!won) throw sessionAlreadyProcessedError("Buổi tập đã được xử lý");
    });

    const updated = await sessionRepository.findById(sessionId);

    await notificationService
      .create({
        userId: session.clientUserId,
        text: "Huấn luyện viên đã xác nhận buổi tập của bạn",
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
    await assertPtMayActOnContract(ptUserId, session.contractId); // restricted mode: no "report completed" while suspended
    await assertContractRunning(session.contractId); // L2: said first - an ended contract's session is not reportable at all (re-checked under the lock below)
    if (session.status !== SessionStatus.CONFIRMED) {
      throw stateNotAllowed(`Cannot complete session in ${session.status} status`);
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
    // N9 / L2: a new completion report is written ONLY while the PT may still act on a RUNNING contract, decided
    // under the same per-PT lock a suspension / ban takes (so "the PT was banned at T" and "this report was
    // created before T" are one ordered fact), and only from CONFIRMED (a session cancelled / called off /
    // settled in the meantime is never overwritten).
    await withPtScheduleLock(session.ptUserId, session.contractId, async (tx) => {
      await assertPtMayActOnContract(ptUserId, session.contractId, tx);
      await assertContractRunning(session.contractId, tx);
      const won = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.CONFIRMED],
        SessionStatus.PENDING_CLIENT_CONFIRMATION,
        { ptNotes: ptNotes || undefined, clientConfirmDeadline: deadline },
        tx,
      );
      if (!won) throw sessionAlreadyProcessedError("Buổi tập đã được xử lý");
    });
    const updated = await sessionRepository.findById(sessionId);
    closeRoomOf(session, "session_completed_by_pt");

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

    // F3: the confirmation IS the state transition - one compare-and-set from PENDING_CLIENT_CONFIRMATION to COMPLETED
    // that also claims the quota. A session cancelled / disputed / ruled / settled in the meantime matches zero rows:
    // it is never overwritten, and neither quota nor money moves for it.
    const deducted = await deductQuotaOnce(sessionId, session.contractId, undefined, {
      from: [SessionStatus.PENDING_CLIENT_CONFIRMATION],
      extra: { completedAt: new Date() },
    });
    const updated = await sessionRepository.findById(sessionId);
    if (!deducted) {
      // A second click / a retry of the confirmation that already won is not an error ...
      if (updated?.status === SessionStatus.COMPLETED && updated.sessionDeducted) return { ...updated, quotaDeducted: false };
      // ... but a session that went another way (disputed, cancelled, ruled) cannot be confirmed any more.
      throw err(`Cannot confirm a session in ${updated?.status ?? "an unknown"} status`, 409);
    }

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
    // F3: from PENDING_CLIENT_CONFIRMATION only - a confirmation that won the race has already settled the session.
    const disputed = await sessionRepository.transitionStatus(
      sessionId,
      [SessionStatus.PENDING_CLIENT_CONFIRMATION],
      SessionStatus.DISPUTED,
      { disputeReason: reason.trim(), disputedAt: new Date(), disputeType },
    );
    if (!disputed) throw sessionAlreadyProcessedError("Buổi tập đã được xử lý - không thể khiếu nại nữa");
    const updated = await sessionRepository.findById(sessionId);

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

    // F2 / D45-L3 + F3: a disputed session of a contract that has ENDED (for any reason) is one whose value
    // payment-service HELD at the ending; this ruling settles that held value (DELIVERED / NOT_DELIVERED) instead of
    // the ordinary quota / no-show-compensation steps. The ruling is claimed with ONE compare-and-swap from DISPUTED
    // (two admins cannot rule it two ways, and nothing else - a confirm, a cancel - can overwrite it), and the "has the
    // contract ended?" fact is read in that same step under the contract lock, so it is ordered against an ending in
    // flight. Phase 0 / D58: the ruling (the status CAS) and the INTENT of its money step commit together in that one
    // short transaction; the money step itself runs after the lock is released, idempotent on the intent's key. A contract
    // whose ending is recorded but unconfirmed refuses the ruling (409 CONTRACT_ENDING, D59).
    const claimRuling = async (
      next: SessionStatus,
      extra: Record<string, unknown>,
      intent: (tx: Prisma.TransactionClient, endedAtClaim: boolean) => Promise<void>,
      money: (endedAtClaim: boolean) => Promise<void>,
    ) => {
      const endedAtClaim = await withContractLock(session.contractId, async (tx) => {
        await assertNotEnding(session.contractId, tx);
        const contract = await contractRepository.findById(session.contractId, tx);
        const won = await sessionRepository.transitionStatus(sessionId, [SessionStatus.DISPUTED], next, extra, tx);
        if (!won) throw sessionAlreadyProcessedError("Buổi tập này đã được phân xử");
        const ended = !!contract && isContractEnded(contract);
        await intent(tx, ended);
        return ended;
      });
      await money(endedAtClaim);
      return { updated: await sessionRepository.findById(sessionId), endedAtClaim };
    };

    if (resolution === "PT_NO_SHOW_CONFIRMED") {
      const noShowFields = {
        resolvedBy: adminId,
        resolutionNote: note.trim(),
        resolvedAt: new Date(),
        ptNotes: "Quản trị viên xác nhận huấn luyện viên vắng mặt",
        // Vòng 4 / Phase E2 — counts toward the client's right to terminate after 3.
        ptAtFault: true,
      };
      const { updated, endedAtClaim } = await claimRuling(
        SessionStatus.NO_SHOW,
        noShowFields,
        async (tx, ended) => {
          if (ended) await recordResolutionIntent(tx, session.contractId, sessionId, "NOT_DELIVERED");
          else await recordNoShowIntent(tx, session.contractId, sessionId);
        },
        async (ended) => {
          if (ended) {
            // The PT did not turn up: the value held for this session goes back to the client. No separate
            // no-show compensation (that would pay the same session twice) and no completion check (the
            // contract already ended).
            await resolveUnresolvedSessionMoney(session.contractId, sessionId, "NOT_DELIVERED");
          } else {
            // Same settlement markNoShow's PT-self-admit branch uses — cash compensation, charged
            // to the three parties in proportion, the client's quota never touched.
            await compensateNoShowMoney(session.contractId, sessionId);
          }
        },
      );
      // After the lock: completing the contract takes the same lock.
      if (!endedAtClaim) await contractService.checkAndCompleteContract(session.contractId);

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

    const rulingStatus = resolution === "COMPLETED" ? SessionStatus.COMPLETED : SessionStatus.CANCELLED;
    const rulingFields = {
      resolvedBy: adminId,
      resolutionNote: note.trim(),
      resolvedAt: new Date(),
      ...(resolution === "COMPLETED"
        ? { completedAt: new Date() }
        : { cancelledBy: "ADMIN", cancellationReason: note.trim() }),
    };
    let deducted = false;
    let updated: Awaited<ReturnType<typeof sessionRepository.findById>>;
    if (resolution === "COMPLETED") {
      // Only a COMPLETED ruling costs the client a session (and, on an ended contract, releases the held value).
      // The ruling IS the delivery claim: status DISPUTED -> COMPLETED and the quota claim are one update (F3), so no
      // instant exists where the session is "ruled delivered" but neither charged nor paid.
      deducted = await deductQuotaOnce(sessionId, session.contractId, undefined, { from: [SessionStatus.DISPUTED], extra: rulingFields });
      if (!deducted) throw sessionAlreadyProcessedError("Buổi tập này đã được phân xử");
      updated = await sessionRepository.findById(sessionId);
    } else {
      // "Not delivered": nothing was consumed, so on an ended contract the held value is refunded to the client.
      const ruled = await claimRuling(
        rulingStatus,
        rulingFields,
        async (tx, ended) => {
          if (ended) await recordResolutionIntent(tx, session.contractId, sessionId, "NOT_DELIVERED");
        },
        async (ended) => {
          if (ended) await resolveUnresolvedSessionMoney(session.contractId, sessionId, "NOT_DELIVERED");
        },
      );
      updated = ruled.updated;
    }

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
    // L2: nobody cancels (and so nobody is charged / compensated for) a session of an ended contract - said first, so an ended
    // contract is reported as CONTRACT_ENDED even when its ending already called this very session off.
    await assertContractRunning(session.contractId);
    if (
      session.status !== SessionStatus.REQUESTED &&
      session.status !== SessionStatus.CONFIRMED
    ) {
      throw stateNotAllowed(`Cannot cancel session in ${session.status} status`);
    }

    const isClient = userId === session.clientUserId;
    const otherUserId = isClient ? session.ptUserId : session.clientUserId;

    // Restricted mode applies to the PT cancelling for themselves. A CLIENT cancelling while the PT is
    // restricted pays nothing: the shared matrix's FORCE_MAJEURE row (quota kept, no fee, no payout).
    if (!isClient) await assertPtMayActOnContract(userId, session.contractId);
    const ptRestricted = isClient && (await getBlockingRestriction({ id: session.contractId, ptUserId: session.ptUserId })) !== null;

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
      if (!won) await throwSessionRaceLost(session.contractId);
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
    // F4 / D56: the state check, the session write, the quota charge and the money step are ONE critical section on
    // the contract (withRunningContract). A contract ending takes the same lock, so its snapshot of {used /
    // compensated sessions, released amounts} is taken either wholly before this cancel or wholly after it - and
    // after it this cancel is refused (409 CONTRACT_ENDED) instead of charging / compensating a contract that has
    // already been settled. The notice window is measured at the moment the decision is made, inside the lock.
    //
    // Vòng 4 / Phase A1 - the CAS below is still what makes two concurrent cancels of ONE session cost one charge:
    // `updateStatus` used to be an unconditional write, so both read CONFIRMED, both wrote CANCELLED and both ran the
    // DEDUCT branch (a double increment can push usedSessions + compensatedSessions past totalSessions, which
    // payment-service's validate() throws on, blocking the termination for good). Only the winner runs any side
    // effect; the loser gets 409 SESSION_ALREADY_PROCESSED (or CONTRACT_ENDED when the ending beat it).
    //
    // Phase 0 / D58: the DECISION - the status CAS, the quota charge and the INTENT of the money step - commits as one
    // short transaction (all on `tx`); the lock is released BEFORE payment-service is called. The money step then runs
    // idempotently on the intent's key; a crash in between leaves the durable intent for the sweep / the ending to repeat.
    const outcome = await withRunningContract(session.contractId, async (tx) => {
      const hoursBeforeStart = (session.scheduledStartAt.getTime() - Date.now()) / (60 * 60 * 1000);
      const decided = resolveSessionOutcome({
        actor: isClient ? (ptRestricted ? "FORCE_MAJEURE" : "CLIENT") : "PT",
        event: "CANCEL",
        hoursBeforeStart,
      });
      const won = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.CONFIRMED],
        decided.sessionStatus,
        {
          cancelledBy: userId,
          cancellationReason: reason.trim(),
          sessionDeducted: decided.clientQuotaEffect === "DEDUCT",
        },
        tx,
      );
      if (!won) await throwSessionRaceLost(session.contractId);

      // Same order deductQuotaOnce uses (charge, then release/compensate; the completion check follows the lock).
      if (decided.clientQuotaEffect === "DEDUCT") {
        await contractRepository.incrementSession(session.contractId, tx);
      }
      if (decided.ptPayout) await recordReleaseIntent(tx, session.contractId, sessionId, false);
      if (decided.clientCompensation) await recordNoShowIntent(tx, session.contractId, sessionId);
      return decided;
    });
    if (outcome.ptPayout) await releaseSessionMoney(session.contractId, sessionId);
    if (outcome.clientCompensation) await compensateNoShowMoney(session.contractId, sessionId);
    closeRoomOf(session, "session_cancelled");
    // After the lock: completing the contract takes the same lock.
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
    await assertPtMayActOnContract(userId, session.contractId); // restricted mode
    await assertContractRunning(session.contractId); // L2: no PT-initiated no-show on an ended contract
    // Money-flow plan 4.3: also reachable from PT_NO_SHOW_REPORTED — respondToNoShowReport
    // calls straight into this same function when the PT agrees with the client's report,
    // rather than re-implementing the exact same compensation logic a second time.
    if (
      session.status !== SessionStatus.CONFIRMED &&
      session.status !== SessionStatus.PT_NO_SHOW_REPORTED
    ) {
      throw stateNotAllowed(`Cannot mark no-show for session in ${session.status} status`);
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

      // F4 / D56: the CAS on the status that was read, the compensation and its counters are ONE critical section on
      // the contract (see cancelSession). A session called off / settled meanwhile is never overwritten (409
      // SESSION_ALREADY_PROCESSED), a contract that has ended is refused (409 CONTRACT_ENDED), and the ending's
      // snapshot of compensatedSessions is taken either before this compensation or after it, never half-way.
      //
      // The client is owed one session's value in cash, charged back to the three parties.
      // Money-flow plan 1.6: compensateNoShowMoney does not throw - the session above is already NO_SHOW once it
      // runs and that status guard blocks every future retry through this endpoint, so a thrown error would only hide
      // a stuck-forever compensation. It records a failure for the settlement sweep to retry instead (and the
      // contract's ending refuses to settle while one is unsettled: SESSION_SETTLEMENT_PENDING).
      await withRunningContract(session.contractId, async (tx) => {
        const won = await sessionRepository.transitionStatus(
          sessionId,
          [session.status],
          outcome.sessionStatus,
          {
            sessionDeducted: outcome.clientQuotaEffect === "DEDUCT",
            ptNotes: "PT no-show",
            // Vòng 4 / Phase E2 — counts toward the client's right to terminate after 3.
            ptAtFault: true,
          },
          tx,
        );
        if (!won) await throwSessionRaceLost(session.contractId);
        // The compensation's INTENT commits with the status (Phase 0 / D58); the payment-service call is made after the lock.
        if (outcome.clientCompensation) await recordNoShowIntent(tx, session.contractId, sessionId);
      });
      if (outcome.clientCompensation) await compensateNoShowMoney(session.contractId, sessionId);
      const updated = await sessionRepository.findById(sessionId);
      closeRoomOf(session, "pt_no_show");
      if (outcome.clientCompensation) await contractService.checkAndCompleteContract(session.contractId);

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
    // Like completeSession (N9 / L2): a NEW claim against the client is only created while the PT may still act
    // on a running contract, under the per-PT lock, from the status that was read.
    await withPtScheduleLock(session.ptUserId, session.contractId, async (tx) => {
      await assertPtMayActOnContract(userId, session.contractId, tx);
      await assertContractRunning(session.contractId, tx);
      const won = await sessionRepository.transitionStatus(
        sessionId,
        [session.status],
        SessionStatus.PENDING_CLIENT_CONFIRMATION,
        { ptNotes: "Client no-show", clientConfirmDeadline: deadline },
        tx,
      );
      if (!won) throw sessionAlreadyProcessedError("Buổi tập đã được xử lý");
    });
    const updated = await sessionRepository.findById(sessionId);
    closeRoomOf(session, "client_no_show_reported");

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
    // The PT cannot answer a report while restricted, and nothing may be decided against them meanwhile.
    await assertContractAcceptsClientAction({ id: session.contractId, ptUserId: session.ptUserId }, "REPORT_PT_NO_SHOW");
    await assertContractRunning(session.contractId); // L2: an ended contract's leftover cannot start a no-show claim
    if (session.status !== SessionStatus.CONFIRMED) {
      throw stateNotAllowed(`Cannot report a no-show for a session in ${session.status} status`);
    }
    // Vòng 4 / Phase E1: same grace window as markNoShow's mirror check — both directions.
    if (session.scheduledStartAt.getTime() + NO_SHOW_GRACE_MS > Date.now()) {
      throw err(
        `Chưa thể báo huấn luyện viên vắng mặt — cần đợi ít nhất ${NO_SHOW_GRACE_MINUTES} phút sau giờ hẹn`,
        400,
      );
    }

    // Race 8 (D57 item 3): this CAS used to run WITHOUT the contract lock, so an ending that had already called the session
    // off (while the contract still read ACTIVE) made it lose with a misleading 409 SESSION_ALREADY_PROCESSED. Under the lock
    // the report either lands before the ending (which then HOLDS it, Decision A) or is refused with CONTRACT_ENDED /
    // CONTRACT_ENDING - the reason the report was refused is always told.
    await withRunningContract(session.contractId, async (tx) => {
      const reported = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.CONFIRMED],
        SessionStatus.PT_NO_SHOW_REPORTED,
        { disputeReason: reason.trim(), disputedAt: new Date() },
        tx,
      );
      if (!reported) await throwSessionRaceLost(session.contractId);
    });
    const updated = await sessionRepository.findById(sessionId);
    closeRoomOf(session, "pt_no_show_reported");

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
    await assertPtMayActOnContract(ptUserId, session.contractId); // restricted mode: the report waits until the PT may answer it
    await assertContractRunning(session.contractId); // L2: an ended contract's report is closed unadjudicated, not answered
    if (session.status !== SessionStatus.PT_NO_SHOW_REPORTED) {
      throw stateNotAllowed(`Cannot respond to a no-show report on a session in ${session.status} status`);
    }

    if (response === "AGREE") {
      // The PT accepts the client's account — same outcome as a PT self-admitted no-show,
      // reusing that exact logic (compensation, notification) rather than duplicating it.
      return this.markNoShow(sessionId, ptUserId, "PT");
    }

    // DENY — escalate to an admin. Reuses the EXACT same DISPUTED state and admin-resolution
    // flow money-flow plan 4.2 built for the client-confirmation dispute path; the admin
    // screen there does not care which flow put a session into DISPUTED.
    await withRunningContract(session.contractId, async (tx) => {
      const denied = await sessionRepository.transitionStatus(
        sessionId,
        [SessionStatus.PT_NO_SHOW_REPORTED],
        SessionStatus.DISPUTED,
        {
          ptNotes: note?.trim() || "PT phản đối báo cáo vắng mặt của khách",
          disputedAt: new Date(),
          // Vòng 4 / Phase E4 — unambiguous here: the client's own claim was "PT no-showed"
          // (reportPtNoShow), and this is the PT contesting exactly that claim.
          disputeType: SessionDisputeType.PT_NO_SHOW_CLAIM,
        },
        tx,
      );
      if (!denied) await throwSessionRaceLost(session.contractId);
    });

    return sessionRepository.findById(sessionId);
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
    await assertPtMayActOnContract(ptUserId, session.contractId); // restricted mode
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
    if (session.ptUserId === userId) await assertPtMayActOnContract(userId, session.contractId); // restricted mode: the PT does not teach
    await assertContractRunning(session.contractId); // L2: a room of an ended contract opens nothing (its joins feed the late / no-show sweep)

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
    // No reschedule into (or out of) a suspension, from either side.
    if (isPT) await assertPtMayActOnContract(userId, session.contractId);
    else await assertContractAcceptsClientAction({ id: session.contractId, ptUserId: session.ptUserId }, "RESCHEDULE");

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
    
    // No answering a reschedule proposal into (or out of) a suspension, from either side.
    if (isPT) await assertPtMayActOnContract(userId, session.contractId);
    else await assertContractAcceptsClientAction({ id: session.contractId, ptUserId: session.ptUserId }, "RESCHEDULE");

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
      // The room that may already have opened belonged to the OLD time slot.
      closeRoomOf(session, "session_rescheduled");
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
