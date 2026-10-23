/**
 * DQ-4 - "Bạn nhận X (Y%)" on a PT's contract review / accept screen (mobile; same rule as web utils/ptContractShare.ts).
 *
 * Pure view-model (no React, no network). X and Y come from the CONTRACT'S OWN frozen split snapshot (`ptRate`, written once
 * when the client sent the request) applied to the contract's own `price` - never from today's PT-gym agreement. The server
 * returns `ptRate` only to the contract's PT and to admins (contract-dto.ts), so for any other viewer this yields null and the
 * line is simply not drawn.
 */

export interface PtContractShare {
  /** The PT's share of the contract price, whole VND. */
  amount: number;
  /** The PT's percentage of the contract price, e.g. "55" or "87,5". */
  percentText: string;
  /** Ready-to-show sentence: "Bạn nhận 2.200.000đ (55%)". */
  text: string;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

export function ptContractShare(contract: { price?: unknown; ptRate?: unknown } | null | undefined): PtContractShare | null {
  const price = toNumber(contract?.price);
  const rate = toNumber(contract?.ptRate);
  if (price === null || rate === null || price < 0 || rate < 0 || rate > 1) return null;
  const amount = Math.round(price * rate);
  const pct = Math.round(rate * 10000) / 100; // 0.5500 -> 55 ; 0.875 -> 87.5
  const percentText = String(pct).replace(".", ",");
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount);
  return { amount, percentText, text: `Bạn nhận ${money}đ (${percentText}%)` };
}
