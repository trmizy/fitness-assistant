import test from "node:test";
import assert from "node:assert/strict";

/**
 * SECURITY HARDENING (D75 item 4) — DEMONSTRATES A CURRENT WEAKNESS, DOES NOT FIX IT.
 *
 * fitness-service `internalAuthMiddleware`: when INTERNAL_SERVICE_SECRET is unset and
 * NODE_ENV !== "production" it trusts a bare `x-user-id` / `x-user-role` header with no token
 * at all ("dev mode only"). A deployment that forgets both NODE_ENV=production and the secret
 * lets any caller that can reach the port impersonate any user, including ADMIN.
 * (ai-service requireAuth has the same branch.)
 *
 * Registered as `todo`: encodes the DESIRED behaviour (401 unless ALLOW_INSECURE_DEV_SECRETS=true).
 */
process.env.NODE_ENV = "staging";
process.env.INTERNAL_SERVICE_SECRET = "";
delete process.env.ALLOW_INSECURE_DEV_SECRETS;

test(
  "fitness-service internalAuthMiddleware must NOT trust a bare x-user-id/x-user-role when no internal secret is configured (NODE_ENV!=production)",
  { todo: "Security Hardening slice S1: header-trust dev mode only with ALLOW_INSECURE_DEV_SECRETS=true" },
  async () => {
    const { internalAuthMiddleware } = await import("../middleware/auth.middleware");
    let nextCalled = false;
    let status = 200;
    const res: any = {
      status(c: number) { status = c; return this; },
      json() { return this; },
    };
    const req: any = { headers: { "x-user-id": "victim-or-admin-id", "x-user-role": "ADMIN" }, path: "/internal/x" };
    internalAuthMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(
      nextCalled,
      false,
      "WEAKNESS CONFIRMED: internalAuthMiddleware impersonation via bare x-user-id/x-user-role when secret unset",
    );
    assert.notEqual(status, 200);
  },
);
