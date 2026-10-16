import { AuditEntityType, SessionDisputeType, SessionMode, SessionStatus } from "../generated/prisma";
import { notificationService } from "./notification.service";
import { sessionRepository } from "../repositories/session.repository";
import { auditService, SYSTEM_ACTOR } from "./audit.service";
import { endOpenRoomCall } from "./open-room-call.service";

/**
 * D45 / L1 - what happens to a contract's SESSIONS when the contract ends, for EVERY ending reason.
 *
 * A contract is ended by one routine (settleContractTermination in contract-payout.service.ts) and that
 * routine handles the sessions BY STATE, never with one blanket bulk cancel:
 *
 *   not started   REQUESTED / CONFIRMED (booked, has not been delivered)
 *                 -> CANCELLED here, with the ending's reason. Never a PT or client no-show, never counted
 *                    against the quota, no compensation: the session's value is simply part of the contract's
 *                    unused value that the ending's own refund formula prices.
 *   completed     COMPLETED (client confirmed / auto-confirmed / ruled delivered) -> left alone, history and the
 *                 money rights it already created are untouched.
 *   awaiting      PENDING_CLIENT_CONFIRMATION -> left alone (F2: its value is HELD and settled by its own
 *                 confirm / dispute / auto-confirm flow).
 *   disputed      DISPUTED -> left alone (F2: held for the admin's ruling; never auto-confirmed, never cancelled
 *                 as undelivered, never released).
 *   unanswered    PT_NO_SHOW_REPORTED (the client's "the PT never came" report the PT has not answered; after the
 *                 ending nobody can answer it - L2) -> Decision A (D52): HELD like a disputed session. It becomes a
 *                 DISPUTED session of type PT_NO_SHOW_CLAIM (holdUnansweredNoShowReports below), so it appears in the
 *                 admin dispute queue and an admin's ruling settles its value once. Never cancelled-and-refunded at
 *                 the ending's rate, never completed, never concluded as a PT no-show, no compensation before ruled.
 *   already final CANCELLED / NO_SHOW -> left alone; nothing is ever written over a settled state.
 *
 * Why this exists: before it, only the client's exit from a restricted PT and the PT-lock unwind called their
 * sessions off. Every other ending (client cancel, PT cancel, mutual, expiry, admin, repeated no-show, natural
 * completion) left REQUESTED/CONFIRMED sessions hanging on an ended contract, and those sessions could still
 * trigger money: a PT blocking the day or cancelling late, a PT-no-show admission, the room-close sweep, a join -
 * compensation paid a SECOND time, drawn from the PT's pooled AVAILABLE balance (i.e. other contracts' money).
 */
export const NOT_STARTED_SESSION_STATUSES: SessionStatus[] = [SessionStatus.REQUESTED, SessionStatus.CONFIRMED];

/** The audit action written for a session this routine called off (a caller may substitute its own). */
export const SESSION_CANCELLED_CONTRACT_ENDED = "SESSION_CANCELLED_CONTRACT_ENDED";

/** A session whose state keeps changing under us is re-read this many times before the unit fails. */
const MAX_SESSION_PASSES = 3;

export interface CallOffContext {
  /** Who the audit row names as the actor (the admin / client who triggered the ending, or SYSTEM). */
  actorUserId: string;
  /** The lock command's sequence number, when the ending comes from the PT-lock stream. */
  seq?: bigint | null;
  /** Audit action for each called-off session; {@link SESSION_CANCELLED_CONTRACT_ENDED} when absent. */
  auditAction?: string;
  /** Extra audit metadata for each called-off session. */
  auditExtra?: Record<string, unknown>;
  /** Which open sessions to call off; {@link NOT_STARTED_SESSION_STATUSES} when absent. */
  statuses?: SessionStatus[];
}

/**
 * Calls off a contract's sessions that are still in `ctx.statuses` (default: the not-started ones), one by one,
 * each with a compare-and-swap on the status it was read in - a session that moved on meanwhile (the PT reported
 * it delivered, the client confirmed it) is never overwritten; it is re-read on the next pass and, if it is no
 * longer in the set, left alone. Idempotent. Throws if sessions are still open after the last pass, so the
 * contract stays "needs processing" and the caller retries.
 *
 * `cancelledBy` is SYSTEM, never a person's id: the idle-holdback clock counts a PT-cancelled session as
 * activity (contract.repository.ts findIdleHoldbackCandidates), and an ended contract is not the PT cancelling.
 */
export async function callOffOpenSessions(contractId: string, reason: string, ctx: CallOffContext): Promise<number> {
  const statuses = ctx.statuses ?? NOT_STARTED_SESSION_STATUSES;
  let cancelled = 0;
  for (let pass = 0; pass <= MAX_SESSION_PASSES; pass++) {
    const open = await sessionRepository.findByContractInStatuses(contractId, statuses);
    if (open.length === 0) return cancelled;
    if (pass === MAX_SESSION_PASSES) {
      throw new Error(`${open.length} session(s) of contract ${contractId} kept changing state - could not call them off`);
    }
    for (const session of open) {
      const won = await sessionRepository.transitionStatus(session.id, [session.status], SessionStatus.CANCELLED, {
        cancelledBy: SYSTEM_ACTOR,
        cancellationReason: reason,
      });
      if (!won) continue;
      cancelled++;
      if (session.sessionMode === SessionMode.ONLINE) endOpenRoomCall(session.id, "contract_ended");
      await auditService.record({
        actorUserId: ctx.actorUserId,
        action: ctx.auditAction ?? SESSION_CANCELLED_CONTRACT_ENDED,
        entityType: AuditEntityType.SESSION,
        entityId: session.id,
        metadata: {
          seq: ctx.seq == null ? null : ctx.seq.toString(),
          contractId,
          statusBefore: session.status,
          // The client's "PT never showed" report is closed without anyone ruling on it.
          ptNoShowReportClosedUnadjudicated: session.status === SessionStatus.PT_NO_SHOW_REPORTED,
          reason,
          ...ctx.auditExtra,
        } as any,
      });
    }
  }
  return cancelled; // not reached: the last pass either returned or threw
}

/** The audit action written for a client's "PT never came" report that an ending turned into a held dispute. */
export const SESSION_NO_SHOW_REPORT_HELD = "SESSION_NO_SHOW_REPORT_HELD_CONTRACT_ENDED";

export interface HoldContext {
  actorUserId: string;
  terminationReason?: string;
  seq?: bigint | null;
}

/**
 * Decision A (D52). A session in PT_NO_SHOW_REPORTED when the contract ends - the client says the PT never came, the PT
 * has not answered - is HELD, not called off: one compare-and-set moves it to DISPUTED (disputeType PT_NO_SHOW_CLAIM,
 * the report's own `disputedAt` / `disputeReason` kept), which is the state the existing `unresolvedSessions` hold and
 * the admin dispute queue (GET /sessions/disputed -> POST /sessions/:id/resolve) already understand. Nothing else is
 * decided: not delivered, not a PT no-show, no compensation. The value of the session stays in the contract's pending
 * (payment-service holds it) and is settled ONCE by the admin's ruling (resolveDispute: COMPLETED -> DELIVERED,
 * CANCELLED / PT_NO_SHOW_CONFIRMED -> NOT_DELIVERED). L2: the PT can no longer answer on an ended contract, so the admin
 * is who resolves it.
 *
 * Runs under the contract lock inside settleContractTermination, before the held sessions are counted. Idempotent;
 * a session whose state moved meanwhile (the PT answered) is re-read on the next pass.
 */
export async function holdUnansweredNoShowReports(contractId: string, ctx: HoldContext): Promise<number> {
  let held = 0;
  for (let pass = 0; pass <= MAX_SESSION_PASSES; pass++) {
    const open = await sessionRepository.findByContractInStatuses(contractId, [SessionStatus.PT_NO_SHOW_REPORTED]);
    if (open.length === 0) return held;
    if (pass === MAX_SESSION_PASSES) {
      throw new Error(`${open.length} PT no-show report(s) of contract ${contractId} kept changing state - could not hold them`);
    }
    for (const session of open) {
      const won = await sessionRepository.transitionStatus(session.id, [SessionStatus.PT_NO_SHOW_REPORTED], SessionStatus.DISPUTED, {
        disputeType: SessionDisputeType.PT_NO_SHOW_CLAIM,
        ptNotes: "Hợp đồng đã kết thúc khi huấn luyện viên chưa phản hồi báo cáo vắng mặt - chờ quản trị viên phân xử",
        ...(session.disputedAt ? {} : { disputedAt: new Date() }),
      });
      if (!won) continue;
      held++;
      if (session.sessionMode === SessionMode.ONLINE) endOpenRoomCall(session.id, "contract_ended");
      await auditService.record({
        actorUserId: ctx.actorUserId,
        action: SESSION_NO_SHOW_REPORT_HELD,
        entityType: AuditEntityType.SESSION,
        entityId: session.id,
        metadata: {
          seq: ctx.seq == null ? null : ctx.seq.toString(),
          contractId,
          terminationReason: ctx.terminationReason ?? null,
          statusBefore: SessionStatus.PT_NO_SHOW_REPORTED,
          statusAfter: SessionStatus.DISPUTED,
          decision: "HELD_FOR_ADMIN_RULING",
        } as any,
      });
      // Best-effort, not awaited: the lock is held, and a notice must never lengthen it.
      void notificationService
        .create({
          userId: session.clientUserId,
          text: "Hợp đồng đã kết thúc khi huấn luyện viên chưa phản hồi báo cáo vắng mặt của bạn. Phần tiền của buổi này được giữ lại cho đến khi quản trị viên phân xử.",
          eventType: "SESSION_DISPUTED",
          entityType: "SESSION",
          entityId: session.id,
          link: "/client/booking",
        })
        .catch(() => {});
    }
  }
  return held;
}

/**
 * The client-facing reason written on every session a given ending calls off. The termination's own
 * `cancellationReason` (a lock reason, the client-exit text) wins when the caller supplied one.
 */
export function sessionCallOffReasonFor(reason: string, supplied?: string): string {
  if (supplied && supplied.trim()) return supplied.trim();
  switch (reason) {
    case "CLIENT_CANCELLED":
      return "Hợp đồng đã được khách kết thúc; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
    case "PT_CANCELLED":
      return "Hợp đồng đã được huấn luyện viên kết thúc; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
    case "MUTUAL":
      return "Hợp đồng được kết thúc theo thoả thuận; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
    case "EXPIRED":
      return "Hợp đồng đã hết hạn; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
    case "COMPLETED":
      return "Hợp đồng đã hoàn tất; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
    case "PT_REPEATED_NO_SHOW":
      return "Hợp đồng được kết thúc vì huấn luyện viên vắng nhiều lần; các buổi chưa diễn ra được huỷ, không bị trừ.";
    case "PT_BANNED":
      return "Hợp đồng được kết thúc do huấn luyện viên ngừng hoạt động; các buổi chưa diễn ra được huỷ, không bị trừ.";
    case "CLIENT_EXIT_DUE_TO_PT_RESTRICTION":
      return "Hợp đồng được kết thúc theo yêu cầu của bạn vì huấn luyện viên đang tạm ngưng hoạt động; các buổi chưa diễn ra được huỷ, không bị trừ.";
    default:
      return "Hợp đồng đã kết thúc; các buổi chưa diễn ra được huỷ, không tính vắng và không bị trừ.";
  }
}
