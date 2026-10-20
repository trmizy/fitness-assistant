/**
 * Listing management, gym side (phase B2): the gateway forwards the branch listing / amenity routes to gym-service and
 * gates them by role.
 *   - /admin/listings/gyms/* and /admin/amenities/*  -> ADMIN only (403 for everybody else, 401 without a token);
 *   - /owner/amenities/*                              -> GYM_OWNER only;
 *   - /owner/gyms/:id/listing/* (already covered by the /owner/gyms prefix) reaches gym-service untouched;
 *   - /admin/listings/pts keeps going to user-service (the new prefixes did not hijack it).
 *
 * Same real-app + fake-downstream-server convention as gateway.pt-listing.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real, the downstream services are TEST FIXTURES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
// this file makes ~150 requests: lift the gateway-wide 100/min limiter (read when the app module loads)
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4081";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4082";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4083";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-gym-listing-test";

let app: any;
let gatewayServer: http.Server;
let gymServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let gymHits: Array<{ method: string; url: string; body: string; authorization: string }> = [];
let userHits: string[] = [];

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
  gymServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      gymHits.push({ method: String(req.method), url: String(req.url), body: Buffer.concat(chunks).toString("utf8"), authorization: String(req.headers.authorization || "") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  userServer = http.createServer((req, res) => {
    userHits.push(String(req.url));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });

  await new Promise<void>((resolve) => authServer.listen(4081, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => gymServer.listen(4082, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => userServer.listen(4083, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  gymHits = [];
  userHits = [];
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => gymServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => userServer.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
});

const ADMIN_CALLS: Array<[string, string, unknown?]> = [
  ["GET", "/admin/listings/gyms?status=PENDING&brandId=b1&gymId=g1&q=a&page=2"],
  ["GET", "/admin/listings/gyms/revisions/rev-1"],
  ["GET", "/admin/listings/gyms/revisions/rev-1/preview"],
  ["POST", "/admin/listings/gyms/revisions/rev-1/approve", { note: "ok", dropDisabledAmenities: true }],
  ["POST", "/admin/listings/gyms/revisions/rev-1/reject", { note: "no" }],
  ["POST", "/admin/listings/gyms/revisions/rev-1/request-changes", { note: "fix" }],
  ["POST", "/admin/listings/gyms/gym-9/direct-edit", { reason: "0123456789", expectedListingVersion: 1 }],
  ["POST", "/admin/listings/gyms/gym-9/photos/presign", { contentType: "image/png" }],
  ["POST", "/admin/listings/gyms/gym-9/photos/confirm", { uploadId: "u-1" }],
  ["POST", "/admin/listings/gyms/gym-9/photos/ph-1/retire", { reason: "0123456789", purge: true }],
  ["GET", "/admin/listings/gyms/gym-9/history"],
  ["GET", "/admin/amenities?status=ACTIVE"],
  ["POST", "/admin/amenities", { name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "dumbbell" }],
  ["PATCH", "/admin/amenities/am-1", { status: "DISABLED" }],
  ["GET", "/admin/amenities/proposals"],
  ["POST", "/admin/amenities/proposals/approve", { proposalIds: ["p-1"] }],
  ["POST", "/admin/amenities/proposals/reject", { proposalIds: ["p-1"], reason: "no" }],
  ["POST", "/admin/amenities/proposals/merge", { proposalIds: ["p-1"], targetAmenityId: "am-1" }],
  ["GET", "/admin/amenities/am-1/history"],
];

const OWNER_CALLS: Array<[string, string, unknown?]> = [
  ["GET", "/owner/amenities"],
  ["POST", "/owner/amenities/proposals", { gymId: "g-1", name: "Phòng boxing", suggestedCategory: "TRAINING_ZONE" }],
  ["PATCH", "/owner/amenities/proposals/p-1", { note: "x" }],
  ["DELETE", "/owner/amenities/proposals/p-1"],
];

// already covered by the /owner/gyms prefix: this proves the new sub-paths pass through it
const OWNER_LISTING_CALLS: Array<[string, string, unknown?]> = [
  ["GET", "/owner/gyms/g-1/listing"],
  ["POST", "/owner/gyms/g-1/listing/draft", { copyFromRevisionId: "r-1" }],
  ["PUT", "/owner/gyms/g-1/listing/draft", { expectedDraftVersion: 1, payload: { description: null } }],
  ["POST", "/owner/gyms/g-1/listing/submit", { expectedDraftVersion: 2 }],
  ["POST", "/owner/gyms/g-1/listing/withdraw", {}],
  ["POST", "/owner/gyms/g-1/listing/discard", {}],
  ["POST", "/owner/gyms/g-1/listing/rebase", {}],
  ["GET", "/owner/gyms/g-1/listing/preview"],
  ["POST", "/owner/gyms/g-1/listing/photos/presign", { contentType: "image/jpeg" }],
  ["POST", "/owner/gyms/g-1/listing/photos/confirm", { uploadId: "u-1" }],
  ["DELETE", "/owner/gyms/g-1/listing/photos/ph-1"],
];

async function send(method: string, path: string, token: string | null, body?: unknown) {
  return fetch(gatewayBaseUrl + path, {
    method,
    redirect: "manual",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test("SECURITY: PT / CUSTOMER / GYM_OWNER tokens get 403 on every /admin/listings/gyms and /admin/amenities route and never reach gym-service", async () => {
  for (const token of ["pt-token", "customer-token", "owner-token"]) {
    for (const [method, path, body] of ADMIN_CALLS) {
      assert.equal((await send(method, path, token, body)).status, 403, `${method} ${path} as ${token}`);
    }
  }
  assert.equal(gymHits.length, 0);
});

test("no token is 401 on the admin listing / amenity routes and on /owner/amenities", async () => {
  for (const [method, path, body] of [...ADMIN_CALLS, ...OWNER_CALLS]) assert.equal((await send(method, path, null, body)).status, 401, `${method} ${path}`);
  assert.equal(gymHits.length, 0);
});

test("an ADMIN token is forwarded to gym-service with the same path, query, JSON body and Authorization header", async () => {
  for (const [method, path, body] of ADMIN_CALLS) {
    gymHits = [];
    const res = await send(method, path, "admin-token", body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(gymHits.length, 1, `${method} ${path} reached gym-service once`);
    assert.equal(gymHits[0].method, method);
    assert.equal(gymHits[0].url, path);
    assert.equal(gymHits[0].authorization, "Bearer admin-token");
    if (body) assert.deepEqual(JSON.parse(gymHits[0].body), body);
  }
  assert.deepEqual(userHits, [], "user-service was never involved");
});

test("/owner/amenities/* is GYM_OWNER only: ADMIN / CUSTOMER / PT get 403, a GYM_OWNER is forwarded", async () => {
  for (const token of ["admin-token", "customer-token", "pt-token"]) {
    for (const [method, path, body] of OWNER_CALLS) {
      assert.equal((await send(method, path, token, body)).status, 403, `${method} ${path} as ${token}`);
    }
  }
  assert.equal(gymHits.length, 0);
  for (const [method, path, body] of OWNER_CALLS) {
    gymHits = [];
    const res = await send(method, path, "owner-token", body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(gymHits.length, 1);
    assert.equal(gymHits[0].url, path);
    assert.equal(gymHits[0].authorization, "Bearer owner-token");
    if (body) assert.deepEqual(JSON.parse(gymHits[0].body), body);
  }
});

test("/owner/gyms/:id/listing/* passes the existing /owner/gyms proxy (GYM_OWNER) and is refused to a CUSTOMER", async () => {
  for (const [method, path, body] of OWNER_LISTING_CALLS) {
    gymHits = [];
    const res = await send(method, path, "owner-token", body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(gymHits.length, 1);
    assert.equal(gymHits[0].method, method);
    assert.equal(gymHits[0].url, path);
    const denied = await send(method, path, "customer-token", body);
    assert.equal(denied.status, 403, `${method} ${path} as customer`);
  }
});

test("/admin/listings/pts still goes to user-service, not gym-service", async () => {
  const res = await send("GET", "/admin/listings/pts?status=PENDING", "admin-token");
  assert.equal(res.status, 200);
  assert.deepEqual(userHits, ["/admin/listings/pts?status=PENDING"]);
  assert.equal(gymHits.length, 0);
});
