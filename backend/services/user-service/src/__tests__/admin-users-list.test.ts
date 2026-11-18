/**
 * Admin user list on AWS (GET /admin/users): paged, filtered in auth-service's database, same shape as the gateway.
 * Before: the Lambda route fetched EVERY account and ignored page / limit / q / role (with 37k accounts: megabytes and ~30 s).
 * Pure unit test: the three downstream calls are stubs (no DB, no network); the auth client test replaces the Lambda SDK send().
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  ADMIN_USERS_BARE_PAGE_SIZE,
  listAdminUsers,
  mapAdminUserRow,
  parseAdminUsersQuery,
  isAdminUsersQueryError,
  type AdminUsersDeps,
  type AuthUser,
} from "../services/admin-users-list.service";

const user = (n: number, over: Partial<AuthUser> = {}): AuthUser => ({
  id: `u${n}`,
  email: `user${n}@example.com`,
  firstName: n % 2 ? `First${n}` : null,
  lastName: n % 2 ? `Last${n}` : null,
  role: "CUSTOMER",
  isActive: true,
  createdAt: "2026-11-09T05:00:00.000Z",
  updatedAt: "2026-11-10T05:00:00.000Z",
  ...over,
});

function deps(over: Partial<AdminUsersDeps> = {}) {
  const calls = { auth: [] as Array<Record<string, string>>, roles: [] as string[][], counts: [] as string[][] };
  const d: AdminUsersDeps = {
    listAuthUsers: async (p) => { calls.auth.push(p); return { users: [user(1), user(2)], total: 37_419 }; },
    partnerRoles: async (ids) => { calls.roles.push(ids); return ids.map((userId) => ({ userId, partnerRole: null })); },
    contractCounts: async (ids) => { calls.counts.push(ids); return Object.fromEntries(ids.map((i) => [i, 3])); },
    ...over,
  };
  return { d, calls };
}

test("a request without page/limit is still ONE page of 50, never the whole table", async () => {
  const { d, calls } = deps();
  const a = await listAdminUsers({}, d);
  assert.equal(a.status, 200);
  assert.deepEqual(calls.auth[0], { page: "1", limit: String(ADMIN_USERS_BARE_PAGE_SIZE) });
  assert.equal((a.body as any).data.total, 37_419);
  assert.equal((a.body as any).data.totalPages, Math.ceil(37_419 / 50));
  assert.equal(a.headers?.["X-Total-Count"], "37419");
});

test("page, limit, role, status, search and id are forwarded to auth-service (filtering happens in its database)", async () => {
  const { d, calls } = deps();
  await listAdminUsers({ page: "3", limit: "25", role: "PT", status: "inactive", search: "  Nguyễn  ", id: "abc" }, d);
  assert.deepEqual(calls.auth[0], { page: "3", limit: "25", role: "PT", status: "INACTIVE", search: "Nguyễn", id: "abc" });
});

test("ids lookup (withdrawal names) is forwarded, de-duplicated", async () => {
  const { d, calls } = deps();
  await listAdminUsers({ ids: "a, b,a ,c", limit: "200" }, d);
  assert.equal(calls.auth[0].ids, "a,b,c");
});

test("only the ROWS OF THIS PAGE are enriched with contract counts", async () => {
  const { d, calls } = deps();
  const a = await listAdminUsers({ page: "1", limit: "2" }, d);
  assert.deepEqual(calls.counts, [["u1", "u2"]]);
  assert.equal((a.body as any).data.users[0].contracts, 3);
});

test("a failing contract-count lookup degrades to 0, the list still answers", async () => {
  const { d } = deps({ contractCounts: async () => { throw new Error("db down"); } });
  const a = await listAdminUsers({}, d);
  assert.equal(a.status, 200);
  assert.deepEqual((a.body as any).data.users.map((u: any) => u.contracts), [0, 0]);
});

test("an empty page asks for no contract counts", async () => {
  const { d, calls } = deps({ listAuthUsers: async () => ({ users: [], total: 0 }) });
  const a = await listAdminUsers({ search: "nobody" }, d);
  assert.equal(calls.counts.length, 0);
  assert.equal((a.body as any).data.totalPages, 1);
});

test("a filter auth-service rejects (400) comes back as a 400 with its code and message, not as a server error", async () => {
  const { d } = deps({ listAuthUsers: async () => { throw Object.assign(new Error("x"), { response: { status: 400, data: { code: "INVALID_ROLE_FILTER", error: "Bộ lọc role không hợp lệ" } } }); } });
  const a = await listAdminUsers({ role: "BOGUS" }, d);
  assert.equal(a.status, 400);
  assert.deepEqual((a.body as any).error, { code: "INVALID_ROLE_FILTER", message: "Bộ lọc role không hợp lệ" });
});

test("any other downstream failure propagates (the route turns it into one 502)", async () => {
  const { d } = deps({ listAuthUsers: async () => { throw new Error("auth down"); } });
  await assert.rejects(() => listAdminUsers({}, d), /auth down/);
});

test("bad parameters are 400s with a code, never silently ignored", async () => {
  const { d, calls } = deps();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ page: "0" }, "INVALID_PAGINATION"],
    [{ limit: "201" }, "INVALID_PAGINATION"],
    [{ limit: "abc" }, "INVALID_PAGINATION"],
    [{ page: ["1", "2"] }, "INVALID_PAGINATION"],
    [{ status: "BANNED" }, "INVALID_STATUS_FILTER"],
    [{ search: "x".repeat(101) }, "INVALID_SEARCH"],
    [{ search: ["a", "b"] }, "INVALID_SEARCH"],
    [{ id: "x".repeat(65) }, "INVALID_ID_FILTER"],
    [{ ids: Array.from({ length: 201 }, (_, i) => `i${i}`).join(",") }, "INVALID_IDS_FILTER"],
    [{ partnerRole: "BOSS" }, "INVALID_PARTNER_ROLE_FILTER"],
    [{ partnerRole: "OWNER", role: "PT" }, "INVALID_PARTNER_ROLE_FILTER"],
  ];
  for (const [q, code] of cases) {
    const a = await listAdminUsers(q, d);
    assert.equal(a.status, 400, JSON.stringify(q).slice(0, 60));
    assert.equal((a.body as any).error.code, code);
  }
  assert.equal(calls.auth.length, 0, "nothing was asked of auth-service for a refused request");
});

// ── partner role filter: the real role lives in gym-service ─────────────────────────────────────────────────────────────────────────

const owners = (n: number) => Array.from({ length: n }, (_, i) => user(i + 1, { role: "GYM_OWNER" }));

test("partnerRole: reads the GYM_OWNER set, resolves roles in gym-service, a null role is a legacy OWNER, then pages in memory", async () => {
  const { d, calls } = deps({
    listAuthUsers: async (p) => { calls.auth.push(p); return { users: owners(5) }; },
    partnerRoles: async (ids) => ids.map((userId) => ({ userId, partnerRole: userId === "u2" ? "MANAGER" : userId === "u3" ? "RECEPTIONIST" : userId === "u4" ? null : "OWNER" })),
  });
  const a = await listAdminUsers({ partnerRole: "owner", page: "1", limit: "2" }, d);
  assert.deepEqual(calls.auth[0], { role: "GYM_OWNER" }, "no page/limit to auth: the filter needs the whole (small) owner set");
  const body = (a.body as any).data;
  assert.equal(body.total, 3, "u1, u4 (legacy null -> OWNER) and u5");
  assert.deepEqual(body.users.map((u: any) => u.id), ["u1", "u4"]);
  assert.equal(body.totalPages, 2);
  const page2 = await listAdminUsers({ partnerRole: "OWNER", page: "2", limit: "2" }, d);
  assert.deepEqual((page2.body as any).data.users.map((u: any) => u.id), ["u5"]);
});

test("partnerRole: status / search / ids are passed on with role=GYM_OWNER", async () => {
  const { d, calls } = deps({ listAuthUsers: async (p) => { calls.auth.push(p); return { users: [] }; } });
  await listAdminUsers({ partnerRole: "MANAGER", status: "ACTIVE", search: "an" }, d);
  assert.deepEqual(calls.auth[0], { role: "GYM_OWNER", status: "ACTIVE", search: "an" });
});

test("partnerRole: owner ids are looked up in chunks of 200", async () => {
  const { d, calls } = deps({ listAuthUsers: async () => ({ users: owners(450) }) });
  await listAdminUsers({ partnerRole: "OWNER" }, d);
  assert.deepEqual(calls.roles.map((c) => c.length), [200, 200, 50]);
});

// ── parser + row shape ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("parser: defaults, limits and normalisation", () => {
  const q = parseAdminUsersQuery({});
  assert.ok(!isAdminUsersQueryError(q));
  if (!isAdminUsersQueryError(q)) assert.deepEqual(q.paging, { page: 1, limit: 50 });
  const q2 = parseAdminUsersQuery({ page: "2" });
  if (!isAdminUsersQueryError(q2)) assert.deepEqual(q2.paging, { page: 2, limit: 20 });
  const q3 = parseAdminUsersQuery({ limit: "200", status: " active " });
  if (!isAdminUsersQueryError(q3)) { assert.equal(q3.paging.limit, 200); assert.equal(q3.status, "ACTIVE"); }
});

test("row shape equals the gateway's (legacy keys the web and mobile clients read, plus codes and labels)", () => {
  const r = mapAdminUserRow(user(1, { role: "GYM_OWNER", isActive: false }), { u1: 4 });
  assert.deepEqual(Object.keys(r).sort(), [
    "contracts", "createdAt", "email", "id", "joined", "joinedLabel", "lastActive", "lastActiveLabel", "name", "role", "roleCode",
    "roleLabel", "sessions", "status", "statusCode", "statusLabel", "updatedAt",
  ]);
  assert.equal(r.role, "Gym Owner");
  assert.equal(r.roleCode, "GYM_OWNER");
  assert.equal(r.roleLabel, "Chủ phòng gym");
  assert.equal(r.status, "Inactive");
  assert.equal(r.statusCode, "INACTIVE");
  assert.equal(r.statusLabel, "Đã khoá");
  assert.equal(r.contracts, 4);
  assert.equal(r.name, "First1 Last1");
  assert.equal(mapAdminUserRow(user(2), {}).name, "user2", "no name -> e-mail prefix");
  assert.equal(mapAdminUserRow(user(2, { role: "ADMIN" }), {}).role, "Admin");
  assert.equal(mapAdminUserRow(user(2, { role: undefined as any }), {}).roleCode, "CUSTOMER");
});

// ── the auth client must actually carry the query to the auth Lambda ──────────────────────────────────────────────────────────────────

test("auth client on Lambda: the query reaches the event as rawQueryString AND queryStringParameters", async () => {
  process.env.AUTH_LAMBDA_NAME = "fitness-assistant-dev-auth";
  const events: any[] = [];
  const original = LambdaClient.prototype.send;
  (LambdaClient.prototype as any).send = async function (cmd: any) {
    events.push(JSON.parse(Buffer.from(cmd.input.Payload).toString("utf-8")));
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ statusCode: 200, body: JSON.stringify({ users: [], total: 0 }) })) };
  };
  try {
    const { authServiceClient } = await import("../clients/auth-service.client");
    await authServiceClient.forward("get", "/auth/users", "Bearer t", undefined, { query: { page: "2", limit: "20", role: "PT", search: "Nguyễn Văn" } });
    assert.equal(events[0].rawPath, "/auth/users");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(events[0].rawQueryString)), { page: "2", limit: "20", role: "PT", search: "Nguyễn Văn" });
    assert.deepEqual(events[0].queryStringParameters, { page: "2", limit: "20", role: "PT", search: "Nguyễn Văn" });
    assert.equal(events[0].headers.authorization ?? events[0].headers.Authorization, "Bearer t");

    await authServiceClient.forward("get", "/auth/users", "Bearer t");
    assert.equal(events[1].rawQueryString, "", "no query -> exactly as before");
    assert.equal(events[1].queryStringParameters, undefined);
  } finally {
    LambdaClient.prototype.send = original;
    delete process.env.AUTH_LAMBDA_NAME;
  }
});
