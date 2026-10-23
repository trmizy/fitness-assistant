import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SECURITY HARDENING (D75 item 4) — DEMONSTRATES A CURRENT WEAKNESS, DOES NOT FIX IT.
 *
 * serviceSecret.middleware.ts accepts the well-known in-repo dev defaults for
 * `x-service-secret` whenever NODE_ENV !== "production" — even if the deployment HAS configured
 * a real INTERNAL_SERVICE_SECRET. These /internal/* routes move money (wallet credit/debit,
 * contract settlement). A real deployment that runs without NODE_ENV=production (plain `node`,
 * dev compose file on a public host, a typo) is therefore open to anyone who has read the repo.
 *
 * Registered as `todo`: encodes the DESIRED behaviour (default rejected unless
 * ALLOW_INSECURE_DEV_SECRETS=true), currently FAILS, and does not fail the suite.
 * No secret value is printed — defaults are read from source at run time and never logged.
 */
process.env.NODE_ENV = "staging";
// A properly configured, strong, non-default secret:
process.env.INTERNAL_SERVICE_SECRET = "x".repeat(8) + "-configured-strong-secret-for-test-only-0123456789";
delete process.env.INTERNAL_API_SECRET;
delete process.env.ALLOW_INSECURE_DEV_SECRETS;

function firstDevDefault(): string {
  const src = fs.readFileSync(path.join(__dirname, "../middleware/serviceSecret.middleware.ts"), "utf8");
  const block = src.match(/DEV_DEFAULTS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "DEV_DEFAULTS block not found (code changed — update this test)");
  const lit = block![1].match(/'([^']+)'|"([^"]+)"/);
  assert.ok(lit, "no literal inside DEV_DEFAULTS");
  return (lit![1] ?? lit![2]) as string;
}

test(
  "payment-service /internal/* must reject the in-repo default x-service-secret even when NODE_ENV!=production and a real secret IS configured",
  { todo: "Security Hardening slice S1: defaults only accepted when ALLOW_INSECURE_DEV_SECRETS=true" },
  async () => {
    const { serviceSecretMiddleware } = await import("../middleware/serviceSecret.middleware");

    let status = 200;
    let nextCalled = false;
    const res: any = {
      status(code: number) { status = code; return this; },
      json() { return this; },
    };
    const req: any = { headers: { "x-service-secret": firstDevDefault() } };
    serviceSecretMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(
      nextCalled,
      false,
      "WEAKNESS CONFIRMED: payment-service /internal/* accepted the public dev-default service secret (NODE_ENV!=production)",
    );
    assert.equal(status, 401);
  },
);
