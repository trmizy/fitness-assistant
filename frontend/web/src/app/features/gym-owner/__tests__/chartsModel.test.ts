/**
 * TEST FIXTURE - Gym Owner charts model (pure functions, fake API answers; no browser, no backend).
 * Run: node ../../node_modules/tsx/dist/cli.mjs --test src/app/features/gym-owner/__tests__/chartsModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMemberships,
  branchCompareRows,
  buildCheckinTrend,
  chartAccess,
  checkinSummary,
  compactVnd,
  compareTotals,
  comparisonText,
  datesBetween,
  defaultGranularity,
  granularityOptions,
  membershipSlices,
  periodRanges,
  rangeStateOf,
  resolveGranularity,
  revenueSeries,
  salesByPlan,
  salesWindow,
  shiftDate,
  shareText,
  sliceTotal,
  vnDateOf,
  vnDateOfIso,
  weekStartOf,
  type BranchRange,
  type DayCount,
  type RangeState,
} from "../charts/chartsModel";
import type { SalesView } from "../finance/financeModel";
import type { StatsState } from "../stats/gymStats";
import type { GymStats } from "../../../types";
import { canOf } from "./permFixture";

const range = (from: string, to: string) => ({ from, to });
const days = (from: string, counts: number[]): DayCount[] => counts.map((count, i) => ({ date: shiftDate(from, i), count }));
const okRange = (from: string, counts: number[]): RangeState => ({ state: "ok", daily: days(from, counts) });

describe("Vietnam day boundaries", () => {
  it("23:59 UTC+7 and 00:00 UTC+7 fall on different days, whatever the machine zone", () => {
    // 2026-11-22 23:59:59 in Ho Chi Minh = 16:59:59Z; one second later it is 23/11.
    assert.equal(vnDateOf(Date.UTC(2026, 10, 22, 16, 59, 59)), "2026-11-22");
    assert.equal(vnDateOf(Date.UTC(2026, 10, 22, 17, 0, 0)), "2026-11-23");
  });
  it("a 17:00Z sale belongs to the NEXT Vietnam day", () => {
    assert.equal(vnDateOfIso("2026-11-22T17:30:00.000Z"), "2026-11-23");
    assert.equal(vnDateOfIso("2026-11-22T16:30:00.000Z"), "2026-11-22");
  });
  it("month and year rollover", () => {
    assert.equal(vnDateOfIso("2026-12-31T20:00:00Z"), "2027-01-01");
  });
  it("missing / junk time is null, never today", () => {
    assert.equal(vnDateOfIso(null), null);
    assert.equal(vnDateOfIso(""), null);
    assert.equal(vnDateOfIso("not a date"), null);
  });
  it("datesBetween is inclusive and crosses a month end", () => {
    assert.deepEqual(datesBetween("2026-11-29", "2026-12-02"), ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    assert.deepEqual(datesBetween("2026-11-22", "2026-11-22"), ["2026-11-22"]);
    assert.deepEqual(datesBetween("2026-11-23", "2026-11-22"), []);
  });
});

describe("period comparison", () => {
  it("periodRanges gives the equal, contiguous, non-overlapping previous period", () => {
    const r = periodRanges("2026-11-22", 30);
    assert.deepEqual(r.current, range("2026-10-24", "2026-11-22"));
    assert.deepEqual(r.previous, range("2026-09-24", "2026-10-23"));
    for (const d of [7, 30, 90]) {
      const p = periodRanges("2026-11-22", d);
      assert.equal(datesBetween(p.current.from, p.current.to).length, d);
      assert.equal(datesBetween(p.previous.from, p.previous.to).length, d);
      // contiguous: the day after previous.to is current.from
      assert.equal(datesBetween(p.previous.to, p.current.from).length, 2);
    }
  });
  it("each call of a 90-day comparison stays inside the server's 92-day limit", () => {
    const p = periodRanges("2026-11-22", 90);
    assert.ok(datesBetween(p.current.from, p.current.to).length <= 92);
    assert.ok(datesBetween(p.previous.from, p.previous.to).length <= 92);
  });
  it("+12% / -8% / unchanged", () => {
    assert.equal(comparisonText(compareTotals(112, 100), 30), "+12% so với 30 ngày trước");
    assert.equal(comparisonText(compareTotals(92, 100), 30), "-8% so với 30 ngày trước");
    assert.equal(comparisonText(compareTotals(100, 100), 7), "Không đổi so với 7 ngày trước");
  });
  it("small changes keep one decimal with a comma; a tiny one never reads +0%", () => {
    assert.equal(comparisonText(compareTotals(1045, 1000), 30), "+4,5% so với 30 ngày trước");
    assert.equal(comparisonText(compareTotals(10001, 10000), 30), "+0,1% so với 30 ngày trước");
    assert.equal(comparisonText(compareTotals(9999, 10000), 30), "-0,1% so với 30 ngày trước");
  });
  it("a previous period of 0 has NO percentage (no invented baseline)", () => {
    const c = compareTotals(40, 0);
    assert.equal(c.kind, "no-baseline");
    assert.ok(!/%/.test(comparisonText(c, 30)));
    assert.equal(compareTotals(0, 0).kind, "both-zero");
  });
  it("a previous period that is loading / failed is not read as 0", () => {
    assert.equal(compareTotals(40, null, "loading").kind, "loading");
    assert.equal(compareTotals(40, null, "error").kind, "error");
    assert.equal(comparisonText({ kind: "error" }, 30), "Chưa tải được 30 ngày trước để so sánh");
  });
  it("a drop to zero is -100%", () => {
    assert.equal(comparisonText(compareTotals(0, 50), 30), "-100% so với 30 ngày trước");
  });
});

const statsOf = (over: Partial<GymStats>): StatsState => ({
  state: "ok",
  stats: { gymId: "g1", timeZone: "Asia/Ho_Chi_Minh", from: "2026-11-16", to: "2026-11-22", today: "2026-11-22", checkins: null, memberships: null, ...over },
});

describe("rangeStateOf validates the answer", () => {
  const r = range("2026-11-16", "2026-11-22");
  const daily = datesBetween(r.from, r.to).map((date, i) => ({ date, count: i }));
  it("an answer for the range is ok", () => {
    const s = rangeStateOf(statsOf({ checkins: { today: 6, total: 21, daily } }), r);
    assert.equal(s.state, "ok");
  });
  it("checkins null = hidden (the role may not read it), not an error and not zeros", () => {
    assert.deepEqual(rangeStateOf(statsOf({ checkins: null }), r), { state: "hidden" });
  });
  it("a missing day / wrong date / negative count = error, never a chart", () => {
    assert.equal(rangeStateOf(statsOf({ checkins: { today: 0, total: 0, daily: daily.slice(1) } }), r).state, "error");
    assert.equal(rangeStateOf(statsOf({ checkins: { today: 0, total: 0, daily: daily.map((d, i) => (i === 2 ? { ...d, date: "2026-01-01" } : d)) } }), r).state, "error");
    assert.equal(rangeStateOf(statsOf({ checkins: { today: 0, total: 0, daily: daily.map((d, i) => (i === 2 ? { ...d, count: -1 } : d)) } }), r).state, "error");
  });
  it("loading and error pass through", () => {
    assert.deepEqual(rangeStateOf({ state: "loading" }, r), { state: "loading" });
    assert.deepEqual(rangeStateOf({ state: "error" }, r), { state: "error" });
  });
});

describe("check-in trend (single branch and all branches)", () => {
  const cur = (counts: number[]) => okRange("2026-11-16", counts);
  const prev = (counts: number[]) => okRange("2026-11-09", counts);

  it("one branch: series, sum and comparison", () => {
    const t = buildCheckinTrend([{ gymId: "a", current: cur([1, 2, 3, 4, 5, 6, 7]), previous: prev([2, 2, 2, 2, 2, 2, 2]) }]);
    assert.equal(t.visible, true);
    assert.equal(t.sum, 28);
    assert.equal(t.comparison.kind, "change");
    assert.equal(comparisonText(t.comparison, 7), "+100% so với 7 ngày trước");
  });
  it("all branches: days are added up per day", () => {
    const t = buildCheckinTrend([
      { gymId: "a", current: cur([1, 1, 1, 1, 1, 1, 1]), previous: prev([0, 0, 0, 0, 0, 0, 1]) },
      { gymId: "b", current: cur([0, 2, 0, 2, 0, 2, 0]), previous: prev([1, 0, 0, 0, 0, 0, 0]) },
    ]);
    assert.deepEqual(t.daily?.map((d) => d.count), [1, 3, 1, 3, 1, 3, 1]);
    assert.equal(t.sum, 13);
    assert.equal(t.comparison.kind, "change");
    // previous total = 2, so +550%
    assert.equal(comparisonText(t.comparison, 7), "+550% so với 7 ngày trước");
  });
  it("all branches with one still loading: no sum at all", () => {
    const t = buildCheckinTrend([
      { gymId: "a", current: cur([1, 1, 1, 1, 1, 1, 1]), previous: prev([0, 0, 0, 0, 0, 0, 0]) },
      { gymId: "b", current: { state: "loading" }, previous: { state: "loading" } },
    ]);
    assert.equal(t.sum, null);
    assert.equal(t.daily, null);
    assert.equal(t.complete, false);
    assert.equal(t.loading, true);
    assert.equal(t.loaded, 1);
  });
  it("all branches with one failed: no sum, the failed branch is named", () => {
    const t = buildCheckinTrend([
      { gymId: "a", current: cur([1, 1, 1, 1, 1, 1, 1]), previous: prev([0, 0, 0, 0, 0, 0, 0]) },
      { gymId: "b", current: { state: "error" }, previous: { state: "ok", daily: days("2026-11-09", [0, 0, 0, 0, 0, 0, 0]) } },
    ]);
    assert.equal(t.sum, null);
    assert.deepEqual(t.failedGymIds, ["b"]);
    assert.equal(t.loading, false);
  });
  it("current ok but one branch's previous period failed: the total stays, the comparison is unavailable (not smaller)", () => {
    const t = buildCheckinTrend([
      { gymId: "a", current: cur([1, 1, 1, 1, 1, 1, 1]), previous: prev([5, 5, 5, 5, 5, 5, 5]) },
      { gymId: "b", current: cur([1, 1, 1, 1, 1, 1, 1]), previous: { state: "error" } },
    ]);
    assert.equal(t.sum, 14);
    assert.equal(t.comparison.kind, "error");
  });
  it("every branch hidden (role may not read check-ins) = nothing is drawn", () => {
    const t = buildCheckinTrend([{ gymId: "a", current: { state: "hidden" }, previous: { state: "hidden" } }]);
    assert.equal(t.visible, false);
  });
  it("a zero week is a real zero series (not hidden, not loading)", () => {
    const t = buildCheckinTrend([{ gymId: "a", current: cur([0, 0, 0, 0, 0, 0, 0]), previous: prev([0, 0, 0, 0, 0, 0, 0]) }]);
    assert.equal(t.visible, true);
    assert.equal(t.sum, 0);
    assert.equal(t.comparison.kind, "both-zero");
    assert.match(checkinSummary(t.daily!, 7), /Chưa có lượt check-in nào/);
  });
  it("branch compare rows: own total and own change per branch", () => {
    const branches: BranchRange[] = [
      { gymId: "a", current: cur([2, 2, 2, 2, 2, 2, 2]), previous: prev([1, 1, 1, 1, 1, 1, 1]) },
      { gymId: "b", current: { state: "error" }, previous: { state: "loading" } },
      { gymId: "c", current: cur([0, 0, 0, 0, 0, 0, 3]), previous: prev([0, 0, 0, 0, 0, 0, 0]) },
    ];
    const rows = branchCompareRows(branches);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].current, 14);
    assert.equal(rows[0].comparison.kind, "change");
    assert.equal(rows[1].state, "error");
    assert.equal(rows[1].current, null);
    assert.equal(rows[2].comparison.kind, "no-baseline");
  });
  it("checkinSummary names the busiest day", () => {
    const s = checkinSummary(days("2026-11-16", [1, 2, 9, 4, 0, 0, 1]), 7);
    assert.match(s, /17 lượt check-in trong 7 ngày qua \(16\/11 đến 22\/11\)/);
    assert.match(s, /Ngày đông nhất 18\/11 với 9 lượt/);
  });
});

describe("membership status split", () => {
  const block = (over: Record<string, number> = {}, active = 10, expiringSoon = 3) => ({
    active,
    expiringSoon,
    expiringSoonDays: 7,
    byStatus: { ACTIVE: 12, EXPIRED: 20, CANCELLED: 4, PENDING_PAYMENT: 2, PENDING_ISSUE: 1, ...over },
  });
  it("slices are exclusive and add up to every card the server counted", () => {
    const b = block();
    const slices = membershipSlices(b);
    const get = (k: string) => slices.find((s) => s.key === k)!.value;
    assert.equal(get("running"), 7);
    assert.equal(get("expiring"), 3);
    assert.equal(get("queued"), 2); // ACTIVE 12 - running now 10
    assert.equal(get("expired"), 20);
    assert.equal(get("cancelled"), 4);
    assert.equal(get("pending"), 2);
    assert.equal(get("issue"), 1);
    assert.equal(sliceTotal(slices), 12 + 20 + 4 + 2 + 1);
    assert.equal(slices.some((s) => s.key === "other"), false);
  });
  it("an unknown status keeps its real count under 'Khác'", () => {
    const slices = membershipSlices(block({ SUSPENDED: 5 }));
    assert.equal(slices.find((s) => s.key === "other")?.value, 5);
  });
  it("expiring is never more than the running cards (no negative slice)", () => {
    const slices = membershipSlices(block({}, 2, 9));
    assert.ok(slices.every((s) => s.value >= 0));
    assert.equal(slices.find((s) => s.key === "expiring")?.value, 2);
  });
  it("share text", () => {
    assert.equal(shareText(25, 100), "25%");
    assert.equal(shareText(1, 3), "33%");
    assert.equal(shareText(0, 0), "");
  });

  const st = (m: Partial<NonNullable<GymStats["memberships"]>> | null): StatsState =>
    statsOf({ memberships: m === null ? null : { active: 1, expiringSoon: 0, expiringSoonDays: 7, byStatus: { ACTIVE: 1 }, ...m } });
  it("all branches: summed only when every branch has answered", () => {
    const ok = aggregateMemberships({ a: st({ active: 4, byStatus: { ACTIVE: 4, EXPIRED: 1 } }), b: st({ active: 6, expiringSoon: 2, byStatus: { ACTIVE: 7, CANCELLED: 3 } }) }, ["a", "b"]);
    assert.equal(ok.complete, true);
    assert.equal(ok.block?.active, 10);
    assert.equal(ok.block?.expiringSoon, 2);
    assert.deepEqual(ok.block?.byStatus, { ACTIVE: 11, EXPIRED: 1, CANCELLED: 3 });

    const partial = aggregateMemberships({ a: st({}), b: { state: "loading" } }, ["a", "b"]);
    assert.equal(partial.block, null);
    assert.equal(partial.loading, true);

    const failed = aggregateMemberships({ a: st({}), b: { state: "error" } }, ["a", "b"]);
    assert.equal(failed.block, null);
    assert.deepEqual(failed.failedGymIds, ["b"]);
    assert.equal(failed.loading, false);
  });
  it("a branch that is not in the answer map counts as loading, not as 0", () => {
    const a = aggregateMemberships({}, ["x"]);
    assert.equal(a.loading, true);
    assert.equal(a.block, null);
  });
  it("memberships null on every branch (role may not read) = nothing drawn", () => {
    const a = aggregateMemberships({ a: st(null), b: st(null) }, ["a", "b"]);
    assert.equal(a.visible, false);
    assert.equal(a.block, null);
  });
  it("a junk memberships block is an error, not a chart", () => {
    const a = aggregateMemberships({ a: statsOf({ memberships: { active: -1, expiringSoon: 0, expiringSoonDays: 7, byStatus: {} } }) }, ["a"]);
    assert.deepEqual(a.failedGymIds, ["a"]);
  });
});

const sale = (id: string, createdAt: string | null, price: number, over: Partial<SalesView> = {}): SalesView => ({
  id,
  gymId: "g1",
  planId: "p1",
  status: "ACTIVE",
  priceAtPurchase: price,
  paymentTxnId: null,
  startDate: null,
  endDate: null,
  createdAt,
  ...over,
});

describe("week bucketing (Monday start, Vietnam days)", () => {
  it("weekStartOf: Monday to Sunday share one key", () => {
    // 2026-11-22 is a Sunday; its week starts Monday 2026-11-16.
    assert.equal(weekStartOf("2026-11-22"), "2026-11-16");
    assert.equal(weekStartOf("2026-11-16"), "2026-11-16");
    assert.equal(weekStartOf("2026-11-23"), "2026-11-23");
    assert.equal(weekStartOf("2026-11-17"), "2026-11-16");
  });
  it("weekStartOf crosses a month boundary", () => {
    assert.equal(weekStartOf("2026-12-02"), "2026-11-30");
  });
  it("sales on Sunday night (VN) and Monday morning (VN) land in different weeks", () => {
    // Sun 22/11 23:30 VN = 16:30Z; Mon 23/11 00:30 VN = 17:30Z on the 22nd.
    const rows = [sale("a", "2026-11-22T16:30:00Z", 100_000), sale("b", "2026-11-22T17:30:00Z", 200_000)];
    const s = revenueSeries(rows, "2026-11-24", 30, "week");
    const w1 = s.points.find((p) => p.key === "2026-11-16")!;
    const w2 = s.points.find((p) => p.key === "2026-11-23")!;
    assert.equal(w1.total, 100_000);
    assert.equal(w2.total, 200_000);
  });
  it("weekly window starts on a Monday and the current week is marked partial", () => {
    const win = salesWindow("2026-11-22", 90, "week");
    assert.equal(win.from, weekStartOf("2026-08-25"));
    assert.equal(weekStartOf(win.from), win.from);
    const s = revenueSeries([], "2026-11-24", 90, "week");
    assert.equal(s.points[0].key, weekStartOf("2026-08-27"));
    assert.equal(s.points[s.points.length - 1].partial, true); // week of Mon 23/11 is not over on Tue 24/11
    assert.equal(s.points.filter((p) => p.partial).length, 1);
    assert.ok(s.points.every((p, i) => i === 0 || p.key > s.points[i - 1].key));
    const sun = revenueSeries([], "2026-11-22", 90, "week");
    assert.equal(sun.points[sun.points.length - 1].partial, false); // today is the Sunday: the week is complete
  });
  it("weeks are zero-filled and sum to the daily total", () => {
    const rows = [sale("a", "2026-11-02T03:00:00Z", 100), sale("b", "2026-11-18T03:00:00Z", 300), sale("c", "2026-11-19T03:00:00Z", 50)];
    const day = revenueSeries(rows, "2026-11-22", 90, "day");
    const week = revenueSeries(rows, "2026-11-22", 90, "week");
    assert.equal(day.total, 450);
    assert.equal(week.total, 450);
    assert.equal(day.points.length, 90);
    assert.equal(day.points.reduce((a, p) => a + p.total, 0), 450);
    assert.equal(week.points.reduce((a, p) => a + p.total, 0), 450);
    assert.equal(week.points.find((p) => p.key === "2026-11-16")?.total, 350);
  });
  it("granularity options: per-week toggle only beyond 30 days; 180 days defaults to weeks", () => {
    assert.deepEqual(granularityOptions(30), ["day"]);
    assert.deepEqual(granularityOptions(90), ["day", "week"]);
    assert.equal(defaultGranularity(90), "day");
    assert.equal(defaultGranularity(180), "week");
    assert.equal(resolveGranularity(30, "week"), "day"); // a stale choice from a longer range is not honoured
    assert.equal(resolveGranularity(90, "week"), "week");
    assert.equal(resolveGranularity(180, null), "week");
  });
});

describe("revenue series (gross sales of paid cards)", () => {
  it("only ACTIVE and EXPIRED cards count; pending / cancelled are left out", () => {
    const rows = [
      sale("1", "2026-11-20T03:00:00Z", 100),
      sale("2", "2026-11-20T04:00:00Z", 200, { status: "EXPIRED" }),
      sale("3", "2026-11-20T05:00:00Z", 999, { status: "CANCELLED" }),
      sale("4", "2026-11-20T06:00:00Z", 999, { status: "PENDING_PAYMENT" }),
      sale("5", "2026-11-20T06:00:00Z", 999, { status: "PENDING_ISSUE" }),
    ];
    const s = revenueSeries(rows, "2026-11-22", 30, "day");
    assert.equal(s.total, 300);
    assert.equal(s.count, 2);
    assert.equal(s.points.find((p) => p.key === "2026-11-20")?.total, 300);
  });
  it("the window is inclusive of both ends and ignores sales outside it", () => {
    const rows = [sale("in1", "2026-10-24T03:00:00Z", 10), sale("in2", "2026-11-22T10:00:00Z", 20), sale("out1", "2026-10-23T03:00:00Z", 1000), sale("out2", "2026-11-23T03:00:00Z", 1000)];
    const s = revenueSeries(rows, "2026-11-22", 30, "day");
    assert.equal(s.from, "2026-10-24");
    assert.equal(s.total, 30);
  });
  it("a card without a usable sale date is counted as undated, not put on today", () => {
    const s = revenueSeries([sale("a", null, 500), sale("b", "garbage", 500), sale("c", "2026-11-22T03:00:00Z", 100)], "2026-11-22", 30, "day");
    assert.equal(s.undated, 2);
    assert.equal(s.total, 100);
  });
  it("no sales = a real empty series of zeros with count 0", () => {
    const s = revenueSeries([], "2026-11-22", 30, "day");
    assert.equal(s.count, 0);
    assert.equal(s.points.length, 30);
    assert.ok(s.points.every((p) => p.total === 0));
  });
});

describe("sales by plan", () => {
  const win = range("2026-10-24", "2026-11-22");
  const names: Record<string, string> = { p1: "Gói 1 tháng", p2: "Gói 3 tháng", p3: "Gói 12 tháng" };
  const nameOf = (id: string) => names[id] ?? "Gói khác";
  it("groups paid cards by plan, biggest gross first", () => {
    const rows = [
      sale("1", "2026-11-01T03:00:00Z", 500, { planId: "p1" }),
      sale("2", "2026-11-02T03:00:00Z", 500, { planId: "p1" }),
      sale("3", "2026-11-03T03:00:00Z", 2_000, { planId: "p2" }),
      sale("4", "2026-11-03T03:00:00Z", 7_000, { planId: "p3", status: "CANCELLED" }),
    ];
    const g = salesByPlan(rows, win, nameOf);
    assert.deepEqual(g.map((x) => [x.planId, x.total, x.count]), [["p2", 2000, 1], ["p1", 1000, 2]]);
    assert.equal(g[0].name, "Gói 3 tháng");
  });
  it("only cards inside the window are grouped", () => {
    const g = salesByPlan([sale("1", "2026-09-01T03:00:00Z", 500), sale("2", "2026-11-01T03:00:00Z", 300)], win, nameOf);
    assert.equal(g.length, 1);
    assert.equal(g[0].total, 300);
  });
  it("beyond the limit the rest is merged with its real sum (nothing dropped)", () => {
    const rows = ["a", "b", "c", "d", "e"].map((p, i) => sale(String(i), "2026-11-05T03:00:00Z", (5 - i) * 100, { planId: p }));
    const g = salesByPlan(rows, win, nameOf, 3);
    assert.equal(g.length, 3);
    assert.equal(g[2].planId, null);
    assert.equal(g[2].total, 300 + 200 + 100);
    assert.equal(g[2].count, 3);
    assert.equal(g.reduce((a, x) => a + x.total, 0), 1500);
  });
  it("equal totals sort stably (no flicker between renders)", () => {
    const rows = [sale("1", "2026-11-05T03:00:00Z", 100, { planId: "p2" }), sale("2", "2026-11-05T03:00:00Z", 100, { planId: "p1" })];
    const a = salesByPlan(rows, win, nameOf).map((x) => x.planId);
    const b = salesByPlan([...rows].reverse(), win, nameOf).map((x) => x.planId);
    assert.deepEqual(a, b);
  });
});

describe("compact money axis", () => {
  it("compactVnd", () => {
    assert.equal(compactVnd(0), "0");
    assert.equal(compactVnd(500), "500");
    assert.equal(compactVnd(1500), "1,5 k");
    assert.equal(compactVnd(2_000_000), "2 tr");
    assert.equal(compactVnd(12_500_000), "12,5 tr");
    assert.equal(compactVnd(3_200_000_000), "3,2 tỷ");
  });
});

describe("permission gating of the charts", () => {
  it("owner sees every chart", () => {
    assert.deepEqual(chartAccess(canOf("OWNER")), { checkins: true, members: true, sales: true, heatmap: true, renewal: true, netIncome: true });
  });
  it("manager: check-ins and members, no finance", () => {
    assert.deepEqual(chartAccess(canOf("MANAGER")), { checkins: true, members: true, sales: false, heatmap: true, renewal: true, netIncome: false });
  });
  it("receptionist: check-ins only", () => {
    assert.deepEqual(chartAccess(canOf("RECEPTIONIST")), { checkins: true, members: false, sales: false, heatmap: true, renewal: false, netIncome: false });
  });
  it("accountant: sales only, no check-ins and no member data (membership.sales is not membership.full)", () => {
    assert.deepEqual(chartAccess(canOf("ACCOUNTANT")), { checkins: false, members: false, sales: true, heatmap: false, renewal: true, netIncome: true });
  });
  it("loading / unknown role is fail-closed: nothing", () => {
    assert.deepEqual(chartAccess(canOf(undefined)), { checkins: false, members: false, sales: false, heatmap: false, renewal: false, netIncome: false });
  });
});
