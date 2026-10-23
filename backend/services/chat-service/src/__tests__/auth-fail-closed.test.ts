/**
 * Audit finding #4 - chat-service must FAIL CLOSED when auth-service / user-service cannot give a verdict.
 *
 * REAL HTTP at the service boundary: a local HTTP server stands in for auth-service (AUTH_SERVICE_URL) and
 * user-service (USER_SERVICE_URL); the real axios clients and the real authMiddleware / call policy run against it.
 * No database. (TEST FIXTURE for the two upstream services; the middleware and the policy are the real code.)
 *
 * Before the fix: a 2xx answer without a user let the request through with req.user undefined; any upstream failure other
 * than ECONNREFUSED (5xx, timeout, DNS) was reported as 401 "invalid token"; and call.policy answered "allowed" when the
 * account-status check threw ("be permissive").
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

let authMode: "ok" | "empty" | "500" | "401" | "403" = "ok";
const upstream = http.createServer((req, res) => {
  if (req.url?.startsWith("/auth/verify")) {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (authMode === "ok") return send(200, { user: { id: "u1", email: "u1@test.dev", role: "CUSTOMER" } });
    if (authMode === "empty") return send(200, {});
    if (authMode === "500") return send(500, { error: "boom" });
    if (authMode === "401") return send(401, { error: "Invalid or expired token" });
    return send(403, { error: "Account disabled" });
  }
  // user-service /contracts/check-relationship: always down for the call-policy test
  res.writeHead(503);
  res.end();
});

let mw: typeof import("../middleware/auth.middleware");
let callPolicy: typeof import("../services/call.policy");
let chatRepo: typeof import("../repositories/chat.repository");

test.before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as AddressInfo).port;
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${port}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${port}`;
  mw = await import("../middleware/auth.middleware");
  callPolicy = await import("../services/call.policy");
  chatRepo = await import("../repositories/chat.repository");
});
test.after(async () => {
  if (upstream.listening) await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

async function run() {
  const req: any = { headers: { authorization: "Bearer some.jwt.token" } };
  const out: { status: number; body: any; nextCalled: boolean } = { status: 0, body: undefined, nextCalled: false };
  const res: any = {
    status(c: number) {
      out.status = c;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  await mw.authMiddleware(req, res, () => {
    out.nextCalled = true;
  });
  return { ...out, user: req.user };
}

test("auth-service verifies the token: the request continues with the verified user", async () => {
  authMode = "ok";
  const r = await run();
  assert.equal(r.nextCalled, true);
  assert.equal(r.user?.id, "u1");
});

test("auth-service answers 2xx WITHOUT a user: 401, the request does NOT continue", async () => {
  authMode = "empty";
  const r = await run();
  assert.equal(r.nextCalled, false);
  assert.equal(r.status, 401);
});

test("auth-service errors (5xx): 503 'could not verify', not a 401 and never continues", async () => {
  authMode = "500";
  const r = await run();
  assert.equal(r.nextCalled, false);
  assert.equal(r.status, 503);
});

test("auth-service says the token is invalid / the account is disabled: 401 / 403 are passed on", async () => {
  authMode = "401";
  let r = await run();
  assert.deepEqual([r.nextCalled, r.status], [false, 401]);
  authMode = "403";
  r = await run();
  assert.deepEqual([r.nextCalled, r.status], [false, 403]);
});

test("call policy: when the account-status check cannot be made the call is NOT allowed", async () => {
  const restores: Array<() => void> = [];
  const repo: any = (chatRepo as any).chatRepository;
  const original = repo.isUserParticipant;
  repo.isUserParticipant = async () => true;
  restores.push(() => (repo.isUserParticipant = original));
  try {
    const r = await callPolicy.canInitiateCallFromChat("caller", "callee", "conv-1", "token");
    assert.equal(r.allowed, false);
  } finally {
    restores.forEach((f) => f());
  }
});

test("auth-service unreachable (connection refused): 503, never continues", async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  const r = await run();
  assert.equal(r.nextCalled, false);
  assert.equal(r.status, 503);
});
