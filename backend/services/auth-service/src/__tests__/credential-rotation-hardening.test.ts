import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { authService } from "../services/auth.service";
import { authRepository, prisma } from "../repositories/auth.repository";
import { assertSeedAllowed } from "../scripts/seedGuard";

/**
 * Written for docs/deployment/AWS_DEV_AUTH_SECURITY_HARDENING_2026-09-29.md —
 * the admin@example.com/password123 seed account was reachable on public AWS
 * DEV infrastructure. These tests pin down the two things a safe rotation
 * depends on: (1) the seed can no longer run against a real deployment's
 * database, and (2) the existing self-service change-password path — reused
 * as-is to perform the rotation, no new endpoint — actually does what
 * rotation needs (keeps id/role, revokes every refresh token, never leaks
 * whether an account exists). No real database or network call is made;
 * every authRepository method is monkey-patched per test, same approach as
 * self-service-recovery.test.ts.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

// ── seedGuard ─────────────────────────────────────────────────────────────

test("assertSeedAllowed() allows a local database (localhost)", () => {
  assert.doesNotThrow(() => assertSeedAllowed("postgresql://postgres:x@localhost:5433/gym_coach_auth", undefined));
});

test("assertSeedAllowed() allows loopback/docker-local spellings of the same machine", () => {
  assert.doesNotThrow(() => assertSeedAllowed("postgresql://postgres:x@127.0.0.1:5433/gym_coach_auth", undefined));
  assert.doesNotThrow(() => assertSeedAllowed("postgresql://postgres:x@[::1]:5433/gym_coach_auth", undefined));
  assert.doesNotThrow(() => assertSeedAllowed("postgresql://postgres:x@host.docker.internal:5433/gym_coach_auth", undefined));
});

test("assertSeedAllowed() allows the explicit CI test database host (docker-compose.test.yml's postgres-test)", () => {
  assert.doesNotThrow(() =>
    assertSeedAllowed("postgresql://gymcoach_test:x@postgres-test:5432/gymcoach_auth_test", undefined),
  );
});

test("assertSeedAllowed() refuses a real RDS/Aurora hostname outright", () => {
  assert.throws(
    () =>
      assertSeedAllowed(
        "postgresql://postgres:x@fitness-assistant-dev-aurora.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/fitness_assistant",
        undefined,
      ),
    /Refusing to run the auth-service demo seed/,
  );
});

test("assertSeedAllowed() refuses any other shared/unknown hostname (fail closed on the unfamiliar)", () => {
  assert.throws(() => assertSeedAllowed("postgresql://postgres:x@some-shared-staging-box:5432/whatever", undefined));
  assert.throws(() => assertSeedAllowed("postgresql://postgres:x@db:5432/whatever", undefined), /not one of this repo's known/);
});

test("assertSeedAllowed() a database NAME containing \"_test\" never makes a remote host safe by itself", () => {
  // The exact bug class this guard exists to close: only the hostname is
  // ever consulted, never the database name.
  assert.throws(() =>
    assertSeedAllowed(
      "postgresql://postgres:x@fitness-assistant-dev-aurora.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/some_test_db",
      undefined,
    ),
  );
});

test("assertSeedAllowed() treats a missing DATABASE_URL as unsafe (fail closed)", () => {
  assert.throws(() => assertSeedAllowed(undefined, undefined), /DATABASE_URL is not set/);
});

test("assertSeedAllowed() treats a malformed DATABASE_URL as unsafe (fail closed, not fail open)", () => {
  assert.throws(() => assertSeedAllowed("not a url at all", undefined), /could not be parsed/);
  assert.throws(() => assertSeedAllowed("", undefined));
});

test("assertSeedAllowed() honors an explicit ALLOW_DEMO_SEED=true override even for a non-local URL", () => {
  assert.doesNotThrow(() =>
    assertSeedAllowed("postgresql://postgres:x@some-remote-host:5432/whatever", "true"),
  );
});

test("assertSeedAllowed() rejects any override value other than the exact string \"true\" (no loose-truthy bypass)", () => {
  for (const notQuiteTrue of ["1", "yes", "TRUE", "True", " true", "true "]) {
    assert.throws(
      () => assertSeedAllowed("postgresql://postgres:x@some-remote-host:5432/whatever", notQuiteTrue),
      `ALLOW_DEMO_SEED=${JSON.stringify(notQuiteTrue)} must not bypass the guard`,
    );
  }
});

// ── seed.ts still upserts with update: {} (regression guard) ───────────────
//
// seed.ts instantiates a real PrismaClient at module scope and isn't
// dependency-injectable, so this is a characterization check on the source
// itself rather than a behavioral test: it fails loudly if anyone ever
// changes the admin upsert's `update: {}` to something that would reset an
// existing admin's password/role on a re-run.

test("seed.ts admin upsert still uses update: {} (never resets an existing admin)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../prisma/seed.ts"), "utf8");
  const adminBlockStart = src.indexOf('where: { email: "admin@example.com" }');
  assert.ok(adminBlockStart > -1, "admin@example.com upsert not found in seed.ts");
  const nearby = src.slice(adminBlockStart, adminBlockStart + 120);
  assert.match(nearby, /update:\s*\{\}/, "admin upsert must keep update: {} — it must never overwrite an existing row");
});

test("seed.ts calls assertSeedAllowed() before creating any user", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../prisma/seed.ts"), "utf8");
  const guardCall = src.indexOf("assertSeedAllowed(");
  const firstUpsert = src.indexOf("prisma.user.upsert(");
  assert.ok(guardCall > -1, "seed.ts no longer calls assertSeedAllowed()");
  assert.ok(guardCall < firstUpsert, "assertSeedAllowed() must run before the first upsert");
});

// ── changePassword: what the actual rotation will call ──────────────────────

function patchChangePassword(user: any, opts: { failUpdate?: boolean; failRevoke?: boolean } = {}) {
  const updateCalls: any[] = [];
  let revokedForUserId: string | undefined;
  const restores = [
    patch(authService, "verifyToken", async () => user),
    patch(authRepository, "findUserWithPasswordById", async () => user),
    patch(authRepository, "updateUserPasswordById", async (id: string, passwordHash: string) => {
      if (opts.failUpdate) throw new Error("simulated update failure");
      updateCalls.push({ id, passwordHash });
      return { ...user, password: passwordHash };
    }),
    patch(authRepository, "deleteRefreshTokensByUserId", async (userId: string) => {
      if (opts.failRevoke) throw new Error("simulated revoke failure");
      revokedForUserId = userId;
      return { count: 1 };
    }),
    // changePassword wraps both writes in prisma.$transaction() (see
    // docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md). The real
    // $transaction would open a real DB connection, so here it's reduced to "run
    // the callback" — genuine commit/rollback behavior is proven separately, with
    // a real Postgres database and zero mocks, in
    // credential-rotation-transaction.integration.test.ts. What these mocked
    // tests prove is call ORDER and ERROR PROPAGATION, not real atomicity.
    patch(prisma, "$transaction", async (cb: any) => cb(prisma)),
  ];
  return {
    updateCalls,
    revokedForUserId: () => revokedForUserId,
    restore: () => restores.forEach((r) => r()),
  };
}

test("changePassword() rotates the hash but returns the SAME id/email/role — rotation cannot change identity", async () => {
  const user = { id: "admin-real-id", email: "admin@example.com", role: "ADMIN", firstName: "Admin", lastName: "User", password: "old-hash" };
  const spies = patchChangePassword(user);
  const origCompare = require("bcryptjs").compare;
  require("bcryptjs").compare = async (plain: string) => plain === "password123";
  try {
    const result = await authService.changePassword("irrelevant-token", {
      currentPassword: "password123",
      newPassword: "a-brand-new-strong-password",
    } as any);

    assert.equal(result.user.id, "admin-real-id");
    assert.equal(result.user.email, "admin@example.com");
    assert.equal(result.user.role, "ADMIN");
    assert.equal(spies.updateCalls.length, 1);
    assert.equal(spies.updateCalls[0].id, "admin-real-id");
    assert.notEqual(spies.updateCalls[0].passwordHash, "old-hash");
  } finally {
    require("bcryptjs").compare = origCompare;
    spies.restore();
  }
});

test("changePassword() revokes every refresh token for that exact user id (closes the exposure window)", async () => {
  const user = { id: "admin-real-id", email: "admin@example.com", role: "ADMIN", password: "old-hash" };
  const spies = patchChangePassword(user);
  const origCompare = require("bcryptjs").compare;
  require("bcryptjs").compare = async (plain: string) => plain === "password123";
  try {
    await authService.changePassword("irrelevant-token", {
      currentPassword: "password123",
      newPassword: "a-brand-new-strong-password",
    } as any);
    assert.equal(spies.revokedForUserId(), "admin-real-id");
  } finally {
    require("bcryptjs").compare = origCompare;
    spies.restore();
  }
});

test("changePassword() rejects a wrong current password and touches neither the password nor any refresh token", async () => {
  const user = { id: "admin-real-id", email: "admin@example.com", role: "ADMIN", password: "old-hash" };
  const spies = patchChangePassword(user);
  const origCompare = require("bcryptjs").compare;
  require("bcryptjs").compare = async () => false;
  try {
    await assert.rejects(
      () =>
        authService.changePassword("irrelevant-token", {
          currentPassword: "wrong",
          newPassword: "a-brand-new-strong-password",
        } as any),
      (err: any) => err.status === 401 && err.message === "Current password is incorrect",
    );
    assert.equal(spies.updateCalls.length, 0);
    assert.equal(spies.revokedForUserId(), undefined);
  } finally {
    require("bcryptjs").compare = origCompare;
    spies.restore();
  }
});

test("changePassword() rejects a new password identical to the current one, with no mutation", async () => {
  const user = { id: "admin-real-id", email: "admin@example.com", role: "ADMIN", password: "old-hash" };
  const spies = patchChangePassword(user);
  const origCompare = require("bcryptjs").compare;
  // Both the "is this the current password" check and the "is new==old" check
  // call bcrypt.compare — real bcrypt correctly says yes to both when the two
  // plaintexts are identical, so a single always-true stub reproduces that.
  require("bcryptjs").compare = async () => true;
  try {
    await assert.rejects(
      () =>
        authService.changePassword("irrelevant-token", {
          currentPassword: "password123",
          newPassword: "password123",
        } as any),
      (err: any) => err.status === 400 && err.message === "New password must be different",
    );
    assert.equal(spies.updateCalls.length, 0, "no write when the new password is rejected");
    assert.equal(spies.revokedForUserId(), undefined, "no session revoked when nothing actually changed");
  } finally {
    require("bcryptjs").compare = origCompare;
    spies.restore();
  }
});

test("changePassword(): if the password write itself fails, refresh tokens are never touched (no partial rotation)", async () => {
  const user = { id: "admin-real-id", email: "admin@example.com", role: "ADMIN", password: "old-hash" };
  const spies = patchChangePassword(user, { failUpdate: true });
  const origCompare = require("bcryptjs").compare;
  require("bcryptjs").compare = async (plain: string) => plain === "password123";
  try {
    await assert.rejects(() =>
      authService.changePassword("irrelevant-token", {
        currentPassword: "password123",
        newPassword: "a-brand-new-strong-password",
      } as any),
    );
    assert.equal(spies.revokedForUserId(), undefined, "revoke must never run if the password write itself failed");
  } finally {
    require("bcryptjs").compare = origCompare;
    spies.restore();
  }
});

// ── refresh: a revoked/deleted token must not work ──────────────────────────

test("refresh() with a token no longer in the database (revoked) is rejected — the post-rotation refresh token is dead", async () => {
  const restore = patch(authRepository, "findRefreshToken", async () => null);
  try {
    await assert.rejects(
      () => authService.refresh("some-jwt-shaped-but-deleted-token"),
      (err: any) => err.status === 401,
    );
  } finally {
    restore();
  }
});

// ── login: no account-existence leak (audit's exact concern) ───────────────

test("login() answers identically for a non-existent email and a wrong password on a real account", async () => {
  const restoreMissing = patch(authRepository, "findUserByEmail", async () => null);
  let unknownErr: any;
  try {
    await authService.login("ghost@example.com", "whatever");
  } catch (e) {
    unknownErr = e;
  } finally {
    restoreMissing();
  }

  const restoreReal = patch(authRepository, "findUserByEmail", async () => ({
    id: "u1",
    email: "real@example.com",
    password: "some-hash",
    role: "CUSTOMER",
  }));
  const origCompare = require("bcryptjs").compare;
  require("bcryptjs").compare = async () => false;
  let wrongPassErr: any;
  try {
    await authService.login("real@example.com", "wrong");
  } catch (e) {
    wrongPassErr = e;
  } finally {
    require("bcryptjs").compare = origCompare;
    restoreReal();
  }

  assert.deepEqual(unknownErr, wrongPassErr, "both cases must return the exact same status/message");
  assert.equal(unknownErr.status, 401);
  assert.equal(unknownErr.message, "Invalid credentials");
});

// ── no seed credential in deployment configuration ──────────────────────────

// Skips .terraform/ (downloaded provider binaries — GBs, not config) and
// anything over 2MB (no hand-written config file is that large; avoids ever
// reading a binary as a string again).
function walkTextFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".terraform" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(full, out);
    } else if (fs.statSync(full).size <= 2 * 1024 * 1024) {
      out.push(full);
    }
  }
  return out;
}

test("deployment configuration (infra/terraform, .github/workflows) never contains the seed's plaintext password", () => {
  const repoRoot = path.resolve(__dirname, "../../../../../");
  const scanDirs = [path.join(repoRoot, "infra", "terraform"), path.join(repoRoot, ".github", "workflows")];
  const offenders: string[] = [];
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walkTextFiles(dir)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("password123")) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `deployment config must never hardcode the seed password: ${offenders.join(", ")}`);
});
