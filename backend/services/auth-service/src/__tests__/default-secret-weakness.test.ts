import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

/**
 * SECURITY HARDENING (D75 item 4) — DEMONSTRATES A CURRENT WEAKNESS, DOES NOT FIX IT.
 *
 * Weakness: auth.service.ts signs/verifies every session token with
 *   `process.env.JWT_SECRET || "<public default>"`, and server.ts only rejects that default
 *   when NODE_ENV === "production". A real deployment that forgets BOTH NODE_ENV=production
 *   and JWT_SECRET therefore accepts a token forged by anyone who has read this repo.
 *
 * The test is registered as `todo`: it encodes the DESIRED behaviour (forged token rejected),
 * currently FAILS, and a failing todo does not fail the suite. When the
 * ALLOW_INSECURE_DEV_SECRETS fail-closed change lands, the todo flag should be removed.
 *
 * No secret value is printed: the default is read from source at run time and only used as
 * a signing key; assertion messages never include it.
 */

// Simulate "NODE_ENV not production, JWT_SECRET/JWT_REFRESH_SECRET not configured".
// Empty string (not delete): Prisma auto-loads the service .env for UNSET vars only, and
// `X || default` treats "" as unset, so this is the exact misconfiguration we want to model.
process.env.NODE_ENV = "staging";
process.env.JWT_SECRET = "";
process.env.JWT_REFRESH_SECRET = "";
delete process.env.ALLOW_INSECURE_DEV_SECRETS;

function publicDefaultAccessSecret(): string {
  const src = fs.readFileSync(path.join(__dirname, "../services/auth.service.ts"), "utf8");
  const m = src.match(/process\.env\.JWT_SECRET\s*\|\|\s*"([^"]+)"/);
  assert.ok(m, "could not locate the access-secret fallback in auth.service.ts (code changed — update this test)");
  return m![1];
}

test(
  "a token forged with the in-repo default JWT secret must NOT be accepted when JWT_SECRET is unset and NODE_ENV!=production",
  { todo: "Security Hardening slice S1: reject default/short secrets unless ALLOW_INSECURE_DEV_SECRETS=true" },
  async () => {
    const { authService } = await import("../services/auth.service");
    const { authRepository } = await import("../repositories/auth.repository");

    const forged = jwt.sign(
      { userId: "forged-admin-id", role: "ADMIN", email: "forged@example.invalid" },
      publicDefaultAccessSecret(),
      { expiresIn: "5m" },
    );

    const original = authRepository.findUserById;
    (authRepository as any).findUserById = async (id: string) => ({
      id,
      email: "forged@example.invalid",
      role: "ADMIN",
      isActive: true,
    });
    try {
      let accepted = false;
      try {
        await authService.verifyToken(forged);
        accepted = true;
      } catch {
        accepted = false;
      }
      assert.equal(
        accepted,
        false,
        "WEAKNESS CONFIRMED: auth-service accepted a token signed with the public default secret (NODE_ENV!=production, JWT_SECRET unset)",
      );
    } finally {
      (authRepository as any).findUserById = original;
    }
  },
);
