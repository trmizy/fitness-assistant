import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import jwt from "jsonwebtoken";

/**
 * REAL integration test — no repository mocks — against a throwaway local
 * Postgres database on the same `gymcoach-postgres` container local dev
 * already uses (localhost:5433). Never touches `gym_coach_auth` (the real
 * local dev database) or Aurora. Exists specifically because
 * credential-rotation-hardening.test.ts's mocked-repository assertions
 * cannot prove that `prisma.$transaction` genuinely rolls back in real
 * Postgres — see docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md,
 * Phase B ("Bắt buộc kiểm tra transaction rollback bằng test thực sự, không
 * chỉ mock assertion hình thức").
 *
 * Skips every test (with the reason printed) if the local Postgres isn't
 * reachable or the throwaway database can't be created/migrated — this must
 * never be the thing that makes `npm test` fail on a machine without Docker.
 */

const AUTH_SERVICE_ROOT = path.resolve(__dirname, "../..");
const TEST_DB = "gym_coach_auth_test_rotation";
const TEST_DB_URL = `postgresql://gymcoach:gymcoach_password@localhost:5433/${TEST_DB}?schema=public`;
assert.ok(TEST_DB_URL.includes("test_rotation"), "safety check: must be the throwaway db, not a real one");

let setupError = "";
try {
  execSync(`docker exec gymcoach-postgres psql -U gymcoach -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};"`, { stdio: "pipe" });
  execSync(`docker exec gymcoach-postgres psql -U gymcoach -d postgres -c "CREATE DATABASE ${TEST_DB};"`, { stdio: "pipe" });
  execSync(`npx prisma migrate deploy`, {
    cwd: AUTH_SERVICE_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
} catch (e: any) {
  setupError = `local Postgres / throwaway test-db setup failed (${e.message?.slice(0, 300)}) — skipping real-transaction tests`;
}

test("real-transaction setup", { skip: setupError ? setupError : false }, () => {
  assert.equal(setupError, "");
});

if (!setupError) {
  // Import AFTER the throwaway DB exists and DATABASE_URL is set — Prisma's
  // generated client reads it when `new PrismaClient()` runs at module load.
  process.env.DATABASE_URL = TEST_DB_URL;

  test("changePassword() really commits both writes in real Postgres (happy path, no mocks)", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;

    const oldHash = await bcrypt.hash("real-old-password", 10);
    const user = await prisma.user.create({
      data: { email: "tx-happy@example.test", password: oldHash, role: "CUSTOMER" as any },
    });
    await prisma.refreshToken.create({
      data: { token: "tok-a", userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.refreshToken.create({
      data: { token: "tok-b", userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET || "dev_jwt_secret_change_in_production",
    );

    try {
      const result = await authService.changePassword(accessToken, {
        currentPassword: "real-old-password",
        newPassword: "real-new-password",
      } as any);
      assert.equal(result.user.id, user.id);

      const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(await bcrypt.compare("real-new-password", reread.password), true, "new password must really be persisted");
      assert.equal(await bcrypt.compare("real-old-password", reread.password), false, "old password must really be gone");

      const remainingTokens = await prisma.refreshToken.count({ where: { userId: user.id } });
      assert.equal(remainingTokens, 0, "both refresh tokens must really be deleted");
    } finally {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  test("changePassword() really rolls back the password update when the refresh-token delete fails mid-transaction", async () => {
    const { authRepository, prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;

    const oldHash = await bcrypt.hash("real-old-password-2", 10);
    const user = await prisma.user.create({
      data: { email: "tx-rollback@example.test", password: oldHash, role: "CUSTOMER" as any },
    });

    const originalDelete = authRepository.deleteRefreshTokensByUserId;
    (authRepository as any).deleteRefreshTokensByUserId = async () => {
      throw new Error("simulated failure mid-transaction");
    };

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET || "dev_jwt_secret_change_in_production",
    );

    try {
      await assert.rejects(() =>
        authService.changePassword(accessToken, {
          currentPassword: "real-old-password-2",
          newPassword: "real-new-password-2",
        } as any),
      );

      // The real proof: read the row back from real Postgres with the patch
      // removed and a completely fresh query — if the transaction rolled
      // back for real, the password is still the OLD hash.
      const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(
        await bcrypt.compare("real-old-password-2", reread.password),
        true,
        "password update must have been rolled back — it must still be the OLD password",
      );
      assert.equal(await bcrypt.compare("real-new-password-2", reread.password), false);
    } finally {
      (authRepository as any).deleteRefreshTokensByUserId = originalDelete;
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  test.after(() => {
    try {
      execSync(`docker exec gymcoach-postgres psql -U gymcoach -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};"`, { stdio: "pipe" });
    } catch {
      // best-effort cleanup only
    }
  });
}
