/**
 * B5 — pure logic of the admin withdrawal queue (chips, totals, "≥100" rule, ages). No React, no I/O:
 * runs under `npx tsx --test`.
 *
 * Backend facts this encodes (payment-service `withdrawalRepository.listPending`): the one list endpoint returns
 * ONLY PENDING + APPROVED rows, oldest first, capped at 100 rows TOTAL. So a chip's count / total is exact only
 * while the list is shorter than the cap; at the cap it is a lower bound ("≥").
 */

export const WITHDRAWAL_API_LIMIT = 100;

export type QueueStatus = "PENDING" | "APPROVED";

export interface WithdrawalRequest {
  id: string;
  ownerType: "PT" | "GYM" | "CLIENT";
  ownerId: string;
  /** Decimal string as the backend sends it ("1500000", "1500000.00"). Never parsed with Number() for sums. */
  amount: string;
  status: QueueStatus;
  payoutInfo: string;
  createdAt: string;
}

export const QUEUE_STATUSES: readonly QueueStatus[] = ["PENDING", "APPROVED"];
export const DEFAULT_STATUS: QueueStatus = "PENDING";

/** `?status=` → the chip to show. Anything unknown (incl. the not-yet-available PAID/REJECTED chips) → the default. */
export function parseStatusParam(raw: string | null | undefined): QueueStatus {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "APPROVED" ? "APPROVED" : DEFAULT_STATUS;
}

export interface NormalizedQueue {
  rows: WithdrawalRequest[];
  /** Length of what the server sent (before dropping rows this screen cannot show). */
  rawCount: number;
  /** Rows dropped because they are not a PENDING/APPROVED request with an id. */
  ignored: number;
  /** The server answered at its cap → there may be more rows than shown. */
  truncated: boolean;
}

export function normalizeQueue(data: unknown, limit: number = WITHDRAWAL_API_LIMIT): NormalizedQueue {
  const list: unknown[] = Array.isArray(data) ? data : [];
  const rows: WithdrawalRequest[] = [];
  for (const item of list) {
    const r = item as Partial<WithdrawalRequest> | null;
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id) continue;
    if (r.status !== "PENDING" && r.status !== "APPROVED") continue;
    rows.push({
      id: r.id,
      ownerType: (r.ownerType as WithdrawalRequest["ownerType"]) ?? "CLIENT",
      ownerId: typeof r.ownerId === "string" ? r.ownerId : "",
      amount: r.amount === undefined || r.amount === null ? "" : String(r.amount),
      status: r.status,
      payoutInfo: typeof r.payoutInfo === "string" ? r.payoutInfo : "",
      createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    });
  }
  return { rows, rawCount: list.length, ignored: list.length - rows.length, truncated: list.length >= limit };
}

/** Rows of one chip, oldest first (the API order is oldest first; sorted again so the rule does not depend on it). */
export function rowsFor(rows: WithdrawalRequest[], status: QueueStatus): WithdrawalRequest[] {
  return rows
    .filter((r) => r.status === status)
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}

/** Decimal VND string → hundredths (BigInt), no float. null = not a plain non-negative decimal. */
export function toCents(amount: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec((amount ?? "").trim());
  if (!m) return null;
  const frac = ((m[2] ?? "") + "00").slice(0, 2);
  return BigInt(m[1]) * 100n + BigInt(frac);
}

export interface AmountSum {
  /** Hundredths of VND; null when at least one amount is unreadable (the total would be a guess). */
  cents: bigint | null;
  invalid: number;
}

/** Sum of the given rows' amounts — callers pass the rows of ONE status only. */
export function sumAmounts(rows: Pick<WithdrawalRequest, "amount">[]): AmountSum {
  let cents = 0n;
  let invalid = 0;
  for (const r of rows) {
    const c = toCents(r.amount);
    if (c === null) invalid++;
    else cents += c;
  }
  return { cents: invalid > 0 ? null : cents, invalid };
}

/** VND number for `moneyText`; null when the sum is unknown. */
export function centsToVnd(cents: bigint | null): number | null {
  return cents === null ? null : Number(cents) / 100;
}

export interface ChipSummary {
  status: QueueStatus;
  count: number;
  total: AmountSum;
  /** Oldest `createdAt` among the rows of this chip, or null. */
  oldest: string | null;
  /** count/total are lower bounds (the list hit the API cap). */
  lowerBound: boolean;
}

export function summarize(queue: NormalizedQueue): Record<QueueStatus, ChipSummary> {
  const out = {} as Record<QueueStatus, ChipSummary>;
  for (const status of QUEUE_STATUSES) {
    const rows = rowsFor(queue.rows, status);
    out[status] = {
      status,
      count: rows.length,
      total: sumAmounts(rows),
      oldest: rows.find((r) => Number.isFinite(Date.parse(r.createdAt)))?.createdAt ?? null,
      lowerBound: queue.truncated,
    };
  }
  return out;
}

/** "12" or "≥12" when the number is only a lower bound. */
export const countText = (count: number, lowerBound: boolean): string => (lowerBound ? `≥${count}` : String(count));

/** Vietnamese age: "vừa xong", "5 phút", "5 giờ 30 phút", "2 ngày", "1 ngày 2 giờ". "—" for a bad date. */
export function formatAge(createdAt: string, now: number): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return "—";
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const m = mins % 60;
    return m ? `${hours} giờ ${m} phút` : `${hours} giờ`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} ngày ${h} giờ` : `${days} ngày`;
}

/** How many whole minutes the data on screen is old, or null when it is fresh enough not to mention (plan E-08). */
export const STALE_AFTER_MINUTES = 3;
export function staleMinutes(dataUpdatedAt: number, now: number): number | null {
  if (!dataUpdatedAt || !Number.isFinite(now)) return null;
  const m = Math.floor((now - dataUpdatedAt) / 60_000);
  return m >= STALE_AFTER_MINUTES ? m : null;
}

export const shortId = (id: string): string => (id ? id.slice(0, 8) : "—");
