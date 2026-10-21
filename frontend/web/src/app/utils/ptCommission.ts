/**
 * D15b — tổng hoa hồng PT theo kỳ cho KẾ TOÁN (gym-service GET /owner/finance/pt-commission).
 *
 * Server chỉ trả TỔNG (không theo PT, không tỷ lệ, không điều khoản cộng tác). `normalizePtCommission` cố ý chỉ giữ các
 * trường đã biết để giao diện/CSV không thể lộ thêm gì nếu server từng gửi dư.
 */
import { toCsv } from "./financeExport";

export interface CommissionBucket {
  expected: number;
  recorded: number;
  paid: number;
  clawedBack: number;
  referralCount: number;
}
export interface PtCommissionSummary {
  from: string | null;
  to: string | null;
  branchCount: number;
  totals: CommissionBucket;
  byMonth: Array<CommissionBucket & { month: string }>;
  definitions: { expected: string; recorded: string; paid: string; clawedBack: string; period: string };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function bucket(raw: unknown): CommissionBucket {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { expected: num(r.expected), recorded: num(r.recorded), paid: num(r.paid), clawedBack: num(r.clawedBack), referralCount: num(r.referralCount) };
}

export function normalizePtCommission(raw: unknown): PtCommissionSummary {
  const d = (raw ?? {}) as Record<string, unknown>;
  const def = (d.definitions ?? {}) as Record<string, unknown>;
  return {
    from: typeof d.from === "string" ? d.from : null,
    to: typeof d.to === "string" ? d.to : null,
    branchCount: num(d.branchCount),
    totals: bucket(d.totals),
    byMonth: (Array.isArray(d.byMonth) ? d.byMonth : []).map((m) => ({ month: str((m as Record<string, unknown> | null)?.month), ...bucket(m) })),
    definitions: { expected: str(def.expected), recorded: str(def.recorded), paid: str(def.paid), clawedBack: str(def.clawedBack), period: str(def.period) },
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

/** Ngày bắt đầu (YYYY-MM-DD, lịch tháng giờ Việt Nam) của kỳ; kỳ kéo dài đến hiện tại. */
export function commissionRangeFor(preset: CommissionPreset, now: Date = new Date()): { from: string } {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  const back = preset === "THIS_MONTH" ? 0 : preset === "LAST_3" ? 2 : preset === "LAST_6" ? 5 : 11;
  const start = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() - back, 1));
  return { from: start.toISOString().slice(0, 10) };
}

/** CSV tổng hợp theo tháng — chỉ các con số đã hiện trên màn hình. */
export function commissionCsv(s: PtCommissionSummary): string {
  return toCsv(
    ["Kỳ", "Dự kiến (VND)", "Đã ghi nhận (VND)", "Đã chi (VND)", "Đã thu hồi (VND)", "Số hoa hồng"],
    [
      ...s.byMonth.map((m) => [m.month, m.expected, m.recorded, m.paid, m.clawedBack, m.referralCount]),
      ["Tổng", s.totals.expected, s.totals.recorded, s.totals.paid, s.totals.clawedBack, s.totals.referralCount],
    ],
  );
}
