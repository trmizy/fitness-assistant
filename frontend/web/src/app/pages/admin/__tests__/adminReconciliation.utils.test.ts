/**
 * Đối soát (FH-4 phần 2) — phần thuần: nhãn, định dạng, chuẩn hoá phản hồi, đếm "cần chú ý".
 * Nhãn và quy tắc ở đây phải khớp enum thật của payment-service / user-service (xem schema.prisma của hai service).
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/adminReconciliation.utils.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OBLIGATION_KIND_LABEL,
  SETTLEMENT_KIND_LABEL,
  SETTLEMENT_STATUS_LABEL,
  TERMINATION_REASON_LABEL,
  activationLabel,
  attentionReasonLabel,
  countAttention,
  formatAge,
  normalizeObligationsReport,
  normalizeSessionsReport,
  obligationKindLabel,
  partyLabel,
  purposeLabel,
  shortId,
  slaLabel,
  sumAmounts,
  toAmount,
} from "../adminReconciliation.utils";

const paymentFixture = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    generatedAt: "2026-10-20T01:00:00.000Z",
    params: { limit: 50, staleMinutes: 30 },
    summary: {
      negativeWallets: 0,
      negativeSubledgers: { count: 1, unbackedTotal: "50000.00" },
      walletMismatches: { count: 2, nonEscrowCount: 1 },
      receivables: { active: { count: 2, outstanding: "100000.00" }, suspended: { count: 1, outstanding: "20000.00" } },
      unpaidObligations: { open: { count: 2, unpaid: "500000.00" }, resolved: { count: 3 }, waived: { count: 1 } },
      paidNotActivated: 1,
      targetUnverified: { status: "TARGET_STATUS_UNVERIFIED", candidates: 4 },
    },
    negativeWallets: [],
    negativeSubledgers: [{ ownerType: "PT", owner: "pt-fhf", transactionId: "t", transactionShortId: "t", net: "-50000.00", entries: 3, firstEntry: null, lastEntry: null }],
    walletMismatches: [],
    receivables: [],
    unpaidObligations: [],
    paidNotActivated: [],
    targetUnverified: { status: "TARGET_STATUS_UNVERIFIED", candidates: [] },
    truncated: { receivables: true },
    ...over,
  },
});

const sessionsFixture = () => ({
  generatedAt: "2026-10-20T01:00:00.000Z",
  params: {},
  needsAttention: { items: [{ id: "a" }], truncated: false },
  endingsUnconfirmed: { items: [], truncated: false },
  endedWithoutSettledEnding: { items: [{ contractId: "c1" }, { contractId: "c2" }], truncated: true },
  disputes: { items: [{ sessionId: "s" }], truncated: false, sla: { warnDays: 10, breachDays: 14 } },
});

describe("labels follow the real enums and never leak a raw code to the admin", () => {
  it("ContractUnpaidObligationKind (payment-service)", () => {
    for (const k of ["NO_SHOW", "LATE_ARRIVAL", "REFUND_SHORT", "OVER_RELEASED"]) assert.ok(OBLIGATION_KIND_LABEL[k], k);
    assert.equal(obligationKindLabel("SOMETHING_NEW"), "Nghĩa vụ khác");
    assert.equal(obligationKindLabel(null), "Nghĩa vụ khác");
  });
  it("SessionSettlementKind / Status and TerminationReason (user-service)", () => {
    for (const k of ["SESSION_RELEASE", "PT_NO_SHOW_COMPENSATION", "CONTRACT_TERMINATION", "PT_LATE_ARRIVAL_COMPENSATION", "UNRESOLVED_SESSION_RESOLUTION"]) {
      assert.ok(SETTLEMENT_KIND_LABEL[k], k);
    }
    for (const k of ["PENDING", "PROCESSING", "SETTLED", "FAILED", "UNCONFIRMED", "NEEDS_HUMAN", "CONFLICT"]) assert.ok(SETTLEMENT_STATUS_LABEL[k], k);
    for (const k of ["CLIENT_CANCELLED", "PT_BANNED", "PT_CANCELLED", "MUTUAL", "EXPIRED", "COMPLETED", "PT_REPEATED_NO_SHOW", "CLIENT_EXIT_DUE_TO_PT_RESTRICTION"]) {
      assert.ok(TERMINATION_REASON_LABEL[k], k);
    }
  });
  it("unknown codes fall back to plain Vietnamese, never the enum text", () => {
    assert.equal(partyLabel("CLIENT"), "Khách hàng");
    assert.equal(partyLabel("ZZZ"), "Khác");
    assert.equal(purposeLabel("PT_CONTRACT"), "Hợp đồng PT");
    assert.equal(activationLabel("ACTIVATION_FAILED"), "Kích hoạt lỗi");
    assert.equal(attentionReasonLabel("STUCK_PROCESSING"), "Kẹt khi đang xử lý");
    assert.equal(slaLabel("OVERDUE"), "Quá hạn");
    assert.ok(!/[A-Z]{3,}_[A-Z]{2,}/.test(attentionReasonLabel("WHATEVER_NEW_REASON")));
  });
});

describe("formatting", () => {
  it("formatAge", () => {
    assert.equal(formatAge(5), "5 phút");
    assert.equal(formatAge(59.9), "59 phút");
    assert.equal(formatAge(60), "1 giờ");
    assert.equal(formatAge(60 * 47), "47 giờ");
    assert.equal(formatAge(60 * 48), "2 ngày");
    assert.equal(formatAge(-1), "—");
    assert.equal(formatAge(undefined), "—");
    assert.equal(formatAge(NaN), "—");
  });
  it("shortId / toAmount / sumAmounts", () => {
    assert.equal(shortId("abcdef1234567890"), "abcdef12");
    assert.equal(shortId(null), "—");
    assert.equal(toAmount("70000.00"), 70000);
    assert.equal(toAmount(12.5), 12.5);
    assert.equal(toAmount(""), null);
    assert.equal(toAmount("abc"), null);
    assert.equal(toAmount(null), null);
    assert.equal(sumAmounts(["100.50", 20, null, "x"]), 120.5);
  });
});

describe("normalizers", () => {
  it("accepts the {success,data} wrapper and the unwrapped body", () => {
    const wrapped = normalizeObligationsReport(paymentFixture());
    const bare = normalizeObligationsReport(paymentFixture().data);
    assert.ok(wrapped && bare);
    assert.deepEqual(wrapped, bare);
    assert.equal(wrapped!.summary.receivables.suspended.outstanding, "20000.00");
  });
  it("missing arrays / flags become empty / false instead of crashing the page", () => {
    const r = normalizeObligationsReport({ data: { summary: { receivables: {} } } });
    assert.ok(r);
    assert.deepEqual(r!.receivables, []);
    assert.deepEqual(r!.targetUnverified.candidates, []);
    assert.equal(r!.truncated.receivables, false);
    assert.equal(r!.summary.unpaidObligations.open.count, 0);
  });
  it("garbage becomes null, which the page shows as a retryable load error", () => {
    assert.equal(normalizeObligationsReport(null), null);
    assert.equal(normalizeObligationsReport({ success: false }), null);
    assert.equal(normalizeObligationsReport("html error page"), null);
    assert.equal(normalizeSessionsReport(undefined), null);
    assert.equal(normalizeSessionsReport({ error: "Permission denied" }), null);
  });
  it("sessions report keeps items + truncated per group", () => {
    const r = normalizeSessionsReport(sessionsFixture());
    assert.ok(r);
    assert.equal(r!.needsAttention.items.length, 1);
    assert.equal(r!.endedWithoutSettledEnding.truncated, true);
    assert.equal(r!.disputes.sla?.breachDays, 14);
    assert.deepEqual(normalizeSessionsReport({ needsAttention: {} })!.disputes.items, []);
  });
});

describe("countAttention", () => {
  it("separates 'look now' (ledger defects, stuck payments, parked settlements) from 'keep an eye on'", () => {
    const p = normalizeObligationsReport(paymentFixture());
    const s = normalizeSessionsReport(sessionsFixture());
    // critical: subledger 1 + non-escrow mismatch 1 + paid-not-activated 1 + needsAttention 1 + endedWithoutSettled 2
    // watch: receivables 2+1 + open obligations 2 + endingsUnconfirmed 0 + disputes 1
    assert.deepEqual(countAttention(p, s), { critical: 6, watch: 6 });
    // 'Chưa xác minh trạng thái' (4 unverified rows in the fixture) is information: it must not inflate either number.
  });
  it("uses the server's exact counts, not the length of a truncated list", () => {
    const p = normalizeObligationsReport(paymentFixture())!;
    assert.equal(p.receivables.length, 0);
    assert.equal(countAttention(p, null).watch, 3 + 2);
  });
  it("a clean ledger is all zeros, and an unavailable source counts as nothing (the page shows its own error)", () => {
    assert.deepEqual(countAttention(null, null), { critical: 0, watch: 0 });
    const clean = normalizeObligationsReport({ data: { summary: {} } });
    assert.deepEqual(countAttention(clean, normalizeSessionsReport({ needsAttention: {} })), { critical: 0, watch: 0 });
  });
  it("'Chưa xác minh trạng thái' rows are neutral information: they never add to critical or watch", () => {
    const base = paymentFixture().data.summary;
    const none = normalizeObligationsReport(paymentFixture({ summary: { ...base, targetUnverified: { status: "TARGET_STATUS_UNVERIFIED", candidates: 0 } } }))!;
    const many = normalizeObligationsReport(paymentFixture({ summary: { ...base, targetUnverified: { status: "TARGET_STATUS_UNVERIFIED", candidates: 40 } } }))!;
    assert.equal(many.summary.targetUnverified.candidates, 40);
    assert.deepEqual(countAttention(many, null), countAttention(none, null));
  });
  it("a mismatch on the ESCROW row alone is information, not a defect", () => {
    const p = normalizeObligationsReport(
      paymentFixture({ summary: { ...paymentFixture().data.summary, walletMismatches: { count: 1, nonEscrowCount: 0 }, negativeSubledgers: { count: 0, unbackedTotal: "0" }, paidNotActivated: 0 } }),
    );
    assert.equal(countAttention(p, null).critical, 0);
  });
});
