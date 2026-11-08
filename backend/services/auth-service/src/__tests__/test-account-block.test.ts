import test from "node:test";
import assert from "node:assert/strict";
import { isTestAccountEmail, testAccountsBlocked } from "@gym-coach/shared";
import { authService } from "../services/auth.service";
import { authRepository, prisma } from "../repositories/auth.repository";

/**
 * Test/seed/eval accounts must not be created on the deployed server (2026-11-08): the reserved never-deliverable
 * domains every harness uses are refused when running on Lambda, while the local/test stacks (no
 * AWS_LAMBDA_FUNCTION_NAME) keep working. No real DB: repository methods are patched per test.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => { obj[key] = original; };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test("isTestAccountEmail: reserved domains only — a 'test' word in a real address is NOT a test account", () => {
  for (const e of ["aiq.a@gymini-test.local", "x@example.com", "y@sub.example.org", "z@seed.gymini.test", "w@demo.gymini.invalid", "v@gymini.example", "u@localhost"])
    assert.equal(isTestAccountEmail(e), true, e);
  for (const e of ["test.user@gmail.com", "someone@student.iuh.edu.vn", "a@examples.com", "a@mytest.com", "a@local.vn", "", null, undefined, "no-at-sign"])
    assert.equal(isTestAccountEmail(e as string), false, String(e));
});

test("testAccountsBlocked: on for Lambda by default, off locally, TEST_ACCOUNTS_POLICY overrides both ways", () => {
  assert.equal(testAccountsBlocked({}), false);
  assert.equal(testAccountsBlocked({ AWS_LAMBDA_FUNCTION_NAME: "auth" }), true);
  assert.equal(testAccountsBlocked({ AWS_LAMBDA_FUNCTION_NAME: "auth", TEST_ACCOUNTS_POLICY: "allow" }), false);
  assert.equal(testAccountsBlocked({ TEST_ACCOUNTS_POLICY: "block" }), true);
});

test("on the server, register() refuses a test-domain email before touching the database", async () => {
  let touched = 0;
  const r1 = patch(authRepository, "findUserByEmail", async () => { touched++; return null; });
  const r2 = patch(authRepository, "upsertEmailVerification", async () => { touched++; return {}; });
  try {
    await withEnv({ AWS_LAMBDA_FUNCTION_NAME: "fitness-assistant-dev-auth", TEST_ACCOUNTS_POLICY: undefined }, async () => {
      await assert.rejects(
        authService.register({ email: "aiq.nut.a@gymini-test.local", password: "TestPass#12345", firstName: "A" } as any),
        (e: any) => e.status === 400 && e.code === "TEST_ACCOUNT_BLOCKED",
      );
      await assert.rejects(
        authService.createInvitedAccount({ email: "owner@seed.gymini.test", password: "longenough1", firstName: "O" }),
        (e: any) => e.code === "TEST_ACCOUNT_BLOCKED",
      );
    });
    assert.equal(touched, 0);
  } finally { r1(); r2(); }
});

test("on the server a real address still registers; locally a test-domain address still registers", async () => {
  const r1 = patch(authRepository, "findUserByEmail", async () => null);
  const r2 = patch(authRepository, "findEmailVerificationByEmail", async () => null);
  const r3 = patch(authRepository, "upsertEmailVerification", async (d: any) => ({ ...d, attempts: 0 }));
  try {
    await withEnv({ AWS_LAMBDA_FUNCTION_NAME: "fitness-assistant-dev-auth", TEST_ACCOUNTS_POLICY: undefined }, async () => {
      const res = await authService.register({ email: "real.person@gmail.com", password: "TestPass#12345", firstName: "R" } as any);
      assert.equal(res.email, "real.person@gmail.com");
    });
    await withEnv({ AWS_LAMBDA_FUNCTION_NAME: undefined, TEST_ACCOUNTS_POLICY: undefined }, async () => {
      const res = await authService.register({ email: "aiq.nut.b@gymini-test.local", password: "TestPass#12345", firstName: "B" } as any);
      assert.equal(res.email, "aiq.nut.b@gymini-test.local");
    });
  } finally { r1(); r2(); r3(); }
});

test("listTestAccountIds returns only the ids on reserved test domains (used by payment/gym/ai admin statistics)", async () => {
  const restore = patch(prisma.user as any, "findMany", async () => [
    { id: "a", email: "real@gmail.com" }, { id: "b", email: "aiq.x@gymini-test.local" }, { id: "c", email: "pt.flow.1@example.com" },
  ]);
  try {
    assert.deepEqual(await authService.listTestAccountIds(), ["b", "c"]);
  } finally { restore(); }
});
