/**
 * Phase 2 (D16/D17/D70) PT QR check-in routing at the gateway:
 *  - POST /me/pt-gym-checkins is PT-only and is forwarded to gym-service untouched (path, JSON body, Authorization);
 *  - the member route /me/gym-checkins keeps accepting CUSTOMER and PT (unchanged);
 *  - GET /owner/gyms/:gymId/pt-checkins rides the existing GYM_OWNER-only /owner/gyms proxy.
 *
 * Same real-app + fake-downstream-server convention as gateway.admin-pt-restrictions.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real, auth-service and gym-service are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4041";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4042";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-pt-gym-checkins-test";

let app: any;
let gatewayServer: http.Server;
let gymServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let hits: Array<{ method: string; url: string; body: string; authorization: string }> = [];

const ROLE_OF_TOKEN: Record<string, string> = {
  "pt-token": "PT",
  "customer-token": "CUSTOMER",
  "owner-token": "GYM_OWNER",
  "admin-token": "ADMIN",
};

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const token = String(req.headers.authorization || "").replace("Bearer ", "");
      const role = ROLE_OF_TOKEN[token];
      if (!role) {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: `${role.toLowerCase()}-1`, email: `${role}@example.com`, role } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  gymServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({
        method: String(req.method),
        url: String(req.url),
        body: Buffer.concat(chunks).toString("utf8"),
        authorization: String(req.headers.authorization || ""),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => authServer.listen(4041, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => gymServer.listen(4042, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  hits = [];
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => gymServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

async function send(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("POST /me/pt-gym-checkins: no token -> 401, never reaches gym-service", async () => {
  assert.equal((await send("POST", "/me/pt-gym-checkins", null, { token: "t" })).status, 401);
  assert.equal(hits.length, 0);
});

test("SECURITY: CUSTOMER, GYM_OWNER and ADMIN are rejected with 403 on /me/pt-gym-checkins and never reach gym-service", async () => {
  for (const token of ["customer-token", "owner-token", "admin-token"]) {
    const res = await send("POST", "/me/pt-gym-checkins", token, { token: "qr" });
    assert.equal(res.status, 403, `as ${token}`);
  }
  assert.equal(hits.length, 0);
});

test("a PT token is forwarded to gym-service with the same path, JSON body and Authorization header", async () => {
  const res = await send("POST", "/me/pt-gym-checkins", "pt-token", { token: "qr-token-123" });
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "POST");
  assert.equal(hits[0].url, "/me/pt-gym-checkins");
  assert.deepEqual(JSON.parse(hits[0].body), { token: "qr-token-123" });
  assert.equal(hits[0].authorization, "Bearer pt-token");
});

test("the member route /me/gym-checkins is unchanged: CUSTOMER and PT pass, GYM_OWNER is rejected", async () => {
  assert.equal((await send("POST", "/me/gym-checkins", "customer-token", { token: "qr" })).status, 200);
  assert.equal((await send("POST", "/me/gym-checkins", "pt-token", { token: "qr" })).status, 200);
  assert.equal((await send("POST", "/me/gym-checkins", "owner-token", { token: "qr" })).status, 403);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.url === "/me/gym-checkins"));
});

test("GET /owner/gyms/:gymId/pt-checkins is GYM_OWNER-only and forwarded (query kept) by the /owner/gyms proxy", async () => {
  for (const token of ["pt-token", "customer-token"]) {
    assert.equal((await send("GET", "/owner/gyms/g-1/pt-checkins", token)).status, 403, token);
  }
  assert.equal((await send("GET", "/owner/gyms/g-1/pt-checkins", null)).status, 401);
  assert.equal(hits.length, 0);

  const res = await send("GET", "/owner/gyms/g-1/pt-checkins?limit=20", "owner-token");
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "GET");
  assert.equal(hits[0].url, "/owner/gyms/g-1/pt-checkins?limit=20");
  assert.equal(hits[0].authorization, "Bearer owner-token");
});
