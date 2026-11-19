/**
 * FIX5-ADMIN-PERF — GET /admin/users with page / limit: the gateway no longer pulls and maps every account.
 * It forwards the filters to auth-service (one paged query), asks user-service for the contract counts of ONLY
 * the ids on the page, and maps just those rows. The partner roles (gym-service) are resolved for the small
 * GYM_OWNER set and paged here. REAL HTTP/API on the gateway app; auth / user / gym services are stubs
 * (TEST FIXTURE) that record what they were asked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4051";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4052";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:4053";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-admin-users-paged-test";

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let userServer: http.Server;
let gymServer: http.Server;
let base = "";
let authUrls: string[] = [];
let summaryUrls: string[] = [];
let gymUrls: string[] = [];
let summaryFails = false;

const NOW = "2026-11-10T08:00:00.000Z";
const mkUser = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.com`,
  firstName: "Nguyễn",
  lastName: id.toUpperCase(),
  role: "GYM_OWNER",
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const OWNERS = ["o1", "o2", "o3", "o4", "o5"].map((id) => mkUser(id));
const PARTNER_ROLES: Record<string, string | null> = { o1: null, o2: "MANAGER", o3: "OWNER", o4: "RECEPTIONIST", o5: "MANAGER" };

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/auth/verify") return json(res, 200, { user: { id: "admin-1", email: "a@example.com", role: "ADMIN" } });
      if (req.method === "GET" && (req.url || "").startsWith("/auth/users")) {
        authUrls.push(req.url!);
        const q = new URL(req.url!, "http://x").searchParams;
        if (q.get("role") === "BOGUS") return json(res, 400, { error: "Bộ lọc role không hợp lệ", code: "INVALID_ROLE_FILTER" });
        // paged answer: 45 matches in total, `limit` rows of them
        if (q.get("page")) {
          const limit = Number(q.get("limit"));
          const users = Array.from({ length: Math.min(limit, 45 - (Number(q.get("page")) - 1) * limit) }, (_, i) => mkUser(`p${i}`, { role: "PT" }));
          return json(res, 200, { users, total: 45, page: Number(q.get("page")), limit, totalPages: Math.ceil(45 / limit) });
        }
        return json(res, 200, { users: OWNERS });
      }
      res.statusCode = 404;
      res.end();
    });
  });
  userServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if ((req.url || "").startsWith("/profile/admin/contracts/summary")) {
        summaryUrls.push(req.url!);
        if (summaryFails) return json(res, 500, { error: "boom" });
        return json(res, 200, { summary: { p0: 4, o2: 2 } });
      }
      res.statusCode = 404;
      res.end();
    });
  });
  gymServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if ((req.url || "").startsWith("/admin/partner-accounts/roles")) {
        gymUrls.push(req.url!);
        const ids = (new URL(req.url!, "http://x").searchParams.get("userIds") || "").split(",");
        return json(res, 200, { success: true, data: ids.map((userId) => ({ userId, partnerRole: PARTNER_ROLES[userId] ?? null })) });
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => authServer.listen(4051, "127.0.0.1", r));
  await new Promise<void>((r) => userServer.listen(4052, "127.0.0.1", r));
  await new Promise<void>((r) => gymServer.listen(4053, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});
test.after(async () => {
  for (const s of [gatewayServer, authServer, userServer, gymServer]) await new Promise<void>((r) => s.close(() => r()));
});
test.beforeEach(() => {
  authUrls = [];
  summaryUrls = [];
  gymUrls = [];
  summaryFails = false;
});

const get = (path: string) => fetch(`${base}${path}`, { headers: { Authorization: "Bearer admin-token" } });

test("page + limit: ONE paged auth query with the filters, contract counts for the page ids only, headers + shape", async () => {
  const res = await get("/admin/users?page=2&limit=20&role=PT&status=active&search=Nguyễn");
  assert.equal(res.status, 200);
  assert.equal(authUrls.length, 1);
  const q = new URL(authUrls[0], "http://x").searchParams;
  assert.deepEqual(Object.fromEntries(q), { page: "2", limit: "20", role: "PT", status: "ACTIVE", search: "Nguyễn" });
  assert.equal(summaryUrls.length, 1);
  const ids = (new URL(summaryUrls[0], "http://x").searchParams.get("userIds") || "").split(",");
  assert.equal(ids.length, 20, "counts asked for exactly the 20 ids of the page, not for every account");
  assert.equal(res.headers.get("x-total-count"), "45");
  assert.equal(res.headers.get("x-page"), "2");
  assert.equal(res.headers.get("x-limit"), "20");
  const body: any = await res.json();
  assert.equal(body.data.total, 45);
  assert.equal(body.data.totalPages, 3);
  assert.equal(body.data.page, 2);
  assert.equal(body.data.users.length, 20);
  const first = body.data.users[0];
  assert.equal(first.contracts, 4, "contract count merged from user-service");
  assert.equal(first.roleCode, "PT");
  assert.equal(first.statusCode, "ACTIVE");
  assert.equal(first.joined, "Nov 10, 2026", "legacy en-US date shape kept");
  assert.equal(first.lastActive, "Nov 10");
  assert.equal(first.joinedLabel, "10/11/2026");
  for (const k of ["id", "name", "email", "role", "status", "createdAt", "updatedAt", "sessions", "contracts", "roleLabel", "statusLabel"]) assert.ok(k in first, k);
});

test("a failing contract summary degrades the counts to 0, the page still loads", async () => {
  summaryFails = true;
  const res = await get("/admin/users?page=1&limit=5");
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.data.users.length, 5);
  assert.ok(body.data.users.every((u: any) => u.contracts === 0));
});

test("id filter (deep link) is forwarded to auth-service", async () => {
  await get("/admin/users?page=1&limit=1&id=abc-123");
  assert.equal(new URL(authUrls[0], "http://x").searchParams.get("id"), "abc-123");
});

test("partnerRole=MANAGER: GYM_OWNER set read once, roles resolved in gym-service, filtered and paged here", async () => {
  const res = await get("/admin/users?page=1&limit=1&partnerRole=MANAGER");
  assert.equal(res.status, 200);
  assert.deepEqual(Object.fromEntries(new URL(authUrls[0], "http://x").searchParams), { role: "GYM_OWNER" }, "unpaged GYM_OWNER read");
  assert.equal(gymUrls.length, 1);
  const body: any = await res.json();
  assert.equal(body.data.total, 2, "o2 and o5 are managers");
  assert.deepEqual(body.data.users.map((u: any) => u.id), ["o2"]);
  assert.equal(body.data.totalPages, 2);
  const page2: any = await (await get("/admin/users?page=2&limit=1&partnerRole=manager")).json();
  assert.deepEqual(page2.data.users.map((u: any) => u.id), ["o5"]);
  // contract counts only for the one row on the page
  assert.equal(new URL(summaryUrls[0], "http://x").searchParams.get("userIds"), "o2");
});

test("partnerRole=OWNER includes legacy owners (no partner account -> null)", async () => {
  const body: any = await (await get("/admin/users?page=1&limit=10&partnerRole=OWNER")).json();
  assert.deepEqual(body.data.users.map((u: any) => u.id).sort(), ["o1", "o3"]);
  assert.equal(body.data.total, 2);
  const rec: any = await (await get("/admin/users?page=1&limit=10&partnerRole=RECEPTIONIST&status=ACTIVE&search=o4")).json();
  assert.deepEqual(rec.data.users.map((u: any) => u.id), ["o4"]);
  const q = new URL(authUrls[authUrls.length - 1], "http://x").searchParams;
  assert.equal(q.get("status"), "ACTIVE");
  assert.equal(q.get("search"), "o4");
});

test("validation: bad partnerRole / role mismatch / limit / status -> 400 and no downstream call", async () => {
  for (const [qs, code] of [
    ["partnerRole=BOSS&page=1", "INVALID_PARTNER_ROLE_FILTER"],
    ["partnerRole=MANAGER&role=PT&page=1", "INVALID_PARTNER_ROLE_FILTER"],
    ["page=1&limit=500", "INVALID_PAGINATION"],
    ["page=0", "INVALID_PAGINATION"],
    ["page=1&status=pending", "INVALID_STATUS_FILTER"],
  ] as const) {
    const res = await get(`/admin/users?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.equal(((await res.json()) as any).error.code, code, qs);
  }
  assert.equal(authUrls.length + summaryUrls.length + gymUrls.length, 0);
});

test("auth-service 400 on a paged request is passed through as a 400, not a silent empty page", async () => {
  const res = await get("/admin/users?page=1&limit=10&role=BOGUS");
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error.code, "INVALID_ROLE_FILTER");
});

test("bare (no page / limit) is capped: page 1 of 50 with X-Total-Count, never the whole list", async () => {
  const res = await get("/admin/users");
  assert.equal(res.status, 200);
  assert.deepEqual(authUrls, ["/auth/users?page=1&limit=50"]);
  assert.equal(summaryUrls.length, 1);
  assert.ok(new URL(summaryUrls[0], "http://x").searchParams.get("userIds"), "counts only for the ids of the page");
  const body: any = await res.json();
  assert.equal(body.data.total, 45);
  assert.equal(body.data.users.length, 45 > 50 ? 50 : 45);
  assert.equal(body.data.limit, 50);
  assert.equal(res.headers.get("x-total-count"), "45");
  assert.equal(res.headers.get("x-limit"), "50");
});

test("ids lookup (names behind a list) is forwarded; bad lists are 400 with no downstream call", async () => {
  await get("/admin/users?ids=a,b,%20c&page=1&limit=200");
  const q = new URL(authUrls[0], "http://x").searchParams;
  assert.equal(q.get("ids"), "a,b,c");
  assert.equal(q.get("limit"), "200");
  authUrls = [];
  for (const qs of ["ids=" + Array.from({ length: 201 }, (_, i) => "i" + i).join(","), "ids=a&ids=b", "ids=" + "x".repeat(65)]) {
    const res = await get("/admin/users?" + qs);
    assert.equal(res.status, 400, qs.slice(0, 20));
    assert.equal(((await res.json()) as any).error.code, "INVALID_IDS_FILTER");
  }
  assert.equal(authUrls.length, 0);
});
