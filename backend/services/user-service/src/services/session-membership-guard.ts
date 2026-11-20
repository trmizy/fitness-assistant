import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import type { ClientMembershipLookup, ClientMembershipSummary } from "../clients/gym.client";

/**
 * Booking guard (owner rule 19/11/2026, item 4): a session at a GYM BRANCH may only be booked or moved to a date on which the
 * client has an active OR queued (stacked renewal) membership at that gym's brand. Hiring a PT through a gym no longer requires
 * the membership to cover the whole contract (contract-gym-membership.service.ts reports that as a warning), so THIS is where
 * "you have no membership on that day" is actually enforced - server-side, with a clear Vietnamese message.
 *
 * Separate module on purpose: booking.service.ts only calls `assertGymMembershipCoversSession` once per slot (booking, batch
 * slot, reschedule request, reschedule accept), so the rule lives in one place and the booking flows stay readable.
 *
 * Not applied to: a contract without a gym, and ONLINE sessions (no branch is visited).
 * Day semantics: calendar days in Asia/Ho_Chi_Minh (UTC+7, no DST). A membership covers every local day from the day it starts
 * through the day it ends, inclusive; an open-ended membership (no end date) covers everything after its start.
 * Fail closed: gym-service unreachable -> 503, never "covered" and never "not covered".
 */

export const SESSION_NOT_COVERED_BY_MEMBERSHIP = "SESSION_NOT_COVERED_BY_MEMBERSHIP";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local (Asia/Ho_Chi_Minh) calendar day number of an instant. */
function vnDay(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

function ddmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + VN_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Does any active or queued membership of the lookup cover the local day of `at`? Pure. */
export function membershipCoversDay(lookup: ClientMembershipLookup | null, at: Date): boolean {
  return windowsOf(lookup).some((m) => {
    const start = m.startDate ? Date.parse(m.startDate) : Number.NEGATIVE_INFINITY;
    const end = m.endDate ? Date.parse(m.endDate) : Number.POSITIVE_INFINITY;
    if (Number.isNaN(start) || Number.isNaN(end)) return false; // unreadable date: cannot prove coverage
    const day = vnDay(at.getTime());
    const startDay = start === Number.NEGATIVE_INFINITY ? Number.NEGATIVE_INFINITY : vnDay(start);
    const endDay = end === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : vnDay(end);
    return day >= startDay && day <= endDay;
  });
}

function windowsOf(lookup: ClientMembershipLookup | null): ClientMembershipSummary[] {
  if (!lookup) return [];
  const current = lookup.memberships && lookup.memberships.length > 0 ? lookup.memberships : lookup.membership ? [lookup.membership] : [];
  return [...(lookup.hasActiveMembership ? current : []), ...(lookup.upcoming ?? [])];
}

function guardError(message: string, details: Record<string, unknown>) {
  return Object.assign(new Error(message), { status: 422, code: SESSION_NOT_COVERED_BY_MEMBERSHIP, details });
}

/**
 * Throws 422 SESSION_NOT_COVERED_BY_MEMBERSHIP when the client has no active-or-queued membership at the contract's gym brand on
 * the date of `startAt`. `contract` is the contract row (only gymId and clientUserId are read); `sessionMode` the session's mode
 * (ONLINE is exempt). The error carries `details: { gymId, date, membershipEndsAt }` so a UI can offer "Gia hạn gói hội viên".
 */
export async function assertGymMembershipCoversSession(
  contract: { gymId?: string | null; clientUserId: string },
  startAt: Date,
  sessionMode?: string | null,
): Promise<void> {
  if (!contract.gymId) return;
  if (sessionMode === "ONLINE") return;

  let lookup: ClientMembershipLookup | null;
  try {
    lookup = await gymClient.getClientMembershipAtGym(contract.clientUserId, contract.gymId);
  } catch (e) {
    if (e instanceof GymServiceUnavailableError) {
      throw Object.assign(new Error("Không thể xác nhận gói hội viên của bạn lúc này, vui lòng thử lại"), { status: 503 });
    }
    throw e;
  }
  if (membershipCoversDay(lookup, startAt)) return;

  const day = ddmm(startAt.toISOString());
  const windows = windowsOf(lookup);
  const latestEnd = windows
    .map((m) => (m.endDate ? Date.parse(m.endDate) : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];
  const membershipEndsAt = latestEnd !== undefined ? new Date(latestEnd).toISOString() : null;
  const message =
    windows.length === 0
      ? `Bạn chưa có gói hội viên còn hiệu lực tại phòng gym này nên không thể đặt hoặc dời buổi tập vào ngày ${day}. Hãy gia hạn gói hội viên.`
      : `Gói hội viên của bạn không có hiệu lực vào ngày ${day}${membershipEndsAt ? ` (gói hết hạn ${ddmm(membershipEndsAt)})` : ""} nên không thể đặt hoặc dời buổi tập vào ngày này. Hãy gia hạn gói hội viên.`;
  throw guardError(message, { gymId: contract.gymId, date: startAt.toISOString(), membershipEndsAt });
}
