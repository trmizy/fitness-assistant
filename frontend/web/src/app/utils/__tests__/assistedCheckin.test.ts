/**
 * CODE/UNIT — D15c helper của check-in hộ ở quầy lễ tân. Chạy: npx tsx --test src/app/utils/__tests__/assistedCheckin.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assistedErrorText, canConfirm, formatCodeInput, initialsOf, isFullCode, newRequestId, normalizeConfig, normalizeExceptions, normalizeMembers,
} from "../assistedCheckin";

describe("assistedCheckin", () => {
  it("normalizeMembers keeps ONLY the minimal fields: phone / e-mail / price / ids / health are dropped even if the server sent them", () => {
    const [m] = normalizeMembers({
      results: [{
        membershipId: "m1", displayName: "Nguyễn An", memberCode: "A1B2-C3D4", planName: "Gói tháng", planType: "VISIT_BASED", status: "ACTIVE",
        expiresAt: "2026-11-01T00:00:00Z", remainingVisits: 4, photoUrl: "https://x/p.jpg", hasPhoto: true, canCheckIn: true, blockedReason: null,
        phone: "0988", email: "a@b.c", priceAtPurchase: "700000", clientId: "c1", healthNotes: "x", paymentTxnId: "T",
      }],
    });
    assert.deepEqual(Object.keys(m).sort(), [
      "blockedReason", "canCheckIn", "displayName", "expiresAt", "hasPhoto", "memberCode", "membershipId", "photoUrl", "planName", "planType", "remainingVisits", "status",
    ]);
    assert.equal(JSON.stringify(m).includes("0988"), false);
    assert.equal(JSON.stringify(m).includes("700000"), false);
  });

  it("normalizeMembers is defensive: junk rows dropped, unknown status becomes EXPIRED (never ACTIVE), missing name is neutral", () => {
    assert.deepEqual(normalizeMembers(null), []);
    assert.deepEqual(normalizeMembers({ results: [null, {}, { membershipId: "" }] }), []);
    const [m] = normalizeMembers({ results: [{ membershipId: "m", status: "WHATEVER", canCheckIn: "yes" }] });
    assert.equal(m.status, "EXPIRED");
    assert.equal(m.canCheckIn, false);
    assert.equal(m.displayName, "Hội viên");
  });

  it("normalizeConfig only keeps known automatic methods", () => {
    assert.deepEqual(normalizeConfig({ methods: ["PHOTO_MATCH", "BOGUS", "MEMBER_OTP"] }).methods, ["PHOTO_MATCH", "MEMBER_OTP"]);
    assert.deepEqual(normalizeConfig(undefined).methods, []);
  });

  it("normalizeExceptions drops staff / client ids and defaults safely", () => {
    const v = normalizeExceptions({ canApprove: true, exceptions: [{ id: "e1", status: "PENDING", requestedBy: "uid", clientId: "c", mine: true }, { id: "" }] });
    assert.equal(v.canApprove, true);
    assert.equal(v.exceptions.length, 1);
    assert.equal("requestedBy" in v.exceptions[0], false);
    assert.equal("clientId" in v.exceptions[0], false);
    assert.equal(v.exceptions[0].mine, true);
  });

  it("code input is normalised to XXXX-XXXX and full-code detection ignores separators", () => {
    assert.equal(formatCodeInput("a1b2c3d4ff"), "A1B2-C3D4");
    assert.equal(formatCodeInput("a1b"), "A1B");
    assert.equal(isFullCode("A1B2-C3D4"), true);
    assert.equal(isFullCode("A1B2-C3D"), false);
  });

  it("request ids are unique and accepted by the server's pattern (8-100 chars of [A-Za-z0-9_.:-])", () => {
    const a = newRequestId(), b = newRequestId();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_.:-]{8,100}$/);
  });

  it("canConfirm demands the right proof per method", () => {
    const base = { reason: "Quên điện thoại", photoAttested: false, statedCode: "", otp: "", challengeId: null, exceptionId: null };
    assert.equal(canConfirm({ ...base, method: "PHOTO_MATCH" }), false);
    assert.equal(canConfirm({ ...base, method: "PHOTO_MATCH", photoAttested: true, statedCode: "A1B2-C3D4" }), true);
    assert.equal(canConfirm({ ...base, method: "PHOTO_MATCH", photoAttested: true, statedCode: "A1B2" }), false);
    assert.equal(canConfirm({ ...base, method: "MEMBER_OTP", challengeId: "c", otp: "12345" }), false);
    assert.equal(canConfirm({ ...base, method: "MEMBER_OTP", challengeId: "c", otp: "123456" }), true);
    assert.equal(canConfirm({ ...base, method: "MEMBER_OTP", challengeId: null, otp: "123456" }), false);
    assert.equal(canConfirm({ ...base, method: "MANAGER_EXCEPTION" }), false);
    assert.equal(canConfirm({ ...base, method: "MANAGER_EXCEPTION", exceptionId: "e" }), true);
    assert.equal(canConfirm({ ...base, method: "MANAGER_EXCEPTION", exceptionId: "e", reason: "" }), false);
  });

  it("errors map to Vietnamese sentences, never raw codes", () => {
    const err = (code: string) => ({ response: { status: 400, data: { error: { code } } } });
    assert.match(assistedErrorText(err("TOO_SOON")), /1 phút/);
    assert.match(assistedErrorText(err("OTP_INVALID")), /không đúng/);
    assert.equal(assistedErrorText(err("SOMETHING_NEW")).includes("SOMETHING_NEW"), false);
    assert.match(assistedErrorText({ response: { status: 403, data: {} } }), /quyền/);
    assert.match(assistedErrorText(new Error("boom")), /Có lỗi/);
  });

  it("initials", () => {
    assert.equal(initialsOf("Nguyễn Văn An"), "NA");
    assert.equal(initialsOf(""), "HV");
  });
});
