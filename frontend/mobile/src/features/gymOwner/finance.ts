/**
 * N15M-10 — pure part of the accountant's read-only "Tài chính" on the phone (web: `GymFinancePage`,
 * `utils/financeExport.ts`, `utils/ptCommission.ts`).
 *
 * What gym-service gives an ACCOUNTANT (staff-views.ts): sales rows WITHOUT clientId, wallet balances, withdrawals with
 * the bank account masked, and only the TOTAL of PT commission per period. `normalizePtCommission` keeps only those
 * fields so nothing extra can be drawn.
 */
import { reservedPendingOf, withdrawableOf } from "./gymWithdrawal";

export interface SalesRow {
  id: string;
  gymId: string;
  planId: string;
  status: string;
  priceAtPurchase?: string | number | null;
  createdAt?: string | null;
  paymentTxnId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** Paid cards (ACTIVE + EXPIRED) — same rule as web's `recognizedSales`. */
export function recognizedSales(rows: readonly SalesRow[]): { total: number; count: number } {
  const paid = rows.filter((r) => r.status === "ACTIVE" || r.status === "EXPIRED");
  return { total: paid.reduce((sum, r) => sum + Number(r.priceAtPurchase || 0), 0), count: paid.length };
}

export const SALE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang dùng",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_PAYMENT: "Chờ thanh toán",
};

export const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PAID: "Đã chi",
  REJECTED: "Từ chối",
};

export function withdrawalTone(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "PAID") return "success";
  if (status === "PENDING" || status === "APPROVED") return "warning";
  if (status === "REJECTED") return "danger";
  return "neutral";
}

/** Newest first; rows with no date sink to the bottom. */
export function newestFirst<T extends { createdAt?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ── Platform debt (wallet.gymDebt) ─────────────────────────────────────────────────────────

export interface WalletLike {
  availableBalance?: string | number | null;
  /** payment-service 22/11/2026: what a withdrawal request is really checked against (available − pending requests − platform debt). */
  withdrawable?: string | number | null;
  /** Sum of PENDING withdrawal requests holding money. */
  reservedPending?: string | number | null;
  pendingBalance?: string | number | null;
  gymDebt?: {
    openUnpaid?: string | number | null;
    recoveredTotal?: string | number | null;
    recent?: { at?: string; amount?: string | number; unpaidAfter?: string | number }[];
  } | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function walletTotals(wallets: readonly WalletLike[]) {
  return {
    available: wallets.reduce((s, w) => s + num(w.availableBalance), 0),
    // "Có thể rút": same number the server checks a request against; an old server (no `withdrawable`) falls back to availableBalance.
    withdrawable: wallets.reduce((s, w) => s + withdrawableOf(w), 0),
    reserved: wallets.reduce((s, w) => s + reservedPendingOf(w), 0),
    pending: wallets.reduce((s, w) => s + num(w.pendingBalance), 0),
    debtOpen: wallets.reduce((s, w) => s + num(w.gymDebt?.openUnpaid), 0),
    debtRecovered: wallets.reduce((s, w) => s + num(w.gymDebt?.recoveredTotal), 0),
  };
}

// ── PT commission totals ───────────────────────────────────────────────────────────────────

export interface CommissionBucket {
  expected: number;
  recorded: number;
  paid: number;
  clawedBack: number;
  referralCount: number;
}
export interface PtCommissionSummary {
  totals: CommissionBucket;
  byMonth: Array<CommissionBucket & { month: string }>;
}

function bucket(raw: unknown): CommissionBucket {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    expected: num(r.expected),
    recorded: num(r.recorded),
    paid: num(r.paid),
    clawedBack: num(r.clawedBack),
    referralCount: num(r.referralCount),
  };
}

export function normalizePtCommission(raw: unknown): PtCommissionSummary {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    totals: bucket(d.totals),
    byMonth: (Array.isArray(d.byMonth) ? d.byMonth : []).map((m) => ({
      month: typeof (m as { month?: unknown } | null)?.month === "string" ? (m as { month: string }).month : "",
      ...bucket(m),
    })),
  };
}

/** "2026-10" → "Tháng 10/2026". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `Tháng ${Number(m[2])}/${m[1]}` : month;
}

export type CommissionPreset = "THIS_MONTH" | "LAST_3" | "LAST_6" | "LAST_12";
export const COMMISSION_PRESET_LABEL: Record<CommissionPreset, string> = {
  THIS_MONTH: "Tháng này",
  LAST_3: "3 tháng gần đây",
  LAST_6: "6 tháng gần đây",
  LAST_12: "12 tháng gần đây",
};

/** Start date (YYYY-MM-DD, Vietnam calendar month) of the period; it runs to now. */
export function commissionRangeFor(preset: CommissionPreset, now: Date = new Date()): { from: string } {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  const back = preset === "THIS_MONTH" ? 0 : preset === "LAST_3" ? 2 : preset === "LAST_6" ? 5 : 11;
  const start = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() - back, 1));
  return { from: start.toISOString().slice(0, 10) };
}

// ── CSV export (same content as web: utils/financeExport.ts + ptCommission.ts) ──────────────

export type WithdrawalCsvRow = {
  id: string;
  amount?: string | number | null;
  status?: string | null;
  bankReference?: string | null;
  payoutInfo?: string | null;
  createdAt?: string | null;
  paidAt?: string | null;
  gymName?: string;
};

/** CSV-injection guard (=, +, -, @ at the start of a cell) + RFC 4180 quoting. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** UTF-8 BOM first, so Excel reads the Vietnamese text correctly (web prepends the same bytes). */
export const CSV_BOM = "﻿";
export const withBom = (csv: string) => CSV_BOM + csv;

export function salesCsv(rows: readonly SalesRow[], names: { gym: (id: string) => string; plan: (id: string) => string }): string {
  return toCsv(
    ["Mã thẻ", "Chi nhánh", "Gói", "Trạng thái", "Giá (VND)", "Mã giao dịch", "Bắt đầu", "Kết thúc", "Ngày tạo"],
    rows.map((r) => [r.id, names.gym(r.gymId), names.plan(r.planId), r.status, Number(r.priceAtPurchase), r.paymentTxnId ?? "", r.startDate ?? "", r.endDate ?? "", r.createdAt ?? ""]),
  );
}

export function withdrawalsCsv(rows: readonly WithdrawalCsvRow[]): string {
  return toCsv(
    ["Mã yêu cầu", "Chi nhánh", "Số tiền (VND)", "Trạng thái", "Mã tham chiếu", "Thông tin nhận tiền (đã che)", "Ngày tạo", "Ngày chi"],
    rows.map((r) => [r.id, r.gymName ?? "", Number(r.amount), r.status ?? "", r.bankReference ?? "", r.payoutInfo ?? "", r.createdAt ?? "", r.paidAt ?? ""]),
  );
}

export function commissionCsv(s: PtCommissionSummary): string {
  return toCsv(
    ["Kỳ", "Dự kiến (VND)", "Đã ghi nhận (VND)", "Đã chi (VND)", "Đã thu hồi (VND)", "Số hoa hồng"],
    [
      ...s.byMonth.map((m) => [m.month, m.expected, m.recorded, m.paid, m.clawedBack, m.referralCount]),
      ["Tổng", s.totals.expected, s.totals.recorded, s.totals.paid, s.totals.clawedBack, s.totals.referralCount],
    ],
  );
}
