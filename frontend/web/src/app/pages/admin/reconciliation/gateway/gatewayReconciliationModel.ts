/**
 * B8 — pure model of "Tài chính › Đối soát › Đối chiếu cổng ↔ Gymini" (level L2; runs under `npx tsx --test`, no React).
 *
 * Source: GET /admin/payments/gateway-reconciliation?from&to (payment-service, ADMIN only, READ ONLY). L2 = the figures come from what the
 * gateway sent back and Gymini stored — NOT an independent comparison with the gateway's own settlement file (that is L3, no source yet).
 *
 * Rules kept here, never left to the screen:
 *  - the body is read defensively: a body that is not the documented report is a load FAILURE (never an empty "no discrepancy");
 *  - money stays a decimal STRING all the way to `formatMoneyExact` — there is no Number() / sum anywhere in this module;
 *  - an unknown category / severity / provider / status is shown with a neutral Vietnamese fallback, never as a raw enum;
 *  - the URL keeps the day range (`from`, `to`, both `YYYY-MM-DD`, `to` inclusive); the default (last 30 days) is not written to the URL.
 */
import { providerLabel, statusLabel } from "../../finance/transactions/transactionsLabels";

export const GATEWAY_RECON_PATH = "/admin/payments/gateway-reconciliation";
export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 30;
export const ITEM_CAP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────────── text ──
export const L2_BANNER_TEXT =
  "Dựa trên dữ liệu cổng gửi về và Gymini đã lưu; chưa phải đối soát độc lập với file quyết toán của cổng.";
export const EMPTY_TEXT = "Không phát hiện lệch trong khoảng thời gian này (mức L2)";

export type GatewaySeverity = "danger" | "warning" | "info";
export const SEVERITY_LABEL: Record<GatewaySeverity, string> = { danger: "Cần xem ngay", warning: "Theo dõi", info: "Thông tin" };

export type GatewayCategoryCode =
  | "WEBHOOK_UNPROCESSED"
  | "WEBHOOK_ORPHAN"
  | "GATEWAY_SUCCESS_NOT_PAID"
  | "REPORTED_AMOUNT_MISMATCH"
  | "PAID_WITHOUT_GATEWAY_EVENT";

/** The five categories the server derives, in the order it returns them; `rule` is the plain-language rule shown under the title. */
export const CATEGORY_TEXT: Record<GatewayCategoryCode, { title: string; rule: string; countKey: keyof GatewayCounts }> = {
  WEBHOOK_UNPROCESSED: {
    title: "Sự kiện cổng chưa được xử lý",
    rule: "Cổng đã gửi thông báo và Gymini đã lưu, nhưng quá 10 phút vẫn chưa xử lý xong.",
    countKey: "webhookUnprocessed",
  },
  WEBHOOK_ORPHAN: {
    title: "Sự kiện cổng không khớp giao dịch nào",
    rule: "Thông báo cổng gửi về mà Gymini không tìm thấy giao dịch tương ứng (cùng cổng, cùng mã tham chiếu).",
    countKey: "webhookOrphan",
  },
  GATEWAY_SUCCESS_NOT_PAID: {
    title: "Cổng báo thành công nhưng giao dịch chưa thanh toán",
    rule: "Cổng báo đã thu tiền thành công, nhưng giao dịch của Gymini chưa ở trạng thái đã thanh toán hoặc đã hoàn tiền (quá 10 phút).",
    countKey: "gatewaySuccessNotPaid",
  },
  REPORTED_AMOUNT_MISMATCH: {
    title: "Số tiền cổng báo khác số tiền giao dịch",
    rule: "Cổng báo thành công với một số tiền đọc được rõ ràng và khác số tiền giao dịch. Các giao dịch đã nằm trong danh sách “Cổng báo số tiền khác số Gymini” (tab Ngoại lệ) không đếm lại ở đây.",
    countKey: "reportedAmountMismatch",
  },
  PAID_WITHOUT_GATEWAY_EVENT: {
    title: "Đã thanh toán nhưng chưa có sự kiện cổng gửi về",
    rule: "Giao dịch đã thanh toán qua cổng nhưng chưa có thông báo (IPN/chuyển hướng) nào được lưu. Có thể hợp lệ nếu được xác nhận bằng truy vấn chủ động tới cổng.",
    countKey: "paidWithoutGatewayEvent",
  },
};

export const isKnownCategory = (code: string): code is GatewayCategoryCode => Object.prototype.hasOwnProperty.call(CATEGORY_TEXT, code);

// ───────────────────────────────────────────────────────────── wire types ──
export interface GatewayCounts {
  webhookEventsInRange: number;
  paidGatewayTransactionsInRange: number;
  webhookUnprocessed: number;
  webhookOrphan: number;
  gatewaySuccessNotPaid: number;
  reportedAmountMismatch: number;
  paidWithoutGatewayEvent: number;
  coveredByGatewayDiscrepancies: number;
}

export interface GatewayItem {
  transactionId: string | null;
  webhookEventId: string | null;
  provider: string;
  providerTransactionId: string | null;
  transactionStatus: string | null;
  /** Decimal string exactly as the server sent it ("100000.00"). */
  amount: string | null;
  reportedAmount: string | null;
  createdAt: string;
  note: string;
}

export interface GatewayCategory {
  code: string;
  label: string;
  severity: GatewaySeverity;
  items: GatewayItem[];
  truncated: boolean;
}

export interface GatewayReport {
  scope: "L2";
  from: string;
  to: string;
  generatedAt: string;
  counts: GatewayCounts;
  categories: GatewayCategory[];
  /** Items of the response that were unreadable and therefore not shown. */
  ignored: number;
}

// ─────────────────────────────────────────────────────────── normalisation ──
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function normalizeGatewayItem(raw: unknown): GatewayItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.provider !== "string" || typeof raw.createdAt !== "string" || typeof raw.note !== "string") return null;
  // An item has to point at something: a transaction or an event.
  const transactionId = strOrNull(raw.transactionId);
  const webhookEventId = strOrNull(raw.webhookEventId);
  if (!transactionId && !webhookEventId) return null;
  return {
    transactionId,
    webhookEventId,
    provider: raw.provider,
    providerTransactionId: strOrNull(raw.providerTransactionId),
    transactionStatus: strOrNull(raw.transactionStatus),
    amount: typeof raw.amount === "string" ? raw.amount : null,
    reportedAmount: typeof raw.reportedAmount === "string" ? raw.reportedAmount : null,
    createdAt: raw.createdAt,
    note: raw.note,
  };
}

/** `null` = the body is not the documented report (the caller treats it as a load FAILURE, never as "no discrepancy"). */
export function normalizeGatewayReport(raw: unknown): GatewayReport | null {
  if (!isRecord(raw) || raw.scope !== "L2" || !Array.isArray(raw.categories) || !isRecord(raw.counts)) return null;
  if (typeof raw.from !== "string" || typeof raw.to !== "string" || typeof raw.generatedAt !== "string") return null;
  let ignored = 0;
  const categories: GatewayCategory[] = [];
  for (const c of raw.categories) {
    if (!isRecord(c) || typeof c.code !== "string" || !Array.isArray(c.items)) return null;
    const items = c.items.map(normalizeGatewayItem).filter((i): i is GatewayItem => i !== null);
    ignored += c.items.length - items.length;
    categories.push({
      code: c.code,
      label: typeof c.label === "string" ? c.label : "",
      severity: c.severity === "danger" || c.severity === "warning" ? c.severity : "info",
      items,
      truncated: c.truncated === true,
    });
  }
  const k = raw.counts;
  return {
    scope: "L2",
    from: raw.from,
    to: raw.to,
    generatedAt: raw.generatedAt,
    counts: {
      webhookEventsInRange: count(k.webhookEventsInRange),
      paidGatewayTransactionsInRange: count(k.paidGatewayTransactionsInRange),
      webhookUnprocessed: count(k.webhookUnprocessed),
      webhookOrphan: count(k.webhookOrphan),
      gatewaySuccessNotPaid: count(k.gatewaySuccessNotPaid),
      reportedAmountMismatch: count(k.reportedAmountMismatch),
      paidWithoutGatewayEvent: count(k.paidWithoutGatewayEvent),
      coveredByGatewayDiscrepancies: count(k.coveredByGatewayDiscrepancies),
    },
    categories,
    ignored,
  };
}

// ─────────────────────────────────────────────────────────────── display ──
export function categoryTitle(c: Pick<GatewayCategory, "code" | "label">): string {
  return isKnownCategory(c.code) ? CATEGORY_TEXT[c.code].title : c.label || "Nhóm đối chiếu khác";
}
export function categoryRule(code: string): string | null {
  return isKnownCategory(code) ? CATEGORY_TEXT[code].rule : null;
}

/** The true number of rows of a category (the list is capped at 100): the server count when it is known, else what is listed. */
export function categoryTotal(c: GatewayCategory, counts: GatewayCounts): number {
  const total = isKnownCategory(c.code) ? counts[CATEGORY_TEXT[c.code].countKey] : c.items.length;
  return Math.max(total, c.items.length);
}

/** True when nothing at all was found: every category empty AND every count zero (a capped list always has a count above 0). */
export function isReportClean(report: GatewayReport): boolean {
  return report.categories.every((c) => categoryTotal(c, report.counts) === 0);
}

/** Cards in the order of urgency: danger first, then warning, then info; each keeps the server order. Empty categories stay (they are checks that passed). */
export function orderedCategories(report: GatewayReport): GatewayCategory[] {
  const rank: Record<GatewaySeverity, number> = { danger: 0, warning: 1, info: 2 };
  return report.categories
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank[a.c.severity] - rank[b.c.severity] || a.i - b.i)
    .map((x) => x.c);
}

/** Label of the transaction status for the table: Vietnamese with a neutral fallback; "—" when the row has no transaction. */
export const itemStatusText = (i: GatewayItem): string => (i.transactionStatus ? statusLabel(i.transactionStatus) : "—");
export const itemProviderText = (i: GatewayItem): string => providerLabel(i.provider);

/** Where "Xem giao dịch" goes — the Giao dịch screen opens its drawer from `?id=`. */
export function transactionLink(transactionId: string): string {
  return `/admin/finance/transactions?id=${encodeURIComponent(transactionId)}`;
}

// ─────────────────────────────────────────────────────── day range + URL ──
export interface DayRange {
  /** `YYYY-MM-DD`, inclusive (local day). */
  from: string;
  /** `YYYY-MM-DD`, inclusive (local day). */
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar day, else null. */
export function parseDay(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!DAY_RE.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? v : null;
}

export function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayDate(day: string, plusDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays);
}

/** Default range: the last 30 local days ending today (inclusive). */
export function defaultRange(now: Date): DayRange {
  return { from: toDay(dayDate(toDay(now), -(DEFAULT_RANGE_DAYS - 1))), to: toDay(now) };
}

/** Whole days covered (both ends inclusive). */
export function rangeDays(r: DayRange): number {
  return Math.round((dayDate(r.to, 1).getTime() - dayDate(r.from).getTime()) / DAY_MS);
}

export type RangeProblem = "ORDER" | "TOO_LONG" | null;
export function rangeProblem(r: DayRange): RangeProblem {
  if (r.to < r.from) return "ORDER";
  return rangeDays(r) > MAX_RANGE_DAYS ? "TOO_LONG" : null;
}
export const RANGE_PROBLEM_TEXT: Record<Exclude<RangeProblem, null>, string> = {
  ORDER: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
  TOO_LONG: `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày.`,
};

/**
 * `?from&to` → the range to show. A missing / invalid / half-given pair falls back to the default for the missing side only:
 * a hostile or stale link opens the default 30 days, never an error page. `explicit` says whether the URL carries a custom range.
 */
export function parseRange(sp: URLSearchParams, now: Date): DayRange & { explicit: boolean } {
  const def = defaultRange(now);
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));
  if (!from && !to) return { ...def, explicit: false };
  return { from: from ?? toDay(dayDate(to as string, -(DEFAULT_RANGE_DAYS - 1))), to: to ?? def.to, explicit: true };
}

/** Next query string for a range change: keeps every other param; a range equal to the default is not written. */
export function withRange(prev: URLSearchParams, range: DayRange | null, now: Date): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.delete("from");
  next.delete("to");
  if (range) {
    const def = defaultRange(now);
    if (range.from !== def.from || range.to !== def.to) {
      next.set("from", range.from);
      next.set("to", range.to);
    }
  }
  return next;
}

/** Day range → the documented query: `from` inclusive (local midnight), `to` exclusive (local midnight of the day after). */
export function toGatewayQuery(range: DayRange): { from: string; to: string } {
  return { from: dayDate(range.from).toISOString(), to: dayDate(range.to, 1).toISOString() };
}
