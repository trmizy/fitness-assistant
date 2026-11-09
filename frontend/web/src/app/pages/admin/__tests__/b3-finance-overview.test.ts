/**
 * B3 — phần thuần của "Tài chính › Tổng quan": đọc tiền Decimal, làm tròn, tỷ lệ, 409 của P3, bản đồ tiền,
 * kỳ/URL, cũ (stale), tóm tắt hàng đợi rút tiền.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b3-finance-overview.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  axisLabel,
  balanceVerdict,
  bucketLabel,
  buildChartPoints,
  buildMoneyMap,
  centsToDong,
  checkRange,
  formatDong,
  formatDriftCents,
  formatShare,
  formatVnDateTime,
  niceScale,
  normalizeFinanceOverview,
  normalizeReconciliation,
  parseCents,
  parseMoney,
  periodFromSearch,
  periodToSearch,
  presetRange,
  reconciliationFromHttpError,
  shareBp,
  staleness,
  sumCents,
  summarizeWithdrawals,
  toApiRange,
} from "../adminFinanceOverview.utils";

const NBSP = / /g;
const txt = (s: string) => s.replace(NBSP, " ");

describe("parseCents / parseMoney", () => {
  it("reads every Decimal shape the backends emit", () => {
    assert.equal(parseCents("100000"), 10000000n);
    assert.equal(parseCents("100000.5"), 10000050n);
    assert.equal(parseCents("100000.00"), 10000000n);
    assert.equal(parseCents("0.00"), 0n);
    assert.equal(parseCents("-1250000.00"), -125000000n);
    assert.equal(parseCents(" 70000.00 "), 7000000n);
    assert.equal(parseCents(1500000), 150000000n);
  });
  it("is exact for amounts that overflow a double", () => {
    assert.equal(parseCents("9007199254740993.00"), 900719925474099300n);
    assert.equal(parseMoney("9007199254740993"), 9007199254740993n);
  });
  it("returns null (never 0) for missing / malformed input", () => {
    for (const bad of [undefined, null, "", "abc", "1,5", "1e6", "NaN", "--1", "1.", ".5", {}, [], Number.NaN, Infinity]) {
      assert.equal(parseCents(bad as unknown), null, `input ${String(bad)}`);
      assert.equal(parseMoney(bad as unknown), null);
    }
  });
  it("rounds only at display: half away from zero, no intermediate rounding", () => {
    assert.equal(parseMoney("100.49"), 100n);
    assert.equal(parseMoney("100.50"), 101n);
    assert.equal(parseMoney("-100.50"), -101n);
    assert.equal(parseMoney("-0.49"), 0n);
    assert.equal(centsToDong(149n), 1n);
    assert.equal(centsToDong(150n), 2n);
    assert.equal(parseCents("1.005"), 101n); // third decimal >= 5 rounds the cent up
    assert.equal(parseCents("1.004"), 100n);
  });
  it("sums exactly and refuses a partial sum", () => {
    assert.equal(sumCents(["0.10", "0.20", "0.30"]), 60n); // 0.1+0.2+0.3 in floats is 0.6000000000000001
    assert.equal(sumCents([]), 0n);
    assert.equal(sumCents(["1", "oops"]), null);
  });
});

describe("formatDong / formatDriftCents", () => {
  it("groups with dots and shows the dong sign", () => {
    assert.equal(txt(formatDong(590800000n)), "590.800.000 ₫");
    assert.equal(txt(formatDong(0n)), "0 ₫");
    assert.equal(txt(formatDong(-1250000n)), "-1.250.000 ₫");
    assert.equal(txt(formatDong(9007199254740993n)), "9.007.199.254.740.993 ₫");
  });
  it("shows — for unknown, never 0", () => {
    assert.equal(formatDong(null), "—");
    assert.equal(formatDong(undefined), "—");
  });
  it("a sub-dong drift is never rendered as '0 ₫'", () => {
    assert.equal(txt(formatDriftCents(0n)), "0 ₫");
    assert.equal(txt(formatDriftCents(12500n)), "125 ₫");
    assert.notEqual(txt(formatDriftCents(30n)), "0 ₫"); // 0,30 ₫
    assert.match(txt(formatDriftCents(30n)), /0,3/);
    assert.notEqual(txt(formatDriftCents(-30n)), "0 ₫");
  });
});

describe("shareBp / formatShare", () => {
  it("computes basis points with integer math", () => {
    assert.equal(shareBp(184250000n, 590800000n), 3119);
    assert.equal(shareBp(590800000n, 590800000n), 10000);
    assert.equal(shareBp(0n, 590800000n), 0);
  });
  it("is null for a zero / negative / unknown total", () => {
    assert.equal(shareBp(5n, 0n), null);
    assert.equal(shareBp(5n, -5n), null);
    assert.equal(shareBp(null, 100n), null);
    assert.equal(shareBp(5n, null), null);
  });
  it("formats with a decimal comma", () => {
    assert.equal(formatShare(3119), "31,2%");
    assert.equal(formatShare(700), "7,0%");
    assert.equal(formatShare(10000), "100,0%");
    assert.equal(formatShare(null), "—");
  });
});

const BALANCED_BODY = {
  success: true,
  data: {
    escrow: "590800000.00",
    claims: "590800000.00",
    drift: "0.00",
    balanced: true,
    breakdown: {
      clientBalances: "184250000.00",
      ptPending: "96400000.00",
      ptAvailable: "41300000.00",
      ptLocked: "12500000.00",
      ptHoldback: "0.00",
      gymPending: "128700000.00",
      gymAvailable: "57900000.00",
      gymLocked: "8000000.00",
      platformRevenuePending: "34600000.00",
      platformRevenueAvailable: "27150000.00",
    },
    negativeWallets: [],
  },
};
const DRIFT_BODY = {
  success: false,
  data: { ...BALANCED_BODY.data, escrow: "590800000.00", claims: "592050000.00", drift: "-1250000.00", balanced: false, negativeWallets: [{ id: "w" }] },
};

describe("P3 reconciliation: normalize + HTTP 409", () => {
  it("normalizes a 200 body (wrapped or bare)", () => {
    const r = normalizeReconciliation(BALANCED_BODY)!;
    assert.equal(r.escrow, "590800000.00");
    assert.equal(r.balanced, true);
    assert.equal(r.negativeWallets.length, 0);
    assert.ok(normalizeReconciliation(BALANCED_BODY.data));
  });
  it("rejects an unusable body instead of defaulting to 0", () => {
    for (const bad of [null, undefined, {}, { data: {} }, { data: { escrow: "1", claims: "1" } }, { data: { escrow: "x", claims: "1", drift: "0" } }, "str"]) {
      assert.equal(normalizeReconciliation(bad), null, JSON.stringify(bad));
    }
  });
  it("409 WITH a body is a report (có lệch), not a load error", () => {
    const err = { response: { status: 409, data: DRIFT_BODY } };
    const r = reconciliationFromHttpError(err)!;
    assert.ok(r);
    assert.equal(r.drift, "-1250000.00");
    assert.equal(r.negativeWallets.length, 1);
  });
  it("409 without a usable body, and every other status, is NOT swallowed", () => {
    assert.equal(reconciliationFromHttpError({ response: { status: 409, data: {} } }), null);
    assert.equal(reconciliationFromHttpError({ response: { status: 409 } }), null);
    for (const status of [400, 401, 403, 404, 500, 502]) {
      assert.equal(reconciliationFromHttpError({ response: { status, data: DRIFT_BODY } }), null, `status ${status}`);
    }
    assert.equal(reconciliationFromHttpError(new Error("network")), null);
    assert.equal(reconciliationFromHttpError(null), null);
  });
  it("balanceVerdict needs BOTH balanced=true and drift=0", () => {
    assert.equal(balanceVerdict(normalizeReconciliation(BALANCED_BODY)!).balanced, true);
    assert.equal(balanceVerdict(normalizeReconciliation(DRIFT_BODY)!).balanced, false);
    const lying = normalizeReconciliation({ data: { ...BALANCED_BODY.data, drift: "5.00", balanced: true } })!;
    assert.equal(balanceVerdict(lying).balanced, false);
    const lying2 = normalizeReconciliation({ data: { ...BALANCED_BODY.data, drift: "0.00", balanced: false } })!;
    assert.equal(balanceVerdict(lying2).balanced, false);
  });
});

describe("buildMoneyMap", () => {
  it("balanced: ten segments sum exactly to claims, shares sum to ~100%", () => {
    const m = buildMoneyMap(normalizeReconciliation(BALANCED_BODY)!);
    assert.equal(m.segments.length, 10);
    assert.equal(m.unexplainedCents, 0n);
    assert.deepEqual(m.missingKeys, []);
    const total = m.segments.reduce((a, s) => a + (s.cents ?? 0n), 0n);
    assert.equal(total, m.claimsCents);
    const bp = m.segments.reduce((a, s) => a + (s.shareBp ?? 0), 0);
    assert.ok(Math.abs(bp - 10000) <= 10, `bp sum ${bp}`);
    assert.equal(m.segments[0].dong, 184250000n);
  });
  it("drift: segments explain claims, not escrow", () => {
    const r = normalizeReconciliation({ data: { ...BALANCED_BODY.data, claims: "592050000.00", drift: "-1250000.00", balanced: false } })!;
    const m = buildMoneyMap(r);
    assert.equal(m.claimsCents, 59205000000n);
    assert.equal(m.unexplainedCents, 125000000n); // claims − Σ segments (segments still add to 590,8M)
  });
  it("a missing breakdown key is reported, not zeroed", () => {
    const body = structuredClone(BALANCED_BODY);
    delete (body.data.breakdown as Record<string, string>).ptHoldback;
    delete (body.data.breakdown as Record<string, string>).gymLocked;
    const m = buildMoneyMap(normalizeReconciliation(body)!);
    assert.deepEqual(m.missingKeys, ["ptHoldback", "gymLocked"]);
    assert.equal(m.segments.find((s) => s.key === "ptHoldback")!.dong, null);
    assert.equal(m.segments.find((s) => s.key === "ptHoldback")!.shareBp, null);
  });
  it("zero claims: no division by zero", () => {
    const body = structuredClone(BALANCED_BODY);
    body.data.escrow = body.data.claims = "0.00";
    for (const k of Object.keys(body.data.breakdown)) (body.data.breakdown as Record<string, string>)[k] = "0.00";
    const m = buildMoneyMap(normalizeReconciliation(body)!);
    assert.equal(m.claimsCents, 0n);
    assert.ok(m.segments.every((s) => s.shareBp === null));
  });
});

describe("P4 finance-overview: normalize + chart", () => {
  const body = {
    success: true,
    data: {
      groupBy: "day",
      from: "2026-09-27T00:00:00.000Z",
      to: "2026-10-27T00:00:00.000Z",
      buckets: [
        { period: "2026-10-24T00:00:00.000Z", income: "12000000.00", expense: "1500000.00", netRevenue: "600000.00", transactionCount: 4 },
        { period: "2026-10-25T00:00:00.000Z", income: "0.00", expense: "0.00", netRevenue: "0.00", transactionCount: 0 },
      ],
      totals: { income: "12000000.00", expense: "1500000.00", netRevenue: "600000.00", transactionCount: 4 },
      platformRevenue: { available: "27150000.00", pending: "34600000.00", asOf: "2026-10-26T07:32:00.000Z" },
    },
  };
  it("keeps totals/platformRevenue as strings and drops the unmapped transactionCount", () => {
    const r = normalizeFinanceOverview(body)!;
    assert.equal(r.totals.income, "12000000.00");
    assert.equal("transactionCount" in r.totals, false);
    assert.equal(r.platformRevenue!.available, "27150000.00");
    assert.equal(r.buckets.length, 2);
  });
  it("empty period (A-01) is a valid report with no buckets and real-zero totals", () => {
    const r = normalizeFinanceOverview({ data: { buckets: [], totals: { income: "0.00", expense: "0.00", netRevenue: "0.00" } } })!;
    assert.equal(r.buckets.length, 0);
    assert.equal(r.platformRevenue, null);
    assert.equal(parseMoney(r.totals.income), 0n);
  });
  it("unusable totals → null (UI: error, not 0)", () => {
    assert.equal(normalizeFinanceOverview({ data: { buckets: [], totals: {} } }), null);
    assert.equal(normalizeFinanceOverview({ data: { buckets: [] } }), null);
    assert.equal(normalizeFinanceOverview(null), null);
  });
  it("platformRevenue with an unreadable value is dropped, not zeroed", () => {
    const r = normalizeFinanceOverview({ data: { buckets: [], totals: { income: "0", expense: "0", netRevenue: "0" }, platformRevenue: { available: "x", pending: "1" } } })!;
    assert.equal(r.platformRevenue, null);
  });
  it("chart points: exact dong, null if any bucket is unreadable", () => {
    const r = normalizeFinanceOverview(body)!;
    const pts = buildChartPoints(r.buckets, "day")!;
    assert.equal(pts[0].income, 12000000n);
    assert.equal(pts[0].label, "24/10");
    assert.equal(buildChartPoints([{ period: "2026-10-24T00:00:00Z", income: "bad", expense: "0", netRevenue: "0" }], "day"), null);
  });
  it("bucket labels are UTC (the backend's bucketing zone)", () => {
    assert.equal(bucketLabel("2026-10-24T00:00:00.000Z", "day"), "24/10");
    assert.equal(bucketLabel("2026-10-01T00:00:00.000Z", "month"), "10/2026");
    assert.equal(bucketLabel("2026-10-01T00:00:00.000Z", "quarter"), "Q4/2026");
    assert.equal(bucketLabel("2026-10-19T00:00:00.000Z", "week"), "Tuần 19/10");
    assert.equal(bucketLabel("nope", "day"), "—");
  });
  it("niceScale / axisLabel", () => {
    assert.deepEqual(niceScale(33_000_000), { step: 10_000_000, top: 40_000_000 });
    assert.deepEqual(niceScale(0), { step: 1, top: 1 });
    assert.ok(niceScale(850_000).top >= 850_000);
    assert.equal(axisLabel(40_000_000), "40 tr");
    assert.equal(axisLabel(1_500_000), "1,5 tr");
    assert.equal(axisLabel(250_000), "250 k");
    assert.equal(axisLabel(2_000_000_000), "2 tỷ");
    assert.equal(axisLabel(0), "0");
  });
});

describe("period: presets, URL, range check, API range", () => {
  const NOW = Date.parse("2026-10-27T05:30:00Z");
  it("presets are inclusive UTC date ranges", () => {
    assert.deepEqual(presetRange("7d", NOW), { from: "2026-10-21", to: "2026-10-27" });
    assert.deepEqual(presetRange("30d", NOW), { from: "2026-09-28", to: "2026-10-27" });
    assert.deepEqual(presetRange("month", NOW), { from: "2026-10-01", to: "2026-10-27" });
  });
  it("UTC date, not local: 23:30Z on the 26th is still the 26th", () => {
    assert.equal(presetRange("7d", Date.parse("2026-10-26T23:30:00Z")).to, "2026-10-26");
  });
  it("URL round-trip; defaults leave the URL clean; junk falls back to default", () => {
    assert.equal(periodToSearch(periodFromSearch(new URLSearchParams(""), NOW)).toString(), "");
    const p = periodFromSearch(new URLSearchParams("period=month&group=week"), NOW);
    assert.equal(p.preset, "month");
    assert.equal(p.group, "week");
    assert.equal(periodToSearch(p).toString(), "period=month&group=week");
    const c = periodFromSearch(new URLSearchParams("period=custom&from=2026-09-01&to=2026-09-30&group=month"), NOW);
    assert.equal(c.preset, "custom");
    assert.equal(c.from, "2026-09-01");
    assert.equal(periodToSearch(c).get("to"), "2026-09-30");
    const junk = periodFromSearch(new URLSearchParams("period=zzz&group=year&from=1"), NOW);
    assert.equal(junk.preset, "30d");
    assert.equal(junk.group, "day");
    const badCustom = periodFromSearch(new URLSearchParams("period=custom&from=2026-02-30&to=2026-03-01"), NOW);
    assert.equal(badCustom.preset, "30d");
  });
  it("checkRange", () => {
    assert.equal(checkRange("2026-10-01", "2026-10-27", NOW), null);
    assert.equal(checkRange("2026-10-28", "2026-10-27", NOW), "FROM_AFTER_TO");
    assert.equal(checkRange("2026-10-01", "2026-10-28", NOW), "FUTURE");
    assert.equal(checkRange("", "2026-10-27", NOW), "INVALID_DATE");
    assert.equal(checkRange("2026-13-01", "2026-10-27", NOW), "INVALID_DATE");
  });
  it("toApiRange keeps the legacy semantics: to = 00:00Z of the day AFTER the chosen end date", () => {
    assert.deepEqual(toApiRange("2026-10-01", "2026-10-27"), { from: "2026-10-01T00:00:00.000Z", to: "2026-10-28T00:00:00.000Z" });
  });
});

describe("staleness (E-08)", () => {
  const T = Date.parse("2026-10-27T07:00:00Z");
  const base = { hasData: true, updatedAt: T, refetchFailed: false, maxAgeMs: 3 * 60_000 };
  it("fresh data is not stale", () => {
    assert.equal(staleness({ ...base, nowMs: T + 60_000 }).stale, false);
  });
  it("older than the limit is stale, with minutes", () => {
    const s = staleness({ ...base, nowMs: T + 4 * 60_000 + 5_000 });
    assert.equal(s.stale, true);
    assert.equal(s.minutes, 4);
    assert.equal(s.reason, "TOO_OLD");
  });
  it("a failed refetch makes the numbers stale immediately", () => {
    const s = staleness({ ...base, nowMs: T + 5_000, refetchFailed: true });
    assert.equal(s.stale, true);
    assert.equal(s.reason, "REFETCH_FAILED");
  });
  it("no data → nothing to call stale (the block shows error/loading instead)", () => {
    assert.equal(staleness({ ...base, hasData: false, nowMs: T + 999_999_999, refetchFailed: true }).stale, false);
  });
});

describe("summarizeWithdrawals (P7, mixed PENDING + APPROVED)", () => {
  const NOW = Date.parse("2026-10-27T00:00:00Z");
  const rows = [
    { status: "PENDING", amount: "1500000.00", createdAt: "2026-10-25T00:00:00Z" },
    { status: "PENDING", amount: "700000", createdAt: "2026-10-26T12:00:00Z" },
    { status: "APPROVED", amount: "12000000.00", createdAt: "2026-10-20T00:00:00Z", reviewedAt: "2026-10-22T00:00:00Z" },
  ];
  it("splits by status, sums exactly, ages from createdAt / reviewedAt", () => {
    const q = summarizeWithdrawals(rows, NOW)!;
    assert.equal(q.pending.count, 2);
    assert.equal(q.pending.totalDong, 2200000n);
    assert.equal(q.pending.oldestMinutes, 2 * 24 * 60);
    assert.equal(q.approved.count, 1);
    assert.equal(q.approved.totalDong, 12000000n);
    assert.equal(q.approved.oldestMinutes, 5 * 24 * 60); // from reviewedAt, not createdAt
    assert.equal(q.capped, false);
  });
  it("an empty list is a real zero", () => {
    const q = summarizeWithdrawals([], NOW)!;
    assert.equal(q.pending.count, 0);
    assert.equal(q.pending.totalDong, 0n);
    assert.equal(q.pending.oldestMinutes, null);
  });
  it("exactly 100 rows → capped (P7 take 100)", () => {
    const many = Array.from({ length: 100 }, () => ({ status: "PENDING", amount: "1000", createdAt: "2026-10-26T00:00:00Z" }));
    assert.equal(summarizeWithdrawals(many, NOW)!.capped, true);
  });
  it("an unreadable amount makes the TOTAL unknown (null), the count stays", () => {
    const q = summarizeWithdrawals([...rows, { status: "PENDING", amount: "??", createdAt: "2026-10-26T00:00:00Z" }], NOW)!;
    assert.equal(q.pending.count, 3);
    assert.equal(q.pending.totalDong, null);
  });
  it("a non-array answer is an error (null), not an empty queue", () => {
    assert.equal(summarizeWithdrawals(undefined, NOW), null);
    assert.equal(summarizeWithdrawals({ data: [] }, NOW), null);
  });
  it("a missing reviewedAt gives no age rather than a wrong one", () => {
    const q = summarizeWithdrawals([{ status: "APPROVED", amount: "1000", createdAt: "2026-10-01T00:00:00Z" }], NOW)!;
    assert.equal(q.approved.oldestMinutes, null);
  });
});

describe("formatVnDateTime", () => {
  it("shows Vietnam time (UTC+7)", () => {
    assert.match(txt(formatVnDateTime("2026-10-26T07:32:00.000Z")), /^26\/10\/2026 14:32$/);
  });
  it("— for missing / invalid", () => {
    assert.equal(formatVnDateTime(null), "—");
    assert.equal(formatVnDateTime("garbage"), "—");
  });
});
