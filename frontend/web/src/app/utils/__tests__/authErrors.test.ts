/**
 * N13A-01/02/03: web mapping of register / OTP / change-password failures.
 * Run: npx tsx --test src/app/utils/__tests__/authErrors.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage, isEmailAlreadyRegistered } from "../authErrors";

const http = (status: number, data: Record<string, unknown>) => ({ response: { status, data } });

describe("isEmailAlreadyRegistered", () => {
  it("matches the code, the 409 status, and not other failures", () => {
    assert.equal(isEmailAlreadyRegistered(http(409, { error: "Email đã đăng ký", code: "EMAIL_ALREADY_REGISTERED" })), true);
    assert.equal(isEmailAlreadyRegistered(http(409, { error: "Email đã đăng ký" })), true);
    assert.equal(isEmailAlreadyRegistered(http(400, { error: "Email already registered", code: "EMAIL_ALREADY_REGISTERED" })), true);
    assert.equal(isEmailAlreadyRegistered(http(400, { error: "Validation failed" })), false);
    assert.equal(isEmailAlreadyRegistered(new Error("Network Error")), false);
  });
});

describe("authErrorMessage", () => {
  it("weak password -> the Vietnamese policy sentence, not 'Validation failed'", () => {
    const viaCode = authErrorMessage(http(400, { error: "Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và chữ số", code: "WEAK_PASSWORD" }), "x");
    assert.match(viaCode, /ít nhất 8 ký tự/);
    const legacy = authErrorMessage(http(400, { error: "Validation failed", details: [{ path: ["password"], message: "Password must contain" }] }), "x");
    assert.match(legacy, /ít nhất 8 ký tự/);
    assert.ok(!/validation/i.test(legacy));
  });
  it("bad email via details", () => {
    assert.equal(authErrorMessage(http(400, { error: "Validation failed", details: [{ path: ["email"] }] }), "x"), "Email không hợp lệ.");
  });
  it("OTP errors by code and by legacy English text", () => {
    assert.match(authErrorMessage(http(400, { error: "Mã xác nhận không đúng.", code: "OTP_INVALID" }), "x"), /không đúng/);
    assert.match(authErrorMessage(http(400, { error: "OTP expired" }), "x"), /hết hạn/);
    assert.match(authErrorMessage(http(429, { error: "OTP attempts exceeded" }), "x"), /sai quá nhiều lần/);
    assert.match(authErrorMessage(http(400, { error: "Invalid OTP" }), "x"), /không đúng/);
  });
  it("change-password errors", () => {
    assert.equal(authErrorMessage(http(401, { error: "Current password is incorrect" }), "x"), "Mật khẩu hiện tại không đúng.");
    assert.equal(authErrorMessage(http(400, { error: "New password must be different" }), "x"), "Mật khẩu mới phải khác mật khẩu hiện tại.");
    assert.equal(authErrorMessage(http(400, { code: "NEW_PASSWORD_SAME_AS_CURRENT", error: "..." }), "x"), "Mật khẩu mới phải khác mật khẩu hiện tại.");
  });
  it("network error / unknown English text -> Vietnamese fallback", () => {
    assert.match(authErrorMessage(new Error("Network Error"), "x"), /Không kết nối/);
    assert.equal(authErrorMessage(http(500, { error: "Internal server error" }), "Đăng ký thất bại"), "Đăng ký thất bại");
  });
  it("a Vietnamese server sentence is passed through", () => {
    assert.equal(authErrorMessage(http(429, { error: "Mã vừa được gửi. Vui lòng đợi 30s", code: "OTP_RECENTLY_SENT" }), "x"), "Mã vừa được gửi. Vui lòng đợi 30s");
  });
});
