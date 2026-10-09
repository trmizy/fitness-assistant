/**
 * POST /internal/contracts/:id/activate-after-payment — the answer payment-service acts on.
 *
 * payment-service has ALREADY moved the client's money into escrow by the time it calls this.
 * It used to get `200 { success: true }` for a contract that this call had not activated
 * (cancelled while the client was on the bank page, rejected, expired, or active under another
 * payment), mark the payment ACTIVATED, and leave the money stuck. Now only a contract that is
 * ACTIVE with THIS payment's transaction id counts as success; everything else is a definite
 * 409 CONTRACT_NOT_ACTIVATABLE with the contract's current status, and the contract is left
 * exactly as it was.
 *
 * BACKEND INTEGRATION — real Postgres via DATABASE_URL, run against the isolated test database
 * (NEVER the dev one; user-service's .env points at dev, so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-activate-after-payment.integration.test.ts
 * The payment-service lookup (paymentClient.getTransaction) and the e-mail lookups are stubbed at
 * their client boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractService } from "../services/contract.service";
import { contractController } from "../controllers/contract.controller";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { runContractPaymentDeadlineSweep } from "../services/contract-expiry-sweep.service";

const HOUR = 3600 * 1000;

async function makeContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Test Package",
      totalSessions: 12,
      status: "PENDING_PAYMENT",
      paymentDueAt: new Date(Date.now() + HOUR),
      ...overrides,
    },
  });
}

async function cleanup(ids: string[]) {
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

/** payment-service says: this transaction is PAID and belongs to this contract. */
function stubPaid(contractId: string): () => void {
  const original = paymentClient.getTransaction;
  (paymentClient as any).getTransaction = async (id: string) => ({
    id,
    status: "PAID",
    relatedEntityType: "PT_CONTRACT",
    relatedEntityId: contractId,
  });
  return () => {
    (paymentClient as any).getTransaction = original;
  };
}

/** Captures outgoing e-mails instead of calling auth-service. */
function stubMail(): { sent: string[]; restore: () => void } {
  const sent: string[] = [];
  const get = authServiceClient.internalGet;
  const post = authServiceClient.internalPost;
  (authServiceClient as any).internalGet = async (path: string) => ({
    data: { user: { email: `${path.split("/").pop()}@example.test`, firstName: "T", lastName: "U" } },
  });
  (authServiceClient as any).internalPost = async (_p: string, body: { to: string }) => {
    sent.push(body.to);
    return { data: {} };
  };
  return {
    sent,
    restore: () => {
      (authServiceClient as any).internalGet = get;
      (authServiceClient as any).internalPost = post;
    },
  };
}

async function activate(contractId: string, txnId: string) {
  try {
    return { ok: true as const, contract: await contractService.activateAfterPayment(contractId, txnId) };
  } catch (e: any) {
    return { ok: false as const, status: e.status as number, code: e.code as string | undefined, currentStatus: e.currentStatus as string | undefined };
  }
}

test("PENDING_PAYMENT + this payment: ACTIVE with this transaction, both parties mailed once", async () => {
  const c = await makeContract();
  const restoreTxn = stubPaid(c.id);
  const mail = stubMail();
  try {
    const r = await activate(c.id, "txn-1");
    assert.ok(r.ok);
    assert.equal(r.contract.status, "ACTIVE");
    assert.equal(r.contract.paymentTransactionId, "txn-1");
    assert.equal(mail.sent.length, 2);
  } finally {
    mail.restore();
    restoreTxn();
    await cleanup([c.id]);
  }
});

test("replay with the SAME transaction is a success and sends no second e-mail", async () => {
  const c = await makeContract();
  const restoreTxn = stubPaid(c.id);
  const mail = stubMail();
  try {
    assert.ok((await activate(c.id, "txn-1")).ok);
    const again = await activate(c.id, "txn-1");
    assert.ok(again.ok, "idempotent replay");
    assert.equal(again.contract.paymentTransactionId, "txn-1");
    assert.equal(mail.sent.length, 2, "only the first activation mailed");
  } finally {
    mail.restore();
    restoreTxn();
    await cleanup([c.id]);
  }
});

for (const status of ["CANCELLED", "REJECTED", "EXPIRED", "COMPLETED", "PENDING_REVIEW", "PENDING_SIGNATURE"] as const) {
  test(`${status}: 409 CONTRACT_NOT_ACTIVATABLE with the current status, contract untouched`, async () => {
    const c = await makeContract({ status, cancelledBy: status === "CANCELLED" ? "someone" : null });
    const restoreTxn = stubPaid(c.id);
    const mail = stubMail();
    try {
      const r = await activate(c.id, "txn-1");
      assert.ok(!r.ok);
      assert.equal(r.status, 409);
      assert.equal(r.code, "CONTRACT_NOT_ACTIVATABLE");
      assert.equal(r.currentStatus, status);
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.status, status);
      assert.equal(after.paymentTransactionId, null);
      assert.equal(after.startDate, null);
      assert.equal(mail.sent.length, 0);
    } finally {
      mail.restore();
      restoreTxn();
      await cleanup([c.id]);
    }
  });
}

test("cancelled by the payment-deadline sweep (SYSTEM) while the client paid: 409, still CANCELLED/SYSTEM", async () => {
  const c = await makeContract({ paymentDueAt: new Date(Date.now() - HOUR) });
  try {
    await runContractPaymentDeadlineSweep();
    const swept = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(swept.status, "CANCELLED");
    assert.equal(swept.cancelledBy, "SYSTEM");
  } finally {
    // (cleanup after the assertions below)
  }
  const restoreTxn = stubPaid(c.id);
  try {
    const r = await activate(c.id, "txn-late");
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.code, "CONTRACT_NOT_ACTIVATABLE");
    assert.equal(r.currentStatus, "CANCELLED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.cancelledBy, "SYSTEM");
    assert.equal(after.paymentTransactionId, null);
  } finally {
    restoreTxn();
    await cleanup([c.id]);
  }
});

test("cancelled by a party (PT) while the client was on the bank page: 409 CANCELLED", async () => {
  const c = await makeContract();
  const restoreTxn = stubPaid(c.id);
  try {
    await contractService.cancelContract(c.id, c.ptUserId, "đổi ý");
    const r = await activate(c.id, "txn-late");
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.currentStatus, "CANCELLED");
  } finally {
    restoreTxn();
    await cleanup([c.id]);
  }
});

test("ACTIVE under a DIFFERENT transaction: 409 and the original payment stays attached", async () => {
  const c = await makeContract({ status: "ACTIVE", paymentTransactionId: "txn-first", startDate: new Date() });
  const restoreTxn = stubPaid(c.id);
  const mail = stubMail();
  try {
    const r = await activate(c.id, "txn-second");
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.code, "CONTRACT_NOT_ACTIVATABLE");
    assert.equal(r.currentStatus, "ACTIVE");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.paymentTransactionId, "txn-first");
    assert.equal(mail.sent.length, 0);
    // ... while a replay of the FIRST one is still a success.
    assert.ok((await activate(c.id, "txn-first")).ok);
  } finally {
    mail.restore();
    restoreTxn();
    await cleanup([c.id]);
  }
});

test("contract that does not exist: 409 NOT_FOUND (payment-service must not mark it activated)", async () => {
  const id = randomUUID();
  const restoreTxn = stubPaid(id);
  try {
    const r = await activate(id, "txn-1");
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.currentStatus, "NOT_FOUND");
  } finally {
    restoreTxn();
  }
});

test("transaction verification failures stay 400 (unchanged)", async () => {
  const c = await makeContract();
  const original = paymentClient.getTransaction;
  (paymentClient as any).getTransaction = async (id: string) => ({ id, status: "PENDING", relatedEntityType: "PT_CONTRACT", relatedEntityId: c.id });
  try {
    const r = await activate(c.id, "txn-1");
    assert.ok(!r.ok);
    assert.equal(r.status, 400);
    assert.equal(r.code, undefined);
  } finally {
    (paymentClient as any).getTransaction = original;
    await cleanup([c.id]);
  }
});

test("HTTP shape: 409 { success:false, error:{ code, message, currentStatus } }; success stays 200", async () => {
  const dead = await makeContract({ status: "CANCELLED" });
  const live = await makeContract();
  const restoreTxn = (() => {
    const original = paymentClient.getTransaction;
    (paymentClient as any).getTransaction = async (id: string) => ({
      id, status: "PAID", relatedEntityType: "PT_CONTRACT", relatedEntityId: id.startsWith("dead") ? dead.id : live.id,
    });
    return () => { (paymentClient as any).getTransaction = original; };
  })();
  const mail = stubMail();
  const call = async (id: string, transactionId: string) => {
    let status = 200;
    let body: any;
    const res: any = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; } };
    await contractController.activateAfterPayment({ params: { id }, body: { transactionId } }, res);
    return { status, body };
  };
  try {
    const r409 = await call(dead.id, "dead-txn");
    assert.equal(r409.status, 409);
    assert.deepEqual(r409.body.error.code, "CONTRACT_NOT_ACTIVATABLE");
    assert.equal(r409.body.error.currentStatus, "CANCELLED");
    assert.equal(r409.body.success, false);
    const r200 = await call(live.id, "live-txn");
    assert.equal(r200.status, 200);
    assert.equal(r200.body.success, true);
  } finally {
    mail.restore();
    restoreTxn();
    await cleanup([dead.id, live.id]);
  }
});

// ── races ───────────────────────────────────────────────────────────────────────────────────

test("activate racing a manual cancel: exactly one wins and the answer matches the final state", async () => {
  const ids: string[] = [];
  const mail = stubMail();
  try {
    let activatedWins = 0;
    let cancelWins = 0;
    for (let i = 0; i < 25; i++) {
      const c = await makeContract();
      ids.push(c.id);
      const restoreTxn = stubPaid(c.id);
      try {
        const [act, can] = await Promise.all([
          activate(c.id, `txn-${i}`),
          contractService.cancelContract(c.id, c.clientUserId, "race").then(
            () => "cancelled" as const,
            (e: any) => `refused:${e.status}` as const,
          ),
        ]);
        const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
        if (after.status === "ACTIVE") {
          activatedWins++;
          assert.ok(act.ok, `round ${i}: ACTIVE but the activate answer was a refusal`);
          assert.equal(after.paymentTransactionId, `txn-${i}`);
          assert.notEqual(can, "cancelled", `round ${i}: cancel reported success on a contract that is ACTIVE`);
        } else {
          cancelWins++;
          assert.equal(after.status, "CANCELLED");
          assert.equal(after.paymentTransactionId, null, `round ${i}: CANCELLED but carrying a payment`);
          assert.ok(!act.ok && act.status === 409 && act.code === "CONTRACT_NOT_ACTIVATABLE", `round ${i}: CANCELLED but activate said success`);
          assert.equal(can, "cancelled");
        }
      } finally {
        restoreTxn();
      }
    }
    assert.equal(activatedWins + cancelWins, 25);
  } finally {
    mail.restore();
    await cleanup(ids);
  }
});

test("activate racing the payment-deadline sweep: exactly one wins and the answer matches", async () => {
  const ids: string[] = [];
  const mail = stubMail();
  try {
    for (let i = 0; i < 15; i++) {
      const c = await makeContract({ paymentDueAt: new Date(Date.now() - HOUR) });
      ids.push(c.id);
      const restoreTxn = stubPaid(c.id);
      try {
        const [act] = await Promise.all([activate(c.id, `txn-${i}`), contractService.cancelOverduePaymentContracts()]);
        const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
        if (after.status === "ACTIVE") {
          assert.ok(act.ok);
          assert.equal(after.paymentTransactionId, `txn-${i}`);
        } else {
          assert.equal(after.status, "CANCELLED");
          assert.equal(after.paymentTransactionId, null);
          assert.ok(!act.ok && act.status === 409);
        }
      } finally {
        restoreTxn();
      }
    }
  } finally {
    mail.restore();
    await cleanup(ids);
  }
});

test("two payments racing for one contract: one activates, the other gets 409", async () => {
  const c = await makeContract();
  const restoreTxn = stubPaid(c.id);
  const mail = stubMail();
  try {
    const [a, b] = await Promise.all([activate(c.id, "txn-a"), activate(c.id, "txn-b")]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    const loser = [a, b].find((r) => !r.ok)!;
    assert.ok(!loser.ok && loser.status === 409 && loser.code === "CONTRACT_NOT_ACTIVATABLE" && loser.currentStatus === "ACTIVE");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(["txn-a", "txn-b"].includes(after.paymentTransactionId!));
    assert.equal(mail.sent.length, 2, "one activation, one pair of e-mails");
  } finally {
    mail.restore();
    restoreTxn();
    await cleanup([c.id]);
  }
});

test("manual cancel of a contract that just became ACTIVE is refused (409), never overwrites it", async () => {
  const c = await makeContract();
  const restoreTxn = stubPaid(c.id);
  const mail = stubMail();
  // Simulate the interleaving: cancelContract has read PENDING_PAYMENT, then the payment lands.
  const { contractRepository } = await import("../repositories/contract.repository");
  const realFind = contractRepository.findById;
  (contractRepository as any).findById = async (id: string) => {
    const row = await realFind(id);
    await activate(id, "txn-1"); // payment lands right after the read
    return row;
  };
  try {
    await assert.rejects(contractService.cancelContract(c.id, c.clientUserId, "too late"), (e: any) => e.status === 409);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.paymentTransactionId, "txn-1");
    assert.equal(after.cancelledBy, null);
  } finally {
    (contractRepository as any).findById = realFind;
    mail.restore();
    restoreTxn();
    await cleanup([c.id]);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
