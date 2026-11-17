/**
 * FIX5-ADMIN-PERF (auth-service half) — `GET /auth/users` filtered + paged in the database.
 *
 * - parseUserListQuery: pure validation (TEST FIXTURE, no I/O).
 * - listUsersPage: BACKEND INTEGRATION against an isolated *_test database (skipped otherwise), e.g.
 *     DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_auth_test tsx --test src/__tests__/admin-user-list-paging.test.ts
 *   Checks the Vietnamese-diacritics search parity with the gateway's old in-memory `foldAdminSearch`,
 *   the status / role filters, stable paging, and that `total` is the match count, not the page size.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authRepository, prisma } from "../repositories/auth.repository";
import { foldSearch, isUserListQueryError, parseUserListQuery } from "../services/admin-user-list-query";

test("parseUserListQuery: nothing sent = no filter and no paging (the old full list)", () => {
  assert.deepEqual(parseUserListQuery({}), {});
});

test("parseUserListQuery: valid filters are normalised", () => {
  const q: any = parseUserListQuery({ role: "pt", status: "inactive", search: "  Nguyễn Đức ", page: "3", limit: "50", id: " abc " });
  assert.equal(q.role, "PT");
  assert.equal(q.isActive, false);
  assert.equal(q.searchKey, "nguyen duc");
  assert.equal(q.id, "abc");
  assert.deepEqual(q.paging, { page: 3, limit: 50 });
  assert.equal((parseUserListQuery({ status: "ACTIVE" }) as any).isActive, true);
  assert.deepEqual((parseUserListQuery({ page: "2" }) as any).paging, { page: 2, limit: 20 });
  assert.deepEqual((parseUserListQuery({ limit: "5" }) as any).paging, { page: 1, limit: 5 });
});

test("parseUserListQuery: a bad value is a 400 with a machine code, never ignored", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ role: "ADMIN" }, "INVALID_ROLE_FILTER"],
    [{ role: ["PT", "PT"] }, "INVALID_ROLE_FILTER"],
    [{ status: "pending" }, "INVALID_STATUS_FILTER"],
    [{ search: ["a", "b"] }, "INVALID_SEARCH"],
    [{ search: "x".repeat(101) }, "INVALID_SEARCH"],
    [{ page: "0" }, "INVALID_PAGINATION"],
    [{ page: "abc" }, "INVALID_PAGINATION"],
    [{ limit: "201" }, "INVALID_PAGINATION"],
    [{ limit: "0" }, "INVALID_PAGINATION"],
    [{ id: ["a", "b"] }, "INVALID_ID_FILTER"],
  ];
  for (const [query, code] of cases) {
    const r = parseUserListQuery(query);
    assert.ok(isUserListQueryError(r), JSON.stringify(query));
    assert.equal((r as any).code, code, JSON.stringify(query));
    assert.equal((r as any).status, 400);
  }
});

test("foldSearch matches the gateway's foldAdminSearch rule", () => {
  assert.equal(foldSearch("Nguyễn Văn Đức"), "nguyen van duc");
  assert.equal(foldSearch("ĐẶNG"), "dang");
});

// ── BACKEND INTEGRATION ────────────────────────────────────────────────────────
const safe = (() => {
  try {
    return /_test$/.test(new URL(process.env.DATABASE_URL ?? "").pathname);
  } catch {
    return false;
  }
})();
const skip = safe ? false : "Requires an isolated *_test database";
const tag = `lp${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

async function mk(firstName: string | null, lastName: string | null, opts: { role?: "CUSTOMER" | "PT" | "GYM_OWNER" | "ADMIN"; isActive?: boolean; email?: string; createdAt?: Date } = {}) {
  const u = await prisma.user.create({
    data: {
      email: opts.email ?? `${randomUUID()}@${tag}.test`,
      password: "x",
      firstName,
      lastName,
      role: opts.role ?? "CUSTOMER",
      isActive: opts.isActive ?? true,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  ids.push(u.id);
  return u;
}

test.after(async () => {
  if (!safe) return;
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("listUsersPage: diacritics-insensitive search on name and email (same as the old in-memory filter)", { skip }, async () => {
  const a = await mk("Nguyễn", `Văn Đức ${tag}`);
  const b = await mk("Phạm", `Thu Uyên ${tag}`);
  const c = await mk(null, null, { email: `Quan.Ly.${tag}@example.test` });
  const search = (key: string) => authRepository.listUsersPage({ searchKey: key, page: 1, limit: 50 });

  assert.deepEqual((await search(`nguyen van duc ${tag}`)).users.map((u) => u.id), [a.id]);
  assert.deepEqual((await search(`duc ${tag}`)).users.map((u) => u.id), [a.id], "Đ folds to d");
  assert.deepEqual((await search(`thu uyen ${tag}`)).users.map((u) => u.id), [b.id]);
  assert.deepEqual((await search(`quan.ly.${tag}`)).users.map((u) => u.id), [c.id], "email match, case-insensitive");
  // Both rows carry the tag; both found, total = 3 for the bare tag.
  const all = await search(tag);
  assert.equal(all.total, 3);
  assert.equal((await search(`khong-co-${tag}`)).total, 0);
  // Parity with the JS rule for every row of the fixture.
  for (const u of [a, b, c]) {
    const hay = foldSearch([u.firstName, u.lastName].filter(Boolean).join(" "));
    const key = hay.includes(tag) ? tag : "";
    assert.ok(key === "" || (await search(key)).users.some((x) => x.id === u.id));
  }
});

test("listUsersPage: role (ADMIN never listed), status and id filters", { skip }, async () => {
  const pt = await mk("Pt", `Active ${tag}`, { role: "PT" });
  const locked = await mk("Pt", `Locked ${tag}`, { role: "PT", isActive: false });
  const admin = await mk("Boss", `Admin ${tag}`, { role: "ADMIN" });
  const owner = await mk("Own", `Er ${tag}`, { role: "GYM_OWNER" });

  const everyone = await authRepository.listUsersPage({ searchKey: tag, page: 1, limit: 100 });
  assert.ok(!everyone.users.some((u) => u.id === admin.id), "no role filter = everyone but ADMIN");

  const pts = await authRepository.listUsersPage({ role: "PT" as any, searchKey: tag, page: 1, limit: 100 });
  assert.deepEqual(new Set(pts.users.map((u) => u.id)), new Set([pt.id, locked.id]));
  const lockedOnly = await authRepository.listUsersPage({ role: "PT" as any, isActive: false, searchKey: tag, page: 1, limit: 100 });
  assert.deepEqual(lockedOnly.users.map((u) => u.id), [locked.id]);
  const activeOnly = await authRepository.listUsersPage({ role: "PT" as any, isActive: true, searchKey: tag, page: 1, limit: 100 });
  assert.deepEqual(activeOnly.users.map((u) => u.id), [pt.id]);
  assert.deepEqual((await authRepository.listUsersPage({ role: "GYM_OWNER" as any, searchKey: tag, page: 1, limit: 100 })).users.map((u) => u.id), [owner.id]);

  const one = await authRepository.listUsersPage({ id: pt.id, page: 1, limit: 1 });
  assert.deepEqual(one.users.map((u) => u.id), [pt.id]);
  assert.equal(one.total, 1);
  assert.equal((await authRepository.listUsersPage({ id: admin.id, page: 1, limit: 1 })).total, 0, "an ADMIN id is not listable");
});

test("listUsersPage: newest first, stable pages, total is the match count, past-the-end page is empty with the real total", { skip }, async () => {
  const base = Date.now();
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(await mk("Order", `${tag}-${i}`, { createdAt: new Date(base - i * 1000) }));
  const expected = rows.map((r) => r.id); // i=0 newest
  const p1 = await authRepository.listUsersPage({ searchKey: `${tag}-`, page: 1, limit: 2 });
  const p2 = await authRepository.listUsersPage({ searchKey: `${tag}-`, page: 2, limit: 2 });
  const p3 = await authRepository.listUsersPage({ searchKey: `${tag}-`, page: 3, limit: 2 });
  assert.deepEqual([...p1.users, ...p2.users, ...p3.users].map((u) => u.id), expected);
  assert.equal(p1.total, 5);
  assert.equal(p3.users.length, 1);
  const past = await authRepository.listUsersPage({ searchKey: `${tag}-`, page: 9, limit: 2 });
  assert.equal(past.users.length, 0);
  assert.equal(past.total, 5);
  // The row shape is the one the gateway maps (no password hash, no extra columns).
  assert.deepEqual(Object.keys(p1.users[0]).sort(), ["createdAt", "email", "firstName", "id", "isActive", "lastName", "role", "updatedAt"]);
  // No paging = every match (the unpaged filtered call the gateway uses for partner roles).
  assert.equal((await authRepository.listUsersPage({ searchKey: `${tag}-` })).users.length, 5);
});
