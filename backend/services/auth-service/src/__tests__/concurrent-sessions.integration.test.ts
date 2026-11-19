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
}
