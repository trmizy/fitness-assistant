/**
 * Phase 13 cụm A — AD-01 "Tổng quan" và AD-06 "Rút tiền".
 *
 * Chạy: npx tsx --test src/features/__tests__/adminCluster13A.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dashboardData,
  dashboardKpis,
  healthSummary,
  moneyHeadline,
  ocrStats,
  recentUsers,
  roleBreakdown,
  systemAlerts,
  unclassifiedUsers,
  userGrowth,
} from "../admin/adminDashboard";
import {
  bankReferenceError,
  canApprove,
  canMarkPaid,
  canReject,
  ownerDisplay,
  payoutText,
  queueTotal,
  rejectReasonError,
  sortOldestFirst,
  userDirectory,
  withdrawalRows,
} from "../admin/adminWithdrawals";

// Câu trả lời thật của gateway ngày 28/9, rút gọn.
const REAL = {
  success: true,
  data: {
    kpis: { totalUsers: 205, verifiedPTs: 8, activeContracts: 292, sessionsToday: 1, pendingPT: 0 },
    userGrowth: [{ month: "Aug", users: 91 }, { month: "Sep", users: 145 }],
    roleData: [{ name: "Clients", value: 143 }, { name: "Trainers", value: 8 }],
    systemAlerts: [
      { level: "warning", service: "Redis", message: "chậm", time: "06:00 AM" },
      { level: "error", service: "n8n Workflow", message: "getaddrinfo ENOTFOUND n8n", time: "06:03 AM" },
    ],
    recentUsers: [{ name: "p12-mobile", email: "p12-mobile@example.com", role: "Client", joined: "Sep 27", status: "Active" }],
    ocrStats: { total: 101, extracted: 39, manual: 62, pending: 0 },
    monitor: { healthScore: 100, healthyCount: 6, serviceCount: 7 },
    money: { escrow: "104857000.00", platformRevenue: "8882165.09", balanced: true },
  },
};

describe("AD-01 tổng quan", () => {
  const d = dashboardData(REAL);

  it("đọc KPI và tiền từ câu trả lời thật", () => {
    assert.equal(dashboardKpis(d).totalUsers, 205);
    assert.equal(dashboardKpis({}).activeContracts, 0);
    const m = moneyHeadline(d)!;
    assert.equal(m.escrow, 104857000);
    assert.equal(m.balanced, true);
  });

  it("sổ không nói là cân thì KHÔNG hiện là cân", () => {
    assert.equal(moneyHeadline({ money: { escrow: "1" } })!.balanced, null);
    assert.equal(moneyHeadline({ money: { escrow: "1", balanced: false } })!.balanced, false);
    assert.equal(moneyHeadline({}), null);
  });

  it("sức khoẻ nói bằng số đếm — healthScore 100 mà 6/7 thì vẫn là cảnh báo", () => {
    const h = healthSummary(d)!;
    assert.equal(h.label, "6/7 dịch vụ hoạt động");
    assert.equal(h.tone, "warning");
    assert.equal(healthSummary({ monitor: { healthyCount: 7, serviceCount: 7 } })!.tone, "success");
    assert.equal(healthSummary({ monitor: { healthyCount: 0, serviceCount: 7 } })!.tone, "danger");
    assert.equal(healthSummary({}), null);
  });

  it("cảnh báo nặng nhất lên đầu", () => {
    const a = systemAlerts(d);
    assert.deepEqual(a.map((x) => x.level), ["error", "warning"]);
    assert.equal(a[0].tone, "danger");
  });

  it("nhãn tiếng Việt, và phần người dùng không được phân loại hiện ra thay vì bị nuốt", () => {
    assert.deepEqual(userGrowth(d).map((p) => p.label), ["T8", "T9"]);
    assert.deepEqual(roleBreakdown(d).map((r) => r.label), ["Khách hàng", "Huấn luyện viên"]);
    assert.equal(unclassifiedUsers(d), 205 - 151);
    assert.equal(recentUsers(d)[0].role, "Khách hàng");
    assert.equal(recentUsers(d)[0].active, true);
    assert.equal(ocrStats(d)!.manual, 62);
  });
});

describe("AD-06 rút tiền — đúng luật withdrawal.service", () => {
  const pending = { id: "w1", ownerType: "PT", ownerId: "u1", amount: "20000", status: "PENDING", createdAt: "2026-09-24T00:00:00Z" };
  const approved = { id: "w2", ownerType: "GYM", ownerId: "g1", amount: "50000", status: "APPROVED", createdAt: "2026-09-20T00:00:00Z" };

  it("hành động theo trạng thái", () => {
    assert.equal(canApprove(pending), true);
    assert.equal(canApprove(approved), false, "duyệt chỉ từ PENDING");
    assert.equal(canMarkPaid(pending), true, "chi trả được thẳng từ PENDING, không bắt duyệt trước");
    assert.equal(canMarkPaid(approved), true);
    assert.equal(canReject(approved), true, "từ chối được cả khi đã giữ chỗ");
    const paid = { ...pending, status: "PAID" };
    assert.equal(canMarkPaid(paid), false);
    assert.equal(canReject(paid), false);
  });

  it("hàng chờ: đọc mọi kiểu bọc, cũ nhất lên đầu, tổng tiền", () => {
    const rows = withdrawalRows({ success: true, data: [pending, approved, { nope: 1 }] });
    assert.equal(rows.length, 2);
    assert.deepEqual(sortOldestFirst(rows).map((r) => r.id), ["w2", "w1"]);
    assert.equal(queueTotal(rows), 70000);
  });

  it("mã tham chiếu và lý do bắt buộc, như máy chủ", () => {
    assert.ok(bankReferenceError(""));
    assert.ok(bankReferenceError("ab"));
    assert.equal(bankReferenceError("VCB-TXN-001"), null);
    assert.ok(rejectReasonError(" "));
    assert.equal(rejectReasonError("Sai số tài khoản"), null);
  });

  it("tên người rút: tra được thì tên + email, không thì mã rút gọn — không bao giờ trống", () => {
    const users = userDirectory({ success: true, data: { total: 1, users: [{ id: "u1", name: "Professional Trainer", email: "pt@example.com" }] } });
    assert.deepEqual(ownerDisplay(pending, users), { title: "Professional Trainer", subtitle: "Huấn luyện viên · pt@example.com" });
    assert.equal(ownerDisplay({ ...pending, ownerId: "zzzzzzzz-1" }, users).title, "Huấn luyện viên zzzzzzzz");
    assert.equal(ownerDisplay(approved, users, new Map([["g1", "Gymini Quận 1"]])).title, "Gymini Quận 1");
    assert.equal(ownerDisplay(approved, users).subtitle, "Chưa tra được tên");
    assert.equal(payoutText({ ...pending, payoutInfo: "  " }), "Chưa có thông tin nhận tiền");
  });
});
