/**
 * FIX5-ADMIN-PERF - the admin Người dùng / Hồ sơ PT lists page on the server.
 * TEST FIXTURE: the pure query builder; CODE AUDIT: source guards that the pages no longer download everything.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverUserQuery, USER_PAGE_SIZE } from "../shared/b9bUrlState";

const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("serverUserQuery", () => {
  it("defaults: page 1, the page size, no filters", () => {
    assert.deepEqual(serverUserQuery({}), { page: 1, limit: USER_PAGE_SIZE });
    assert.deepEqual(serverUserQuery({ role: "All", status: "All", q: "  ", page: 0 }), { page: 1, limit: USER_PAGE_SIZE });
  });
  it("role: Client/PT map to the account role, partner roles to partnerRole", () => {
    assert.equal(serverUserQuery({ role: "Client" }).role, "CUSTOMER");
    assert.equal(serverUserQuery({ role: "PT" }).role, "PT");
    for (const r of ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      const q = serverUserQuery({ role: r });
      assert.equal(q.partnerRole, r);
      assert.equal(q.role, undefined);
    }
  });
  it("status, search (trimmed) and page are forwarded", () => {
    assert.deepEqual(serverUserQuery({ status: "Inactive", q: " nguyễn ", page: 4 }, 10), { page: 4, limit: 10, status: "INACTIVE", search: "nguyễn" });
    assert.equal(serverUserQuery({ status: "Active" }).status, "ACTIVE");
  });
});

describe("source guards", () => {
  it("UserManagement asks the server for one page and no longer filters / slices in the browser", () => {
    const src = read("app/pages/admin/UserManagement.tsx");
    assert.match(src, /serverUserQuery\(/);
    assert.match(src, /api\.get\("\/admin\/users", \{ params/);
    assert.ok(!/api\.get\("\/admin\/users"\)/.test(src), "no bare call that downloads every account");
    assert.ok(!/paginate\(/.test(src));
  });
  it("PTManagement uses the paged service call with the search sent to the server", () => {
    const src = read("app/pages/admin/PTManagement.tsx");
    assert.match(src, /listApplicationsPage\(/);
    assert.ok(!/ptApplicationService\.listApplications\(/.test(src));
    assert.match(src, /data-testid="pt-pagination"/);
    const svc = read("app/services/ptApplicationService.ts");
    assert.match(svc, /x-total-count/);
  });
});

describe("bare callers are bounded (FIX5-ADMIN-PERF round 2)", () => {
  it("the PT picker searches on the server and downloads nothing until something is typed", () => {
    const src = read("app/pages/admin/listings/TargetPicker.tsx");
    assert.match(src, /listApplicationsPage\(\{ status: "APPROVED", q: debouncedQ, page: 1, limit: 8 \}\)/);
    assert.match(src, /enabled: kind === "pts" \? debouncedQ\.length > 0 : true/);
    assert.ok(!/listApplications\(\{ status: "APPROVED" \}\)/.test(src));
  });
  it("the queue read is one bounded page (<= 200) and flags a lower bound at the cap", () => {
    const svc = read("app/services/ptApplicationService.ts");
    assert.match(svc, /ADMIN_QUEUE_READ_CAP = 200/);
    assert.match(svc, /page: 1, limit: ADMIN_QUEUE_READ_CAP, \.\.\.params/);
    const today = read("app/pages/admin/today/todayModel.ts");
    assert.match(today, /capped: list\.length >= PT_QUEUE_READ_CAP/);
  });
});
