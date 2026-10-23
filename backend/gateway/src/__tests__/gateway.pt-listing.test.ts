/**
 * Listing management, PT side (phase C2): /admin/listings/pts/* is admin-only at the gateway and forwarded to
 * user-service untouched; /media/pt-physique/:id is PUBLIC but read-only (GET/HEAD) - any other method is a 405 that
 * never reaches user-service.
 *
 * Same real-app + fake-downstream-server convention as gateway.profile-admin-rbac.test.ts: the actual
 * gateway Express app plus stub auth-service and user-service HTTP servers, real HTTP requests.
 * Evidence label: BACKEND INTEGRATION (gateway real, both downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4091";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4092";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-pt-listing-test";

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

  await new Promise<void>((resolve) => authServer.listen(4091, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(4092, "127.0.0.1", resolve));
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

const ADMIN_CALLS: Array<[string, string, unknown?]> = [
  ["GET", "/admin/listings/pts?status=PENDING&q=a&page=2"],
  ["GET", "/admin/listings/pts/revisions/rev-1"],
  ["GET", "/admin/listings/pts/revisions/rev-1/preview"],
  ["POST", "/admin/listings/pts/revisions/rev-1/approve", { note: "ok" }],
  ["POST", "/admin/listings/pts/revisions/rev-1/reject", { note: "no" }],
  ["POST", "/admin/listings/pts/revisions/rev-1/request-changes", { note: "fix" }],
  ["POST", "/admin/listings/pts/pt-9/direct-edit", { reason: "0123456789", expectedListingVersion: 1 }],
  ["POST", "/admin/listings/pts/pt-9/physique/ph-1/retire", { reason: "0123456789", purge: true }],
  ["GET", "/admin/listings/pts/pt-9/history"],
];

async function send(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    redirect: "manual",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("SECURITY: PT / CUSTOMER / GYM_OWNER tokens get 403 on every /admin/listings/pts route and never reach user-service", async () => {
  for (const token of ["pt-token", "customer-token", "owner-token"]) {
    for (const [method, path, body] of ADMIN_CALLS) {
      assert.equal((await send(method, path, token, body)).status, 403, `${method} ${path} as ${token}`);
    }
  }
  assert.equal(hits.length, 0);
});

test("no token is 401 on /admin/listings/pts", async () => {
  for (const [method, path, body] of ADMIN_CALLS) assert.equal((await send(method, path, null, body)).status, 401, `${method} ${path}`);
  assert.equal(hits.length, 0);
});

test("an ADMIN token is forwarded with the same path, query, JSON body and Authorization header", async () => {
  for (const [method, path, body] of ADMIN_CALLS) {
    hits = [];
    const res = await send(method, path, "admin-token", body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].method, method);
    assert.equal(hits[0].url, path);
    assert.equal(hits[0].authorization, "Bearer admin-token");
    if (body) assert.deepEqual(JSON.parse(hits[0].body), body);
  }
});

test("/media/pt-physique is public (no token needed) for GET and HEAD", async () => {
  hits = [];
  const res = await send("GET", "/media/pt-physique/photo-1", null);
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "/media/pt-physique/photo-1");
  assert.equal(hits[0].authorization, "", "no credentials are invented for an anonymous read");
  const head = await send("HEAD", "/media/pt-physique/photo-1", null);
  assert.equal(head.status, 200);
});

test("/media/pt-physique accepts reads only: POST / PUT / PATCH / DELETE are 405 and never reach user-service", async () => {
  hits = [];
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await send(method, "/media/pt-physique/photo-1", "admin-token", { a: 1 });
    assert.equal(res.status, 405, method);
  }
  assert.equal(hits.length, 0);
});
