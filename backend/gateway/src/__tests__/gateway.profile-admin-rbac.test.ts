/**
 * Regression test for the P0 RBAC gap found and fixed in this pass:
 * `/profile/admin/contracts/summary` and `/profile/admin/stats` previously
 * had only `authMiddleware` (any logged-in user) at the gateway, with no
 * `requireRoles("ADMIN")` — a CUSTOMER/PT/GYM_OWNER could call these and
 * read platform-wide contract/OCR stats.
 *
 * Same real-app + fake-downstream-server convention as
 * gateway.ai-flow.test.ts: spins up the actual gateway Express app plus
 * stub auth-service and user-service HTTP servers, then makes real HTTP
 * requests through the gateway.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4011";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4012";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-profile-admin-test";

let app: any;
let gatewayServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let userServiceHitCount = 0;

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const authorization = String(req.headers.authorization || "");
      const isAdmin = authorization.includes("admin-token");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          user: {
            id: isAdmin ? "admin-1" : "customer-1",
            email: isAdmin ? "admin@example.com" : "customer@example.com",
            role: isAdmin ? "ADMIN" : "CUSTOMER",
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  userServer = http.createServer((req, res) => {
    userServiceHitCount += 1;
    if (req.url === "/profile/admin/contracts/summary" || req.url === "/profile/admin/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ summary: { "some-user-id": 3 } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => authServer.listen(4011, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(4012, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));

  const address = gatewayServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start gateway test server");
  }
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  userServiceHitCount = 0;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => userServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

test("SECURITY: a CUSTOMER token is rejected with 403 for /profile/admin/contracts/summary and never reaches user-service", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/admin/contracts/summary`, {
    headers: { Authorization: "Bearer customer-token" },
  });
  assert.equal(res.status, 403);
  assert.equal(userServiceHitCount, 0, "user-service must never be called for a non-admin caller");
});

test("SECURITY: a CUSTOMER token is rejected with 403 for /profile/admin/stats and never reaches user-service", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/admin/stats`, {
    headers: { Authorization: "Bearer customer-token" },
  });
  assert.equal(res.status, 403);
  assert.equal(userServiceHitCount, 0);
});

test("an ADMIN token is allowed through to /profile/admin/contracts/summary", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/admin/contracts/summary`, {
    headers: { Authorization: "Bearer admin-token" },
  });
  assert.equal(res.status, 200);
  assert.equal(userServiceHitCount, 1);
});

test("an ADMIN token is allowed through to /profile/admin/stats", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/admin/stats`, {
    headers: { Authorization: "Bearer admin-token" },
  });
  assert.equal(res.status, 200);
  assert.equal(userServiceHitCount, 1);
});

test("no token at all is rejected with 401 before any role check", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/admin/stats`);
  assert.equal(res.status, 401);
  assert.equal(userServiceHitCount, 0);
});
