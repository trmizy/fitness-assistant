import { SessionStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan 3.1 — "hợp nhất hậu quả khi PT nghỉ".
 *
 * The single source of truth for matrix 0.1: what happens to a session's status, the client's
 * quota, and who owes whom, for every actor/event/notice combination. Before this, the SAME
 * real-world event — a PT cancelling on short notice — produced two different financial
 * outcomes depending on which code path handled it: `availability.service.ts#addException`
 * (blocking a date) always compensated the client, while `booking.service.ts#cancelSession`
 * (a PT cancelling one session directly) never did. A PT choosing between the two had an
 * incentive to always pick the path that cost them nothing.
 *
 * `addException`, `cancelSession`, and `markNoShow` must all call this instead of deciding
 * independently — see money-flow.md §0.1 for the policy table this encodes.
 */

export type SessionOutcomeActor = "CLIENT" | "PT" | "FORCE_MAJEURE";
export type SessionOutcomeEvent = "CANCEL" | "NO_SHOW";

export interface SessionOutcomeInput {
  actor: SessionOutcomeActor;
  event: SessionOutcomeEvent;
  /** Hours between now and the session's scheduled start. Negative if already past start. */
  hoursBeforeStart: number;
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

/** money-flow.md §0.1 — "Mốc 24 giờ đặt thành hằng số cấu hình SESSION_LATE_CANCEL_HOURS,
 * mặc định 24." Read once at module load, matching how other tunables in this codebase are
 * configured (e.g. PLATFORM_COMMISSION_RATE in payment-service). */
export const SESSION_LATE_CANCEL_HOURS = Number(process.env.SESSION_LATE_CANCEL_HOURS ?? 24);

export function resolveSessionOutcome(input: SessionOutcomeInput): SessionOutcome {
  const isLate = input.hoursBeforeStart < SESSION_LATE_CANCEL_HOURS;

  // Bất khả kháng — đặt lại, không phạt ai (matrix row 6).
  if (input.actor === "FORCE_MAJEURE") {
    return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "KEEP", clientCompensation: false, ptPayout: false };
  }

  if (input.actor === "CLIENT") {
    // The client only ever cancels — they cannot "no-show" themselves.
    if (isLate) {
      // Row 2: khách huỷ <24h — mất 1 quota, PT hưởng trọn buổi.
      return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "DEDUCT", clientCompensation: false, ptPayout: true };
    }
    // Row 1: khách huỷ ≥24h — buổi trả về, đặt lại, không ai bị phạt.
    return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "KEEP", clientCompensation: false, ptPayout: false };
  }

  // actor === "PT"
  if (input.event === "NO_SHOW") {
    // Row 5: PT vắng mặt — luôn bồi thường, bất kể báo trước hay không (không có khái niệm
    // "báo trước" cho một buổi đã trôi qua mà PT không tới).
    return { sessionStatus: SessionStatus.NO_SHOW, clientQuotaEffect: "KEEP", clientCompensation: true, ptPayout: false };
  }
  if (isLate) {
    // Row 4: PT huỷ/chặn ngày <24h — bồi thường, PT chịu. Financially identical to a no-show
    // (matrix 0.1 gives both the same outcome), tagged NO_SHOW for the same reason the
    // pre-existing addException code already did: the client experiences it the same way —
    // a session they expected did not happen, on short notice.
    return { sessionStatus: SessionStatus.NO_SHOW, clientQuotaEffect: "KEEP", clientCompensation: true, ptPayout: false };
  }
  // Row 3: PT huỷ/chặn ngày ≥24h — CHUYỂN SANG ĐẶT LẠI, KHÔNG bồi thường tiền. This is the
  // exact case the plan calls out as currently wrong: a PT blocking a date well in advance
  // must not cost them anything, only force a reschedule.
  return { sessionStatus: SessionStatus.CANCELLED, clientQuotaEffect: "KEEP", clientCompensation: false, ptPayout: false };
}
