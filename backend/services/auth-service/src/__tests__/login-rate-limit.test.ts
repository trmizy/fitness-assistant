import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { loginRateLimit } from "../middleware/loginRateLimit.middleware";

/**
 * Money-flow plan 5.4 — minimum auth-service test coverage: login attempt rate limiting.
 * loginRateLimit is pure middleware (in-memory Map, no DB) — driven directly here with fake
 * req/res objects rather than a full HTTP server, mirroring how the module itself documents
 * its own contract: only FAILED attempts count (a 2xx response rolls the counter back via the
 * real `res.on("finish", ...)` hook this test also fires, not a shortcut around it).
 */

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown = null;
  setHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
    // A real Express response emits "finish" once the response is actually sent — the
    // middleware's rollback-on-success logic is registered against that same event.
    this.emit("finish");
    return this;
  }
}

function fakeReq(ip: string, email: string) {
  return { ip, headers: {}, body: { email } } as any;
}

/** Simulates one login attempt through the real middleware + a downstream handler that
 * responds with `finalStatus`. Returns whether the middleware itself blocked the call
 * (never reached `next`) and what status code ultimately went out. */
function attempt(ip: string, email: string, finalStatus: number): { blocked: boolean; status: number } {
  const req = fakeReq(ip, email);
  const res = new FakeRes();
  let calledNext = false;
  loginRateLimit(req, res as any, () => {
    calledNext = true;
    // The downstream login controller runs here in real life; simulate its outcome.
    res.status(finalStatus).json({});
  });
  if (!calledNext) {
    // Hard-blocked by the limiter itself (429) — it already responded without calling next().
    return { blocked: true, status: res.statusCode };
  }
  return { blocked: false, status: res.statusCode };
}

test("5 failed login attempts from the same (ip, email) trigger a 429 on the 6th", () => {
  const ip = "10.0.0.1";
  const email = "victim@example.com";
  for (let i = 0; i < 5; i++) {
    const result = attempt(ip, email, 401); // wrong password each time
    assert.equal(result.blocked, false, `attempt ${i + 1} should still be let through`);
    assert.equal(result.status, 401);
  }
  const sixth = attempt(ip, email, 401);
  assert.equal(sixth.blocked, true, "the 6th attempt must be hard-blocked by the limiter itself");
  assert.equal(sixth.status, 429);
});

test("a successful login (2xx) resets the failure counter instead of counting as a failure", () => {
  const ip = "10.0.0.2";
  const email = "recovers@example.com";
  for (let i = 0; i < 4; i++) {
    attempt(ip, email, 401);
  }
  // One successful login in between — must roll back to 4, not accumulate to 5.
  const success = attempt(ip, email, 200);
  assert.equal(success.blocked, false);
  assert.equal(success.status, 200);

  // The count is back to 4 (not 5) after the rollback, so exactly one more failure is still
  // let through (count 4 -> 5); a second one after that hits the same ceiling test 1 does.
  const next1 = attempt(ip, email, 401);
  const next2 = attempt(ip, email, 401);
  assert.equal(next1.blocked, false, "the rollback bought back exactly one more allowed attempt");
  assert.equal(next2.blocked, true, "without the rollback this would already be the 6th failure in the window");
});

test("failed attempts for a DIFFERENT email from the same IP do not share a bucket", () => {
  const ip = "10.0.0.3";
  for (let i = 0; i < 5; i++) {
    attempt(ip, "victim-a@example.com", 401);
  }
  const blockedForA = attempt(ip, "victim-a@example.com", 401);
  assert.equal(blockedForA.blocked, true);

  // A different email from the exact same IP must not be caught by victim-a's lockout.
  const stillOkForB = attempt(ip, "victim-b@example.com", 401);
  assert.equal(stillOkForB.blocked, false);
});

test("failed attempts for the same email from a DIFFERENT IP do not share a bucket", () => {
  const email = "shared-target@example.com";
  for (let i = 0; i < 5; i++) {
    attempt("10.0.0.4", email, 401);
  }
  const blockedFromFirstIp = attempt("10.0.0.4", email, 401);
  assert.equal(blockedFromFirstIp.blocked, true);

  const stillOkFromOtherIp = attempt("10.0.0.5", email, 401);
  assert.equal(stillOkFromOtherIp.blocked, false);
});
