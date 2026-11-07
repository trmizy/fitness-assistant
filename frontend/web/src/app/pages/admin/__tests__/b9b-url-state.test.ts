import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAiParams, buildUserParams, paginate, parseAiFilter, parseAiTab, parsePageParam, parseUserRole, parseUserStatus } from "../shared/b9bUrlState";

test("parsePageParam is total", () => {
  assert.equal(parsePageParam("3"), 3);
  for (const bad of [null, undefined, "", "0", "-2", "1.5", "abc", "1e9", "999999"]) assert.equal(parsePageParam(bad), 1, String(bad));
});
test("paginate clamps the page and slices", () => {
  const a = Array.from({ length: 27 }, (_, i) => i);
  assert.deepEqual(paginate(a, 2, 10).rows, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const last = paginate(a, 99, 10);
  assert.equal(last.page, 3); assert.equal(last.rows.length, 7); assert.equal(last.pages, 3);
  const empty = paginate([], 5, 10);
  assert.deepEqual([empty.page, empty.pages, empty.total, empty.rows.length], [1, 1, 0, 0]);
});
test("user filter parsers fall back to All", () => {
  assert.equal(parseUserRole("PT"), "PT"); assert.equal(parseUserRole("RECEPTIONIST"), "RECEPTIONIST");
  assert.equal(parseUserRole("root"), "All"); assert.equal(parseUserRole(null), "All");
  assert.equal(parseUserStatus("Inactive"), "Inactive"); assert.equal(parseUserStatus("x"), "All");
});
test("buildUserParams omits defaults", () => {
  assert.deepEqual(buildUserParams({}), {});
  assert.deepEqual(buildUserParams({ role: "All", status: "All", q: "  ", page: 1 }), {});
  assert.deepEqual(buildUserParams({ id: "u1", role: "PT", status: "Pending", q: "an", page: 3 }), { id: "u1", role: "PT", status: "Pending", q: "an", page: "3" });
});
test("AI tab/filter parsers and params", () => {
  assert.equal(parseAiTab("queue"), "queue"); assert.equal(parseAiTab("nope"), "requests");
  assert.equal(parseAiFilter("slow"), "slow"); assert.equal(parseAiFilter("zzz"), "all");
  assert.deepEqual(buildAiParams({}), {});
  assert.deepEqual(buildAiParams({ tab: "requests", filter: "slow", page: 2, id: "t1" }), { filter: "slow", page: "2", id: "t1" });
  assert.deepEqual(buildAiParams({ tab: "errors", filter: "slow", page: 2 }), { tab: "errors" });
});
