import test from "node:test";
import assert from "node:assert/strict";
import { contractService } from "../services/contract.service";
import { contractRepository } from "../repositories/contract.repository";
import { ContractStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan item 2.3 — "nhóm endpoint hợp đồng cũ".
 *
 * Audit of every real caller in the monorepo (frontend/web, backend services, scripts) found:
 *   - POST /contracts, PUT /contracts/:id, PATCH /contracts/:id/status,
 *     POST /contracts/:id/session — ZERO real callers. frontend/web/src/app/services/api.ts
 *     still defines create/update/updateStatus/logSession, but no page ever calls them — only
 *     this controller/route file and this test file reference them. Locked below (410, not
 *     deleted, per the plan's explicit "chưa xoá" instruction).
 *   - PATCH /contracts/:id/cancel — exactly ONE real caller: ContractPage.tsx, which its own
 *     comment documents as "Withdraw/cancel BEFORE any money has settled (PENDING_REVIEW /
 *     PENDING_PAYMENT)". The backend guard nonetheless still allowed ACTIVE too — a paid
 *     contract cancelled through this path skips terminateContractMoney entirely, leaving its
 *     escrowed money in PENDING forever. Nobody currently exploits this (the one real caller
 *     never sends an ACTIVE contract here), but the endpoint itself allowed it. This test locks
 *     that gap at the source rather than 410ing the whole route, since the route has a genuine,
 *     still-used, safe purpose for pre-money contracts.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("cancelContract refuses an ACTIVE (paid) contract — that money must go through terminate", async () => {
  const contract = { id: "c1", status: ContractStatus.ACTIVE, ptUserId: "pt-1", clientUserId: "client-1" };
  let updateStatusCalled = false;
  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "updateStatus", async () => {
      updateStatusCalled = true;
      return {} as any;
    }),
  ];

  let thrown: Error | null = null;
  try {
    await contractService.cancelContract("c1", "client-1", "đổi ý");
  } catch (e) {
    thrown = e as Error;
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(thrown, "an ACTIVE contract must be rejected, not silently cancelled");
  assert.equal(updateStatusCalled, false, "the status must never flip — the guard has to reject before any write happens");
});

test("cancelContract still works for a PENDING_REVIEW contract — nothing was ever paid", async () => {
  const contract = { id: "c1", status: ContractStatus.PENDING_REVIEW, ptUserId: "pt-1", clientUserId: "client-1" };
  let updated = false;
  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "updateStatus", async () => {
      updated = true;
      return { ...contract, status: ContractStatus.CANCELLED } as any;
    }),
  ];

  try {
    await contractService.cancelContract("c1", "client-1", "đổi ý");
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(updated, true);
});

test("cancelContract still works for a PENDING_PAYMENT contract — signed but not yet paid", async () => {
  const contract = { id: "c1", status: ContractStatus.PENDING_PAYMENT, ptUserId: "pt-1", clientUserId: "client-1" };
  let updated = false;
  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "updateStatus", async () => {
      updated = true;
      return { ...contract, status: ContractStatus.CANCELLED } as any;
    }),
  ];

  try {
    await contractService.cancelContract("c1", "pt-1", "khách không trả lời");
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(updated, true);
});
