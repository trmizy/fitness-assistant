/**
 * Regression tests for the P0 vulnerability found and fixed in this pass:
 * gym-service's extractUser previously trusted x-user-id/x-user-role
 * headers directly off the request with NO verification at all. Since
 * gym-service's port (3006) is published directly on the host in
 * docker-compose.dev.yml, anyone who could reach it — bypassing the API
 * gateway entirely — could impersonate any user or role (including
 * ADMIN/GYM_OWNER) just by setting these headers by hand.
 *
 * The fix now verifies the caller's JWT directly against auth-service
 * (matching fitness-service/user-service's pattern) — these tests spin up
 * a real Express app using the actual middleware plus a stub auth-service
 * HTTP server, then make real HTTP requests to prove header-only spoofing
 * no longer works and a real verified token still does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4021";

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = "";

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const authorization = String(req.headers.authorization || "");
      if (authorization === "Bearer real-customer-token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: "real-customer-1", email: "c@example.com", role: "CUSTOMER" } }));
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid token" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => authServer.listen(4021, "127.0.0.1", resolve));

  // Import AFTER setting AUTH_SERVICE_URL so the middleware module reads it.
  const { extractUser, requireAuth, requireRoles } = await import("../middleware/auth.middleware");

  const app = express();
  app.get("/whoami", extractUser, requireAuth, (req, res) => {
    res.json({ user: req.user });
  });
  app.get("/admin-only", extractUser, requireAuth, requireRoles("ADMIN"), (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  testApp = http.createServer(app);
  await new Promise<void>((resolve) => testApp.listen(0, "127.0.0.1", resolve));
  const address = testApp.address();
  if (!address || typeof address === "string") throw new Error("failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

test("SECURITY: a raw request with forged x-user-id/x-user-role headers and NO valid token is rejected", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: {
      "x-user-id": "admin-victim-id",
      "x-user-role": "ADMIN",
    },
  });
  assert.equal(res.status, 401, "a forged header alone, with no real Bearer token, must never authenticate");
});

test("SECURITY: forged x-user-role=ADMIN alongside a REAL customer token still does not grant admin access", async () => {
  const res = await fetch(`${baseUrl}/admin-only`, {
    headers: {
      Authorization: "Bearer real-customer-token",
      "x-user-role": "ADMIN", // attacker-supplied, must be ignored
      "x-user-id": "someone-elses-id", // attacker-supplied, must be ignored
    },
  });
  assert.equal(res.status, 403, "role must come from the verified token, never from a client-supplied header");
});

test("a real, valid Bearer token authenticates correctly using auth-service's own identity, not any client header", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: {
      Authorization: "Bearer real-customer-token",
      "x-user-id": "attacker-injected-id",
      "x-user-role": "ADMIN",
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { userId: string; role: string } };
  assert.equal(body.user.userId, "real-customer-1", "identity must come from auth-service, not the x-user-id header");
  assert.equal(body.user.role, "CUSTOMER", "role must come from auth-service, not the x-user-role header");
});

test("an invalid/unrecognized Bearer token is rejected", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { Authorization: "Bearer totally-made-up-token" },
  });
  assert.equal(res.status, 401);
});

test("no Authorization header at all is rejected", async () => {
  const res = await fetch(`${baseUrl}/whoami`);
  assert.equal(res.status, 401);
});
