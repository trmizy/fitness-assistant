/**
 * "Hôm nay" model (batch G1) - pure functions, no React, no network.
 * Turns the answers of the existing owner endpoints into the work list of 05 section 8 / PASS_A_REDLINE "Hôm nay".
 *
 * Honesty rules (05 section 6, last paragraph):
 *  - a source that failed is NEVER turned into 0: the model reports it as a failed source / failed branch;
 *  - the total task count exists only when every source the role reads has loaded (`counts` is null otherwise);
 *  - nothing is invented: every row is a real record of an API answer, and fields the API does not send (for example the
 *    member behind a complaint) are not shown.
 */
import { buildPartnershipSections } from "../../../utils/brandPartnership";
import { normalizeExceptions } from "../../../utils/assistedCheckin";
import { formatVND } from "../../../utils/currency";
import { issueLabel } from "../../../pages/admin/complaints/gymCaseLabels";
import type { OwnerCaseListItem } from "../../../pages/admin/complaints/gymCaseTypes";
import type { CanFn, PartnerRole } from "../../../utils/gymStaffRole";
import { ALL_BRANCHES } from "../scope/scopeModel";
import { statsLineOf, statsLineText, type StatsState } from "../stats/gymStats";
import { exceptionDeepLink } from "../front-desk/frontDeskModel";

export const HCM_TZ = "Asia/Ho_Chi_Minh";

// ---------------------------------------------------------------------------------------------------------------------
// Time (Asia/Ho_Chi_Minh, independent of the browser's zone)
// ---------------------------------------------------------------------------------------------------------------------

interface HcmParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: number; // 0 = Sunday
}
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_VI = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

let fmt: Intl.DateTimeFormat | null = null;
function hcmParts(ms: number): HcmParts {
  fmt ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: HCM_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, weekday: WEEKDAY_INDEX[out.weekday] ?? 0 };
}

/** "Hôm nay, Chủ nhật 22/11" - the page title (05 / redline: the title carries the date). */
export function todayTitle(nowMs: number): string {
  const p = hcmParts(nowMs);
  return `Hôm nay, ${WEEKDAY_VI[p.weekday]} ${p.day}/${p.month}`;
}

/** "09:41" in Ho Chi Minh time. */
export function clockLabel(ms: number): string {
  const p = hcmParts(ms);
  return `${p.hour}:${p.minute}`;
}

/**
 * Age of a record as a person says it. Unknown / invalid time gives "" (never a made-up age); a time slightly in the future
 * (clock skew between devices) reads as "Vừa xong".
 */
export function relativeAge(atMs: number | null | undefined, nowMs: number): string {
  if (atMs == null || !Number.isFinite(atMs)) return "";
  const diff = nowMs - atMs;
  if (diff < 60_000) return "Vừa xong";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} phút trước`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  const p = hcmParts(atMs);
  return `${p.day}/${p.month}/${p.year}`;
}

export function parseTime(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Source states
// ---------------------------------------------------------------------------------------------------------------------

export type Source<T> = { state: "loading" } | { state: "error" } | { state: "ok"; data: T; at: number };
export const LOADING: Source<never> = { state: "loading" };

/** What the page needs to know about a branch. Fields come from GET /owner/gyms (extra fields are ignored). */
export interface TodayGym {
  id: string;
  name: string;
  status?: string;
  operationalStatus?: string | null;
  city?: string | null;
  address?: string | null;
  expectedReopenAt?: string | null;
  updatedAt?: string | null;
  activeMemberCount?: number;
  averageRating?: number;
  reviewCount?: number;
}

export type TaskKind = "exception" | "complaint" | "collaboration" | "withdrawal" | "branch";
export type TaskGroup = "decide" | "wait";

export interface TodayTask {
  id: string;
  kind: TaskKind;
  group: TaskGroup;
  /** null = brand level (no single branch). */
  gymId: string | null;
  text: string;
  sub: string;
  at: number | null;
  href: string;
  actionLabel: string;
}

export interface TodayInput {
  role: PartnerRole | undefined;
  /** The server-permission predicate (scope.can); which sources are read follows it (sourcesForRole). */
  can: CanFn;
  nowMs: number;
  /** Branches in the caller's scope (DRAFT rows already removed by the scope provider). */
  gyms: readonly TodayGym[];
  /** DRAFT rows from the same list (OWNER only): branches that were sent back or are still being written. */
  drafts: readonly TodayGym[];
  /** "ALL" or one branch id. */
  scopeGymId: string;
  codes: Readonly<Record<string, string>>;
  exceptions: Readonly<Record<string, Source<unknown>>>;
  withdrawals: Readonly<Record<string, Source<unknown>>>;
  reviewIssues: Readonly<Record<string, Source<unknown>>>;
  complaints: Source<OwnerCaseListItem[]> | null;
  collaborations: Source<unknown> | null;
  ptNames: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Which sources a role reads (audit/02 section 1)
// ---------------------------------------------------------------------------------------------------------------------

export interface RoleSources {
  exceptions: boolean;
  withdrawals: boolean;
  reviewIssues: boolean;
  complaints: boolean;
  collaborations: boolean;
}
/**
 * G5: which sources the account may read, from the server's permissions[] (fail-closed: loading / unknown / an old backend reads nothing).
 * exceptions = `checkin.exception.approve`; withdrawals = `finance.withdrawals.view`; branch paperwork = `branch.write`; PT agreements =
 * `collaboration.manage`. Complaint cases have no permission of their own (the case service itself checks "owner or a manager of the case's
 * branch"), so that one source also needs a known owner / manager role next to `branch.view`.
 */
export function sourcesForRole(can: CanFn, role: PartnerRole | undefined): RoleSources {
  return {
    exceptions: can("checkin.exception.approve"),
    withdrawals: can("finance.withdrawals.view"),
    reviewIssues: can("branch.write"),
    complaints: can("branch.view") && (role === "OWNER" || role === "MANAGER"),
    collaborations: can("collaboration.manage"),
  };
}

/** Per-branch requests are only made for branches that can have front-desk / wallet data. */
export function fansOutTo(g: Pick<TodayGym, "status">): boolean {
  return g.status === "APPROVED";
}

/** Brand-level rows (PT agreements, branches awaiting paperwork) show on "all branches" or when the brand has one branch. */
export function brandLevelVisible(scopeGymId: string, branchCount: number): boolean {
  return scopeGymId === ALL_BRANCHES || branchCount === 1;
}

export function targetGyms<T extends { id: string }>(gyms: readonly T[], scopeGymId: string): T[] {
  return scopeGymId === ALL_BRANCHES ? [...gyms] : gyms.filter((g) => g.id === scopeGymId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Task builders
// ---------------------------------------------------------------------------------------------------------------------

/** G3: opens the Ngoại lệ tab of the Quầy lễ tân with this very request in its drawer. */
const exceptionHref = (gymId: string, exceptionId: string) => exceptionDeepLink(gymId, exceptionId);
const financeHref = (gymId: string) => `/gym-owner/finance?gymId=${encodeURIComponent(gymId)}`;
export const COLLAB_HREF = "/gym-owner/collaborations";
export const caseHref = (id: string) => `/gym-owner/complaint-cases/${encodeURIComponent(id)}`;
const branchHref = (g: Pick<TodayGym, "id" | "status">) => (g.status === "DRAFT" ? `/gym-owner/gyms/wizard/${encodeURIComponent(g.id)}` : `/gym-owner/gyms/${encodeURIComponent(g.id)}`);

function exceptionTasks(gym: TodayGym, raw: unknown, nowMs: number): TodayTask[] {
  const { canApprove, exceptions } = normalizeExceptions(raw);
  const out: TodayTask[] = [];
  for (const e of exceptions) {
    if (e.status !== "PENDING") continue;
    const exp = parseTime(e.expiresAt);
    if (exp !== null && exp < nowMs) continue; // expired at day end: it can no longer be decided (server answers 410)
    if (!e.mine && !canApprove) continue; // not the viewer's to decide, and not theirs to wait for
    out.push(
      e.mine
        ? {
            id: `exception:${e.id}`,
            kind: "exception",
            group: "wait",
            gymId: gym.id,
            text: `Ngoại lệ check-in của ${e.displayName} do bạn xin, chờ người khác duyệt`,
            sub: "Người duyệt phải khác người xin",
            at: parseTime(e.createdAt),
            href: exceptionHref(gym.id, e.id),
            actionLabel: "Xem ngoại lệ",
          }
        : {
            id: `exception:${e.id}`,
            kind: "exception",
            group: "decide",
            gymId: gym.id,
            text: `Ngoại lệ check-in của ${e.displayName} chờ duyệt`,
            sub: `Người xin: ${e.requestedByName}`,
            at: parseTime(e.createdAt),
            href: exceptionHref(gym.id, e.id),
            actionLabel: "Xem ngoại lệ",
          },
    );
  }
  return out;
}

function withdrawalTasks(gym: TodayGym, raw: unknown): TodayTask[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const out: TodayTask[] = [];
  for (const w of rows) {
    if (!w || w.status !== "PENDING" || typeof w.id !== "string") continue;
    const amount = Number(w.amount);
    out.push({
      id: `withdrawal:${w.id}`,
      kind: "withdrawal",
      group: "wait",
      gymId: gym.id,
      text: Number.isFinite(amount) ? `Lệnh rút ${formatVND(amount)} ở ${gym.name} đang chờ Gymini duyệt` : `Lệnh rút ở ${gym.name} đang chờ Gymini duyệt`,
      sub: "Tiền chưa rời ví cho đến khi Gymini duyệt",
      at: parseTime(w.createdAt),
      href: financeHref(gym.id),
      actionLabel: "Xem lệnh rút",
    });
  }
  return out;
}

function complaintTasks(items: readonly OwnerCaseListItem[], gymName: (id: string) => string | null, keep: (gymId: string) => boolean): TodayTask[] {
  const out: TodayTask[] = [];
  for (const c of items) {
    if (!c?.id || !keep(c.gymId)) continue;
    const issue = issueLabel(c.issueType).toLowerCase();
    if (c.awaitingYou) {
      out.push({
        id: `complaint:${c.id}`,
        kind: "complaint",
        group: "decide",
        gymId: c.gymId,
        text: `Khiếu nại về ${issue} cần phòng tập giải trình`,
        sub: c.respondBy ? `Hạn phản hồi ${shortDate(c.respondBy)}` : "Chờ phòng tập gửi giải trình",
        at: parseTime(c.createdAt),
        href: caseHref(c.id),
        actionLabel: "Xem giải trình",
      });
    } else if (c.canSubmit) {
      // Open, but Gymini is not waiting for this gym. The server's own progress sentence says where it is.
      out.push({
        id: `complaint:${c.id}`,
        kind: "complaint",
        group: "wait",
        gymId: c.gymId,
        text: `Khiếu nại về ${issue} đang được xử lý`,
        sub: c.progress || "Đang chờ Gymini",
        at: parseTime(c.createdAt),
        href: caseHref(c.id),
        actionLabel: "Xem hồ sơ",
      });
    }
  }
  return out;
}

export function shortDate(iso: string): string {
  const t = parseTime(iso);
  if (t === null) return "";
  const p = hcmParts(t);
  return `${p.day}/${p.month}`;
}

function collaborationTasks(raw: unknown, ptNames: Readonly<Record<string, string>>): TodayTask[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const at = new Map<string, number | null>();
  for (const r of rows) if (r && typeof r.id === "string") at.set(r.id, parseTime(r.updatedAt) ?? parseTime(r.createdAt));
  const { needsReply } = buildPartnershipSections(rows, "GYM");
  const out: TodayTask[] = [];
  for (const card of needsReply) {
    const name = ptNames[card.ptUserId];
    const who = name ? `PT ${name}` : "Một PT";
    if (card.kind === "BRAND") {
      out.push({
        id: `collab:${card.id}`,
        kind: "collaboration",
        group: "decide",
        gymId: null,
        text: card.round > 1 ? `${who} đề xuất lại tỷ lệ chia, vòng ${card.round}` : `${who} đề xuất hợp tác với thương hiệu`,
        sub: "Cấp thương hiệu, chờ bạn phản hồi",
        at: at.get(card.id) ?? null,
        href: COLLAB_HREF,
        actionLabel: "Xem thỏa thuận",
      });
    } else {
      const first = card.rows.find((r) => r.stage === "MY_TURN") ?? card.rows[0];
      out.push({
        id: `collab:${card.key}`,
        kind: "collaboration",
        group: "decide",
        gymId: null,
        text: `${who} có đề xuất theo chi nhánh cần bạn trả lời`,
        sub: "Cấp thương hiệu, chờ bạn phản hồi",
        at: first ? (at.get(first.id) ?? null) : null,
        href: COLLAB_HREF,
        actionLabel: "Xem thỏa thuận",
      });
    }
  }
  return out;
}

function openIssueCount(raw: unknown): { count: number; at: number | null } {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const open = rows.filter((r) => r && !r.resolvedAt);
  let at: number | null = null;
  for (const r of open) {
    const t = parseTime(r.createdAt);
    if (t !== null && (at === null || t > at)) at = t;
  }
  return { count: open.length, at };
}

// ---------------------------------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------------------------------

export type BrandSourceKey = "complaints" | "collaborations" | "review-issues";
export const BRAND_SOURCE_LABEL: Record<BrandSourceKey, string> = {
  complaints: "khiếu nại",
  collaborations: "thỏa thuận PT",
  "review-issues": "hồ sơ chi nhánh",
};

export interface TodayModel {
  tasks: TodayTask[];
  decide: TodayTask[];
  wait: TodayTask[];
  /** Branches (in the current view) whose per-branch sources did not all load. */
  failedGymIds: string[];
  failedBrandSources: BrandSourceKey[];
  loading: boolean;
  /** Branches of the current view / how many of them loaded everything their role reads. */
  coverage: { loaded: number; total: number };
  /** Every source the role reads has loaded: only then may a total be shown. */
  complete: boolean;
  /** null unless `complete`. */
  counts: { decide: number; wait: number } | null;
  /** Oldest time at which any source of this view was read (null when nothing has loaded). */
  updatedAt: number | null;
}

const byNewest = (a: TodayTask, b: TodayTask) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.id.localeCompare(b.id);

export function buildToday(input: TodayInput): TodayModel {
  const { role, can, nowMs, gyms, drafts, scopeGymId, exceptions, withdrawals, reviewIssues, complaints, collaborations, ptNames } = input;
  const read = sourcesForRole(can, role);
  const view = targetGyms(gyms, scopeGymId);
  const brandVisible = brandLevelVisible(scopeGymId, gyms.length);
  const nameOf = (id: string) => gyms.find((g) => g.id === id)?.name ?? drafts.find((g) => g.id === id)?.name ?? null;

  const tasks: TodayTask[] = [];
  const failedGymIds: string[] = [];
  const failedBrandSources: BrandSourceKey[] = [];
  let loading = false;
  let oldest: number | null = null;
  const seen = (at: number) => {
    oldest = oldest === null ? at : Math.min(oldest, at);
  };

  const readBranch = (src: Source<unknown> | undefined, gym: TodayGym, build: (data: unknown) => TodayTask[]): "ok" | "error" | "loading" => {
    if (!src || src.state === "loading") return "loading";
    if (src.state === "error") return "error";
    seen(src.at);
    tasks.push(...build(src.data));
    return "ok";
  };

  let loadedBranches = 0;
  for (const g of view) {
    if (!fansOutTo(g)) {
      loadedBranches += 1; // nothing to read for a branch that is not live yet
      continue;
    }
    const states: ("ok" | "error" | "loading")[] = [];
    if (read.exceptions) states.push(readBranch(exceptions[g.id], g, (d) => exceptionTasks(g, d, nowMs)));
    if (read.withdrawals) states.push(readBranch(withdrawals[g.id], g, (d) => withdrawalTasks(g, d)));
    if (states.includes("error")) failedGymIds.push(g.id);
    else if (states.includes("loading")) loading = true;
    else loadedBranches += 1;
  }

  if (read.complaints) {
    if (!complaints || complaints.state === "loading") loading = true;
    else if (complaints.state === "error") failedBrandSources.push("complaints");
    else {
      seen(complaints.at);
      const ids = new Set(view.map((g) => g.id));
      tasks.push(...complaintTasks(complaints.data, nameOf, (gymId) => scopeGymId === ALL_BRANCHES || ids.has(gymId)));
    }
  }

  if (read.collaborations && brandVisible) {
    if (!collaborations || collaborations.state === "loading") loading = true;
    else if (collaborations.state === "error") failedBrandSources.push("collaborations");
    else {
      seen(collaborations.at);
      tasks.push(...collaborationTasks(collaborations.data, ptNames));
    }
  }

  if (read.reviewIssues) {
    // Branch paperwork: only the OWNER sees it. Branches awaiting Gymini or rejected come straight from the branch list.
    for (const g of view) {
      if (g.status === "PENDING_REVIEW") {
        tasks.push({
          id: `branch-pending:${g.id}`,
          kind: "branch",
          group: "wait",
          gymId: g.id,
          text: `Hồ sơ ${g.name} đang chờ Gymini duyệt`,
          sub: "Bạn chưa cần làm gì thêm",
          at: parseTime(g.updatedAt),
          href: branchHref(g),
          actionLabel: "Xem chi nhánh",
        });
      } else if (g.status === "REJECTED") {
        tasks.push({
          id: `branch-rejected:${g.id}`,
          kind: "branch",
          group: "decide",
          gymId: g.id,
          text: `Hồ sơ ${g.name} bị Gymini từ chối`,
          sub: "Mở chi nhánh để xem lý do và chỉnh sửa",
          at: parseTime(g.updatedAt),
          href: branchHref(g),
          actionLabel: "Xem chi nhánh",
        });
      }
    }
    // Drafts sent back with open review issues (drafts are not selectable branches, so they follow the brand-level rule).
    if (brandVisible) {
      let draftFailed = false;
      for (const d of drafts) {
        const src = reviewIssues[d.id];
        if (!src || src.state === "loading") {
          loading = true;
          continue;
        }
        if (src.state === "error") {
          draftFailed = true;
          continue;
        }
        seen(src.at);
        const { count, at } = openIssueCount(src.data);
        if (count > 0) {
          tasks.push({
            id: `branch-issues:${d.id}`,
            kind: "branch",
            group: "decide",
            gymId: null,
            text: `Hồ sơ ${d.name} còn ${count} mục cần bổ sung`,
            sub: "Chờ bạn bổ sung hồ sơ chi nhánh",
            at: at ?? parseTime(d.updatedAt),
            href: branchHref({ id: d.id, status: "DRAFT" }),
            actionLabel: "Bổ sung hồ sơ",
          });
        }
      }
      if (draftFailed) failedBrandSources.push("review-issues");
    }
  }

  const decide = tasks.filter((t) => t.group === "decide").sort(byNewest);
  const wait = tasks.filter((t) => t.group === "wait").sort(byNewest);
  const complete = !loading && failedGymIds.length === 0 && failedBrandSources.length === 0;
  return {
    tasks: [...decide, ...wait],
    decide,
    wait,
    failedGymIds,
    failedBrandSources,
    loading,
    coverage: { loaded: loadedBranches, total: view.length },
    complete,
    counts: complete ? { decide: decide.length, wait: wait.length } : null,
    updatedAt: oldest,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Header lines
// ---------------------------------------------------------------------------------------------------------------------

/** The line under the title: "Cập nhật 09:41, đủ 4/4 chi nhánh" / "Cập nhật 09:41, 3/4 chi nhánh" / "Đang tải". */
export function freshnessLine(m: TodayModel, single: boolean): string {
  if (m.updatedAt === null) return m.loading ? "Đang tải" : "";
  const t = clockLabel(m.updatedAt);
  if (single) return `Cập nhật ${t}`;
  const { loaded, total } = m.coverage;
  if (m.loading) return `Cập nhật ${t}, đang tải thêm`;
  return loaded === total && m.failedBrandSources.length === 0 ? `Cập nhật ${t}, đủ ${total}/${total} chi nhánh` : `Cập nhật ${t}, ${loaded}/${total} chi nhánh`;
}

/** The coverage warning, or null when everything loaded. Never contains a total. */
export function coverageNotice(m: TodayModel, codes: Readonly<Record<string, string>>): { text: string } | null {
  if (m.failedGymIds.length === 0 && m.failedBrandSources.length === 0) return null;
  const parts: string[] = [];
  if (m.failedGymIds.length > 0) {
    const names = m.failedGymIds.map((id) => codes[id] ?? "?").join(", ");
    parts.push(`Đã tải ${m.coverage.loaded}/${m.coverage.total} chi nhánh, ${names} lỗi`);
  }
  if (m.failedBrandSources.length > 0) {
    parts.push(`Chưa tải được ${m.failedBrandSources.map((k) => BRAND_SOURCE_LABEL[k]).join(", ")}`);
  }
  return { text: parts.join(". ") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Branch list (right column)
// ---------------------------------------------------------------------------------------------------------------------

export interface BranchRow {
  id: string;
  name: string;
  code: string;
  statusText: string;
  /** null = not known / not loadable for this branch. */
  openTasks: number | null;
  members: number | null;
  /** G5: memberships running right now, from `GET /owner/gyms/:id/stats`; null = not known (loading, failed, role has no such block). */
  running: number | null;
  /** G5: the stats words of this branch ("12 lượt check-in hôm nay", "3 thẻ sắp hết hạn trong 7 ngày", or the honest "chưa tải được"). */
  statsLines: string[];
  rating: string;
  href: string;
}

const nfRating = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** "4,6 (128 đánh giá)"; a branch with no review reads "Chưa có đánh giá", never "0,0". */
export function ratingLabel(average: number | undefined, count: number | undefined): string {
  if (!count || count <= 0 || average == null || !Number.isFinite(average)) return "Chưa có đánh giá";
  return `${nfRating.format(average)} (${count} đánh giá)`;
}

export function branchRows(
  view: readonly TodayGym[],
  model: TodayModel,
  codes: Readonly<Record<string, string>>,
  statusTextOf: (g: TodayGym) => string,
  /** Per-branch stats answers; a branch missing from the map shows no stats line (the role does not read them / not asked). */
  statsById: Readonly<Record<string, StatsState>> = {},
): BranchRow[] {
  const brandFailed = model.failedBrandSources.includes("complaints");
  return view.map((g) => {
    const failed = model.failedGymIds.includes(g.id) || brandFailed;
    const st = statsById[g.id];
    const line = st ? statsLineOf(st) : null;
    return {
      id: g.id,
      name: g.name,
      code: codes[g.id] ?? "--",
      statusText: statusTextOf(g),
      openTasks: failed || model.loading ? null : model.tasks.filter((t) => t.gymId === g.id).length,
      members: typeof g.activeMemberCount === "number" ? g.activeMemberCount : null,
      running: line ? line.runningMemberships : null,
      statsLines: line ? statsLineText(line) : [],
      rating: ratingLabel(g.averageRating, g.reviewCount),
      href: `/gym-owner/gyms/${encodeURIComponent(g.id)}`,
    };
  });
}

/** Groups a list into the first `limit` rows and the rest (the "Xem tất cả" expander). */
export function limitRows<T>(rows: readonly T[], limit: number, expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || rows.length <= limit) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, limit), hidden: rows.length - limit };
}
export const MAX_ROWS = 8;
