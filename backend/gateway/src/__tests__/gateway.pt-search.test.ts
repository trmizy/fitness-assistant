/**
 * Gateway PT search route & privacy integration suite (D0b-2).
 *
 * Proves:
 * - POST /profile/pts/search requires a valid token (401 when absent).
 * - Authenticated POST /profile/pts/search streams to user-service at exact path /profile/pts/search
 *   with JSON body intact and identity headers injected (never misrouted as :userId = "search").
 * - GET /profile/pts and GET /profile/pts/:userId keep forwarding unchanged.
 * - Real gateway stdout/stderr logs emit 0 occurrences of viewer GPS coordinates from request body
 *   across normal 200 requests and downstream/4xx error responses.
 *
 * Evidence label: BACKEND INTEGRATION (real gateway Express app + TEST FIXTURE auth/user downstreams).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-pt-search-test";

let app: any;
let gatewayServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let userHits: Array<{
  method: string;
  url: string;
  body: string;
  userId: string;
  role: string;
  gatewaySecret: string;
}> = [];
let nextDownstreamStatus = 200;

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const token = String(req.headers.authorization || "").replace("Bearer ", "");
      if (token === "customer-token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: "cust-gw-1", email: "c@example.com", role: "CUSTOMER" } }));
        return;
      }
      res.statusCode = 401;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  userServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      userHits.push({
        method: String(req.method),
        url: String(req.url),
        body: Buffer.concat(chunks).toString("utf8"),
        userId: String(req.headers["x-user-id"] || ""),
        role: String(req.headers["x-user-role"] || ""),
        gatewaySecret: String(req.headers["x-gateway-secret"] || ""),
      });
      res.writeHead(nextDownstreamStatus, { "Content-Type": "application/json" });
      if (nextDownstreamStatus >= 400) {
        res.end(JSON.stringify({ error: "Downstream error", code: "TEST_ERR" }));
      } else {
        res.end(JSON.stringify({ pts: [], nextCursor: null, hasMore: false, appliedScope: "near" }));
      }
    });
  });

  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(0, "127.0.0.1", resolve));

  const authAddr = authServer.address();
  const userAddr = userServer.address();
  if (!authAddr || typeof authAddr === "string" || !userAddr || typeof userAddr === "string") {
    throw new Error("Failed to bind fixture servers");
  }
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${authAddr.port}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${userAddr.port}`;

  ({ default: app } = await import("../app"));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const gwAddr = gatewayServer.address();
  if (!gwAddr || typeof gwAddr === "string") throw new Error("Failed to bind gateway server");
  gatewayBaseUrl = `http://127.0.0.1:${gwAddr.port}`;
});

test.beforeEach(() => {
  userHits = [];
  nextDownstreamStatus = 200;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => userServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

test("POST /profile/pts/search without token returns 401 and never hits user-service", async () => {
  const res = await fetch(`${gatewayBaseUrl}/profile/pts/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 10.776, lng: 106.701, scope: "near", radiusKm: 10 }),
  });
  assert.equal(res.status, 401);
  assert.equal(userHits.length, 0);
});

test("POST /profile/pts/search with token forwards exact path, method, headers, and GPS body cleanly", async () => {
  const payload = {
    lat: 10.776,
    lng: 106.701,
    radiusKm: 15,
    scope: "near",
    mode: "ANY",
    limit: 20,
  };
  const res = await fetch(`${gatewayBaseUrl}/profile/pts/search`, {
    method: "POST",
    headers: {
      Authorization: "Bearer customer-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.appliedScope, "near");

  assert.equal(userHits.length, 1);
  assert.equal(userHits[0].method, "POST");
  assert.equal(userHits[0].url, "/profile/pts/search");
  assert.equal(userHits[0].userId, "cust-gw-1");
  assert.equal(userHits[0].role, "CUSTOMER");
  assert.equal(userHits[0].gatewaySecret, "gateway-secret-pt-search-test");
  assert.deepEqual(JSON.parse(userHits[0].body), payload);
});

test("GET /profile/pts and GET /profile/pts/:userId still proxy untouched", async () => {
  const r1 = await fetch(`${gatewayBaseUrl}/profile/pts?q=minh`, {
    headers: { Authorization: "Bearer customer-token" },
  });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${gatewayBaseUrl}/profile/pts/search`, {
    headers: { Authorization: "Bearer customer-token" },
  });
  assert.equal(r2.status, 200);
  assert.deepEqual(
    userHits.map((h) => `${h.method} ${h.url}`),
    ["GET /profile/pts?q=minh", "GET /profile/pts/search"],
  );
});

test("Privacy: gateway stdout/stderr logs contain zero GPS coordinates during 200 and error POST /profile/pts/search calls", () => {
  const secretLat = "16.43912";
  const secretLng = "107.58923";
  const gatewayRoot = path.resolve(__dirname, "../..");
  const childScript = `
    import http from "node:http";
    process.env.NODE_ENV = "test";
    process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
    process.env.INTERNAL_SERVICE_SECRET = "gateway-privacy-probe-secret";
    const auth = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: "u1", email: "u1@example.com", role: "CUSTOMER" } }));
    });
    let code = 200;
    const user = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: code >= 400 ? "fail" : undefined, pts: [], hasMore: false, appliedScope: "near", nextCursor: null }));
      });
    });
    await new Promise((r) => auth.listen(0, "127.0.0.1", r));
    await new Promise((r) => user.listen(0, "127.0.0.1", r));
    process.env.AUTH_SERVICE_URL = "http://127.0.0.1:" + auth.address().port;
    process.env.USER_SERVICE_URL = "http://127.0.0.1:" + user.address().port;
    const appMod = await import("./src/app.ts");
    const gwApp = appMod.default?.default ?? appMod.default;
    const gw = http.createServer(gwApp);
    await new Promise((r) => gw.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + gw.address().port + "/profile/pts/search";
    await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ lat: ${secretLat}, lng: ${secretLng}, radiusKm: 10 }),
    });
    code = 500;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ lat: ${secretLat}, lng: ${secretLng}, radiusKm: 10 }),
    });
    // Force gateway error handler too (broken upstream proxy socket or invalid header path)
    await fetch("http://127.0.0.1:" + gw.address().port + "/missing-path-for-404");
    await new Promise((r) => gw.close(r));
    await new Promise((r) => user.close(r));
    await new Promise((r) => auth.close(r));
    setTimeout(() => process.exit(0), 50);
  `;

  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module"], {
    cwd: gatewayRoot,
    input: childScript,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `gateway privacy probe failed: status=${run.status} err=${run.stderr}`);
  const combinedLogs = `${run.stdout}\n${run.stderr}`;
  assert.ok(combinedLogs.includes("/profile/pts/search"), "sanity: request log actually recorded the route");
  assert.equal(combinedLogs.includes("16.439"), false, "lat must never appear in gateway logs");
  assert.equal(combinedLogs.includes("107.589"), false, "lng must never appear in gateway logs");
});
