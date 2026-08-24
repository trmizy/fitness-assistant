import test from "node:test";
import assert from "node:assert/strict";
import { contractController } from "../controllers/contract.controller";
import { contractService } from "../services/contract.service";

/**
 * Money-flow redesign plan item 2.1 — "đọc được hợp đồng của người khác".
 *
 * `GET /contracts/:id` was authenticated (authMiddleware requires a valid token) but NOT
 * authorized — any logged-in account, knowing (or guessing/enumerating) a contract id, could
 * read another client's or PT's contract: price, session count, revenue split, personal notes.
 * `moneyBreakdown` and `terminate` in the SAME file already check `isParty || role === 'ADMIN'`
 * right after fetching the contract — this is that exact pattern applied to `getById`, the one
 * endpoint in this controller that was missing it.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

const contract = {
  id: "contract-1",
  clientUserId: "client-1",
  ptUserId: "pt-1",
  price: 1_000_000,
};

test("a caller who is neither the client nor the PT nor an admin cannot read the contract", async () => {
  const restore = patch(contractService, "getById", async () => contract as any);
  const req: any = { params: { id: "contract-1" }, headers: { "x-user-id": "stranger-1", "x-user-role": "CLIENT" } };
  const res = fakeRes();

  try {
    await contractController.getById(req, res);
  } finally {
    restore();
  }

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.contract, undefined);
  // Nothing about the contract — not even its existence past a bare "not authorized" — leaks
  // to a caller who is not a party to it.
  assert.equal(JSON.stringify(res.body).includes("1000000"), false);
});

test("the client party can read their own contract", async () => {
  const restore = patch(contractService, "getById", async () => contract as any);
  const req: any = { params: { id: "contract-1" }, headers: { "x-user-id": "client-1", "x-user-role": "CLIENT" } };
  const res = fakeRes();

  try {
    await contractController.getById(req, res);
  } finally {
    restore();
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, "contract-1");
});

test("the PT party can read the contract", async () => {
  const restore = patch(contractService, "getById", async () => contract as any);
  const req: any = { params: { id: "contract-1" }, headers: { "x-user-id": "pt-1", "x-user-role": "PT" } };
  const res = fakeRes();

  try {
    await contractController.getById(req, res);
  } finally {
    restore();
  }

  assert.equal(res.statusCode, 200);
});

test("an admin can read any contract even though they are not a party", async () => {
  const restore = patch(contractService, "getById", async () => contract as any);
  const req: any = { params: { id: "contract-1" }, headers: { "x-user-id": "admin-1", "x-user-role": "ADMIN" } };
  const res = fakeRes();

  try {
    await contractController.getById(req, res);
  } finally {
    restore();
  }

  assert.equal(res.statusCode, 200);
});

test("a nonexistent contract still 404s before any authorization check runs", async () => {
  const restore = patch(contractService, "getById", async () => null);
  const req: any = { params: { id: "missing" }, headers: { "x-user-id": "someone", "x-user-role": "CLIENT" } };
  const res = fakeRes();

  try {
    await contractController.getById(req, res);
  } finally {
    restore();
  }

  assert.equal(res.statusCode, 404);
});
