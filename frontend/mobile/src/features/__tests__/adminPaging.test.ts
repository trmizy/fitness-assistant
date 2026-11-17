/**
 * FIX5-ADMIN-PERF — the admin "Người dùng" and "Đơn ứng tuyển PT" lists page on the server.
 *
 * Chạy: npx tsx --test src/features/__tests__/adminPaging.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeUserPages, nextUserPage, userListParams, userPage, USER_PAGE_SIZE } from "../admin/adminUsers";
import { mergePtPages, nextPtPage, ptListParams, PT_PAGE_SIZE, PT_QUEUE_FILTERS } from "../admin/adminModeration";
import { userDirectory } from "../admin/adminWithdrawals";

const u = (id: string) => ({ id, name: `U ${id}`, email: `${id}@x.test`, role: "Client", status: "Active" });
const page = (ids: string[], n: number, totalPages: number, total = 45) => ({ success: true, data: { total, page: n, limit: 20, totalPages, users: ids.map(u) } });

describe("userListParams", () => {
  it("defaults: page 1, the page size, no filter", () => {
    assert.deepEqual(userListParams({}), { page: 1, limit: USER_PAGE_SIZE });
    assert.deepEqual(userListParams({ q: "  ", role: "ALL", status: "ALL", page: 0 }), { page: 1, limit: USER_PAGE_SIZE });
  });
  it("chips map to the server's codes, search is trimmed", () => {
    assert.deepEqual(userListParams({ q: " nguyễn ", role: "Client", status: "Inactive", page: 3 }), {
      page: 3,
      limit: 20,
      role: "CUSTOMER",
      status: "INACTIVE",
      search: "nguyễn",
    });
    assert.equal(userListParams({ role: "PT" }).role, "PT");
    assert.equal(userListParams({ role: "Gym Owner" }).role, "GYM_OWNER");
    assert.equal(userListParams({ status: "Active" }).status, "ACTIVE");
  });
});

describe("user pages", () => {
  it("userPage reads rows and paging facts; missing facts fall back safely", () => {
    const p = userPage(page(["a", "b"], 2, 3));
    assert.deepEqual([p.rows.length, p.total, p.page, p.totalPages], [2, 45, 2, 3]);
    const bare = userPage({ data: { users: [u("x")] } });
    assert.deepEqual([bare.rows.length, bare.total, bare.page, bare.totalPages], [1, 1, 1, 1]);
    assert.equal(userPage(null).rows.length, 0);
  });
  it("nextUserPage is the following page, undefined on the last one", () => {
    assert.equal(nextUserPage(page(["a"], 1, 3)), 2);
    assert.equal(nextUserPage(page(["a"], 3, 3)), undefined);
    assert.equal(nextUserPage(page([], 1, 1, 0)), undefined);
  });
  it("mergeUserPages flattens in order and drops a row that moved into the next page", () => {
    const rows = mergeUserPages([page(["a", "b"], 1, 2), page(["b", "c"], 2, 2)]);
    assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(mergeUserPages(undefined), []);
  });
});

describe("withdrawal owner lookup", () => {
  it("the ids lookup answer is read by the same directory reader as before", () => {
    const m = userDirectory({ success: true, data: { users: [{ id: "o1", name: "An", email: "an@x.test" }] } });
    assert.equal(m.get("o1")?.name, "An");
  });
});

describe("PT applications", () => {
  it("ptListParams: status always sent; the work queue reads oldest first, finished ones newest first", () => {
    assert.deepEqual(ptListParams({ status: "SUBMITTED" }), { status: "SUBMITTED", page: 1, limit: PT_PAGE_SIZE, order: "oldest" });
    assert.equal(ptListParams({ status: "UNDER_REVIEW" }).order, "oldest");
    assert.equal(ptListParams({ status: "NEEDS_MORE_INFO" }).order, "oldest");
    assert.equal(ptListParams({ status: "APPROVED" }).order, undefined);
    assert.equal(ptListParams({ status: "REJECTED", q: " Lan ", page: 2 }).q, "Lan");
    assert.equal(ptListParams({ status: "REJECTED", page: 2 }).page, 2);
  });
  it("there is no chip for drafts (not an admin matter)", () => {
    assert.ok(!PT_QUEUE_FILTERS.some((f) => f.value === "DRAFT"));
    assert.equal(PT_QUEUE_FILTERS[0].value, "SUBMITTED");
  });
  it("nextPtPage follows the X-Total-Count total", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }));
    assert.equal(nextPtPage({ rows, total: 45 }, 1), 2);
    assert.equal(nextPtPage({ rows, total: 45 }, 2), 3);
    assert.equal(nextPtPage({ rows: rows.slice(0, 5), total: 45 }, 3), undefined);
    assert.equal(nextPtPage({ rows, total: 20 }, 1), undefined);
    assert.equal(nextPtPage({ rows: [], total: 45 }, 1), undefined);
    assert.equal(nextPtPage(undefined, 1), undefined);
  });
  it("mergePtPages flattens and de-duplicates", () => {
    const a = (id: string) => ({ id, status: "SUBMITTED" });
    assert.deepEqual(mergePtPages([{ rows: [a("1"), a("2")] }, { rows: [a("2"), a("3")] }]).map((r) => r.id), ["1", "2", "3"]);
    assert.deepEqual(mergePtPages(undefined), []);
  });
});
