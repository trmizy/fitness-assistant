import { createHmac } from "crypto";
import {
  SessionStatus,
  SessionMode,
  ContractStatus,
  DayOfWeek,
} from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import {
  releaseSessionMoney,
  compensateNoShowMoney,
} from "./contract-payout.service";
import { availabilityRepository } from "../repositories/availability.repository";
import { profileRepository } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { contractService } from "./contract.service";

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
): Promise<void> {
  const conflict = await sessionRepository.findConflict(
    ptUserId,
    startAt,
    endAt,
    excludeSessionId,
  );
  if (conflict) throw err("Khung giờ này trùng với một buổi tập khác", 409);

  const ptAvailability = await availabilityRepository.findByPT(ptUserId);
  if (ptAvailability.length === 0) return; // no published hours = no constraint

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
      durationMin?: number; // default 60
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

    // Check session limit: usedSessions + pending/confirmed < totalSessions
    const activeSessionCount =
      await sessionRepository.countActiveByContract(contractId);
    if (contract.usedSessions + activeSessionCount >= contract.totalSessions) {
      throw err("Session limit reached for this contract", 400);
    }

    // Parse datetime
    const durationMin = data.durationMin || 60;
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

    // Check for PT time conflict
    const conflict = await sessionRepository.findConflict(
      contract.ptUserId,
      startAt,
      endAt,
    );
    if (conflict) {
      throw err("This time slot conflicts with another session", 409);
    }

    // Check PT availability (if PT has set availability slots)
    const ptAvailability = await availabilityRepository.findByPT(
      contract.ptUserId,
    );
    if (ptAvailability.length > 0) {
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

    const session = await sessionRepository.create({
      contractId,
      clientUserId,
      ptUserId: contract.ptUserId,
      sessionMode: (data.sessionMode as SessionMode) || SessionMode.OFFLINE,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      location: data.location,
      notes: data.notes,
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
  async confirmSession(sessionId: string, ptUserId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.ptUserId !== ptUserId) throw err("Not authorized", 403);
    if (session.status !== SessionStatus.REQUESTED) {
      throw err(`Cannot confirm session in ${session.status} status`, 400);
    }

    // BR-31: block if PT already has a CONFIRMED session in same slot
    const conflict = await sessionRepository.findConflict(
      session.ptUserId,
      session.scheduledStartAt,
      session.scheduledEndAt,
      session.id,
      [SessionStatus.CONFIRMED],
    );
    if (conflict) {
      throw err("PT has a conflicting session in this time slot", 409);
    }

    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.CONFIRMED,
    );

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

    // Quota is deliberately left untouched — an admin decides in resolveDispute.
    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.DISPUTED,
      { disputeReason: reason.trim(), disputedAt: new Date() },
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
  async resolveDispute(
    sessionId: string,
    adminId: string,
    resolution: "COMPLETED" | "CANCELLED",
    note: string,
  ) {
    if (!note?.trim()) throw err("Resolution note is required", 400);
    if (resolution !== "COMPLETED" && resolution !== "CANCELLED") {
      throw err("Resolution must be COMPLETED or CANCELLED", 400);
    }

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err("Session not found", 404);
    if (session.status !== SessionStatus.DISPUTED) {
      throw err(`Session is not disputed (status ${session.status})`, 400);
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
    const hoursUntilSession = session.scheduledStartAt.getTime() - Date.now();

    // Determine if session should be deducted
    let shouldDeduct = false;
    if (isClient && hoursUntilSession < CANCEL_WINDOW_MS) {
      // Client cancels < 24h → lose session
      shouldDeduct = true;
    }
    // PT cancels → never deducts

    const updated = await sessionRepository.updateStatus(
      sessionId,
      SessionStatus.CANCELLED,
      {
        cancelledBy: userId,
        cancellationReason: reason.trim(),
        sessionDeducted: shouldDeduct,
      },
    );

    // If deducted, increment contract usedSessions
    if (shouldDeduct) {
      await contractRepository.incrementSession(session.contractId);
      await contractService.checkAndCompleteContract(session.contractId);
    }

    // Notify the other party
    const otherUserId = isClient ? session.ptUserId : session.clientUserId;
    await notificationService
      .create({
        userId: otherUserId,
        text: isClient
          ? "Client cancelled a session"
          : "Trainer cancelled the session",
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
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err(
        `Cannot mark no-show for session in ${session.status} status`,
        400,
      );
    }

    const isClientNoShow = noShowBy === "CLIENT";

    // A PT admitting their own absence is not a claim against anyone: settle it straight
    // away as NO_SHOW with no quota cost. Accusing the CLIENT of not showing up DOES cost
    // the client a session, so it goes through the same confirmation window as a completed
    // session rather than being charged on the PT's say-so.
    if (!isClientNoShow) {
      const updated = await sessionRepository.updateStatus(
        sessionId,
        SessionStatus.NO_SHOW,
        { sessionDeducted: false, ptNotes: "PT no-show" },
      );

      // The client is owed one session's value in cash, charged back to the three parties.
      // Not caught: if this fails the client is silently short-changed, which is worse than
      // surfacing the error to the PT who is admitting the absence.
      await compensateNoShowMoney(session.contractId, sessionId);

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
      exp: Date.now() + 10 * 60 * 1000, // 10 minutes
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
      proposedEndAt: string;
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
    const proposedEnd = new Date(data.proposedEndAt);
    if (isNaN(proposedStart.getTime()) || isNaN(proposedEnd.getTime())) {
      throw err("Thời gian đề xuất không hợp lệ", 400);
    }
    if (proposedStart >= proposedEnd) {
      throw err("Giờ bắt đầu phải trước giờ kết thúc", 400);
    }
    if (proposedStart <= now) {
      throw err("Thời gian đề xuất phải ở tương lai", 400);
    }

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

    const targetUserId = isClient ? session.ptUserId : session.clientUserId;
    notificationService.create({
      userId: targetUserId,
      text: `Có yêu cầu dời lịch buổi tập sang ngày ${proposedStart.toLocaleString()}`,
      eventType: "SESSION_UPDATE",
      entityType: "SESSION",
      entityId: sessionId
    }).catch(console.error);

    return request;
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
      await sessionRepository.updateRescheduleRequestStatus(
        requestId,
        "ACCEPTED",
        responseNote
      );
      await sessionRepository.updateStatus(
        session.id,
        SessionStatus.CONFIRMED,
        {
          scheduledStartAt: request.proposedStartAt,
          scheduledEndAt: request.proposedEndAt,
        }
      );
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

    const requesterUserId = request.requestedBy === "CLIENT" ? session.clientUserId : session.ptUserId;
      notificationService.create({
        userId: requesterUserId,
        text: `Yêu cầu dời lịch của bạn đã được xác nhận (Ngày mới: ${request.proposedStartAt.toLocaleString()})`,
        eventType: "SESSION_UPDATE",
        entityType: "SESSION",
        entityId: request.sessionId
      }).catch(console.error);

    return sessionRepository.findRescheduleRequestById(requestId);
  },
};
