/**
 * B8 L3 — pure model of "Đối chiếu trực tiếp với VNPay (L3)" inside the gateway reconciliation view (runs under `npx tsx --test`, no React).
 *
 * Source: GET /admin/payments/gateway-reconciliation/l3?from&to (payment-service, ADMIN only, READ ONLY). The server asks VNPay's own
 * transaction query API about up to 50 Gymini VNPAY transactions, one by one. VNPay only: other gateways are not covered.
 *
 * Rules kept here, never left to the screen:
 *  - the body is read defensively: a body that is not the documented L3 report is a load FAILURE (never "no discrepancy");
 *  - money stays a decimal STRING all the way to `formatMoneyExact` — no Number() / sum in this module;
 *  - QUERY_FAILED ("không hỏi được") is never a mismatch and is never merged into the mismatch rows;
 *  - NOT_FOUND_AT_VNPAY needs attention only when Gymini says PAID / REFUNDED (a checkout that was never paid is normally unknown to VNPay);
 *  - an unknown result / status is shown with a neutral Vietnamese fallback, never as a raw enum.
 */
import { toDay, rangeDays, type DayRange } from "./gatewayReconciliationModel";

export const L3_PATH = "/admin/payments/gateway-reconciliation/l3";
export const L3_MAX_RANGE_DAYS = 31;
export const L3_DEFAULT_RANGE_DAYS = 7;
export const L3_ITEM_CAP = 50;
/** The run asks VNPay one transaction at a time (up to 50, ~0.3 s apart): the shared axios default of 10 s is far too short. */
export const L3_REQUEST_TIMEOUT_MS = 120_000;

export const L3_TITLE = "Đối chiếu trực tiếp với VNPay (L3)";
export const L3_INTRO =
  "Hỏi thẳng VNPay về từng giao dịch VNPay của Gymini (tối đa 50 giao dịch cũ nhất trong khoảng, hỏi lần lượt nên có thể mất vài chục giây). Chỉ đọc: không thay đổi gì ở Gymini lẫn VNPay. Chỉ áp dụng cho VNPay — các cổng khác chưa được đối chiếu ở mức này.";
export const L3_NOT_CONFIGURED_TEXT = "Chưa cấu hình tài khoản VNPay ở môi trường này";
export const L3_CLEAN_TEXT = "Không phát hiện lệch ở các giao dịch đã hỏi VNPay (mức L3, chỉ VNPay)";
/** Replaces the old "L3 — chưa có nguồn độc lập (BLOCKED)" line of the gateway view. */
export const L3_STATUS_NOTE =
  "Mức L3 (hỏi trực tiếp VNPay) đã có cho VNPay, chạy theo yêu cầu ở phần bên dưới. Cổng ZaloPay chưa được đối chiếu độc lập (MoMo, PayOS đã ngừng dùng, chỉ còn giao dịch cũ); Gymini không hiện số liệu giả thay cho phần này.";

export type VnpayL3Result = "MATCHED" | "NOT_FOUND_AT_VNPAY" | "STATUS_MISMATCH" | "AMOUNT_MISMATCH" | "QUERY_FAILED";
const RESULTS: readonly VnpayL3Result[] = ["MATCHED", "NOT_FOUND_AT_VNPAY", "STATUS_MISMATCH", "AMOUNT_MISMATCH", "QUERY_FAILED"];
export const isKnownResult = (v: unknown): v is VnpayL3Result => typeof v === "string" && (RESULTS as readonly string[]).includes(v);

export const RESULT_LABEL: Record<VnpayL3Result, string> = {
  MATCHED: "Khớp",
  NOT_FOUND_AT_VNPAY: "VNPay không có giao dịch",
  STATUS_MISMATCH: "Lệch trạng thái",
  AMOUNT_MISMATCH: "Lệch số tiền",
  QUERY_FAILED: "Không hỏi được",
};

export interface VnpayL3Counts {
  checked: number;
  matched: number;
  notFoundAtVnpay: number;
  statusMismatch: number;
  amountMismatch: number;
  queryFailed: number;
}

export interface VnpayL3Item {
  transactionId: string;
  providerTransactionId: string | null;
  gyminiStatus: string;
  /** Decimal string as sent ("100000.00"). */
  gyminiAmount: string | null;
  vnpayStatusCode: string | null;
  vnpayAmount: string | null;
  result: VnpayL3Result;
  note: string;
}

export interface VnpayL3Report {
  scope: "L3";
  provider: "VNPAY";
  from: string;
  to: string;
  generatedAt: string;
  counts: VnpayL3Counts;
  items: VnpayL3Item[];
  truncated: boolean;
  configured: boolean;
  /** Items of the response that were unreadable and therefore not shown. */
  ignored: number;
}

// ─────────────────────────────────────────────────────────── normalisation ──
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function normalizeL3Item(raw: unknown): VnpayL3Item | null {
  if (!isRecord(raw)) return null;
  const transactionId = strOrNull(raw.transactionId);
  if (!transactionId || !isKnownResult(raw.result) || typeof raw.gyminiStatus !== "string" || typeof raw.note !== "string") return null;
  return {
    transactionId,
    providerTransactionId: strOrNull(raw.providerTransactionId),
    gyminiStatus: raw.gyminiStatus,
    gyminiAmount: typeof raw.gyminiAmount === "string" ? raw.gyminiAmount : null,
    vnpayStatusCode: strOrNull(raw.vnpayStatusCode),
    vnpayAmount: typeof raw.vnpayAmount === "string" ? raw.vnpayAmount : null,
    result: raw.result,
    note: raw.note,
  };
}

/** `null` = the body is not the documented L3 report (the caller treats it as a load FAILURE, never as "no discrepancy"). */
export function normalizeL3Report(raw: unknown): VnpayL3Report | null {
  if (!isRecord(raw) || raw.scope !== "L3" || raw.provider !== "VNPAY" || !isRecord(raw.counts) || !Array.isArray(raw.items)) return null;
  if (typeof raw.configured !== "boolean" || typeof raw.truncated !== "boolean") return null;
  if (typeof raw.from !== "string" || typeof raw.to !== "string" || typeof raw.generatedAt !== "string") return null;
  const items = raw.items.map(normalizeL3Item).filter((i): i is VnpayL3Item => i !== null);
  const k = raw.counts;
  return {
    scope: "L3",
    provider: "VNPAY",
    from: raw.from,
    to: raw.to,
    generatedAt: raw.generatedAt,
    counts: {
      checked: count(k.checked),
      matched: count(k.matched),
      notFoundAtVnpay: count(k.notFoundAtVnpay),
      statusMismatch: count(k.statusMismatch),
      amountMismatch: count(k.amountMismatch),
      queryFailed: count(k.queryFailed),
    },
    items,
    truncated: raw.truncated,
    configured: raw.configured,
    ignored: raw.items.length - items.length,
  };
}

// ─────────────────────────────────────────────────────────────── grouping ──
const PAID_LIKE = new Set(["PAID", "REFUNDED"]);

/** True when the row needs an admin's eyes: a real mismatch, or "VNPay has no such transaction" while Gymini says it was paid / refunded. */
export function needsAttention(i: VnpayL3Item): boolean {
  if (i.result === "STATUS_MISMATCH" || i.result === "AMOUNT_MISMATCH") return true;
  return i.result === "NOT_FOUND_AT_VNPAY" && PAID_LIKE.has(i.gyminiStatus);
}

export interface L3Groups {
  /** Mismatch rows (+ paid-in-Gymini-but-unknown-to-VNPay), in server order (oldest first). */
  attention: VnpayL3Item[];
  /** "Không hỏi được": never a mismatch. */
  failed: VnpayL3Item[];
  /** VNPay does not know a checkout Gymini never saw paid — normal, shown as information only. */
  notFoundNormal: VnpayL3Item[];
}

export function groupL3Items(report: VnpayL3Report): L3Groups {
  return {
    attention: report.items.filter(needsAttention),
    failed: report.items.filter((i) => i.result === "QUERY_FAILED"),
    notFoundNormal: report.items.filter((i) => i.result === "NOT_FOUND_AT_VNPAY" && !needsAttention(i)),
  };
}

/** Nothing to look at: every asked row matched (or is a normal "VNPay never saw this checkout"), and no lookup failed. */
export function isL3Clean(report: VnpayL3Report): boolean {
  const g = groupL3Items(report);
  return report.configured && report.counts.checked > 0 && g.attention.length === 0 && g.failed.length === 0 && report.counts.statusMismatch + report.counts.amountMismatch === 0 && report.counts.queryFailed === 0;
}

export interface CountChip {
  key: keyof VnpayL3Counts;
  label: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
  value: number;
}
/** Count chips in display order, one per result plus the total asked. */
export function countChips(c: VnpayL3Counts): CountChip[] {
  return [
    { key: "checked", label: "Đã hỏi", tone: "neutral", value: c.checked },
    { key: "matched", label: RESULT_LABEL.MATCHED, tone: "success", value: c.matched },
    { key: "statusMismatch", label: RESULT_LABEL.STATUS_MISMATCH, tone: "danger", value: c.statusMismatch },
    { key: "amountMismatch", label: RESULT_LABEL.AMOUNT_MISMATCH, tone: "danger", value: c.amountMismatch },
    { key: "notFoundAtVnpay", label: RESULT_LABEL.NOT_FOUND_AT_VNPAY, tone: "warning", value: c.notFoundAtVnpay },
    { key: "queryFailed", label: RESULT_LABEL.QUERY_FAILED, tone: "info", value: c.queryFailed },
  ];
}

export const resultTone = (r: VnpayL3Result): CountChip["tone"] =>
  r === "MATCHED" ? "success" : r === "STATUS_MISMATCH" || r === "AMOUNT_MISMATCH" ? "danger" : r === "NOT_FOUND_AT_VNPAY" ? "warning" : "info";

// vnp_TransactionStatus of a querydr answer.
const VNPAY_STATUS_TEXT: Record<string, string> = {
  "00": "Thành công",
  "01": "Chưa hoàn tất",
  "02": "Lỗi",
  "04": "Đã đảo (hoàn)",
  "05": "Đang xử lý hoàn tiền",
  "06": "Đã gửi yêu cầu hoàn tiền",
  "07": "Nghi ngờ gian lận",
  "09": "Hoàn tiền bị từ chối",
};
/** VNPay's status for the table: Vietnamese with a neutral fallback; "—" when VNPay gave none. */
export const vnpayStatusText = (code: string | null): string => (code ? VNPAY_STATUS_TEXT[code] ?? "Trạng thái khác" : "—");

/** Where "Xem giao dịch" goes — the Giao dịch screen opens its drawer from `?id=`. */
export const l3TransactionLink = (transactionId: string): string => `/admin/finance/transactions?id=${encodeURIComponent(transactionId)}`;

// ─────────────────────────────────────────────────────────────── day range ──
/** Default L3 range: the last 7 local days ending today (inclusive). */
export function defaultL3Range(now: Date): DayRange {
  return { from: toDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (L3_DEFAULT_RANGE_DAYS - 1))), to: toDay(now) };
}

export type L3RangeProblem = "ORDER" | "TOO_LONG" | null;
export function l3RangeProblem(r: DayRange): L3RangeProblem {
  if (!r.from || !r.to || r.to < r.from) return "ORDER";
  return rangeDays(r) > L3_MAX_RANGE_DAYS ? "TOO_LONG" : null;
}
export const L3_RANGE_PROBLEM_TEXT: Record<Exclude<L3RangeProblem, null>, string> = {
  ORDER: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
  TOO_LONG: `Khoảng thời gian tối đa ${L3_MAX_RANGE_DAYS} ngày.`,
};

/** Day range → the documented query: `from` inclusive (local midnight), `to` exclusive (local midnight of the day after). */
export function toL3Query(range: DayRange): { from: string; to: string } {
  const [fy, fm, fd] = range.from.split("-").map((n) => parseInt(n, 10));
  const [ty, tm, td] = range.to.split("-").map((n) => parseInt(n, 10));
  return { from: new Date(fy, fm - 1, fd).toISOString(), to: new Date(ty, tm - 1, td + 1).toISOString() };
}
