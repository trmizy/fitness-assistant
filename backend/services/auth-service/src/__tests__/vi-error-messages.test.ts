import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import app from "../app";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";
import { PASSWORD_POLICY_MESSAGE_VI, describeValidationError, registerStartSchema, registerVerifySchema } from "../models/auth.models";

/**
 * N13A-01/02/03 — registration, OTP and change-password failures answer Vietnamese text + a stable code
 * (the web matches on the code, never on the text). No DB: repository calls are patched or never reached (BACKEND INTEGRATION).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const server: http.Server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("describeValidationError: weak password / bad email / bad otp / other", () => {
  const weak = registerStartSchema.safeParse({ email: "a@b.vn", password: "alllowercase1" });
  assert.ok(!weak.success);
  assert.deepEqual(describeValidationError((weak as { error: z.ZodError }).error), { error: PASSWORD_POLICY_MESSAGE_VI, code: "WEAK_PASSWORD" });
  const badEmail = registerStartSchema.safeParse({ email: "not-an-email", password: "Strong1pass" });
  assert.ok(!badEmail.success);
  assert.deepEqual(describeValidationError((badEmail as { error: z.ZodError }).error), { error: "Email không hợp lệ", code: "INVALID_EMAIL" });
  const badOtp = registerVerifySchema.safeParse({ email: "a@b.vn", otp: "12" });
  assert.ok(!badOtp.success);
  assert.equal(describeValidationError((badOtp as { error: z.ZodError }).error).code, "OTP_FORMAT_INVALID");
  assert.equal(describeValidationError(new z.ZodError([])).code, "VALIDATION_FAILED");
});

test("POST /auth/register with a weak password -> 400 Vietnamese policy + WEAK_PASSWORD (not 'Validation failed')", async () => {
  const r = await post("/auth/register", { email: "weak@example.com", password: "alllowercase1", firstName: "A", lastName: "B" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, PASSWORD_POLICY_MESSAGE_VI);
  assert.equal(r.body.code, "WEAK_PASSWORD");
});

test("POST /auth/register with a malformed email -> 400 'Email không hợp lệ'", async () => {
  const r = await post("/auth/register", { email: "khong-phai-email", password: "Strong1pass" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Email không hợp lệ");
  assert.equal(r.body.code, "INVALID_EMAIL");
});

test("register() with a taken email -> 409 + EMAIL_ALREADY_REGISTERED", async () => {
  const restore = patch(authRepository, "findUserByEmail", async () => ({ id: "u1", email: "taken@example.com" }));
  try {
    await assert.rejects(
      () => authService.register({ email: "taken@example.com", password: "Strong1pass" }),
      (err: any) => err.status === 409 && err.code === "EMAIL_ALREADY_REGISTERED" && err.message === "Email đã đăng ký",
    );
  } finally {
    restore();
  }
});

test("verifyRegistration(): wrong / expired / exhausted OTP answer Vietnamese + codes", async () => {
  const email = "otp-vi@example.com";
  const base = { email, passwordHash: "h", firstName: "A", lastName: "B", attempts: 0 };
  const restoreInc = patch(authRepository, "incrementEmailVerificationAttempts", async () => {});
  const run = async (record: unknown, otp: string) => {
    const restore = patch(authRepository, "findEmailVerificationByEmail", async () => record);
    try {
      await authService.verifyRegistration({ email, otp });
    } catch (e) {
      return e as { status: number; code: string; message: string };
    } finally {
      restore();
    }
    throw new Error("expected a rejection");
  };
  try {
    const future = new Date(Date.now() + 60_000);
    // wrong code
    const wrong = await run({ ...base, otpHash: "not-the-hash", expiresAt: future }, "000000");
    assert.deepEqual([wrong.status, wrong.code, wrong.message], [400, "OTP_INVALID", "Mã xác nhận không đúng."]);
    // expired
    const expired = await run({ ...base, otpHash: "x", expiresAt: new Date(Date.now() - 1000) }, "000000");
    assert.equal(expired.code, "OTP_EXPIRED");
    assert.match(expired.message, /hết hạn/);
    // attempts exceeded
    const maxed = await run({ ...base, otpHash: "x", expiresAt: future, attempts: 999 }, "000000");
    assert.deepEqual([maxed.status, maxed.code], [429, "OTP_ATTEMPTS_EXCEEDED"]);
    assert.match(maxed.message, /sai quá nhiều lần/);
    // none pending
    const none = await run(null, "000000");
    assert.equal(none.code, "OTP_NOT_FOUND");
    for (const e of [wrong, expired, maxed, none]) assert.ok(!/[A-Za-z]+ [a-z]+ (expired|invalid|exceeded|not found)/i.test(e.message), e.message);
  } finally {
    restoreInc();
  }
});
