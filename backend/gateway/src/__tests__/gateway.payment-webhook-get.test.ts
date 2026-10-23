/**
 * FH E2E: VNPay calls its IPN with GET /payments/webhook/vnpay (the signed query string is the whole message).
 * The gateway used to proxy only POST /payments/webhook/:provider, so the IPN answered 404 through the gateway and a
 * payment was credited only by the return URL or the reconcile sweep. GET is now forwarded exactly like POST: no auth
 * (payment-service verifies the signature), same path, same query string, nothing injected.
 *
 * Same real-app + fake-downstream-server convention as gateway.pt-listing.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real, auth-service and payment-service are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4095";
process.env.PAYMENT_SERVICE_URL = "http://127.0.0.1:4096";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-payment-webhook-test";

let app: any;
let gatewayServer: http.Server;
let paymentServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let authCalls = 0;
let hits: Array<{ method: string; url: string; authorization: string; userHeader: string }> = [];

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((_req, res) => {
    authCalls += 1;
    res.statusCode = 401;
    res.end();
  });
  paymentServer = http.createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      hits.push({
        method: String(req.method),
        url: String(req.url),
        authorization: String(req.headers.authorization || ""),
        userHeader: String(req.headers["x-user-id"] || ""),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ RspCode: "00", Message: "Confirm Success" }));
    });
  });
  await new Promise<void>((resolve) => authServer.listen(4095, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => paymentServer.listen(4096, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  hits = [];
  authCalls = 0;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => paymentServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

const VNPAY_QUERY = "?vnp_TxnRef=txn-1&vnp_ResponseCode=00&vnp_SecureHash=abc123";

test("GET /payments/webhook/vnpay (the VNPay IPN) is forwarded with its query string and needs no token", async () => {
  const res = await fetch(`${gatewayBaseUrl}/payments/webhook/vnpay${VNPAY_QUERY}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { RspCode: "00", Message: "Confirm Success" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "GET");
  assert.equal(hits[0].url, `/payments/webhook/vnpay${VNPAY_QUERY}`);
  assert.equal(hits[0].authorization, "");
  assert.equal(hits[0].userHeader, "");
  assert.equal(authCalls, 0, "the IPN must never be sent to auth-service");
});

test("the IPN stays unauthenticated even when a bogus token is attached (the signature is the proof)", async () => {
  const res = await fetch(`${gatewayBaseUrl}/payments/webhook/vnpay${VNPAY_QUERY}`, { headers: { Authorization: "Bearer not-a-real-token" } });
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1);
  assert.equal(authCalls, 0);
});

test("POST /payments/webhook/:provider is unchanged: still forwarded without auth", async () => {
  const res = await fetch(`${gatewayBaseUrl}/payments/webhook/zalopay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x" }),
  });
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "POST");
  assert.equal(hits[0].url, "/payments/webhook/zalopay");
  assert.equal(authCalls, 0);
});

test("no other route changed: PUT/DELETE on the webhook path and the bare /payments/webhook are not proxied unauthenticated", async () => {
  for (const [method, path] of [
    ["PUT", "/payments/webhook/vnpay"],
    ["DELETE", "/payments/webhook/vnpay"],
    ["GET", "/payments/webhook"],
    ["GET", "/payments/webhook/vnpay/extra"],
  ] as const) {
    hits = [];
    const res = await fetch(`${gatewayBaseUrl}${path}`, { method, redirect: "manual" });
    assert.notEqual(res.status, 200, `${method} ${path} must not reach payment-service as an open webhook`);
    assert.equal(hits.length, 0, `${method} ${path} reached payment-service`);
  }
});
