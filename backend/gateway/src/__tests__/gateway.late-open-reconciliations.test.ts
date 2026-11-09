/**
 * /admin/late-open-reconciliations (late-open D77 reconciliation) is admin-only at the gateway and is forwarded to user-service untouched (path, query, JSON body,
 * Authorization). The service stays fail-closed by its own flag; this suite only proves the gateway route exists and gates by role. It also proves the CORS
 * `Idempotent-Replay` response header is exposed to browsers.
 *
 * Same real-app + fake-downstream-server convention as gateway.admin-pt-restrictions.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real, both downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4041";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4042";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-late-open-test";

let app: any;
let gatewayServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let base = "";
let hits: Array<{ method: string; url: string; body: string; authorization: string }> = [];

const ROLE_OF_TOKEN: Record<string, string> = { "admin-token": "ADMIN", "pt-token": "PT", "customer-token": "CUSTOMER", "owner-token": "GYM_OWNER" };

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const role = ROLE_OF_TOKEN[String(req.headers.authorization || "").replace("Bearer ", "")];
      if (!role) return void res.writeHead(401).end();
      res.writeHead(200, { "Content-Type": "application/json" });
      return void res.end(JSON.stringify({ user: { id: `${role.toLowerCase()}-1`, email: `${role}@example.com`, role } }));
    }
    res.writeHead(404).end();
  });
  userServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ method: String(req.method), url: String(req.url), body: Buffer.concat(chunks).toString("utf8"), authorization: String(req.headers.authorization || "") });
      res.writeHead(200, { "Content-Type": "application/json", "Idempotent-Replay": "true" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => authServer.listen(4041, "127.0.0.1", r));
  await new Promise<void>((r) => userServer.listen(4042, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});
test.beforeEach(() => {
  hits = [];
});
test.after(async () => {
  for (const s of [gatewayServer, userServer, authServer]) await new Promise<void>((r) => s.close(() => r()));
});

const CALLS: Array<[string, string, unknown?]> = [
  ["GET", "/admin/late-open-reconciliations?limit=5"],
  ["GET", "/admin/late-open-reconciliations/11111111-1111-4111-8111-111111111111"],
  ["POST", "/admin/late-open-reconciliations/11111111-1111-4111-8111-111111111111/claim", { }],
  ["POST", "/admin/late-open-reconciliations/11111111-1111-4111-8111-111111111111/proposals", { reason: "x" }],
  ["POST", "/admin/late-open-reconciliations/proposals/22222222-2222-4222-8222-222222222222/approve", { reason: "x", conflictOfInterestDeclaredNone: true }],
];
const send = (method: string, path: string, token: string | null, body?: unknown) =>
  fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

test("SECURITY: PT, CUSTOMER and GYM_OWNER tokens get 403 and never reach user-service; no token gets 401", async () => {
  for (const token of ["pt-token", "customer-token", "owner-token"]) {
    for (const [m, p, b] of CALLS) assert.equal((await send(m, p, token, b)).status, 403, `${m} ${p} as ${token}`);
  }
  for (const [m, p, b] of CALLS) assert.equal((await send(m, p, null, b)).status, 401, `${m} ${p} anonymous`);
  assert.equal(hits.length, 0);
});

test("an ADMIN token is forwarded with the same method, path+query, body and Authorization (no 404 any more)", async () => {
  for (const [m, p, b] of CALLS) {
    hits = [];
    const res = await send(m, p, "admin-token", b);
    assert.equal(res.status, 200, `${m} ${p}`);
    assert.equal(hits.length, 1);
    assert.deepEqual([hits[0].method, hits[0].url, hits[0].authorization], [m, p, "Bearer admin-token"]);
    if (b) assert.deepEqual(JSON.parse(hits[0].body), b);
  }
});

test("CORS: Idempotent-Replay is listed in Access-Control-Expose-Headers", async () => {
  const origin = process.env.CORS_TEST_ORIGIN || "http://localhost:3000";
  const res = await fetch(base + "/admin/late-open-reconciliations", { headers: { Authorization: "Bearer admin-token", Origin: origin } });
  const exposed = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
  if (res.headers.get("access-control-allow-origin")) assert.ok(exposed.split(",").map((h) => h.trim()).includes("idempotent-replay"), exposed);
  else {
    // origin not allowed in this environment: ask with a preflight-free allowed origin via the default list
    assert.fail(`origin ${origin} was not allowed by CORS; cannot check the exposed headers (${exposed})`);
  }
});
