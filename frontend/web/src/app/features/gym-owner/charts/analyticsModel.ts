/**
 * Charts of the Gym Owner, phase 2: data of GET /owner/gyms/:gymId/analytics?from&to (max 92 inclusive Vietnam days) - pure functions,
 * no React, no network. Phase 1 already draws sales from the memberships list, so the `sales` section is NOT used here.
 *
 *  - Hôm nay / Quầy lễ tân: "Giờ cao điểm" heatmap (weekday x hour) and the renewal card (settled rate, new vs returning).
 *  - Tài chính / Doanh số: "Thực nhận" = the gym wallet's ledger (what the gym really receives), next to the gross sales chart.
 *
 * Honesty rules (same as chartsModel.ts):
 *  - a section the server sent as `null` = the role may not read it: draw NOTHING (not an error, not a zero);
 *  - `unavailable: ["netIncome"]` = the role may read it but payment-service failed: an error state with retry, never 0;
 *  - a malformed answer (wrong range, wrong matrix size, missing day) is an error, never a half-drawn chart;
 *  - a total over several branches exists only when EVERY counted branch has loaded;
 *  - all days are Vietnam calendar days (UTC+7).
 */
import { dayMonth, datesBetween, daysInclusive, shareText, weekStartOf, shiftDate, type DateRange } from "./chartsModel";

// ---------------------------------------------------------------------------------------------------------------------
// Shapes (only what the screens read)
// ---------------------------------------------------------------------------------------------------------------------

export interface HeatPeak {
  /** 1 = Monday .. 7 = Sunday. */
  weekday: number;
  hour: number;
  count: number;
}

export interface Heatmap {
  total: number;
  /** matrix[weekday - 1][hour]: rows Monday..Sunday, 24 columns, Vietnam time. */
  matrix: number[][];
  byHour: number[];
  byWeekday: number[];
  peak: HeatPeak | null;
}

export interface NewReturningDay {
  date: string;
  new: number;
  returning: number;
}

export interface Renewal {
  windowDays: number;
  ended: number;
  renewed: number;
  renewedSameBranch: number;
  settled: number;
  settledRenewed: number;
  open: number;
  rate: number | null;
  settledRate: number | null;
  newMembers: number;
  returningMembers: number;
  daily: NewReturningDay[];
}

export interface IncomeParts {
  sales: number;
  grossPrice: number;
  gymShare: number;
  feeAtSale: number;
  referralCommission: number;
  adjustments: number;
  net: number;
}
export interface IncomeDay extends IncomeParts {
  date: string;
}

export interface NetIncome {
  walletFound: boolean;
  totals: IncomeParts;
  daily: IncomeDay[];
}

export interface Analytics {
  gymId: string;
  from: string;
  to: string;
  /** null = this role may not read the section. */
  heatmap: Heatmap | null;
  renewal: Renewal | null;
  netIncome: NetIncome | null;
  /** The role may read net income but payment-service could not answer. */
  netIncomeUnavailable: boolean;
}

/** One branch, one range: `error` also covers an answer whose shape is not the one asked for. */
export type AnalyticsState = { state: "loading" } | { state: "error" } | { state: "ok"; data: Analytics };

// ---------------------------------------------------------------------------------------------------------------------
// Parsing and validating the server answer
// ---------------------------------------------------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCountArray = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(isCount);

function parseHeatmap(v: unknown): Heatmap | "bad" | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !isCount(v.total) || !Array.isArray(v.matrix) || v.matrix.length !== 7 || !v.matrix.every((r) => isCountArray(r, 24))) return "bad";
  if (!isCountArray(v.byHour, 24) || !isCountArray(v.byWeekday, 7)) return "bad";
  let peak: HeatPeak | null = null;
  if (v.peak !== null && v.peak !== undefined) {
    const p = v.peak as Record<string, unknown>;
    if (!isObj(p) || !isNum(p.weekday) || p.weekday < 1 || p.weekday > 7 || !isNum(p.hour) || p.hour < 0 || p.hour > 23 || !isCount(p.count)) return "bad";
    peak = { weekday: p.weekday, hour: p.hour, count: p.count };
  }
  return { total: v.total, matrix: v.matrix as number[][], byHour: v.byHour, byWeekday: v.byWeekday, peak };
}

function parseRenewal(v: unknown, range: DateRange): Renewal | "bad" | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return "bad";
  const keys = ["windowDays", "ended", "renewed", "renewedSameBranch", "settled", "settledRenewed", "open"] as const;
  for (const k of keys) if (!isCount(v[k])) return "bad";
  const rateOk = (r: unknown) => r === null || (isNum(r) && r >= 0 && r <= 1);
  if (!rateOk(v.rate) || !rateOk(v.settledRate)) return "bad";
  const nvr = v.newVsReturning as Record<string, unknown> | undefined;
  if (!isObj(nvr) || !isCount(nvr.newMembers) || !isCount(nvr.returningMembers) || !Array.isArray(nvr.daily)) return "bad";
  const want = datesBetween(range.from, range.to);
  if (nvr.daily.length !== want.length) return "bad";
  const daily: NewReturningDay[] = [];
  for (let i = 0; i < want.length; i++) {
    const d = nvr.daily[i] as Record<string, unknown>;
    if (!isObj(d) || d.date !== want[i] || !isCount(d.new) || !isCount(d.returning)) return "bad";
    daily.push({ date: want[i], new: d.new, returning: d.returning });
  }
  return {
    windowDays: v.windowDays as number,
    ended: v.ended as number,
    renewed: v.renewed as number,
    renewedSameBranch: v.renewedSameBranch as number,
    settled: v.settled as number,
    settledRenewed: v.settledRenewed as number,
    open: v.open as number,
    rate: v.rate as number | null,
    settledRate: v.settledRate as number | null,
    newMembers: nvr.newMembers,
    returningMembers: nvr.returningMembers,
    daily,
  };
}

const INCOME_KEYS = ["sales", "grossPrice", "gymShare", "feeAtSale", "referralCommission", "adjustments", "net"] as const;

function parseParts(v: unknown): IncomeParts | null {
  if (!isObj(v)) return null;
  for (const k of INCOME_KEYS) if (!isNum(v[k])) return null;
  return Object.fromEntries(INCOME_KEYS.map((k) => [k, v[k] as number])) as unknown as IncomeParts;
}

function parseNetIncome(v: unknown, range: DateRange): NetIncome | "bad" | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || typeof v.walletFound !== "boolean" || !Array.isArray(v.daily)) return "bad";
  const totals = parseParts(v.totals);
  if (!totals) return "bad";
  const want = datesBetween(range.from, range.to);
  if (v.daily.length !== want.length) return "bad";
  const daily: IncomeDay[] = [];
  for (let i = 0; i < want.length; i++) {
    const d = v.daily[i] as Record<string, unknown>;
    const p = parseParts(d);
    if (!p || d.date !== want[i]) return "bad";
    daily.push({ date: want[i], ...p });
  }
  return { walletFound: v.walletFound, totals, daily };
}

/**
 * Validates one /analytics answer for the branch and range that were asked. Returns null when it is not a valid answer (the caller
 * treats that as an error); a section the server sent as null (or left out) stays null = hidden.
 */
export function parseAnalytics(raw: unknown, gymId: string, range: DateRange): Analytics | null {
  if (!isObj(raw) || raw.gymId !== gymId || raw.from !== range.from || raw.to !== range.to) return null;
  const heatmap = parseHeatmap(raw.heatmap);
  const renewal = parseRenewal(raw.renewal, range);
  const netIncome = parseNetIncome(raw.netIncome, range);
  if (heatmap === "bad" || renewal === "bad" || netIncome === "bad") return null;
  const unavailable = Array.isArray(raw.unavailable) ? raw.unavailable : [];
  return { gymId, from: range.from, to: range.to, heatmap, renewal, netIncome, netIncomeUnavailable: unavailable.includes("netIncome") };
}

/** A query's raw state + data into an AnalyticsState (shape checked against the branch and range that were asked). */
export function analyticsStateOf(q: { data?: unknown; isError: boolean }, gymId: string, range: DateRange): AnalyticsState {
  if (q.data !== undefined) {
    const data = parseAnalytics(q.data, gymId, range);
    return data ? { state: "ok", data } : { state: "error" };
  }
  return q.isError ? { state: "error" } : { state: "loading" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generic "all branches" gate: which branches count for a section, who failed, who is still loading
// ---------------------------------------------------------------------------------------------------------------------

export interface SectionAgg<T> {
  /** false = no branch in view lets this role read the section: draw nothing at all. */
  visible: boolean;
  /** Branches that count (a branch whose section is null is not one of them). */
  total: number;
  loaded: number;
  failedGymIds: string[];
  loading: boolean;
  /** Every counted branch has answered: only then is there a sum. */
  complete: boolean;
  /** Per-branch values of the counted branches, in branch order; null unless `complete`. */
  parts: T[] | null;
}

function aggregate<T>(
  states: readonly { gymId: string; s: AnalyticsState }[],
  pick: (a: Analytics) => T | null,
  /** Extra "the role may read it but the server could not produce it" (net income). */
  unavailable?: (a: Analytics) => boolean,
): SectionAgg<T> {
  const counted = states.filter((x) => !(x.s.state === "ok" && pick(x.s.data) === null && !(unavailable && unavailable(x.s.data))));
  if (counted.length === 0) return { visible: false, total: 0, loaded: 0, failedGymIds: [], loading: false, complete: false, parts: null };
  const failed = counted.filter((x) => x.s.state === "error" || (x.s.state === "ok" && unavailable?.(x.s.data))).map((x) => x.gymId);
  const good = counted.filter((x) => x.s.state === "ok" && !(unavailable?.(x.s.data)));
  const loading = failed.length === 0 && good.length < counted.length;
  const complete = good.length === counted.length;
  const parts = complete ? good.map((x) => pick((x.s as { data: Analytics }).data) as T) : null;
  return { visible: true, total: counted.length, loaded: good.length, failedGymIds: failed, loading, complete, parts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Heatmap "Giờ cao điểm"
// ---------------------------------------------------------------------------------------------------------------------

export const WEEKDAY_LONG = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"];
export const WEEKDAY_SHORT_MON = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export const HEAT_RANGES = [7, 30, 90] as const;
export type HeatRange = (typeof HEAT_RANGES)[number];

/** Adds the matrices of several branches (the caller guarantees every branch has loaded) and recomputes the totals and the peak. */
export function sumHeatmaps(list: readonly Heatmap[]): Heatmap {
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const h of list) for (let w = 0; w < 7; w++) for (let c = 0; c < 24; c++) matrix[w][c] += h.matrix[w][c];
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  let total = 0;
  let peak: HeatPeak | null = null;
  for (let w = 0; w < 7; w++) {
    for (let c = 0; c < 24; c++) {
      const n = matrix[w][c];
      byHour[c] += n;
      byWeekday[w] += n;
      total += n;
      // First maximum in Monday-first, hour-ascending order: the same tie-break as the server.
      if (n > 0 && (!peak || n > peak.count)) peak = { weekday: w + 1, hour: c, count: n };
    }
  }
  return { total, matrix, byHour, byWeekday, peak };
}

export interface HeatAgg extends Omit<SectionAgg<Heatmap>, "parts"> {
  /** Summed over the counted branches; null unless `complete`. */
  heat: Heatmap | null;
}

export function aggregateHeatmaps(states: readonly { gymId: string; s: AnalyticsState }[]): HeatAgg {
  const { parts, ...rest } = aggregate(states, (a) => a.heatmap);
  return { ...rest, heat: parts ? sumHeatmaps(parts) : null };
}

/** The hours the grid draws: 5:00-23:00 (hours 5..22) by default; widened - never cropped - when check-ins fall outside it. */
export const HEAT_DEFAULT_WINDOW = { from: 5, to: 22 } as const;

export function compactHourWindow(byHour: readonly number[]): { from: number; to: number } {
  let from: number = HEAT_DEFAULT_WINDOW.from;
  let to: number = HEAT_DEFAULT_WINDOW.to;
  byHour.forEach((n, h) => {
    if (n > 0) {
      if (h < from) from = h;
      if (h > to) to = h;
    }
  });
  return { from, to };
}

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
export const hourRangeLabel = (h: number): string => `${hourLabel(h)}-${hourLabel((h + 1) % 24)}`;

/** "Đông nhất: Thứ ba 19:00-20:00, 24 lượt"; the honest sentence when there is no check-in at all. */
export function peakText(peak: HeatPeak | null): string {
  if (!peak) return "Chưa có lượt check-in nào trong khoảng này.";
  return `Đông nhất: ${WEEKDAY_LONG[peak.weekday - 1]} ${hourRangeLabel(peak.hour)}, ${peak.count} lượt`;
}

/** First maximum of a series; null when every value is 0. */
function topIndex(values: readonly number[]): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (best === null || v > values[best])) best = i;
  });
  return best;
}

const nfv = new Intl.NumberFormat("vi-VN");

export function heatmapSummary(h: Heatmap, days: number): string {
  if (h.total === 0) return `Chưa có lượt check-in nào trong ${days} ngày qua.`;
  const d = topIndex(h.byWeekday);
  const hr = topIndex(h.byHour);
  const extra = d !== null && hr !== null ? ` Ngày đông nhất trong tuần: ${WEEKDAY_LONG[d]} (${nfv.format(h.byWeekday[d])} lượt). Giờ đông nhất: ${hourRangeLabel(hr)} (${nfv.format(h.byHour[hr])} lượt).` : "";
  return `${nfv.format(h.total)} lượt check-in trong ${days} ngày qua. ${peakText(h.peak)}.${extra}`;
}

/** 0..1 intensity of a cell against the busiest cell; 0 for an empty cell. */
export function heatLevel(count: number, max: number): number {
  return count > 0 && max > 0 ? count / max : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Buckets: per day, or per Monday-week (clipped to the range, partial flagged)
// ---------------------------------------------------------------------------------------------------------------------

export type Gran = "day" | "week";

export interface Bucket {
  key: string;
  label: string;
  /** First and last day this bucket covers inside the range. */
  from: string;
  to: string;
  /** A week cut by the start of the range or not over yet: its figure is smaller than a whole week. */
  partial: boolean;
}

export function bucketsOf(range: DateRange, gran: Gran): Bucket[] {
  const dates = datesBetween(range.from, range.to);
  if (gran === "day") return dates.map((d) => ({ key: d, label: dayMonth(d), from: d, to: d, partial: false }));
  const out: Bucket[] = [];
  for (const d of dates) {
    const key = weekStartOf(d);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.to = d;
    } else {
      out.push({ key, label: dayMonth(d), from: d, to: d, partial: false });
    }
  }
  return out.map((b) => ({ ...b, label: dayMonth(b.from), partial: b.from !== b.key || shiftDate(b.key, 6) > range.to }));
}

/** Folds a per-day series into buckets; `add` accumulates one day into its bucket. */
function fold<D extends { date: string }, V>(daily: readonly D[], range: DateRange, gran: Gran, zero: () => V, add: (acc: V, d: D) => void): (Bucket & { v: V })[] {
  const buckets = bucketsOf(range, gran).map((b) => ({ ...b, v: zero() }));
  const by = new Map(buckets.map((b) => [b.key, b]));
  for (const d of daily) {
    const b = by.get(gran === "week" ? weekStartOf(d.date) : d.date);
    if (b) add(b.v, d);
  }
  return buckets;
}

// ---------------------------------------------------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------------------------------------------------

const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null);

export function sumRenewals(list: readonly Renewal[], range: DateRange): Renewal {
  const sum = (pick: (r: Renewal) => number) => list.reduce((a, r) => a + pick(r), 0);
  const daily: NewReturningDay[] = datesBetween(range.from, range.to).map((date, i) => ({
    date,
    new: list.reduce((a, r) => a + (r.daily[i]?.new ?? 0), 0),
    returning: list.reduce((a, r) => a + (r.daily[i]?.returning ?? 0), 0),
  }));
  const ended = sum((r) => r.ended);
  const renewed = sum((r) => r.renewed);
  const settled = sum((r) => r.settled);
  const settledRenewed = sum((r) => r.settledRenewed);
  return {
    windowDays: list[0]?.windowDays ?? 30,
    ended,
    renewed,
    renewedSameBranch: sum((r) => r.renewedSameBranch),
    settled,
    settledRenewed,
    open: sum((r) => r.open),
    rate: ratio(renewed, ended),
    settledRate: ratio(settledRenewed, settled),
    newMembers: sum((r) => r.newMembers),
    returningMembers: sum((r) => r.returningMembers),
    daily,
  };
}

export interface RenewalAgg extends Omit<SectionAgg<Renewal>, "parts"> {
  renewal: Renewal | null;
}

export function aggregateRenewals(states: readonly { gymId: string; s: AnalyticsState }[], range: DateRange): RenewalAgg {
  const { parts, ...rest } = aggregate(states, (a) => a.renewal);
  return { ...rest, renewal: parts ? sumRenewals(parts, range) : null };
}

/** "62%" from a 0..1 rate; "-" when the rate is not defined (nothing to divide). */
export function rateText(rate: number | null): string {
  return rate === null ? "-" : shareText(rate, 1);
}

/** The headline: the settled rate in words that a gym owner reads without statistics. */
export function renewalHeadline(r: Renewal): { value: string; text: string } {
  if (r.settledRate !== null) {
    return { value: rateText(r.settledRate), text: `Trong ${r.settled} thẻ đã hết hạn đủ ${r.windowDays} ngày, ${rateText(r.settledRate)} khách đã gia hạn (${r.settledRenewed}/${r.settled}).` };
  }
  if (r.ended === 0) return { value: "-", text: "Chưa có thẻ nào hết hạn trong khoảng này nên chưa có tỷ lệ gia hạn." };
  return {
    value: "-",
    text: `Chưa có thẻ nào hết hạn đủ ${r.windowDays} ngày trong khoảng này nên chưa chốt được tỷ lệ. Chọn khoảng dài hơn, hoặc xem tỷ lệ tạm tính bên dưới.`,
  };
}

/** The provisional rate (all ended cards, including those still inside the renewal window); "" when nothing ended. */
export function provisionalRateText(r: Renewal): string {
  if (r.rate === null) return "";
  return `Tỷ lệ tạm tính: ${rateText(r.rate)} (${r.renewed}/${r.ended} thẻ đã hết hạn). Số này thường cao hơn thực tế vì thẻ mới hết hạn còn đang trong ${r.windowDays} ngày để gia hạn.`;
}

export const RENEWAL_SCOPE_NOTE = "Khách mua thẻ mới ở bất kỳ chi nhánh nào của thương hiệu trong 30 ngày sau khi thẻ hết hạn đều tính là đã gia hạn. Chỉ tính thẻ đã thanh toán.";

export interface NvrPoint extends Bucket {
  new: number;
  returning: number;
}

export function newReturningSeries(daily: readonly NewReturningDay[], range: DateRange, gran: Gran): NvrPoint[] {
  return fold(daily, range, gran, () => ({ new: 0, returning: 0 }), (acc, d) => {
    acc.new += d.new;
    acc.returning += d.returning;
  }).map(({ v, ...b }) => ({ ...b, new: v.new, returning: v.returning }));
}

export function renewalSummary(r: Renewal, range: DateRange): string {
  const span = `${dayMonth(range.from)} đến ${dayMonth(range.to)}`;
  const head = renewalHeadline(r).text;
  const nvr = r.newMembers + r.returningMembers;
  const tail = nvr === 0 ? ` Chưa bán thẻ nào trong ${span}.` : ` Trong ${span} bán ${nvr} thẻ: ${r.newMembers} khách mới, ${r.returningMembers} khách quay lại.`;
  return `${head}${tail}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Net income ("Thực nhận")
// ---------------------------------------------------------------------------------------------------------------------

const zeroParts = (): IncomeParts => ({ sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 });
const r2 = (v: number) => Math.round(v * 100) / 100;

function addParts(acc: IncomeParts, p: IncomeParts) {
  for (const k of INCOME_KEYS) acc[k] = r2(acc[k] + p[k]);
}

/** Adds branches (every counted branch loaded). A branch without a wallet contributes zeros (it really received nothing). */
export function sumNetIncomes(list: readonly NetIncome[], range: DateRange): NetIncome {
  const totals = zeroParts();
  const daily: IncomeDay[] = datesBetween(range.from, range.to).map((date) => ({ date, ...zeroParts() }));
  for (const n of list) {
    addParts(totals, n.totals);
    n.daily.forEach((d, i) => addParts(daily[i], d));
  }
  return { walletFound: list.some((n) => n.walletFound), totals, daily };
}

export interface NetAgg extends Omit<SectionAgg<NetIncome>, "parts"> {
  income: NetIncome | null;
  /** Counted branches that have no wallet yet (their share of the sum is a true 0, said in words). */
  noWalletGymIds: string[];
  /** Branches whose payment ledger could not be read: an error, never 0. */
  unavailableGymIds: string[];
}

export function aggregateNetIncome(states: readonly { gymId: string; s: AnalyticsState }[], range: DateRange): NetAgg {
  const { parts, ...rest } = aggregate(states, (a) => a.netIncome, (a) => a.netIncomeUnavailable);
  const unavailableGymIds = states.filter((x) => x.s.state === "ok" && x.s.data.netIncomeUnavailable).map((x) => x.gymId);
  const noWalletGymIds = states.filter((x) => x.s.state === "ok" && x.s.data.netIncome && !x.s.data.netIncome.walletFound).map((x) => x.gymId);
  return { ...rest, income: parts ? sumNetIncomes(parts, range) : null, noWalletGymIds, unavailableGymIds };
}

export interface NetPoint extends Bucket, IncomeParts {}

/** Net income per day, or per week (Monday-first, cut at the range ends and flagged `partial`). */
export function netIncomeSeries(daily: readonly IncomeDay[], range: DateRange, gran: Gran): NetPoint[] {
  return fold(daily, range, gran, zeroParts, (acc, d) => addParts(acc, d)).map(({ v, ...b }) => ({ ...b, ...v }));
}

/** "Giá bán -> trừ phí nền tảng -> phần của phòng tập -> trừ hoa hồng PT -> điều chỉnh -> thực nhận": the rows of the breakdown. */
export interface BreakdownRow {
  key: "grossPrice" | "feeAtSale" | "gymShare" | "referralCommission" | "adjustments" | "net";
  label: string;
  hint: string;
  /** Signed: a deduction is negative. */
  value: number;
}

export function netBreakdown(t: IncomeParts): BreakdownRow[] {
  return [
    { key: "grossPrice", label: "Giá khách trả", hint: `${t.sales} thẻ ghi nhận trong sổ ví`, value: t.grossPrice },
    { key: "feeAtSale", label: "Phí nền tảng", hint: "Phần nền tảng giữ lại lúc bán", value: 0 - t.feeAtSale },
    { key: "gymShare", label: "Phần của phòng tập", hint: "Giá khách trả trừ phí nền tảng", value: t.gymShare },
    { key: "referralCommission", label: "Hoa hồng PT giới thiệu", hint: "Phần chuyển cho PT giới thiệu khách", value: 0 - t.referralCommission },
    { key: "adjustments", label: "Điều chỉnh", hint: "Hoàn tiền, thu hồi, bù khiếu nại; âm là phòng tập phải trả lại", value: t.adjustments },
    { key: "net", label: "Thực nhận", hint: "Phần của phòng tập trừ hoa hồng PT, cộng điều chỉnh", value: t.net },
  ];
}

export const NET_CHART_NOTE =
  "Số tiền phòng tập thực sự nhận được sau phí nền tảng và hoa hồng PT, lấy từ sổ ví thanh toán. Khác với doanh số gộp ở trên (giá bán của thẻ).";
export const NET_DATE_NOTE = "Thực nhận tính theo ngày ghi sổ ví, doanh số gộp tính theo ngày mua thẻ nên hai biểu đồ có thể lệch ngày.";

export function netSummary(t: IncomeParts, range: DateRange, fmt: (n: number) => string, points: readonly NetPoint[], gran: Gran): string {
  const span = `${dayMonth(range.from)} đến ${dayMonth(range.to)}`;
  if (t.sales === 0 && t.net === 0 && t.adjustments === 0) return `Chưa có khoản thực nhận nào từ thẻ hội viên trong khoảng ${span}.`;
  let best: NetPoint | null = null;
  for (const p of points) if (p.net > 0 && (best === null || p.net > best.net)) best = p;
  const unit = gran === "week" ? "Tuần bắt đầu" : "Ngày";
  const top = best ? ` ${unit} ${dayMonth(best.from)} cao nhất với ${fmt(best.net)}.` : "";
  return `Thực nhận ${fmt(t.net)} trong ${span}: phần của phòng tập ${fmt(t.gymShare)}, trừ hoa hồng PT ${fmt(t.referralCommission)}, điều chỉnh ${fmt(t.adjustments)}.${top}`;
}

export const NET_RANGES = HEAT_RANGES;
export type NetRange = (typeof NET_RANGES)[number];

/** The server refuses a longer range. */
export const ANALYTICS_MAX_DAYS = 92;

/** The last `days` Vietnam days ending today, as one /analytics range (never over the 92-day cap). */
export function analyticsRange(todayVn: string, days: number): DateRange {
  const n = Math.min(Math.max(1, days), ANALYTICS_MAX_DAYS);
  return { from: shiftDate(todayVn, -(n - 1)), to: todayVn };
}

export { daysInclusive };
