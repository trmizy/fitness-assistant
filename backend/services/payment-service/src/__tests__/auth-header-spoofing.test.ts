/**
 * Regression tests for the P0 vulnerability found and fixed in this pass:
 * payment-service's extractUser previously trusted x-user-id/x-user-role
 * headers directly off the request with NO verification at all. Since
 * payment-service's port (3007) is published directly on the host in
 * docker-compose.dev.yml — combined with the wallet top-up endpoint's MOCK
 * provider (see webhook-security.integration.test.ts) — anyone who could
 * reach it directly could set x-user-id to any victim's id and credit
 * their wallet with fake money, with no login at all.
 *
 * The fix now verifies the caller's JWT directly against auth-service
 * (matching fitness-service/user-service's pattern) — same real-app +
 * stub-auth-service convention as gym-service's equivalent test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4022";

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
  await new Promise<void>((resolve) => authServer.listen(4022, "127.0.0.1", resolve));

  const { extractUser, requireAuth } = await import("../middleware/auth.middleware");

  const app = express();
  app.get("/whoami", extractUser, requireAuth, (req, res) => {
    res.json({ user: req.user });
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

test("SECURITY: a raw request with a forged x-user-id header and NO valid token cannot act as that victim", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { "x-user-id": "victim-user-id" },
  });
  assert.equal(res.status, 401, "a forged x-user-id header alone must never authenticate — this is exactly what allowed free wallet top-ups");
});

test("a real, valid Bearer token authenticates using auth-service's own identity, ignoring any x-user-id header", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: {
      Authorization: "Bearer real-customer-token",
      "x-user-id": "attacker-injected-victim-id",
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { userId: string } };
  assert.equal(body.user.userId, "real-customer-1", "identity must come from auth-service, never from x-user-id");
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
