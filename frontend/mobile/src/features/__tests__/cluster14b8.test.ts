import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  accountGroups,
  auditLabel,
  bucketLabel,
  compactVND,
  customFinanceRange,
  financeRange,
  financeReport,
  legacyEditsBlocked,
  opensApplication,
  partnerActions,
  partnerCardMeta,
  partnerForm,
  partnerFormError,
  partnerFormPayload,
  percentLabel,
  queueItems,
  reconciliation,
  searchPartners,
  terminateResultMessage,
  terminationImpact,
} from "../admin/adminPartners";

/**
 * 14B.8 — admin partner management + finance, pinned to web AdminPartnersPage / AdminFinancePage and
 * the real gym-service / payment-service payloads (read 5/10).
 *
 * Chạy: npx tsx --test src/features/__tests__/cluster14b8.test.ts
 */

const NOW = new Date("2026-10-05T12:00:00Z").getTime();

describe("PG-D1 partner list", () => {
  const rows = [
    { id: "a", legalName: "Cong ty P12 Mobile Fitness", status: "ACTIVE", contactEmail: "p12-mobile@example.com", taxCode: "0312", source: "SELF_SERVICE" },
    { id: "b", legalName: "Titan Gym", status: "PROSPECT", contactEmail: "titan@x.vn", source: "SELF_SERVICE" },
    { id: "c", legalName: "Old Gym", status: "PROSPECT", contactEmail: "old@x.vn", source: "ADMIN_CREATED" },
  ];
  it("searches name, email and tax code, case-insensitive", () => {
    assert.deepEqual(searchPartners(rows, "p12").map((p) => p.id), ["a"]);
    assert.deepEqual(searchPartners(rows, "TITAN@").map((p) => p.id), ["b"]);
    assert.deepEqual(searchPartners(rows, "0312").map((p) => p.id), ["a"]);
    assert.equal(searchPartners(rows, "  ").length, 3);
  });
  it("a self-registered prospect opens in the application review, a legacy one in the detail", () => {
    assert.equal(opensApplication(rows[1]), true);
    assert.equal(opensApplication(rows[2]), false);
    assert.equal(opensApplication(rows[0]), false);
  });
  it("queue keeps only lines with work, from the real /admin/partners/queue body", () => {
    const q = { success: true, data: { pendingProspects: 15, pendingGyms: 3, pendingBrandRenames: 2, invitedTooLong: 1, expiringDocs: 0 } };
    assert.deepEqual(queueItems(q).map((i) => [i.key, i.count]), [
      ["pendingProspects", 15],
      ["pendingGyms", 3],
      ["pendingBrandRenames", 2],
    ]);
    assert.deepEqual(queueItems(null), []);
  });
  it("card meta counts accounts and partner age", () => {
    const p = {
      id: "a",
      legalName: "x",
      status: "ACTIVE",
      createdAt: "2026-09-27T02:22:21Z",
      accounts: [
        { id: "1", userId: "u1", role: "OWNER", status: "ACTIVE" },
        { id: "2", userId: "u2", role: "MANAGER", status: "ACTIVE" },
        { id: "3", userId: "u3", role: "MANAGER", status: "REVOKED" },
      ],
    };
    assert.equal(partnerCardMeta(p, NOW), "2 tài khoản · đối tác từ 8 ngày trước");
  });
});

describe("PG-D1 partner detail rules (web's own conditions)", () => {
  it("actions by status", () => {
    assert.deepEqual(partnerActions("ACTIVE"), { viewAs: true, suspend: true, unsuspend: false, terminate: true });
    assert.deepEqual(partnerActions("SUSPENDED"), { viewAs: true, suspend: false, unsuspend: true, terminate: true });
    assert.deepEqual(partnerActions("PROSPECT"), { viewAs: false, suspend: false, unsuspend: false, terminate: false });
    assert.deepEqual(partnerActions("TERMINATED"), { viewAs: false, suspend: false, unsuspend: false, terminate: false });
  });
  it("the last active owner can never be revoked; managers always can", () => {
    const g = accountGroups([
      { id: "o", userId: "u", role: "OWNER", status: "ACTIVE" },
      { id: "m", userId: "v", role: "MANAGER", status: "ACTIVE" },
      { id: "r", userId: "w", role: "MANAGER", status: "REVOKED" },
    ]);
    assert.equal(g.active.length, 2);
    assert.equal(g.revoked.length, 1);
    assert.equal(g.canRevoke(g.active[0]), false);
    assert.equal(g.canRevoke(g.active[1]), true);
  });
  it("legacy admin edits are hidden for a self-registered partner (gym-service answers 409 SELF_SERVICE_APPLICATION)", () => {
    assert.equal(legacyEditsBlocked({ id: "a", legalName: "x", status: "ACTIVE", source: "SELF_SERVICE" }), true);
    assert.equal(legacyEditsBlocked({ id: "b", legalName: "y", status: "ACTIVE", source: "ADMIN_CREATED" }), false);
    assert.equal(legacyEditsBlocked({ id: "c", legalName: "z", status: "ACTIVE" }), false);
  });
  it("audit labels cover the self-service application events web prints as raw codes", () => {
    assert.equal(auditLabel("APPLICATION_APPROVED"), "Duyệt hồ sơ");
    assert.equal(auditLabel("DOCUMENT_ACCEPTED"), "Chấp nhận giấy tờ");
    assert.equal(auditLabel("PARTNER_SUSPENDED"), "Tạm khoá");
    assert.equal(auditLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  });
});

describe("PG-D1 edit form — commission as a percent", () => {
  const partner = { id: "a", legalName: "P12", status: "ACTIVE", contactEmail: "a@b.vn", commissionRateOverride: "0.0800", expectedBranchCount: 3 };
  it("shows the stored fraction as a percent and sends it back as a fraction", () => {
    const f = partnerForm(partner);
    assert.equal(f.commissionPercent, "8");
    assert.equal(partnerFormPayload(f).commissionRateOverride, 0.08);
    assert.equal(partnerFormPayload({ ...f, commissionPercent: "7,5" }).commissionRateOverride, 0.075);
    assert.equal(partnerFormPayload({ ...f, commissionPercent: "" }).commissionRateOverride, null);
  });
  it("rejects what gym-service would silently clamp to the floor", () => {
    const f = partnerForm(partner);
    assert.equal(partnerFormError(f), null);
    assert.equal(partnerFormError({ ...f, commissionPercent: "800" }), "Chiết khấu riêng phải từ 0 đến 100%");
    assert.equal(partnerFormError({ ...f, legalName: " " }), "Nhập tên pháp lý");
    assert.equal(partnerFormError({ ...f, contactEmail: "abc" }), "Email liên hệ không hợp lệ");
    assert.equal(partnerFormError({ ...f, expectedBranchCount: "2.5" }), "Số chi nhánh dự kiến phải là số nguyên");
  });
  it("percent label", () => {
    assert.equal(percentLabel(0.05), "5%");
    assert.equal(percentLabel("0.0750"), "7.5%");
    assert.equal(percentLabel(null), null);
  });
});

describe("PG-D1 termination", () => {
  it("impact from the real body, and the result toast", () => {
    assert.deepEqual(terminationImpact({ success: true, data: { activeGyms: 2, totalGyms: 2, activeMembers: 0, unusedValueTotal: 0, activePtContracts: 0, walletBalanceTotal: 0 } }), {
      activeGyms: 2,
      totalGyms: 2,
      activeMembers: 0,
      unusedValueTotal: 0,
      activePtContracts: 0,
      walletBalanceTotal: 0,
    });
    assert.equal(terminationImpact({}), null);
    assert.deepEqual(terminateResultMessage({ refunded: 3, refundErrors: [{}] }), {
      ok: "Đã chấm dứt hợp tác — đã hoàn tiền 3 hội viên",
      failed: "1 hội viên hoàn tiền thất bại — cần xử lý tay",
    });
    assert.deepEqual(terminateResultMessage({}), { ok: "Đã chấm dứt hợp tác", failed: null });
  });
});

describe("PG-D2 finance", () => {
  it("parses payment-service Decimal strings", () => {
    const r = financeReport({
      success: true,
      data: {
        buckets: [{ period: "2026-09-01T00:00:00.000Z", income: "18400000.00", expense: "10000.00", netRevenue: "0.00", transactionCount: 8 }],
        totals: { income: "18400000.00", expense: "10000.00", netRevenue: "0.00", transactionCount: 8 },
      },
    })!;
    assert.equal(r.totals.income, 18_400_000);
    assert.equal(r.buckets[0].transactionCount, 8);
    assert.equal(financeReport({ data: {} }), null);
  });
  it("reconciliation incl. the locked balances web does not show", () => {
    const r = reconciliation({
      success: true,
      data: {
        escrow: "106947000.00",
        claims: "106947000.00",
        drift: "0.00",
        balanced: true,
        breakdown: { clientBalances: "52465355.01", ptLocked: "1200.00", gymLocked: "0.00" },
        negativeWallets: [{ id: "w", ownerType: "PT", ownerId: "p", available: "-5", pending: "0" }],
      },
    })!;
    assert.equal(r.balanced, true);
    assert.equal(r.breakdown.clientBalances, 52_465_355.01);
    assert.equal(r.breakdown.ptLocked, 1200);
    assert.equal(r.breakdown.ptAvailable, 0);
    assert.equal(r.negativeWallets[0].available, -5);
  });
  it("labels and compact axis", () => {
    assert.equal(bucketLabel("2026-07-01T00:00:00.000Z", "quarter"), "Q3/2026");
    assert.equal(compactVND(18_400_000), "18.4tr");
    assert.equal(compactVND(12_000_000), "12tr");
    assert.equal(compactVND(850_000), "850k");
  });
  it("default window per grouping; custom window covers the whole last day", () => {
    const now = new Date(2026, 9, 5, 15, 0);
    const r = financeRange("day", now);
    assert.equal(r.fromDay.getDate(), 5);
    assert.equal(r.fromDay.getMonth(), 8);
    assert.equal(new Date(r.to).getTime() - new Date(2026, 9, 5).getTime(), 86_400_000);
    const c = customFinanceRange("2026-09-01", "2026-09-30", now);
    assert.ok(!("error" in c));
    if (!("error" in c)) assert.equal(new Date(c.to).getTime(), new Date(2026, 9, 1).getTime());
    assert.deepEqual(customFinanceRange("2026-09-31", "2026-10-01", now), { error: "Ngày theo dạng YYYY-MM-DD" });
    assert.deepEqual(customFinanceRange("2026-10-02", "2026-10-01", now), { error: "Ngày bắt đầu phải trước ngày kết thúc" });
    assert.deepEqual(customFinanceRange("2026-10-01", "2026-10-06", now), { error: "Ngày kết thúc không được sau hôm nay" });
  });
});
