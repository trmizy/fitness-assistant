/**
 * D1 fix A - PAID_VIA_LEDGER ("Đã trả vào ví Gymini") in the reconciliation report: label, tone, summary count, its own block.
 * Evidence label: TEST FIXTURE (pure functions + component source inspection; nothing rendered, no server).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d1-reconciliation-paid-via-ledger.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OBLIGATION_STATUS_LABEL, countAttention, normalizeObligationsReport, obligationStatusLabel, obligationTone, rowsWithStatus } from "../adminReconciliation.utils";
import { ALL_GROUP_DEFS, EXCEPTION_GROUPS, exceptionGroupStats } from "../reconciliation/reconciliationView";

const dir = dirname(fileURLToPath(import.meta.url));
const blocksSrc = readFileSync(join(dir, "..", "AdminReconciliationBlocks.tsx"), "utf8");

const row = (id: string, status: string) => ({ id, kind: "LATE_ARRIVAL", party: "CLIENT", status, owed: "250000.00", paid: "250000.00", unpaid: "0.00", contractId: "c-1", sessionId: "s-1" });
const report = (unpaid: Record<string, unknown>, closed: unknown[], truncated: Record<string, boolean> = {}) =>
  normalizeObligationsReport({ success: true, data: { summary: { unpaidObligations: unpaid }, closedObligations: closed, truncated } })!;

describe("D1 PAID_VIA_LEDGER - label and tone", () => {
  it("has the Vietnamese label 'Đã trả vào ví Gymini' (not 'Chưa rõ')", () => {
    assert.equal(OBLIGATION_STATUS_LABEL.PAID_VIA_LEDGER, "Đã trả vào ví Gymini");
    assert.equal(obligationStatusLabel("PAID_VIA_LEDGER"), "Đã trả vào ví Gymini");
    assert.notEqual(obligationStatusLabel("PAID_VIA_LEDGER"), "Chưa rõ");
    assert.ok(!/ngân hàng|chuyển khoản/i.test(obligationStatusLabel("PAID_VIA_LEDGER")));
  });
  it("has its own tone: not 'verified', not 'closed', not 'unverified'", () => {
    assert.equal(obligationTone("PAID_VIA_LEDGER"), "ledgerPaid");
    assert.notEqual(obligationTone("PAID_VIA_LEDGER"), obligationTone("PAID_VERIFIED"));
    assert.notEqual(obligationTone("PAID_VIA_LEDGER"), "closed");
    assert.notEqual(obligationTone("PAID_VIA_LEDGER"), "unverified");
  });
  it("the pre-existing tones are unchanged", () => {
    assert.equal(obligationTone("PAID_VERIFIED"), "verified");
    assert.equal(obligationTone("PAID_EXTERNALLY"), "unverified");
    assert.equal(obligationTone("APPROVED_FOR_PAYMENT"), "pending");
    assert.equal(obligationTone("OPEN"), "open");
    assert.equal(obligationTone("WAIVED"), "closed");
    assert.equal(obligationTone(undefined), "closed");
  });
});

describe("D1 PAID_VIA_LEDGER - summary.paidViaLedger", () => {
  it("is read from the payment-service summary ({count} only, there is no amount)", () => {
    const r = report({ paidViaLedger: { count: 4 }, paidVerified: { count: 3, amount: "900000.00" } }, []);
    assert.deepEqual(r.summary.unpaidObligations.paidViaLedger, { count: 4 });
    assert.deepEqual(r.summary.unpaidObligations.paidVerified, { count: 3, amount: "900000.00" });
  });
  it("an older server without the field gives 0 (not NaN, not a crash)", () => {
    assert.deepEqual(report({}, []).summary.unpaidObligations.paidViaLedger, { count: 0 });
    assert.deepEqual(normalizeObligationsReport({ data: { summary: {} } })!.summary.unpaidObligations.paidViaLedger, { count: 0 });
  });
  it("it is a closed group: not counted as 'cần chú ý'", () => {
    const r = report({ paidViaLedger: { count: 9 } }, [row("o1", "PAID_VIA_LEDGER")]);
    assert.equal(countAttention(r, null).watch, 0);
    assert.equal(countAttention(r, null).critical, 0);
  });
});

describe("D1 PAID_VIA_LEDGER - its own group in the exceptions registry", () => {
  it("registry holds it once, as a closed-obligation P13 group, separate from paid-verified", () => {
    const g = EXCEPTION_GROUPS.filter((x) => x.id === "obligations-paid-via-ledger");
    assert.equal(g.length, 1);
    assert.equal(g[0].testId, "recon-obligations-paid-via-ledger");
    assert.equal(g[0].source, "P13");
    assert.equal(g[0].level, "L1");
    assert.equal(g[0].title, "Đã trả vào ví Gymini");
    assert.notEqual(g[0].id, "obligations-paid-verified");
    assert.equal(EXCEPTION_GROUPS.length, 23, "22 original groups + this one");
    assert.equal(ALL_GROUP_DEFS.length, 24, "+ the P2 gateway group");
  });
  it("count comes from summary.paidViaLedger and truncated from closedObligations; paid-verified count is untouched", () => {
    const r = report({ paidViaLedger: { count: 7 }, paidVerified: { count: 3, amount: "1" } }, [], { closedObligations: true });
    const stats = exceptionGroupStats(r, null);
    assert.deepEqual(stats["obligations-paid-via-ledger"], { count: 7, truncated: true });
    assert.equal(stats["obligations-paid-verified"].count, 3);
  });
});

describe("D1 PAID_VIA_LEDGER - rows are visible (they used to vanish while still being counted)", () => {
  it("rowsWithStatus: a PAID_VIA_LEDGER row appears in its block and NOT in the 'verified' block", () => {
    const r = report({}, [row("a", "PAID_VERIFIED"), row("b", "PAID_VIA_LEDGER"), row("c", "WAIVED")]);
    assert.deepEqual(rowsWithStatus(r.closedObligations, "PAID_VIA_LEDGER").map((x) => x.id), ["b"]);
    assert.deepEqual(rowsWithStatus(r.closedObligations, "PAID_VERIFIED").map((x) => x.id), ["a"]);
  });
  it("the component renders the new block exactly once, with its own rows and columns", () => {
    assert.equal(blocksSrc.split('testId="recon-obligations-paid-via-ledger"').length - 1, 1);
    assert.ok(blocksSrc.includes('rowsWithStatus(r.closedObligations, "PAID_VIA_LEDGER")'));
    assert.ok(blocksSrc.includes('stats["obligations-paid-via-ledger"].count'));
    assert.ok(blocksSrc.includes('stats["obligations-paid-via-ledger"].truncated'));
    assert.ok(blocksSrc.includes("ledgerPaid:"), "tone has a class");
  });
  it("every status the server puts in closedObligations has a block (regression: none may vanish again)", () => {
    for (const status of ["PAID_VERIFIED", "PAID_VIA_LEDGER", "PAID_EXTERNALLY", "WAIVED", "RESOLVED_OTHER", "RESOLVED"]) {
      assert.ok(blocksSrc.includes(`rowsWithStatus(r.closedObligations, "${status}")`), status);
    }
  });
  it("the new block's wording says wallet, not bank, and is not merged with the verified wording", () => {
    const start = blocksSrc.indexOf('testId="recon-obligations-paid-via-ledger"');
    const end = blocksSrc.indexOf("</Block>", start);
    const block = blocksSrc.slice(start, end);
    assert.match(block, /ví Gymini/);
    assert.match(block, /không phải chuyển khoản ngân hàng/);
    assert.ok(!/title="Đã thanh toán được xác minh"/.test(block));
  });
});
