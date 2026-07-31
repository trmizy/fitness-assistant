/**
 * Regression test for a critical gap found while addressing P1 5.2
 * (payment API stubs): admin.routes.ts (mounted at /admin/payments) had NO
 * auth middleware of its own at all — not even the header-trust pattern
 * fixed elsewhere, literally nothing. It relied entirely on the API
 * gateway's requireRoles('ADMIN') gate.
 *
 * Since payment-service's port (3007) is published directly on the host in
 * docker-compose.dev.yml, anyone who reached it directly — bypassing the
 * gateway — could call POST /admin/payments/:id/refund (a REAL
 * fund-reversing endpoint) with zero authentication at all. This is
 * effectively as severe as the P0 identity-header-spoofing findings, just
 * discovered a step later while working through the P1 list.
 *
 * Fix: every route in admin.routes.ts now requires extractUser +
 * requireAuth + requireRoles('ADMIN') independently of the gateway.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4031";

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = "";

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const authorization = String(req.headers.authorization || "");
      if (authorization === "Bearer real-admin-token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: "real-admin-1", email: "a@example.com", role: "ADMIN" } }));
        return;
      }
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
  await new Promise<void>((resolve) => authServer.listen(4031, "127.0.0.1", resolve));

  const { default: adminRoutes } = await import("../routes/admin.routes");
  const app = express();
  app.use(express.json());
  app.use("/admin/payments", adminRoutes);

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

test("SECURITY: POST /admin/payments/:id/refund with NO auth at all is rejected — this is the exact bug (a real fund-reversing endpoint had zero auth)", async () => {
  const res = await fetch(`${baseUrl}/admin/payments/some-txn-id/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminId: "attacker-supplied-admin-id", reason: "forged" }),
  });
  assert.equal(res.status, 401);
});

test("SECURITY: a real but non-admin (CUSTOMER) token is rejected with 403 for the refund endpoint", async () => {
  const res = await fetch(`${baseUrl}/admin/payments/some-txn-id/refund`, {
    method: "POST",
    headers: { Authorization: "Bearer real-customer-token", "Content-Type": "application/json" },
    body: JSON.stringify({ adminId: "real-customer-1", reason: "test" }),
  });
  assert.equal(res.status, 403);
});

test("SECURITY: GET /admin/payments (list) with no auth is rejected", async () => {
  const res = await fetch(`${baseUrl}/admin/payments`);
  assert.equal(res.status, 401);
});

test("SECURITY: GET /admin/payments/commissions with no auth is rejected", async () => {
  const res = await fetch(`${baseUrl}/admin/payments/commissions`);
  assert.equal(res.status, 401);
});

test("SECURITY: PATCH .../commissions/:id/settle with no auth is rejected (before even reaching the 501 stub)", async () => {
  const res = await fetch(`${baseUrl}/admin/payments/commissions/some-id/settle`, { method: "PATCH" });
  assert.equal(res.status, 401);
});

test("a real ADMIN token is allowed through to GET /admin/payments", async () => {
  const res = await fetch(`${baseUrl}/admin/payments`, {
    headers: { Authorization: "Bearer real-admin-token" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; data: unknown[] };
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
});
