import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { contractRepository } from "../repositories/contract.repository";
import { contractService, CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES, CONTRACT_PAYMENT_DEADLINE_HOURS } from "../services/contract.service";

/**
 * D13 (owner decision NOT approved yet - this file only DOCUMENTS today's behaviour): the 12h payment deadline is stretched by
 * `contractService.pay` every time a checkout is opened - `paymentDueAt` is pushed to `now + 60 min` (CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES)
 * through `contractRepository.extendPaymentDueAt` (UPDATE ... WHERE status = PENDING_PAYMENT AND payment_transaction_id IS NULL AND
 * payment_due_at < :to). Nothing remembers that an extension already happened, so:
 *   - a client who re-opens the payment page every < 60 minutes keeps a contract alive for ever (each call extends again), and
 *   - two tabs/requests at the same time both extend (each UPDATE is individually valid, so both match one row).
 *
 * Evidence label: BACKEND INTEGRATION on an isolated *_test database - the contract row, contractService.pay and the real UPDATE are real;
 * payment-service is a TEST FIXTURE at the paymentClient boundary (`checkout` is a recorder); the passing of time is a TEST FIXTURE (the
 * test moves `payment_due_at` back to "1 minute left" between calls instead of waiting 59 minutes).
 *
 * Both tests are named [DEFECT D13] and PASS while the defect is present. When "max 1 extension per contract" ships they must be turned into
 * [REGRESSION D13] tests that assert the opposite (second pay() leaves the deadline alone; of two concurrent pay() calls exactly one extends).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function makePendingPaymentContract() {
  return prisma.contract.create({
    data: {
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      status: "PENDING_PAYMENT",
      packageName: "Goi 10 buoi",
      totalSessions: 10,
      price: new Prisma.Decimal("5000000"),
      sessionMode: SessionMode.OFFLINE,
      sessionDurationMinutes: 60,
      validityDays: 90,
      // the PT accepted just now: the full 12h window is ahead
      paymentDueAt: new Date(Date.now() + CONTRACT_PAYMENT_DEADLINE_HOURS * 3_600_000),
    } as any,
  });
}

const dueAt = async (id: string) => (await prisma.contract.findUniqueOrThrow({ where: { id } })).paymentDueAt!.getTime();

function installPayment(delaysMs: number[] = []) {
  let n = 0;
  const calls: any[] = [];
  const extensions: Array<{ to: number; count: number }> = [];
  const restores = [
    patch(paymentClient, "checkout", async (params: any) => {
      const mine = n++;
      calls.push(params);
      if (delaysMs[mine]) await new Promise((r) => setTimeout(r, delaysMs[mine]));
      return { transactionId: randomUUID(), status: "PENDING", redirectUrl: null, qrCodeUrl: null, provider: "MOCK" };
    }),
  ];
  // observe the REAL repository call and its row count (the original still runs)
  const original = contractRepository.extendPaymentDueAt;
  contractRepository.extendPaymentDueAt = (async (id: string, to: Date) => {
    const r = await original(id, to);
    extensions.push({ to: to.getTime(), count: r.count });
    return r;
  }) as typeof original;
  restores.push(() => {
    contractRepository.extendPaymentDueAt = original;
  });
  return { calls, extensions, restore: () => restores.reverse().forEach((r) => r()) };
}

dbTest(
  "[DEFECT D13] repeated extension: every pay() inside the last hour pushes the deadline out again - it can be extended an unlimited number of times",
  { skip },
  async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment();
    try {
      const graceMs = CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES * 60_000;
      const rounds = 5;
      for (let i = 0; i < rounds; i++) {
        // time passes: only 1 minute is left of the current deadline (TEST FIXTURE instead of waiting)
        await prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() + 60_000) } });
        const before = await dueAt(c.id);
        await contractService.pay(c.id, c.clientUserId, "MOCK");
        const after = await dueAt(c.id);
        assert.ok(after > before + graceMs - 5 * 60_000, `round ${i + 1}: the deadline was extended again (from ${before} to ${after})`);
        assert.ok(Math.abs(after - (Date.now() + graceMs)) < 30_000, `round ${i + 1}: new deadline is ~now + ${CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES} min`);
      }
      assert.equal(p.calls.length, rounds, "one checkout per pay()");
      assert.deepEqual(
        p.extensions.map((e) => e.count),
        Array(rounds).fill(1),
        `[DEFECT D13] ${rounds} extensions on ONE contract all succeeded - there is no 'already extended' state to stop the 2nd..${rounds}th`,
      );
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "PENDING_PAYMENT");
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  },
);

dbTest(
  "[DEFECT D13] concurrent double extension: two pay() calls at once (two tabs) both extend the same contract's deadline",
  { skip },
  async () => {
    const c = await makePendingPaymentContract();
    // the second request reaches its extension ~30 ms after the first, so its target (now + 60 min) is later and its UPDATE matches too
    const p = installPayment([0, 30]);
    try {
      await prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() + 60_000) } });
      const results = await Promise.allSettled([
        contractService.pay(c.id, c.clientUserId, "MOCK"),
        contractService.pay(c.id, c.clientUserId, "MOCK"),
      ]);
      assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results));
      assert.equal(p.calls.length, 2, "two checkouts were opened");
      assert.deepEqual(
        p.extensions.map((e) => e.count),
        [1, 1],
        "[DEFECT D13] both UPDATE ... payment_due_at < :to statements changed the row: the contract was extended twice",
      );
      assert.ok(p.extensions[1].to > p.extensions[0].to, "the later request moved the deadline further");
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  },
);
