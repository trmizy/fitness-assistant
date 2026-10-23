/**
 * /admin/pts/* (temporary PT suspension: suspend / lift / history / list / justify) is admin-only at the
 * gateway and is forwarded to user-service untouched (path and JSON body), which re-checks ADMIN itself
 * and takes the acting admin from the verified token.
 *
 * Same real-app + fake-downstream-server convention as gateway.profile-admin-rbac.test.ts: the actual
 * gateway Express app plus stub auth-service and user-service HTTP servers, real HTTP requests.
 * Evidence label: BACKEND INTEGRATION (gateway real, both downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4031";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4032";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-admin-pt-restrictions-test";

let app: any;
let gatewayServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let hits: Array<{ method: string; url: string; body: string; authorization: string }> = [];

const ROLE_OF_TOKEN: Record<string, string> = {
  "admin-token": "ADMIN",
  "pt-token": "PT",
  "customer-token": "CUSTOMER",
  "owner-token": "GYM_OWNER",
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

  userServer = http.createServer((req, res) => {
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

  await new Promise<void>((resolve) => authServer.listen(4031, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(4032, "127.0.0.1", resolve));
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
  await new Promise<void>((resolve, reject) => userServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

const CALLS: Array<[string, string, unknown?]> = [
  ["POST", "/admin/pts/pt-9/suspend", { category: "OTHER", reason: "x" }],
  ["POST", "/admin/pts/pt-9/lift-suspension", { reason: "x" }],
  ["POST", "/admin/pts/pt-9/restrictions/justify", { reason: "x" }],
  ["GET", "/admin/pts/pt-9/restrictions"],
  ["GET", "/admin/pts/suspended?overdue=true"],
];

async function send(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("SECURITY: a PT, a CUSTOMER and a GYM_OWNER token are rejected with 403 on every /admin/pts route and never reach user-service", async () => {
  for (const token of ["pt-token", "customer-token", "owner-token"]) {
    for (const [method, path, body] of CALLS) {
      const res = await send(method, path, token, body);
      assert.equal(res.status, 403, `${method} ${path} as ${token}`);
    }
  }
  assert.equal(hits.length, 0, "user-service must never be called for a non-admin caller");
});

test("no token is rejected with 401 before any role check", async () => {
  for (const [method, path, body] of CALLS) {
    assert.equal((await send(method, path, null, body)).status, 401, `${method} ${path}`);
  }
  assert.equal(hits.length, 0);
});

test("an ADMIN token is forwarded to user-service with the same path, JSON body and Authorization header", async () => {
  for (const [method, path, body] of CALLS) {
    hits = [];
    const res = await send(method, path, "admin-token", body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].method, method);
    assert.equal(hits[0].url, path);
    assert.equal(hits[0].authorization, "Bearer admin-token", "user-service verifies the same token itself");
    if (body) assert.deepEqual(JSON.parse(hits[0].body), body);
  }
});
