/**
 * Charts of the Gym Owner (phase 1: frontend only, data that already exists) - pure functions, no React, no network.
 *
 *  - Hôm nay: check-ins per Vietnam day (GET /owner/gyms/:id/stats?from&to, max 92 days) with a comparison against the previous
 *    EQUAL period, and the membership status split (byStatus of the same endpoint).
 *  - Tài chính / Doanh số: revenue over time and sales by plan, derived from the membership rows the Sales tab already loads.
 *
 * Honesty rules (same as today/todayModel.ts and stats/gymStats.ts):
 *  - a section the server did not send (`null`) or the role may not read draws NOTHING (never a zero chart, never an error);
 *  - a request that failed or is still loading is a state of its own, never 0; a total over several branches exists only when
 *    EVERY branch of that total has loaded;
 *  - the comparison never invents a baseline: a previous period with 0 check-ins has no percentage;
 *  - all days are Vietnam calendar days (UTC+7, no DST), independent of the browser zone;
 *  - revenue = the gross selling price of paid cards (ACTIVE + EXPIRED, like `recognizedSales`), NOT the gym's income.
 */
import type { CanFn } from "../../../utils/gymStaffRole";
import type { GymStats } from "../../../types";
import type { StatsState } from "../stats/gymStats";
import type { SalesView } from "../finance/financeModel";

// ---------------------------------------------------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------------------------------------------------

export interface ChartAccess {
  /** Check-in trend: `checkin.list` (owner, manager, receptionist). */
  checkins: boolean;
  /** Membership status split: `membership.full` (owner, manager). The accountant's `membership.sales` is NOT enough: no member data. */
  members: boolean;
  /** Revenue / sales by plan: `membership.sales` (owner, accountant). */
  sales: boolean;
  /** Phase 2 "Giờ cao điểm" heatmap: `checkin.list` (owner, manager, receptionist) - the server's own gate for that /analytics section. */
  heatmap: boolean;
  /** Phase 2 renewal card: `membership.full` or `membership.sales` (owner, manager, accountant) - no identity in it. */
  renewal: boolean;
  /** Phase 2 "Thực nhận": `finance.wallet.view` (owner, accountant). */
  netIncome: boolean;
}

/** Which charts the account may see, from the server's permissions[] (fail-closed: loading / unknown role = nothing). */
export function chartAccess(can: CanFn): ChartAccess {
  return {
    checkins: can("checkin.list"),
    members: can("membership.full"),
    sales: can("membership.sales"),
    heatmap: can("checkin.list"),
    renewal: can("membership.full") || can("membership.sales"),
    netIncome: can("finance.wallet.view"),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Vietnam calendar days (fixed +07:00)
// ---------------------------------------------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const VN_OFFSET_MS = 7 * HOUR_MS;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' of an instant in Vietnam time. */
export function vnDateOf(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' of an ISO timestamp in Vietnam time, or null when it is missing / not a date. */
export function vnDateOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? vnDateOf(t) : null;
}

function utcMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function shiftDate(date: string, days: number): string {
  return new Date(utcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of days between two dates (from <= to gives >= 1). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS) + 1;
}

/** Every date from..to, both inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const n = daysInclusive(from, to);
  return n >= 1 ? Array.from({ length: n }, (_, i) => shiftDate(from, i)) : [];
}

/** 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(utcMs(date)).getUTCDay();
}

/** The Monday of the week (Vietnam's week starts on Monday) that contains `date`. */
export function weekStartOf(date: string): string {
  const back = (weekdayOf(date) + 6) % 7;
  return shiftDate(date, -back);
}

/** "22/11". */
export function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
/** "T2 17/11" - the axis label of a short range. */
export function dayWithWeekday(date: string): string {
  return `${WEEKDAY_SHORT[weekdayOf(date)]} ${dayMonth(date)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Periods and comparison
// ---------------------------------------------------------------------------------------------------------------------

export const CHECKIN_RANGES = [7, 30, 90] as const;
export type CheckinRange = (typeof CHECKIN_RANGES)[number];
/** The server refuses a longer range (RANGE_TOO_LARGE); each of the two calls of a comparison is one range. */
export const STATS_MAX_DAYS = 92;

export interface DateRange {
  from: string;
  to: string;
}

/** The last `days` Vietnam days ending today, and the EQUAL period right before it (contiguous, no overlap). */
export function periodRanges(todayVn: string, days: number): { current: DateRange; previous: DateRange } {
  const curFrom = shiftDate(todayVn, -(days - 1));
  return {
    current: { from: curFrom, to: todayVn },
    previous: { from: shiftDate(curFrom, -days), to: shiftDate(curFrom, -1) },
  };
}

export type PeriodComparison =
  | { kind: "change"; pct: number; direction: "up" | "down" | "flat" }
  /** The previous period had 0: a percentage would be infinite, so none is drawn. */
  | { kind: "no-baseline" }
  | { kind: "both-zero" }
  | { kind: "loading" }
  | { kind: "error" };

/** Percent change of `current` against `previous`; null totals mean "not known" and are never read as 0. */
export function compareTotals(current: number, previous: number | null, previousState: "ok" | "loading" | "error" = "ok"): PeriodComparison {
  if (previous === null || previousState !== "ok") return { kind: previousState === "error" ? "error" : "loading" };
  if (previous === 0) return current === 0 ? { kind: "both-zero" } : { kind: "no-baseline" };
  const pct = ((current - previous) / previous) * 100;
  const direction = current === previous ? "flat" : current > previous ? "up" : "down";
  return { kind: "change", pct, direction };
}

const nfPct = (v: number): string => {
  const abs = Math.abs(v);
  const digits = abs >= 10 ? 0 : 1;
  // Manual decimal comma: no dependency on the ICU build of the runtime.
  return abs.toFixed(digits).replace(".", ",").replace(/,0$/, "");
};

/** "+12% so với 30 ngày trước" and the honest variants. `days` names the previous period. */
export function comparisonText(c: PeriodComparison, days: number, noun = "check-in"): string {
  const prev = `${days} ngày trước`;
  switch (c.kind) {
    case "change": {
      if (c.direction === "flat") return `Không đổi so với ${prev}`;
      const rounded = nfPct(c.pct);
      // A tiny change that rounds to 0 keeps its direction instead of reading "+0%".
      const sign = c.direction === "up" ? "+" : "-";
      return `${sign}${rounded === "0" ? "0,1" : rounded}% so với ${prev}`;
    }
    case "no-baseline":
      return `${days} ngày trước chưa có lượt ${noun} nào để so sánh`;
    case "both-zero":
      return `Chưa có lượt ${noun} nào trong cả hai kỳ`;
    case "loading":
      return `Đang tải ${days} ngày trước để so sánh`;
    case "error":
      return `Chưa tải được ${days} ngày trước để so sánh`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------------------------------------------------

export interface DayCount {
  date: string;
  count: number;
}

/**
 * The state of one range of one branch: `hidden` = the server sent `checkins: null` (the role may not read it); `error` also covers an
 * answer whose shape is not the one asked for (a missing day, a wrong date) - a chart is never drawn from a half-valid answer.
 */
export type RangeState = { state: "loading" } | { state: "error" } | { state: "hidden" } | { state: "ok"; daily: DayCount[] };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Turns one /stats answer (or its loading / error state) into a RangeState for the range that was asked. */
export function rangeStateOf(s: StatsState, range: DateRange): RangeState {
  if (s.state !== "ok") return { state: s.state };
  const c = s.stats.checkins;
  if (c === null || c === undefined) return { state: "hidden" };
  if (!c || !Array.isArray(c.daily)) return { state: "error" };
  const want = datesBetween(range.from, range.to);
  if (c.daily.length !== want.length) return { state: "error" };
  const daily: DayCount[] = [];
  for (let i = 0; i < want.length; i++) {
    const d = c.daily[i];
    if (!d || d.date !== want[i] || !isCount(d.count)) return { state: "error" };
    daily.push({ date: d.date, count: d.count });
  }
  return { state: "ok", daily };
}

export const sumCounts = (daily: readonly DayCount[]): number => daily.reduce((a, d) => a + d.count, 0);

export interface BranchRange {
  gymId: string;
  current: RangeState;
  previous: RangeState;
}

export interface CheckinTrend {
  /** false = no branch in view lets this role read check-ins: draw nothing at all (not even a frame). */
  visible: boolean;
  /** Branches that count (a `hidden` branch is not one of them). */
  total: number;
  loaded: number;
  failedGymIds: string[];
  /** Every counted branch has its current period: only then is there a series and a total. */
  complete: boolean;
  loading: boolean;
  /** Summed per day over the counted branches; null unless `complete`. */
  daily: DayCount[] | null;
  sum: number | null;
  comparison: PeriodComparison;
}

/** Adds the branches day by day. Needs every branch to be ok (the caller guarantees it). */
function sumSeries(series: readonly DayCount[][]): DayCount[] {
  const first = series[0] ?? [];
  return first.map((d, i) => ({ date: d.date, count: series.reduce((a, s) => a + (s[i]?.count ?? 0), 0) }));
}

export function buildCheckinTrend(branches: readonly BranchRange[]): CheckinTrend {
  const counted = branches.filter((b) => b.current.state !== "hidden");
  if (counted.length === 0) {
    return { visible: false, total: 0, loaded: 0, failedGymIds: [], complete: false, loading: false, daily: null, sum: null, comparison: { kind: "loading" } };
  }
  const okNow = counted.filter((b) => b.current.state === "ok");
  const failed = counted.filter((b) => b.current.state === "error").map((b) => b.gymId);
  const loading = failed.length === 0 && okNow.length < counted.length;
  const complete = okNow.length === counted.length;

  const daily = complete ? sumSeries(okNow.map((b) => (b.current as { daily: DayCount[] }).daily)) : null;
  const sum = daily ? sumCounts(daily) : null;

  // The previous period counts only when it covers the same branches; one failed branch makes the comparison unavailable, not smaller.
  const prevStates = counted.map((b) => b.previous.state);
  let comparison: PeriodComparison;
  if (sum === null) comparison = { kind: "loading" };
  else if (prevStates.includes("error") || prevStates.includes("hidden")) comparison = { kind: "error" };
  else if (prevStates.includes("loading")) comparison = { kind: "loading" };
  else comparison = compareTotals(sum, sumCounts(sumSeries(counted.map((b) => (b.previous as { daily: DayCount[] }).daily))));

  return { visible: true, total: counted.length, loaded: okNow.length, failedGymIds: failed, complete, loading, daily, sum, comparison };
}

export interface BranchCompareRow {
  gymId: string;
  state: "ok" | "loading" | "error";
  current: number | null;
  previous: number | null;
  comparison: PeriodComparison;
}

/** One row per counted branch for the "so sánh chi nhánh" view: its own total and its own change. */
export function branchCompareRows(branches: readonly BranchRange[]): BranchCompareRow[] {
  return branches
    .filter((b) => b.current.state !== "hidden")
    .map((b) => {
      if (b.current.state !== "ok") return { gymId: b.gymId, state: b.current.state === "error" ? "error" : "loading", current: null, previous: null, comparison: { kind: "loading" } } as BranchCompareRow;
      const current = sumCounts(b.current.daily);
      const prev = b.previous;
      const previous = prev.state === "ok" ? sumCounts(prev.daily) : null;
      return { gymId: b.gymId, state: "ok", current, previous, comparison: compareTotals(current, previous, prev.state === "ok" ? "ok" : prev.state === "error" ? "error" : "loading") };
    });
}

/** The busiest day of a series (first one when tied); null for an empty series or one with no check-in at all. */
export function peakDay(daily: readonly DayCount[]): DayCount | null {
  let best: DayCount | null = null;
  for (const d of daily) if (d.count > 0 && (best === null || d.count > best.count)) best = d;
  return best;
}

/** The text a screen reader (and the summary line) gets for the check-in bars. */
export function checkinSummary(daily: readonly DayCount[], days: number): string {
  const total = sumCounts(daily);
  if (daily.length === 0) return "";
  const range = `${dayMonth(daily[0].date)} đến ${dayMonth(daily[daily.length - 1].date)}`;
  if (total === 0) return `Chưa có lượt check-in nào trong ${days} ngày qua (${range}).`;
  const peak = peakDay(daily)!;
  return `${total} lượt check-in trong ${days} ngày qua (${range}). Ngày đông nhất ${dayMonth(peak.date)} với ${peak.count} lượt.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Membership status split
// ---------------------------------------------------------------------------------------------------------------------

export interface MembershipBlock {
  active: number;
  expiringSoon: number;
  expiringSoonDays: number;
  byStatus: Record<string, number>;
}

/** The memberships block of an ok answer, validated; null when the server did not send it (or sent junk). */
export function membershipBlockOf(s: StatsState): MembershipBlock | null {
  if (s.state !== "ok") return null;
  const m = (s.stats as GymStats).memberships;
  if (!m || typeof m !== "object" || !m.byStatus || typeof m.byStatus !== "object") return null;
  if (!isCount(m.active) || !isCount(m.expiringSoon)) return null;
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(m.byStatus)) if (isCount(v)) byStatus[k] = v;
  return { active: m.active, expiringSoon: m.expiringSoon, expiringSoonDays: isCount(m.expiringSoonDays) ? m.expiringSoonDays : 7, byStatus };
}

export interface MembershipAgg {
  /** false = no branch sent a memberships block: draw nothing. */
  visible: boolean;
  total: number;
  loaded: number;
  failedGymIds: string[];
  loading: boolean;
  complete: boolean;
  /** Summed over branches; null unless `complete`. */
  block: MembershipBlock | null;
}

/** States by branch id; a branch whose answer has no memberships block (role may not read it) is not counted. */
export function aggregateMemberships(states: Readonly<Record<string, StatsState>>, gymIds: readonly string[]): MembershipAgg {
  const seen = gymIds.map((id) => ({ id, s: states[id] ?? ({ state: "loading" } as StatsState) }));
  const hidden = (s: StatsState) => s.state === "ok" && s.stats.memberships === null;
  const counted = seen.filter((x) => !hidden(x.s));
  if (counted.length === 0) return { visible: false, total: 0, loaded: 0, failedGymIds: [], loading: false, complete: false, block: null };
  const blocks = counted.map((x) => ({ id: x.id, s: x.s, b: membershipBlockOf(x.s) }));
  const failed = blocks.filter((x) => x.s.state === "error" || (x.s.state === "ok" && x.b === null)).map((x) => x.id);
  const good = blocks.filter((x) => x.b !== null);
  const loading = failed.length === 0 && good.length < counted.length;
  const complete = good.length === counted.length;
  let block: MembershipBlock | null = null;
  if (complete) {
    block = { active: 0, expiringSoon: 0, expiringSoonDays: good[0].b!.expiringSoonDays, byStatus: {} };
    for (const x of good) {
      block.active += x.b!.active;
      block.expiringSoon += x.b!.expiringSoon;
      for (const [k, v] of Object.entries(x.b!.byStatus)) block.byStatus[k] = (block.byStatus[k] ?? 0) + v;
    }
  }
  return { visible: true, total: counted.length, loaded: good.length, failedGymIds: failed, loading, complete, block };
}

export type SliceKey = "running" | "expiring" | "queued" | "expired" | "cancelled" | "pending" | "issue" | "other";
export interface StatusSlice {
  key: SliceKey;
  label: string;
  value: number;
  /** One line of plain words under the legend entry. */
  hint: string;
}

/**
 * Mutually exclusive slices of the cards of a branch (they add up to every card the server counted):
 *  - ACTIVE splits into running (not ending soon), ending within `expiringSoonDays`, and "chờ bắt đầu" = ACTIVE but not running yet
 *    (`byStatus.ACTIVE - active`: a renewal queued behind the current card);
 *  - the other raw statuses keep their own slice; a status this build does not know goes to "Khác" with its real count.
 */
export function membershipSlices(m: MembershipBlock): StatusSlice[] {
  const activeRaw = m.byStatus.ACTIVE ?? 0;
  const expiring = Math.min(m.expiringSoon, m.active);
  const running = Math.max(0, m.active - expiring);
  const queued = Math.max(0, activeRaw - m.active);
  const known = new Set(["ACTIVE", "EXPIRED", "CANCELLED", "PENDING_PAYMENT", "PENDING_ISSUE"]);
  const other = Object.entries(m.byStatus).reduce((a, [k, v]) => (known.has(k) ? a : a + v), 0);
  const slices: StatusSlice[] = [
    { key: "running", label: "Đang chạy", value: running, hint: "Thẻ đang dùng, chưa sắp hết hạn" },
    { key: "expiring", label: "Sắp hết hạn", value: expiring, hint: `Đang chạy, hết hạn trong ${m.expiringSoonDays} ngày tới` },
    { key: "queued", label: "Chờ bắt đầu", value: queued, hint: "Đã thanh toán, chưa tới ngày bắt đầu (gia hạn xếp hàng)" },
    { key: "expired", label: "Hết hạn", value: m.byStatus.EXPIRED ?? 0, hint: "Thẻ đã hết hạn" },
    { key: "cancelled", label: "Đã huỷ", value: m.byStatus.CANCELLED ?? 0, hint: "Thẻ đã huỷ" },
    { key: "pending", label: "Chờ thanh toán", value: m.byStatus.PENDING_PAYMENT ?? 0, hint: "Chưa thanh toán xong" },
    { key: "issue", label: "Có vấn đề thanh toán", value: m.byStatus.PENDING_ISSUE ?? 0, hint: "Đã thu tiền nhưng chưa phát hành thẻ" },
  ];
  if (other > 0) slices.push({ key: "other", label: "Khác", value: other, hint: "Trạng thái chưa có nhãn" });
  return slices;
}

export const sliceTotal = (slices: readonly StatusSlice[]): number => slices.reduce((a, s) => a + s.value, 0);

/** "62%" of the cards, one decimal below 10%; "" when there is nothing to divide. */
export function shareText(value: number, total: number): string {
  if (total <= 0) return "";
  const p = (value / total) * 100;
  return `${nfPct(p)}%`;
}

export function membershipSummary(slices: readonly StatusSlice[]): string {
  const total = sliceTotal(slices);
  if (total === 0) return "Chưa có thẻ hội viên nào.";
  const parts = slices.filter((s) => s.value > 0).map((s) => `${s.label} ${s.value}`);
  return `${total} thẻ: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sales (gross selling price of paid cards)
// ---------------------------------------------------------------------------------------------------------------------

export const SALES_RANGES = [30, 90, 180] as const;
export type SalesRange = (typeof SALES_RANGES)[number];
export type Granularity = "day" | "week";

/** Weekly bars exist for the longer ranges only; 30 days stay per day. */
export function granularityOptions(days: number): Granularity[] {
  return days > 30 ? ["day", "week"] : ["day"];
}
/** The default view: days up to 90, weeks beyond (180 day-bars would be unreadable on a phone). */
export function defaultGranularity(days: number): Granularity {
  return days > 90 ? "week" : "day";
}
export function resolveGranularity(days: number, chosen: Granularity | null): Granularity {
  const options = granularityOptions(days);
  return chosen && options.includes(chosen) ? chosen : defaultGranularity(days);
}

/** A paid card: ACTIVE or EXPIRED. Same rule as `recognizedSales` (utils/financeExport). */
export const isPaidSale = (r: Pick<SalesView, "status">): boolean => r.status === "ACTIVE" || r.status === "EXPIRED";

export interface RevenuePoint {
  /** The day, or the Monday of the week. */
  key: string;
  label: string;
  /** The first and last day this bar covers (a week reads "17/11 - 23/11"). */
  from: string;
  to: string;
  total: number;
  count: number;
  /** A week that has not ended yet (or was cut at the start of the range). */
  partial: boolean;
}

export interface RevenueSeries {
  from: string;
  to: string;
  granularity: Granularity;
  points: RevenuePoint[];
  total: number;
  count: number;
  /** Paid cards with no usable sale date: they are not on the chart and the page says how many. */
  undated: number;
}

/** The first and last day a sales range draws. Weekly bars start on the Monday of the first day so every bar is a whole week. */
export function salesWindow(todayVn: string, days: number, granularity: Granularity): DateRange {
  const from = shiftDate(todayVn, -(days - 1));
  return { from: granularity === "week" ? weekStartOf(from) : from, to: todayVn };
}

export function revenueSeries(rows: readonly SalesView[], todayVn: string, days: number, granularity: Granularity): RevenueSeries {
  const win = salesWindow(todayVn, days, granularity);
  const keyOf = (date: string) => (granularity === "week" ? weekStartOf(date) : date);
  const order = granularity === "week" ? [...new Set(datesBetween(win.from, win.to).map(keyOf))] : datesBetween(win.from, win.to);
  const points = new Map<string, RevenuePoint>();
  for (const key of order) {
    const to = granularity === "week" ? shiftDate(key, 6) : key;
    points.set(key, {
      key,
      label: granularity === "week" ? dayMonth(key) : days > 7 ? dayMonth(key) : dayWithWeekday(key),
      from: key,
      to,
      total: 0,
      count: 0,
      partial: granularity === "week" && to > todayVn,
    });
  }
  let undated = 0;
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (!isPaidSale(r)) continue;
    const date = vnDateOfIso(r.createdAt);
    if (!date) {
      undated += 1;
      continue;
    }
    if (date < win.from || date > win.to) continue;
    const p = points.get(keyOf(date));
    if (!p) continue;
    p.total += r.priceAtPurchase;
    p.count += 1;
    total += r.priceAtPurchase;
    count += 1;
  }
  return { from: win.from, to: win.to, granularity, points: order.map((k) => points.get(k)!), total, count, undated };
}

export interface PlanSlice {
  /** null on the merged "other plans" row. */
  planId: string | null;
  name: string;
  total: number;
  count: number;
}

/**
 * Paid cards of the window grouped by plan, biggest first; plans beyond `limit` are merged into one "Các gói còn lại" row (their real
 * sum, never dropped). `nameOf` names a plan id; a plan with no card in the window is not listed.
 */
export function salesByPlan(rows: readonly SalesView[], win: DateRange, nameOf: (planId: string) => string, limit = 6): PlanSlice[] {
  const by = new Map<string, PlanSlice>();
  for (const r of rows) {
    if (!isPaidSale(r)) continue;
    const date = vnDateOfIso(r.createdAt);
    if (!date || date < win.from || date > win.to) continue;
    const cur = by.get(r.planId) ?? { planId: r.planId, name: nameOf(r.planId), total: 0, count: 0 };
    cur.total += r.priceAtPurchase;
    cur.count += 1;
    by.set(r.planId, cur);
  }
  const sorted = [...by.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name, "vi"));
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  return [...head, { planId: null, name: `Các gói còn lại (${rest.length})`, total: rest.reduce((a, s) => a + s.total, 0), count: rest.reduce((a, s) => a + s.count, 0) }];
}

/** "1,2 tr" / "850 k" / "2,5 tỷ": the axis tick of a money chart. Exact amounts always come with formatVND. */
export function compactVnd(n: number): string {
  const abs = Math.abs(n);
  const f = (v: number, unit: string) => `${(Math.round(v * 10) / 10).toString().replace(".", ",")} ${unit}`;
  if (abs >= 1e9) return f(n / 1e9, "tỷ");
  if (abs >= 1e6) return f(n / 1e6, "tr");
  if (abs >= 1e3) return f(n / 1e3, "k");
  return String(n);
}

export const SALES_CHART_NOTE = "Doanh số gộp: giá bán của thẻ đã thanh toán, chưa trừ phần nền tảng và hoa hồng PT. Không phải thu nhập của phòng tập (thu nhập nằm trong tab Ví).";

export function revenueSummary(s: RevenueSeries, fmt: (n: number) => string): string {
  const unit = s.granularity === "week" ? "tuần" : "ngày";
  const range = `${dayMonth(s.from)} đến ${dayMonth(s.to)}`;
  if (s.count === 0) return `Chưa bán thẻ nào trong khoảng ${range}.`;
  let best: RevenuePoint | null = null;
  for (const p of s.points) if (p.total > 0 && (best === null || p.total > best.total)) best = p;
  const top = best ? ` ${unit === "tuần" ? `Tuần bắt đầu ${dayMonth(best.from)}` : `Ngày ${dayMonth(best.from)}`} cao nhất với ${fmt(best.total)}.` : "";
  return `Doanh số gộp ${fmt(s.total)} từ ${s.count} thẻ, ${range}, theo ${unit}.${top}`;
}
