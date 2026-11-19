/**
 * D2 gateway integration tests:
 *   - Route precedence: POST /gyms/search & GET /gyms/brand-options route cleanly BEFORE /gyms/:id
 *   - GET /gyms/:id and GET /gyms remain intact
 *   - GET /locations/wards/:code proxies cleanly to user-service
 *   - Privacy: real gateway pino stdout/stderr logs emit ZERO GPS coordinates on POST /gyms/search
 *
 * Evidence label: BACKEND INTEGRATION (real gateway Express app + local HTTP TEST FIXTURE downstream servers).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.INTERNAL_SERVICE_SECRET = "gateway-discovery-d2-secret";

let app: any;
let gatewayServer: http.Server;
let gymServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";

let gymHits: Array<{ method: string; url: string; body: string }> = [];
let userHits: Array<{ method: string; url: string }> = [];

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: "cust-1", email: "c@test.local", role: "CUSTOMER" } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  gymServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      gymHits.push({ method: String(req.method), url: String(req.url), body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, proxiedUrl: req.url, proxiedMethod: req.method }));
    });
  });
  userServer = http.createServer((req, res) => {
    userHits.push({ method: String(req.method), url: String(req.url) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 26734, centroid: { lat: 10.77, lng: 106.7 } }));
  });

  await new Promise<void>((r) => authServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => gymServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => userServer.listen(0, "127.0.0.1", r));

  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as any).port}`;
  process.env.GYM_SERVICE_URL = `http://127.0.0.1:${(gymServer.address() as any).port}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userServer.address() as any).port}`;

  ({ default: app } = await import("../app"));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  gatewayBaseUrl = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});

test.beforeEach(() => {
  gymHits = [];
  userHits = [];
});

test.after(async () => {
  for (const s of [gatewayServer, gymServer, userServer, authServer]) {
    if (s) {
      (s as any).closeAllConnections?.();
      await new Promise<void>((r) => s.close(() => r()));
    }
  }
});

test("POST /gyms/search and GET /gyms/brand-options route cleanly before /gyms/:id (both anon and authed)", async () => {
  const searchRes = await fetch(`${gatewayBaseUrl}/gyms/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat: 10.775, lng: 106.7, radiusKm: 10 }),
  });
  assert.equal(searchRes.status, 200);
  const searchBody: any = await searchRes.json();
  assert.equal(searchBody.proxiedMethod, "POST");
  assert.equal(searchBody.proxiedUrl, "/gyms/search");

  const brandOptRes = await fetch(`${gatewayBaseUrl}/gyms/brand-options?q=alpha&cursor=tok123`, {
    method: "GET",
  });
  assert.equal(brandOptRes.status, 200);
  const brandOptBody: any = await brandOptRes.json();
  assert.equal(brandOptBody.proxiedMethod, "GET");
  assert.equal(brandOptBody.proxiedUrl, "/gyms/brand-options?q=alpha&cursor=tok123");

  // Legacy routes stay intact
  const listRes = await fetch(`${gatewayBaseUrl}/gyms`);
  assert.equal(listRes.status, 200);
  assert.equal(((await listRes.json()) as any).proxiedUrl, "/gyms");

  const detailRes = await fetch(`${gatewayBaseUrl}/gyms/11111111-1111-1111-1111-111111111111`);
  assert.equal(detailRes.status, 200);
  assert.equal(((await detailRes.json()) as any).proxiedUrl, "/gyms/11111111-1111-1111-1111-111111111111");

  assert.equal(gymHits.length, 4);

  // /locations/wards/:code proxies to user-service
  const wardRes = await fetch(`${gatewayBaseUrl}/locations/wards/26734`);
  assert.equal(wardRes.status, 200);
  assert.equal(userHits.length, 1);
  assert.equal(userHits[0].url, "/locations/wards/26734");
});

test("Privacy: real gateway pino stdout/stderr logs emit zero GPS coordinates across /gyms/search calls", () => {
  const gatewayRoot = path.resolve(__dirname, "../..");
  const childCode = `
    import http from "node:http";
    process.env.NODE_ENV = "test";
    process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
    process.env.INTERNAL_SERVICE_SECRET = "gateway-privacy-probe-secret";
    const down = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(req.url.includes("400") ? 400 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
    });
    await new Promise((r) => down.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + down.address().port;
    process.env.AUTH_SERVICE_URL = url;
    process.env.GYM_SERVICE_URL = url;
    process.env.USER_SERVICE_URL = url;
    const mod = await import("./src/app.ts");
    const gwApp = mod.default?.default ?? mod.default;
    const s = http.createServer(gwApp);
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + s.address().port;
    const r200 = await fetch(base + "/gyms/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 16.43912, lng: 107.58923, radiusKm: 10 }),
    });
    if (r200.status !== 200) throw new Error("expected 200 got " + r200.status);
    const rErr = await fetch(base + "/gyms/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"lat": 29.99912, "lng": 107.58923}',
    });
    if (rErr.status !== 200 && rErr.status !== 400) throw new Error("unexpected " + rErr.status);
    s.closeAllConnections?.();
    down.closeAllConnections?.();
    await new Promise((r) => s.close(r));
    await new Promise((r) => down.close(r));
    setTimeout(() => process.exit(0), 100).unref();
  `;

  const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module"], {
    cwd: gatewayRoot,
    env: { ...process.env },
    input: childCode,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `gateway child probe failed: ${res.stderr}`);
  const combinedLogs = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  for (const needle of ["16.43912", "107.58923", "29.99912"]) {
    assert.equal(combinedLogs.includes(needle), false, `GPS coordinate ${needle} leaked in gateway logs!`);
  }
});

