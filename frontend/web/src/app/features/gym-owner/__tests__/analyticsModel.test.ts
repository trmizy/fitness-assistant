/**
 * TEST FIXTURE - Gym Owner charts, phase 2 (heatmap, renewal, net income): pure functions with fake /analytics answers; no browser, no backend.
 * Run: node ../../node_modules/tsx/dist/cli.mjs --test src/app/features/gym-owner/__tests__/analyticsModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHeatmaps,
  aggregateNetIncome,
  aggregateRenewals,
  analyticsRange,
  analyticsStateOf,
  bucketsOf,
  compactHourWindow,
  heatLevel,
  heatmapSummary,
  netBreakdown,
  netIncomeSeries,
  netSummary,
  newReturningSeries,
  parseAnalytics,
  peakText,
  provisionalRateText,
  renewalHeadline,
  sumHeatmaps,
  sumNetIncomes,
  sumRenewals,
  type Analytics,
  type AnalyticsState,
  type Heatmap,
  type IncomeDay,
  type NetIncome,
  type Renewal,
} from "../charts/analyticsModel";
import { chartAccess, datesBetween } from "../charts/chartsModel";
import { canOf } from "./permFixture";

const RANGE = { from: "2026-11-16", to: "2026-11-29" }; // Mon 16/11 .. Sun 29/11 (14 days)
const days = datesBetween(RANGE.from, RANGE.to);

const emptyMatrix = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
/** A heatmap as the server builds it, from {weekday(1..7), hour, count} cells. */
function heat(cells: { w: number; h: number; n: number }[]): Heatmap {
  const matrix = emptyMatrix();
  for (const c of cells) matrix[c.w - 1][c.h] += c.n;
  return sumHeatmaps([{ total: 0, matrix, byHour: [], byWeekday: [], peak: null }]);
}

function rawAnalytics(over: Record<string, unknown> = {}, gymId = "g1", range = RANGE) {
  const ds = datesBetween(range.from, range.to);
  const h = heat([{ w: 2, h: 19, n: 24 }, { w: 3, h: 18, n: 10 }]);
  return {
    gymId,
    timeZone: "Asia/Ho_Chi_Minh",
    from: range.from,
    to: range.to,
    today: range.to,
    heatmap: h,
    sales: null,
    renewal: {
      windowDays: 30, scope: "BRAND", ended: 21, renewed: 4, renewedSameBranch: 3, settled: 10, settledRenewed: 4, open: 5, rate: 0.1905, settledRate: 0.4,
      newVsReturning: { newMembers: 2, returningMembers: 1, daily: ds.map((date, i) => ({ date, new: i === 0 ? 2 : 0, returning: i === 1 ? 1 : 0 })) },
    },
    netIncome: {
      source: "PAYMENT_LEDGER", walletFound: true, dateBasis: "LEDGER_ENTRY_DATE",
      totals: { sales: 2, grossPrice: 1000, gymShare: 800, feeAtSale: 200, referralCommission: 100, adjustments: -50, net: 650 },
      daily: ds.map((date, i) => ({ date, sales: i === 0 ? 2 : 0, grossPrice: i === 0 ? 1000 : 0, gymShare: i === 0 ? 800 : 0, feeAtSale: i === 0 ? 200 : 0, referralCommission: i === 0 ? 100 : 0, adjustments: i === 1 ? -50 : 0, net: i === 0 ? 700 : i === 1 ? -50 : 0 })),
    },
    unavailable: [] as string[],
    ...over,
  };
}
const ok = (data: Analytics): AnalyticsState => ({ state: "ok", data });
const parsed = (over: Record<string, unknown> = {}, gymId = "g1"): Analytics => parseAnalytics(rawAnalytics(over, gymId), gymId, RANGE)!;

describe("heatmap summing and peak text", () => {
  it("adds the matrices of several branches and recomputes totals, byHour, byWeekday and the peak", () => {
    const a = heat([{ w: 2, h: 19, n: 24 }, { w: 3, h: 18, n: 10 }]);
    const b = heat([{ w: 2, h: 19, n: 6 }, { w: 3, h: 18, n: 25 }, { w: 7, h: 5, n: 1 }]);
    const s = sumHeatmaps([a, b]);
    assert.equal(s.total, 24 + 10 + 6 + 25 + 1);
    assert.equal(s.matrix[1][19], 30);
    assert.equal(s.matrix[2][18], 35);
    assert.equal(s.byHour[19], 30);
    assert.equal(s.byWeekday[2], 35);
    assert.deepEqual(s.peak, { weekday: 3, hour: 18, count: 35 });
  });
  it("a tie goes to the first cell in Monday-first, hour-ascending order (same as the server)", () => {
    const s = sumHeatmaps([heat([{ w: 5, h: 7, n: 9 }, { w: 2, h: 20, n: 9 }, { w: 2, h: 10, n: 9 }])]);
    assert.deepEqual(s.peak, { weekday: 2, hour: 10, count: 9 });
  });
  it("no check-in at all: no peak, honest sentence", () => {
    const s = sumHeatmaps([heat([])]);
    assert.equal(s.peak, null);
    assert.equal(peakText(s.peak), "Chưa có lượt check-in nào trong khoảng này.");
    assert.equal(heatmapSummary(s, 30), "Chưa có lượt check-in nào trong 30 ngày qua.");
  });
  it("peak text names the weekday, the hour slot and the count", () => {
    assert.equal(peakText({ weekday: 2, hour: 19, count: 24 }), "Đông nhất: Thứ ba 19:00-20:00, 24 lượt");
    assert.equal(peakText({ weekday: 7, hour: 23, count: 3 }), "Đông nhất: Chủ nhật 23:00-00:00, 3 lượt");
  });
  it("summary carries the total, the peak, the busiest weekday and hour", () => {
    const s = sumHeatmaps([heat([{ w: 2, h: 19, n: 24 }, { w: 2, h: 8, n: 4 }, { w: 4, h: 19, n: 6 }])]);
    const t = heatmapSummary(s, 90);
    assert.match(t, /^34 lượt check-in trong 90 ngày qua\. Đông nhất: Thứ ba 19:00-20:00, 24 lượt\./);
    assert.match(t, /Ngày đông nhất trong tuần: Thứ ba \(28 lượt\)/);
    assert.match(t, /Giờ đông nhất: 19:00-20:00 \(30 lượt\)/);
  });
  it("heat level is relative to the busiest cell; an empty cell is 0", () => {
    assert.equal(heatLevel(0, 24), 0);
    assert.equal(heatLevel(12, 24), 0.5);
    assert.equal(heatLevel(24, 24), 1);
    assert.equal(heatLevel(5, 0), 0);
  });
});

describe("all branches: the heatmap is summed only when every branch has loaded", () => {
  const h1 = ok(parsed({ heatmap: heat([{ w: 2, h: 19, n: 24 }]) }, "g1"));
  const h2 = ok(parsed({ heatmap: heat([{ w: 2, h: 19, n: 6 }]) }, "g2"));
  it("all loaded: the sum", () => {
    const a = aggregateHeatmaps([{ gymId: "g1", s: h1 }, { gymId: "g2", s: h2 }]);
    assert.equal(a.complete, true);
    assert.equal(a.heat!.total, 30);
  });
  it("one still loading: no sum, loading", () => {
    const a = aggregateHeatmaps([{ gymId: "g1", s: h1 }, { gymId: "g2", s: { state: "loading" } }]);
    assert.equal(a.heat, null);
    assert.equal(a.loading, true);
    assert.equal(a.loaded, 1);
  });
  it("one failed: no sum, the failed branch is named, not loading", () => {
    const a = aggregateHeatmaps([{ gymId: "g1", s: h1 }, { gymId: "g2", s: { state: "error" } }]);
    assert.equal(a.heat, null);
    assert.deepEqual(a.failedGymIds, ["g2"]);
    assert.equal(a.loading, false);
  });
  it("a branch whose heatmap is null (role may not read it) is not counted; all null = invisible", () => {
    const hidden = ok(parsed({ heatmap: null }, "g2"));
    const a = aggregateHeatmaps([{ gymId: "g1", s: h1 }, { gymId: "g2", s: hidden }]);
    assert.equal(a.total, 1);
    assert.equal(a.heat!.total, 24);
    assert.equal(aggregateHeatmaps([{ gymId: "g2", s: hidden }]).visible, false);
  });
});

describe("compact hour window", () => {
  const byHour = (cells: Record<number, number>) => Array.from({ length: 24 }, (_, h) => cells[h] ?? 0);
  it("default is 5:00-23:00 = hours 5..22", () => {
    assert.deepEqual(compactHourWindow(byHour({ 19: 5 })), { from: 5, to: 22 });
    assert.deepEqual(compactHourWindow(byHour({})), { from: 5, to: 22 });
  });
  it("is widened, never cropped, when check-ins fall outside the default window", () => {
    assert.deepEqual(compactHourWindow(byHour({ 3: 1, 19: 5 })), { from: 3, to: 22 });
    assert.deepEqual(compactHourWindow(byHour({ 23: 2, 19: 5 })), { from: 5, to: 23 });
    assert.deepEqual(compactHourWindow(byHour({ 0: 1, 23: 1 })), { from: 0, to: 23 });
  });
  it("every counted check-in lies inside the window (the grid shows the whole total)", () => {
    const h = heat([{ w: 1, h: 2, n: 4 }, { w: 4, h: 23, n: 3 }, { w: 5, h: 12, n: 9 }]);
    const w = compactHourWindow(h.byHour);
    let inside = 0;
    for (let r = 0; r < 7; r++) for (let c = w.from; c <= w.to; c++) inside += h.matrix[r][c];
    assert.equal(inside, h.total);
  });
});

describe("renewal text with null rates", () => {
  const base = (over: Partial<Renewal> = {}): Renewal => ({ ...parsed().renewal!, ...over });
  it("settled rate: the plain sentence with the cohort and the share", () => {
    const h = renewalHeadline(base({ settled: 10, settledRenewed: 4, settledRate: 0.4 }));
    assert.equal(h.value, "40%");
    assert.equal(h.text, "Trong 10 thẻ đã hết hạn đủ 30 ngày, 40% khách đã gia hạn (4/10).");
  });
  it("settledRate null with ended cards: says the rate is not final yet, no percent", () => {
    const h = renewalHeadline(base({ ended: 6, renewed: 2, settled: 0, settledRenewed: 0, settledRate: null, rate: 0.3333 }));
    assert.equal(h.value, "-");
    assert.match(h.text, /Chưa có thẻ nào hết hạn đủ 30 ngày/);
    assert.doesNotMatch(h.text, /%/);
  });
  it("nothing ended at all: its own sentence", () => {
    const h = renewalHeadline(base({ ended: 0, renewed: 0, settled: 0, settledRenewed: 0, open: 0, rate: null, settledRate: null }));
    assert.equal(h.value, "-");
    assert.equal(h.text, "Chưa có thẻ nào hết hạn trong khoảng này nên chưa có tỷ lệ gia hạn.");
  });
  it("provisional rate: only when something ended, and it says why it leans high", () => {
    assert.equal(provisionalRateText(base({ ended: 0, rate: null })), "");
    assert.match(provisionalRateText(base({ ended: 21, renewed: 4, rate: 0.1905 })), /^Tỷ lệ tạm tính: 19% \(4\/21 thẻ đã hết hạn\)\..*cao hơn thực tế/);
  });
  it("rates of several branches are recomputed from the summed counts, never averaged", () => {
    const a = base({ ended: 21, renewed: 4, settled: 10, settledRenewed: 4, open: 5, rate: 0.1905, settledRate: 0.4 });
    const b = base({ ended: 15, renewed: 5, settled: 7, settledRenewed: 2, open: 4, rate: 0.3333, settledRate: 0.2857 });
    const s = sumRenewals([a, b], RANGE);
    assert.equal(s.ended, 36);
    assert.equal(s.renewed, 9);
    assert.equal(s.settled, 17);
    assert.equal(s.settledRate, 0.3529); // 6/17, not (0.4 + 0.2857) / 2
    assert.equal(s.rate, 0.25);
    assert.equal(s.newMembers, 4);
  });
  it("when no branch has a settled card the summed settled rate stays null", () => {
    const a = base({ settled: 0, settledRenewed: 0, settledRate: null });
    assert.equal(sumRenewals([a, a], RANGE).settledRate, null);
  });
});

describe("new vs returning series", () => {
  const daily = days.map((date, i) => ({ date, new: i % 2, returning: i === 3 ? 4 : 0 }));
  it("per day keeps every day", () => {
    const s = newReturningSeries(daily, RANGE, "day");
    assert.equal(s.length, 14);
    assert.equal(s[3].returning, 4);
  });
  it("per week sums Monday-first weeks and loses nothing", () => {
    const s = newReturningSeries(daily, RANGE, "week");
    assert.equal(s.length, 2);
    assert.equal(s[0].key, "2026-11-16");
    assert.equal(s[0].new + s[1].new, daily.reduce((a, d) => a + d.new, 0));
    assert.equal(s[0].returning + s[1].returning, 4);
    assert.equal(s[0].partial, false);
  });
});

describe("buckets and ranges", () => {
  it("weeks are cut by the range start and flagged partial; a week not over yet is partial too", () => {
    const b = bucketsOf({ from: "2026-11-18", to: "2026-11-25" }, "week"); // Wed .. Wed
    assert.deepEqual(
      b.map((x) => [x.key, x.from, x.to, x.partial]),
      [
        ["2026-11-16", "2026-11-18", "2026-11-22", true],
        ["2026-11-23", "2026-11-23", "2026-11-25", true],
      ],
    );
  });
  it("a whole Monday-Sunday week is not partial", () => {
    assert.equal(bucketsOf({ from: "2026-11-16", to: "2026-11-22" }, "week")[0].partial, false);
  });
  it("range helper never exceeds the server's 92 days", () => {
    assert.deepEqual(analyticsRange("2026-11-26", 90), { from: "2026-08-29", to: "2026-11-26" });
    assert.equal(datesBetween(analyticsRange("2026-11-26", 500).from, "2026-11-26").length, 92);
  });
});

describe("net income aggregation by week", () => {
  const net = parsed().netIncome!;
  it("weekly buckets add the day figures and reproduce the totals exactly", () => {
    const s = netIncomeSeries(net.daily, RANGE, "week");
    assert.equal(s.length, 2);
    assert.equal(s[0].net, 650);
    assert.equal(s[0].gymShare, 800);
    assert.equal(s[0].referralCommission, 100);
    assert.equal(s[0].adjustments, -50);
    assert.equal(s[1].net, 0);
    assert.equal(s.reduce((a, p) => a + p.net, 0), net.totals.net);
    assert.equal(s.reduce((a, p) => a + p.sales, 0), net.totals.sales);
  });
  it("a refund week is negative, kept negative (not clamped)", () => {
    const daily: IncomeDay[] = days.map((date, i) => ({ date, sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: i === 8 ? -300 : 0, net: i === 8 ? -300 : 0 }));
    const s = netIncomeSeries(daily, RANGE, "week");
    assert.equal(s[1].net, -300);
  });
  it("breakdown rows follow the ledger: gross - fee = gym share; share - commission + adjustments = net", () => {
    const rows = netBreakdown(net.totals);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    assert.equal(v.grossPrice + v.feeAtSale, v.gymShare);
    assert.equal(v.gymShare + v.referralCommission + v.adjustments, v.net);
  });
  it("several branches add day by day; a branch without a wallet adds zeros and is listed", () => {
    const zero = { sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 };
    const noWallet: NetIncome = { walletFound: false, totals: zero, daily: net.daily.map((d) => ({ date: d.date, ...zero })) };
    const sum = sumNetIncomes([net, net, noWallet], RANGE);
    assert.equal(sum.totals.net, 1300);
    assert.equal(sum.daily[0].net, 1400);
    assert.equal(sum.walletFound, true);
    const raw = rawAnalytics();
    const agg = aggregateNetIncome(
      [
        { gymId: "g1", s: ok(parsed({}, "g1")) },
        { gymId: "g2", s: ok(parsed({ netIncome: { ...raw.netIncome, walletFound: false } }, "g2")) },
      ],
      RANGE,
    );
    assert.deepEqual(agg.noWalletGymIds, ["g2"]);
    assert.equal(agg.complete, true);
  });
  it("summary names the net and its parts", () => {
    const fmt = (n: number) => `${n}đ`;
    const t = netSummary(net.totals, RANGE, fmt, netIncomeSeries(net.daily, RANGE, "day"), "day");
    assert.match(t, /^Thực nhận 650đ trong 16\/11 đến 29\/11: phần của phòng tập 800đ, trừ hoa hồng PT 100đ, điều chỉnh -50đ\./);
    assert.match(t, /Ngày 16\/11 cao nhất với 700đ/);
  });
});

describe("unavailable vs null (hidden) handling", () => {
  it("unavailable netIncome: an error for that branch, never a 0 total", () => {
    const a = parsed({ netIncome: null, unavailable: ["netIncome"] });
    assert.equal(a.netIncomeUnavailable, true);
    const agg = aggregateNetIncome([{ gymId: "g1", s: ok(a) }], RANGE);
    assert.equal(agg.visible, true);
    assert.equal(agg.income, null);
    assert.deepEqual(agg.unavailableGymIds, ["g1"]);
    assert.deepEqual(agg.failedGymIds, ["g1"]);
    assert.equal(agg.complete, false);
    assert.equal(agg.loading, false);
  });
  it("null netIncome without `unavailable` = the role may not read it: nothing at all", () => {
    const a = parsed({ netIncome: null, unavailable: [] });
    assert.equal(a.netIncomeUnavailable, false);
    const agg = aggregateNetIncome([{ gymId: "g1", s: ok(a) }], RANGE);
    assert.equal(agg.visible, false);
    assert.equal(agg.income, null);
  });
  it("one branch unavailable among several: the sum is withheld", () => {
    const good = ok(parsed({}, "g1"));
    const bad = ok(parsed({ netIncome: null, unavailable: ["netIncome"] }, "g2"));
    const agg = aggregateNetIncome([{ gymId: "g1", s: good }, { gymId: "g2", s: bad }], RANGE);
    assert.equal(agg.income, null);
    assert.equal(agg.loaded, 1);
    assert.deepEqual(agg.unavailableGymIds, ["g2"]);
  });
  it("renewal null (role) is hidden; a failed request is an error, not hidden", () => {
    assert.equal(aggregateRenewals([{ gymId: "g1", s: ok(parsed({ renewal: null })) }], RANGE).visible, false);
    const e = aggregateRenewals([{ gymId: "g1", s: { state: "error" } }], RANGE);
    assert.equal(e.visible, true);
    assert.deepEqual(e.failedGymIds, ["g1"]);
  });
  it("a malformed answer is an error, never a half-drawn chart", () => {
    const q = (data: unknown) => analyticsStateOf({ data, isError: false }, "g1", RANGE);
    const r = rawAnalytics();
    assert.equal(q(r).state, "ok");
    assert.equal(q(rawAnalytics({}, "other")).state, "error"); // wrong branch
    assert.equal(q({ ...r, from: "2026-11-01" }).state, "error"); // wrong range
    assert.equal(q({ ...r, heatmap: { ...heat([]), matrix: [[1]] } }).state, "error");
    assert.equal(q({ ...r, netIncome: { ...r.netIncome, daily: r.netIncome.daily.slice(1) } }).state, "error"); // a missing day
    assert.equal(q({ ...r, renewal: { ...r.renewal, settledRate: 1.5 } }).state, "error");
    assert.equal(q(null).state, "error");
    assert.equal(analyticsStateOf({ isError: true }, "g1", RANGE).state, "error");
    assert.equal(analyticsStateOf({ isError: false }, "g1", RANGE).state, "loading");
  });
});

describe("permission gating of the phase-2 charts (all four roles + unknown)", () => {
  const pick = (role: Parameters<typeof canOf>[0]) => {
    const a = chartAccess(canOf(role));
    return { heatmap: a.heatmap, renewal: a.renewal, netIncome: a.netIncome };
  };
  it("owner: heatmap, renewal and net income", () => {
    assert.deepEqual(pick("OWNER"), { heatmap: true, renewal: true, netIncome: true });
  });
  it("manager: heatmap and renewal, no net income", () => {
    assert.deepEqual(pick("MANAGER"), { heatmap: true, renewal: true, netIncome: false });
  });
  it("receptionist: heatmap only", () => {
    assert.deepEqual(pick("RECEPTIONIST"), { heatmap: true, renewal: false, netIncome: false });
  });
  it("accountant: renewal and net income, no heatmap", () => {
    assert.deepEqual(pick("ACCOUNTANT"), { heatmap: false, renewal: true, netIncome: true });
  });
  it("unknown / loading role: fail-closed", () => {
    assert.deepEqual(pick(undefined), { heatmap: false, renewal: false, netIncome: false });
  });
  it("the same answer parsed for different roles: a hidden section stays hidden whatever the others hold", () => {
    // Receptionist: the server sends only the heatmap.
    const a = parsed({ renewal: null, netIncome: null, unavailable: [] });
    assert.notEqual(a.heatmap, null);
    assert.equal(a.renewal, null);
    assert.equal(a.netIncome, null);
    assert.equal(aggregateRenewals([{ gymId: "g1", s: ok(a) }], RANGE).visible, false);
    assert.equal(aggregateNetIncome([{ gymId: "g1", s: ok(a) }], RANGE).visible, false);
    // Accountant: no heatmap.
    const b = parsed({ heatmap: null });
    assert.equal(aggregateHeatmaps([{ gymId: "g1", s: ok(b) }]).visible, false);
    assert.equal(aggregateNetIncome([{ gymId: "g1", s: ok(b) }], RANGE).visible, true);
  });
});
