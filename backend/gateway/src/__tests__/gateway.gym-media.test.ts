/**
 * Listing management, gym side (phase B1): /media/gym-photos/:id is PUBLIC but read-only (GET/HEAD) and goes to
 * gym-service; any other method is a 405 that never reaches it. The legacy /uploads/gym-photos route (now a checked
 * route in gym-service instead of express.static) must still reach gym-service, not user-service.
 *
 * Same real-app + fake-downstream-server convention as gateway.pt-listing.test.ts: the actual gateway Express app plus
 * stub auth-service and gym-service HTTP servers, real HTTP requests.
 * Evidence label: BACKEND INTEGRATION (gateway real, both downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4051";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4052";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4053";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-gym-media-test";

let app: any;
let gatewayServer: http.Server;
let gymServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let gymHits: Array<{ method: string; url: string; authorization: string }> = [];
let userHits = 0;

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((_req, res) => {
    res.statusCode = 401;
    res.end();
  });
  gymServer = http.createServer((req, res) => {
    gymHits.push({ method: String(req.method), url: String(req.url), authorization: String(req.headers.authorization || "") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  userServer = http.createServer((_req, res) => {
    userHits += 1;
    res.statusCode = 200;
    res.end("{}");
  });

  await new Promise<void>((resolve) => authServer.listen(4051, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => gymServer.listen(4052, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(4053, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  gymHits = [];
  userHits = 0;
});

test.after(async () => {
  for (const s of [gatewayServer, gymServer, userServer, authServer]) {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
});

async function send(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    redirect: "manual",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("/media/gym-photos is public (no token) for GET and HEAD, and is forwarded to gym-service with the same path", async () => {
  const res = await send("GET", "/media/gym-photos/photo-1", null);
  assert.equal(res.status, 200);
  assert.equal(gymHits.length, 1);
  assert.equal(gymHits[0].url, "/media/gym-photos/photo-1");
  assert.equal(gymHits[0].authorization, "", "no credentials are invented for an anonymous read");
  const head = await send("HEAD", "/media/gym-photos/photo-1", null);
  assert.equal(head.status, 200);
  assert.equal(userHits, 0, "never user-service");
});

test("/media/gym-photos accepts reads only: POST / PUT / PATCH / DELETE are 405 (Allow: GET, HEAD) and never reach gym-service", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await send(method, "/media/gym-photos/photo-1", "any-token", { a: 1 });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
  assert.equal(gymHits.length, 0);
});

test("the legacy /uploads/gym-photos/:file route still reaches gym-service (the checked route), not user-service", async () => {
  const res = await send("GET", "/uploads/gym-photos/123-456.jpg", null);
  assert.equal(res.status, 200);
  assert.equal(gymHits.length, 1);
  assert.equal(gymHits[0].url, "/uploads/gym-photos/123-456.jpg");
  assert.equal(userHits, 0);
});
