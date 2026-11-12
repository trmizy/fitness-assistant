import test from "node:test";
import assert from "node:assert/strict";

/**
 * SECURITY HARDENING (D75 item 4) — FIXED 2026-11-13 (fail-closed hotfix), now a REQUIRED test.
 *
 * fitness-service `internalAuthMiddleware` used to trust a bare `x-user-id` / `x-user-role` header
 * with no token when INTERNAL_SERVICE_SECRET was unset and NODE_ENV !== "production". It now rejects
 * the request in every environment; there is no insecure-dev switch.
 * (ai-service requireAuth has a similar branch — separate service, not changed here.)
 */
process.env.NODE_ENV = "staging";
process.env.INTERNAL_SERVICE_SECRET = "";
delete process.env.ALLOW_INSECURE_DEV_SECRETS;

test(
  "fitness-service internalAuthMiddleware must NOT trust a bare x-user-id/x-user-role when no internal secret is configured (NODE_ENV!=production)",
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
