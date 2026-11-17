import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app";
import { authRepository } from "../repositories/auth.repository";

/**
 * FIX5-ADMIN-PERF — GET /auth/users with page / limit / search / status / id: the route validates, calls the
 * paged repository query once and answers `{ users, total, page, limit, totalPages }`; with none of them it is the
 * unchanged full list. TEST FIXTURE repository, REAL HTTP/API on the auth-service app.
 */
const SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const adminToken = jwt.sign({ userId: ADMIN_ID, role: "ADMIN", email: "a@example.com" }, SECRET, { expiresIn: "15m" });

let server: http.Server;
let baseUrl = "";
const restores: Array<() => void> = [];
const pageCalls: any[] = [];
let fullCalls = 0;

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown) {
  const original = obj[key];
  obj[key] = impl as T[K];
  restores.push(() => {
    obj[key] = original;
  });
}

test.before(async () => {
  patch(authRepository, "findUserById", async (id: string) => (id === ADMIN_ID ? { id, email: "a@example.com", role: "ADMIN", isActive: true } : null));
  patch(authRepository, "listUsers", async () => {
    fullCalls++;
    return [{ id: "u1" }];
  });
  patch(authRepository, "listUsersPage", async (q: any) => {
    pageCalls.push(q);
    return { users: [{ id: "u1" }, { id: "u2" }], total: 45 };
  });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.after(async () => {
  restores.forEach((r) => r());
  await new Promise<void>((r) => server.close(() => r()));
});
const get = (qs: string) => fetch(`${baseUrl}/auth/users${qs}`, { headers: { Authorization: `Bearer ${adminToken}` } });

test("page + limit + filters: one paged query with the folded search key, answer carries total / totalPages", async () => {
  pageCalls.length = 0;
  fullCalls = 0;
  const res = await get("?page=2&limit=20&role=pt&status=inactive&search=Nguy%E1%BB%85n%20%C4%90%E1%BB%A9c");
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.total, 45);
  assert.equal(body.page, 2);
  assert.equal(body.limit, 20);
  assert.equal(body.totalPages, 3);
  assert.equal(body.users.length, 2);
  assert.equal(fullCalls, 0, "the full-list query is not used for a paged request");
  assert.deepEqual(pageCalls, [{ role: "PT", isActive: false, searchKey: "nguyen duc", id: undefined, ids: undefined, page: 2, limit: 20 }]);
});

test("no parameter keeps the unchanged full list; search without paging is filtered but unpaged", async () => {
  pageCalls.length = 0;
  fullCalls = 0;
  const bare: any = await (await get("")).json();
  assert.deepEqual(bare, { users: [{ id: "u1" }] });
  assert.equal(fullCalls, 1);
  assert.equal(pageCalls.length, 0);
  const filtered: any = await (await get("?role=GYM_OWNER&status=ACTIVE")).json();
  assert.equal(filtered.total, 45);
  assert.equal(filtered.page, undefined, "no page/limit sent -> no paging fields");
  assert.deepEqual(pageCalls[0], { role: "GYM_OWNER", isActive: true, searchKey: undefined, id: undefined, ids: undefined });
});

test("bad page / limit / status / search -> 400 with a code and the repository is never queried", async () => {
  pageCalls.length = 0;
  fullCalls = 0;
  const cases: Array<[string, string]> = [
    ["?page=0", "INVALID_PAGINATION"],
    ["?limit=500", "INVALID_PAGINATION"],
    ["?page=x&limit=5", "INVALID_PAGINATION"],
    ["?status=pending", "INVALID_STATUS_FILTER"],
    ["?search=a&search=b", "INVALID_SEARCH"],
    ["?ids=a&ids=b", "INVALID_IDS_FILTER"],
  ];
  for (const [qs, code] of cases) {
    const res = await get(qs);
    assert.equal(res.status, 400, qs);
    assert.equal(((await res.json()) as any).code, code, qs);
  }
  assert.equal(pageCalls.length + fullCalls, 0);
});
