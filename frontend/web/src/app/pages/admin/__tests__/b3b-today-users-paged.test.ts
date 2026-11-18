/**
 * The "Hôm nay" admin page read EVERY account through GET /auth/users. On AWS a Lambda answer is capped at ~6 MB (37k accounts are ~8 MB), so it now
 * reads one page of the newest accounts from GET /admin/users and the total from the envelope. Pure reader test.
 * Run: npx tsx --test src/app/pages/admin/__tests__/b3b-today-users-paged.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeUsers } from "../today/todayModel";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const D = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const page = (users: unknown[], total: number) => ({ success: true, data: { total, page: 1, limit: 200, totalPages: 1, users } });

describe("summarizeUsers reads the paged /admin/users envelope", () => {
  it("total comes from the envelope, not from the page length", () => {
    const r = summarizeUsers(page([{ createdAt: ago(D) }, { createdAt: ago(30 * D) }], 37_419), NOW);
    assert.deepEqual(r, { total: 37_419, newLast7d: 1 });
  });
  it("a page that still holds an older account gives an EXACT new-count (newest first)", () => {
    const r = summarizeUsers(page([{ createdAt: ago(D) }, { createdAt: ago(2 * D) }, { createdAt: ago(9 * D) }], 5000), NOW);
    assert.deepEqual(r, { total: 5000, newLast7d: 2 });
  });
  it("the whole page fresh but more accounts exist: the new-count is UNKNOWN (null), never a smaller guess", () => {
    const r = summarizeUsers(page([{ createdAt: ago(D) }, { createdAt: ago(2 * D) }], 5000), NOW);
    assert.deepEqual(r, { total: 5000, newLast7d: null });
  });
  it("all accounts fit in the page: exact even when every one is fresh", () => {
    assert.deepEqual(summarizeUsers(page([{ createdAt: ago(D) }, { createdAt: ago(2 * D) }], 2), NOW), { total: 2, newLast7d: 2 });
  });
  it("an unreadable createdAt still makes the new-count unknown", () => {
    assert.deepEqual(summarizeUsers(page([{ createdAt: ago(D) }, { createdAt: "x" }], 2), NOW), { total: 2, newLast7d: null });
  });
  it("a missing total falls back to the page length; the legacy { users } shape still works; junk is null", () => {
    assert.deepEqual(summarizeUsers({ data: { users: [{ createdAt: ago(D) }] } }, NOW), { total: 1, newLast7d: 1 });
    assert.deepEqual(summarizeUsers({ users: [{ createdAt: ago(D) }, { createdAt: ago(8 * D) }] }, NOW), { total: 2, newLast7d: 1 });
    assert.equal(summarizeUsers({ data: { users: "x" } }, NOW), null);
    assert.equal(summarizeUsers(null, NOW), null);
  });
});
