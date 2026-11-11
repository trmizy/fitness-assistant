import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";
import {
  PASSWORD_POLICY_MESSAGE_VI,
  changePasswordSchema,
  passwordPolicyViolation,
  registerSchema,
} from "../models/auth.models";

/**
 * N-A-07 — ONE password policy (registration's: >= 8 chars, upper + lower + digit) for registration,
 * self-service change, reset-by-token and invite-accept. "alllowercase1" used to be accepted by the
 * last three because they only checked the length. NE-02 — the resend-cooldown message is Vietnamese
 * and carries a machine code. No DB: every repository call is patched / never reached (BACKEND INTEGRATION).
 */

const SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const WEAK = ["alllowercase1", "ALLUPPERCASE1", "NoDigitsHere", "Sh0rt", "12345678"];
const STRONG = "GoodPass123";

test("passwordPolicyViolation: weak passwords give the Vietnamese sentence, strong ones null", () => {
  for (const pw of WEAK) assert.equal(passwordPolicyViolation(pw), PASSWORD_POLICY_MESSAGE_VI, pw);
  assert.equal(passwordPolicyViolation(undefined), PASSWORD_POLICY_MESSAGE_VI);
  assert.equal(passwordPolicyViolation(STRONG), null);
});

test("registration and change-password schemas apply the very same rule", () => {
  for (const pw of WEAK) {
    assert.equal(registerSchema.safeParse({ email: "a@example.com", password: pw }).success, false, `register ${pw}`);
    assert.equal(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: pw }).success, false, `change ${pw}`);
  }
  assert.equal(registerSchema.safeParse({ email: "a@example.com", password: STRONG }).success, true);
  assert.equal(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: STRONG }).success, true);
});

test("resetPasswordWithToken rejects a weak new password before touching the token", async () => {
  await assert.rejects(
    () => authService.resetPasswordWithToken("some-token", "alllowercase1"),
    (err: any) => err.status === 400 && err.code === "WEAK_PASSWORD" && err.message === PASSWORD_POLICY_MESSAGE_VI,
  );
});

test("createInvitedAccount rejects a weak password and creates nothing", async () => {
  const created: unknown[] = [];
  const restoreFind = patch(authRepository, "findUserByEmail", async () => null);
  const restoreCreate = patch(authRepository, "createUser", async (d: unknown) => {
    created.push(d);
    return { id: "u1", email: "i@example.com", firstName: "I", lastName: null, role: "GYM_OWNER" };
  });
  try {
    await assert.rejects(
      () => authService.createInvitedAccount({ email: "i@example.com", password: "alllowercase1", firstName: "I" }),
      (err: any) => err.status === 400 && err.code === "WEAK_PASSWORD",
    );
    assert.equal(created.length, 0);
    const ok = await authService.createInvitedAccount({ email: "i@example.com", password: STRONG, firstName: "I" });
    assert.equal(ok.id, "u1");
    assert.equal(created.length, 1);
  } finally {
    restoreFind();
    restoreCreate();
  }
});

test("PATCH /auth/me/password answers a weak new password with 400 + the Vietnamese sentence", async () => {
  const server: http.Server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = jwt.sign({ userId: "u1", role: "CUSTOMER", email: "u@example.com" }, SECRET, { expiresIn: "15m" });
  try {
    const res = await fetch(`${base}/auth/me/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: "old", newPassword: "alllowercase1" }),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.equal(body.error, PASSWORD_POLICY_MESSAGE_VI);
    assert.equal(body.code, "WEAK_PASSWORD");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("NE-02: register() inside the OTP cooldown says so in Vietnamese with a code and the seconds", async () => {
  const restoreFind = patch(authRepository, "findUserByEmail", async () => null);
  const restorePrev = patch(authRepository, "findEmailVerificationByEmail", async () => ({
    email: "cooldown@example.com",
    sentAt: new Date(),
  }));
  try {
    await assert.rejects(
      () => authService.register({ email: "cooldown@example.com", password: STRONG }),
      (err: any) =>
        err.status === 429 &&
        err.code === "OTP_RECENTLY_SENT" &&
        /^Mã vừa được gửi\. Vui lòng đợi \d+s$/.test(err.message) &&
        !/OTP recently/i.test(err.message),
    );
  } finally {
    restoreFind();
    restorePrev();
  }
});
