/**
 * N15M-11 — bấm thông báo hợp đồng / buổi tập phải mở đúng hợp đồng / buổi tập.
 * Các cặp (eventType, entityType, link) dưới đây là đúng những gì user-service ghi (đọc ở backend 16/11):
 *  contract.service  -> link /client/contracts | /pt/contracts, entity CONTRACT
 *  booking.service   -> link /client/booking | /client/wallet | /pt/schedule, entity SESSION
 *  PT feedback       -> link /client/services, entity CONTRACT
 *  dispute notices   -> link /client/booking | /pt/schedule, entity DISPUTE_CASE (entityId là id HỒ SƠ, không phải id buổi)
 *
 * Chạy: npx tsx --test src/features/__tests__/notificationRoute.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { notificationPushOptions, notificationRoute } from "../notifications/notifications";

const C = "11111111-2222-3333-4444-555555555555";
const S = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("notificationRoute — hợp đồng", () => {
  it("link /client/contracts + CONTRACT → tab Hợp đồng, đúng hợp đồng", () => {
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: "CONTRACT", entityId: C }), `/client/services?tab=contracts&contractId=${C}`);
  });
  it("link /client/services (PT gửi phản hồi) + CONTRACT → cũng là Hợp đồng, không phải Tìm PT", () => {
    assert.equal(notificationRoute({ link: "/client/services", entityType: "CONTRACT", entityId: C }), `/client/services?tab=contracts&contractId=${C}`);
  });
  it("không có id → danh sách Hợp đồng", () => {
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: "CONTRACT", entityId: null }), "/client/services?tab=contracts");
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: null }), "/client/services?tab=contracts");
    assert.equal(notificationRoute({ link: null, entityType: "CONTRACT" }), "/client/services?tab=contracts");
  });
  it("id lạ (có ký tự lạ) không bao giờ lọt vào route", () => {
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: "CONTRACT", entityId: "x&tab=gyms" }), "/client/services?tab=contracts");
  });
  it("link /client/services không gắn hợp đồng vẫn là tab mặc định", () => {
    assert.equal(notificationRoute({ link: "/client/services", entityType: null }), "/client/services");
  });
  it("phía PT: /pt/contracts mở màn hợp đồng của PT", () => {
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "CONTRACT", entityId: C }), `/pt/contracts?contractId=${C}`);
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "CONTRACT", entityId: null }), "/pt/contracts");
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "DISPUTE_CASE", entityId: S }), "/pt/contracts", "a case id is not a contract id");
  });
  it("N16M-02: thông báo buổi tập của PT mang link /pt/contracts → vẫn mở đúng buổi trong Lịch dạy", () => {
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "SESSION", entityId: S }), `/pt/schedule?sessionId=${S}`);
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "SESSION", entityId: null }), "/pt/schedule");
    assert.equal(notificationRoute({ link: "/pt/contracts", entityType: "SESSION", entityId: "x&y=1" }), "/pt/schedule", "id lạ không lọt vào route");
  });
  it("N16M-02: phía khách, thông báo buổi tập mang link hợp đồng / Dịch vụ → mở buổi đặt", () => {
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: "SESSION", entityId: S }), `/client/services/booking?sessionId=${S}`);
    assert.equal(notificationRoute({ link: "/client/services", entityType: "SESSION", entityId: S }), `/client/services/booking?sessionId=${S}`);
    assert.equal(notificationRoute({ link: "/client/contracts", entityType: "SESSION", entityId: null }), "/client/services/booking");
  });
});

describe("notificationRoute — buổi tập", () => {
  it("link /client/booking + SESSION → Buổi tập, mở đúng buổi", () => {
    assert.equal(notificationRoute({ link: "/client/booking", entityType: "SESSION", entityId: S }), `/client/services/booking?sessionId=${S}`);
  });
  it("không có link, chỉ có entity SESSION → vẫn mở đúng buổi", () => {
    assert.equal(notificationRoute({ link: null, entityType: "SESSION", entityId: S }), `/client/services/booking?sessionId=${S}`);
  });
  it("không có id → danh sách Buổi tập", () => {
    assert.equal(notificationRoute({ link: "/client/booking", entityType: "SESSION", entityId: null }), "/client/services/booking");
  });
  it("thông báo hoàn tiền buổi tập (link ví) vẫn mở ví", () => {
    assert.equal(notificationRoute({ link: "/client/wallet", entityType: "SESSION", entityId: S }), "/client/profile/wallet");
  });
  it("thông báo khiếu nại: entityId là id hồ sơ → không được coi là id buổi", () => {
    assert.equal(notificationRoute({ link: "/client/booking", entityType: "DISPUTE_CASE", entityId: S }), "/client/services/booking");
  });
  it("phía PT: /pt/schedule mở lịch dạy", () => {
    assert.equal(notificationRoute({ link: "/pt/schedule", entityType: "SESSION", entityId: S }), `/pt/schedule?sessionId=${S}`);
    assert.equal(notificationRoute({ link: "/pt/schedule", entityType: "SESSION", entityId: null }), "/pt/schedule");
    assert.equal(notificationRoute({ link: "/pt/schedule", entityType: "DISPUTE_CASE", entityId: S }), "/pt/schedule", "dispute notices carry the case id");
  });
});

describe("notificationRoute — các link còn lại của server (rà soát)", () => {
  const cases: [string, string | null][] = [
    ["/client/workout", "/client/workout"],
    ["/client/workout/cycle", "/client/workout"],
    ["/client/nutrition", "/client/workout/nutrition"],
    ["/client/pt-application", "/client/profile/pt-application"],
    ["/pt/wallet", "/pt/wallet"],
    ["/pt/listing", "/pt/listing"],
    ["/admin/finance/withdrawals", "/admin/withdrawals"],
    ["/admin/disputes", null], // admin không có danh sách thông báo trên mobile
    ["/partner/application", null],
  ];
  for (const [link, expected] of cases) {
    it(`${link} → ${expected ?? "không mở gì"}`, () => {
      assert.equal(notificationRoute({ link, entityType: null }), expected);
    });
  }
});

describe("notificationPushOptions — N17M-01 (neo trang chủ của stack khi đẩy từ tab khác)", () => {
  it("đích nằm TRONG stack của một tab → withAnchor để hub (index) nằm dưới", () => {
    for (const route of [
      `/client/services/booking?sessionId=${S}`,
      "/client/services/booking",
      "/client/profile/wallet",
      "/client/workout/nutrition",
      "/client/profile/pt-application",
      "/pt/service-orders/abc",
    ]) {
      assert.deepEqual(notificationPushOptions(route), { withAnchor: true }, route);
    }
  });
  it("gốc của tab (không có gì để neo) → không thêm tuỳ chọn", () => {
    for (const route of [
      `/client/services?tab=contracts&contractId=${C}`,
      "/client/services",
      "/client/dashboard",
      "/client/workout",
      `/pt/schedule?sessionId=${S}`,
      `/pt/contracts?contractId=${C}`,
      "/pt/wallet",
      "/admin/withdrawals",
    ]) {
      assert.equal(notificationPushOptions(route), undefined, route);
    }
  });
  it("mọi đích thật của notificationRoute cho buổi tập / hợp đồng đều được xử lý nhất quán", () => {
    const session = notificationRoute({ link: "/client/booking", entityType: "SESSION", entityId: S })!;
    assert.deepEqual(notificationPushOptions(session), { withAnchor: true });
    const contract = notificationRoute({ link: "/client/contracts", entityType: "CONTRACT", entityId: C })!;
    assert.equal(notificationPushOptions(contract), undefined);
  });
});
