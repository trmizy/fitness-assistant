/**
 * Phase 13 — AD-05 "Người dùng" và phần GAP-21 đọc được ở AD-01.
 *
 * Chạy: npx tsx --test src/features/__tests__/adminUsers.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  filterUsers,
  initials,
  isLocked,
  lockConsequences,
  roleLabel,
  userCounts,
  userRows,
} from "../admin/adminUsers";
import { roleBreakdown, recentUsers, unclassifiedUsers } from "../admin/adminDashboard";

// Hình dạng thật của /admin/users sau khi sửa GAP-21 (28/9).
const RAW = {
  success: true,
  data: {
    total: 4,
    users: [
      { id: "1", name: "Trần Văn Chủ", email: "p12-mobile@example.com", role: "Gym Owner", status: "Active" },
      { id: "2", name: "Professional Trainer", email: "pt@example.com", role: "PT", status: "Active" },
      { id: "3", name: "Nguyễn Hà", email: "ha@example.com", role: "Client", status: "Inactive" },
      { id: "4", name: "Khách", email: "k@example.com", role: "Client", status: "Active" },
      { nope: true },
    ],
  },
};

describe("AD-05 danh sách", () => {
  const rows = userRows(RAW);

  it("đọc và bỏ dòng hỏng", () => {
    assert.equal(rows.length, 4);
    assert.equal(userRows(null).length, 0);
  });

  it("lọc theo vai trò, trạng thái, và tìm không dấu", () => {
    assert.equal(filterUsers(rows, "", "Gym Owner", "ALL").length, 1);
    assert.equal(filterUsers(rows, "", "ALL", "Inactive").length, 1);
    assert.deepEqual(filterUsers(rows, "tran van", "ALL", "ALL").map((u) => u.id), ["1"]);
    assert.deepEqual(filterUsers(rows, "nguyen ha", "ALL", "ALL").map((u) => u.id), ["3"]);
    assert.equal(filterUsers(rows, "pt@", "ALL", "ALL").length, 1);
  });

  it("đếm, nhãn, khoá", () => {
    const c = userCounts(rows);
    assert.equal(c.total, 4);
    assert.equal(c.locked, 1);
    assert.equal(c.byRole["Client"], 2);
    assert.equal(roleLabel("Gym Owner"), "Chủ phòng gym");
    assert.equal(isLocked(rows[2]), true);
    assert.equal(initials("Professional Trainer"), "PT");
    assert.equal(initials(""), "?");
  });
});

describe("hệ quả của việc khoá — đúng những gì backend làm", () => {
  it("khoá PT phải nói rõ hợp đồng bị huỷ và KHÔNG khôi phục được", () => {
    const c = lockConsequences({ id: "2", name: "PT", email: "pt@x", role: "PT", status: "Active" });
    assert.ok(c.lines.some((l) => l.includes("hợp đồng")));
    assert.ok(c.irreversible && c.irreversible.includes("KHÔNG được khôi phục"));
  });

  it("khách / chủ gym: chỉ khoá đăng nhập, không có phần không đảo ngược", () => {
    assert.equal(lockConsequences({ id: "3", name: "K", email: "k@x", role: "Client", status: "Active" }).irreversible, null);
    const owner = lockConsequences({ id: "1", name: "O", email: "o@x", role: "Gym Owner", status: "Active" });
    assert.equal(owner.irreversible, null);
    assert.ok(owner.lines.some((l) => l.includes("không bị thay đổi")));
  });
});

describe("GAP-21 trên tổng quan", () => {
  it("cột chủ gym mới có nhãn, phần chưa phân loại về 0", () => {
    const d = {
      kpis: { totalUsers: 205 },
      roleData: [
        { name: "Clients", value: 143 },
        { name: "Trainers", value: 8 },
        { name: "Gym owners", value: 54 },
      ],
      recentUsers: [{ name: "p12", email: "p", role: "Gym Owner", joined: "Sep 27", status: "Inactive" }],
    };
    assert.deepEqual(roleBreakdown(d).map((r) => r.label), ["Khách hàng", "Huấn luyện viên", "Chủ phòng gym"]);
    assert.equal(unclassifiedUsers(d), 0);
    assert.equal(recentUsers(d)[0].role, "Chủ phòng gym");
    assert.equal(recentUsers(d)[0].active, false);
  });
});
