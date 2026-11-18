/**
 * ADM-01 (partner retest 2026-11-18): the admin PT list searches user_profiles.email in SQL, but 5 of 68 approved trainers had a profile row
 * with a NULL email (the UI still showed it, fetched from auth-service at display time), so "search by email" found nothing while
 * "search by name" worked. persistMissingProfileEmail keeps the auth email in the profile while the column is empty.
 * Pure unit test: the repository is a stub, no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { persistMissingProfileEmail } from "../services/pt_application.service";

const flush = () => new Promise((r) => setImmediate(r));
const stubRepo = () => {
  const calls: Array<[string, string]> = [];
  return { calls, repo: { backfillEmail: async (u: string, e: string) => { calls.push([u, e]); return { count: 1 }; } } };
};

test("an empty profile email is filled from the auth email (trimmed)", async () => {
  const { calls, repo } = stubRepo();
  persistMissingProfileEmail({ userId: "u1", email: null }, "  pt@gymini.vn ", repo);
  await flush();
  assert.deepEqual(calls, [["u1", "pt@gymini.vn"]]);
});

test("an existing profile email is never touched", async () => {
  const { calls, repo } = stubRepo();
  persistMissingProfileEmail({ userId: "u1", email: "already@x.vn" }, "other@x.vn", repo);
  await flush();
  assert.equal(calls.length, 0);
});

test("nothing to write when auth has no email, or the profile is unknown", async () => {
  const { calls, repo } = stubRepo();
  persistMissingProfileEmail({ userId: "u1", email: null }, "", repo);
  persistMissingProfileEmail({ userId: "u1", email: null }, null, repo);
  persistMissingProfileEmail({ userId: "u1", email: null }, "   ", repo);
  persistMissingProfileEmail(null, "a@b.vn", repo);
  persistMissingProfileEmail({ userId: null, email: null }, "a@b.vn", repo);
  await flush();
  assert.equal(calls.length, 0);
});

test("a failing write is swallowed: it must never fail the admin response", async () => {
  const repo = { backfillEmail: async () => { throw new Error("db down"); } };
  assert.doesNotThrow(() => persistMissingProfileEmail({ userId: "u1", email: null }, "a@b.vn", repo));
  await flush();
});

test("a synchronous throw inside the repository is swallowed too", async () => {
  const repo = { backfillEmail: () => { throw new Error("sync boom"); } } as any;
  assert.doesNotThrow(() => persistMissingProfileEmail({ userId: "u1", email: null }, "a@b.vn", repo));
  await flush();
});
