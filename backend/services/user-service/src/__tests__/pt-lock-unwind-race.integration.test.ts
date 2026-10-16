/**
 * Slice 1 / item 5 — the PT-lock unwind and `terminateContractMoney` must never write a contract's
 * status from a stale read.
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_user_test database (never the
 * dev one — user-service's .env points at dev, so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-lock-unwind-race.integration.test.ts
 * payment-service is NOT running: paymentClient.terminate is stubbed at the client boundary
 * (TEST FIXTURE for that half), so these tests pin what user-service SENDS and what it writes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { terminateContractMoney } from "../services/contract-payout.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { notificationService } from "../services/notification.service";

import { skip } from "./test-db-guard"; // D57-6-5: the database NAME must end with _test (was a loose /_test/ match on the whole URL)

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function makeContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Gói 10 buổi",
      totalSessions: 10,
      price: 5_000_000,
      status: "PENDING_PAYMENT",
      ...overrides,
    },
  });
}

async function cleanup(ids: string[]) {
  await prisma.session.deleteMany({ where: { contractId: { in: ids } } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: ids } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

/** Makes the FIRST read of the contract return the pre-payment row, then lets a payment activate it. */
function activateRightAfterFirstRead(contractId: string, txn: string) {
  const original = contractRepository.findById;
  let reads = 0;
  const restore = patch(contractRepository, "findById", async (id: string) => {
    const row = await original(id);
    if (id === contractId && ++reads === 1) {
      await contractRepository.activateIfPendingGuarded(contractId, txn);
    }
    return row;
  });
  return restore;
}

test("PT lock racing a payment: a contract activated between the read and the write is refunded through the ledger, not stranded CANCELLED with money in escrow", { skip }, async () => {
  const c = await makeContract();
  const txn = `txn-${randomUUID()}`;
  const terminateCalls: any[] = [];
  const restores = [
    patch(notificationService, "create", async () => ({}) as any),
    activateRightAfterFirstRead(c.id, txn),
    patch(paymentClient, "terminate", async (body: any) => {
      terminateCalls.push(body);
      return { refund: "5000000.00" };
    }),
  ];
  try {
    const outcome = await ptDeactivationService.unwindContract(c, "Tài khoản huấn luyện viên bị khoá");

    assert.equal(terminateCalls.length, 1, "the late-activated, paid contract must go through payment-service's terminate");
    assert.equal(terminateCalls[0].transactionId, txn);
    assert.equal(terminateCalls[0].idempotencyKey, `CONTRACT_TERMINATE:${c.id}`);
    assert.equal(outcome.status, "REFUNDED");
    assert.equal(outcome.refundAmount, 5_000_000);

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, "PT_BANNED");
    assert.equal(after.paymentTransactionId, txn);
    assert.equal(after.cancelledBy, "SYSTEM");
  } finally {
    restores.forEach((r) => r());
    await cleanup([c.id]);
  }
});

test("a status write whose guard no longer matches changes nothing: an already COMPLETED contract is not rewritten to CANCELLED by an admin terminate", { skip }, async () => {
  const c = await makeContract({ status: "COMPLETED", paymentTransactionId: `txn-${randomUUID()}`, terminationReason: "COMPLETED", terminatedAt: new Date("2026-01-01") });
  const restores = [patch(paymentClient, "terminate", async () => ({ refund: "0.00" }))];
  try {
    await terminateContractMoney(c.id, "PT_BANNED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "COMPLETED", "an ended contract keeps its status");
    assert.equal(after.terminationReason, "COMPLETED", "…and its recorded reason");
    assert.equal(after.terminatedAt?.toISOString(), new Date("2026-01-01").toISOString());
  } finally {
    restores.forEach((r) => r());
    await cleanup([c.id]);
  }
});
