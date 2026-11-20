import { SessionStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan 3.1 - the single source of truth for matrix 0.1: what happens to a
 * session's status, the client's quota, and who owes whom, for every actor/event combination.
 *
 * `addException`, `cancelSession`, `markNoShow` and the PT-restriction administrative cancel must all call
 * this instead of deciding independently, so the SAME real-world event never produces two financial outcomes.
 *
 * OWNER DECISION 20/11/2026 - the 24-hour grace is REMOVED. Cancelling a CONFIRMED session costs the
 * canceller at ANY time; the notice period no longer matters (the old SESSION_LATE_CANCEL_HOURS threshold and
 * rows 1/3 of the earlier matrix are gone). Matrix now:
 *
 *   actor          event     result
 *   CLIENT         CANCEL    client loses the session (DEDUCT), PT earns the full session (ptPayout)
 *   PT             CANCEL    client compensated one session in cash, charged to the PT; the session is consumed
 *                            (compensatedSessions + 1, status NO_SHOW); PT gets no payout
 *   PT             NO_SHOW   same as PT CANCEL
 *   FORCE_MAJEURE  CANCEL    nobody is penalised, session returned to the client (unchanged)
 *
 * Not decided here: cancelling a REQUESTED (not yet confirmed) session - cancelSession handles that branch itself
 * with no money and no quota; and rescheduling (a move both sides agree to) stays free and never reaches this file.
 */

export type SessionOutcomeActor = "CLIENT" | "PT" | "FORCE_MAJEURE";
export type SessionOutcomeEvent = "CANCEL" | "NO_SHOW";

export interface SessionOutcomeInput {
  actor: SessionOutcomeActor;
  event: SessionOutcomeEvent;
  /**
   * Hours between now and the scheduled start. Informational only - since the owner decision of 20/11/2026 the
   * outcome no longer depends on the notice period. Callers need not pass it.
   */
  hoursBeforeStart?: number;
}

export interface SessionOutcome {
  sessionStatus: typeof SessionStatus.CANCELLED | typeof SessionStatus.NO_SHOW;
  /** Whether the session still counts against the client's purchased entitlement. */
  clientQuotaEffect: "KEEP" | "DEDUCT";
  /** The client is compensated one session's cash value, charged to the PT (matrix 0.1). */
  clientCompensation: boolean;
  /** The PT earns this session's full value, same as if it had been delivered (matrix 0.1). */
  ptPayout: boolean;
}

export function resolveSessionOutcome(input: SessionOutcomeInput): SessionOutcome {
  // Bất khả kháng - đặt lại, không phạt ai.
  if (input.actor === "FORCE_MAJEURE") {
    return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "KEEP", clientCompensation: false, ptPayout: false };
  }

  if (input.actor === "CLIENT") {
    // Chủ sở hữu quyết định 20/11/2026: khách huỷ buổi đã xác nhận, lúc nào cũng vậy - mất 1 buổi, PT hưởng trọn buổi.
    // (The client only ever cancels - they cannot "no-show" themselves.)
    return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "DEDUCT", clientCompensation: false, ptPayout: true };
  }

  // actor === "PT": huỷ / chặn ngày / vắng mặt - luôn bồi thường cho khách, PT chịu, PT không nhận tiền buổi đó.
  // Tagged NO_SHOW (financially identical to a no-show): the client experiences it the same way - a session they
  // expected did not happen - and the session is consumed (compensatedSessions + 1) via recordNoShowIntent.
  return { sessionStatus: SessionStatus.NO_SHOW, clientQuotaEffect: "KEEP", clientCompensation: true, ptPayout: false };
}
