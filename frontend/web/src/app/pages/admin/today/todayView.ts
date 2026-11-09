/**
 * B3b — pure view-model of "Hôm nay": turns the loaded sources into the rows / tiles / recent items the page draws.
 * No React, no I/O (only `import type` from components). Rule that runs through every builder: a source that is loading or
 * failed produces NO number — the tile/row says "—" and why; the others still render.
 */
import type { AttentionItem } from "../shared/AttentionList";
import type { RecentQueueItem } from "../shared/RecentQueueList";
import { ageText, balanceVerdict, formatDong, formatDriftCents, formatVnDateTime, type ReconciliationReport } from "../adminFinanceOverview.utils";
import type { ExceptionAttention } from "../reconciliation/reconciliationView";
import {
  ROUTES,
  agoText,
  countLabel,
  joinDetail,
  moneyActionCount,
  oldestText,
  sortRecent,
  type MonitorFacts,
  type QueueFacts,
  type RecentFact,
  type Src,
  type UsersFacts,
  type WithdrawalFacts,
} from "./todayModel";

export interface TodaySources {
  withdrawals: Src<WithdrawalFacts>;
  serviceRefunds: Src<QueueFacts>;
  disputes: Src<QueueFacts>;
  ptApplications: Src<QueueFacts>;
  partnerApplications: Src<QueueFacts>;
  gyms: Src<QueueFacts>;
  proposals: Src<QueueFacts>;
  exceptions: Src<ExceptionAttention>;
  balance: Src<{ report: ReconciliationReport; conflict: boolean }>;
  users: Src<UsersFacts>;
  monitor: Src<MonitorFacts>;
}

const errText = (s: Src<unknown>): string | undefined => (s.status === "error" ? s.message : undefined);

// ───────────────────────────────────────────────────── "Việc cần xử lý" ──
function queueRow(key: string, title: string, to: string, src: Src<QueueFacts>, emptyText: string, tone: AttentionItem["tone"], extra: string, nowMs: number): AttentionItem {
  if (src.status !== "ready") return { key, title, to, status: src.status, tone, errorText: errText(src) };
  const q = src.data;
  return {
    key,
    title,
    to,
    status: "ready",
    count: q.count,
    countText: countLabel(q.count, q.capped),
    detail: q.count === 0 ? emptyText : joinDetail(oldestText(q.oldestMs, nowMs), extra, q.capped && "có thể còn nữa"),
    tone,
  };
}

/** Money rows first, then disputes, then the review queues (Master Plan §2.1). */
export function buildAttentionItems(s: TodaySources, nowMs: number): AttentionItem[] {
  const wq = s.withdrawals.status === "ready" ? s.withdrawals.data.queues : null;
  const wdRow = (key: string, title: string, to: string, pick: "approved" | "pending", empty: string, tone: AttentionItem["tone"]): AttentionItem => {
    if (!wq) return { key, title, to, status: s.withdrawals.status === "error" ? "error" : "loading", tone, errorText: errText(s.withdrawals) };
    const q = wq[pick];
    const cap = wq.capped ? " · trong 100 yêu cầu cũ nhất, có thể còn nữa" : "";
    return {
      key,
      title,
      to,
      status: "ready",
      count: q.count,
      countText: wq.capped ? `≥${q.count}` : String(q.count),
      detail: q.count === 0 ? empty : `${q.oldestMinutes === null ? "" : `Cũ nhất ${ageText(q.oldestMinutes)} · `}Tổng ${formatDong(q.totalDong)}${cap}`,
      tone,
    };
  };

  const ex = s.exceptions;
  const exRow: AttentionItem =
    ex.status !== "ready"
      ? { key: "exceptions", title: "Ngoại lệ đối soát cần xem", to: ROUTES.reconciliation, status: ex.status, tone: "danger", errorText: errText(ex) }
      : {
          key: "exceptions",
          title: "Ngoại lệ đối soát cần xem",
          to: ROUTES.reconciliation,
          status: "ready",
          count: ex.data.critical,
          countText: countLabel(ex.data.critical, ex.data.gatewayTruncated),
          detail:
            ex.data.critical === 0
              ? `Không có mục nào cần xem ngay${ex.data.watch ? ` · ${ex.data.watch} mục theo dõi` : ""}`
              : joinDetail(ex.data.gatewayRows ? `${ex.data.gatewayRows} cổng báo số khác số Gymini` : null, ex.data.watch ? `${ex.data.watch} mục theo dõi thêm` : null, "chỉ đếm, không cộng tiền"),
          tone: "danger",
        };

  return [
    wdRow("withdrawals-approved", "Đã duyệt, chờ chuyển khoản", ROUTES.withdrawalsApproved, "approved", "Không có yêu cầu nào đang chờ chuyển khoản", "danger"),
    exRow,
    queueRow("disputes", "Tranh chấp buổi tập", ROUTES.disputes, s.disputes, "Không có tranh chấp nào đang chờ phán quyết", "warning", "", nowMs),
    queueRow("service-refunds", "Yêu cầu hoàn tiền dịch vụ", ROUTES.refunds, s.serviceRefunds, "Không có yêu cầu hoàn tiền nào đang chờ", "warning", "Số tiền hoàn xem trong từng yêu cầu", nowMs),
    wdRow("withdrawals-pending", "Rút tiền chờ duyệt", ROUTES.withdrawalsPending, "pending", "Không có yêu cầu rút tiền nào chờ duyệt", "warning"),
    queueRow("pt-applications", "Hồ sơ PT chờ duyệt", ROUTES.pts, s.ptApplications, "Không có hồ sơ PT nào chờ duyệt", "neutral", "", nowMs),
    queueRow("partner-applications", "Hồ sơ đối tác chờ duyệt", ROUTES.partners, s.partnerApplications, "Không có hồ sơ đối tác nào chờ duyệt", "neutral", "", nowMs),
    queueRow("gyms", "Chi nhánh chờ duyệt", ROUTES.gyms, s.gyms, "Không có chi nhánh nào chờ duyệt", "neutral", "", nowMs),
    queueRow("proposals", "Đề xuất tiện ích chờ duyệt", ROUTES.listings, s.proposals, "Không có đề xuất tiện ích nào chờ duyệt", "neutral", "", nowMs),
  ];
}

// ───────────────────────────────────────────────────────────────── tiles ──
export interface TileView {
  status: "loading" | "error" | "ready";
  value: string | null;
  note?: string;
  errorText?: string;
}

const failedNames = (parts: Array<[string, Src<unknown>]>): string[] => parts.filter(([, s]) => s.status === "error").map(([n]) => n);

/** Tile 1 — "Cần xử lý về tiền": approved withdrawals + critical exceptions + service refunds. COUNTS added; only approved-withdrawal money is summed. */
export function moneyActionTile(s: TodaySources): TileView {
  const parts: Array<[string, Src<unknown>]> = [
    ["rút tiền", s.withdrawals],
    ["ngoại lệ đối soát", s.exceptions],
    ["hoàn tiền dịch vụ", s.serviceRefunds],
  ];
  const bad = failedNames(parts);
  if (bad.length) return { status: "error", value: null, errorText: `Chưa đọc được: ${bad.join(", ")}. Chưa biết số liệu; đây không phải số bằng không.` };
  if (s.withdrawals.status !== "ready" || s.exceptions.status !== "ready" || s.serviceRefunds.status !== "ready") return { status: "loading", value: null };
  const w = s.withdrawals.data.queues;
  const total = moneyActionCount({
    approved: w.approved.count,
    approvedCapped: w.capped,
    exceptions: s.exceptions.data.critical,
    exceptionsCapped: s.exceptions.data.gatewayTruncated,
    refunds: s.serviceRefunds.data.count,
  });
  return {
    status: "ready",
    value: `${countLabel(total.count, total.capped)} mục`,
    note: `Chờ chuyển khoản ${formatDong(w.approved.totalDong)}. ${s.exceptions.data.critical} ngoại lệ đối soát và ${s.serviceRefunds.data.count} hoàn tiền dịch vụ chỉ đếm, không cộng tiền.`,
  };
}

/** Tile 2 — "Rút tiền chờ duyệt". */
export function pendingWithdrawalTile(s: TodaySources): TileView {
  if (s.withdrawals.status !== "ready") return s.withdrawals.status === "error" ? { status: "error", value: null, errorText: s.withdrawals.message } : { status: "loading", value: null };
  const w = s.withdrawals.data.queues;
  return {
    status: "ready",
    value: `${w.capped ? `≥${w.pending.count}` : w.pending.count} yêu cầu`,
    note: `${w.pending.count === 0 ? "Không có yêu cầu nào chờ duyệt. " : `Tổng ${formatDong(w.pending.totalDong)}${w.capped ? " (trong 100 yêu cầu cũ nhất)" : ""}. `}Đã duyệt chưa phải đã chuyển.`,
  };
}

/** Tile 3 — "Hồ sơ chờ duyệt": PT + partner + branch + amenity proposals. If ANY source failed the total is unknown ("—"). */
export function reviewTile(s: TodaySources): TileView {
  const parts: Array<[string, string, Src<QueueFacts>]> = [
    ["PT", "PT", s.ptApplications],
    ["đối tác", "đối tác", s.partnerApplications],
    ["chi nhánh", "chi nhánh", s.gyms],
    ["đề xuất tiện ích", "tiện ích", s.proposals],
  ];
  const known = parts.map(([, short, src]) => `${short} ${src.status === "ready" ? countLabel(src.data.count, src.data.capped) : "—"}`).join(" · ");
  const bad = parts.filter(([, , src]) => src.status === "error").map(([name]) => name);
  if (bad.length) return { status: "error", value: null, errorText: `Chưa đọc được: ${bad.join(", ")}. Chưa biết tổng; đây không phải số bằng không. Đã đọc: ${known}.` };
  if (parts.some(([, , src]) => src.status === "loading")) return { status: "loading", value: null };
  let sum = 0;
  let capped = false;
  for (const [, , src] of parts) {
    if (src.status !== "ready") continue;
    sum += src.data.count;
    capped = capped || src.data.capped;
  }
  return { status: "ready", value: `${countLabel(sum, capped)} hồ sơ`, note: known };
}

export interface BalanceTileView {
  status: "loading" | "error" | "ready";
  value: string | null;
  balanced: boolean | null;
  /** Drift wording: who holds more. */
  direction: string | null;
  conflict: boolean;
  errorText?: string;
}

/** Tile 4 — ledger balance: ESCROW = Σ quyền đòi. The 409 answer carries the report and IS "có lệch", not a load error. */
export function balanceTile(s: TodaySources): BalanceTileView {
  const b = s.balance;
  if (b.status === "error") return { status: "error", value: null, balanced: null, direction: null, conflict: false, errorText: b.message };
  if (b.status === "loading") return { status: "loading", value: null, balanced: null, direction: null, conflict: false };
  const v = balanceVerdict(b.data.report);
  const abs = v.driftCents < 0n ? -v.driftCents : v.driftCents;
  return {
    status: "ready",
    value: v.balanced ? "Cân bằng" : `Lệch ${formatDriftCents(abs)}`,
    balanced: v.balanced,
    direction: v.balanced ? null : v.driftCents > 0n ? "ví giữ hộ nhiều hơn tổng quyền đòi" : "ví giữ hộ ít hơn tổng quyền đòi",
    conflict: b.data.conflict,
  };
}

export const BALANCE_SCOPE_TEXT = "Chỉ so số dư các ví với ví giữ hộ — không phải kết luận về sức khoẻ toàn hệ thống (không kiểm cổng thanh toán, quyết toán hay nghĩa vụ treo).";

// ───────────────────────────────────────────────────────── compact stats ──
export interface CompactView {
  status: "loading" | "error" | "ready";
  value: string | null;
  errorText?: string;
}

const fmtInt = (n: number) => n.toLocaleString("vi-VN");

export function usersTotalStat(s: TodaySources): CompactView {
  if (s.users.status !== "ready") return s.users.status === "error" ? { status: "error", value: null, errorText: s.users.message } : { status: "loading", value: null };
  return { status: "ready", value: fmtInt(s.users.data.total) };
}

export function usersNewStat(s: TodaySources): CompactView {
  if (s.users.status !== "ready") return s.users.status === "error" ? { status: "error", value: null, errorText: s.users.message } : { status: "loading", value: null };
  const n = s.users.data.newLast7d;
  return n === null ? { status: "error", value: null, errorText: "Có tài khoản không đọc được ngày tạo — chưa biết số mới." } : { status: "ready", value: fmtInt(n) };
}

export function servicesStat(s: TodaySources): CompactView {
  if (s.monitor.status !== "ready") return s.monitor.status === "error" ? { status: "error", value: null, errorText: s.monitor.message } : { status: "loading", value: null };
  return { status: "ready", value: `${s.monitor.data.healthy}/${s.monitor.data.total}` };
}

export function disputesStat(s: TodaySources): CompactView {
  if (s.disputes.status !== "ready") return s.disputes.status === "error" ? { status: "error", value: null, errorText: s.disputes.message } : { status: "loading", value: null };
  return { status: "ready", value: fmtInt(s.disputes.data.count) };
}

// ───────────────────────────────────────────────── "Mục mới tạo gần nhất" ──
export const RECENT_TITLE = "Mục mới tạo gần nhất trong các hàng đợi";
export const RECENT_SOURCE_NOTE =
  "Nguồn: mục mới nhất của từng hàng đợi theo thời điểm mục vào hàng đợi (createdAt; tranh chấp, hoàn tiền và hồ sơ PT dùng ngày khiếu nại / yêu cầu / nộp), đọc từ tập kết quả có giới hạn của mỗi hàng đợi — không phải mọi sự kiện gần đây, chưa có nhật ký hoạt động (G-23).";

export interface RecentView {
  items: RecentQueueItem[];
  failed: string[];
  loading: number;
  allEmpty: boolean;
}

export function buildRecent(s: TodaySources, nowMs: number): RecentView {
  const queues: Array<[string, Src<{ newest: RecentFact | null; total: number }>]> = [
    ["rút tiền", mapSrc(s.withdrawals, (d) => ({ newest: d.newest, total: d.queues.pending.count + d.queues.approved.count }))],
    ["hoàn tiền dịch vụ", mapSrc(s.serviceRefunds, (d) => ({ newest: d.newest, total: d.count }))],
    ["tranh chấp buổi tập", mapSrc(s.disputes, (d) => ({ newest: d.newest, total: d.count }))],
    ["hồ sơ PT", mapSrc(s.ptApplications, (d) => ({ newest: d.newest, total: d.count }))],
    ["hồ sơ đối tác", mapSrc(s.partnerApplications, (d) => ({ newest: d.newest, total: d.count }))],
    ["chi nhánh", mapSrc(s.gyms, (d) => ({ newest: d.newest, total: d.count }))],
    ["đề xuất tiện ích", mapSrc(s.proposals, (d) => ({ newest: d.newest, total: d.count }))],
  ];
  const facts = sortRecent(queues.map(([, q]) => (q.status === "ready" ? q.data.newest : null)));
  return {
    items: facts.map((f) => ({
      key: f.queue,
      kind: f.kind,
      title: f.title,
      caption: f.caption,
      at: f.at,
      agoText: agoText(f.at, nowMs),
      absoluteText: formatVnDateTime(f.at),
      to: f.to,
    })),
    failed: queues.filter(([, q]) => q.status === "error").map(([name]) => name),
    loading: queues.filter(([, q]) => q.status === "loading").length,
    allEmpty: queues.every(([, q]) => q.status === "ready" && q.data.total === 0),
  };
}

function mapSrc<T, U>(src: Src<T>, f: (d: T) => U): Src<U> {
  return src.status === "ready" ? { status: "ready", data: f(src.data) } : src;
}
