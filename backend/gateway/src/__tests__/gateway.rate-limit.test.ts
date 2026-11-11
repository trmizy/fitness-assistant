/**
 * Gateway rate-limit split tests (scale hardening after S1):
 * - (a) Sensitive /auth/* endpoints (e.g. POST /auth/login) enforce authRateLimiter (20/15m) -> 21st returns 429.
 * - (b) Session lifecycle endpoints (/auth/verify, /auth/refresh, /auth/logout, PATCH /auth/me) are excluded from
 *       authRateLimiter so 30 requests in one burst are not rejected with 429.
 * - (c) 150x public image GET/HEAD reads (/media/pt-physique/*, /media/gym-photos/*, /uploads/profile-photos/*,
 *       /uploads/gym-photos/*) go through mediaRateLimiter (1000/60s), NOT the shared 100/60s rateLimiter, so
 *       subsequent GET /gyms succeeds (not 429).
 * - (d) Exceeding a low MEDIA_RATE_LIMIT_MAX_REQUESTS on GET /media/... returns 429.
 * - (f) PATCH /auth/me/password enforces authRateLimiter (21st -> 429).
 * - (g) /auth/login/ and /Auth/Login variants share the same authRateLimiter bucket.
 * - (e) Non-GET/HEAD requests under /media/* or /uploads/* (e.g. POST /media/..., POST /uploads/...) still count
 *       against the shared global rateLimiter.
 *
 * Evidence label: BACKEND INTEGRATION (real gateway Express app + stub HTTP downstreams).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_SECRET = "gateway-rate-limit-test-secret";
delete process.env.RATE_LIMIT_WINDOW_MS;
delete process.env.RATE_LIMIT_MAX_REQUESTS;
delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
delete process.env.AUTH_RATE_LIMIT_MAX_REQUESTS;
delete process.env.MEDIA_RATE_LIMIT_WINDOW_MS;
delete process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS;

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let gymServer: http.Server;
let userServer: http.Server;
let gatewayBaseUrl = "";

function listenEphemeral(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind ephemeral server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test.before(async () => {
  const authMock = await listenEphemeral((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const gymMock = await listenEphemeral((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ gyms: [] }));
  });
  const userMock = await listenEphemeral((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  authServer = authMock.server;
  gymServer = gymMock.server;
  userServer = userMock.server;

  process.env.AUTH_SERVICE_URL = authMock.url;
  process.env.GYM_SERVICE_URL = gymMock.url;
  process.env.USER_SERVICE_URL = userMock.url;

  ({ default: app } = await import("../app"));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const addr = gatewayServer.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind gateway server");
  gatewayBaseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  delete process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS;
  for (const s of [gatewayServer, authServer, gymServer, userServer]) {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
});

async function sendFromIp(ip: string, method: string, path: string, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    headers: {
      "X-Forwarded-For": ip,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined && method !== "GET" && method !== "HEAD" ? JSON.stringify(body) : undefined,
  });
}

test("(a) POST /auth/login enforces authRateLimiter (20 req/15m): 21st-25th return 429", async () => {
  const ip = "198.51.100.1";
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await sendFromIp(ip, "POST", "/auth/login", { email: "a@b.c", password: "x" });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
  assert.deepEqual(statuses.slice(20), Array(5).fill(429));
});

test("(b) 30x POST /auth/verify (and /auth/refresh, /auth/logout, PATCH /auth/me) are not 429 by authRateLimiter", async () => {
  const ip = "198.51.100.2";
  for (let i = 0; i < 30; i++) {
    const res = await sendFromIp(ip, "POST", "/auth/verify", { token: "t" });
    assert.equal(res.status, 200, `POST /auth/verify #${i + 1} expected 200, got ${res.status}`);
  }
  const ip2 = "198.51.100.3";
  for (let i = 0; i < 25; i++) {
    const refreshRes = await sendFromIp(ip2, "POST", "/auth/refresh", { refreshToken: "r" });
    assert.equal(refreshRes.status, 200);
    const logoutRes = await sendFromIp(ip2, "POST", "/auth/logout", {});
    assert.equal(logoutRes.status, 200);
    const meRes = await sendFromIp(ip2, "PATCH", "/auth/me", { firstName: "A" });
    assert.equal(meRes.status, 200);
  }
});

test("(c) 150x public image reads bypass global rateLimiter so subsequent API GET does not 429", async () => {
  const ip = "198.51.100.4";
  const imagePaths: Array<[string, string]> = [
    ["GET", "/media/pt-physique/photo-1"],
    ["GET", "/media/gym-photos/photo-2"],
    ["HEAD", "/uploads/profile-photos/avatar.webp"],
    ["GET", "/uploads/gym-photos/legacy.jpg"],
  ];
  for (let i = 0; i < 150; i++) {
    const [method, path] = imagePaths[i % imagePaths.length];
    const res = await sendFromIp(ip, method, path);
    assert.equal(res.status, 200, `${method} ${path} #${i + 1} expected 200, got ${res.status}`);
  }
  const apiRes = await sendFromIp(ip, "GET", "/gyms");
  assert.equal(apiRes.status, 200, "API route must not inherit media burst exhaustion");
});

test("(d) low MEDIA_RATE_LIMIT_MAX_REQUESTS throttles GET /media/... with 429", async () => {
  const ip = "198.51.100.5";
  process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS = "5";
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await sendFromIp(ip, "GET", "/media/gym-photos/photo-limit");
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    // Global API budget for the same IP remains untouched.
    const apiRes = await sendFromIp(ip, "GET", "/gyms");
    assert.equal(apiRes.status, 200);
  } finally {
    delete process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS;
  }
});

test("(e) non-GET/HEAD requests under /media/* and /uploads/* count against shared global rateLimiter", async () => {
  const ip = "198.51.100.6";
  for (let i = 0; i < 50; i++) {
    const mediaPost = await sendFromIp(ip, "POST", "/media/pt-physique/photo-1", { x: 1 });
    assert.equal(mediaPost.status, 405, `POST /media/pt-physique/photo-1 #${i + 1} should return 405 before budget runs out`);
    const uploadsPost = await sendFromIp(ip, "POST", "/uploads/profile-photos/avatar.webp", { x: 1 });
    assert.equal(uploadsPost.status, 200);
  }
  const overMediaPost = await sendFromIp(ip, "POST", "/media/pt-physique/photo-1", { x: 1 });
  assert.equal(overMediaPost.status, 429, "101st request via POST /media/* must hit global rateLimiter (429)");
  const overApiGet = await sendFromIp(ip, "GET", "/gyms");
  assert.equal(overApiGet.status, 429, "non-GET/HEAD media/uploads calls must consume the shared global bucket");
});

test("(f) PATCH /auth/me/password (change password: password-guessing surface) enforces authRateLimiter: 21st-25th return 429", async () => {
  const ip = "198.51.100.7";
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await sendFromIp(ip, "PATCH", "/auth/me/password", { currentPassword: "x", newPassword: "y" });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
  assert.deepEqual(statuses.slice(20), Array(5).fill(429));
});

test("(g) trailing slash and different case on sensitive auth paths are still limited (shared bucket per IP)", async () => {
  const ip = "198.51.100.8";
  const variants = ["/auth/login/", "/Auth/Login", "/AUTH/LOGIN/", "/auth/login"];
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await sendFromIp(ip, "POST", variants[i % variants.length], { email: "a@b.c", password: "x" });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
  assert.deepEqual(statuses.slice(20), Array(5).fill(429));
});
