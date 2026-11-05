/**
 * INT-01 - GET /admin/dispute-cases/admins (disputeCase.admins.list). BACKEND INTEGRATION over REAL HTTP into the real user-service express app on an
 * ephemeral port; isolated *_test DB (TEST_DATABASE_URL). auth-service is a TEST FIXTURE: verifyToken stub (token "ROLE:id") and the directory seam.
 *   FITNESS_DISABLE_REDIS=true npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/dispute-case-admins-list.integration.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { authServiceClient } from "../clients/auth-service.client";
import { setAdminDirectoryLookupForTests } from "../services/dispute-case/admin-account";

let base = "";
let server: any;
let restoreVerify: () => void;

test.before(async () => {
  const original = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const [role, id] = header.replace(/^Bearer /, "").split(":");
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  restoreVerify = () => ((authServiceClient as any).verifyToken = original);
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(() => {
  setAdminDirectoryLookupForTests();
  restoreVerify?.();
  server?.close();
});

const get = (token?: string) => fetch(`${base}/admin/dispute-cases/admins`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test("ADMIN gets only id + displayName (no email, no other field); missing names become null", async () => {
  setAdminDirectoryLookupForTests(async () => [
    { id: "a1", firstName: "Lan", lastName: " Nguyễn ", email: "secret@x.test" } as any,
    { id: "a2", firstName: null, lastName: null },
  ]);
  const res = await get("ADMIN:a1");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    { id: "a1", displayName: "Lan Nguyễn" },
    { id: "a2", displayName: null },
  ]);
});

test("non-admin is refused 403, anonymous 401", async () => {
  setAdminDirectoryLookupForTests(async () => [{ id: "a1" }]);
  assert.equal((await get("CUSTOMER:u1")).status, 403);
  assert.equal((await get("PT:u2")).status, 403);
  assert.equal((await get()).status, 401);
});

test("auth-service unreachable -> 503 ACCOUNT_LOOKUP_UNAVAILABLE", async () => {
  setAdminDirectoryLookupForTests(); // the real HTTP lookup, pointed at a dead port
  const prev = process.env.AUTH_SERVICE_URL;
  const prevLambda = process.env.AUTH_LAMBDA_NAME;
  process.env.AUTH_SERVICE_URL = "http://127.0.0.1:1";
  delete process.env.AUTH_LAMBDA_NAME;
  try {
    const res = await get("ADMIN:a1");
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "ACCOUNT_LOOKUP_UNAVAILABLE");
  } finally {
    process.env.AUTH_SERVICE_URL = prev;
    if (prevLambda !== undefined) process.env.AUTH_LAMBDA_NAME = prevLambda;
  }
});
