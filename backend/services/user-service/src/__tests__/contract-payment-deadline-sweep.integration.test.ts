/**
 * Hạn thanh toán 12 giờ — sweep tự huỷ hợp đồng PENDING_PAYMENT quá hạn, và cuộc đua với thanh
 * toán vừa thành công.
 *
 * BACKEND INTEGRATION — Postgres thật qua DATABASE_URL (chạy với DB test cô lập
 * gymcoach_user_test, KHÔNG phải DB dev). Giống contract-validity-days-applied-on-activation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { paymentClient } from "../clients/payment.client";
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
      paymentDueAt: new Date(Date.now() - HOUR),
      ...overrides,
    },
  });
}

async function cleanup(ids: string[]) {
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

test("sweep cancels an overdue PENDING_PAYMENT contract: CANCELLED/SYSTEM/reason, audit row, CONTRACT_CANCELLED to BOTH parties", async () => {
  const c = await makeContract();
  try {
    const out = await runContractPaymentDeadlineSweep();
    assert.ok(out.cancelled >= 1);

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.cancelledBy, "SYSTEM");
    assert.match(after.cancellationReason ?? "", /Quá hạn thanh toán 12 giờ/);
    assert.equal(after.paymentTransactionId, null);

    const notes = await prisma.notification.findMany({ where: { entityId: c.id } });
    assert.deepEqual(notes.map((n) => n.userId).sort(), [c.clientUserId, c.ptUserId].sort());
    assert.ok(notes.every((n) => n.eventType === "CONTRACT_CANCELLED"));

    const audit = await prisma.auditLog.findMany({ where: { entityId: c.id } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "CONTRACT_CANCELLED");
    assert.equal(audit[0].actorUserId, "SYSTEM");
  } finally {
    await cleanup([c.id]);
  }
});

test("sweep leaves alone: not-yet-due, ACTIVE (paid), and rows with no deadline (marketplace / legacy)", async () => {
  const notDue = await makeContract({ paymentDueAt: new Date(Date.now() + HOUR) });
  const active = await makeContract({ status: "ACTIVE", paymentTransactionId: "txn-1", paymentDueAt: new Date(Date.now() - HOUR) });
  const noDeadline = await makeContract({ paymentDueAt: null });
  const ids = [notDue.id, active.id, noDeadline.id];
  try {
    await runContractPaymentDeadlineSweep();
    const rows = await prisma.contract.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(notDue.id), "PENDING_PAYMENT");
    assert.equal(byId.get(active.id), "ACTIVE");
    assert.equal(byId.get(noDeadline.id), "PENDING_PAYMENT");
  } finally {
    await cleanup(ids);
  }
});

test("RACE: payment succeeded just before the sweep's write -> guarded cancel affects 0 rows, contract stays ACTIVE", async () => {
  const c = await makeContract();
  try {
    // The sweep already SELECTed this row as overdue (stale view)...
    const stale = await contractRepository.findOverduePendingPayment(new Date());
    assert.ok(stale.some((r) => r.id === c.id));
    // ...then the payment webhook lands...
    const activated = await contractRepository.activateIfPending(c.id, "txn-paid");
    assert.equal(activated?.status, "ACTIVE");
    // ...and only then the sweep writes. The guard must refuse.
    const res = await contractRepository.cancelIfPaymentOverdue(c.id, new Date(), "x");
    assert.equal(res.count, 0);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.paymentTransactionId, "txn-paid");
  } finally {
    await cleanup([c.id]);
  }
});

test("RACE: deadline extended/not overdue at write time -> guarded cancel affects 0 rows", async () => {
  const c = await makeContract();
  try {
    // Row was overdue when read; before the write someone moved the deadline forward.
    await prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() + HOUR) } });
    const res = await contractRepository.cancelIfPaymentOverdue(c.id, new Date(), "x");
    assert.equal(res.count, 0);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "PENDING_PAYMENT");
  } finally {
    await cleanup([c.id]);
  }
});

test("RACE (concurrent, 25 rounds): payment and sweep fired together never leave a CANCELLED contract that has a payment", async () => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < 25; i++) {
      const c = await makeContract();
      ids.push(c.id);
      await Promise.all([
        contractRepository.activateIfPending(c.id, `txn-${i}`),
        contractRepository.cancelIfPaymentOverdue(c.id, new Date(), "x"),
      ]);
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      const paid = after.paymentTransactionId != null;
      assert.ok(
        !(after.status === "CANCELLED" && paid),
        `round ${i}: CANCELLED but paid (status=${after.status}, txn=${after.paymentTransactionId})`,
      );
      // And the two valid outcomes only:
      assert.ok(
        (after.status === "ACTIVE" && paid) || (after.status === "CANCELLED" && !paid),
        `round ${i}: unexpected final state ${after.status}/${after.paymentTransactionId}`,
      );
    }
  } finally {
    await cleanup(ids);
  }
});

test("a failure on one contract does not stop the rest of the batch", async () => {
  const bad = await makeContract({ paymentDueAt: new Date(Date.now() - 2 * HOUR) });
  const good = await makeContract({ paymentDueAt: new Date(Date.now() - HOUR) });
  const original = contractRepository.cancelIfPaymentOverdue;
  (contractRepository as any).cancelIfPaymentOverdue = (id: string, now: Date, reason: string) => {
    if (id === bad.id) throw new Error("boom");
    return original(id, now, reason);
  };
  try {
    await contractService.cancelOverduePaymentContracts();
    const g = await prisma.contract.findUniqueOrThrow({ where: { id: good.id } });
    const b = await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } });
    assert.equal(g.status, "CANCELLED");
    assert.equal(b.status, "PENDING_PAYMENT");
  } finally {
    (contractRepository as any).cancelIfPaymentOverdue = original;
    await cleanup([bad.id, good.id]);
  }
});

test("paymentDueAt is returned by the contract list/read API shape (getByClient spreads the row)", async () => {
  const due = new Date(Date.now() + HOUR);
  const c = await makeContract({ paymentDueAt: due });
  try {
    const row = await contractRepository.findById(c.id);
    assert.equal(row?.paymentDueAt?.getTime(), due.getTime());
  } finally {
    await cleanup([c.id]);
  }
});

// ── Checkout-in-progress extension (pay -> extendPaymentDueAt) ─────────────────────────────────

const GRACE_MS = 60 * 60 * 1000;

/** Stub only the gateway call; findById / extendPaymentDueAt / sweep are the real ones on the test DB. */
async function payWithStubbedGateway(c: { id: string; clientUserId: string }, fail = false) {
  const original = paymentClient.checkout;
  (paymentClient as any).checkout = async () => {
    if (fail) throw new Error("gateway down");
    return { redirectUrl: "https://gateway.example/pay" };
  };
  try {
    return await contractService.pay(c.id, c.clientUserId);
  } finally {
    (paymentClient as any).checkout = original;
  }
}

const priced = { price: "1000000", platformRate: "0.1", ptRate: "0.9", gymRate: "0" };

test("pay shortly before the deadline moves paymentDueAt to ~now + grace; the sweep then leaves it alone although the ORIGINAL deadline has passed", async () => {
  const c = await makeContract({ ...priced, paymentDueAt: new Date(Date.now() + 2 * 60 * 1000) });
  try {
    await payWithStubbedGateway(c);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    const delta = after.paymentDueAt!.getTime() - Date.now();
    assert.ok(delta > GRACE_MS - 10_000 && delta <= GRACE_MS, "extended by the grace");

    // The original deadline (+2 min) is long past in real life; sweep must not cancel.
    await contractService.cancelOverduePaymentContracts();
    const swept = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(swept.status, "PENDING_PAYMENT");
  } finally {
    await cleanup([c.id]);
  }
});

test("pay long before the deadline leaves paymentDueAt unchanged", async () => {
  const due = new Date(Date.now() + 10 * HOUR);
  const c = await makeContract({ ...priced, paymentDueAt: due });
  try {
    await payWithStubbedGateway(c);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.paymentDueAt!.getTime(), due.getTime());
  } finally {
    await cleanup([c.id]);
  }
});

test("after the EXTENDED deadline passes with no payment the sweep cancels, and pay refuses with PAYMENT_DEADLINE_PASSED", async () => {
  const c = await makeContract({ ...priced, paymentDueAt: new Date(Date.now() + 60 * 1000) });
  try {
    await payWithStubbedGateway(c);
    // Time passes: the extended deadline is now behind us.
    await prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
    await assert.rejects(
      () => payWithStubbedGateway(c),
      (e: any) => e.status === 409 && e.code === "PAYMENT_DEADLINE_PASSED",
    );
    await contractService.cancelOverduePaymentContracts();
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.cancelledBy, "SYSTEM");
  } finally {
    await cleanup([c.id]);
  }
});

test("failed checkout creation does not extend the deadline", async () => {
  const due = new Date(Date.now() + 2 * 60 * 1000);
  const c = await makeContract({ ...priced, paymentDueAt: due });
  try {
    await assert.rejects(() => payWithStubbedGateway(c, true), /gateway down/);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.paymentDueAt!.getTime(), due.getTime());
  } finally {
    await cleanup([c.id]);
  }
});

test("extension is guarded: CANCELLED / paid contract, a later existing deadline, or no deadline are never touched", async () => {
  const cancelled = await makeContract({ status: "CANCELLED", paymentDueAt: new Date(Date.now() - HOUR) });
  const paid = await makeContract({ status: "ACTIVE", paymentTransactionId: "t", paymentDueAt: new Date(Date.now() - HOUR) });
  const later = await makeContract({ paymentDueAt: new Date(Date.now() + 5 * HOUR) });
  const noDeadline = await makeContract({ paymentDueAt: null });
  const ids = [cancelled.id, paid.id, later.id, noDeadline.id];
  const to = new Date(Date.now() + GRACE_MS);
  try {
    for (const id of ids) {
      const r = await contractRepository.extendPaymentDueAt(id, to);
      assert.equal(r.count, 0, id);
    }
    const rows = await prisma.contract.findMany({ where: { id: { in: ids } } });
    assert.equal(rows.find((r) => r.id === cancelled.id)!.status, "CANCELLED");
    assert.equal(rows.find((r) => r.id === noDeadline.id)!.paymentDueAt, null);
    assert.ok(rows.find((r) => r.id === later.id)!.paymentDueAt!.getTime() > to.getTime());
  } finally {
    await cleanup(ids);
  }
});

test("repeated pay calls: the extension is always bounded to now + grace, never compounding grace on grace", async () => {
  const c = await makeContract({ ...priced, paymentDueAt: new Date(Date.now() + 60 * 1000) });
  try {
    await payWithStubbedGateway(c);
    const first = (await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).paymentDueAt!.getTime();
    await payWithStubbedGateway(c);
    const second = (await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).paymentDueAt!.getTime();
    assert.ok(second - first < 10_000, "second pay right away adds only elapsed time");
    assert.ok(second <= Date.now() + GRACE_MS);
  } finally {
    await cleanup([c.id]);
  }
});
