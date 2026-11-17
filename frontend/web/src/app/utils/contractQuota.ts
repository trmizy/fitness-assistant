/**
 * N15C-10 — how many sessions a client can still BOOK on a contract. Mirrors the backend quota gate
 * (user-service booking.service.ts: `getRemainingEntitlements(contract) <= countActiveByContract` -> 400
 * "Hợp đồng đã dùng hết số buổi"):
 *   entitlements = totalSessions - usedSessions - compensatedSessions
 *   active       = sessions in REQUESTED / CONFIRMED / PENDING_CLIENT_CONFIRMATION / DISPUTED / PT_NO_SHOW_REPORTED
 *   bookable     = max(0, entitlements - active)
 * A session that is booked but not finished yet already holds one entitlement, so "còn N buổi" must not count it.
 */

/** Same set as user-service session.repository.ts countActiveByContract. */
export const ACTIVE_SESSION_STATUSES: readonly string[] = [
  "REQUESTED",
  "CONFIRMED",
  "PENDING_CLIENT_CONFIRMATION",
  "DISPUTED",
  "PT_NO_SHOW_REPORTED",
];

export interface QuotaContract {
  totalSessions: number;
  usedSessions: number;
  compensatedSessions?: number | null;
}

/** Entitlement left on the contract, ignoring sessions already booked (same as backend getRemainingEntitlements). */
export function remainingEntitlements(c: QuotaContract): number {
  return Math.max(0, c.totalSessions - c.usedSessions - (c.compensatedSessions ?? 0));
}

/** Sessions that can still be booked right now. Pass the contract's own sessions; without them it equals the entitlement. */
export function bookableSessionsLeft(c: QuotaContract, sessions?: { status: string }[] | null): number {
  const active = (sessions ?? []).filter((s) => ACTIVE_SESSION_STATUSES.includes(s.status)).length;
  return Math.max(0, remainingEntitlements(c) - active);
}

/** "17 tháng 11, 2026 lúc 10:00" (vi-VN). */
export function formatViDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (
    d.toLocaleDateString("vi-VN", { day: "numeric", month: "long", year: "numeric" }) +
    " lúc " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}
