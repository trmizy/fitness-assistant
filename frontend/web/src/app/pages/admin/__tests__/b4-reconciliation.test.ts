/**
 * B4 — pure part of "Tài chính › Đối soát": chip URL state, the 22 exception groups (+ the L2 P2 group), their counts and
 * `truncated`, P2 normaliser, drift-cause counts, the finance header (title per tab, refresh key sets).
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b4-reconciliation.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeObligationsReport, normalizeSessionsReport } from "../adminReconciliation.utils";
import { balanceVerdict, normalizeReconciliation, reconciliationFromHttpError } from "../adminFinanceOverview.utils";
import {
  ALL_GROUP_DEFS,
  EXCEPTION_GROUPS,
  GATEWAY_CHIP_REASON,
  GATEWAY_DISCREPANCY_CAP,
  GATEWAY_GROUP,
  GROUP_BY_TEST_ID,
  discrepancyDelta,
  driftCauseCounts,
  exceptionGroupStats,
  negativeWalletViews,
  normalizeGatewayDiscrepancies,
  overviewOfGroups,
  parseReconView,
  providerLabel,
  withReconView,
} from "../reconciliation/reconciliationView";
import {
  FINANCE_REFRESH_KEYS,
  FINANCE_TITLE,
  activeFinanceTab,
  financeRefreshKeys,
  financeTitle,
  keyHasPrefix,
  keyMatchesAny,
} from "../reconciliation/financeHeader";

const dir = dirname(fileURLToPath(import.meta.url));
const here = (...p: string[]) => readFileSync(join(dir, "..", ...p), "utf8");

// ───────────────────────────────────────────────────────────── fixtures ──
/** TEST FIXTURE — every count is different so a mis-wired group shows up. truncated flags set on a few lists only. */
function obligationsFixture() {
  return {
    success: true,
    data: {
      generatedAt: "2026-10-28T08:00:00.000Z",
      params: { limit: 50, staleMinutes: 30 },
      summary: {
        ptHoldback: {
          totalHeld: "9000000.00",
          contractsHolding: 7,
          waitingReconciliation: { count: 2, held: "1000000.00" },
          stuck: { count: 1, held: "500000.00" },
          overdue: { count: 3, reserved: "300000.00" },
        },
        negativeWallets: 2,
        negativeSubledgers: { count: 3, unbackedTotal: "150000.00" },
        walletMismatches: { count: 6, nonEscrowCount: 4 },
        receivables: { active: { count: 5, outstanding: "700000.00" }, suspended: { count: 1, outstanding: "100000.00" } },
        unpaidObligations: {
          open: { count: 8, unpaid: "800000.00" },
          underReview: { count: 9, unpaid: "900000.00" },
          approvedForPayment: { count: 10, unpaid: "1000000.00" },
          awaitingEvidence: { count: 11, unpaid: "1100000.00" },
          paidVerified: { count: 12, amount: "1200000.00" },
          paidExternally: { count: 13, amount: "1300000.00" },
          waived: { count: 14, unpaid: "1400000.00" },
          resolvedOther: { count: 15 },
          resolved: { count: 16 },
        },
        paidNotActivated: 17,
        targetUnverified: { status: "OK", candidates: 18 },
        productPayments: { lookup: "OK", activeValid: 40, cancelledPaid: 19, pendingVerification: 0, refundCompleted: 20, refundShort: 1 },
      },
      negativeWallets: [],
      negativeSubledgers: [],
      walletMismatches: [],
      ptHoldbacks: [],
      receivables: [],
      unpaidObligations: [],
      inFlightObligations: [],
      closedObligations: [],
      paidNotActivated: [],
      targetUnverified: { status: "OK", candidates: [] },
      cancelledPaid: [],
      refundOutcomes: [],
      truncated: { negativeWallets: true, closedObligations: true, refundOutcomes: true },
    },
  };
}

function sessionsFixture() {
  const item = (id: string) => ({ id, sessionId: id, contractId: `c-${id}` });
  return {
    generatedAt: "2026-10-28T08:00:00.000Z",
    needsAttention: { items: [item("a1"), item("a2")], truncated: false },
    endingsUnconfirmed: { items: [item("b1"), item("b2"), item("b3")], truncated: true },
    endedWithoutSettledEnding: { items: [], truncated: false },
    disputes: { items: [item("d1")], truncated: false, sla: { warnDays: 10, breachDays: 14 } },
  };
}

const gatewayTx = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  provider: "VNPAY",
  amount: "100000.00",
  status: "FAILED",
  metadata: {
    redirectUrl: "https://secret.example/pay?token=xxx",
    gatewayDiscrepancy: {
      kind: "AMOUNT_MISMATCH",
      source: "IPN",
      expectedAmountVnd: 100000,
      reportedAmountVnd: 90000,
      reportedMinorUnits: "9000000",
      gatewayTransactionNo: "14012345",
      firstDetectedAt: "2026-10-27T03:00:00.000Z",
      lastSeenAt: "2026-10-27T03:05:00.000Z",
      resolved: false,
      occurrences: 3,
      provider: "VNPAY",
      ...extra,
    },
  },
});

// ───────────────────────────────────────────────────────────── chip URL ──
describe("B4 chip state in the URL", () => {
  it("defaults to balance; only 'exceptions' selects the exceptions chip", () => {
    assert.equal(parseReconView(null), "balance");
    assert.equal(parseReconView(undefined), "balance");
    assert.equal(parseReconView(""), "balance");
    assert.equal(parseReconView("balance"), "balance");
    assert.equal(parseReconView("exceptions"), "exceptions");
    assert.equal(parseReconView(" Exceptions "), "exceptions");
  });

  it("keeps older deep links working: ledger = balance; gateway (disabled, L3) and junk fall back to balance", () => {
    assert.equal(parseReconView("ledger"), "balance");
    assert.equal(parseReconView("gateway"), "balance");
    assert.equal(parseReconView("nonsense"), "balance");
  });

  it("withReconView sets view and keeps every other param", () => {
    const next = withReconView(new URLSearchParams("y=1&view=balance"), "exceptions");
    assert.equal(next.get("view"), "exceptions");
    assert.equal(next.get("y"), "1");
    assert.equal(withReconView(new URLSearchParams(""), "balance").toString(), "view=balance");
  });
});

// ───────────────────────────────────────────────────── 22 nhóm ngoại lệ ──
describe("B4 exceptions — all 22 existing groups survive (T1: count them)", () => {
  it("registry has exactly 22 groups with unique ids and test ids", () => {
    assert.equal(EXCEPTION_GROUPS.length, 22);
    assert.equal(new Set(EXCEPTION_GROUPS.map((g) => g.id)).size, 22);
    assert.equal(new Set(EXCEPTION_GROUPS.map((g) => g.testId)).size, 22);
    assert.equal(EXCEPTION_GROUPS.filter((g) => g.source === "P13").length, 18);
    assert.equal(EXCEPTION_GROUPS.filter((g) => g.source === "U2").length, 4);
    for (const g of EXCEPTION_GROUPS) {
      assert.equal(g.level, "L1", g.id);
      assert.ok(g.title.trim().length > 3, g.id);
      assert.equal(g.testId, `recon-${g.id}`);
    }
  });

  it("the P2 gateway group is extra (L2) and is NOT one of the 22", () => {
    assert.equal(GATEWAY_GROUP.level, "L2");
    assert.equal(GATEWAY_GROUP.source, "P2");
    assert.ok(!EXCEPTION_GROUPS.some((g) => g.id === GATEWAY_GROUP.id));
    assert.equal(ALL_GROUP_DEFS.length, 23);
    assert.equal(GROUP_BY_TEST_ID["recon-gateway-discrepancies"], GATEWAY_GROUP);
  });

  it("the component source renders every registry group exactly once (23 <Block>s = 22 + P2) and reads count/truncated from stats", () => {
    const src = here("AdminReconciliationBlocks.tsx");
    const blocks = src.match(/<Block\b/g) ?? [];
    assert.equal(blocks.length, 23);
    for (const g of ALL_GROUP_DEFS) {
      const occurrences = src.split(`testId="${g.testId}"`).length - 1;
      assert.equal(occurrences, 1, `${g.testId} rendered ${occurrences}x`);
    }
    for (const g of EXCEPTION_GROUPS) {
      assert.ok(src.includes(`stats["${g.id}"].count`), `${g.id} count not wired to stats`);
      assert.ok(src.includes(`stats["${g.id}"].truncated`), `${g.id} truncated not wired to stats`);
    }
  });

  it("every group reports its own count and truncated flag (distinct numbers expose cross-wiring)", () => {
    const stats = exceptionGroupStats(normalizeObligationsReport(obligationsFixture()), normalizeSessionsReport(sessionsFixture()));
    assert.equal(Object.keys(stats).length, 22);
    const counts = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.count]));
    assert.deepEqual(counts, {
      "negative-subledgers": 3,
      "negative-wallets": 2,
      "wallet-mismatch": 4, // non-escrow only (6 incl. escrow lines)
      "pt-holdback": 7,
      receivables: 6, // 5 active + 1 suspended
      "obligations-open": 8,
      "obligations-under-review": 9,
      "obligations-approved": 10,
      "obligations-awaiting": 11,
      "obligations-paid-verified": 12,
      "obligations-unverified": 13,
      "obligations-waived": 14,
      "obligations-resolved-other": 15,
      "obligations-legacy": 16,
      "paid-not-activated": 17,
      "cancelled-paid": 19,
      "refund-outcomes": 21, // 20 completed + 1 short
      "target-unverified": 18,
      "needs-attention": 2,
      "endings-unconfirmed": 3,
      "ended-unsettled": 0,
      disputes: 1,
    });
    for (const g of EXCEPTION_GROUPS) assert.ok(stats[g.id], g.id);
  });

  it("`truncated` is carried per group from the backend flags (closedObligations → all 5 closed groups; sessions per list)", () => {
    const stats = exceptionGroupStats(normalizeObligationsReport(obligationsFixture()), normalizeSessionsReport(sessionsFixture()));
    const truncated = Object.entries(stats).filter(([, v]) => v.truncated).map(([k]) => k).sort();
    assert.deepEqual(truncated, [
      "endings-unconfirmed",
      "negative-wallets",
      "obligations-legacy",
      "obligations-paid-verified",
      "obligations-resolved-other",
      "obligations-unverified",
      "obligations-waived",
      "refund-outcomes",
    ]);
    const ov = overviewOfGroups(stats);
    assert.equal(ov.total, 22);
    assert.equal(ov.known, 22);
    assert.equal(ov.withItems, 21); // only ended-unsettled is empty
    assert.equal(ov.truncated, 8);
  });

  it("a source that has not loaded contributes NO entries — unknown is never turned into 0", () => {
    const onlySessions = exceptionGroupStats(null, normalizeSessionsReport(sessionsFixture()));
    assert.equal(Object.keys(onlySessions).length, 4);
    assert.equal(onlySessions["negative-wallets"], undefined);
    const onlyPayment = exceptionGroupStats(normalizeObligationsReport(obligationsFixture()), null);
    assert.equal(Object.keys(onlyPayment).length, 18);
    assert.equal(onlyPayment["disputes"], undefined);
    assert.equal(overviewOfGroups(onlyPayment).known, 18);
    assert.deepEqual(exceptionGroupStats(null, null), {});
  });

  it("empty exceptions: all 22 groups present with count 0, none truncated", () => {
    const f = obligationsFixture();
    const empty = {
      ...f,
      data: {
        ...f.data,
        summary: {
          ...f.data.summary,
          ptHoldback: { totalHeld: "0", contractsHolding: 0, waitingReconciliation: { count: 0, held: "0" }, stuck: { count: 0, held: "0" }, overdue: { count: 0, reserved: "0" } },
          negativeWallets: 0,
          negativeSubledgers: { count: 0, unbackedTotal: "0" },
          walletMismatches: { count: 0, nonEscrowCount: 0 },
          receivables: { active: { count: 0, outstanding: "0" }, suspended: { count: 0, outstanding: "0" } },
          unpaidObligations: {
            open: { count: 0, unpaid: "0" },
            underReview: { count: 0, unpaid: "0" },
            approvedForPayment: { count: 0, unpaid: "0" },
            awaitingEvidence: { count: 0, unpaid: "0" },
            paidVerified: { count: 0, amount: "0" },
            paidExternally: { count: 0, amount: "0" },
            waived: { count: 0, unpaid: "0" },
            resolvedOther: { count: 0 },
            resolved: { count: 0 },
          },
          paidNotActivated: 0,
          targetUnverified: { status: "OK", candidates: 0 },
          productPayments: { lookup: "OK", activeValid: 0, cancelledPaid: 0, pendingVerification: 0, refundCompleted: 0, refundShort: 0 },
        },
        truncated: {},
      },
    };
    const none = { generatedAt: "", needsAttention: { items: [] }, endingsUnconfirmed: { items: [] }, endedWithoutSettledEnding: { items: [] }, disputes: { items: [] } };
    const stats = exceptionGroupStats(normalizeObligationsReport(empty), normalizeSessionsReport(none));
    assert.equal(Object.keys(stats).length, 22);
    assert.ok(Object.values(stats).every((s) => s.count === 0 && !s.truncated));
    const ov = overviewOfGroups(stats);
    assert.deepEqual({ known: ov.known, withItems: ov.withItems, truncated: ov.truncated }, { known: 22, withItems: 0, truncated: 0 });
  });
});

// ─────────────────────────────────────────────────── P2 sai lệch số tiền cổng ──
describe("B4 P2 gateway discrepancies (E-11)", () => {
  it("reads expected vs reported, gateway, gateway txn no, occurrences, first-detected, and nothing else", () => {
    const rep = normalizeGatewayDiscrepancies({ success: true, data: [gatewayTx("tx-1")] });
    assert.ok(rep);
    assert.equal(rep.rows.length, 1);
    const r = rep.rows[0];
    assert.equal(r.transactionId, "tx-1");
    assert.equal(r.provider, "VNPAY");
    assert.equal(providerLabel(r.provider), "VNPay");
    assert.equal(r.gatewayTransactionNo, "14012345");
    assert.equal(r.expectedAmount, 100000);
    assert.equal(r.reportedAmount, 90000);
    assert.equal(r.occurrences, 3);
    assert.equal(r.firstDetectedAt, "2026-10-27T03:00:00.000Z");
    assert.equal(r.resolved, false);
    assert.ok(!JSON.stringify(r).includes("redirectUrl") && !JSON.stringify(r).includes("secret.example"), "no redirectUrl leaks into the view model");
    assert.equal(rep.truncated, false);
  });

  it("difference is exact bigint text; unreadable amounts give '—', never 0", () => {
    assert.match(discrepancyDelta(100000, 90000), /^-?10\.000\s?₫$/);
    assert.match(discrepancyDelta("100000.00", "110000"), /^\+10\.000\s?₫$/);
    assert.equal(discrepancyDelta(100000, undefined), "—");
    assert.equal(discrepancyDelta("abc", 5), "—");
  });

  it("accepts the bare array, skips rows without gatewayDiscrepancy, and flags the 200-row cap as truncated", () => {
    const mixed = normalizeGatewayDiscrepancies([gatewayTx("a"), { id: "b", provider: "PAYOS", metadata: {} }, { id: "c", metadata: null }]);
    assert.equal(mixed?.rows.length, 1);
    const cap = normalizeGatewayDiscrepancies({ data: Array.from({ length: GATEWAY_DISCREPANCY_CAP }, (_, i) => gatewayTx(`t${i}`)) });
    assert.equal(cap?.truncated, true);
    assert.equal(cap?.rows.length, GATEWAY_DISCREPANCY_CAP);
    const empty = normalizeGatewayDiscrepancies({ success: true, data: [] });
    assert.deepEqual(empty, { rows: [], truncated: false });
  });

  it("an unusable body is null (the screen shows a load error, not 'no discrepancies')", () => {
    assert.equal(normalizeGatewayDiscrepancies(null), null);
    assert.equal(normalizeGatewayDiscrepancies({ data: "x" }), null);
    assert.equal(normalizeGatewayDiscrepancies({ success: false }), null);
  });
});

// ───────────────────────────────────────────────── cân đối sổ — 409, nguyên nhân ──
describe("B4 balance chip", () => {
  const driftBody = {
    success: false,
    data: {
      escrow: "590800000.00",
      claims: "590700000.00",
      drift: "100000.00",
      balanced: false,
      breakdown: { clientBalances: "184250000.00", ptPending: "96400000.00" },
      negativeWallets: [{ id: "w1", ownerType: "CLIENT", ownerId: "0123456789abcdef", available: "-50000.00", pending: "0.00" }, null],
    },
  };

  it("HTTP 409 carries the report: it is a drift, not a load error (E-01)", () => {
    const report = reconciliationFromHttpError({ response: { status: 409, data: driftBody } });
    assert.ok(report);
    const v = balanceVerdict(report);
    assert.equal(v.balanced, false);
    assert.equal(v.driftCents, 10_000_000n);
    assert.equal(reconciliationFromHttpError({ response: { status: 500, data: driftBody } }), null);
    assert.equal(reconciliationFromHttpError({ response: { status: 403, data: driftBody } }), null);
  });

  it("an unreadable P3 body is rejected, never read as 0", () => {
    assert.equal(normalizeReconciliation({ data: { escrow: "x", claims: "1", drift: "0", balanced: true } }), null);
  });

  it("negative wallets: money read through the bigint parser, junk rows survive as '—'", () => {
    const report = normalizeReconciliation(driftBody);
    assert.ok(report);
    const rows = negativeWalletViews(report);
    assert.equal(rows.length, 2);
    assert.match(rows[0].availableText, /^-50\.000\s?₫$/);
    assert.equal(rows[0].ownerType, "CLIENT");
    assert.equal(rows[1].availableText, "—");
  });

  it("drift-cause counts: unknown until the obligations report loads, then the report's own counts", () => {
    assert.deepEqual(driftCauseCounts(null), { negativeWallets: null, walletMismatches: null, negativeSubledgers: null });
    assert.deepEqual(driftCauseCounts(normalizeObligationsReport(obligationsFixture())), { negativeWallets: 2, walletMismatches: 4, negativeSubledgers: 3 });
  });
});

// ──────────────────────────────────────────────────────── ghi chú mức / nguồn ──
describe("B4 level labels and source rules", () => {
  it("the gateway chip is L3 BLOCKED — never 'partial'", () => {
    assert.match(GATEWAY_CHIP_REASON, /L3/);
    assert.match(GATEWAY_CHIP_REASON, /BLOCKED/);
    assert.doesNotMatch(GATEWAY_CHIP_REASON.toLowerCase(), /một phần|partial/);
  });

  it("no fake action: the screen sources contain no 'mark as reconciled' / 'Đánh dấu đã đối soát' control", () => {
    for (const f of ["AdminReconciliationPanel.tsx", "AdminReconciliationBlocks.tsx", "reconciliation/BalanceView.tsx", "reconciliation/ExceptionParts.tsx"]) {
      const src = here(f);
      assert.doesNotMatch(src, /Đánh dấu đã đối soát|Mark as reconciled|mark as reconciled/i, f);
    }
  });

  it("money on the new screens goes through the bigint formatter, not Number()/formatVND", () => {
    for (const f of ["reconciliation/BalanceView.tsx", "AdminReconciliationBlocks.tsx", "reconciliation/reconciliationView.ts"]) {
      // comments may mention the rule; only code counts
      const code = here(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /formatVND/, f);
      assert.doesNotMatch(code, /\bNumber\(/, f);
    }
  });

  it("no per-group or cross-group money total is computed on the exceptions screen", () => {
    const src = here("AdminReconciliationBlocks.tsx");
    assert.doesNotMatch(src, /addAmounts|sumAmounts|sumCents|reduce\(/);
  });

  it("the three level sentences exist on both chips", () => {
    assert.match(here("reconciliation/BalanceView.tsx"), /level="L1"/);
    assert.match(here("AdminReconciliationBlocks.tsx"), /level="L1"/);
    assert.match(here("AdminReconciliationPanel.tsx"), /RECON_VIEW_LEVEL/);
  });
});

// ─────────────────────────────────────────────────────────── header Tài chính ──
describe("B4 finance header", () => {
  const TABS = [
    { key: "overview" as const, to: "/admin/finance", end: true },
    { key: "reconciliation" as const, to: "/admin/finance/reconciliation" },
    { key: "withdrawals" as const, to: "/admin/finance/withdrawals" },
    { key: "refunds" as const, to: "/admin/finance/refunds" },
  ];

  it("title follows the active tab", () => {
    const t = (p: string) => financeTitle(activeFinanceTab(TABS, p)?.key ?? null);
    assert.equal(t("/admin/finance"), "Tổng quan tài chính");
    assert.equal(t("/admin/finance/"), "Tổng quan tài chính");
    assert.equal(t("/admin/finance/reconciliation"), "Đối soát");
    assert.equal(t("/admin/finance/withdrawals"), "Rút tiền");
    assert.equal(t("/admin/finance/refunds"), "Hoàn tiền");
    assert.equal(t("/admin/finance/refunds/"), "Hoàn tiền");
    assert.equal(t("/admin/elsewhere"), "Tài chính");
    assert.equal(Object.keys(FINANCE_TITLE).length, 4);
  });

  it("the real tab list in adminNav matches (4 tabs, same keys)", () => {
    const nav = here("..", "..", "components", "layout", "admin", "adminNav.ts");
    for (const t of TABS) assert.ok(nav.includes(`key: "${t.key}"`), t.key);
  });

  it("header refresh re-reads exactly the active tab's query families", () => {
    const rec = ["admin", "finance", "reconciliation"];
    const obl = ["admin", "finance", "obligations-report"];
    const ses = ["admin", "finance", "sessions-reconciliation"];
    const gw = ["admin", "finance", "gateway-discrepancies"];
    const period = ["admin", "finance-overview", "day", "2026-10-01", "2026-10-28"];
    const wd = ["admin", "pending-withdrawals"];
    const rf = ["refund-requests"];
    const matches = (tab: Parameters<typeof financeRefreshKeys>[0], key: string[]) => keyMatchesAny(key, financeRefreshKeys(tab));

    for (const k of [rec, obl, ses, gw]) assert.ok(matches("reconciliation", k), k.join("/"));
    assert.ok(!matches("reconciliation", wd));
    assert.ok(!matches("reconciliation", rf));
    assert.ok(!matches("reconciliation", period));

    for (const k of [rec, obl, ses, period, wd, rf]) assert.ok(matches("overview", k), k.join("/"));

    assert.ok(matches("withdrawals", wd));
    assert.ok(!matches("withdrawals", rec) && !matches("withdrawals", rf));

    assert.ok(matches("refunds", rf));
    assert.ok(matches("refunds", ["refund-calculation", "order-1"]));
    assert.ok(!matches("refunds", wd) && !matches("refunds", rec));

    assert.deepEqual(financeRefreshKeys(null), []);
    assert.equal(Object.keys(FINANCE_REFRESH_KEYS).length, 4);
  });

  it("prefix matching is by whole segments", () => {
    assert.ok(keyHasPrefix(["admin", "finance", "x"], ["admin", "finance"]));
    assert.ok(!keyHasPrefix(["admin", "finance-overview"], ["admin", "finance"]));
    assert.ok(!keyHasPrefix(["admin"], ["admin", "finance"]));
  });

  it("the query keys used by the data hooks are covered by the reconciliation refresh set", () => {
    const src = here("reconciliation", "useReconciliationData.ts");
    for (const k of ["reconciliation", "obligations-report", "sessions-reconciliation", "gateway-discrepancies"]) {
      assert.ok(src.includes(`["admin", "finance", "${k}"]`), k);
    }
  });
});
