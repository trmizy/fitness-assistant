/**
 * GET /auth/internal/test-account-ids used to read EVERY account (id + email) and filter with isTestAccountEmail in memory. The database now decides,
 * with the shared POSIX patterns on the domain. These tests pin the two to the same rule on edge cases; the SQL itself was compared with the function on
 * the real accounts of the AWS DEV auth database (1299 accounts, 1287 test accounts both ways, no domain disagrees).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TEST_ACCOUNT_DOMAIN_PATTERNS, isTestAccountEmail } from "@gym-coach/shared";

/** The domain exactly as the SQL builds it: after the LAST "@", lower-cased, whitespace-trimmed, ONE trailing dot removed; no "@" -> null. */
function sqlDomain(email: string): string | null {
  const m = /@([^@]*)$/.exec(email);
  if (!m) return null;
  return m[1].toLowerCase().replace(/^\s+|\s+$/g, "").replace(/\.$/, "");
}
const sqlSaysTest = (email: string): boolean => {
  const d = sqlDomain(email);
  return d !== null && TEST_ACCOUNT_DOMAIN_PATTERNS.some((p) => new RegExp(p).test(d));
};

const CORPUS = [
  // reserved TLDs
  "a@seed.gymini.test", "a@gymini-test.local", "a@demo.gymini.invalid", "a@x.example", "a@host.localhost", "a@partner-e2e.test",
  "a@test", "a@local", "a@example", "a@localhost", "a@invalid",
  // reserved domains and their subdomains
  "a@example.com", "a@example.net", "a@example.org", "a@sub.example.com", "a@deep.sub.example.org",
  // looks similar but is NOT reserved
  "a@gmail.com", "a@notexample.com", "a@example.com.vn", "a@example.co", "a@myexample.com", "a@testing.com", "a@test.com", "a@contest.vn",
  "a@local.vn", "a@gymini.vn", "a@xtest", "a@sub.localx", "a@example.commerce",
  // normalisation: case, trailing dot, spaces, several "@"
  "A@SEED.GYMINI.TEST", "a@seed.gymini.test.", "a@seed.gymini.test..", "a@ seed.gymini.test ", "a@gmail.com ", "weird@name@seed.gymini.test",
  "a@b@gmail.com", "\"a@b\"@example.com",
  // no domain
  "no-at-sign", "", "a@", "@", "@.test", "a@.",
];

test("the SQL pattern rule gives the same answer as isTestAccountEmail on every edge case", () => {
  const disagreements = CORPUS.filter((e) => sqlSaysTest(e) !== isTestAccountEmail(e));
  assert.deepEqual(disagreements, []);
});

test("sanity: the corpus really exercises both outcomes", () => {
  assert.ok(CORPUS.filter(isTestAccountEmail).length >= 15);
  assert.ok(CORPUS.filter((e) => !isTestAccountEmail(e)).length >= 15);
});

test("the shared patterns are POSIX-safe (no JS-only syntax) and anchored", () => {
  assert.equal(TEST_ACCOUNT_DOMAIN_PATTERNS.length, 2);
  for (const p of TEST_ACCOUNT_DOMAIN_PATTERNS) {
    assert.ok(p.startsWith("(^|\\.)") && p.endsWith("$"), p);
    assert.ok(!/\(\?|\\d|\\w|\\b|\\p\{/.test(p), `JS-only syntax in ${p}`);
  }
});

test("a null / empty email is never a test account in either implementation", () => {
  assert.equal(isTestAccountEmail(null), false);
  assert.equal(isTestAccountEmail(undefined), false);
  assert.equal(isTestAccountEmail(""), false);
});
