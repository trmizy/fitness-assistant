import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import jwt from "jsonwebtoken";

/**
 * REAL integration test (no repository mocks) of the one-web + one-mobile concurrent-login rule, against a
 * throwaway database on the local `gymcoach-postgres` container (localhost:5433). Never touches the dev
 * database. Skips (with the reason) when that Postgres is not reachable — same convention as
 * credential-rotation-transaction.integration.test.ts.
 */
const AUTH_SERVICE_ROOT = path.resolve(__dirname, "../..");
const TEST_DB = "gym_coach_auth_test_sessions";
// Defaults = the local dev-stack Postgres container. Override (AUTH_TEST_PG_*) to run against a throwaway container instead.
const PG_CONTAINER = process.env.AUTH_TEST_PG_CONTAINER ?? "gymcoach-postgres";
const PG_USER = process.env.AUTH_TEST_PG_USER ?? "gymcoach";
const PG_PASSWORD = process.env.AUTH_TEST_PG_PASSWORD ?? "gymcoach_password";
const PG_PORT = process.env.AUTH_TEST_PG_PORT ?? "5433";
const TEST_DB_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${TEST_DB}?schema=public`;
assert.ok(TEST_DB_URL.includes("_test_sessions"), "safety check: must be the throwaway db");

let setupError = "";
try {
  execSync(`docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};"`, { stdio: "pipe" });
  execSync(`docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d postgres -c "CREATE DATABASE ${TEST_DB};"`, { stdio: "pipe" });
  execSync(`npx prisma migrate deploy`, { cwd: AUTH_SERVICE_ROOT, env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "pipe" });
} catch (e: any) {
  setupError = `local Postgres / throwaway test-db setup failed (${e.message?.slice(0, 300)}) — skipping real-DB session tests`;
}

test("real-DB session setup", { skip: setupError ? setupError : false }, () => {
  assert.equal(setupError, "");
});

if (!setupError) {
  process.env.DATABASE_URL = TEST_DB_URL;

  test("real DB: login on web then mobile keeps both; a second web login signs the first web session out (refresh + access token), mobile untouched", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.create({
      data: { email: "sessions@example.test", password: await bcrypt.hash("Correct-pass-1", 10), role: "CUSTOMER" as any },
    });

    const web1 = await authService.login("sessions@example.test", "Correct-pass-1", "web");
    const mobile1 = await authService.login("sessions@example.test", "Correct-pass-1", "mobile");
    // Different platform: web1 must still be fully alive.
    await authService.verifyToken(web1.accessToken);
    await authService.verifyToken(mobile1.accessToken);

    const web2 = await authService.login("sessions@example.test", "Correct-pass-1", "web");
    // web1 is dead everywhere: access token refused at once, refresh refused with the dedicated code.
    await assert.rejects(() => authService.verifyToken(web1.accessToken), (e: any) => e.status === 401 && e.code === "SESSION_REPLACED");
    await assert.rejects(() => authService.refresh(web1.refreshToken), (e: any) => e.status === 401 && e.code === "SESSION_REPLACED");
    // web2 and mobile1 are alive; refresh rotation keeps working and keeps the session id.
    await authService.verifyToken(web2.accessToken);
    const rotated = await authService.refresh(mobile1.refreshToken);
    assert.equal((jwt.decode(rotated.accessToken) as any).sid, (jwt.decode(mobile1.accessToken) as any).sid);
    await authService.verifyToken(rotated.accessToken);
    // Exactly one live session per platform.
    const live = await prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { platform: "asc" } });
    assert.deepEqual(live.map((r) => r.platform), ["mobile", "web"]);
  });

  test("real DB: a mobile login never supersedes the web session", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;
    await prisma.user.create({
      data: { email: "sessions2@example.test", password: await bcrypt.hash("Correct-pass-1", 10), role: "CUSTOMER" as any },
    });
    const web = await authService.login("sessions2@example.test", "Correct-pass-1", "web");
    await authService.login("sessions2@example.test", "Correct-pass-1", "mobile");
    await authService.login("sessions2@example.test", "Correct-pass-1", "mobile");
    await authService.verifyToken(web.accessToken);
    await authService.refresh(web.refreshToken);
  });

  /** A refresh row as it looked BEFORE migration 20261119010000: platform defaulted to web, no session id. */
  async function legacyRow(userId: string, token: string) {
    const { prisma } = await import("../repositories/auth.repository");
    const jsonwebtoken = (await import("jsonwebtoken")).default;
    void jsonwebtoken;
    await prisma.refreshToken.create({ data: { userId, token, expiresAt: new Date(Date.now() + 86_400_000), platform: "web", sessionId: null } });
  }
  async function signedLegacyToken(userId: string) {
    const jsonwebtoken = (await import("jsonwebtoken")).default;
    return jsonwebtoken.sign({ userId, nonce: Math.random().toString(36) }, process.env.JWT_REFRESH_SECRET || "refresh-secret-key-change-in-production", { expiresIn: "7d" });
  }

  test("real DB: R2-01 a LEGACY row (platform web, no sessionId) refreshed by the phone becomes a mobile session; a later web login no longer kicks it", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.create({
      data: { email: "legacy1@example.test", password: await bcrypt.hash("Correct-pass-1", 10), role: "CUSTOMER" as any },
    });
    const legacyToken = await signedLegacyToken(user.id);
    await legacyRow(user.id, legacyToken);

    const rotated = await authService.refresh(legacyToken, "mobile");
    const rows = await prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].platform, "mobile");
    assert.ok(rows[0].sessionId, "legacy row got a session id");

    await authService.login("legacy1@example.test", "Correct-pass-1", "web");
    await authService.verifyToken(rotated.accessToken); // the phone survives the web login
    await authService.refresh(rotated.refreshToken, "mobile");
  });

  test("real DB: R2-01 a legacy row refreshed as web stays web (a later web login still supersedes it); a legacy row without a header is web", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.create({
      data: { email: "legacy2@example.test", password: await bcrypt.hash("Correct-pass-1", 10), role: "CUSTOMER" as any },
    });
    const legacyToken = await signedLegacyToken(user.id);
    await legacyRow(user.id, legacyToken);
    const rotated = await authService.refresh(legacyToken, "web");
    assert.equal((await prisma.refreshToken.findFirst({ where: { userId: user.id, revokedAt: null } }))!.platform, "web");
    await authService.login("legacy2@example.test", "Correct-pass-1", "web");
    await assert.rejects(() => authService.verifyToken(rotated.accessToken), (e: any) => e.code === "SESSION_REPLACED");
  });

  test("real DB: R2-01 a legacy row re-classified to mobile yields to a mobile session that is already live (newer login wins) and is told SESSION_REPLACED", async () => {
    const { prisma } = await import("../repositories/auth.repository");
    const { authService } = await import("../services/auth.service");
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.create({
      data: { email: "legacy3@example.test", password: await bcrypt.hash("Correct-pass-1", 10), role: "CUSTOMER" as any },
    });
    const legacyToken = await signedLegacyToken(user.id);
    await legacyRow(user.id, legacyToken);
    const mobileNow = await authService.login("legacy3@example.test", "Correct-pass-1", "mobile");
    await assert.rejects(() => authService.refresh(legacyToken, "mobile"), (e: any) => e.status === 401 && e.code === "SESSION_REPLACED");
    // The live mobile session is untouched, and the legacy row cannot be used again.
    await authService.verifyToken(mobileNow.accessToken);
    await assert.rejects(() => authService.refresh(legacyToken, "mobile"), (e: any) => e.code === "SESSION_REPLACED");
  });
}
