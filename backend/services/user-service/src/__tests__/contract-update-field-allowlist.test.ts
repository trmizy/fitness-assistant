import test from "node:test";
import assert from "node:assert/strict";
import { contractService } from "../services/contract.service";
import { contractRepository } from "../repositories/contract.repository";
import { ContractStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan item 2.2 — "PT sửa được hợp đồng đã ký và đã thanh toán".
 *
 * `contractService.update(id, ptUserId, data: any)` used to pass the request body straight to
 * the repository with no field allowlist — a PT who is genuinely the contract's PT (passes the
 * ownership check) could rewrite `price`, `totalSessions`, or the three revenue-split rates on
 * a contract the client already accepted and paid for.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("a PT cannot smuggle price/totalSessions/rates through the description-edit endpoint", async () => {
  const contract = { id: "c1", ptUserId: "pt-1", status: ContractStatus.PENDING_REVIEW };
  let sentPatch: Record<string, unknown> | null = null;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "update", async (_id: string, data: Record<string, unknown>) => {
      sentPatch = data;
      return { ...contract, ...data } as any;
    }),
  ];

  try {
    await contractService.update("c1", "pt-1", {
      description: "Gói tập nâng cao",
      notes: "khách bị đau lưng",
      terms: "huỷ trước 48h",
      price: 1,
      totalSessions: 999,
      platformRate: "0",
      ptRate: "1",
      gymRate: "0",
      status: "ACTIVE",
      packageId: "someone-elses-package",
    });
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(sentPatch, {
    description: "Gói tập nâng cao",
    notes: "khách bị đau lưng",
    terms: "huỷ trước 48h",
  });
});

test("a contract past PENDING_REVIEW cannot be edited at all, not even description", async () => {
  const contract = { id: "c1", ptUserId: "pt-1", status: ContractStatus.ACTIVE };
  let updateCalled = false;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "update", async () => {
      updateCalled = true;
      return {} as any;
    }),
  ];

  try {
    await assert.rejects(
      () => contractService.update("c1", "pt-1", { description: "sau khi đã ký thì không được sửa nữa" }),
      /PENDING_REVIEW|status/i,
    );
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(updateCalled, false);
});

test("a PT who does not own the contract is still rejected before the allowlist even matters", async () => {
  const contract = { id: "c1", ptUserId: "pt-1", status: ContractStatus.PENDING_REVIEW };
  const restores = [patch(contractRepository, "findById", async () => contract as any)];

  try {
    await assert.rejects(() => contractService.update("c1", "pt-2", { description: "not my contract" }), /Only the PT/);
  } finally {
    restores.forEach((r) => r());
  }
});
