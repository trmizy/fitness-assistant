import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { EventEmitter } from "node:events";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";
import { createEmailActionRateLimit } from "../middleware/emailActionRateLimit.middleware";

/**
 * GAP-4 (self-service password reset request) and GAP-5 (resend registration OTP) — see
 * MOBILE_BACKEND_GAPS.md. Same no-DB approach as registration-otp.test.ts: every authRepository
 * method these flows touch is monkey-patched per test. No SMTP_* env vars are set in this run, so
 * the real email functions take their dev fallback (delivered: false) and the responses carry
 * devOtp / devResetLink — which is how the raw code and link are recovered here without exposing
 * the module-private generators.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ── GAP-5: resendRegistrationOtp ─────────────────────────────────────────────────────────────

test("resendRegistrationOtp() re-issues a code for the SAME pending sign-up, resetting attempts", async () => {
  const pending = {
    email: "pending@example.com",
    passwordHash: "hashed-original-password",
    firstName: "Pen",
    lastName: "Ding",
    otpHash: sha256("111111"),
    expiresAt: new Date(Date.now() + 60_000),
    sentAt: new Date(Date.now() - 5 * 60_000), // well past the 60s cooldown
    attempts: 4,
  };
  const upserts: any[] = [];
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(authRepository, "findEmailVerificationByEmail", async () => pending),
    patch(authRepository, "upsertEmailVerification", async (data: any) => {
      upserts.push(data);
      return { ...data, attempts: 0 };
    }),
  ];

  try {
    const result = await authService.resendRegistrationOtp("pending@example.com");

    assert.equal(typeof result.devOtp, "string");
    assert.equal(result.devOtp!.length, 6);
    assert.equal(upserts.length, 1);
    // The new code replaces the old one...
    assert.equal(upserts[0].otpHash, sha256(result.devOtp!));
    assert.notEqual(upserts[0].otpHash, pending.otpHash);
    // ...but nothing about the account being created changes.
    assert.equal(upserts[0].passwordHash, "hashed-original-password");
    assert.equal(upserts[0].firstName, "Pen");
    assert.equal(upserts[0].lastName, "Ding");
    assert.ok(upserts[0].expiresAt.getTime() > Date.now(), "new code gets a fresh expiry");
    assert.equal(result.resendAfterSeconds, 60);
  } finally {
    restores.forEach((restore) => restore());
  }
});

test("resendRegistrationOtp() with no pending sign-up is 404 and writes nothing", async () => {
  let upserted = false;
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(authRepository, "findEmailVerificationByEmail", async () => null),
    patch(authRepository, "upsertEmailVerification", async () => {
      upserted = true;
    }),
  ];

  try {
    await assert.rejects(
      () => authService.resendRegistrationOtp("nobody@example.com"),
      (err: any) => err.status === 404,
    );
    assert.equal(upserted, false);
  } finally {
    restores.forEach((restore) => restore());
  }
});

test("resendRegistrationOtp() inside the cooldown is 429 and writes nothing", async () => {
  let upserted = false;
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(authRepository, "findEmailVerificationByEmail", async () => ({
      email: "fresh@example.com",
      sentAt: new Date(), // just sent
    })),
    patch(authRepository, "upsertEmailVerification", async () => {
      upserted = true;
    }),
  ];

  try {
    await assert.rejects(
      () => authService.resendRegistrationOtp("fresh@example.com"),
      (err: any) => err.status === 429,
    );
    assert.equal(upserted, false);
  } finally {
    restores.forEach((restore) => restore());
  }
});

test("resendRegistrationOtp() for an already-registered email is 409", async () => {
  const restore = patch(authRepository, "findUserByEmail", async () => ({ id: "u1" }));
  try {
    await assert.rejects(
      () => authService.resendRegistrationOtp("taken@example.com"),
      (err: any) => err.status === 409,
    );
  } finally {
    restore();
  }
});

// ── GAP-4: requestPasswordReset ──────────────────────────────────────────────────────────────

const BASE = "https://app.example.com/";

function patchResetIssuing(user: any) {
  const created: any[] = [];
  let invalidated = 0;
  const restores = [
    patch(authRepository, "findUserByEmail", async () => user),
    patch(authRepository, "findUserById", async () => user),
    patch(authRepository, "findLatestPasswordResetForUser", async () => null),
    patch(authRepository, "invalidatePasswordResets", async () => {
      invalidated += 1;
      return { count: 0 };
    }),
    patch(authRepository, "createPasswordResetToken", async (data: any) => {
      created.push(data);
      return data;
    }),
  ];
  return {
    created,
    invalidatedCount: () => invalidated,
    restore: () => restores.forEach((restore) => restore()),
  };
}

test("requestPasswordReset() for an active account issues a 1-hour single-use link to the given base", async () => {
  const user = { id: "u-active", email: "active@example.com", firstName: "Act", isActive: true };
  const issuing = patchResetIssuing(user);

  try {
    const before = Date.now();
    const result = await authService.requestPasswordReset("active@example.com", BASE);

    assert.equal(issuing.created.length, 1);
    assert.equal(issuing.invalidatedCount(), 1, "older links are invalidated when a new one is issued");
    assert.equal(issuing.created[0].requestedBy, null, "self-service requests carry no admin id");

    const ttlMs = issuing.created[0].expiresAt.getTime() - before;
    assert.ok(ttlMs > 55 * 60_000 && ttlMs <= 60 * 60_000 + 1000, `expected ~1h TTL, got ${ttlMs}ms`);

    assert.ok(result.devResetLink, "dev fallback returns the link when SMTP is unconfigured");
    const prefix = "https://app.example.com/dat-lai-mat-khau/";
    assert.ok(result.devResetLink!.startsWith(prefix), result.devResetLink);
    const rawToken = result.devResetLink!.slice(prefix.length);
    // Only the hash is stored, and it is the hash of the token actually put in the link.
    assert.equal(issuing.created[0].tokenHash, sha256(rawToken));
  } finally {
    issuing.restore();
  }
});

test("requestPasswordReset() answers identically for unknown, disabled and cooling-down accounts, issuing nothing", async () => {
  const answers: any[] = [];

  // Unknown email.
  let issuing = patchResetIssuing(null);
  try {
    answers.push(await authService.requestPasswordReset("ghost@example.com", BASE));
    assert.equal(issuing.created.length, 0);
  } finally {
    issuing.restore();
  }

  // Disabled account.
  issuing = patchResetIssuing({ id: "u-off", email: "off@example.com", isActive: false });
  try {
    answers.push(await authService.requestPasswordReset("off@example.com", BASE));
    assert.equal(issuing.created.length, 0);
  } finally {
    issuing.restore();
  }

  // Active account, but a link was issued 10 seconds ago.
  issuing = patchResetIssuing({ id: "u-cool", email: "cool@example.com", isActive: true });
  const restoreLatest = patch(authRepository, "findLatestPasswordResetForUser", async () => ({
    createdAt: new Date(Date.now() - 10_000),
  }));
  try {
    answers.push(await authService.requestPasswordReset("cool@example.com", BASE));
    assert.equal(issuing.created.length, 0);
  } finally {
    restoreLatest();
    issuing.restore();
  }

  for (const answer of answers) {
    assert.deepEqual(answer, answers[0], "every non-issuing path must look exactly alike");
    assert.equal(answer.devResetLink, undefined);
  }
});

// ── emailActionRateLimit middleware ──────────────────────────────────────────────────────────

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  setHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json() {
    this.emit("finish");
    return this;
  }
}

function hit(limiter: ReturnType<typeof createEmailActionRateLimit>, email: string) {
  const res = new FakeRes();
  let passed = false;
  limiter({ ip: "10.1.1.1", headers: {}, body: { email } } as any, res as any, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, retryAfter: res.headers["Retry-After"] };
}

test("emailActionRateLimit lets 5 requests through per email and blocks the 6th — successes count too", () => {
  const limiter = createEmailActionRateLimit("test-a");
  for (let i = 0; i < 5; i++) {
    assert.equal(hit(limiter, "flood@example.com").passed, true, `request ${i + 1} should pass`);
  }
  const sixth = hit(limiter, "flood@example.com");
  assert.equal(sixth.passed, false);
  assert.equal(sixth.status, 429);
  assert.ok(Number(sixth.retryAfter) > 0);
});

test("emailActionRateLimit keeps separate buckets per email and per scope", () => {
  const resend = createEmailActionRateLimit("test-resend");
  const reset = createEmailActionRateLimit("test-reset");
  for (let i = 0; i < 5; i++) hit(resend, "one@example.com");

  assert.equal(hit(resend, "one@example.com").passed, false);
  assert.equal(hit(resend, "two@example.com").passed, true, "another address is unaffected");
  assert.equal(hit(reset, "one@example.com").passed, true, "another endpoint is unaffected");
});
