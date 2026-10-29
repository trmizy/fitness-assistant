/**
 * B6a — pure logic of "Tài chính › Hoàn tiền" (chip `?type=`, the service-refund worklist). No React, no I/O:
 * runs under `npx tsx --test`.
 *
 * Backend facts this encodes (ai-service `personalizedServiceService.listRefundRequests`): the one list endpoint
 * returns ONLY orders in status REFUND_REQUESTED, oldest `refundRequestedAt` first, NO pagination and NO cap — so
 * the count is exact. It returns no status filter and no history, so there are no status chips. The refundable
 * ceiling / already-refunded figures exist only per order (`refund-calculation`), so no list total of "money to
 * refund" is computed (Ngài 28/10: refund totals stay out of the overview).
 *
 * Membership refunds have NO list endpoint at all (gym-service only has `POST /admin/gym-memberships/:id/refund`),
 * and no endpoint reads a membership by id — the amount is computed by the server at refund time and can never be
 * previewed. Nothing here fakes a membership queue or an amount.
 */

export type RefundType = "service" | "membership";

export const REFUND_TYPES: readonly RefundType[] = ["service", "membership"];
export const DEFAULT_REFUND_TYPE: RefundType = "service";

/** `?type=` → the chip to show. Anything unknown → the default (service). */
export function parseTypeParam(raw: string | null | undefined): RefundType {
  return (raw ?? "").trim().toLowerCase() === "membership" ? "membership" : DEFAULT_REFUND_TYPE;
}

export interface ServiceRefundOrder {
  id: string;
  title: string;
  buyerId: string;
  sellerId: string;
  /** `priceAtPurchase` as the API sends it (JS number, VND). null = missing/unreadable → shown as "—". */
  price: number | null;
  /** ISO time of `refundRequestedAt`; "" when the API did not send one. */
  requestedAt: string;
  /** The buyer's own words, shown as-is. */
  disputeReason: string | null;
}

export interface NormalizedServiceRefunds {
  rows: ServiceRefundOrder[];
  rawCount: number;
  /** Rows dropped because they are not a REFUND_REQUESTED order with an id. */
  ignored: number;
}

const timeOf = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

export function normalizeServiceRefunds(data: unknown): NormalizedServiceRefunds {
  const list: unknown[] = Array.isArray(data) ? data : [];
  const rows: ServiceRefundOrder[] = [];
  for (const item of list) {
    const o = item as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id) continue;
    if (o.status !== "REFUND_REQUESTED") continue;
    const price = typeof o.priceAtPurchase === "number" && Number.isFinite(o.priceAtPurchase) ? o.priceAtPurchase : null;
    rows.push({
      id: o.id,
      title: typeof o.titleSnapshot === "string" && o.titleSnapshot ? o.titleSnapshot : "Dịch vụ cá nhân hoá",
      buyerId: typeof o.buyerId === "string" ? o.buyerId : "",
      sellerId: typeof o.sellerId === "string" ? o.sellerId : "",
      price,
      requestedAt: typeof o.refundRequestedAt === "string" ? o.refundRequestedAt : "",
      disputeReason: typeof o.disputeReason === "string" && o.disputeReason.trim() ? o.disputeReason : null,
    });
  }
  // Oldest request first (the API order, re-applied so the rule does not depend on it); rows with no date go last.
  rows.sort((a, b) => {
    const x = timeOf(a.requestedAt);
    const y = timeOf(b.requestedAt);
    return x === y ? 0 : x < y ? -1 : 1;
  });
  return { rows, rawCount: list.length, ignored: list.length - rows.length };
}

export interface ServiceRefundSummary {
  count: number;
  /** Oldest valid `requestedAt`, or null. */
  oldest: string | null;
}

export function summarizeServiceRefunds(rows: ServiceRefundOrder[]): ServiceRefundSummary {
  const dated = rows.filter((r) => Number.isFinite(Date.parse(r.requestedAt)));
  return { count: rows.length, oldest: dated.length ? dated[0].requestedAt : null };
}

/** Same tolerance as `checkRefundAmount`: a refund of (almost) the whole ceiling is the LAST refund of the order. */
export const isFinalRefund = (amount: number, ceiling: number): boolean => amount >= ceiling - 0.005;

/** Both ids are shortened the same way everywhere on this tab. */
export { shortId, formatAge, staleMinutes, STALE_AFTER_MINUTES } from "../withdrawals/withdrawalQueue";
