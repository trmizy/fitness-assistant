import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";
import {
  resolveSessionPlatform,
  SESSION_REPLACED_CODE,
  SESSION_REPLACED_MESSAGE,
} from "../services/session-platform";

/**
 * Concurrent-login rule: one account = at most one web + one mobile session. A new login supersedes the
 * previous session of the SAME platform only. TEST FIXTURE level — the repository is monkey-patched; the
 * real-Postgres semantics are covered by concurrent-sessions.integration.test.ts.
 */
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "refresh-secret-key-change-in-production";
const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("resolveSessionPlatform: mobile/* is mobile; absent, web/*, empty and unknown values all count as web", () => {
  assert.equal(resolveSessionPlatform("mobile/1.2.3/45"), "mobile");
  assert.equal(resolveSessionPlatform("  Mobile/1.0 "), "mobile");
  assert.equal(resolveSessionPlatform(["mobile/1.0.0/1"]), "mobile");
  assert.equal(resolveSessionPlatform(undefined), "web");
  assert.equal(resolveSessionPlatform(null), "web");
  assert.equal(resolveSessionPlatform(""), "web");
  assert.equal(resolveSessionPlatform("web/0.0.1"), "web");
  assert.equal(resolveSessionPlatform("mobileish/1"), "web");
  assert.equal(resolveSessionPlatform("curl/8"), "web");
});

async function loginAs(platform: "web" | "mobile" | undefined) {
  const passwordHash = await bcrypt.hash("correct-password", 10);
  const revoked: Array<[string, string]> = [];
  const created: any[] = [];
  const restores = [
    patch(authRepository, "findUserByEmail", async () => ({
      id: "u1", email: "user@example.com", password: passwordHash, firstName: "U", lastName: "S", role: "CUSTOMER", isActive: true,
    })),
    patch(authRepository, "revokeSessionsOnPlatform", async (userId: string, p: string) => {
      revoked.push([userId, p]);
      return 1;
    }),
    patch(authRepository, "createRefreshToken", async (data: any) => {
      created.push(data);
      return {};
    }),
  ];
  try {
    const result = platform
      ? await authService.login("user@example.com", "correct-password", platform)
      : await authService.login("user@example.com", "correct-password");
    return { result, revoked, created };
  } finally {
    restores.forEach((r) => r());
  }
}

test("login() on mobile supersedes ONLY the mobile session and tags the new one mobile with a session id carried in the access token", async () => {
  const { result, revoked, created } = await loginAs("mobile");
  assert.deepEqual(revoked, [["u1", "mobile"]], "only the mobile slot is revoked — never the web one");
  assert.equal(created.length, 1);
  assert.equal(created[0].platform, "mobile");
  assert.equal(typeof created[0].sessionId, "string");
  const decoded: any = jwt.verify(result.accessToken, ACCESS_TOKEN_SECRET);
  assert.equal(decoded.sid, created[0].sessionId);
});

test("login() with no platform counts as web and supersedes only the web session", async () => {
  const { revoked, created } = await loginAs(undefined);
  assert.deepEqual(revoked, [["u1", "web"]]);
  assert.equal(created[0].platform, "web");
});

test("two logins get two different session ids", async () => {
  const a = await loginAs("web");
  const b = await loginAs("web");
  assert.notEqual(a.created[0].sessionId, b.created[0].sessionId);
});

test("a rejected login (wrong password) revokes nothing", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 10);
  const calls: unknown[] = [];
  const r1 = patch(authRepository, "findUserByEmail", async () => ({
    id: "u1", email: "user@example.com", password: passwordHash, role: "CUSTOMER", isActive: true,
  }));
  const r2 = patch(authRepository, "revokeSessionsOnPlatform", async (...a: unknown[]) => {
    calls.push(a);
    return 0;
  });
  try {
    await assert.rejects(() => authService.login("user@example.com", "nope", "mobile"), (e: any) => e.status === 401);
    assert.equal(calls.length, 0, "an attacker guessing passwords must not be able to sign the real owner out");
  } finally {
    r1();
    r2();
  }
});

function refreshJwt() {
  return jwt.sign({ userId: "u1", jti: "j1" }, REFRESH_TOKEN_SECRET, { expiresIn: "7d" });
}

test("refresh() of a superseded session is refused 401 SESSION_REPLACED with the Vietnamese message and issues nothing", async () => {
  const creates: unknown[] = [];
  const r1 = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date(), platform: "web", sessionId: "s1",
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const r2 = patch(authRepository, "createRefreshToken", async (d: unknown) => {
    creates.push(d);
    return {};
  });
  try {
    await assert.rejects(
      () => authService.refresh(refreshJwt()),
      (e: any) => e.status === 401 && e.code === SESSION_REPLACED_CODE && e.message === SESSION_REPLACED_MESSAGE,
    );
    assert.equal(creates.length, 0);
    assert.match(SESSION_REPLACED_MESSAGE, /Tài khoản đã đăng nhập trên thiết bị khác/);
  } finally {
    r1();
    r2();
  }
});

test("refresh() rotation keeps the session id and platform (and the new access token still carries sid)", async () => {
  const creates: any[] = [];
  const r1 = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, platform: "mobile", sessionId: "s-keep",
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const r2 = patch(authRepository, "createRefreshToken", async (d: any) => {
    creates.push(d);
    return {};
  });
  const r3 = patch(authRepository, "deleteRefreshToken", async () => ({ count: 1 }));
  try {
    const out = await authService.refresh(refreshJwt());
    assert.equal(creates[0].sessionId, "s-keep");
    assert.equal(creates[0].platform, "mobile");
    assert.equal((jwt.verify(out.accessToken, ACCESS_TOKEN_SECRET) as any).sid, "s-keep");
  } finally {
    r1();
    r2();
    r3();
  }
});

test("refresh() that loses the race to a superseding login withdraws its fresh token and answers SESSION_REPLACED", async () => {
  const withdrawn: string[] = [];
  const created: any[] = [];
  const r1 = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, platform: "web", sessionId: "s1",
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const r2 = patch(authRepository, "createRefreshToken", async (d: any) => {
    created.push(d);
    return {};
  });
  const r3 = patch(authRepository, "deleteRefreshToken", async () => ({ count: 0 })); // old row got revoked meanwhile
  const r4 = patch(authRepository, "deleteRefreshTokenByValue", async (t: string) => {
    withdrawn.push(t);
    return { count: 1 };
  });
  try {
    await assert.rejects(() => authService.refresh(refreshJwt()), (e: any) => e.code === SESSION_REPLACED_CODE);
    assert.deepEqual(withdrawn, [created[0].token]);
  } finally {
    r1();
    r2();
    r3();
    r4();
  }
});

test("refresh() of a pre-migration row (no platform/sessionId) works: it becomes a web session with a fresh id", async () => {
  const creates: any[] = [];
  const r1 = patch(authRepository, "findRefreshToken", async () => ({
    id: "rt-old", userId: "u1", expiresAt: new Date(Date.now() + 60_000),
    user: { id: "u1", email: "user@example.com", role: "CUSTOMER" },
  }));
  const r2 = patch(authRepository, "createRefreshToken", async (d: any) => {
    creates.push(d);
    return {};
  });
  const r3 = patch(authRepository, "deleteRefreshToken", async () => ({ count: 1 }));
  try {
    await authService.refresh(refreshJwt());
    assert.equal(creates[0].platform, "web");
    assert.equal(typeof creates[0].sessionId, "string");
  } finally {
    r1();
    r2();
    r3();
  }
});

function accessWithSid(sid?: string) {
  return jwt.sign({ userId: "u1", role: "CUSTOMER", email: "user@example.com", ...(sid ? { sid } : {}) }, ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
}
const activeUser = { id: "u1", email: "user@example.com", role: "CUSTOMER", isActive: true };

test("verifyToken() refuses an access token whose session was superseded — at once, not at its next refresh", async () => {
  const r1 = patch(authRepository, "findUserById", async () => activeUser);
  const r2 = patch(authRepository, "isSessionRevoked", async (sid: string) => sid === "dead");
  try {
    await assert.rejects(
      () => authService.verifyToken(accessWithSid("dead")),
      (e: any) => e.status === 401 && e.code === SESSION_REPLACED_CODE,
    );
    const user = await authService.verifyToken(accessWithSid("alive"));
    assert.equal((user as any).id, "u1");
  } finally {
    r1();
    r2();
  }
});

test("verifyToken() of a legacy access token without sid never consults the session table", async () => {
  let consulted = 0;
  const r1 = patch(authRepository, "findUserById", async () => activeUser);
  const r2 = patch(authRepository, "isSessionRevoked", async () => {
    consulted++;
    return true;
  });
  try {
    await authService.verifyToken(accessWithSid());
    assert.equal(consulted, 0);
  } finally {
    r1();
    r2();
  }
});
