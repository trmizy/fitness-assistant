import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { contractRepository } from "../repositories/contract.repository";
import { notificationService } from "../services/notification.service";
import { contractService, CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES, CONTRACT_PAYMENT_DEADLINE_HOURS } from "../services/contract.service";

/**
 * D13 - the payment deadline is stretched by `contractService.pay` every time a checkout is opened: `paymentDueAt` is pushed to
 * `now + 60 min` (CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES) through `contractRepository.extendPaymentDueAt`
 * (UPDATE ... WHERE status = PENDING_PAYMENT AND payment_transaction_id IS NULL AND payment_due_at < :to).
 *
 * OWNER DECISION NOT YET APPROVED ("1 extension per contract" is the owner's leaning). The rule is built behind
 *   CHECKOUT_EXTENSION_ONCE   (default OFF; only the exact value "true" turns it on; read on every call)
 * and the contract carries `payment_deadline_extended_at` (nullable, stamped by the first extension that really moved the deadline).
 *
 *   flag OFF (today, the default)  -> [DEFECT D13] tests: repeated and concurrent extension are unlimited; they PASS while the
 *                                    defect is present (documenting current behaviour, which stays until the owner approves).
 *   flag ON                        -> [REGRESSION D13] tests: ONE extension per contract, also under two tabs at once; once it is
 *                                    used the deadline is final; a payment that lands after the deadline is not activated and takes
 *                                    the existing refund path (activate-after-payment answers 409 CONTRACT_NOT_ACTIVATABLE).
 * Both modes run in this file, against the same code.
 *
 * Evidence label: BACKEND INTEGRATION on an isolated *_test database - the contract row, contractService.pay, the sweep and the real
 * UPDATE are real; payment-service is a TEST FIXTURE at the paymentClient boundary (`checkout` is a recorder, `getTransaction` returns
 * a PAID transaction for the late-payment case); the passing of time is a TEST FIXTURE (the test moves `payment_due_at` back to
 * "1 minute left" between calls instead of waiting 59 minutes). The refund itself is payment-service's: that half is a CODE AUDIT
 * (see the report), not exercised here.
 */

const FLAG = "CHECKOUT_EXTENSION_ONCE";
async function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

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

const row = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } }) as Promise<any>;
const dueAt = async (id: string) => (await row(id)).paymentDueAt!.getTime();
/** time passes: only `ms` are left of the current deadline (TEST FIXTURE instead of waiting) */
const leave = (id: string, ms: number) => prisma.contract.update({ where: { id }, data: { paymentDueAt: new Date(Date.now() + ms) } });

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
    patch(notificationService, "create", async () => ({})),
  ];
  // observe the REAL repository call and its row count (the original still runs)
  const original = contractRepository.extendPaymentDueAt;
  contractRepository.extendPaymentDueAt = ((id: string, to: Date, opts?: any) =>
    original(id, to, opts).then((r) => {
      extensions.push({ to: to.getTime(), count: r.count });
      return r;
    })) as typeof original;
  restores.push(() => {
    contractRepository.extendPaymentDueAt = original;
  });
  return { calls, extensions, restore: () => restores.reverse().forEach((r) => r()) };
}

const graceMs = CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES * 60_000;

// ── flag OFF: today's behaviour, documented ───────────────────────────────────────────────────────

dbTest(
  "[DEFECT D13] (flag off = default) repeated extension: every pay() inside the last hour pushes the deadline out again - unlimited",
  { skip },
  async () => {
    await withFlag(undefined, async () => {
      const c = await makePendingPaymentContract();
      const p = installPayment();
      try {
        const rounds = 5;
        for (let i = 0; i < rounds; i++) {
          await leave(c.id, 60_000);
          const before = await dueAt(c.id);
          await contractService.pay(c.id, c.clientUserId, "MOCK");
          const after = await dueAt(c.id);
          assert.ok(after > before + graceMs - 5 * 60_000, `round ${i + 1}: the deadline was extended again (from ${before} to ${after})`);
          assert.ok(Math.abs(after - (Date.now() + graceMs)) < 30_000, `round ${i + 1}: new deadline is ~now + ${CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES} min`);
        }
        assert.equal(p.calls.length, rounds, "one checkout per pay()");
        assert.deepEqual(p.extensions.map((e) => e.count), Array(rounds).fill(1), `[DEFECT D13] ${rounds} extensions on ONE contract all succeeded`);
        assert.equal((await row(c.id)).status, "PENDING_PAYMENT");
      } finally {
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  },
);

dbTest(
  "[DEFECT D13] (flag off = default) concurrent double extension: two pay() calls at once (two tabs) both extend the same contract's deadline",
  { skip },
  async () => {
    await withFlag(undefined, async () => {
      const c = await makePendingPaymentContract();
      // the second request reaches its extension ~30 ms after the first, so its target (now + 60 min) is later and its UPDATE matches too
      const p = installPayment([0, 30]);
      try {
        await leave(c.id, 60_000);
        const results = await Promise.allSettled([
          contractService.pay(c.id, c.clientUserId, "MOCK"),
          contractService.pay(c.id, c.clientUserId, "MOCK"),
        ]);
        assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results));
        assert.equal(p.calls.length, 2, "two checkouts were opened");
        assert.deepEqual(p.extensions.map((e) => e.count), [1, 1], "[DEFECT D13] both UPDATE ... payment_due_at < :to statements changed the row");
        assert.ok(p.extensions[1].to > p.extensions[0].to, "the later request moved the deadline further");
      } finally {
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  },
);

dbTest("flag values: only the exact string 'true' turns the one-extension rule on", { skip }, async () => {
  for (const [value, expectOnce] of [[undefined, false], ["", false], ["false", false], ["1", false], ["TRUE", false], ["true", true]] as const) {
    await withFlag(value, async () => {
      const c = await makePendingPaymentContract();
      const p = installPayment();
      try {
        for (let i = 0; i < 2; i++) {
          await leave(c.id, 60_000);
          await contractService.pay(c.id, c.clientUserId, "MOCK");
        }
        assert.deepEqual(p.extensions.map((e) => e.count), expectOnce ? [1, 0] : [1, 1], `value ${JSON.stringify(value)}`);
      } finally {
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  }
});

// ── flag ON: the approved-if-approved rule ────────────────────────────────────────────────────────

dbTest("[REGRESSION D13] (flag on) one extension per contract: the 2nd..5th pay() inside the last hour leave the deadline alone", { skip }, async () => {
  await withFlag("true", async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment();
    try {
      await leave(c.id, 60_000);
      await contractService.pay(c.id, c.clientUserId, "MOCK");
      const afterFirst = await row(c.id);
      assert.ok(Math.abs(afterFirst.paymentDueAt.getTime() - (Date.now() + graceMs)) < 30_000, "the first extension still applies");
      assert.ok(afterFirst.paymentDeadlineExtendedAt, "...and is remembered");
      for (let i = 0; i < 4; i++) {
        await leave(c.id, 60_000);
        const before = await dueAt(c.id);
        await contractService.pay(c.id, c.clientUserId, "MOCK"); // a checkout is still opened: the client is not blocked from paying
        assert.equal(await dueAt(c.id), before, `pay() #${i + 2}: the deadline was NOT extended again`);
      }
      assert.equal(p.calls.length, 5, "a checkout was opened every time");
      assert.deepEqual(p.extensions.map((e) => e.count), [1, 0, 0, 0, 0], "exactly one extension");
      assert.equal((await row(c.id)).status, "PENDING_PAYMENT", "nothing cancelled by the rule itself");
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  });
});

dbTest("[REGRESSION D13] (flag on) a pay() on a fresh contract (12h still ahead) does not use up the extension", { skip }, async () => {
  await withFlag("true", async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment();
    try {
      await contractService.pay(c.id, c.clientUserId, "MOCK"); // 12h left > now + 60min: nothing to extend
      assert.deepEqual(p.extensions.map((e) => e.count), [0]);
      assert.equal((await row(c.id)).paymentDeadlineExtendedAt, null, "not stamped: no extension happened");
      await leave(c.id, 60_000);
      await contractService.pay(c.id, c.clientUserId, "MOCK");
      assert.deepEqual(p.extensions.map((e) => e.count), [0, 1], "the one extension is still available later, and works");
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  });
});

dbTest("[REGRESSION D13] (flag on) concurrent two-tab pay(): exactly ONE of the two extends the deadline", { skip }, async () => {
  await withFlag("true", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = await makePendingPaymentContract();
      const p = installPayment([0, 30]);
      try {
        await leave(c.id, 60_000);
        const results = await Promise.allSettled([
          contractService.pay(c.id, c.clientUserId, "MOCK"),
          contractService.pay(c.id, c.clientUserId, "MOCK"),
        ]);
        assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results));
        assert.equal(p.calls.length, 2, "both tabs got a checkout");
        assert.equal(p.extensions.filter((e) => e.count === 1).length, 1, `attempt ${attempt}: exactly one UPDATE changed the row`);
        assert.equal(p.extensions.filter((e) => e.count === 0).length, 1);
        assert.ok((await row(c.id)).paymentDeadlineExtendedAt);
      } finally {
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    }
  });
});

dbTest("[REGRESSION D13] (flag on) repository: the conditional UPDATE itself is the guard (IS NULL), not the caller", { skip }, async () => {
  await withFlag("true", async () => {
    const c = await makePendingPaymentContract();
    try {
      await leave(c.id, 60_000);
      const to1 = new Date(Date.now() + graceMs);
      const to2 = new Date(Date.now() + graceMs + 5 * 60_000);
      const results = await Promise.all([
        contractRepository.extendPaymentDueAt(c.id, to1, { once: true }),
        contractRepository.extendPaymentDueAt(c.id, to2, { once: true }),
      ]);
      assert.equal(results.reduce((s, r) => s + r.count, 0), 1);
      assert.equal((await contractRepository.extendPaymentDueAt(c.id, new Date(to2.getTime() + 60_000), { once: true })).count, 0, "used");
      // without { once } (flag off) the same call still extends: the column is only a record there
      await leave(c.id, 60_000);
      assert.equal((await contractRepository.extendPaymentDueAt(c.id, new Date(Date.now() + graceMs))).count, 1);
    } finally {
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  });
});

dbTest(
  "[REGRESSION D13] (flag on) after the extension is used the deadline is final: pay() is refused at the deadline, the sweep cancels, and a LATE payment is not activated (409 CONTRACT_NOT_ACTIVATABLE = payment-service's refund path)",
  { skip },
  async () => {
    await withFlag("true", async () => {
      const c = await makePendingPaymentContract();
      const p = installPayment();
      const lateTxn = randomUUID();
      const restoreTxn = patch(paymentClient, "getTransaction", async (id: string) => ({
        id, status: "PAID", relatedEntityType: "PT_CONTRACT", relatedEntityId: c.id,
      }));
      try {
        await leave(c.id, 60_000);
        await contractService.pay(c.id, c.clientUserId, "MOCK"); // the one extension
        // the client then sits on the bank page past the (extended) deadline
        await prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
        await assert.rejects(
          () => contractService.pay(c.id, c.clientUserId, "MOCK"),
          (e: any) => e.status === 409 && e.code === "PAYMENT_DEADLINE_PASSED",
          "a new checkout after the deadline is refused",
        );
        assert.ok((await contractService.cancelOverduePaymentContracts()) >= 1);
        assert.equal((await row(c.id)).status, "CANCELLED");
        // the gateway confirms money that was already in flight
        await assert.rejects(
          () => contractService.activateAfterPayment(c.id, lateTxn),
          (e: any) => e.status === 409 && e.code === "CONTRACT_NOT_ACTIVATABLE" && e.currentStatus === "CANCELLED",
        );
        const after = await row(c.id);
        assert.equal(after.status, "CANCELLED", "the contract is not revived by a late payment");
        assert.equal(after.paymentTransactionId, null, "and holds no transaction: the client's money is refunded by payment-service");
      } finally {
        restoreTxn();
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  },
);
