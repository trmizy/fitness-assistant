/**
 * B3b — pure model of "Hôm nay" (`/admin/dashboard`). No React, no I/O: runs under `npx tsx --test`.
 *
 * Every function here reads ONE source exactly the way the page that owns that queue already reads it, and answers
 * `null` when the body is not the expected shape (= "unreadable", shown as "—", NEVER as 0). The field table that maps
 * every number back to Master Plan §3 and to backend file:line is in docs/admin-redesign/review/b3b/CHECKS.md.
 */
import { ageMinutes, ageText, centsToDong, formatDong, parseCents, summarizeWithdrawals, type WithdrawalQueues } from "../adminFinanceOverview.utils";
import { disputeTypeLabel } from "../adminReconciliation.utils";
import { normalizeServiceRefunds } from "../refunds/refundQueue";

/** One source of the page: still loading, failed (with a one-sentence reason), or read OK. Never "0 because unknown". */
export type Src<T> = { status: "loading" } | { status: "error"; message: string; forbidden: boolean } | { status: "ready"; data: T };

// ─────────────────────────────────────────────────────────── shared bits ──
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** ms of an ISO time, or null when missing/unreadable. */
export function msOf(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** The earliest / latest readable time among candidates (each candidate = first readable of its own fallbacks). */
function bounds(times: Array<number | null>): { oldest: number | null; newest: number | null } {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const t of times) {
    if (t === null) continue;
    if (oldest === null || t < oldest) oldest = t;
    if (newest === null || t > newest) newest = t;
  }
  return { oldest, newest };
}

export type QueueKey = "withdrawals" | "serviceRefunds" | "disputes" | "ptApplications" | "partnerApplications" | "gyms" | "proposals";

/** The one newest item of a queue, as the "Mục mới tạo gần nhất" panel shows it. */
export interface RecentFact {
  queue: QueueKey;
  /** Short pill: "Rút tiền", "Chi nhánh"… */
  kind: string;
  title: string;
  caption: string;
  at: number;
  to: string;
}

/** What one queue contributes: an exact count, how old the oldest waiting item is, and its newest item. */
export interface QueueFacts {
  count: number;
  /** The source is capped and answered at the cap → `count` is a lower bound ("≥"). */
  capped: boolean;
  oldestMs: number | null;
  newest: RecentFact | null;
}

export const ROUTES = {
  withdrawalsPending: "/admin/finance/withdrawals",
  withdrawalsApproved: "/admin/finance/withdrawals?status=APPROVED",
  reconciliation: "/admin/finance/reconciliation?view=exceptions",
  balance: "/admin/finance/reconciliation",
  refunds: "/admin/finance/refunds",
  membershipRefund: "/admin/finance/refunds?type=membership",
  disputes: "/admin/disputes",
  pts: "/admin/pts",
  partners: "/admin/partners",
  gyms: "/admin/gyms",
  listings: "/admin/listings?tab=proposals",
  users: "/admin/users",
  system: "/admin/system",
} as const;

/** "35 phút trước" / "3 giờ trước" / "2 ngày trước". */
export function agoText(atMs: number, nowMs: number): string {
  return `${ageText(ageMinutes(atMs, nowMs))} trước`;
}

// ───────────────────────────────────────────────────────── người dùng (U) ──
export interface UsersFacts {
  total: number;
  /** null when at least one account has no readable `createdAt` (the count would be a guess). */
  newLast7d: number | null;
}

const DAY_MS = 86_400_000;

/** `GET /auth/users` → `{ users: [{ createdAt, … }] }` (auth-service `listUsers`: every non-ADMIN account). */
export function summarizeUsers(body: unknown, nowMs: number): UsersFacts | null {
  const users = isObj(body) && Array.isArray(body.users) ? body.users : null;
  if (!users) return null;
  let fresh = 0;
  let unreadable = 0;
  for (const u of users) {
    const t = isObj(u) ? msOf(u.createdAt) : null;
    if (t === null) unreadable += 1;
    else if (t >= nowMs - 7 * DAY_MS) fresh += 1;
  }
  return { total: users.length, newLast7d: unreadable === 0 ? fresh : null };
}

// ─────────────────────────────────────────────────── dịch vụ đang chạy ──
export interface MonitorFacts {
  healthy: number;
  total: number;
}

/** `GET /admin/system-monitor` → `{ success, data: { summary: { healthyCount, serviceCount } } }` (gateway). */
export function summarizeMonitor(body: unknown): MonitorFacts | null {
  const data = isObj(body) && body.success === true && isObj(body.data) ? body.data : null;
  const s = data && isObj(data.summary) ? data.summary : null;
  const healthy = s?.healthyCount;
  const total = s?.serviceCount;
  if (typeof healthy !== "number" || typeof total !== "number" || !Number.isInteger(healthy) || !Number.isInteger(total)) return null;
  if (total <= 0 || healthy < 0 || healthy > total) return null;
  return { healthy, total };
}

// ───────────────────────────────────────────────────────────── hàng đợi ──
/** U1 `GET /admin/sessions/disputed` → bare array of DISPUTED `Session` rows (`disputedAt`, `disputeType`, `id`). */
export function summarizeDisputes(list: unknown): QueueFacts | null {
  if (!Array.isArray(list)) return null;
  const rows = list.filter(isObj);
  const times = rows.map((r) => msOf(r.disputedAt));
  const { oldest, newest } = bounds(times);
  const idx = newest === null ? -1 : times.indexOf(newest);
  const newestRow = idx >= 0 ? rows[idx] : null;
  const id = newestRow ? str(newestRow.id) : null;
  return {
    count: list.length,
    capped: false,
    oldestMs: oldest,
    newest:
      newest !== null && newestRow
        ? {
            queue: "disputes",
            kind: "Tranh chấp",
            title: `Buổi tập ${id ? id.slice(0, 8) : "—"}`,
            caption: disputeTypeLabel(str(newestRow.disputeType)),
            at: newest,
            to: ROUTES.disputes,
          }
        : null,
  };
}

/** A1 `GET /marketplace/orders/refund-requests` → `{data: orders}` already unwrapped by the service layer. */
export function summarizeServiceRefundQueue(list: unknown): QueueFacts | null {
  if (!Array.isArray(list)) return null;
  const { rows } = normalizeServiceRefunds(list);
  const times = rows.map((r) => msOf(r.requestedAt));
  const { oldest, newest } = bounds(times);
  const newestRow = newest === null ? null : rows[times.indexOf(newest)];
  return {
    count: rows.length,
    capped: false,
    oldestMs: oldest,
    newest: newestRow && newest !== null ? { queue: "serviceRefunds", kind: "Hoàn tiền", title: newestRow.title, caption: "Yêu cầu hoàn tiền dịch vụ chờ xử lý", at: newest, to: ROUTES.refunds } : null,
  };
}

const OWNER_LABEL: Record<string, string> = { PT: "PT", GYM: "phòng gym", CLIENT: "khách" };

export interface WithdrawalFacts {
  queues: WithdrawalQueues;
  /** Newest row of the P7 list (both statuses) by `createdAt`. */
  newest: RecentFact | null;
}

/** P7 `GET /admin/payments/withdrawals` → bare array of PENDING + APPROVED rows (≤100). */
export function summarizeWithdrawalList(list: unknown, nowMs: number): WithdrawalFacts | null {
  const queues = summarizeWithdrawals(list, nowMs);
  if (!queues) return null;
  let best: Record<string, unknown> | null = null;
  let bestAt = -Infinity;
  for (const r of list as unknown[]) {
    if (!isObj(r) || (r.status !== "PENDING" && r.status !== "APPROVED")) continue;
    const t = msOf(r.createdAt);
    if (t !== null && t > bestAt) {
      best = r;
      bestAt = t;
    }
  }
  let newest: RecentFact | null = null;
  if (best) {
    const cents = parseCents(best.amount);
    const owner = OWNER_LABEL[String(best.ownerType)] ?? "";
    newest = {
      queue: "withdrawals",
      kind: "Rút tiền",
      title: `${cents === null ? "—" : formatDong(centsToDong(cents))}${owner ? ` · ${owner}` : ""}`,
      caption: best.status === "APPROVED" ? "Đã duyệt, chờ chuyển khoản" : "Yêu cầu rút tiền chờ duyệt",
      at: bestAt,
      to: best.status === "APPROVED" ? ROUTES.withdrawalsApproved : ROUTES.withdrawalsPending,
    };
  }
  return { queues, newest };
}

function personName(u: unknown): string | null {
  if (!isObj(u)) return null;
  const full = [str(u.firstName), str(u.lastName)].filter(Boolean).join(" ");
  return full || str(u.email);
}

/** ADM-08 `GET /pt-applications/admin?status=SUBMITTED` → array; queue-entry time = `submittedAt` (fallback `createdAt`). */
export function summarizePtApplications(list: unknown): QueueFacts | null {
  if (!Array.isArray(list)) return null;
  const rows = list.filter(isObj);
  const times = rows.map((r) => msOf(r.submittedAt) ?? msOf(r.createdAt));
  const { oldest, newest } = bounds(times);
  const row = newest === null ? null : rows[times.indexOf(newest)];
  return {
    count: list.length,
    capped: false,
    oldestMs: oldest,
    newest: row && newest !== null ? { queue: "ptApplications", kind: "Hồ sơ PT", title: personName(row.user ?? row.userProfile) ?? "Ứng viên PT", caption: "Hồ sơ PT mới nộp", at: newest, to: ROUTES.pts } : null,
  };
}

/** ADM-50 `GET /admin/partners/applications` → `{ items, counts }`; the queue is `verificationStatus === "IN_REVIEW"`. */
export function summarizePartnerApplications(body: unknown): QueueFacts | null {
  if (!isObj(body) || !isObj(body.counts) || !Array.isArray(body.items)) return null;
  // `counts` is a groupBy: a status with no rows is simply absent → 0, not unknown.
  const raw = body.counts.IN_REVIEW;
  const count = raw === undefined ? 0 : typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
  if (count === null) return null;
  const rows = body.items.filter(isObj).filter((r) => r.verificationStatus === "IN_REVIEW");
  const times = rows.map((r) => msOf(r.submittedAt) ?? msOf(r.createdAt));
  const { oldest, newest } = bounds(times);
  const row = newest === null ? null : rows[times.indexOf(newest)];
  const name = row ? (str(row.brandName) ?? str(row.legalName) ?? str(row.applicantName) ?? str(row.contactEmail)) : null;
  return {
    count,
    capped: false,
    oldestMs: oldest,
    newest: row && newest !== null ? { queue: "partnerApplications", kind: "Đối tác", title: name ?? "Hồ sơ đối tác", caption: "Hồ sơ đối tác mới nộp", at: newest, to: ROUTES.partners } : null,
  };
}

/** ADM-51 `GET /admin/gyms` → array of Gym rows; the queue is `status === "PENDING_REVIEW"` (same filter as the badge). */
export function summarizeGyms(list: unknown): QueueFacts | null {
  if (!Array.isArray(list)) return null;
  const rows = list.filter(isObj).filter((g) => g.status === "PENDING_REVIEW");
  const times = rows.map((g) => msOf(g.createdAt));
  const { oldest, newest } = bounds(times);
  const row = newest === null ? null : rows[times.indexOf(newest)];
  return {
    count: rows.length,
    capped: false,
    oldestMs: oldest,
    newest: row && newest !== null ? { queue: "gyms", kind: "Chi nhánh", title: str(row.name) ?? "Chi nhánh mới", caption: "Chi nhánh mới gửi duyệt", at: newest, to: ROUTES.gyms } : null,
  };
}

/** gym-service `listProposals` caps the read at 1000 proposals (`take: 1000`). */
export const PROPOSAL_READ_CAP = 1000;

/** ADM-71 `GET /admin/amenities/proposals?status=PENDING` → groups (the service layer already unwrapped `groups`). */
export function summarizeProposals(groups: unknown): QueueFacts | null {
  if (!Array.isArray(groups)) return null;
  const flat: Array<{ at: number | null; name: string | null }> = [];
  let totalProposals = 0;
  for (const g of groups) {
    if (!isObj(g)) continue;
    const members = Array.isArray(g.proposals) ? g.proposals.filter(isObj) : [];
    totalProposals += members.length;
    for (const m of members) flat.push({ at: msOf(m.createdAt), name: str(m.name) ?? str(g.name) });
  }
  const { oldest, newest } = bounds(flat.map((f) => f.at));
  const row = newest === null ? null : flat.find((f) => f.at === newest);
  return {
    count: groups.length,
    capped: totalProposals >= PROPOSAL_READ_CAP,
    oldestMs: oldest,
    newest: row && newest !== null ? { queue: "proposals", kind: "Tiện ích", title: row.name ?? "Đề xuất tiện ích", caption: "Đề xuất tiện ích mới", at: newest, to: ROUTES.listings } : null,
  };
}

// ───────────────────────────────────────────────────────────────── text ──
/** "Cũ nhất 5 ngày" or "" when no readable time. */
export function oldestText(oldestMs: number | null, nowMs: number): string {
  return oldestMs === null ? "" : `Cũ nhất ${ageText(ageMinutes(oldestMs, nowMs))}`;
}

export const countLabel = (n: number, capped: boolean): string => (capped ? `≥${n}` : String(n));

/** Joins non-empty parts with " · ". */
export const joinDetail = (...parts: Array<string | null | undefined | false>): string => parts.filter(Boolean).join(" · ");

/** The "Cần xử lý về tiền" tile adds three COUNTS (approved withdrawals, critical exceptions, service refunds). */
export function moneyActionCount(parts: { approved: number; approvedCapped: boolean; exceptions: number; exceptionsCapped: boolean; refunds: number }): { count: number; capped: boolean } {
  return { count: parts.approved + parts.exceptions + parts.refunds, capped: parts.approvedCapped || parts.exceptionsCapped };
}

/** Newest-first list of the per-queue newest items; queues with no item are skipped. */
export function sortRecent(items: Array<RecentFact | null | undefined>): RecentFact[] {
  return items.filter((x): x is RecentFact => !!x).sort((a, b) => b.at - a.at);
}
