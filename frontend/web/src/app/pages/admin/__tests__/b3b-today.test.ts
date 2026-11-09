/**
 * B3b — "Hôm nay" (`/admin/dashboard`): readers of each source, the view-model (rows / tiles / recent list), the sidebar badge
 * that now counts the P2 group, and wiring audits for the finance-tab refresh clean-up. TEST FIXTURE / CODE AUDIT only.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b3b-today.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { badgeFromAttention } from "../../../components/layout/admin/adminNav";
import { exceptionAttention, normalizeGatewayDiscrepancies } from "../reconciliation/reconciliationView";
import { normalizeObligationsReport, normalizeSessionsReport } from "../adminReconciliation.utils";
import { normalizeReconciliation } from "../adminFinanceOverview.utils";
import {
  PROPOSAL_READ_CAP,
  ROUTES,
  summarizeDisputes,
  summarizeGyms,
  summarizeMonitor,
  summarizePartnerApplications,
  summarizeProposals,
  summarizePtApplications,
  summarizeServiceRefundQueue,
  summarizeUsers,
  summarizeWithdrawalList,
  type Src,
} from "../today/todayModel";
import {
  RECENT_SOURCE_NOTE,
  RECENT_TITLE,
  balanceTile,
  buildAttentionItems,
  buildRecent,
  disputesStat,
  moneyActionTile,
  pendingWithdrawalTile,
  reviewTile,
  servicesStat,
  usersNewStat,
  usersTotalStat,
  type TodaySources,
} from "../today/todayView";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(HERE, "..", rel), "utf8");
const navSrc = readFileSync(join(HERE, "..", "..", "..", "components", "layout", "admin", "useAdminNavBadges.ts"), "utf8");

const NOW = Date.parse("2026-10-29T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const M = 60_000;
const H = 3_600_000;
const D = 86_400_000;

const n = (v: unknown) => String(v).replace(/ /g, " ");
const ready = <T>(data: T): Src<T> => ({ status: "ready", data });
const failed = (message = "Không tải được — lỗi máy chủ. Chưa biết số liệu; đây không phải số bằng không."): Src<never> => ({ status: "error", message, forbidden: false });
const loading: Src<never> = { status: "loading" };

// ─────────────────────────────────────────────────────────── fixtures ──
const withdrawalRows = () => [
  { id: "w1", ownerType: "PT", ownerId: "o1", amount: "1500000.00", status: "PENDING", payoutInfo: "x", createdAt: ago(2 * D) },
  { id: "w2", ownerType: "GYM", ownerId: "o2", amount: "12000000", status: "APPROVED", payoutInfo: "x", createdAt: ago(D + 2 * H), reviewedAt: ago(5 * D) },
  { id: "w3", ownerType: "PT", ownerId: "o3", amount: "700000", status: "PENDING", payoutInfo: "x", createdAt: ago(5 * H) },
  { id: "w4", ownerType: "GYM", ownerId: "o4", amount: "3300000", status: "APPROVED", payoutInfo: "x", createdAt: ago(3 * H), reviewedAt: ago(40 * M) },
];


function obligations(critical: number) {
  // Smallest P13 body whose `countAttention` critical total is `critical` (via negativeWallets).
  return normalizeObligationsReport({
    success: true,
    data: {
      generatedAt: ago(M),
      summary: {
        negativeWallets: critical,
        negativeSubledgers: { count: 0 },
        walletMismatches: { nonEscrowCount: 0, escrowDrift: "0" },
        receivables: { active: { count: 0 }, suspended: { count: 0 } },
        unpaidObligations: {
          open: { count: 0 }, underReview: { count: 0 }, approvedForPayment: { count: 0 }, awaitingEvidence: { count: 0 },
          paidVerified: { count: 0 }, paidExternally: { count: 0 }, waived: { count: 0 }, resolvedOther: { count: 0 }, resolved: { count: 0 },
        },
        paidNotActivated: 0,
        ptHoldback: { contractsHolding: 0, stuck: { count: 0 }, overdue: { count: 0 } },
        targetUnverified: { status: "OK", candidates: 0 },
        productPayments: { cancelledPaid: 0, refundCompleted: 0, refundShort: 0 },
      },
      negativeWallets: [], negativeSubledgers: [], walletMismatches: [], receivables: [], unpaidObligations: [], paidNotActivated: [], cancelledPaid: [], refundOutcomes: [], targetUnverified: [], ptHoldbacks: [],
      truncated: {},
    },
  });
}
function sessionsReport() {
  const g = { items: [], truncated: false };
  return normalizeSessionsReport({ generatedAt: ago(M), needsAttention: g, endingsUnconfirmed: g, endedWithoutSettledEnding: g, disputes: g });
}
function gatewayRows(n: number) {
  return normalizeGatewayDiscrepancies({
    success: true,
    data: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, provider: "VNPAY", metadata: { gatewayDiscrepancy: { expectedAmountVnd: 100000, reportedAmountVnd: 110000, occurrences: 1, firstDetectedAt: ago(H) } } })),
  });
}

function sources(over: Partial<TodaySources> = {}): TodaySources {
  const wd = summarizeWithdrawalList(withdrawalRows(), NOW);
  const ex = exceptionAttention(obligations(3), sessionsReport(), gatewayRows(2));
  assert.ok(wd && ex);
  return {
    withdrawals: ready(wd),
    serviceRefunds: ready(summarizeServiceRefundQueue([{ id: "r1", status: "REFUND_REQUESTED", titleSnapshot: "Giáo án 8 tuần", refundRequestedAt: ago(5 * H), priceAtPurchase: 900000 }])!),
    disputes: ready(summarizeDisputes([{ id: "11111111-aaaa", disputedAt: ago(2 * D), disputeType: "PT_NO_SHOW_CLAIM" }, { id: "22222222-bbbb", disputedAt: ago(3 * H), disputeType: "DELIVERY_DISPUTE" }])!),
    ptApplications: ready(summarizePtApplications([{ id: "p1", status: "SUBMITTED", submittedAt: ago(3 * D), createdAt: ago(9 * D), user: { firstName: "Võ", lastName: "Đạt", email: "x@y.z" } }, { id: "p2", status: "SUBMITTED", submittedAt: ago(90 * M), createdAt: ago(9 * D), user: { firstName: "Lan", lastName: "Hoàng" } }])!),
    partnerApplications: ready(summarizePartnerApplications({ counts: { IN_REVIEW: 1, VERIFIED: 5 }, items: [{ id: "a1", verificationStatus: "IN_REVIEW", brandName: "Zenith Gym", submittedAt: ago(H), createdAt: ago(4 * D) }, { id: "a2", verificationStatus: "VERIFIED", brandName: "Old", createdAt: ago(40 * D) }] })!),
    gyms: ready(summarizeGyms([{ id: "g1", name: "Olympia Club", status: "PENDING_REVIEW", createdAt: ago(3 * H) }, { id: "g2", name: "Approved", status: "APPROVED", createdAt: ago(M) }])!),
    proposals: ready(summarizeProposals([{ name: "Hồ bơi", proposals: [{ name: "Hồ bơi", createdAt: ago(35 * M) }, { name: "Hồ bơi", createdAt: ago(2 * D) }] }])!),
    exceptions: ready(ex),
    balance: ready({ report: normalizeReconciliation({ success: true, data: { escrow: "590800000.00", claims: "590800000.00", drift: "0.00", balanced: true } })!, conflict: false }),
    users: ready(summarizeUsers({ users: [{ createdAt: ago(D) }, { createdAt: ago(8 * D) }, { createdAt: ago(6 * D) }] }, NOW)!),
    monitor: ready(summarizeMonitor({ success: true, data: { summary: { healthyCount: 9, serviceCount: 9 } } })!),
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════ readers ══
describe("B3b readers — each source is read as the queue page reads it; unreadable → null (never 0)", () => {
  it("users: total = users.length, new 7 days by createdAt; unreadable createdAt makes the new-count unknown, not smaller", () => {
    assert.deepEqual(summarizeUsers({ users: [{ createdAt: ago(D) }, { createdAt: ago(8 * D) }, { createdAt: ago(6 * D) }] }, NOW), { total: 3, newLast7d: 2 });
    assert.deepEqual(summarizeUsers({ users: [] }, NOW), { total: 0, newLast7d: 0 });
    assert.deepEqual(summarizeUsers({ users: [{ createdAt: ago(D) }, { createdAt: "not a date" }] }, NOW), { total: 2, newLast7d: null });
    assert.equal(summarizeUsers({ success: true }, NOW), null);
    assert.equal(summarizeUsers(null, NOW), null);
    assert.equal(summarizeUsers({ users: "x" }, NOW), null);
  });

  it("monitor: healthyCount/serviceCount from summary; success=false, 0 services or healthy > total are unreadable", () => {
    assert.deepEqual(summarizeMonitor({ success: true, data: { summary: { healthyCount: 8, serviceCount: 9 } } }), { healthy: 8, total: 9 });
    assert.equal(summarizeMonitor({ success: false, data: { summary: { healthyCount: 8, serviceCount: 9 } } }), null);
    assert.equal(summarizeMonitor({ success: true, data: { summary: { healthyCount: 0, serviceCount: 0 } } }), null);
    assert.equal(summarizeMonitor({ success: true, data: { summary: { healthyCount: 10, serviceCount: 9 } } }), null);
    assert.equal(summarizeMonitor({ success: true, data: {} }), null);
    assert.equal(summarizeMonitor(undefined), null);
  });

  it("disputes: count = rows, oldest/newest by disputedAt, newest row named by short id + dispute type label", () => {
    const f = summarizeDisputes([{ id: "11111111-aaaa", disputedAt: ago(2 * D), disputeType: "PT_NO_SHOW_CLAIM" }, { id: "22222222-bbbb", disputedAt: ago(3 * H), disputeType: "DELIVERY_DISPUTE" }])!;
    assert.equal(f.count, 2);
    assert.equal(f.oldestMs, NOW - 2 * D);
    assert.equal(f.newest?.title, "Buổi tập 22222222");
    assert.equal(f.newest?.at, NOW - 3 * H);
    assert.equal(f.newest?.to, ROUTES.disputes);
    assert.equal(summarizeDisputes([])!.count, 0);
    assert.equal(summarizeDisputes([])!.newest, null);
    assert.equal(summarizeDisputes({ data: [] }), null);
    assert.equal(summarizeDisputes(undefined), null);
  });

  it("service refunds: only REFUND_REQUESTED rows count; newest by refundRequestedAt; no money is read", () => {
    const f = summarizeServiceRefundQueue([
      { id: "a", status: "REFUND_REQUESTED", titleSnapshot: "Cũ", refundRequestedAt: ago(3 * D), priceAtPurchase: 1 },
      { id: "b", status: "REFUND_REQUESTED", titleSnapshot: "Mới", refundRequestedAt: ago(40 * M), priceAtPurchase: 2 },
      { id: "c", status: "ACTIVE", titleSnapshot: "Không phải", refundRequestedAt: ago(M) },
    ])!;
    assert.equal(f.count, 2);
    assert.equal(f.oldestMs, NOW - 3 * D);
    assert.equal(f.newest?.title, "Mới");
    assert.equal(summarizeServiceRefundQueue("oops"), null);
    assert.equal(summarizeServiceRefundQueue([])!.count, 0);
  });

  it("withdrawals: P7 list; newest row = newest createdAt over PENDING + APPROVED, titled with the exact amount and owner kind", () => {
    const w = summarizeWithdrawalList(withdrawalRows(), NOW)!;
    assert.equal(w.queues.pending.count, 2);
    assert.equal(w.queues.approved.count, 2);
    assert.equal(n(w.newest?.title), "3.300.000 ₫ · phòng gym");
    assert.equal(w.newest?.to, ROUTES.withdrawalsApproved);
    assert.equal(w.newest?.caption, "Đã duyệt, chờ chuyển khoản");
    assert.equal(summarizeWithdrawalList({ data: [] }, NOW), null);
    assert.equal(summarizeWithdrawalList(undefined, NOW), null);
    // an unreadable amount never becomes "0 ₫"
    const bad = summarizeWithdrawalList([{ id: "x", ownerType: "PT", amount: "abc", status: "PENDING", createdAt: ago(M) }], NOW)!;
    assert.equal(bad.newest?.title, "— · PT");
    assert.equal(bad.queues.pending.totalDong, null);
  });

  it("PT applications: count = rows returned for SUBMITTED; time = submittedAt, falling back to createdAt; name from user", () => {
    const f = summarizePtApplications([{ id: "p1", submittedAt: null, createdAt: ago(3 * D), user: { email: "a@b.c" } }, { id: "p2", submittedAt: ago(M), createdAt: ago(9 * D), user: { firstName: "Lan", lastName: "Hoàng" } }])!;
    assert.equal(f.count, 2);
    assert.equal(f.oldestMs, NOW - 3 * D);
    assert.equal(f.newest?.title, "Lan Hoàng");
    assert.equal(summarizePtApplications({ items: [] }), null);
  });

  it("partner applications: count = counts.IN_REVIEW (absent in a groupBy = 0); counts not an object = unreadable", () => {
    assert.equal(summarizePartnerApplications({ counts: {}, items: [] })!.count, 0);
    assert.equal(summarizePartnerApplications({ counts: { IN_REVIEW: 4 }, items: [] })!.count, 4);
    assert.equal(summarizePartnerApplications({ counts: { IN_REVIEW: "4" }, items: [] }), null);
    assert.equal(summarizePartnerApplications({ items: [] }), null);
    assert.equal(summarizePartnerApplications([]), null);
    const f = summarizePartnerApplications({ counts: { IN_REVIEW: 1 }, items: [{ verificationStatus: "IN_REVIEW", legalName: "CTY ABC", submittedAt: ago(H), createdAt: ago(D) }, { verificationStatus: "VERIFIED", brandName: "Zzz", createdAt: ago(M) }] })!;
    assert.equal(f.newest?.title, "CTY ABC");
  });

  it("gyms: only PENDING_REVIEW rows are the queue (the same filter as the sidebar badge)", () => {
    const f = summarizeGyms([{ name: "A", status: "PENDING_REVIEW", createdAt: ago(D) }, { name: "B", status: "APPROVED", createdAt: ago(M) }, { name: "C", status: "PENDING_REVIEW", createdAt: ago(H) }])!;
    assert.equal(f.count, 2);
    assert.equal(f.newest?.title, "C");
    assert.equal(summarizeGyms({ data: [] }), null);
    assert.equal(summarizeGyms([])!.count, 0);
  });

  it("proposals: count = groups (as the badge), capped when the 1000-row read is full", () => {
    const f = summarizeProposals([{ name: "Sauna", proposals: [{ name: "Sauna", createdAt: ago(D) }] }, { name: "Hồ bơi", proposals: [{ name: "Hồ bơi", createdAt: ago(M) }] }])!;
    assert.equal(f.count, 2);
    assert.equal(f.capped, false);
    assert.equal(f.newest?.title, "Hồ bơi");
    const many = summarizeProposals([{ name: "x", proposals: Array.from({ length: PROPOSAL_READ_CAP }, () => ({ name: "x", createdAt: ago(M) })) }])!;
    assert.equal(many.capped, true);
    assert.equal(summarizeProposals({ groups: [] }), null);
  });
});

// ═══════════════════════════════════════════ exceptions + sidebar badge ══
describe("B3b — Đối soát count includes the P2 group (sidebar badge + Hôm nay agree)", () => {
  it("critical = P13/U2 critical + one per P2 row; all three sources are required", () => {
    const a = exceptionAttention(obligations(3), sessionsReport(), gatewayRows(2))!;
    assert.equal(a.critical, 5);
    assert.equal(a.gatewayRows, 2);
    assert.equal(a.gatewayTruncated, false);
    assert.equal(exceptionAttention(obligations(3), sessionsReport(), null), null, "P2 missing → no number (never an undercount)");
    assert.equal(exceptionAttention(null, sessionsReport(), gatewayRows(1)), null);
    assert.equal(exceptionAttention(obligations(0), null, gatewayRows(1)), null);
  });

  it("with no P13/U2 exception the badge is still driven by P2; with nothing anywhere there is no badge", () => {
    const only = exceptionAttention(obligations(0), sessionsReport(), gatewayRows(4))!;
    assert.equal(badgeFromAttention(only.critical, true), 4);
    const none = exceptionAttention(obligations(0), sessionsReport(), gatewayRows(0))!;
    assert.equal(badgeFromAttention(none.critical, true), null, "zero is no badge (not a '0')");
  });

  it("a P2 answer at the 200-row cap is flagged as a lower bound", () => {
    const a = exceptionAttention(obligations(0), sessionsReport(), gatewayRows(200))!;
    assert.equal(a.gatewayTruncated, true);
    assert.equal(a.critical, 200);
  });

  it("the sidebar hook and the reconciliation screen use ONE key + ONE function for P2 (agree by construction)", () => {
    assert.match(navSrc, /queryKey: RECON_KEYS\.gateway, queryFn: fetchGatewayDiscrepancies/);
    assert.match(navSrc, /exceptionAttention\(/);
    assert.match(navSrc, /badgeFromAttention\(attention\?\.critical, attention !== null\)/);
    const data = src("reconciliation/useReconciliationData.ts");
    assert.match(data, /queryKey: RECON_KEYS\.gateway,[^\n]*queryFn: fetchGatewayDiscrepancies/);
    assert.match(data, /export async function fetchGatewayDiscrepancies/);
    assert.equal((data.match(/\/admin\/payments\/gateway-discrepancies/g) ?? []).length, 1, "the P2 URL is written exactly once");
    assert.ok(!navSrc.includes("gateway-discrepancies"), "the hook does not carry its own copy of the URL");
  });

  it("Hôm nay reads P2/P13/U2/P3 through the same RECON_KEYS + fetchers", () => {
    const hook = src("today/useTodayData.ts");
    for (const k of ["RECON_KEYS.balance", "RECON_KEYS.obligations", "RECON_KEYS.sessions", "RECON_KEYS.gateway"]) assert.ok(hook.includes(k), k);
    for (const f of ["fetchReconciliation", "fetchObligations", "fetchSessionsReport", "fetchGatewayDiscrepancies"]) assert.ok(hook.includes(f), f);
  });
});

// ════════════════════════════════════════════════════ Việc cần xử lý ══
describe("B3b — AttentionList rows", () => {
  it("money first: approved withdrawals, exceptions, then disputes, service refunds, pending withdrawals, then the review queues", () => {
    const keys = buildAttentionItems(sources(), NOW).map((i) => i.key);
    assert.deepEqual(keys, ["withdrawals-approved", "exceptions", "disputes", "service-refunds", "withdrawals-pending", "pt-applications", "partner-applications", "gyms", "proposals"]);
  });

  it("every row links to its queue route", () => {
    const to = Object.fromEntries(buildAttentionItems(sources(), NOW).map((i) => [i.key, i.to]));
    assert.deepEqual(to, {
      "withdrawals-approved": "/admin/finance/withdrawals?status=APPROVED",
      exceptions: "/admin/finance/reconciliation?view=exceptions",
      disputes: "/admin/disputes",
      "service-refunds": "/admin/finance/refunds",
      "withdrawals-pending": "/admin/finance/withdrawals",
      "pt-applications": "/admin/pts",
      "partner-applications": "/admin/partners",
      gyms: "/admin/gyms",
      proposals: "/admin/listings?tab=proposals",
    });
  });

  it("counts, oldest age and money totals are the real numbers of the fixture", () => {
    const items = Object.fromEntries(buildAttentionItems(sources(), NOW).map((i) => [i.key, i]));
    assert.equal(items["withdrawals-approved"].count, 2);
    assert.match(String(items["withdrawals-approved"].detail), /Cũ nhất 5 ngày · Tổng 15\.300\.000\s₫/);
    assert.equal(items["withdrawals-pending"].count, 2);
    assert.match(String(items["withdrawals-pending"].detail), /Cũ nhất 2 ngày · Tổng 2\.200\.000\s₫/);
    assert.equal(items.exceptions.count, 5);
    assert.match(String(items.exceptions.detail), /2 cổng báo số khác số Gymini/);
    assert.match(String(items.exceptions.detail), /chỉ đếm, không cộng tiền/);
    assert.equal(items.disputes.count, 2);
    assert.match(String(items.disputes.detail), /Cũ nhất 2 ngày/);
    assert.equal(items["service-refunds"].count, 1);
    assert.equal(items["pt-applications"].count, 2);
    assert.equal(items["partner-applications"].count, 1);
    assert.equal(items.gyms.count, 1);
    assert.equal(items.proposals.count, 1);
  });

  it("one failing source turns ONLY its row(s) into error (count unset, reason given); every other row still renders", () => {
    const items = buildAttentionItems(sources({ disputes: failed("Không tải được danh sách tranh chấp buổi tập — lỗi máy chủ. Chưa biết số liệu; đây không phải số bằng không.") }), NOW);
    const d = items.find((i) => i.key === "disputes")!;
    assert.equal(d.status, "error");
    assert.equal(d.count, undefined);
    assert.equal(d.countText, undefined);
    assert.match(String(d.errorText), /không phải số bằng không/);
    for (const i of items.filter((x) => x.key !== "disputes")) assert.equal(i.status, "ready", i.key);
  });

  it("the withdrawal list feeds two rows: when it fails both are error, the rest are not", () => {
    const items = buildAttentionItems(sources({ withdrawals: failed() }), NOW);
    assert.deepEqual(items.filter((i) => i.status === "error").map((i) => i.key), ["withdrawals-approved", "withdrawals-pending"]);
  });

  it("exceptions row is error when ANY of P13/U2/P2 failed (no partial count); loading is loading, never 0", () => {
    assert.equal(buildAttentionItems(sources({ exceptions: failed() }), NOW).find((i) => i.key === "exceptions")!.status, "error");
    const all = buildAttentionItems(sources({ exceptions: loading, withdrawals: loading, disputes: loading, serviceRefunds: loading, ptApplications: loading, partnerApplications: loading, gyms: loading, proposals: loading }), NOW);
    for (const i of all) {
      assert.equal(i.status, "loading", i.key);
      assert.equal(i.count, undefined, i.key);
    }
  });

  it("a queue that really is empty says so (count 0 with an explicit sentence) — only when it was read", () => {
    const empty = summarizeDisputes([])!;
    const row = buildAttentionItems(sources({ disputes: ready(empty) }), NOW).find((i) => i.key === "disputes")!;
    assert.equal(row.status, "ready");
    assert.equal(row.count, 0);
    assert.match(String(row.detail), /Không có tranh chấp nào/);
  });

  it("P7 at the 100-row cap shows '≥' on both withdrawal rows", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `w${i}`, ownerType: "PT", amount: "1000", status: i < 60 ? "PENDING" : "APPROVED", createdAt: ago((i + 1) * M), reviewedAt: ago((i + 1) * M) }));
    const items = buildAttentionItems(sources({ withdrawals: ready(summarizeWithdrawalList(rows, NOW)!) }), NOW);
    assert.equal(items.find((i) => i.key === "withdrawals-pending")!.countText, "≥60");
    assert.equal(items.find((i) => i.key === "withdrawals-approved")!.countText, "≥40");
  });
});

// ═════════════════════════════════════════════════════════════ tiles ══
describe("B3b — the four tiles", () => {
  it("Cần xử lý về tiền = approved withdrawals + critical exceptions + service refunds (counts); money total = approved withdrawals only", () => {
    const t = moneyActionTile(sources());
    assert.equal(t.status, "ready");
    assert.equal(t.value, "8 mục"); // 2 + 5 + 1
    assert.match(String(t.note), /Chờ chuyển khoản 15\.300\.000\s₫/);
    assert.match(String(t.note), /5 ngoại lệ đối soát và 1 hoàn tiền dịch vụ chỉ đếm, không cộng tiền/);
  });

  it("…is an error naming the failed source (no partial total), loading while a source loads, never 0", () => {
    const e = moneyActionTile(sources({ serviceRefunds: failed() }));
    assert.equal(e.status, "error");
    assert.equal(e.value, null);
    assert.match(String(e.errorText), /hoàn tiền dịch vụ/);
    assert.match(String(e.errorText), /không phải số bằng không/);
    assert.equal(moneyActionTile(sources({ exceptions: loading })).status, "loading");
    assert.equal(moneyActionTile(sources({ exceptions: loading })).value, null);
    // error beats loading: the admin learns of the failure immediately
    assert.equal(moneyActionTile(sources({ exceptions: loading, withdrawals: failed() })).status, "error");
  });

  it("Rút tiền chờ duyệt: count + total of PENDING only; error/loading carry no value", () => {
    const t = pendingWithdrawalTile(sources());
    assert.equal(t.value, "2 yêu cầu");
    assert.match(String(t.note), /Tổng 2\.200\.000\s₫/);
    assert.equal(pendingWithdrawalTile(sources({ withdrawals: failed() })).value, null);
    assert.equal(pendingWithdrawalTile(sources({ withdrawals: loading })).status, "loading");
  });

  it("Hồ sơ chờ duyệt = PT + đối tác + chi nhánh + đề xuất tiện ích; one failed source → '—' + which, with the known parts", () => {
    const t = reviewTile(sources());
    assert.equal(t.value, "5 hồ sơ"); // 2 + 1 + 1 + 1
    assert.equal(t.note, "PT 2 · đối tác 1 · chi nhánh 1 · tiện ích 1");
    const e = reviewTile(sources({ gyms: failed() }));
    assert.equal(e.status, "error");
    assert.equal(e.value, null);
    assert.match(String(e.errorText), /Chưa đọc được: chi nhánh/);
    assert.match(String(e.errorText), /PT 2 · đối tác 1 · chi nhánh — · tiện ích 1/);
    assert.equal(reviewTile(sources({ proposals: loading })).status, "loading");
  });

  it("Cân đối sổ ví: balanced → 'Cân bằng'; drift → 'Lệch X ₫' with direction; the 409 flag is kept; error/loading have no verdict", () => {
    const ok = balanceTile(sources());
    assert.equal(ok.value, "Cân bằng");
    assert.equal(ok.balanced, true);
    const rep = normalizeReconciliation({ success: true, data: { escrow: "590800000.00", claims: "592050000.00", drift: "-1250000.00", balanced: false } })!;
    const drift = balanceTile(sources({ balance: ready({ report: rep, conflict: true }) }));
    assert.equal(drift.balanced, false);
    assert.equal(n(drift.value), "Lệch 1.250.000 ₫");
    assert.match(String(drift.direction), /ít hơn/);
    assert.equal(drift.conflict, true, "409 is a drift, not a load error");
    const e = balanceTile(sources({ balance: failed() }));
    assert.equal(e.status, "error");
    assert.equal(e.value, null);
    assert.equal(e.balanced, null);
    assert.equal(balanceTile(sources({ balance: loading })).balanced, null);
    // a body claiming balanced but with a non-zero drift is NOT shown as balanced
    const lie = normalizeReconciliation({ success: true, data: { escrow: "100", claims: "90", drift: "10", balanced: true } })!;
    assert.equal(balanceTile(sources({ balance: ready({ report: lie, conflict: false }) })).balanced, false);
  });

  it("the page carries the balance scope caption (not a system-health verdict) and the tile label", () => {
    const page = src("AdminDashboard.tsx");
    const view = src("today/todayView.ts");
    assert.match(page, /Cân đối sổ ví \(ESCROW = Σ quyền đòi\)/);
    assert.match(view, /Chỉ so số dư các ví với ví giữ hộ — không phải kết luận về sức khoẻ toàn hệ thống/);
    assert.match(page, /BALANCE_SCOPE_TEXT/);
  });
});

describe("B3b — compact stats", () => {
  it("users / new 7 days / services / disputes show exactly their source's number", () => {
    const s = sources();
    assert.equal(usersTotalStat(s).value, "3");
    assert.equal(usersNewStat(s).value, "2");
    assert.equal(servicesStat(s).value, "9/9");
    assert.equal(disputesStat(s).value, "2");
  });
  it("loading / failed / unreadable → no value (never 0)", () => {
    const s = sources({ users: failed(), monitor: loading, disputes: failed() });
    assert.equal(usersTotalStat(s).value, null);
    assert.equal(usersTotalStat(s).status, "error");
    assert.equal(usersNewStat(s).status, "error");
    assert.equal(servicesStat(s).status, "loading");
    assert.equal(servicesStat(s).value, null);
    assert.equal(disputesStat(s).status, "error");
    const noDates = sources({ users: ready(summarizeUsers({ users: [{ createdAt: "x" }] }, NOW)!) });
    assert.equal(usersTotalStat(noDates).value, "1");
    assert.equal(usersNewStat(noDates).status, "error");
  });
});

// ═══════════════════════════════════════════════ Mục mới tạo gần nhất ══
describe("B3b — RecentQueueList content", () => {
  it("one newest item per queue, newest first; relative + absolute times; link to the queue", () => {
    const r = buildRecent(sources(), NOW);
    assert.equal(r.items.length, 7);
    const ats = r.items.map((i) => i.at);
    assert.deepEqual(ats, [...ats].sort((a, b) => b - a));
    assert.equal(r.items[0].kind, "Tiện ích"); // 35 phút
    assert.equal(r.items[0].agoText, "35 phút trước");
    assert.ok(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(r.items[0].absoluteText));
    assert.equal(r.items.find((i) => i.key === "withdrawals")!.to, ROUTES.withdrawalsApproved);
    assert.deepEqual(r.failed, []);
    assert.equal(r.loading, 0);
    assert.equal(r.allEmpty, false);
  });

  it("a failed queue is named and its item is absent; the others still list; empty is never claimed", () => {
    const r = buildRecent(sources({ gyms: failed(), disputes: failed() }), NOW);
    assert.deepEqual(r.failed, ["tranh chấp buổi tập", "chi nhánh"]);
    assert.equal(r.items.length, 5);
    assert.equal(r.allEmpty, false);
  });

  it("allEmpty only when EVERY queue was read and has no item; loading queues are counted", () => {
    const empty = sources({
      withdrawals: ready(summarizeWithdrawalList([], NOW)!),
      serviceRefunds: ready(summarizeServiceRefundQueue([])!),
      disputes: ready(summarizeDisputes([])!),
      ptApplications: ready(summarizePtApplications([])!),
      partnerApplications: ready(summarizePartnerApplications({ counts: {}, items: [] })!),
      gyms: ready(summarizeGyms([])!),
      proposals: ready(summarizeProposals([])!),
    });
    const r = buildRecent(empty, NOW);
    assert.equal(r.items.length, 0);
    assert.equal(r.allEmpty, true);
    const mixed = buildRecent({ ...empty, gyms: loading, proposals: failed() }, NOW);
    assert.equal(mixed.allEmpty, false);
    assert.equal(mixed.loading, 1);
    assert.deepEqual(mixed.failed, ["đề xuất tiện ích"]);
  });

  it("label + source note are the approved wording (G-23; createdAt within each queue's bounded result; not an activity feed)", () => {
    assert.equal(RECENT_TITLE, "Mục mới tạo gần nhất trong các hàng đợi");
    assert.match(RECENT_SOURCE_NOTE, /createdAt/);
    assert.match(RECENT_SOURCE_NOTE, /tập kết quả có giới hạn của mỗi hàng đợi/);
    assert.match(RECENT_SOURCE_NOTE, /không phải mọi sự kiện gần đây/);
    assert.match(RECENT_SOURCE_NOTE, /G-23/);
    const list = src("shared/RecentQueueList.tsx");
    assert.match(list, /sourceNote: ReactNode/);
    assert.ok(!/sourceNote\?:/.test(list), "the source note is mandatory");
  });
});

// ═══════════════════════════════════════════════ wiring (CODE AUDIT) ══
describe("B3b — page wiring (CODE AUDIT)", () => {
  const page = src("AdminDashboard.tsx");
  it("the membership-refund card is no longer rendered on Hôm nay — only a link to the refunds page", () => {
    assert.ok(!page.includes("MembershipRefundCard"));
    assert.match(page, /ROUTES\.membershipRefund/);
    assert.equal(ROUTES.membershipRefund, "/admin/finance/refunds?type=membership");
    // …and the refunds page still renders it, with its test ids intact
    assert.match(src("PTServiceRefunds.tsx"), /MembershipRefundCard/);
    const card = src("refunds/MembershipRefundCard.tsx");
    for (const id of ["membership-refund-id-input", "admin-refunds-membership"]) assert.ok(card.includes(id) || src("PTServiceRefunds.tsx").includes(id), id);
  });

  it("the old '|| 0' fallbacks that turned a failure into 0 are gone from the Hôm nay files", () => {
    for (const f of ["AdminDashboard.tsx", "today/todayModel.ts", "today/todayView.ts", "today/useTodayData.ts"]) {
      const text = src(f);
      assert.ok(!/\|\|\s*0\b/.test(text), `${f} has "|| 0"`);
      assert.ok(!/\?\?\s*0\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, "")), `${f} has "?? 0"`);
    }
  });

  it("each source is its own query (13 useQuery calls) and the header refresh re-reads exactly those keys", () => {
    const hook = src("today/useTodayData.ts");
    assert.equal((hook.match(/= useQuery\(/g) ?? []).length, 13);
    const keys = src("today/queueQueries.ts");
    const list = keys.slice(keys.indexOf("export const TODAY_REFRESH_KEYS"));
    for (const k of ["withdrawals", "serviceRefunds", "ptApplications", "partnerApplications", "gyms", "proposals", "disputes", "users", "monitor"]) assert.ok(list.includes(`QUEUE_QUERIES.${k}.queryKey`), k);
    for (const k of ["balance", "obligations", "sessions", "gateway"]) assert.ok(list.includes(`RECON_KEYS.${k}`), k);
  });

  it("the sidebar reuses the very same queue definitions as Hôm nay (one key + one function per queue)", () => {
    for (const k of ["withdrawals", "serviceRefunds", "ptApplications", "partnerApplications", "gyms", "proposals"]) assert.ok(navSrc.includes(`QUEUE_QUERIES.${k}`), k);
    assert.ok(src("today/useTodayData.ts").includes("QUEUE_QUERIES.withdrawals"));
  });
});

describe("B3b — clean-up 2: duplicate in-page refresh buttons removed from the four finance tabs (CODE AUDIT)", () => {
  const removed: Array<[string, string]> = [
    ["AdminFinanceOverviewTab.tsx", "finance-refresh"],
    ["AdminWithdrawals.tsx", "admin-withdrawals-refresh"],
    ["PTServiceRefunds.tsx", "admin-refunds-refresh"],
    ["reconciliation/BalanceView.tsx", "recon-balance-refresh"],
    ["AdminReconciliationBlocks.tsx", "recon-exceptions-refresh"],
  ];
  for (const [file, id] of removed) {
    it(`${file} no longer has "${id}"`, () => {
      assert.ok(!src(file).includes(id));
    });
  }
  it("the timestamps stay", () => {
    assert.ok(src("AdminFinanceOverviewTab.tsx").includes("finance-asof"));
    assert.ok(src("AdminWithdrawals.tsx").includes("admin-withdrawals-updated"));
    assert.ok(src("PTServiceRefunds.tsx").includes("admin-refunds-updated"));
    assert.ok(src("reconciliation/BalanceView.tsx").includes("recon-balance-asof"));
  });
  it("the one remaining refresh is the Tài chính header's, which covers each tab's own query keys", () => {
    const page = src("AdminFinancePage.tsx");
    assert.ok(page.includes("admin-finance-refresh"));
    const header = src("reconciliation/financeHeader.ts");
    // keys the removed buttons used to re-read, per tab
    assert.match(header, /withdrawals: \[\["admin", "pending-withdrawals"\]\]/); // AdminWithdrawals QUEUE_KEY
    assert.match(header, /refunds: \[\["refund-requests"\], \["refund-calculation"\]\]/); // PTServiceRefunds list + calc
    assert.match(header, /reconciliation: \[\["admin", "finance"\]\]/); // balance + obligations + sessions + gateway
    assert.match(header, /overview: \[\["admin", "finance"\], \["admin", "finance-overview"\], \["admin", "pending-withdrawals"\], \["refund-requests"\]\]/);
    assert.match(src("withdrawals/WithdrawalRow.tsx"), /QUEUE_KEY = \["admin", "pending-withdrawals"\]/);
    assert.match(src("refunds/ServiceRefundRow.tsx"), /REFUND_LIST_KEY = \["refund-requests"\]/);
  });
});
