/**
 * N-A-05 — dashboard `kpis.pendingPT` counts PT APPLICATIONS awaiting an admin (SUBMITTED + UNDER_REVIEW,
 * from the X-Total-Count of user-service's paged admin list), not users with a PT profile. null — never a
 * made-up 0 — when the count cannot be read.
 * N-A-06 — GET /admin/users: no params = the whole list (old behaviour); search / status / page / limit are
 * honoured server-side and a bad value is a 400.
 * N-A-10 — the dashboard's alerts, role names and month labels are Vietnamese; role/status codes stay.
 *
 * Real gateway app + stub auth/user/payment services (REAL HTTP/API for the gateway half, TEST FIXTURE downstream).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4051";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4052";
process.env.PAYMENT_SERVICE_URL = "http://127.0.0.1:4053";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-dashboard-pendingpt-test";

let app: any;
let gatewayServer: http.Server;
let gatewayBaseUrl = "";
const stubs: http.Server[] = [];
let ptAppMode: "ok" | "fail" = "ok";
const ptAppCalls: string[] = [];

function stub(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const s = http.createServer(handler);
  stubs.push(s);
  return new Promise<void>((resolve) => s.listen(port, "127.0.0.1", resolve));
}
const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const iso = (d: Date) => d.toISOString();
const now = new Date();
const AUTH_USERS = [
  { id: "c1", email: "nguyen.van.an@example.com", firstName: "Nguyễn Văn", lastName: "An", role: "CUSTOMER", isActive: true },
  { id: "c2", email: "tran.binh@example.com", firstName: "Trần", lastName: "Bình", role: "CUSTOMER", isActive: false },
  { id: "p1", email: "pt.coach@example.com", firstName: "Lê", lastName: "Huấn", role: "PT", isActive: true },
  { id: "g1", email: "owner@example.com", firstName: "Phạm", lastName: "Chủ", role: "GYM_OWNER", isActive: true },
].map((u) => ({ ...u, createdAt: iso(now), updatedAt: iso(now) }));

test.before(async () => {
  ({ default: app } = await import("../app"));
  await stub(4051, (req, res) => {
    req.resume();
    if (req.method === "POST" && req.url === "/auth/verify") {
      return json(res, 200, { user: { id: "admin-1", email: "a@example.com", role: "ADMIN" } });
    }
    if (req.url?.startsWith("/auth/users")) return json(res, 200, { users: AUTH_USERS });
    res.statusCode = 404;
    res.end();
  });
  await stub(4052, (req, res) => {
    req.resume();
    const url = new URL(req.url || "/", "http://x");
    if (url.pathname === "/pt-applications/admin") {
      ptAppCalls.push(req.url!);
      if (ptAppMode === "fail") return json(res, 500, { error: "boom" });
      const status = url.searchParams.get("status");
      const total = status === "SUBMITTED" ? 4 : status === "UNDER_REVIEW" ? 3 : 99;
      return json(res, 200, [], { "X-Total-Count": String(total) });
    }
    if (url.pathname.startsWith("/profile/pts")) {
      // Old model: a user with a PT profile whose role is not PT yet. Must NOT drive pendingPT any more.
      return json(res, 200, { pts: [{ userId: "c1", isPT: true }, { userId: "c2", isPT: true }] });
    }
    if (url.pathname.startsWith("/profile/admin/stats")) return json(res, 200, { activeContracts: 1 });
    if (url.pathname.startsWith("/profile/admin/contracts/summary")) return json(res, 200, { summary: { p1: 2 } });
    if (url.pathname === "/internal/admin/sessions/today-count") return json(res, 200, { count: 0 });
    res.statusCode = 404;
    res.end();
  });
  await stub(4053, (_req, res) => json(res, 404, {}));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  gatewayBaseUrl = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  for (const s of stubs) await new Promise<void>((resolve) => s.close(() => resolve()));
});

const get = (path: string) => fetch(`${gatewayBaseUrl}${path}`, { headers: { Authorization: "Bearer admin-token" } });

test("dashboard pendingPT = SUBMITTED + UNDER_REVIEW applications, not users with a PT profile", async () => {
  ptAppMode = "ok";
  ptAppCalls.length = 0;
  const res = await get("/admin/dashboard");
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.data.kpis.pendingPT, 7, "4 SUBMITTED + 3 UNDER_REVIEW");
  assert.ok(ptAppCalls.some((u) => /status=SUBMITTED/.test(u)));
  assert.ok(ptAppCalls.some((u) => /status=UNDER_REVIEW/.test(u)));
  assert.ok(ptAppCalls.every((u) => /page=1/.test(u) && /limit=1/.test(u)), "only a one-row page is requested");
  const alert = body.data.systemAlerts.find((a: any) => a.service === "Quản lý huấn luyện viên");
  assert.ok(alert, "an info alert is raised for pending applications");
  assert.equal(alert.message, "7 hồ sơ huấn luyện viên đang chờ quản trị viên duyệt");
});

test("dashboard pendingPT is null (and says so in Vietnamese) when the application count is unavailable", async () => {
  ptAppMode = "fail";
  const res = await get("/admin/dashboard");
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.data.kpis.pendingPT, null);
  const warning = body.data.systemAlerts.find((a: any) => /hồ sơ huấn luyện viên đang chờ duyệt/.test(a.message));
  assert.ok(warning, "a Vietnamese partial-data warning is shown");
  ptAppMode = "ok";
});

test("dashboard labels are Vietnamese: role names, month labels, alert times; codes are kept", async () => {
  const body: any = await (await get("/admin/dashboard")).json();
  assert.deepEqual(
    body.data.roleData.map((r: any) => [r.name, r.code]),
    [
      ["Khách hàng", "CUSTOMER"],
      ["Huấn luyện viên", "PT"],
      ["Chủ phòng gym", "GYM_OWNER"],
    ],
  );
  for (const g of body.data.userGrowth) assert.match(g.month, /^T([1-9]|1[0-2])$/);
  for (const a of body.data.systemAlerts) {
    assert.doesNotMatch(a.time, /AM|PM/);
    assert.doesNotMatch(`${a.service} ${a.message}`, /Service|Unable|pending admin/i);
  }
  const u = body.data.recentUsers[0];
  assert.match(u.joined, /^\d{2}\/\d{2}$/);
  assert.equal(typeof u.roleLabel, "string");
  assert.equal(u.statusCode === "ACTIVE" || u.statusCode === "INACTIVE", true);
  assert.ok(["Client", "PT", "Gym Owner", "Admin"].includes(u.role), "legacy role code kept for existing clients");
});

test("system monitor probes carry a Vietnamese label next to the English name", async () => {
  const body: any = await (await get("/admin/system-monitor")).json();
  for (const s of body.data.services) {
    assert.equal(typeof s.label, "string");
    assert.doesNotMatch(s.label, /Service/);
  }
});

test("/admin/users with no parameters still returns everyone, legacy fields intact + Vietnamese labels", async () => {
  const res = await get("/admin/users");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-total-count"), null, "no paging headers when not paging");
  const body: any = await res.json();
  assert.equal(body.data.total, 4);
  assert.equal(body.data.users.length, 4);
  const locked = body.data.users.find((u: any) => u.id === "c2");
  assert.equal(locked.status, "Inactive");
  assert.equal(locked.statusCode, "INACTIVE");
  assert.equal(locked.statusLabel, "Đã khoá");
  assert.equal(locked.role, "Client");
  assert.equal(locked.roleCode, "CUSTOMER");
  assert.equal(locked.roleLabel, "Khách hàng");
  assert.match(locked.joined, /\d{4}$/, "legacy joined string unchanged (web parses it)");
  assert.match(locked.joinedLabel, /^\d{2}\/\d{2}\/\d{4}$/);
});

test("/admin/users page + limit return a slice and the paging headers", async () => {
  const res = await get("/admin/users?page=2&limit=3");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-total-count"), "4");
  assert.equal(res.headers.get("x-page"), "2");
  assert.equal(res.headers.get("x-limit"), "3");
  const body: any = await res.json();
  assert.equal(body.data.total, 4);
  assert.equal(body.data.users.length, 1);
  assert.equal(body.data.page, 2);
  assert.equal(body.data.totalPages, 2);
});

test("/admin/users search ignores case and Vietnamese diacritics, over name and email", async () => {
  const byName: any = await (await get("/admin/users?search=nguyen%20van")).json();
  assert.deepEqual(byName.data.users.map((u: any) => u.id), ["c1"]);
  const byEmail: any = await (await get("/admin/users?search=PT.COACH")).json();
  assert.deepEqual(byEmail.data.users.map((u: any) => u.id), ["p1"]);
  const none: any = await (await get("/admin/users?search=khongco")).json();
  assert.equal(none.data.total, 0);
});

test("/admin/users status filter and combination with paging", async () => {
  const locked: any = await (await get("/admin/users?status=inactive")).json();
  assert.deepEqual(locked.data.users.map((u: any) => u.id), ["c2"]);
  const active: any = await (await get("/admin/users?status=ACTIVE&page=1&limit=2")).json();
  assert.equal(active.data.total, 3);
  assert.equal(active.data.users.length, 2);
});

test("/admin/users rejects bad search / status / page / limit with 400 and a code", async () => {
  const cases: Array<[string, string]> = [
    ["status=BOGUS", "INVALID_STATUS_FILTER"],
    ["page=0", "INVALID_PAGINATION"],
    ["page=abc", "INVALID_PAGINATION"],
    ["limit=0", "INVALID_PAGINATION"],
    ["limit=201", "INVALID_PAGINATION"],
    ["limit=-1", "INVALID_PAGINATION"],
    ["search=a&search=b", "INVALID_SEARCH"],
  ];
  for (const [qs, code] of cases) {
    const res = await get(`/admin/users?${qs}`);
    assert.equal(res.status, 400, qs);
    const body: any = await res.json();
    assert.equal(body.error.code, code, qs);
  }
});
