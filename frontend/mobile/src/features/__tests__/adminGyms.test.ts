/**
 * Phase 13 cụm B — AD-02 duyệt chi nhánh phòng gym.
 *
 * Chạy: npx tsx --test src/features/__tests__/adminGyms.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  approvesBrandToo,
  branchDocuments,
  branchIssuesError,
  branchIssuesPayload,
  brandRenameQueue,
  closedNeedingAttention,
  displayAddress,
  displayName,
  firstTimeQueue,
  gymEditError,
  gymEditFormFrom,
  gymEditPayload,
  gymRows,
  hoursDeclared,
  hoursRows,
  renameNotesError,
  renameNotesPayload,
  renameQueue,
  searchGyms,
  toggleBranchIssue,
  type AdminGym,
} from "../admin/adminGyms";

const g = (over: Partial<AdminGym>): AdminGym => ({ id: "x", name: "Gym", address: "1 A", status: "APPROVED", ...over });

describe("năm hàng việc", () => {
  const gyms = gymRows({
    success: true,
    data: [
      g({ id: "new2", status: "PENDING_REVIEW", createdAt: "2026-09-27T00:00:00Z" }),
      g({ id: "new1", status: "PENDING_REVIEW", createdAt: "2026-09-20T00:00:00Z" }),
      g({ id: "ren", approvedName: "Tên cũ", pendingName: "Tên mới" }),
      g({ id: "addr", approvedName: "Gym", approvedAddress: "1 A", pendingAddress: "2 B" }),
      // Nháp / chưa từng duyệt: pendingName là tên khai trong wizard, không phải xin đổi.
      g({ id: "draft", status: "DRAFT", approvedName: null, pendingName: "Gym" }),
      g({ id: "never", status: "SUSPENDED", approvedName: null, pendingName: "Gym" }),
      // Tên chờ trùng tên đang hiển thị: không có gì để duyệt.
      g({ id: "same", approvedName: "Gym", pendingName: "Gym" }),
      g({ id: "ok" }),
      { nope: true },
    ],
  });

  it("chờ duyệt lần đầu: cũ nhất lên đầu; đổi tên/địa chỉ tách riêng", () => {
    assert.deepEqual(firstTimeQueue(gyms).map((x) => x.id), ["new1", "new2"]);
    assert.deepEqual(renameQueue(gyms).map((x) => x.id), ["ren", "addr"]);
  });

  it("đổi tên thương hiệu: bỏ dòng tên chờ trùng tên đã duyệt (không có gì để duyệt)", () => {
    const q = brandRenameQueue([
      { id: "a", name: "A", approvedName: null, pendingName: "A" },
      { id: "b", name: "B", approvedName: "B", pendingName: "B" },
      { id: "c", name: "C", approvedName: "C", pendingName: "C mới" },
    ]);
    assert.deepEqual(q.map((b) => b.id), ["a", "c"]);
  });

  it("đóng cửa vĩnh viễn: chỉ đếm chi nhánh còn hội viên", () => {
    assert.equal(closedNeedingAttention([g({ activeMembershipCount: 3 }), g({ activeMembershipCount: 0 }), g({})]), 1);
  });

  it("duyệt chi nhánh đầu của thương hiệu chưa từng duyệt = duyệt luôn tên thương hiệu", () => {
    assert.equal(approvesBrandToo(g({ brand: { id: "b", name: "B", approvedName: null } })), true);
    assert.equal(approvesBrandToo(g({ brand: { id: "b", name: "B", approvedName: "B" } })), false);
    assert.equal(approvesBrandToo(g({})), false);
  });

  it("tên/địa chỉ hiển thị là bản đã duyệt; tìm không dấu", () => {
    const x = g({ name: "Mới", approvedName: "Cũ", address: "a", approvedAddress: "Lê Lợi", city: "HCM" });
    assert.equal(displayName(x), "Cũ");
    assert.equal(displayAddress(x), "Lê Lợi, HCM");
    assert.equal(searchGyms([x], "le loi").length, 1);
    assert.equal(searchGyms([x], "hanoi").length, 0);
  });
});

describe("yêu cầu sửa", () => {
  it("7 mục: tích mà chưa ghi thì chặn; payload theo đúng thứ tự mục", () => {
    let d = toggleBranchIssue({}, "PHOTOS");
    d = toggleBranchIssue(d, "BASIC_INFO");
    assert.ok(branchIssuesError(d));
    d = { ...d, PHOTOS: "Thiếu ảnh mặt tiền", BASIC_INFO: " Sai SĐT " };
    assert.equal(branchIssuesError(d), null);
    assert.deepEqual(branchIssuesPayload(d).map((i) => i.category), ["BASIC_INFO", "PHOTOS"]);
    assert.equal(branchIssuesPayload(d)[0].message, "Sai SĐT");
    assert.deepEqual(toggleBranchIssue(d, "PHOTOS"), { BASIC_INFO: " Sai SĐT " });
    assert.ok(branchIssuesError({}));
  });

  it("đổi tên/địa chỉ: cần ít nhất một ghi chú, bỏ ô trống", () => {
    assert.ok(renameNotesError(" ", ""));
    assert.equal(renameNotesError("", "Sai số nhà"), null);
    assert.deepEqual(renameNotesPayload(" ", " Sai số nhà "), { addressNote: "Sai số nhà" });
  });
});

describe("chi tiết và sửa trực tiếp", () => {
  it("giờ: chưa khai thì nói chưa khai, không nói đóng cả tuần", () => {
    const none = { data: [{ id: null, day: "MONDAY", type: "CLOSED" }] };
    assert.equal(hoursDeclared(none), false);
    const some = [
      { id: "1", day: "MONDAY", type: "OPEN", openMinute: 330, closeMinute: 1320 },
      { id: "2", day: "SUNDAY", type: "ALL_DAY" },
    ];
    assert.equal(hoursDeclared(some), true);
    assert.deepEqual(hoursRows(some), [
      { day: "Thứ 2", text: "05:30 – 22:00" },
      { day: "Chủ nhật", text: "Mở 24 giờ" },
    ]);
  });

  it("giấy tờ chi nhánh + giấy tờ đối tác", () => {
    const r = branchDocuments({ data: { documents: [{ docType: "LEASE_OR_PROPERTY_DOC", status: "PENDING" }], partnerContext: [{ docType: "BUSINESS_LICENSE", status: "VERIFIED" }] } });
    assert.equal(r.documents.length, 1);
    assert.equal(r.partnerContext[0].docType, "BUSINESS_LICENSE");
    assert.deepEqual(branchDocuments(null), { documents: [], partnerContext: [] });
  });

  it("sửa: chỉ gửi trường đã đổi; tên, địa chỉ bắt buộc; email phải đúng dạng", () => {
    const before = gymEditFormFrom(g({ name: "A", address: "1 A", phone: "090" }));
    const after = { ...before, phone: "091", email: "" };
    assert.deepEqual(gymEditPayload(before, after), { phone: "091" });
    assert.ok(gymEditError({ ...after, name: " " }));
    assert.ok(gymEditError({ ...after, email: "sai" }));
    assert.equal(gymEditError(after), null);
  });
});
