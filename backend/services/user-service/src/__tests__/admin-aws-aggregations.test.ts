import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminDashboard } from "../services/admin-dashboard.service";
import { buildMonitorSummary, interpretHealthEnvelope, monitorTargets, type ProbeResult } from "../services/system-monitor.service";
import { adminRoleLabel, adminUserStatus } from "../utils/admin-user-view";

/**
 * AWS replacements for the gateway-only admin aggregations (GET /admin/dashboard, /admin/system-monitor,
 * /admin/users). Pure logic only — no AWS call, no database.
 */
const NOW = new Date("2026-10-25T10:00:00Z");
const user = (id: string, role: string, createdAt: string, extra: object = {}) =>
  ({ id, email: `${id}@x.vn`, firstName: id, lastName: "T", role, createdAt, ...extra });

test("labels: role and status mapping matches the gateway", () => {
  assert.equal(adminRoleLabel("GYM_OWNER"), "Gym Owner");
  assert.equal(adminRoleLabel("CUSTOMER"), "Client");
  assert.equal(adminRoleLabel(undefined), "Client");
  assert.equal(adminUserStatus(false), "Inactive");
  assert.equal(adminUserStatus(undefined), "Active");
});

test("dashboard: admins are excluded, PT/pending counts and role breakdown are right", () => {
  const d = buildAdminDashboard({
    users: [
      user("a1", "ADMIN", "2026-10-01T00:00:00Z"),
      user("c1", "CUSTOMER", "2026-10-02T00:00:00Z"),
      user("p1", "PT", "2026-09-02T00:00:00Z"),
      user("c2", "CUSTOMER", "2026-10-03T00:00:00Z", { isActive: false }), // applicant not yet PT
      user("g1", "GYM_OWNER", "2026-08-03T00:00:00Z"),
    ],
    ptUserIds: ["c2"], activeContracts: 7, ocrStats: { total: 3, extracted: 2, manual: 1, pending: 0 },
    sessionsToday: 4, now: NOW,
  });
  assert.equal(d.kpis.totalUsers, 4);
  assert.equal(d.kpis.verifiedPTs, 2); // p1 (PT role) + c2 (profile isPT)
  assert.equal(d.kpis.pendingPT, 1); // c2 is flagged isPT but not role PT yet
  assert.equal(d.kpis.activeContracts, 7);
  assert.equal(d.kpis.sessionsToday, 4);
  assert.deepEqual(d.roleData, [
    { name: "Clients", value: 2 }, { name: "Trainers", value: 2 }, { name: "Gym owners", value: 1 },
  ]);
  assert.ok(d.systemAlerts.some((a: any) => a.service === "PT Management"));
  assert.equal(d.userGrowth.length, 6);
  assert.equal(d.userGrowth[5].users, 4); // cumulative, all 4 users counted by October
  assert.equal(d.recentUsers.find((u) => u.email === "c2@x.vn")?.status, "Inactive");
});

test("dashboard: unreachable sources become visible warnings, never invented numbers", () => {
  const d = buildAdminDashboard({ users: null, ptUserIds: null, activeContracts: null, ocrStats: null, sessionsToday: null, now: NOW });
  assert.equal(d.kpis.totalUsers, 0);
  assert.equal(d.kpis.sessionsToday, null);
  const services = d.systemAlerts.map((a: any) => a.service);
  assert.ok(services.includes("Auth Service"));
  assert.ok(services.includes("User Service"));
  assert.deepEqual(d.ocrStats, { total: 0, extracted: 0, manual: 0, pending: 0 });
});

test("monitor: targets derive Lambda names from the auth Lambda name", () => {
  const t = monitorTargets("fitness-assistant-dev-auth", "fitness-assistant-dev-user");
  assert.deepEqual(t.map((x) => x.functionName), [
    "fitness-assistant-dev-auth", "fitness-assistant-dev-user", "fitness-assistant-dev-fitness",
    "fitness-assistant-dev-gym", "fitness-assistant-dev-payment", "fitness-assistant-dev-ai",
  ]);
  assert.equal(t.find((x) => x.key === "user")?.self, true);
  assert.equal(monitorTargets(undefined, undefined).find((x) => x.key === "gym")?.functionName, null);
});

test("monitor: health envelope interpretation", () => {
  assert.equal(interpretHealthEnvelope({ statusCode: 200, body: '{"status":"ok"}' }).healthy, true);
  assert.equal(interpretHealthEnvelope({ statusCode: 200, body: '{"status":"degraded"}' }).healthy, false);
  assert.equal(interpretHealthEnvelope({ statusCode: 500, body: '{"status":"ok"}' }).healthy, false);
  assert.equal(interpretHealthEnvelope(null).healthy, false);
  assert.equal(interpretHealthEnvelope({ statusCode: 200, body: "not json" }).healthy, false);
});

test("monitor: optional (not-probed) services never affect the core health score", () => {
  const p = (key: string, status: ProbeResult["status"], optional = false): ProbeResult => ({
    key, name: key, status, statusCode: 0, latencyMs: 1, uptimeSeconds: null, timestamp: NOW.toISOString(), error: status === "healthy" ? null : "x", optional,
  });
  const s = buildMonitorSummary([p("auth", "healthy"), p("user", "healthy"), p("gym", "degraded", true), p("ai", "degraded", true)]);
  assert.equal(s.healthScore, 100);
  assert.equal(s.serviceCount, 4);
  assert.equal(s.degradedCount, 2);
  assert.equal(s.recentErrors.length, 2);
  assert.equal(buildMonitorSummary([p("auth", "down"), p("user", "healthy")]).healthScore, 50);
});

test("vietnamDayBounds: Vietnam calendar day around the UTC midnight boundary", async () => {
  const { vietnamDayBounds } = await import("../services/admin-dashboard.service");
  // 2026-10-24 18:30 UTC is already 01:30 on 2026-10-25 in Vietnam
  const b = vietnamDayBounds(new Date("2026-10-24T18:30:00Z"));
  assert.equal(b.start.toISOString(), "2026-10-24T17:00:00.000Z");
  assert.equal(b.end.toISOString(), "2026-10-25T17:00:00.000Z");
  // 2026-10-24 16:59 UTC is still 23:59 on the 24th
  assert.equal(vietnamDayBounds(new Date("2026-10-24T16:59:00Z")).start.toISOString(), "2026-10-23T17:00:00.000Z");
});

test("dashboard: test/seed accounts (reserved email domains or SYNTHETIC profiles) are left out of the server numbers", async () => {
  const { excludeTestAccounts } = await import("../services/admin-dashboard.service");
  const users = [
    { id: "u1", email: "real.person@gmail.com", role: "CLIENT", createdAt: "2026-11-01T00:00:00Z" },
    { id: "u2", email: "aiq.nut.a@gymini-test.local", role: "CLIENT", createdAt: "2026-11-02T00:00:00Z" },
    { id: "u3", email: "pt.flow.1@example.com", role: "PT", createdAt: "2026-11-02T00:00:00Z" },
    { id: "u4", email: "seeded.pt@gmail.com", role: "PT", createdAt: "2026-11-03T00:00:00Z" },
  ];
  const { users: kept, testIds } = excludeTestAccounts(users, ["u4"]);
  assert.deepEqual(kept!.map((u) => u.id), ["u1"]);
  assert.deepEqual(testIds.sort(), ["u2", "u3", "u4"]);
  const unreachable = excludeTestAccounts(null, ["u4"]);
  assert.equal(unreachable.users, null);
  assert.deepEqual(unreachable.testIds, ["u4"]);
});
