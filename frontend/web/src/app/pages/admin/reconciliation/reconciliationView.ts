/**
 * B4 — pure part of "Tài chính › Đối soát" (runs under `npx tsx --test`, no React).
 *
 *  - which chip is open (`?view=balance|exceptions`, default balance; old values still land somewhere sensible);
 *  - the registry of the 22 original exception groups (P13 / U2) + 1 added in D1 (obligations-paid-via-ledger) + the one L2 group (P2 gateway discrepancies):
 *    id, source, level, tone, and how each group's COUNT and `truncated` flag are read from the two reports;
 *  - the P2 normaliser (money read through B3's bigint parser, never `Number()`);
 *  - the level labels (L1 internal ledger invariant / L2 callbacks the system stored / L3 independent PSP report = BLOCKED).
 *
 * Exceptions are COUNTED — nothing here adds money across groups.
 */
import {
  centsToDong,
  formatDong,
  formatMoneyExact,
  formatMoneyString,
  formatVnDateTime,
  parseCents,
  type ReconciliationReport,
} from "../adminFinanceOverview.utils";
import { countAttention, type ObligationsReport, type SessionsReconciliationReport } from "../adminReconciliation.utils";

// ───────────────────────────────────────────────────────────────── chip (URL) ──
/**
 * `balance` / `exceptions` are the B4 chips. D7 adds the two money-exception views of Dispute V2.1 INSIDE the same surface (no new route):
 * `held-no-show` = "Khoản giữ của buổi PT vắng" (D65-B) and `late-open` = "Khoản bồi thường đến muộn còn mở".
 * B8 adds `gateway` = "Đối chiếu cổng ↔ Gymini" at level L2 (what the gateways sent back and Gymini stored; NOT an independent L3 report).
 */
export type ReconView = "balance" | "exceptions" | "gateway" | "held-no-show" | "late-open";
export const RECON_VIEWS: readonly ReconView[] = ["balance", "exceptions", "gateway", "held-no-show", "late-open"];
export const RECON_VIEW_LABEL: Record<ReconView, string> = {
  balance: "Cân đối sổ",
  exceptions: "Ngoại lệ",
  gateway: "Đối chiếu cổng ↔ Gymini",
  "held-no-show": "Khoản giữ buổi PT vắng",
  "late-open": "Bồi thường đến muộn",
};
/** L1 chips: figures come from Gymini's own ledger / contracts. The gateway chip is L2: gateway callbacks Gymini stored (B8). */
export const RECON_VIEW_LEVEL: Record<ReconView, string> = { balance: "L1", exceptions: "L1", gateway: "L2", "held-no-show": "L1", "late-open": "L1" };

/**
 * `?view=` → chip. Missing or unknown → balance. Two values are kept working from the earlier plan / prototype:
 * `ledger` = the balance chip. (`gateway` used to fall back to balance while the L3 chip was disabled; since B8 it is the L2 gateway chip.)
 */
export function parseReconView(raw: string | null | undefined): ReconView {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "exceptions" || v === "gateway" || v === "held-no-show" || v === "late-open") return v;
  return "balance"; // "balance", "ledger", "", anything else
}

/** Next query string for a chip click: keeps every other param, sets `view`. */
export function withReconView(prev: URLSearchParams, view: ReconView): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("view", view);
  return next;
}

/** The ids the D7 views keep in the URL (`row` = late-open row, `session` = D65-B preview, `resolution` = a D65-B proposal, `status` = late-open filter). */
export const MONEY_VIEW_PARAMS = ["row", "session", "resolution", "status"] as const;

/** The day range of the gateway view (B8): `?from&to`, both `YYYY-MM-DD`. */
export const GATEWAY_VIEW_PARAMS = ["from", "to"] as const;

/** A chip click: like `withReconView` but a selection of the previous view never leaks into the next one. */
export function switchReconView(prev: URLSearchParams, view: ReconView): URLSearchParams {
  const next = withReconView(prev, view);
  for (const k of MONEY_VIEW_PARAMS) next.delete(k);
  for (const k of GATEWAY_VIEW_PARAMS) next.delete(k);
  return next;
}

// ─────────────────────────────────────────────────────────────── mức đối soát ──
export type ReconLevel = "L1" | "L2" | "L3";
export const LEVEL_TEXT: Record<ReconLevel, string> = {
  L1: "L1 · số nội bộ",
  L2: "L2 · callback cổng đã lưu",
  L3: "L3 · báo cáo độc lập của cổng/ngân hàng",
};
export const LEVEL_EXPLAIN: Record<ReconLevel, string> = {
  L1: "Lấy từ sổ cái và hợp đồng do chính Gymini ghi — không đối chiếu với bên ngoài.",
  L2: "Do cổng thanh toán gọi về và hệ thống tự lưu — chưa phải xác minh độc lập.",
  L3: "Báo cáo quyết toán độc lập từ cổng thanh toán / ngân hàng — chưa có nguồn nên chưa làm được (BLOCKED).",
};
export const GATEWAY_CHIP_LABEL = "Đối chiếu cổng ↔ Gymini";
/** What is still missing behind the L2 gateway chip: an independent settlement report (shown as a note inside the gateway view). */
export const GATEWAY_CHIP_REASON = "L3 có cho VNPay; ZaloPay chưa có nguồn quyết toán độc lập (MoMo, PayOS đã ngừng dùng)";
export const NO_PROCEDURE_TEXT = "chưa có quy trình (G-15)";

// ───────────────────────────────────────────────────── 22 nhóm ngoại lệ + P2 ──
export type ExceptionSource = "P13" | "U2" | "P2";
export type ExceptionTone = "critical" | "watch" | "neutral";

export interface ExceptionGroupDef {
  id: string;
  testId: string;
  section: string;
  source: ExceptionSource;
  level: ReconLevel;
  /** Default tone; one group (refund-outcomes) can be raised to `watch` at runtime. */
  tone: ExceptionTone;
  title: string;
}

const P13 = (id: string, section: string, tone: ExceptionTone, title: string): ExceptionGroupDef => ({
  id,
  testId: `recon-${id}`,
  section,
  source: "P13",
  level: "L1",
  tone,
  title,
});
const U2 = (id: string, tone: ExceptionTone, title: string): ExceptionGroupDef => ({
  id,
  testId: `recon-${id}`,
  section: SECTION_SESSIONS,
  source: "U2",
  level: "L1",
  tone,
  title,
});

export const SECTION_LEDGER = "Sổ cái tiền";
export const SECTION_PARTNER = "Khoản đối tác còn nợ và nghĩa vụ chưa trả";
export const SECTION_OPEN_OBLIGATIONS = "Nghĩa vụ chưa thanh toán — mỗi trạng thái một nhóm";
export const SECTION_CLOSED_OBLIGATIONS = "Nghĩa vụ đã đóng — mỗi kết quả một nhóm";
export const SECTION_PAYMENTS = "Thanh toán chưa hoàn tất";
export const SECTION_SESSIONS = "Tất toán hợp đồng và buổi tập";
export const SECTION_GATEWAY = "Cổng báo số tiền khác số Gymini";

/** The 22 groups the page had before the redesign — NONE may be dropped (B4 test T1 counts them) — plus "Đã trả vào ví Gymini" (D1: those rows used to vanish from the page while still being counted). */
export const EXCEPTION_GROUPS: readonly ExceptionGroupDef[] = [
  P13("negative-subledgers", SECTION_LEDGER, "critical", "Tiền chờ của hợp đồng bị rút quá mức"),
  P13("negative-wallets", SECTION_LEDGER, "critical", "Ví có số dư âm"),
  P13("wallet-mismatch", SECTION_LEDGER, "critical", "Ví lệch so với sổ cái"),
  P13("pt-holdback", SECTION_LEDGER, "neutral", "Tiền tạm giữ của PT theo hợp đồng"),
  P13("receivables", SECTION_PARTNER, "watch", "Khoản phải thu từ đối tác"),
  P13("obligations-open", SECTION_OPEN_OBLIGATIONS, "watch", "Đang mở"),
  P13("obligations-under-review", SECTION_OPEN_OBLIGATIONS, "watch", "Đang xem xét"),
  P13("obligations-approved", SECTION_OPEN_OBLIGATIONS, "watch", "Đã phê duyệt chi"),
  P13("obligations-awaiting", SECTION_OPEN_OBLIGATIONS, "watch", "Đang chờ chứng từ"),
  P13("obligations-paid-verified", SECTION_CLOSED_OBLIGATIONS, "neutral", "Đã thanh toán được xác minh"),
  P13("obligations-paid-via-ledger", SECTION_CLOSED_OBLIGATIONS, "neutral", "Đã trả vào ví Gymini"),
  P13("obligations-unverified", SECTION_CLOSED_OBLIGATIONS, "watch", "Đã ghi nhận chứng từ — CHƯA xác minh (bản ghi cũ)"),
  P13("obligations-waived", SECTION_CLOSED_OBLIGATIONS, "neutral", "Không truy đòi"),
  P13("obligations-resolved-other", SECTION_CLOSED_OBLIGATIONS, "neutral", "Đã giải quyết bằng phương thức khác"),
  P13("obligations-legacy", SECTION_CLOSED_OBLIGATIONS, "neutral", "Bản ghi cũ (đã xử lý)"),
  P13("paid-not-activated", SECTION_PAYMENTS, "critical", "Đã thanh toán nhưng chưa kích hoạt"),
  P13("cancelled-paid", SECTION_PAYMENTS, "critical", "Gói/đơn đã hủy nhưng khách đã trả"),
  P13("refund-outcomes", SECTION_PAYMENTS, "neutral", "Hoàn tiền của gói/đơn đã hủy"),
  P13("target-unverified", SECTION_PAYMENTS, "neutral", "Chưa xác minh trạng thái"),
  U2("needs-attention", "critical", "Tất toán cần người xử lý"),
  U2("endings-unconfirmed", "watch", "Kết thúc hợp đồng chưa được xác nhận"),
  U2("ended-unsettled", "critical", "Hợp đồng đã kết thúc nhưng chưa tất toán"),
  U2("disputes", "watch", "Tranh chấp buổi tập đang chờ"),
];

/** P2 — the only L2 group. Kept OUT of the 22 so that "22 existing groups" stays a countable invariant. */
export const GATEWAY_GROUP: ExceptionGroupDef = {
  id: "gateway-discrepancies",
  testId: "recon-gateway-discrepancies",
  section: SECTION_GATEWAY,
  source: "P2",
  level: "L2",
  tone: "critical",
  title: "Cổng báo số tiền khác số Gymini",
};

export const ALL_GROUP_DEFS: readonly ExceptionGroupDef[] = [...EXCEPTION_GROUPS, GATEWAY_GROUP];
export const GROUP_BY_TEST_ID: Readonly<Record<string, ExceptionGroupDef>> = Object.fromEntries(ALL_GROUP_DEFS.map((g) => [g.testId, g]));

export type ExceptionGroupId = (typeof EXCEPTION_GROUPS)[number]["id"];
export interface GroupStat {
  count: number;
  truncated: boolean;
}

/**
 * Count + truncated flag of every group, read exactly the way the page always read them (the server's own
 * summary counts for P13 — correct even when the list is truncated — and the item lists for U2).
 * A source that has not loaded contributes no entries (the caller shows that source as "unknown", never 0).
 */
export function exceptionGroupStats(payment: ObligationsReport | null, sessions: SessionsReconciliationReport | null): Record<string, GroupStat> {
  const out: Record<string, GroupStat> = {};
  if (payment) {
    const s = payment.summary;
    const t = payment.truncated;
    const u = s.unpaidObligations;
    out["negative-subledgers"] = { count: s.negativeSubledgers.count, truncated: t.negativeSubledgers };
    out["negative-wallets"] = { count: s.negativeWallets, truncated: t.negativeWallets };
    out["wallet-mismatch"] = { count: s.walletMismatches.nonEscrowCount, truncated: t.walletMismatches };
    out["pt-holdback"] = { count: s.ptHoldback.contractsHolding, truncated: t.ptHoldbacks };
    out["receivables"] = { count: s.receivables.active.count + s.receivables.suspended.count, truncated: t.receivables };
    out["obligations-open"] = { count: u.open.count, truncated: t.unpaidObligations };
    out["obligations-under-review"] = { count: u.underReview.count, truncated: t.unpaidObligations };
    out["obligations-approved"] = { count: u.approvedForPayment.count, truncated: t.inFlightObligations };
    out["obligations-awaiting"] = { count: u.awaitingEvidence.count, truncated: t.inFlightObligations };
    out["obligations-paid-verified"] = { count: u.paidVerified.count, truncated: t.closedObligations };
    out["obligations-paid-via-ledger"] = { count: u.paidViaLedger.count, truncated: t.closedObligations };
    out["obligations-unverified"] = { count: u.paidExternally.count, truncated: t.closedObligations };
    out["obligations-waived"] = { count: u.waived.count, truncated: t.closedObligations };
    out["obligations-resolved-other"] = { count: u.resolvedOther.count, truncated: t.closedObligations };
    out["obligations-legacy"] = { count: u.resolved.count, truncated: t.closedObligations };
    out["paid-not-activated"] = { count: s.paidNotActivated, truncated: t.paidNotActivated };
    out["cancelled-paid"] = { count: s.productPayments.cancelledPaid, truncated: t.cancelledPaid };
    out["refund-outcomes"] = { count: s.productPayments.refundCompleted + s.productPayments.refundShort, truncated: t.refundOutcomes };
    out["target-unverified"] = { count: s.targetUnverified.candidates, truncated: t.targetUnverified };
  }
  if (sessions) {
    out["needs-attention"] = { count: sessions.needsAttention.items.length, truncated: sessions.needsAttention.truncated };
    out["endings-unconfirmed"] = { count: sessions.endingsUnconfirmed.items.length, truncated: sessions.endingsUnconfirmed.truncated };
    out["ended-unsettled"] = { count: sessions.endedWithoutSettledEnding.items.length, truncated: sessions.endedWithoutSettledEnding.truncated };
    out["disputes"] = { count: sessions.disputes.items.length, truncated: sessions.disputes.truncated };
  }
  return out;
}

export interface GroupsOverview {
  /** Groups whose source loaded. */
  known: number;
  /** Of those, groups with at least one item. */
  withItems: number;
  /** Groups the backend cut off (more items exist than are listed). */
  truncated: number;
  total: number;
}

export function overviewOfGroups(stats: Record<string, GroupStat>): GroupsOverview {
  let known = 0;
  let withItems = 0;
  let truncated = 0;
  for (const g of EXCEPTION_GROUPS) {
    const s = stats[g.id];
    if (!s) continue;
    known += 1;
    if (s.count > 0) withItems += 1;
    if (s.truncated && s.count > 0) truncated += 1;
  }
  return { known, withItems, truncated, total: EXCEPTION_GROUPS.length };
}

// ───────────────────────────────────────────── P2 — sai lệch số tiền cổng ──
/** payment-service `findWithGatewayDiscrepancy(200)` — the endpoint has no pagination; 200 is its fixed cap. */
export const GATEWAY_DISCREPANCY_CAP = 200;

export interface GatewayDiscrepancyRow {
  transactionId: string;
  provider: string | null;
  gatewayTransactionNo: string | null;
  /** Decimal-ish value as sent (number or string) — display only, via `formatMoneyString`. */
  expectedAmount: unknown;
  reportedAmount: unknown;
  occurrences: number;
  firstDetectedAt: string | null;
  lastSeenAt: string | null;
  source: string | null;
  kind: string | null;
  /** Always false in the current backend — nothing ever sets it. */
  resolved: boolean;
}

export interface GatewayDiscrepancyReport {
  rows: GatewayDiscrepancyRow[];
  /** Exactly the cap came back → there may be more. */
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** `{success,data:[PaymentTransaction…]}` (or the bare array) → rows. Only the fields the screen needs (no redirectUrl etc.). */
export function normalizeGatewayDiscrepancies(raw: unknown): GatewayDiscrepancyReport | null {
  const root = raw as { data?: unknown } | unknown[] | null | undefined;
  const list = Array.isArray(root) ? root : root && typeof root === "object" && Array.isArray((root as { data?: unknown }).data) ? ((root as { data: unknown[] }).data) : null;
  if (!list) return null;
  const rows: GatewayDiscrepancyRow[] = [];
  for (const item of list) {
    const tx = item as { id?: unknown; provider?: unknown; metadata?: { gatewayDiscrepancy?: Record<string, unknown> } | null } | null;
    const d = tx?.metadata?.gatewayDiscrepancy;
    if (!tx || !d || typeof d !== "object") continue;
    rows.push({
      transactionId: typeof tx.id === "string" ? tx.id : "",
      provider: str(d.provider) ?? str(tx.provider),
      gatewayTransactionNo: str(d.gatewayTransactionNo),
      expectedAmount: d.expectedAmountVnd,
      reportedAmount: d.reportedAmountVnd,
      occurrences: typeof d.occurrences === "number" && Number.isFinite(d.occurrences) ? d.occurrences : 1,
      firstDetectedAt: str(d.firstDetectedAt),
      lastSeenAt: str(d.lastSeenAt),
      source: str(d.source),
      kind: str(d.kind),
      resolved: d.resolved === true,
    });
  }
  return { rows, truncated: list.length >= GATEWAY_DISCREPANCY_CAP };
}

/**
 * "Cần xem ngay" across EVERYTHING the Đối soát screen lists as critical: the 22 P13/U2 groups (`countAttention`)
 * plus the P2 group "Cổng báo số tiền khác số Gymini" (tone critical, one item per row; nothing ever resolves it).
 * Used by the sidebar badge and by "Hôm nay" so the two always agree. `null` unless ALL THREE sources loaded — a
 * number built from two of three would be an undercount presented as a fact.
 */
export interface ExceptionAttention {
  critical: number;
  watch: number;
  /** Rows of the P2 group (already inside `critical`). */
  gatewayRows: number;
  /** P2 hit its fixed 200-row cap, so `critical` is a lower bound. */
  gatewayTruncated: boolean;
}
export function exceptionAttention(
  payment: ObligationsReport | null | undefined,
  sessions: SessionsReconciliationReport | null | undefined,
  gateway: GatewayDiscrepancyReport | null | undefined,
): ExceptionAttention | null {
  if (!payment || !sessions || !gateway) return null;
  const base = countAttention(payment, sessions);
  const gatewayRows = gateway.rows.length;
  return { critical: base.critical + gatewayRows, watch: base.watch, gatewayRows, gatewayTruncated: gateway.truncated };
}

export const PROVIDER_LABEL: Record<string, string> = { VNPAY: "VNPay", ZALOPAY: "ZaloPay", PAYOS: "PayOS", MOMO: "MoMo", MOCK: "Giả lập" };
export const providerLabel = (p: string | null | undefined) => (p && PROVIDER_LABEL[p.toUpperCase()]) || p || "—";
export const DISCREPANCY_SOURCE_LABEL: Record<string, string> = { IPN: "cổng gọi về (IPN)", RETURN: "trang trả về", POLL: "truy vấn lại" };
export const discrepancySourceLabel = (s: string | null | undefined) => (s && DISCREPANCY_SOURCE_LABEL[s.toUpperCase()]) || s || "—";

/** Difference reported − expected as display text ("+10.000 ₫"), or "—" if either side is unreadable. Pure bigint. */
export function discrepancyDelta(expected: unknown, reported: unknown): string {
  const e = parseCents(expected);
  const r = parseCents(reported);
  if (e === null || r === null) return "—";
  const diff = r - e;
  const text = formatDong(centsToDong(diff));
  return diff > 0n ? `+${text}` : text;
}

// ───────────────────────────────────────────────── chip "Cân đối sổ" — nguyên nhân ──
export interface DriftCauseCounts {
  negativeWallets: number | null;
  walletMismatches: number | null;
  negativeSubledgers: number | null;
}

/** Counts the obligations report already carries for the three usual causes of a drift; `null` when it has not loaded. */
export function driftCauseCounts(payment: ObligationsReport | null): DriftCauseCounts {
  if (!payment) return { negativeWallets: null, walletMismatches: null, negativeSubledgers: null };
  return {
    negativeWallets: payment.summary.negativeWallets,
    walletMismatches: payment.summary.walletMismatches.nonEscrowCount,
    negativeSubledgers: payment.summary.negativeSubledgers.count,
  };
}

export interface NegativeWalletView {
  key: string;
  ownerType: string;
  ownerId: string;
  availableText: string;
  pendingText: string;
}

/** `negativeWallets` of P3 is typed `unknown[]` — read each row defensively; money via the bigint parser. */
export function negativeWalletViews(r: ReconciliationReport): NegativeWalletView[] {
  return r.negativeWallets.map((w, i) => {
    const o = (w ?? {}) as Record<string, unknown>;
    return {
      key: typeof o.id === "string" ? o.id : String(i),
      ownerType: typeof o.ownerType === "string" ? o.ownerType : "",
      ownerId: typeof o.ownerId === "string" ? o.ownerId : "",
      availableText: formatMoneyString(o.available),
      pendingText: formatMoneyString(o.pending),
    };
  });
}

// ───────────────────────────────────────────────────────── G-06 — lịch sử đối soát ──
/**
 * G-06. P3 (`GET /admin/payments/reconciliation`) keeps its contract: 200 when balanced, 409 `{ success:false, data }` when not
 * (read via `reconciliationFromHttpError`). It writes nothing; the history is written by `POST .../reconciliation/runs` only.
 */

/** What the "Chạy đối soát và lưu" button says when the POST fails. 429 = this admin ran it a moment ago; anything else = nothing was saved. */
export function runReconciliationErrorText(error: unknown): string {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
  if (status === 429) return "Vừa chạy xong, thử lại sau ít giây.";
  if (status === 401 || status === 403) return "Tài khoản này không có quyền chạy đối soát hoặc phiên đăng nhập đã hết hạn.";
  if (status === 500) return "Máy chủ không chạy được đối soát. Chưa có kết quả nào được lưu.";
  return "Không chạy được đối soát lúc này. Chưa có kết quả nào được lưu.";
}

export type RunStatus = "BALANCED" | "DRIFT" | "ERROR";
export type RunTrigger = "ADMIN" | "JOB";
export type RunTone = "success" | "danger" | "warning";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = { BALANCED: "Cân bằng", DRIFT: "Lệch sổ", ERROR: "Lỗi khi đối soát" };
export const RUN_STATUS_TONE: Record<RunStatus, RunTone> = { BALANCED: "success", DRIFT: "danger", ERROR: "warning" };
export const RUN_TRIGGER_LABEL: Record<RunTrigger, string> = { ADMIN: "Quản trị viên", JOB: "Hệ thống tự chạy" };

export const runStatusLabel = (s: string | null | undefined) => (s && RUN_STATUS_LABEL[s as RunStatus]) || "Không rõ";
export const runStatusTone = (s: string | null | undefined): RunTone => (s && RUN_STATUS_TONE[s as RunStatus]) || "warning";
export const runTriggerLabel = (t: string | null | undefined) => (t && RUN_TRIGGER_LABEL[t as RunTrigger]) || "Không rõ";

export interface ReconciliationRunRow {
  id: string;
  startedAt: string;
  status: string;
  trigger: string;
  /** Raw decimal string as stored, or null (an ERROR run has no figures). */
  drift: string | null;
  escrowBalance: string | null;
  claimsTotal: string | null;
  errorCode: string | null;
}

export interface ReconciliationRunsPage {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: ReconciliationRunRow[];
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** `GET /admin/payments/reconciliation/runs`. A body that is not that shape → `null` (the caller shows a load error, not an empty history). */
export function normalizeReconciliationRuns(raw: unknown): ReconciliationRunsPage | null {
  const o = raw as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object" || !Array.isArray(o.items)) return null;
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const total = int(o.total);
  const limit = int(o.limit);
  const offset = int(o.offset);
  if (total === null || limit === null || offset === null) return null;
  const items: ReconciliationRunRow[] = [];
  for (const r of o.items) {
    const row = r as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || typeof row.startedAt !== "string") return null;
    items.push({
      id: row.id,
      startedAt: row.startedAt,
      status: typeof row.status === "string" ? row.status : "",
      trigger: typeof row.trigger === "string" ? row.trigger : "",
      drift: strOrNull(row.drift),
      escrowBalance: strOrNull(row.escrowBalance),
      claimsTotal: strOrNull(row.claimsTotal),
      errorCode: strOrNull(row.errorCode),
    });
  }
  return { total, limit, offset, hasMore: o.hasMore === true, items };
}

/** The drift of one run: the exact stored amount; "—" when the run has none (never "0 ₫" for an ERROR run). */
export const runDriftText = (r: Pick<ReconciliationRunRow, "drift" | "status">): string => (r.status === "ERROR" ? "—" : formatMoneyExact(r.drift));

export const runTimeText = (r: Pick<ReconciliationRunRow, "startedAt">): string => formatVnDateTime(r.startedAt);
