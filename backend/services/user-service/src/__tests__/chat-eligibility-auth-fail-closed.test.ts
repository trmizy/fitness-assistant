import test from "node:test";
import assert from "node:assert/strict";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { contractController } from "../controllers/contract.controller";

/**
 * Audit finding #4 - the account-status check behind chat eligibility and call permission must FAIL CLOSED.
 * It used to answer "active" whenever auth-service could not be reached, so a deactivated / banned account could chat and
 * call for as long as auth-service was down.
 *
 * TEST FIXTURE: auth-service (authServiceClient) and the contracts lookup are stubbed at their boundary; no database.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const authAnswers = (byUser: Record<string, unknown>) =>
  patch(authServiceClient, "internalGet", async (path: string) => {
    const id = path.split("/").pop()!;
    const v = byUser[id];
    if (v instanceof Error) throw v;
    return { status: 200, data: v };
  });

const httpError = (status: number) => Object.assign(new Error(`auth-service responded ${status}`), { response: { status, data: {} } });

test("checkRelationship: auth-service down -> throws AuthServiceUnavailableError, never { blocked: false }", async () => {
  const restore = authAnswers({ a: new AuthServiceUnavailableError(new Error("ECONNREFUSED")), b: { user: { isActive: true } } });
  try {
    await assert.rejects(() => contractService.checkRelationship("a", "b"), (e) => e instanceof AuthServiceUnavailableError);
  } finally {
    restore();
  }
});

test("checkRelationship: a 5xx or a rejected service secret from auth-service is also a failed check, not 'active'", async () => {
  for (const status of [500, 502, 401, 403]) {
    const restore = authAnswers({ a: httpError(status), b: { user: { isActive: true } } });
    try {
      await assert.rejects(() => contractService.checkRelationship("a", "b"), (e) => e instanceof AuthServiceUnavailableError, `status ${status}`);
    } finally {
      restore();
    }
  }
});

test("checkRelationship: a deactivated account is blocked; active accounts are not; an unknown account (404) is not blocked", async () => {
  let restore = authAnswers({ a: { user: { isActive: false } }, b: { user: { isActive: true } } });
  try {
    assert.deepEqual(await contractService.checkRelationship("a", "b"), { blocked: true });
  } finally {
    restore();
  }
  restore = authAnswers({ a: { user: { isActive: true } }, b: { user: { isActive: true } } });
  try {
    assert.deepEqual(await contractService.checkRelationship("a", "b"), { blocked: false });
  } finally {
    restore();
  }
  restore = authAnswers({ a: httpError(404), b: { user: { isActive: true } } });
  try {
    assert.deepEqual(await contractService.checkRelationship("a", "b"), { blocked: false });
  } finally {
    restore();
  }
});

test("computeChatEligibility (existing contract relationship): auth-service down -> throws, never ACTIVE_CONTRACT", async () => {
  const restoreRepo = patch(contractRepository, "findRelationshipByPair", async () => ({ id: "c1" }));
  const restore = authAnswers({ a: new AuthServiceUnavailableError(new Error("timeout")), b: new AuthServiceUnavailableError(new Error("timeout")) });
  try {
    await assert.rejects(() => contractService.computeChatEligibility("a", "b"), (e) => e instanceof AuthServiceUnavailableError);
  } finally {
    restore();
    restoreRepo();
  }
});

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return res;
}

test("controllers answer 503 (not 200 / not a generic 500) when the account check cannot be made", async () => {
  const restoreRepo = patch(contractRepository, "findRelationshipByPair", async () => ({ id: "c1" }));
  const restore = authAnswers({ a: new AuthServiceUnavailableError(new Error("down")), b: { user: { isActive: true } } });
  try {
    const r1 = fakeRes();
    await contractController.checkRelationship({ query: { userAId: "a", userBId: "b" } } as any, r1);
    assert.equal(r1.statusCode, 503);
    const r2 = fakeRes();
    await contractController.chatEligibility({ query: { fromUserId: "a", toUserId: "b" } } as any, r2);
    assert.equal(r2.statusCode, 503);
  } finally {
    restore();
    restoreRepo();
  }
});
