/**
 * Listing management B3: the two client headers that decide the legacy-compat behaviour reach gym-service.
 *   - `X-Gymini-Listing-Flow: 2` (new client) and `X-Gymini-Client` (measurement only);
 *   - the CORS preflight lets a browser send them (the `cors` middleware reflects Access-Control-Request-Headers because the gateway
 *     sets no allowedHeaders, plan 12.13 item 10 - this test pins that behaviour);
 *   - a request WITHOUT the flow header arrives without it (the gateway never invents one: no header = an old client).
 *
 * Same real-app + fake-downstream-server convention as gateway.gym-listing.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real, the downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4111";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4112";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4113";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-listing-compat-test";

let app: any;
let gatewayServer: http.Server;
let gymServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let gymHits: Array<{ method: string; url: string; flow: string | undefined; client: string | undefined }> = [];
let userHits: Array<{ url: string; flow: string | undefined; client: string | undefined }> = [];

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: "owner-1", email: "owner@example.com", role: "GYM_OWNER" } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  gymServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      gymHits.push({
        method: String(req.method),
        url: String(req.url),
        flow: req.headers["x-gymini-listing-flow"] as string | undefined,
        client: req.headers["x-gymini-client"] as string | undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  userServer = http.createServer((req, res) => {
    userHits.push({ url: String(req.url), flow: req.headers["x-gymini-listing-flow"] as string | undefined, client: req.headers["x-gymini-client"] as string | undefined });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => authServer.listen(4111, "127.0.0.1", r));
  await new Promise<void>((r) => gymServer.listen(4112, "127.0.0.1", r));
  await new Promise<void>((r) => userServer.listen(4113, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  gymHits = [];
  userHits = [];
});

test.after(async () => {
  for (const s of [gatewayServer, gymServer, userServer, authServer]) {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
});

const ROUTES: Array<[string, string]> = [
  ["POST", "/owner/application/bootstrap"],
  ["PUT", "/owner/application/amenities"],
  ["PUT", "/owner/application/branch"],
  ["POST", "/owner/application/submit"],
  ["POST", "/owner/application/resubmit"],
  ["POST", "/owner/gyms"],
  ["POST", "/owner/gyms/draft"],
  ["PATCH", "/owner/gyms/gym-1/draft"],
  ["POST", "/owner/gyms/gym-1/submit"],
];

test("preflight: a browser may send X-Gymini-Listing-Flow and X-Gymini-Client on every application / add-branch route", async () => {
  for (const [method, path] of ROUTES) {
    const res = await fetch(gatewayBaseUrl + path, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization, content-type, x-gymini-listing-flow, x-gymini-client",
      },
    });
    assert.ok(res.status === 204 || res.status === 200, `${method} ${path}: ${res.status}`);
    const allowed = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
    assert.ok(allowed.includes("x-gymini-listing-flow"), `${method} ${path}: ${allowed}`);
    assert.ok(allowed.includes("x-gymini-client"), `${method} ${path}: ${allowed}`);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  }
  assert.equal(gymHits.length, 0, "a preflight never reaches gym-service");
});

test("forwarding: both headers reach gym-service unchanged on every route; without the flow header none is added", async () => {
  for (const [method, path] of ROUTES) {
    gymHits = [];
    const withHeaders = await fetch(gatewayBaseUrl + path, {
      method,
      headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json", "X-Gymini-Listing-Flow": "3", "X-Gymini-Client": "web/abc123" },
      body: JSON.stringify({}),
    });
    assert.equal(withHeaders.status, 200, `${method} ${path}`);
    assert.equal(gymHits.length, 1, `${method} ${path}`);
    assert.equal(gymHits[0].flow, "3", `${method} ${path}: any integer value is forwarded untouched`);
    assert.equal(gymHits[0].client, "web/abc123", `${method} ${path}`);

    gymHits = [];
    const legacy = await fetch(gatewayBaseUrl + path, {
      method,
      headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json", "X-Gymini-Client": "mobile/1.0/42" },
      body: JSON.stringify({}),
    });
    assert.equal(legacy.status, 200);
    assert.equal(gymHits[0].flow, undefined, `${method} ${path}: no flow header is invented`);
    assert.equal(gymHits[0].client, "mobile/1.0/42");
  }
  assert.equal(userHits.length, 0, "these routes never go to user-service");
});
