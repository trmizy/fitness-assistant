import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { ContractStatus, Prisma, SessionMode } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { contractRepository } from "../repositories/contract.repository";
import { notificationService } from "../services/notification.service";
import {
  checkoutExtensionOnce,
  contractService,
  CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES,
  CONTRACT_PAYMENT_DEADLINE_HOURS,
} from "../services/contract.service";

/**
 * D13 (owner decision APPROVED) - a contract's payment deadline is extended by a checkout AT MOST ONCE: the first `pay()` that opens a
 * checkout inside the last hour pushes `paymentDueAt` to `now + 60 min` (CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES), every later `pay()`
 * still opens a checkout (the client is never blocked from paying) but adds NO time. The guard is the database:
 *   UPDATE contracts SET payment_due_at = :to, payment_deadline_extended_at = now()
 *    WHERE id = :id AND status = 'PENDING_PAYMENT' AND payment_transaction_id IS NULL AND payment_due_at < :to
 *      AND payment_deadline_extended_at IS NULL            -- the one-extension guard
 *
 * The rule is ON BY DEFAULT. Only an explicit CHECKOUT_EXTENSION_ONCE=false switches it off (emergency switch, warned about in the
 * log on every pay() that reaches the extension); any other value, or none, keeps it on. Read on every call.
 *
 * What the file proves: [REGRESSION D13] one extension per contract (sequential, concurrent two-tab, repository level); reopening a
 * checkout adds no time; PAID / CANCELLED / EXPIRED / ACTIVE (and the other settled states) are never extended; the deadline is final
 * (pay refused at the deadline, the sweep cancels, a LATE payment is answered 409 CONTRACT_NOT_ACTIVATABLE = payment-service's
 * existing auto-refund path) and the contract status stays consistent with the deadline; the explicit-false switch restores the old
 * unlimited extension and warns. The same rule across TWO OS processes is multi-instance/mi-checkout-extension-once.e2e.test.ts.
 *
 * Evidence label: BACKEND INTEGRATION on an isolated *_test database - the contract row, contractService.pay, the sweep and the real
 * UPDATE are real; payment-service is a TEST FIXTURE at the paymentClient boundary (`checkout` is a recorder, `getTransaction` returns
 * a PAID transaction for the late-payment case); the passing of time is a TEST FIXTURE (the test moves `payment_due_at` back to
 * "1 minute left" between calls instead of waiting 59 minutes). The refund itself is payment-service's: that half is a CODE AUDIT
 * (payment-service reconciliation matches on the 409 code), not exercised here.
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

async function makeContract(over: Record<string, unknown> = {}) {
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
      ...over,
    } as any,
  });
}
const makePendingPaymentContract = () => makeContract();

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

// ── the default: ON ───────────────────────────────────────────────────────────────────────────────

dbTest("the rule is ON by default: only an explicit 'false' (trimmed, any case) switches it off; unset, empty, 'true', '0', 'no', 'off' keep it on", { skip }, async () => {
  for (const [value, expectOnce] of [
    [undefined, true], ["", true], ["true", true], ["TRUE", true], ["1", true], ["0", true], ["no", true], ["off", true],
    ["false", false], ["FALSE", false], [" false ", false], ["False", false],
  ] as const) {
    await withFlag(value, async () => {
      assert.equal(checkoutExtensionOnce(), expectOnce, `value ${JSON.stringify(value)}`);
      const c = await makePendingPaymentContract();
      const p = installPayment();
      try {
        for (let i = 0; i < 2; i++) {
          await leave(c.id, 60_000);
          await contractService.pay(c.id, c.clientUserId, "MOCK");
        }
        assert.deepEqual(p.extensions.map((e) => e.count), expectOnce ? [1, 0] : [1, 1], `behaviour for value ${JSON.stringify(value)}`);
      } finally {
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  }
});

dbTest("[REGRESSION D13] (default) one extension per contract: the 2nd..5th pay() inside the last hour leave the deadline alone", { skip }, async () => {
  await withFlag(undefined, async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment();
    try {
      await leave(c.id, 60_000);
      await contractService.pay(c.id, c.clientUserId, "MOCK");
      const afterFirst = await row(c.id);
      assert.ok(Math.abs(afterFirst.paymentDueAt.getTime() - (Date.now() + graceMs)) < 30_000, "the first extension still applies: ~now + 60 min");
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

dbTest("[REGRESSION D13] (default) reopening the checkout does not add time: re-pay right after the extension (and again later) leaves paymentDueAt exactly where the first extension put it", { skip }, async () => {
  await withFlag(undefined, async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment();
    try {
      await leave(c.id, 60_000);
      await contractService.pay(c.id, c.clientUserId, "MOCK");
      const extendedTo = await dueAt(c.id);
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 25)); // the clock moves on; a new "now + 60 min" would be later than extendedTo
        await contractService.pay(c.id, c.clientUserId, "MOCK");
        assert.equal(await dueAt(c.id), extendedTo, `re-open #${i + 1}: same deadline to the millisecond`);
      }
      assert.deepEqual(p.extensions.map((e) => e.count), [1, 0, 0, 0]);
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  });
});

dbTest("[REGRESSION D13] (default) a pay() on a fresh contract (12h still ahead) does not use up the extension", { skip }, async () => {
  await withFlag(undefined, async () => {
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

dbTest("[REGRESSION D13] (default) concurrent two-tab pay(): exactly ONE of the two extends the deadline", { skip }, async () => {
  await withFlag(undefined, async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = await makePendingPaymentContract();
      // the second request reaches its extension ~30 ms after the first, so its target (now + 60 min) is later and, without the guard, its UPDATE would match too
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

dbTest("[REGRESSION D13] repository: the conditional UPDATE itself is the guard (IS NULL), not the caller", { skip }, async () => {
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
    // without { once } (the explicit-false switch) the same call still extends: the column is only a record there
    await leave(c.id, 60_000);
    assert.equal((await contractRepository.extendPaymentDueAt(c.id, new Date(Date.now() + graceMs))).count, 1);
  } finally {
    await prisma.contract.deleteMany({ where: { id: c.id } });
  }
});

// ── never extended: PAID / CANCELLED / EXPIRED / ACTIVE and the other settled states ──────────────

dbTest("[REGRESSION D13] never extended: PAID (a transaction is attached), CANCELLED, EXPIRED, ACTIVE, COMPLETED, REJECTED and the pre-payment states - the row is untouched, with or without the one-extension guard", { skip }, async () => {
  const soon = () => new Date(Date.now() + 60_000);
  const cases: Array<{ name: string; status: ContractStatus; over?: Record<string, unknown> }> = [
    { name: "PAID (PENDING_PAYMENT with a payment transaction)", status: ContractStatus.PENDING_PAYMENT, over: { paymentTransactionId: "txn-already-paid" } },
    { name: "ACTIVE", status: ContractStatus.ACTIVE, over: { paymentTransactionId: "txn-1" } },
    { name: "CANCELLED", status: ContractStatus.CANCELLED },
    { name: "EXPIRED", status: ContractStatus.EXPIRED },
    { name: "COMPLETED", status: ContractStatus.COMPLETED, over: { paymentTransactionId: "txn-2" } },
    { name: "REJECTED", status: ContractStatus.REJECTED },
    { name: "PENDING_REVIEW", status: ContractStatus.PENDING_REVIEW },
    { name: "PENDING_SIGNATURE", status: ContractStatus.PENDING_SIGNATURE },
  ];
  for (const c of cases) {
    const made = await makeContract({ status: c.status, paymentDueAt: soon(), ...c.over });
    try {
      const before = await row(made.id);
      for (const opts of [{ once: true }, { once: false }, {}]) {
        const r = await contractRepository.extendPaymentDueAt(made.id, new Date(Date.now() + graceMs), opts);
        assert.equal(r.count, 0, `${c.name}: not extended (${JSON.stringify(opts)})`);
      }
      const after = await row(made.id);
      assert.equal(after.paymentDueAt.getTime(), before.paymentDueAt.getTime(), `${c.name}: deadline unchanged`);
      assert.equal(after.paymentDeadlineExtendedAt, null, `${c.name}: not stamped`);
      assert.equal(after.status, c.status, `${c.name}: status unchanged`);
    } finally {
      await prisma.contract.deleteMany({ where: { id: made.id } });
    }
  }
});

dbTest("[REGRESSION D13] pay() on a contract that is not PENDING_PAYMENT or is already paid is refused before any checkout or extension (ACTIVE / PAID -> 409 ALREADY_PAID, CANCELLED / EXPIRED -> 400)", { skip }, async () => {
  const p = installPayment();
  try {
    for (const [status, over, expected] of [
      [ContractStatus.ACTIVE, { paymentTransactionId: "txn-1" }, 409],
      [ContractStatus.PENDING_PAYMENT, { paymentTransactionId: "txn-paid" }, 409],
      [ContractStatus.CANCELLED, {}, 400],
      [ContractStatus.EXPIRED, {}, 400],
    ] as const) {
      const c = await makeContract({ status, paymentDueAt: new Date(Date.now() + 60_000), ...over });
      try {
        await assert.rejects(() => contractService.pay(c.id, c.clientUserId, "MOCK"), (e: any) => e.status === expected, `${status}`);
        assert.equal((await row(c.id)).paymentDeadlineExtendedAt, null);
      } finally {
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    }
    assert.equal(p.calls.length, 0, "no checkout was opened for any of them");
    assert.equal(p.extensions.length, 0, "no extension was even attempted");
  } finally {
    p.restore();
  }
});

// ── the deadline is final: payment callback after it, and the status stays consistent ─────────────

dbTest(
  "[REGRESSION D13] (default) after the extension is used the deadline is final: pay() is refused at the deadline, the sweep cancels, and a LATE payment is not activated (409 CONTRACT_NOT_ACTIVATABLE = payment-service's refund path)",
  { skip },
  async () => {
    await withFlag(undefined, async () => {
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
        // consistency: a cancelled contract is never extended afterwards, and its deadline is where the sweep found it
        assert.equal((await contractRepository.extendPaymentDueAt(c.id, new Date(Date.now() + graceMs), { once: true })).count, 0);
      } finally {
        restoreTxn();
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
    });
  },
);

dbTest(
  "[REGRESSION D13] deadline / status consistency: a payment confirmed INSIDE the (single) extended window activates the contract; the same payment after the sweep cancelled it is refused; the sweep never cancels a contract whose extended deadline is still ahead",
  { skip },
  async () => {
    await withFlag(undefined, async () => {
      const inTime = await makePendingPaymentContract();
      const tooLate = await makePendingPaymentContract();
      const p = installPayment();
      const txnIn = randomUUID();
      const txnLate = randomUUID();
      const restoreTxn = patch(paymentClient, "getTransaction", async (id: string) => ({
        id, status: "PAID", relatedEntityType: "PT_CONTRACT", relatedEntityId: id === txnIn ? inTime.id : tooLate.id,
      }));
      try {
        for (const c of [inTime, tooLate]) {
          await leave(c.id, 60_000);
          await contractService.pay(c.id, c.clientUserId, "MOCK"); // the one extension: ~now + 60 min
        }
        // the sweep runs while the extended deadline is ahead: nothing of ours is cancelled
        await contractService.cancelOverduePaymentContracts();
        assert.equal((await row(inTime.id)).status, "PENDING_PAYMENT");
        assert.equal((await row(tooLate.id)).status, "PENDING_PAYMENT");
        // payment lands inside the window -> ACTIVE with that transaction
        const activated = await contractService.activateAfterPayment(inTime.id, txnIn);
        assert.equal(activated.status, "ACTIVE");
        assert.equal(activated.paymentTransactionId, txnIn);
        // the other client stays past the deadline until the sweep cancels, then the money is refused
        await prisma.contract.update({ where: { id: tooLate.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
        await contractService.cancelOverduePaymentContracts();
        assert.equal((await row(tooLate.id)).status, "CANCELLED");
        await assert.rejects(
          () => contractService.activateAfterPayment(tooLate.id, txnLate),
          (e: any) => e.status === 409 && e.code === "CONTRACT_NOT_ACTIVATABLE",
        );
        // an ACTIVE contract is never touched by the sweep or the extension
        assert.equal((await contractRepository.extendPaymentDueAt(inTime.id, new Date(Date.now() + graceMs), { once: true })).count, 0);
        await contractService.cancelOverduePaymentContracts();
        assert.equal((await row(inTime.id)).status, "ACTIVE");
      } finally {
        restoreTxn();
        p.restore();
        await prisma.contract.deleteMany({ where: { id: { in: [inTime.id, tooLate.id] } } });
      }
    });
  },
);

// ── the emergency switch: explicit false = the old unlimited extension, warned about ──────────────

dbTest(
  "[DEFECT D13 - only with CHECKOUT_EXTENSION_ONCE=false] repeated extension is unlimited again, every pay() that reaches the extension logs a warning, and removing the switch restores the one-extension rule",
  { skip },
  async () => {
    await withFlag("false", async () => {
      const c = await makePendingPaymentContract();
      const p = installPayment();
      const warnings: string[] = [];
      const originalWarn = logger.warn.bind(logger);
      (logger as any).warn = (...args: any[]) => {
        warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        return (originalWarn as (...a: any[]) => unknown)(...args);
      };
      try {
        const rounds = 5;
        for (let i = 0; i < rounds; i++) {
          await leave(c.id, 60_000);
          const before = await dueAt(c.id);
          await contractService.pay(c.id, c.clientUserId, "MOCK");
          const after = await dueAt(c.id);
          assert.ok(after > before + graceMs - 5 * 60_000, `round ${i + 1}: the deadline was extended again (from ${before} to ${after})`);
        }
        assert.deepEqual(p.extensions.map((e) => e.count), Array(rounds).fill(1), `[DEFECT D13] ${rounds} extensions on ONE contract all succeeded`);
        const disabledWarnings = warnings.filter((w) => /CHECKOUT_EXTENSION_ONCE=false/.test(w) && /DISABLED/.test(w));
        assert.equal(disabledWarnings.length, rounds, "one warning per pay() that reached the extension");
        assert.ok(disabledWarnings.every((w) => w.includes(c.id)), "the warning names the contract");
      } finally {
        (logger as any).warn = originalWarn;
        p.restore();
        await prisma.contract.deleteMany({ where: { id: c.id } });
      }
      // switch removed: the rule is back, and a contract already extended 5 times (stamp set) gets no more
      await withFlag(undefined, async () => {
        const again = await makePendingPaymentContract();
        const q = installPayment();
        const quiet: string[] = [];
        const w0 = logger.warn.bind(logger);
        (logger as any).warn = (...args: any[]) => {
          quiet.push(String(args[args.length - 1]));
          return (w0 as (...a: any[]) => unknown)(...args);
        };
        try {
          await leave(again.id, 60_000);
          await contractService.pay(again.id, again.clientUserId, "MOCK");
          await leave(again.id, 60_000);
          await contractService.pay(again.id, again.clientUserId, "MOCK");
          assert.deepEqual(q.extensions.map((e) => e.count), [1, 0]);
          assert.equal(quiet.filter((m) => /DISABLED/.test(m)).length, 0, "no warning while the rule is on");
        } finally {
          (logger as any).warn = w0;
          q.restore();
          await prisma.contract.deleteMany({ where: { id: again.id } });
        }
      });
    });
  },
);

dbTest("[DEFECT D13 - only with CHECKOUT_EXTENSION_ONCE=false] concurrent two-tab pay(): both extend the same contract's deadline", { skip }, async () => {
  await withFlag("false", async () => {
    const c = await makePendingPaymentContract();
    const p = installPayment([0, 30]);
    try {
      await leave(c.id, 60_000);
      const results = await Promise.allSettled([
        contractService.pay(c.id, c.clientUserId, "MOCK"),
        contractService.pay(c.id, c.clientUserId, "MOCK"),
      ]);
      assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results));
      assert.deepEqual(p.extensions.map((e) => e.count), [1, 1], "both UPDATE ... payment_due_at < :to statements changed the row");
      assert.ok(p.extensions[1].to > p.extensions[0].to, "the later request moved the deadline further");
    } finally {
      p.restore();
      await prisma.contract.deleteMany({ where: { id: c.id } });
    }
  });
});
