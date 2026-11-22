/**
 * Item 5 — `can(permission)` đọc permissions[] của GET /owner/onboarding/status, FAIL-CLOSED.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasPartnerPermission, normalizePermissions, permissionChecker } from "../gymOwner/permissions";

const OWNER = { role: "OWNER", permissions: ["branch.write", "plan.write", "plan.view", "branch.status.temporary", "branch.status.permanent", "finance.withdraw"] };
const MANAGER = { role: "MANAGER", permissions: ["plan.view", "branch.status.temporary", "checkin.exception.approve"] };

describe("hasPartnerPermission", () => {
  it("chỉ true khi vai trò đã biết VÀ danh sách liệt kê đúng quyền", () => {
    assert.equal(hasPartnerPermission(OWNER, "plan.write"), true);
    assert.equal(hasPartnerPermission(MANAGER, "plan.write"), false); // quản lý xem được gói nhưng không tạo
    assert.equal(hasPartnerPermission(MANAGER, "plan.view"), true);
    assert.equal(hasPartnerPermission(MANAGER, "branch.status.permanent"), false);
    assert.equal(hasPartnerPermission(MANAGER, "checkin.exception.approve"), true);
  });
  it("chưa biết gì (đang tải / lỗi) thì không có quyền nào", () => {
    assert.equal(hasPartnerPermission(undefined, "plan.write"), false);
    assert.equal(hasPartnerPermission(null, "plan.write"), false);
    assert.equal(hasPartnerPermission({}, "plan.write"), false);
  });
  it("backend cũ chưa trả permissions thì không có quyền nào, dù role là OWNER (không mặc định OWNER)", () => {
    assert.equal(hasPartnerPermission({ role: "OWNER" }, "plan.write"), false);
    assert.equal(hasPartnerPermission({ role: "OWNER", permissions: null }, "branch.write"), false);
    assert.equal(hasPartnerPermission({ role: "OWNER", permissions: "plan.write" }, "plan.write"), false); // sai kiểu
  });
  it("thiếu role hoặc role lạ thì false dù permissions có quyền đó", () => {
    assert.equal(hasPartnerPermission({ permissions: ["plan.write"] }, "plan.write"), false);
    assert.equal(hasPartnerPermission({ role: "SUPERUSER", permissions: ["plan.write"] }, "plan.write"), false);
  });
  it("phần tử không phải chuỗi bị bỏ", () => {
    assert.deepEqual(normalizePermissions(["a", 1, null, "b", {}]), ["a", "b"]);
    assert.deepEqual(normalizePermissions(undefined), []);
  });
  it("permissionChecker trả hàm can()", () => {
    const can = permissionChecker(OWNER);
    assert.equal(can("finance.withdraw"), true);
    assert.equal(can("staff.manage"), false);
    assert.equal(permissionChecker(undefined)("plan.view"), false);
  });
});
