/**
 * B30 — the admin dashboard's `sessionsToday` used to count users whose row was updated today
 * (~98 after 100 logins). It must now be the coaching-session count owned by user-service, and
 * null (never a wrong number) when that count is unavailable.
 * B42 (gateway half) — the specific auth-service error code must survive the gateway wrapper.
 *
 * Real gateway app + stub downstreams (REAL HTTP/API for the gateway half, TEST FIXTURE for the rest).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4041";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4042";
process.env.PAYMENT_SERVICE_URL = "http://127.0.0.1:4043";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-dashboard-sessions-test";

let app: any;
let gatewayServer: http.Server;
let gatewayBaseUrl = "";
const stubs: http.Server[] = [];
let countMode: "ok" | "fail" | "garbage" = "ok";
let countSecret: string | undefined;
let countPath: string | undefined;

function stub(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const s = http.createServer(handler);
  stubs.push(s);
  return new Promise<void>((resolve) => s.listen(port, "127.0.0.1", resolve));
}
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

test.before(async () => {
  ({ default: app } = await import("../app"));
  const today = new Date().toISOString();
  await stub(4041, (req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      return json(res, 200, { user: { id: "admin-1", email: "a@example.com", role: "ADMIN" } });
    }
    if (req.url === "/auth/users") {
      // 3 users all "updated today": the old implementation would have reported 3.
      return json(res, 200, {
        users: ["u1", "u2", "u3"].map((id) => ({
          id, email: `${id}@example.com`, role: "CUSTOMER", isActive: true, createdAt: today, updatedAt: today,
        })),
      });
    }
    if (req.method === "PATCH" && /\/auth\/users\/[^/]+\/disable$/.test(req.url || "")) {
      return json(res, 403, { error: "Admins cannot disable their own account", code: "CANNOT_DISABLE_SELF" });
    }
    res.statusCode = 404;
    res.end();
  });
  await stub(4042, (req, res) => {
    if (req.url?.startsWith("/profile/pts")) return json(res, 200, { pts: [] });
    if (req.url?.startsWith("/profile/admin/stats")) return json(res, 200, { activeContracts: 1 });
    if (req.url === "/internal/admin/sessions/today-count") {
      countPath = req.url;
      countSecret = String(req.headers["x-service-secret"]);
      if (countMode === "fail") return json(res, 500, { error: "boom" });
      if (countMode === "garbage") return json(res, 200, { count: "many" });
      return json(res, 200, { count: 7 });
    }
    res.statusCode = 404;
    res.end();
  });
  await stub(4043, (_req, res) => json(res, 404, {}));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  await Promise.all(stubs.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function dashboard() {
  const res = await fetch(`${gatewayBaseUrl}/admin/dashboard`, { headers: { Authorization: "Bearer admin-token" } });
  assert.equal(res.status, 200);
  return ((await res.json()) as any).data.kpis;
}

test("sessionsToday is the user-service session count (not the users-updated-today count of 3)", async () => {
  countMode = "ok";
  const kpis = await dashboard();
  assert.equal(kpis.sessionsToday, 7);
  assert.equal(countPath, "/internal/admin/sessions/today-count");
  assert.equal(countSecret, "gateway-secret-dashboard-sessions-test", "calls the internal endpoint with the service secret");
});

test("sessionsToday is null when user-service cannot answer — never the wrong user count", async () => {
  countMode = "fail";
  assert.equal((await dashboard()).sessionsToday, null);
});

test("sessionsToday is null for a malformed upstream body", async () => {
  countMode = "garbage";
  assert.equal((await dashboard()).sessionsToday, null);
});

test("the auth-service error code (CANNOT_DISABLE_SELF) is passed through the gateway wrapper", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/users/admin-1/disable`, {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-token" },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assert.equal(body.error.code, "CANNOT_DISABLE_SELF");
});
