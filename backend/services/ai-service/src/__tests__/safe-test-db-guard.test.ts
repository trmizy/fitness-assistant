/**
 * Phase 3 R2 — N5: unit tests for the test-database safety guard itself
 * (test-utils/safe-test-db.ts). No real DB connection — this only checks the
 * guard's decision logic, which is what the rest of the suite's mutation-
 * capable tests rely on to refuse an unsafe target before touching any row.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeTestDatabase, UnsafeTestDatabaseTargetError } from "../test-utils/safe-test-db";

const originalNodeEnv = process.env.NODE_ENV;
test.after(() => { process.env.NODE_ENV = originalNodeEnv; });

test("A. the isolated test DB (localhost:55433, *_test, NODE_ENV=test) is accepted", () => {
  process.env.NODE_ENV = "test";
  assert.doesNotThrow(() => assertSafeTestDatabase("postgresql://u:p@localhost:55433/gymcoach_ai_test?schema=public", "gymcoach_ai_test"));
});

test("B. a dev-like DB (same host, dev port 5433) is rejected", () => {
  process.env.NODE_ENV = "test";
  assert.throws(
    () => assertSafeTestDatabase("postgresql://u:p@localhost:5433/gymcoach_ai", "gymcoach_ai"),
    (err: any) => { assert.equal(err.code, "UNSAFE_TEST_DATABASE_TARGET"); return true; },
  );
});

test("B2. a non-_test database name on the right port is also rejected", () => {
  process.env.NODE_ENV = "test";
  assert.throws(
    () => assertSafeTestDatabase("postgresql://u:p@localhost:55433/gymcoach_ai", "gymcoach_ai"),
    UnsafeTestDatabaseTargetError,
  );
});

test("C. NODE_ENV not \"test\" is rejected even if the URL itself looks like the isolated test DB", () => {
  process.env.NODE_ENV = "development";
  assert.throws(
    () => assertSafeTestDatabase("postgresql://u:p@localhost:55433/gymcoach_ai_test", "gymcoach_ai_test"),
    (err: any) => { assert.equal(err.code, "UNSAFE_TEST_DATABASE_TARGET"); return true; },
  );
});

test("D. the error message never contains the credential portion of the URL", () => {
  process.env.NODE_ENV = "test";
  try {
    assertSafeTestDatabase("postgresql://realuser:realsecret@prod-host:5432/gymcoach_ai", "gymcoach_ai");
    assert.fail("must have thrown");
  } catch (err: any) {
    assert.ok(!err.message.includes("realsecret"), "credential must never appear in the thrown message");
    assert.ok(!err.message.includes("realuser"), "username must never appear in the thrown message");
  }
});

test("E. a remote (non-localhost) host is rejected even on the right port/db name pattern", () => {
  process.env.NODE_ENV = "test";
  assert.throws(
    () => assertSafeTestDatabase("postgresql://u:p@some-rds-instance.amazonaws.com:55433/gymcoach_ai_test", "gymcoach_ai_test"),
    (err: any) => { assert.equal(err.code, "UNSAFE_TEST_DATABASE_TARGET"); return true; },
  );
});
