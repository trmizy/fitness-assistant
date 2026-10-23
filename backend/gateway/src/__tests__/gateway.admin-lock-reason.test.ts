/**
 * PT-lock slice 1, item 3 — the admin's reason for locking/unlocking an account must reach
 * auth-service. The gateway used to forward an empty `{}` whatever the caller sent.
 *
 * Same real-app + fake-downstream-server convention as gateway.profile-admin-rbac.test.ts:
 * the actual gateway Express app, a stub auth-service that records what it receives, real HTTP
 * requests through the gateway (REAL HTTP/API for the gateway half, TEST FIXTURE for auth-service).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4021";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4022";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-admin-lock-test";

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let lockCalls: { method?: string; url?: string; auth?: string; body: string }[] = [];

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      if (req.method === "POST" && req.url === "/auth/verify") {
        const isAdmin = String(req.headers.authorization || "").includes("admin-token");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: isAdmin ? "admin-1" : "customer-1", email: "x@example.com", role: isAdmin ? "ADMIN" : "CUSTOMER" } }));
        return;
      }
      if (req.method === "PATCH" && /^\/auth\/users\/[^/]+\/(disable|enable)$/.test(req.url || "")) {
        lockCalls.push({ method: req.method, url: req.url, auth: String(req.headers.authorization), body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: "pt-1", isActive: req.url!.endsWith("/enable") } }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });

  await new Promise<void>((resolve) => authServer.listen(4021, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  lockCalls = [];
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

test("the admin's reason is forwarded to auth-service on disable, with the admin's own token", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/users/pt-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "gian lận hợp đồng" }),
  });
  assert.equal(res.status, 200);
  assert.equal(lockCalls.length, 1);
  assert.equal(lockCalls[0].url, "/auth/users/pt-1/disable");
  assert.equal(lockCalls[0].auth, "Bearer admin-token", "auth-service derives the acting admin from this token");
  assert.deepEqual(JSON.parse(lockCalls[0].body), { reason: "gian lận hợp đồng" });
});

test("the reason is forwarded on enable too", async () => {
  await fetch(`${gatewayBaseUrl}/admin/users/pt-1/enable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "khoá nhầm" }),
  });
  assert.deepEqual(JSON.parse(lockCalls[0].body), { reason: "khoá nhầm" });
});

test("no body at all (what the mobile admin screen sends today) still works and forwards an empty object", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/users/pt-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(lockCalls[0].body), {});
});

test("SECURITY: nothing but `reason` is forwarded — a body cannot flip the direction via isActive", async () => {
  await fetch(`${gatewayBaseUrl}/admin/users/pt-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: true, reason: "x", role: "ADMIN" }),
  });
  assert.deepEqual(JSON.parse(lockCalls[0].body), { reason: "x" });
});

test("a non-string reason is dropped, not forwarded", async () => {
  await fetch(`${gatewayBaseUrl}/admin/users/pt-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: { evil: true } }),
  });
  assert.deepEqual(JSON.parse(lockCalls[0].body), {});
});

test("SECURITY: a non-admin token is rejected with 403 and auth-service is never asked to lock anyone", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/users/pt-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer customer-token", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "x" }),
  });
  assert.equal(res.status, 403);
  assert.equal(lockCalls.length, 0);
});
