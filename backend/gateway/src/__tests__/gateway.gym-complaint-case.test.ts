/**
 * Dispute V2.1 Slice 3 - the gateway forwards the gym complaint-case endpoints: /admin/complaint-cases/* for ADMIN only, /me/complaint-cases/* for
 * CUSTOMER / PT only. Real gateway app + stub auth/gym services (REAL HTTP/API for the gateway half, TEST FIXTURE downstream: no case logic runs here).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4041";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4042";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-gym-complaint-case-test";

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let gymServer: http.Server;
let base = "";
let seen: Array<{ method: string; url: string; userId?: string; role?: string }> = [];

const ROLE: Record<string, string> = { "admin-token": "ADMIN", "customer-token": "CUSTOMER", "pt-token": "PT", "owner-token": "GYM_OWNER" };

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (req.method === "POST" && req.url === "/auth/verify" && ROLE[token]) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: `${ROLE[token]}-1`, email: "u@example.com", role: ROLE[token] } }));
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired token" }));
    });
  });
  gymServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, userId: String(req.headers["x-user-id"] ?? ""), role: String(req.headers["x-user-role"] ?? "") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { from: "gym-service-stub" } }));
    });
  });
  await new Promise<void>((r) => authServer.listen(4041, "127.0.0.1", r));
  await new Promise<void>((r) => gymServer.listen(4042, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});
test.after(async () => {
  await new Promise<void>((r) => gatewayServer.close(() => r()));
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => gymServer.close(() => r()));
});

const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("admin case endpoints reach gym-service for an ADMIN with the verified identity headers", async () => {
  seen = [];
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [m, p] of [
    ["GET", "/admin/complaint-cases"],
    ["GET", "/admin/complaint-cases/capabilities"],
    ["GET", `/admin/complaint-cases/${id}`],
    ["GET", `/admin/complaint-cases/${id}/history`],
    ["POST", `/admin/complaint-cases/${id}/decision`],
    ["POST", `/admin/complaint-cases/${id}/execute`],
  ] as Array<[string, string]>) {
    const res = await call(m, p, "admin-token", m === "POST" ? {} : undefined);
    assert.equal(res.status, 200, `${m} ${p}`);
  }
  assert.equal(seen.length, 6);
  assert.ok(seen.every((s) => s.role === "ADMIN" || s.role === ""), "gym-service verifies the token itself; the gateway never lets a client-set role through");
});

test("admin case endpoints are refused for a customer, a PT, a gym owner and an anonymous caller", async () => {
  seen = [];
  assert.equal((await call("GET", "/admin/complaint-cases", "customer-token")).status, 403);
  assert.equal((await call("GET", "/admin/complaint-cases", "pt-token")).status, 403);
  assert.equal((await call("GET", "/admin/complaint-cases", "owner-token")).status, 403);
  assert.equal((await call("POST", "/admin/complaint-cases/x/execute", "customer-token", {})).status, 403);
  assert.equal((await call("GET", "/admin/complaint-cases")).status, 401);
  assert.equal(seen.length, 0, "nothing reached gym-service");
});

test("the member endpoints reach gym-service for CUSTOMER / PT and are refused for ADMIN, a gym owner and anonymous", async () => {
  seen = [];
  assert.equal((await call("GET", "/me/complaint-cases", "customer-token")).status, 200);
  assert.equal((await call("GET", "/me/complaint-cases/x", "pt-token")).status, 200);
  assert.equal((await call("POST", "/me/complaint-cases/x/statements", "customer-token", { text: "t" })).status, 200);
  assert.equal(seen.length, 3);
  assert.equal((await call("GET", "/me/complaint-cases", "admin-token")).status, 403);
  assert.equal((await call("GET", "/me/complaint-cases", "owner-token")).status, 403, "the Gym is not a party");
  assert.equal((await call("GET", "/me/complaint-cases")).status, 401);
  assert.equal(seen.length, 3);
});

test("C10: /owner/complaint-cases (the Gym's evidence + explanation surface) reaches gym-service only for GYM_OWNER; every other role and anonymous is refused", async () => {
  seen = [];
  assert.equal((await call("GET", "/owner/complaint-cases", "owner-token")).status, 200);
  assert.equal((await call("POST", "/owner/complaint-cases/x/explanations", "owner-token", { text: "t" })).status, 200);
  assert.equal(seen.length, 2);
  for (const t of ["customer-token", "pt-token", "admin-token"]) assert.equal((await call("GET", "/owner/complaint-cases", t)).status, 403, t);
  assert.equal((await call("GET", "/owner/complaint-cases")).status, 401);
  assert.equal(seen.length, 2, "nothing else reached gym-service");
});
