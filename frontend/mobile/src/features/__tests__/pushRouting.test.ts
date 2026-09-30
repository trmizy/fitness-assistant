/**
 * Phase 14.2 — bấm thông báo đẩy.
 *
 * Chạy: npx tsx --test src/features/__tests__/pushRouting.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isForCurrentUser, pushTapRoute, readPushData } from "../push/pushRouting";

const push = (over: Record<string, unknown> = {}) =>
  readPushData({ notificationId: "n1", userId: "u1", link: "", entityType: "SESSION", eventType: "SESSION_CONFIRMED", ...over });

describe("readPushData", () => {
  it("chuỗi rỗng / không phải chuỗi → null, không vỡ", () => {
    assert.deepEqual(readPushData({ notificationId: "n", userId: "", link: 5 }), {
      notificationId: "n",
      userId: null,
      link: null,
      entityType: null,
    });
    assert.equal(readPushData(undefined).userId, null);
  });
});

describe("isForCurrentUser", () => {
  it("chỉ đúng người được viết cho", () => {
    assert.equal(isForCurrentUser(push(), "u1"), true);
    assert.equal(isForCurrentUser(push(), "u2"), false, "tài khoản khác đăng nhập trên cùng máy");
    assert.equal(isForCurrentUser(push(), null), false, "đã đăng xuất");
    assert.equal(isForCurrentUser(push({ userId: "" }), "u1"), false, "push không ghi người nhận");
  });
});

describe("pushTapRoute", () => {
  it("khách: đi theo link như danh sách thông báo trong app", () => {
    assert.equal(pushTapRoute(push({ link: "/client/booking" }), "u1", "client"), "/client/services/booking");
    assert.equal(pushTapRoute(push({ link: "", entityType: "CONTRACT" }), "u1", "client"), "/client/services");
  });

  it("khách: không có chỗ riêng thì mở danh sách thông báo", () => {
    assert.equal(pushTapRoute(push({ link: "", entityType: "INBODY" }), "u1", "client"), "/client/notifications");
  });

  it("PT: link phía khách đi theo khách, còn lại về trang chủ PT — không lạc vào route khách", () => {
    assert.equal(pushTapRoute(push({ link: "/client/booking" }), "u1", "pt"), "/client/services/booking");
    assert.equal(pushTapRoute(push({ link: "/pt/schedule" }), "u1", "pt"), "/pt/dashboard");
    assert.equal(pushTapRoute(push({ link: "" }), "u1", "pt"), "/pt/dashboard");
  });

  it("chủ gym / quản trị viên về trang chủ của vai trò", () => {
    assert.equal(pushTapRoute(push({ link: "/client/booking" }), "u1", "gym_owner"), "/gym-owner/dashboard");
    assert.equal(pushTapRoute(push(), "u1", "admin"), "/admin/dashboard");
  });

  it("push của tài khoản khác hoặc khi chưa đăng nhập → không mở gì", () => {
    assert.equal(pushTapRoute(push(), "u2", "client"), null);
    assert.equal(pushTapRoute(push(), null, null), null);
  });
});
