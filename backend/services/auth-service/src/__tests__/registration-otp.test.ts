import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";

/**
 * Money-flow plan 5.4 — minimum auth-service test coverage: registration + OTP verification
 * (expiry, wrong-attempt-count limit). No real DB: every authRepository method these flows
 * touch is monkey-patched per test (same pattern as set-user-active-relays-pt-deactivation.test.ts),
 * so a genuine Postgres connection is never required to prove this logic.
 *
 * The raw OTP is never exposed by any exported function (hashOtp/generateOtp are module-private
 * in auth.service.ts) — these tests recover it from `register()`'s own `devOtp` response field,
 * which auth.service.ts only fills in when SMTP is unconfigured and NODE_ENV isn't "production"
 * (see email.service.ts). That is the actual ambient state of this test run (no SMTP_* env vars,
 * NODE_ENV left unset), so this exercises the real code path rather than a rigged one.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

test("register() with a brand-new email stores a hashed OTP and returns it in devOtp (no SMTP configured)", async () => {
  const upsertCalls: any[] = [];
  const restoreFind = patch(authRepository, "findUserByEmail", async () => null);
  const restorePrev = patch(authRepository, "findEmailVerificationByEmail", async () => null);
  const restoreUpsert = patch(authRepository, "upsertEmailVerification", async (data: any) => {
    upsertCalls.push(data);
    return { ...data, attempts: 0 };
  });

  try {
    const result = await authService.register({
      email: "newbie@example.com",
      password: "correct horse battery staple",
      firstName: "New",
      lastName: "Bie",
    });

    assert.equal(result.email, "newbie@example.com");
    assert.equal(typeof result.devOtp, "string", "devOtp must be present when SMTP is unconfigured outside production");
    assert.equal(result.devOtp!.length, 6);

    assert.equal(upsertCalls.length, 1);
    // The stored hash must actually correspond to the OTP handed back — not a stub value
    // that would make this assertion pass regardless of what register() actually computed.
    assert.equal(upsertCalls[0].otpHash, hashOtp(result.devOtp!));
    assert.equal(upsertCalls[0].email, "newbie@example.com");
    // Password is hashed before being handed to the repository, never stored raw.
    assert.notEqual(upsertCalls[0].passwordHash, "correct horse battery staple");
  } finally {
    restoreFind();
    restorePrev();
    restoreUpsert();
  }
});

test("register() with an already-registered email is rejected 409, not 400", async () => {
  const restoreFind = patch(authRepository, "findUserByEmail", async () => ({ id: "u1", email: "taken@example.com" }));

  try {
    await assert.rejects(
      () => authService.register({ email: "taken@example.com", password: "x".repeat(12) }),
      (err: any) => err.status === 409,
    );
  } finally {
    restoreFind();
  }
});

test("register() resending inside the resend cooldown is throttled 429", async () => {
  const restoreFind = patch(authRepository, "findUserByEmail", async () => null);
  const restorePrev = patch(authRepository, "findEmailVerificationByEmail", async () => ({
    email: "cooldown@example.com",
    sentAt: new Date(), // just sent — well inside OTP_RESEND_SECONDS (default 60s)
  }));

  try {
    await assert.rejects(
      () => authService.register({ email: "cooldown@example.com", password: "x".repeat(12) }),
      (err: any) => err.status === 429,
    );
  } finally {
    restoreFind();
    restorePrev();
  }
});

test("verifyRegistration() with the correct OTP creates the user and deletes the verification row", async () => {
  const otp = "654321";
  const record = {
    email: "verify-ok@example.com",
    passwordHash: "hashed",
    firstName: "Ver",
    lastName: "Ok",
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
  };
  const deleteCalls: string[] = [];
  const createCalls: any[] = [];
  const restoreFind = patch(authRepository, "findEmailVerificationByEmail", async () => record);
  const restoreUser = patch(authRepository, "findUserByEmail", async () => null);
  const restoreCreate = patch(authRepository, "createUser", async (data: any) => {
    createCalls.push(data);
    return { id: "new-user-1", ...data };
  });
  const restoreDelete = patch(authRepository, "deleteEmailVerification", async (email: string) => {
    deleteCalls.push(email);
  });
  const restoreRefresh = patch(authRepository, "createRefreshToken", async () => ({}));

  try {
    const result = await authService.verifyRegistration({ email: "verify-ok@example.com", otp });
    assert.equal(result.user.email, "verify-ok@example.com");
    assert.equal(typeof result.accessToken, "string");
    assert.equal(typeof result.refreshToken, "string");
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].role, "CUSTOMER", "self-registration always lands as CUSTOMER, never a privileged role");
    assert.deepEqual(deleteCalls, ["verify-ok@example.com"]);
  } finally {
    restoreFind();
    restoreUser();
    restoreCreate();
    restoreDelete();
    restoreRefresh();
  }
});

test("verifyRegistration() with the WRONG OTP is rejected and increments the attempt counter", async () => {
  const record = {
    email: "wrong-otp@example.com",
    otpHash: hashOtp("111111"),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 1,
  };
  const incrementCalls: string[] = [];
  const restoreFind = patch(authRepository, "findEmailVerificationByEmail", async () => record);
  const restoreIncrement = patch(authRepository, "incrementEmailVerificationAttempts", async (email: string) => {
    incrementCalls.push(email);
  });

  try {
    await assert.rejects(
      () => authService.verifyRegistration({ email: "wrong-otp@example.com", otp: "999999" }),
      (err: any) => err.status === 400,
    );
    assert.deepEqual(incrementCalls, ["wrong-otp@example.com"], "a wrong guess must count against the attempt limit");
  } finally {
    restoreFind();
    restoreIncrement();
  }
});

test("verifyRegistration() past expiresAt is rejected even with the correct OTP", async () => {
  const otp = "222222";
  const record = {
    email: "expired@example.com",
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() - 1000), // already expired
    attempts: 0,
  };
  const restoreFind = patch(authRepository, "findEmailVerificationByEmail", async () => record);

  try {
    await assert.rejects(
      () => authService.verifyRegistration({ email: "expired@example.com", otp }),
      (err: any) => err.status === 400 && /expired/i.test(err.message),
    );
  } finally {
    restoreFind();
  }
});

test("verifyRegistration() blocks further attempts once the attempt limit is exceeded, even with the correct OTP", async () => {
  const otp = "333333";
  const record = {
    email: "maxed-out@example.com",
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 5, // OTP_MAX_ATTEMPTS default is 5 — already at the ceiling
  };
  const incrementCalls: string[] = [];
  const restoreFind = patch(authRepository, "findEmailVerificationByEmail", async () => record);
  const restoreIncrement = patch(authRepository, "incrementEmailVerificationAttempts", async (email: string) => {
    incrementCalls.push(email);
  });

  try {
    await assert.rejects(
      () => authService.verifyRegistration({ email: "maxed-out@example.com", otp }),
      (err: any) => err.status === 429,
    );
    // The attempt-limit check must short-circuit before ever touching the OTP hash — a
    // correct guess submitted after the limit is exceeded must not itself count as another
    // "wrong attempt" against the counter.
    assert.equal(incrementCalls.length, 0);
  } finally {
    restoreFind();
    restoreIncrement();
  }
});
