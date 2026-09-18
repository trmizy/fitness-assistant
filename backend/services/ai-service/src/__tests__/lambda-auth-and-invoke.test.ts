/**
 * Covers the two things that change when ai-service sits directly behind API
 * Gateway instead of behind the Express gateway:
 *
 *   A. requireAuth must establish identity ITSELF from a Bearer JWT, verified
 *      against auth-service — and must never take x-user-id / x-user-role at
 *      face value from a caller that hasn't proved INTERNAL_SERVICE_SECRET.
 *      Same real-middleware + stub-auth-service convention payment-service's
 *      auth-header-spoofing.test.ts uses.
 *
 *   B. The HTTP Lambda handler must accept a synthetic API Gateway v2 event
 *      delivered by a sibling service's Lambda Invoke (payment-service calling
 *      POST /internal/personalized-service/orders/:id/activate-after-payment),
 *      with x-service-secret surviving the envelope. Both assertions here stop
 *      before any DB access, so this needs no database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const AUTH_PORT = 4033;
process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${AUTH_PORT}`;
process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.NODE_ENV = "production";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://user:pass@127.0.0.1:5432/fitness_assistant_ai?schema=public";

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = "";

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const authorization = String(req.headers.authorization || "");
      if (authorization === "Bearer real-user-token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            user: { id: "verified-user-1", email: "u@example.com", role: "CLIENT" },
          }),
        );
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid token" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) =>
    authServer.listen(AUTH_PORT, "127.0.0.1", resolve),
  );

  const { requireAuth } = await import("../middleware/auth.middleware");

  const app = express();
  app.get("/whoami", requireAuth, (req, res) => {
    res.json({ context: req.context });
  });
  // Error handler mirrors app.ts's, so ApiError surfaces as its real status.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json({ error: err?.message });
  });

  testApp = http.createServer(app);
  await new Promise<void>((resolve) => testApp.listen(0, "127.0.0.1", resolve));
  const address = testApp.address();
  if (!address || typeof address === "string")
    throw new Error("failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    testApp.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    authServer.close((err) => (err ? reject(err) : resolve())),
  );
});

test("A1. verified Bearer token establishes identity without any gateway header", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { Authorization: "Bearer real-user-token" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.context.userId, "verified-user-1");
  assert.equal(body.context.role, "CLIENT");
});

test("A2. spoofed x-user-id/x-user-role never override the verified token", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: {
      Authorization: "Bearer real-user-token",
      "x-user-id": "victim-user",
      "x-user-role": "ADMIN",
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.context.userId, "verified-user-1");
  assert.equal(body.context.role, "CLIENT");
});

test("A3. x-user-id alone (no Bearer, no internal token) is rejected", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { "x-user-id": "victim-user", "x-user-role": "ADMIN" },
  });
  assert.equal(res.status, 401);
});

test("A4. wrong x-internal-token is rejected even with x-user-id present", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { "x-internal-token": "wrong-secret", "x-user-id": "victim-user" },
  });
  assert.equal(res.status, 401);
});

test("A5. invalid Bearer token is rejected", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: { Authorization: "Bearer forged-token" },
  });
  assert.equal(res.status, 401);
});

test("A6. service-to-service path still works (correct internal token + x-user-id)", async () => {
  const res = await fetch(`${baseUrl}/whoami`, {
    headers: {
      "x-internal-token": "test-internal-secret",
      "x-user-id": "fitness-service-caller",
      "x-user-role": "PT",
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.context.userId, "fitness-service-caller");
  assert.equal(body.context.role, "PT");
});

function activateAfterPaymentEvent(secret: string, body: unknown) {
  const path =
    "/internal/personalized-service/orders/11111111-1111-1111-1111-111111111111/activate-after-payment";
  // Byte-for-byte the envelope clients/lambda-http.client.ts produces, which
  // is also what payment-service's own lambda-http.client.ts sends.
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json", "x-service-secret": secret },
    requestContext: {
      http: {
        method: "POST",
        path,
        sourceIp: "payment-service",
        userAgent: "payment-service-lambda-invoke",
      },
      requestId: "payment-test",
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

test("B1. synthetic API Gateway v2 event reaches the internal activate route and enforces x-service-secret", async () => {
  const { handler } = await import("../lambda");
  const result: any = await handler(
    activateAfterPaymentEvent("wrong-secret", { transactionId: "tx-1" }),
    {},
  );
  // 401 (not 404) proves the event routed to the real handler and the guard ran.
  assert.equal(result.statusCode, 401);
});

test("B2. correct x-service-secret passes the guard and reaches request validation", async () => {
  const { handler } = await import("../lambda");
  const result: any = await handler(
    activateAfterPaymentEvent("test-internal-secret", {}),
    {},
  );
  // 400 = past the secret guard, into the route's own transactionId check —
  // and still short of any DB access, which is what keeps this test hermetic.
  assert.equal(result.statusCode, 400);
  assert.match(String(result.body), /transactionId/);
});
