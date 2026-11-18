/**
 * /admin/dashboard on AWS must not read every account (a Lambda answer is capped at ~6 MB; 37k accounts are ~8 MB). The numbers now come from
 * auth-service's database as an aggregate, and the newest rows carry `id` and `partnerRole` (the mobile admin needs them to show the right
 * owner / manager / receptionist / accountant). Pure unit tests: no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateFromUsers,
  attachPartnerRoles,
  buildAdminDashboard,
  buildAdminDashboardFromAggregate,
  dashboardMonths,
  dashboardSince,
  type DashboardAuthUser,
  type DashboardUserAggregate,
} from "../services/admin-dashboard.service";
import { __resetTestAccountIdsCache, getAuthTestAccountIds } from "../services/admin-dashboard-stats.service";
import { authServiceClient } from "../clients/auth-service.client";

const NOW = new Date("2026-10-25T10:00:00Z");
const user = (id: string, role: string, createdAt: string, extra: object = {}): DashboardAuthUser =>
  ({ id, email: `${id}@x.vn`, firstName: id, lastName: "T", role, createdAt, ...extra });

const USERS: DashboardAuthUser[] = [
  user("c1", "CUSTOMER", "2026-10-24T00:00:00Z"),
  user("g2", "GYM_OWNER", "2026-10-23T00:00:00Z"),
  user("p1", "PT", "2026-09-02T00:00:00Z"),
  user("c2", "CUSTOMER", "2026-08-03T00:00:00Z", { isActive: false }),
  user("g1", "GYM_OWNER", "2026-08-01T00:00:00Z"),
  user("old", "CUSTOMER", "2025-01-01T00:00:00Z"),
];

test("the aggregate path and the list path give the SAME dashboard (the route's numbers did not change)", () => {
  const input = { ptUserIds: ["c2"], activeContracts: 7, ocrStats: { total: 3, extracted: 2, manual: 1, pending: 0 }, sessionsToday: 4, now: NOW };
  const fromList = buildAdminDashboard({ users: USERS, ...input });
  const fromAggregate = buildAdminDashboardFromAggregate({ aggregate: aggregateFromUsers(USERS, ["c2"]), ptKnown: true, ...input });
  assert.deepEqual(fromAggregate, fromList);
  assert.equal(fromList.kpis.totalUsers, 6);
  assert.equal(fromList.kpis.verifiedPTs, 2);
  assert.equal(fromList.kpis.pendingPT, 1);
});

test("growth chart: six months, cumulative, signups before the first month are not in the chart", () => {
  const d = buildAdminDashboardFromAggregate({
    aggregate: { totalUsers: 99, roleCounts: { CUSTOMER: 99, PT: 0, GYM_OWNER: 0 }, trainers: 0, pendingPT: 0, monthCounts: { "2026-05": 5, "2026-08": 2, "2026-10": 3, "2020-01": 80 }, recent: [] },
    ptKnown: true, activeContracts: 0, ocrStats: null, sessionsToday: 0, now: NOW,
  });
  assert.deepEqual(d.userGrowth.map((g) => g.month), ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  assert.deepEqual(d.userGrowth.map((g) => g.users), [5, 5, 5, 7, 7, 10]);
  assert.equal(d.kpis.totalUsers, 99);
});

test("month keys cross a year boundary and `since` is the first day of the oldest month", () => {
  const feb = new Date(2026, 1, 10, 12, 0, 0);
  assert.deepEqual(dashboardMonths(feb).map((m) => m.key), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  const since = dashboardSince(feb);
  assert.deepEqual([since.getFullYear(), since.getMonth(), since.getDate(), since.getHours()], [2025, 8, 1, 0]);
});

test("newest rows carry id and partnerRole; the list path now has them too", () => {
  const d = buildAdminDashboard({ users: USERS, ptUserIds: [], activeContracts: 0, ocrStats: null, sessionsToday: 0, now: NOW });
  assert.equal(d.recentUsers.length, 4);
  assert.deepEqual(d.recentUsers.map((u) => u.id), ["c1", "g2", "p1", "c2"]);
  assert.ok(d.recentUsers.every((u) => "partnerRole" in u && u.partnerRole === null), "no lookup -> null, never invented");
  assert.equal(d.recentUsers[3].status, "Inactive");
});

test("attachPartnerRoles: real role for owners, a null answer is a legacy OWNER, everyone else null, one call for the owners only", async () => {
  const calls: string[][] = [];
  const recent: DashboardUserAggregate["recent"] = [
    user("g1", "GYM_OWNER", "2026-10-24T00:00:00Z"),
    user("g2", "GYM_OWNER", "2026-10-23T00:00:00Z"),
    user("g3", "GYM_OWNER", "2026-10-22T00:00:00Z"),
    user("c1", "CUSTOMER", "2026-10-21T00:00:00Z"),
  ];
  const out = await attachPartnerRoles(recent, async (ids) => {
    calls.push(ids);
    return [{ userId: "g1", partnerRole: "MANAGER" }, { userId: "g2", partnerRole: null }];
  });
  assert.deepEqual(calls, [["g1", "g2", "g3"]]);
  assert.deepEqual(out.map((u) => u.partnerRole), ["MANAGER", "OWNER", "OWNER", null]);
});

test("attachPartnerRoles: no owners -> no lookup; a failing lookup -> unknown (null), the dashboard is not failed", async () => {
  let called = 0;
  const onlyClients = await attachPartnerRoles([user("c1", "CUSTOMER", "2026-10-24T00:00:00Z")], async () => { called += 1; return []; });
  assert.equal(called, 0);
  assert.equal(onlyClients[0].partnerRole, null);
  const failed = await attachPartnerRoles([user("g1", "GYM_OWNER", "2026-10-24T00:00:00Z")], async () => { throw new Error("gym down"); });
  assert.equal(failed[0].partnerRole, null, "unknown is null, NOT a guessed OWNER");
});

test("unreachable sources stay visible warnings, never invented numbers", () => {
  const d = buildAdminDashboardFromAggregate({ aggregate: null, ptKnown: false, activeContracts: null, ocrStats: null, sessionsToday: null, now: NOW });
  assert.equal(d.kpis.totalUsers, 0);
  assert.deepEqual(d.recentUsers, []);
  const services = d.systemAlerts.map((a: any) => a.service);
  assert.ok(services.includes("Auth Service") && services.includes("User Service"));
});

test("test-account ids from auth-service are cached for 5 minutes; a failure or a malformed answer is null (unknown), never an empty list", async () => {
  const original = authServiceClient.internalGet;
  let calls = 0;
  let answer: any = { data: { ids: ["a", "b", 7, null] } };
  (authServiceClient as any).internalGet = async () => { calls += 1; if (answer instanceof Error) throw answer; return answer; };
  try {
    __resetTestAccountIdsCache();
    const t0 = 1_000_000;
    assert.deepEqual(await getAuthTestAccountIds(t0), ["a", "b"], "non-string entries are dropped");
    assert.deepEqual(await getAuthTestAccountIds(t0 + 4 * 60_000), ["a", "b"]);
    assert.equal(calls, 1, "cached");
    answer = { data: { ids: ["c"] } };
    assert.deepEqual(await getAuthTestAccountIds(t0 + 6 * 60_000), ["c"]);
    assert.equal(calls, 2, "refreshed after the TTL");

    __resetTestAccountIdsCache();
    answer = new Error("auth down");
    assert.equal(await getAuthTestAccountIds(t0), null);
    answer = { data: { nope: true } };
    assert.equal(await getAuthTestAccountIds(t0), null);
  } finally {
    (authServiceClient as any).internalGet = original;
    __resetTestAccountIdsCache();
  }
});
