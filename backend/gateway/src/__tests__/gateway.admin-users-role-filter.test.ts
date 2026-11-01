/**
 * C1-09 / C1-10 — GET /admin/users forwards ?role= to auth-service (and passes its 400 for a bad value
 * through), and the gateway CORS config exposes the paging headers.
 * Real gateway app + stub auth/user services (REAL HTTP/API for the gateway half, TEST FIXTURE downstream).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4031";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4032";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-admin-users-role-test";

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let listUrls: string[] = [];

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/auth/verify") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: "admin-1", email: "a@example.com", role: "ADMIN" } }));
        return;
      }
      if (req.method === "GET" && (req.url || "").startsWith("/auth/users")) {
        listUrls.push(req.url!);
        if (/role=BOGUS/.test(req.url!)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bộ lọc role không hợp lệ", code: "INVALID_ROLE_FILTER" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: [{ id: "u1", email: "pt@example.com", firstName: "P", lastName: "T", role: "PT", isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => authServer.listen(4031, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  gatewayBaseUrl = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});

test.after(async () => {
  await new Promise<void>((r) => gatewayServer.close(() => r()));
  await new Promise<void>((r) => authServer.close(() => r()));
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${gatewayBaseUrl}${path}`, { headers: { Authorization: "Bearer admin-token", ...headers } });

test("?role=PT is forwarded to auth-service", async () => {
  listUrls = [];
  const res = await get("/admin/users?role=PT");
  assert.equal(res.status, 200);
  assert.equal(listUrls[0], "/auth/users?role=PT");
});

test("no role: auth-service is called without a filter, as before", async () => {
  listUrls = [];
  assert.equal((await get("/admin/users")).status, 200);
  assert.equal(listUrls[0], "/auth/users");
});

test("an invalid role is a 400 with auth-service's code, not a silent empty list", async () => {
  const res = await get("/admin/users?role=BOGUS");
  assert.equal(res.status, 400);
  const body: any = await res.json();
  assert.equal(body.error.code, "INVALID_ROLE_FILTER");
});

test("CORS exposes X-Total-Count, X-Page and X-Limit to an allowed origin", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/users`, {
    headers: { Origin: "http://localhost:5173", Authorization: "Bearer admin-token" },
  });
  const exposed = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
  for (const h of ["x-total-count", "x-page", "x-limit"]) assert.ok(exposed.includes(h), h);
});
