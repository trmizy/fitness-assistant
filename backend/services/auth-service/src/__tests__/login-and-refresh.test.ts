import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";

/**
 * Money-flow plan 5.4 — minimum auth-service test coverage: wrong-password login rejection and
 * refresh-token rotation. No real DB — authRepository is monkey-patched per test.
 *
 * REFRESH_TOKEN_SECRET: importing authRepository above instantiates PrismaClient, which
 * auto-loads this service's .env as a side effect (Prisma's own behavior, independent of
 * server.ts's dotenv.config() — app.ts itself never calls it). By the time this line runs,
 * process.env.JWT_REFRESH_SECRET already holds whatever auth.service.ts's own module-level
 * constant resolved to, so signing test tokens against it (rather than guessing the fallback
 * default) matches the real running secret regardless of what .env actually contains.
 */
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "refresh-secret-key-change-in-production";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("login() with the wrong password is rejected 401 and never issues a token", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 10);
  const createTokenCalls: unknown[] = [];
  const restoreUser = patch(authRepository, "findUserByEmail", async () => ({
    id: "u1",
    email: "user@example.com",
    password: passwordHash,
    firstName: "U",
    lastName: "Ser",
    role: "CUSTOMER",
    isActive: true,
  }));
  const restoreToken = patch(authRepository, "createRefreshToken", async (data: unknown) => {
    createTokenCalls.push(data);
    return {};
  });

  try {
    await assert.rejects(
      () => authService.login("user@example.com", "totally-wrong-password"),
      (err: any) => err.status === 401,
    );
    assert.equal(createTokenCalls.length, 0, "a rejected login must never issue a refresh token");
  } finally {
    restoreUser();
    restoreToken();
  }
});

test("login() for an email that does not exist is rejected 401 (same status as wrong password — no user-enumeration signal)", async () => {
  const restoreUser = patch(authRepository, "findUserByEmail", async () => null);
  try {
    await assert.rejects(
      () => authService.login("nobody@example.com", "whatever"),
      (err: any) => err.status === 401,
    );
  } finally {
    restoreUser();
  }
});

test("login() with the correct password succeeds and issues both tokens", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 10);
  const restoreUser = patch(authRepository, "findUserByEmail", async () => ({
    id: "u1",
    email: "user@example.com",
    password: passwordHash,
    firstName: "U",
    lastName: "Ser",
    role: "CUSTOMER",
    isActive: true,
  }));
  const restoreToken = patch(authRepository, "createRefreshToken", async () => ({}));

  try {
    const result = await authService.login("user@example.com", "correct-password");
    assert.equal(result.user.id, "u1");
    assert.equal(typeof result.accessToken, "string");
    assert.equal(typeof result.refreshToken, "string");
  } finally {
    restoreUser();
    restoreToken();
  }
});

test("login() for a disabled (isActive:false) account is rejected 403 even with the correct password", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 10);
  const restoreUser = patch(authRepository, "findUserByEmail", async () => ({
    id: "u1",
    email: "banned@example.com",
    password: passwordHash,
    role: "CUSTOMER",
    isActive: false,
  }));
  try {
    await assert.rejects(
      () => authService.login("banned@example.com", "correct-password"),
      (err: any) => err.status === 403,
    );
  } finally {
    restoreUser();
  }
});

test("refresh() rotates the token: the old one is deleted and a new one is stored, both exactly once", async () => {
  const deleteCalls: string[] = [];
  const createCalls: any[] = [];
  const restoreFind = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-1",
    token: "old-refresh-token",
    userId: "u1",
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const restoreDelete = patch(authRepository, "deleteRefreshToken", async (id: string) => {
    deleteCalls.push(id);
  });
  const restoreCreate = patch(authRepository, "createRefreshToken", async (data: any) => {
    createCalls.push(data);
    return {};
  });

  // A real, well-formed JWT signed with the service's actual runtime secret — refresh()
  // calls jwt.verify() on it before ever touching the repository, so a malformed token would
  // never even reach the mocked calls below.
  const jwt = await import("jsonwebtoken");
  const validRefreshToken = jwt.default.sign({ userId: "u1", jti: "test-jti" }, REFRESH_TOKEN_SECRET, { expiresIn: "7d" });

  try {
    const result = await authService.refresh(validRefreshToken);
    assert.equal(result.userId, "u1");
    assert.equal(typeof result.accessToken, "string");
    assert.equal(typeof result.refreshToken, "string");
    assert.notEqual(result.refreshToken, "old-refresh-token", "rotation must issue a genuinely new token, not reuse the old one");
    assert.deepEqual(deleteCalls, ["rt-1"], "the old token row must be deleted exactly once");
    assert.equal(createCalls.length, 1, "exactly one new token row must be created");
    assert.equal(createCalls[0].userId, "u1");
  } finally {
    restoreFind();
    restoreDelete();
    restoreCreate();
  }
});

test("refresh() with a token not found in the DB (already used / revoked) is rejected 401", async () => {
  const restoreFind = patch(authRepository, "findRefreshToken", async () => null);
  const jwt = await import("jsonwebtoken");
  const wellFormedButUnknown = jwt.default.sign({ userId: "u1" }, REFRESH_TOKEN_SECRET, { expiresIn: "7d" });

  try {
    await assert.rejects(
      () => authService.refresh(wellFormedButUnknown),
      (err: any) => err.status === 401,
    );
  } finally {
    restoreFind();
  }
});

test("refresh() with an expired stored token is rejected 401 and the stale row is deleted", async () => {
  const deleteCalls: string[] = [];
  const restoreFind = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-expired",
    token: "expired-token",
    userId: "u1",
    expiresAt: new Date(Date.now() - 1000), // already past
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const restoreDelete = patch(authRepository, "deleteRefreshToken", async (id: string) => {
    deleteCalls.push(id);
  });
  const jwt = await import("jsonwebtoken");
  const signedButExpiredRow = jwt.default.sign({ userId: "u1" }, REFRESH_TOKEN_SECRET, { expiresIn: "7d" });

  try {
    await assert.rejects(
      () => authService.refresh(signedButExpiredRow),
      (err: any) => err.status === 401,
    );
    assert.deepEqual(deleteCalls, ["rt-expired"]);
  } finally {
    restoreFind();
    restoreDelete();
  }
});

test("refresh() with a garbage/malformed token is rejected 401 before ever touching the repository", async () => {
  const findCalls: unknown[] = [];
  const restoreFind = patch(authRepository, "findRefreshToken", async (token: unknown) => {
    findCalls.push(token);
    return null;
  });

  try {
    await assert.rejects(
      () => authService.refresh("not-a-real-jwt-at-all"),
      (err: any) => err.status === 401,
    );
    assert.equal(findCalls.length, 0, "jwt.verify must fail and short-circuit before any repository lookup");
  } finally {
    restoreFind();
  }
});
