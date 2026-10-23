/**
 * Đối soát (FH-4 phần 2) — phần thuần: nhãn, định dạng, chuẩn hoá phản hồi, đếm "cần chú ý".
 * Nhãn và quy tắc ở đây phải khớp enum thật của payment-service / user-service (xem schema.prisma của hai service).
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/adminReconciliation.utils.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PAYMENT_SOURCE_LABEL,
  OBLIGATION_ACTION_LABEL,
  OBLIGATION_KIND_LABEL,
  OBLIGATION_STATUS_LABEL,
  PRODUCT_OUTCOME_LABEL,
  SETTLEMENT_KIND_LABEL,
  SETTLEMENT_STATUS_LABEL,
  TERMINATION_REASON_LABEL,
  activationLabel,
  attentionReasonLabel,
  countAttention,
  formatAge,
  formatObligationEvent,
  formatPendingPayment,
  normalizeObligationsReport,
  normalizeSessionsReport,
  obligationActionLabel,
  obligationKindLabel,
  obligationStatusLabel,
  obligationTone,
  paymentSourceLabel,
  rowsWithStatus,
  partyLabel,
  productLookupNote,
  productOutcomeLabel,
  productTargetStatusLabel,
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
      unpaidObligations: {
        open: { count: 2, unpaid: "500000.00" },
        underReview: { count: 0, unpaid: "0.00" },
        paidExternally: { count: 0, amount: "0.00" },
        waived: { count: 1, unpaid: "0.00" },
        resolved: { count: 3 },
      },
      paidNotActivated: 1,
      targetUnverified: { status: "TARGET_STATUS_UNVERIFIED", candidates: 4 },
      productPayments: { lookup: "PARTIAL", activeValid: 5, cancelledPaid: 0, pendingVerification: 4, refundCompleted: 0, refundShort: 0 },
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

// ───────────────────────────────────────────────────────────── FH-4 tra cứu thật + FH-8 bằng chứng ──
const fmt = (v: string | number | null | undefined) => `${v}đ`;

describe("FH-4 product payments: groups, labels, attention", () => {
  const summary = (over: Record<string, unknown>) => {
    const base = paymentFixture().data.summary;
    return paymentFixture({ summary: { ...base, ...over } });
  };
  const pp = (over: Record<string, unknown>) => ({ lookup: "OK", activeValid: 0, cancelledPaid: 0, pendingVerification: 0, refundCompleted: 0, refundShort: 0, ...over });

  it("older payment-service builds without the new groups still normalise to empty lists and NOT_CHECKED", () => {
    const r = normalizeObligationsReport({ data: { summary: {} } });
    assert.ok(r);
    assert.equal(r!.summary.productPayments.lookup, "NOT_CHECKED");
    assert.equal(r!.summary.productPayments.cancelledPaid, 0);
    assert.deepEqual(r!.cancelledPaid, []);
    assert.deepEqual(r!.refundOutcomes, []);
    assert.deepEqual(r!.closedObligations, []);
    assert.equal(r!.summary.unpaidObligations.underReview.count, 0);
    assert.equal(r!.summary.unpaidObligations.paidExternally.amount, "0");
  });

  it("keeps the groups the server sent", () => {
    const p = normalizeObligationsReport(
      paymentFixture({
        summary: { ...paymentFixture().data.summary, productPayments: pp({ lookup: "PARTIAL", activeValid: 7, cancelledPaid: 1, refundShort: 2, refundCompleted: 3, pendingVerification: 4 }) },
        cancelledPaid: [{ transactionId: "t1", outcome: "CANCELLED_PAID" }],
        refundOutcomes: [{ transactionId: "t2", outcome: "REFUND_SHORT" }],
      }),
    )!;
    assert.equal(p.summary.productPayments.lookup, "PARTIAL");
    assert.equal(p.summary.productPayments.activeValid, 7);
    assert.equal(p.cancelledPaid.length, 1);
    assert.equal(p.refundOutcomes[0].outcome, "REFUND_SHORT");
  });

  it("an unknown lookup state falls back to NOT_CHECKED instead of crashing", () => {
    const p = normalizeObligationsReport(summary({ productPayments: pp({ lookup: "WHATEVER" }) }))!;
    assert.equal(p.summary.productPayments.lookup, "NOT_CHECKED");
  });

  it("alive products and pending verification never count; a CONFIRMED cancelled-but-paid is critical; refund short is watch; refund completed is nothing", () => {
    const none = countAttention(normalizeObligationsReport(summary({ negativeSubledgers: { count: 0, unbackedTotal: "0" }, walletMismatches: { count: 0, nonEscrowCount: 0 }, paidNotActivated: 0, receivables: { active: { count: 0, outstanding: "0" }, suspended: { count: 0, outstanding: "0" } }, unpaidObligations: { open: { count: 0, unpaid: "0" }, underReview: { count: 0, unpaid: "0" }, paidExternally: { count: 0, amount: "0" }, waived: { count: 0, unpaid: "0" }, resolved: { count: 0 } }, productPayments: pp({ activeValid: 500, pendingVerification: 40, refundCompleted: 9 }) })), null);
    assert.deepEqual(none, { critical: 0, watch: 0 });
    const warn = countAttention(normalizeObligationsReport(summary({ negativeSubledgers: { count: 0, unbackedTotal: "0" }, walletMismatches: { count: 0, nonEscrowCount: 0 }, paidNotActivated: 0, receivables: { active: { count: 0, outstanding: "0" }, suspended: { count: 0, outstanding: "0" } }, unpaidObligations: { open: { count: 0, unpaid: "0" }, underReview: { count: 0, unpaid: "0" }, paidExternally: { count: 0, amount: "0" }, waived: { count: 0, unpaid: "0" }, resolved: { count: 0 } }, productPayments: pp({ cancelledPaid: 2, refundShort: 3 }) })), null);
    assert.deepEqual(warn, { critical: 2, watch: 3 });
  });

  it("closed obligations (paid externally, waived, legacy resolved) are not attention; open + under review are", () => {
    const base = paymentFixture().data.summary;
    const z = { negativeSubledgers: { count: 0, unbackedTotal: "0" }, walletMismatches: { count: 0, nonEscrowCount: 0 }, paidNotActivated: 0, receivables: { active: { count: 0, outstanding: "0" }, suspended: { count: 0, outstanding: "0" } } };
    const closedOnly = normalizeObligationsReport(paymentFixture({ summary: { ...base, ...z, unpaidObligations: { open: { count: 0, unpaid: "0" }, underReview: { count: 0, unpaid: "0" }, paidExternally: { count: 5, amount: "900000" }, waived: { count: 2, unpaid: "70000" }, resolved: { count: 4 } } } }))!;
    assert.deepEqual(countAttention(closedOnly, null), { critical: 0, watch: 0 });
    const stillOpen = normalizeObligationsReport(paymentFixture({ summary: { ...base, ...z, unpaidObligations: { open: { count: 1, unpaid: "10" }, underReview: { count: 2, unpaid: "20" }, paidExternally: { count: 5, amount: "900000" }, waived: { count: 0, unpaid: "0" }, resolved: { count: 0 } } } }))!;
    assert.deepEqual(countAttention(stillOpen, null), { critical: 0, watch: 3 });
  });

  it("labels cover every outcome / status the server sends and speak Vietnamese", () => {
    for (const k of ["CANCELLED_PAID", "REFUND_COMPLETED", "REFUND_SHORT"]) assert.ok(PRODUCT_OUTCOME_LABEL[k], k);
    for (const k of ["OPEN", "UNDER_REVIEW", "APPROVED_FOR_PAYMENT", "AWAITING_EVIDENCE", "PAID_VERIFIED", "PAID_EXTERNALLY", "WAIVED", "RESOLVED_OTHER", "RESOLVED"]) assert.ok(OBLIGATION_STATUS_LABEL[k], k);
    for (const k of ["REVIEW", "RELEASE_REVIEW", "APPROVE_PAYMENT", "SUBMIT_EVIDENCE", "VERIFY_PAYMENT", "CANCEL_APPROVAL", "PAY_EXTERNALLY", "RESOLVE_OTHER", "WAIVE", "RESOLVE"]) assert.ok(OBLIGATION_ACTION_LABEL[k], k);
    assert.equal(obligationStatusLabel("PAID_EXTERNALLY"), "Đã ghi nhận chứng từ — chưa xác minh");
    assert.equal(obligationStatusLabel("WAIVED"), "Không truy đòi");
    assert.equal(obligationStatusLabel("SOMETHING_NEW"), "Chưa rõ", "unknown code never shown raw");
    assert.equal(productOutcomeLabel(undefined), "Chưa rõ");
    assert.equal(productTargetStatusLabel("CANCELLED"), "Đã hủy");
    assert.equal(obligationActionLabel("NOPE"), "Thao tác khác");
    for (const v of [...Object.values(OBLIGATION_STATUS_LABEL), ...Object.values(PRODUCT_OUTCOME_LABEL), ...Object.values(OBLIGATION_ACTION_LABEL)]) assert.ok(!/^[A-Z_]+$/.test(v), v);
  });

  it("the lookup note says what was (not) checked, and never claims a cancellation", () => {
    assert.match(productLookupNote({ lookup: "OK" } as any), /không còn giao dịch nào chờ xác minh/);
    assert.match(productLookupNote({ lookup: "PARTIAL" } as any), /Một số giao dịch chưa kiểm tra được/);
    assert.match(productLookupNote({ lookup: "UNAVAILABLE" } as any), /không phản hồi kịp/);
    assert.match(productLookupNote({ lookup: "NOT_CHECKED" } as any), /không kết luận là đã hủy/);
    assert.match(productLookupNote(null), /không kết luận là đã hủy/);
    for (const l of ["OK", "PARTIAL", "UNAVAILABLE", "NOT_CHECKED"]) assert.ok(!/đã bị hủy|chắc chắn đã hủy/.test(productLookupNote({ lookup: l } as any)));
  });
});

describe("FH-8 obligation history", () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    at: "2026-10-20T03:00:00.000Z", action: "PAY_EXTERNALLY", fromStatus: "OPEN", toStatus: "PAID_EXTERNALLY", actor: "ops-test", approvedBy: "owner-test",
    approvalRef: "APR-9", note: "finance paid", paidAmount: "250000.00", transferReference: "FT-123", paidOn: "2026-10-19T00:00:00.000Z", unpaidAfter: "0.00", ...over,
  });

  it("a payment line carries amount, transfer reference, pay date, remaining, approver and approval ref", () => {
    const line = formatObligationEvent(ev() as any, fmt);
    for (const part of ["Ghi nhận đã trả ngoài hệ thống", "250000.00đ", "mã chuyển khoản FT-123", "ngày trả", "còn thiếu 0.00đ", "owner-test", "phê duyệt APR-9"]) {
      assert.ok(line.includes(part), `${part} in: ${line}`);
    }
  });

  it("a waiver / review line has no payment evidence and still shows who and which approval", () => {
    const line = formatObligationEvent(ev({ action: "WAIVE", paidAmount: null, transferReference: null, paidOn: null, unpaidAfter: null, approvedBy: null }) as any, fmt);
    assert.ok(line.includes("Quyết định không truy đòi"));
    assert.ok(!line.includes("mã chuyển khoản"));
    assert.ok(line.includes("ops-test · phê duyệt APR-9"));
  });

  it("history and externallyPaid default safely on rows from an older server; sent history is kept in order", () => {
    const r = normalizeObligationsReport(
      paymentFixture({
        unpaidObligations: [{ id: "o1", status: "OPEN" }],
        closedObligations: [{ id: "o2", status: "PAID_EXTERNALLY", externallyPaid: "250000.00", history: [ev(), ev({ action: "REVIEW" })] }],
      }),
    )!;
    assert.deepEqual(r.unpaidObligations[0].history, []);
    assert.equal(r.unpaidObligations[0].externallyPaid, "0.00");
    assert.equal(r.closedObligations[0].history!.length, 2);
    assert.equal(r.closedObligations[0].history![1].action, "REVIEW");
  });

  it("paid-externally vs waived vs open totals survive normalisation", () => {
    const base = paymentFixture().data.summary;
    const r = normalizeObligationsReport(
      paymentFixture({
        summary: { ...base, unpaidObligations: { open: { count: 1, unpaid: "100" }, underReview: { count: 1, unpaid: "50" }, paidExternally: { count: 2, amount: "300" }, waived: { count: 3, unpaid: "70" }, resolved: { count: 4 } } },
      }),
    )!;
    const u = r.summary.unpaidObligations;
    assert.deepEqual([u.open.count, u.underReview.count, u.paidExternally.count, u.waived.count, u.resolved.count], [1, 1, 2, 3, 4]);
    assert.deepEqual([u.paidExternally.amount, u.waived.unpaid], ["300", "70"]);
  });
});

describe("FH-8 verified payment lifecycle: separate groups, unverified is never shown as paid", () => {
  const base = paymentFixture().data.summary;
  const z = { negativeSubledgers: { count: 0, unbackedTotal: "0" }, walletMismatches: { count: 0, nonEscrowCount: 0 }, paidNotActivated: 0, receivables: { active: { count: 0, outstanding: "0" }, suspended: { count: 0, outstanding: "0" } } };
  const ob = (over: Record<string, unknown>) => ({
    open: { count: 0, unpaid: "0" }, underReview: { count: 0, unpaid: "0" }, approvedForPayment: { count: 0, unpaid: "0" }, awaitingEvidence: { count: 0, unpaid: "0" },
    paidVerified: { count: 0, amount: "0" }, paidExternally: { count: 0, amount: "0" }, waived: { count: 0, unpaid: "0" }, resolvedOther: { count: 0 }, resolved: { count: 0 }, ...over,
  });
  const pending = (over: Record<string, unknown> = {}) => ({
    approvalRef: "AP-1", status: "APPROVED", approvedAmount: "250000.00", paymentSource: "MANUAL_BANK_TRANSFER", recipientParty: "CLIENT", recipient: "client-a",
    approvedBy: "owner-test", approvedAt: "2026-10-20T03:00:00.000Z", recordedBy: null, recordedAt: null, recordedAmount: null, transferReference: null, paidOn: null,
    evidenceRef: null, evidenceHash: null, bankStatementId: null, ...over,
  });

  it("every status has its own Vietnamese label; the unverified label says so and differs from the verified one", () => {
    const labels = Object.values(OBLIGATION_STATUS_LABEL);
    assert.equal(new Set(labels).size, labels.length, "no two states share a label");
    assert.equal(obligationStatusLabel("OPEN"), "Đang mở");
    assert.equal(obligationStatusLabel("APPROVED_FOR_PAYMENT"), "Đã phê duyệt chi");
    assert.equal(obligationStatusLabel("AWAITING_EVIDENCE"), "Đang chờ chứng từ");
    assert.equal(obligationStatusLabel("PAID_VERIFIED"), "Đã thanh toán được xác minh");
    assert.equal(obligationStatusLabel("RESOLVED_OTHER"), "Đã giải quyết bằng phương thức khác");
    assert.match(obligationStatusLabel("PAID_EXTERNALLY"), /chưa xác minh/);
    assert.doesNotMatch(obligationStatusLabel("PAID_VERIFIED"), /chưa/);
    assert.doesNotMatch(obligationStatusLabel("PAID_EXTERNALLY"), /^Đã thanh toán/, "the legacy state never reads as paid");
  });

  it("tone: only PAID_VERIFIED is verified; legacy PAID_EXTERNALLY is its own unverified tone; in-flight is pending", () => {
    assert.equal(obligationTone("PAID_VERIFIED"), "verified");
    assert.equal(obligationTone("PAID_EXTERNALLY"), "unverified");
    assert.equal(obligationTone("APPROVED_FOR_PAYMENT"), "pending");
    assert.equal(obligationTone("AWAITING_EVIDENCE"), "pending");
    assert.equal(obligationTone("OPEN"), "open");
    assert.equal(obligationTone("UNDER_REVIEW"), "open");
    for (const k of ["WAIVED", "RESOLVED_OTHER", "RESOLVED", "WHATEVER", undefined, null]) assert.equal(obligationTone(k as any), "closed");
  });

  it("payment sources are manual only and have Vietnamese labels", () => {
    assert.deepEqual(Object.keys(PAYMENT_SOURCE_LABEL).sort(), ["MANUAL_BANK_TRANSFER", "MANUAL_CASH", "MANUAL_E_WALLET_TRANSFER"]);
    assert.equal(paymentSourceLabel("MANUAL_BANK_TRANSFER"), "Chuyển khoản ngân hàng (thủ công)");
    assert.equal(paymentSourceLabel("WALLET"), "Nguồn khác", "unknown source never shown raw");
  });

  it("rowsWithStatus splits one list into per-state groups", () => {
    const rows = [{ id: "a", status: "APPROVED_FOR_PAYMENT" }, { id: "b", status: "AWAITING_EVIDENCE" }, { id: "c", status: "APPROVED_FOR_PAYMENT" }] as any;
    assert.deepEqual(rowsWithStatus(rows, "APPROVED_FOR_PAYMENT").map((r) => r.id), ["a", "c"]);
    assert.deepEqual(rowsWithStatus(rows, "AWAITING_EVIDENCE").map((r) => r.id), ["b"]);
    assert.deepEqual(rowsWithStatus(rows, "PAID_VERIFIED"), []);
  });

  it("normalise keeps every group the server sends: in-flight rows with their pending payment, verified totals, legacy totals separate", () => {
    const r = normalizeObligationsReport(
      paymentFixture({
        summary: {
          ...base,
          unpaidObligations: ob({
            approvedForPayment: { count: 1, unpaid: "250000.00" }, awaitingEvidence: { count: 2, unpaid: "500000.00" },
            paidVerified: { count: 3, amount: "900000.00" }, paidExternally: { count: 4, amount: "1000000.00" }, resolvedOther: { count: 5 },
          }),
        },
        inFlightObligations: [{ id: "i1", status: "AWAITING_EVIDENCE", pendingPayment: pending({ status: "EVIDENCE_SUBMITTED", recordedBy: "clerk-test" }) }],
        closedObligations: [{ id: "c1", status: "PAID_VERIFIED", verifiedPaid: "250000.00" }, { id: "c2", status: "PAID_EXTERNALLY", externallyPaid: "250000.00" }],
        truncated: { inFlightObligations: true },
      }),
    )!;
    const u = r.summary.unpaidObligations;
    assert.deepEqual([u.approvedForPayment.count, u.awaitingEvidence.count, u.paidVerified.count, u.paidExternally.count, u.resolvedOther.count], [1, 2, 3, 4, 5]);
    assert.deepEqual([u.paidVerified.amount, u.paidExternally.amount], ["900000.00", "1000000.00"], "verified and unverified totals are different numbers");
    assert.equal(r.inFlightObligations[0].pendingPayment!.status, "EVIDENCE_SUBMITTED");
    assert.equal(r.inFlightObligations[0].verifiedPaid, "0.00");
    assert.equal(r.closedObligations[0].verifiedPaid, "250000.00");
    assert.equal(r.closedObligations[1].verifiedPaid, "0.00", "a legacy row is never shown as verified");
    assert.equal(r.closedObligations[1].externallyPaid, "250000.00");
    assert.equal(r.truncated.inFlightObligations, true);
  });

  it("an older payment-service build (no lifecycle fields) still normalises to empty groups and zero totals", () => {
    const r = normalizeObligationsReport({ data: { summary: {}, unpaidObligations: [{ id: "o", status: "OPEN" }] } })!;
    const u = r.summary.unpaidObligations;
    assert.deepEqual([u.approvedForPayment.count, u.awaitingEvidence.count, u.paidVerified.count, u.resolvedOther.count], [0, 0, 0, 0]);
    assert.equal(u.paidVerified.amount, "0");
    assert.deepEqual(r.inFlightObligations, []);
    assert.equal(r.unpaidObligations[0].verifiedPaid, "0.00");
    assert.equal(r.unpaidObligations[0].pendingPayment, null);
    assert.equal(r.truncated.inFlightObligations, false);
  });

  it("attention: approved and awaiting-evidence are still unpaid (watch); verified, legacy unverified, waived and resolved-other are not counted", () => {
    const closedOnly = normalizeObligationsReport(
      paymentFixture({ summary: { ...base, ...z, unpaidObligations: ob({ paidVerified: { count: 3, amount: "9" }, paidExternally: { count: 4, amount: "9" }, waived: { count: 2, unpaid: "9" }, resolvedOther: { count: 5 }, resolved: { count: 1 } }) } }),
    )!;
    assert.deepEqual(countAttention(closedOnly, null), { critical: 0, watch: 0 });
    const inFlight = normalizeObligationsReport(
      paymentFixture({ summary: { ...base, ...z, unpaidObligations: ob({ approvedForPayment: { count: 1, unpaid: "10" }, awaitingEvidence: { count: 2, unpaid: "20" } }) } }),
    )!;
    assert.deepEqual(countAttention(inFlight, null), { critical: 0, watch: 3 });
  });

  it("a pending payment line says what was approved and, once evidence is in, that it is NOT verified yet", () => {
    const a = formatPendingPayment(pending() as any, fmt);
    for (const part of ["Duyệt chi 250000.00đ", "Chuyển khoản ngân hàng (thủ công)", "người nhận client-a", "owner-test phê duyệt AP-1", "chưa có chứng từ"]) assert.ok(a.includes(part), `${part} in: ${a}`);
    const e = formatPendingPayment(pending({ status: "EVIDENCE_SUBMITTED", recordedBy: "clerk-test", recordedAmount: "250000.00", transferReference: "FT-1" }) as any, fmt);
    for (const part of ["clerk-test đã nộp chứng từ 250000.00đ", "mã FT-1", "CHƯA xác minh", "chờ người khác kiểm tra"]) assert.ok(e.includes(part), `${part} in: ${e}`);
  });

  const ev = (over: Record<string, unknown> = {}) => ({
    at: "2026-10-20T03:00:00.000Z", action: "APPROVE_PAYMENT", fromStatus: "OPEN", toStatus: "APPROVED_FOR_PAYMENT", actor: "owner-test", approvedBy: "owner-test", approvalRef: "AP-1",
    note: "", paidAmount: "250000.00", transferReference: null, paidOn: null, unpaidAfter: "250000.00", paymentSource: "MANUAL_BANK_TRANSFER", recipient: "CLIENT:client-a",
    evidenceRef: null, evidenceHash: null, bankStatementId: null, verifiedBy: null, ...over,
  });

  it("history lines: approve shows source and recipient; submit says unverified; verify says who verified and what is left", () => {
    const approve = formatObligationEvent(ev() as any, fmt);
    for (const part of ["Phê duyệt chi", "250000.00đ", "Chuyển khoản ngân hàng (thủ công)", "người nhận CLIENT:client-a", "owner-test · phê duyệt AP-1"]) assert.ok(approve.includes(part), `${part} in: ${approve}`);
    const submit = formatObligationEvent(
      ev({ action: "SUBMIT_EVIDENCE", actor: "clerk-test", transferReference: "FT-1", paidOn: "2026-10-19T00:00:00.000Z", evidenceRef: "evidence/ft1.pdf", evidenceHash: "aaaaaaaaaaaa", bankStatementId: "STMT-1" }) as any,
      fmt,
    );
    for (const part of ["Nộp chứng từ thanh toán (chưa xác minh)", "mã chuyển khoản FT-1", "chứng từ evidence/ft1.pdf", "sao kê STMT-1", "mã băm aaaaaaaaaaaa…", "clerk-test nộp chứng từ — chưa xác minh"]) assert.ok(submit.includes(part), `${part} in: ${submit}`);
    const verify = formatObligationEvent(ev({ action: "VERIFY_PAYMENT", actor: "auditor-test", verifiedBy: "auditor-test", transferReference: "FT-1", unpaidAfter: "0.00" }) as any, fmt);
    for (const part of ["Xác minh thanh toán", "còn thiếu 0.00đ", "auditor-test đã xác minh"]) assert.ok(verify.includes(part), `${part} in: ${verify}`);
    assert.ok(!verify.includes("chưa xác minh"));
    const legacy = formatObligationEvent(ev({ action: "PAY_EXTERNALLY", paymentSource: null, recipient: null }) as any, fmt);
    assert.ok(legacy.includes("chưa xác minh"), legacy);
    const cancel = formatObligationEvent(ev({ action: "CANCEL_APPROVAL", note: "" }) as any, fmt);
    assert.ok(cancel.includes("Hủy phê duyệt chi"));
  });

  it("history lines from an older server (no lifecycle fields) do not crash", () => {
    const line = formatObligationEvent({ at: "2026-10-20T03:00:00.000Z", action: "REVIEW", fromStatus: "OPEN", toStatus: "UNDER_REVIEW", actor: "ops", approvedBy: null, approvalRef: "R", note: "", paidAmount: null, transferReference: null, paidOn: null, unpaidAfter: null } as any, fmt);
    assert.ok(line.includes("Chuyển sang xem xét"));
  });
});

describe("FH-9 PT holdback block: normalised from the real report shape; an overdue reserve and a stuck hold need attention, a normal hold does not", () => {
  const withHold = (summary: any, rows: any[] = []) => {
    const f: any = paymentFixture();
    f.data.summary.ptHoldback = summary;
    f.data.ptHoldbacks = rows;
    return normalizeObligationsReport(f)!;
  };
  it("old servers without the block normalise to zeros", () => {
    const r = normalizeObligationsReport(paymentFixture())!;
    assert.deepEqual(r.summary.ptHoldback.overdue, { count: 0, reserved: "0" });
    assert.deepEqual(r.ptHoldbacks, []);
  });
  it("reads the totals, the rows and the overdue flag", () => {
    const r = withHold(
      { totalHeld: "360000.00", contractsHolding: 3, waitingReconciliation: { count: 1, held: "90000.00" }, stuck: { count: 0, held: "0.00" }, overdue: { count: 1, reserved: "90000.00" } },
      [{ transactionId: "t1", contract: "3b7ccecd", contractId: "3b7ccecd-0000", pt: "e662bcd1", held: "90000.00", ended: true, openObligations: "0.00", undecidedSessions: 0, state: "WAITING_RECONCILIATION", lastMovementAt: null, reserved: "90000.00", reviewBy: "2026-10-01T00:00:00.000Z", overdue: true, reviewKinds: ["UNCOMPUTABLE"] }],
    );
    assert.equal(r.summary.ptHoldback.overdue.count, 1);
    assert.equal(r.ptHoldbacks[0].overdue, true);
  });
  it("an overdue reserve counts as critical (needs a decision now); a normal hold does not", () => {
    const calm = withHold({ totalHeld: "90000.00", contractsHolding: 1, waitingReconciliation: { count: 0, held: "0" }, stuck: { count: 0, held: "0" }, overdue: { count: 0, reserved: "0" } });
    const late = withHold({ totalHeld: "90000.00", contractsHolding: 1, waitingReconciliation: { count: 1, held: "90000" }, stuck: { count: 0, held: "0" }, overdue: { count: 1, reserved: "90000" } });
    assert.equal(countAttention(late, null).critical - countAttention(calm, null).critical, 1);
  });
});
