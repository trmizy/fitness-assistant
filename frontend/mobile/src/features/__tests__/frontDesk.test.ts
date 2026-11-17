/**
 * N15M-08 — receptionist front desk: pure helpers.
 * Runs with: npx tsx --test src/features/__tests__/frontDesk.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assistedErrorText,
  canConfirm,
  clockLabel,
  filterByName,
  formatCodeInput,
  formatExpiry,
  isFullCode,
  newRequestId,
  normalizeFrontDeskToday,
  normalizeMembers,
  normalizeTodayPts,
  presenceOf,
} from "../gymOwner/frontDesk";

describe("frontDesk", () => {
  it("keeps only the minimum member fields, even if the server sends more", () => {
    const rows = normalizeMembers({
      results: [
        {
          membershipId: "m1",
          displayName: "An",
          memberCode: "ABCD-1234",
          planName: "Tháng",
          planType: "TIME_BASED",
          status: "ACTIVE",
          canCheckIn: true,
          phone: "0900",
          email: "a@b.c",
          priceAtPurchase: 5,
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "blockedReason",
      "canCheckIn",
      "displayName",
      "expiresAt",
      "hasPhoto",
      "memberCode",
      "membershipId",
      "photoUrl",
      "planName",
      "planType",
      "remainingVisits",
      "status",
    ]);
  });

  it("today's guests and trainers: names + times only", () => {
    const t = normalizeFrontDeskToday({
      clients: [{ displayName: "Lan", checkedInAt: "2026-11-16T02:15:00.000Z", clientId: "x", phone: "1" }],
      bookingsAvailable: false,
    });
    assert.equal(t.bookingsAvailable, false);
    assert.deepEqual(Object.keys(t.clients[0]).sort(), ["bookedAt", "checkedInAt", "displayName"]);
    assert.equal(presenceOf(t.clients[0]).label, "Đã vào 09:15"); // UTC+7, independent of the phone's zone
    assert.deepEqual(
      normalizeTodayPts({ pts: [{ id: "p", ptName: "Vi", firstScanAt: "2026-11-16T01:00:00Z", ptUserId: "u" }] }),
      [{ id: "p", ptName: "Vi", firstScanAt: "2026-11-16T01:00:00Z" }],
    );
    assert.equal(clockLabel(null), "");
    assert.equal(formatExpiry("2026-12-09T20:00:00Z"), "10/12/2026");
    assert.equal(formatExpiry(null), "Không giới hạn");
  });

  it("member code input and search filter", () => {
    assert.equal(formatCodeInput("abcd12345xyz"), "ABCD-1234");
    assert.equal(isFullCode("ABCD-1234"), true);
    assert.equal(isFullCode("ABCD-12"), false);
    assert.equal(filterByName([{ displayName: "Nguyễn An" }, { displayName: "Lê Bình" }], " an ").length, 1);
  });

  it("confirm is gated per method", () => {
    const base = {
      method: "PHOTO_MATCH" as const,
      reason: "Quên điện thoại",
      photoAttested: true,
      statedCode: "ABCD-1234",
      otp: "",
      challengeId: null,
      exceptionId: null,
    };
    assert.equal(canConfirm(base), true);
    assert.equal(canConfirm({ ...base, photoAttested: false }), false);
    assert.equal(canConfirm({ ...base, method: "MEMBER_OTP", challengeId: "c", otp: "123456" }), true);
    assert.equal(canConfirm({ ...base, method: "MEMBER_OTP", challengeId: "c", otp: "12" }), false);
    assert.equal(canConfirm({ ...base, method: "MANAGER_EXCEPTION" }), false);
    assert.equal(canConfirm({ ...base, method: "MANAGER_EXCEPTION", exceptionId: "e" }), true);
    assert.equal(canConfirm({ ...base, reason: "x" }), false);
  });

  it("idempotency key shape and error text", () => {
    assert.match(newRequestId(), /^[A-Za-z0-9_.:-]{8,100}$/);
    assert.match(assistedErrorText({ response: { status: 400, data: { error: { code: "OTP_INVALID" } } } }), /không đúng/);
    assert.match(assistedErrorText({ response: { status: 403 } }), /không có quyền/);
  });
});
