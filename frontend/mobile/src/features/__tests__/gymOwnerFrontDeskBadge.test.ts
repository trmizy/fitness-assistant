/**
 * Item 6 — huy hiệu "Quầy lễ tân" (đếm yêu cầu ngoại lệ chờ duyệt) và route của thông báo GYM_CHECKIN_EXCEPTION_REQUESTED.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countPendingExceptions } from "../gymOwner/frontDesk";
import { gymFrontDeskRoute, notificationMeta, notificationRoute } from "../notifications/notifications";

describe("countPendingExceptions (huy hiệu Quầy lễ tân)", () => {
  const ex = (id: string, status: string, mine = false) => ({ id, status, mine });
  it("chỉ tính PENDING của người khác, và chỉ khi server nói canApprove", () => {
    const manager = { canApprove: true, exceptions: [ex("1", "PENDING"), ex("2", "PENDING", true), ex("3", "APPROVED"), ex("4", "REJECTED")] };
    const receptionist = { canApprove: false, exceptions: [ex("5", "PENDING")] };
    assert.equal(countPendingExceptions([manager]), 1);
    assert.equal(countPendingExceptions([receptionist]), 0);
    assert.equal(countPendingExceptions([manager, manager, receptionist]), 2);
  });
  it("phản hồi lỗi / sai dạng / chi nhánh không đọc được tính là 0", () => {
    assert.equal(countPendingExceptions([null, undefined, "x", {}, { canApprove: true }, { canApprove: true, exceptions: "nope" }]), 0);
    assert.equal(countPendingExceptions([]), 0);
  });
});

describe("notificationRoute: ngoại lệ check-in (GYM_CHECKIN_EXCEPTION_REQUESTED)", () => {
  const G = "bbbbbbbb-1111-2222-3333-444444444444";
  it("có nhãn tiếng Việt", () => {
    assert.equal(notificationMeta("GYM_CHECKIN_EXCEPTION_REQUESTED").title, "Ngoại lệ check-in chờ duyệt");
  });
  it("link /gym-owner/front-desk?gymId=... mở tab Quầy lễ tân của đúng chi nhánh", () => {
    assert.equal(notificationRoute({ link: `/gym-owner/front-desk?gymId=${G}`, entityType: "GYM_BRANCH", entityId: G }), `/gym-owner/front-desk?gymId=${G}`);
    assert.equal(gymFrontDeskRoute(`/gym-owner/front-desk?gymId=${G}`), `/gym-owner/front-desk?gymId=${G}`);
  });
  it("không có gymId hoặc gymId lạ thì vẫn mở Quầy lễ tân, không mang chuỗi lạ theo", () => {
    assert.equal(notificationRoute({ link: "/gym-owner/front-desk", entityType: "GYM_BRANCH" }), "/gym-owner/front-desk");
    assert.equal(gymFrontDeskRoute("/gym-owner/front-desk?gymId=../../x"), "/gym-owner/front-desk");
    assert.equal(gymFrontDeskRoute("/gym-owner/front-desk/"), "/gym-owner/front-desk");
    assert.equal(gymFrontDeskRoute("/gym-owner/finance"), null);
  });
});
