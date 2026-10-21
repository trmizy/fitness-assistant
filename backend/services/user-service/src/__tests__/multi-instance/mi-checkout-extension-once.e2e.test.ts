/**
 * D13 (owner decision APPROVED) across INSTANCES: a contract's payment deadline is extended by a checkout AT MOST ONCE, with the pay()
 * requests spread over TWO separate user-service OS processes (own Prisma pools, own memory) against ONE database, so no in-process
 * flag or lock can be what holds the line - only the conditional UPDATE (`... AND payment_deadline_extended_at IS NULL`) can.
 *
 * How "exactly once" is observed rather than inferred: a trigger (a TEST FIXTURE installed on the isolated *_mi_test database only)
 * writes one row to `d13_due_log` for EVERY statement that changes `contracts.payment_due_at`. The assertion is the row count per
 * contract, not the final value (two racing extensions would end at nearly the same time and be indistinguishable by value).
 *
 * Evidence label: BACKEND INTEGRATION (real HTTP into two real Express processes, real Postgres, the real payment-service process
 * answering the checkout; the VNPay gateway is not called - checkout only creates the pending transaction). See mi.harness.ts for what
 * is a fixture (token table instead of auth-service). Run alone:
 *   cd backend/services/user-service
 *   RUN_MULTI_INSTANCE=1 MI_USER_DATABASE_URL=postgresql://...@localhost:55433/gymcoach_user_g9_mi_test?schema=public \
 *   MI_PAYMENT_DATABASE_URL=postgresql://...@localhost:55433/gymcoach_payment_g9_mi_test?schema=public \
 *   ./node_modules/.bin/tsx --test src/__tests__/multi-instance/mi-checkout-extension-once.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { HOUR, skip, startMi, type Mi } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 2 });
  await M.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS d13_due_log (contract_id text NOT NULL, old_due timestamp(3), new_due timestamp(3), at timestamptz NOT NULL DEFAULT now())`);
  await M.prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION d13_log_due() RETURNS trigger AS $$
    BEGIN
      INSERT INTO d13_due_log (contract_id, old_due, new_due) VALUES (NEW.id, OLD.payment_due_at, NEW.payment_due_at);
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await M.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS d13_log_due_trg ON contracts`);
  await M.prisma.$executeRawUnsafe(
    `CREATE TRIGGER d13_log_due_trg AFTER UPDATE OF payment_due_at ON contracts FOR EACH ROW WHEN (OLD.payment_due_at IS DISTINCT FROM NEW.payment_due_at) EXECUTE FUNCTION d13_log_due()`,
  );
});
test.after(async () => {
  if (M) {
    await M.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS d13_log_due_trg ON contracts`);
    await M.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS d13_due_log`);
    await M.close();
  }
});

const GRACE_MS = 60 * 60_000;

async function pendingPayment(ptUserId: string, dueInMs = 90_000) {
  return M.prisma.contract.create({
    data: {
      id: crypto.randomUUID(), ptUserId, clientUserId: crypto.randomUUID(), packageName: "Goi 10 buoi", totalSessions: 10, price: 5_000_000,
      status: "PENDING_PAYMENT", sessionDurationMinutes: 60, validityDays: 90, paymentDueAt: new Date(Date.now() + dueInMs),
    },
  });
}
const pay = (inst: number, c: { id: string; clientUserId: string }) => M.call(inst, "POST", `/contracts/${c.id}/pay`, M.tokenFor(c.clientUserId, "CUSTOMER"), { provider: "VNPAY" });
const dueChanges = async (id: string) => Number(((await M.prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM d13_due_log WHERE contract_id = '${id}'`)) as any[])[0].n);
const row = (id: string) => M.prisma.contract.findUniqueOrThrow({ where: { id } }) as Promise<any>;

test("the one-extension rule is on in a user-service process started with no CHECKOUT_EXTENSION_ONCE at all (the default)", { skip }, async () => {
  assert.equal(process.env.CHECKOUT_EXTENSION_ONCE, undefined, "the test run itself must not set the switch");
  await M.resetAll();
  const c = await pendingPayment(await M.makePt());
  const first = await pay(0, c);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const after = await row(c.id);
  assert.ok(Math.abs(after.paymentDueAt.getTime() - (Date.now() + GRACE_MS)) < 60_000, "the first extension applied: ~now + 60 min");
  assert.ok(after.paymentDeadlineExtendedAt, "...and is remembered in the database");
  assert.equal(await dueChanges(c.id), 1);
});

test("sequential across instances: the 2nd, 3rd and 4th pay() (alternating process 1, 0, 1) open a checkout but add NO time", { skip }, async () => {
  await M.resetAll();
  const c = await pendingPayment(await M.makePt());
  assert.equal((await pay(0, c)).status, 200);
  const extendedTo = (await row(c.id)).paymentDueAt.getTime();
  assert.equal(await dueChanges(c.id), 1);
  for (const inst of [1, 0, 1]) {
    // time passes: the client is back on the payment page with a minute left of what the first extension gave
    await M.prisma.$executeRawUnsafe(`ALTER TABLE contracts DISABLE TRIGGER d13_log_due_trg`);
    await M.prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() + 60_000) } });
    await M.prisma.$executeRawUnsafe(`ALTER TABLE contracts ENABLE TRIGGER d13_log_due_trg`);
    const r = await pay(inst, c);
    assert.equal(r.status, 200, `instance ${inst}: the checkout is still opened (${JSON.stringify(r.body)})`);
    const due = (await row(c.id)).paymentDueAt.getTime();
    assert.ok(due < Date.now() + 2 * 60_000, `instance ${inst}: deadline NOT pushed out again (${due - Date.now()} ms left)`);
    assert.ok(due < extendedTo - 30 * 60_000, "and certainly not back to ~60 minutes");
  }
  assert.equal(await dueChanges(c.id), 1, "ONE statement ever changed payment_due_at (the first extension)");
});

test("concurrent across instances: pay() fired on BOTH processes at the same instant, 8 contracts x 2 -> exactly ONE deadline change per contract", { skip }, async () => {
  await M.resetAll();
  const pt = await M.makePt();
  const contracts = await Promise.all(Array.from({ length: 8 }, () => pendingPayment(pt, 45_000)));
  const results = await Promise.all(contracts.flatMap((c) => [pay(0, c).then((r) => ({ c, r })), pay(1, c).then((r) => ({ c, r }))]));
  for (const { c, r } of results) assert.equal(r.status, 200, `contract ${c.id}: ${JSON.stringify(r.body)}`);
  for (const c of contracts) {
    assert.equal(await dueChanges(c.id), 1, `contract ${c.id}: exactly one extension across two processes`);
    const after = await row(c.id);
    assert.ok(after.paymentDeadlineExtendedAt);
    assert.ok(Math.abs(after.paymentDueAt.getTime() - (Date.now() + GRACE_MS)) < 90_000);
    assert.equal(after.status, "PENDING_PAYMENT");
  }
});

test("a contract that is not PENDING_PAYMENT, or already carries a payment, is never extended by a pay() on either process", { skip }, async () => {
  await M.resetAll();
  const pt = await M.makePt();
  const cancelled = await pendingPayment(pt, 45_000);
  await M.prisma.contract.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
  const expired = await pendingPayment(pt, 45_000);
  await M.prisma.contract.update({ where: { id: expired.id }, data: { status: "EXPIRED" } });
  const active = await pendingPayment(pt, 45_000);
  await M.prisma.contract.update({ where: { id: active.id }, data: { status: "ACTIVE", paymentTransactionId: "txn-d13-active" } });
  const paid = await pendingPayment(pt, 45_000);
  await M.prisma.contract.update({ where: { id: paid.id }, data: { paymentTransactionId: "txn-d13-paid" } });
  await M.prisma.$executeRawUnsafe(`DELETE FROM d13_due_log`);
  for (const c of [cancelled, expired, active, paid]) {
    for (const inst of [0, 1]) {
      const r = await pay(inst, c);
      assert.ok(r.status === 400 || r.status === 409, `${c.id}: refused (${r.status} ${JSON.stringify(r.body)})`);
    }
    assert.equal(await dueChanges(c.id), 0, `${c.id}: payment_due_at never changed`);
    assert.equal((await row(c.id)).paymentDeadlineExtendedAt, null);
  }
});

test("the deadline stays final across instances: after the one extension the contract passes its deadline, pay() on either process is refused 409 PAYMENT_DEADLINE_PASSED and the sweep on the other process cancels it", { skip }, async () => {
  await M.resetAll();
  const c = await pendingPayment(await M.makePt(), 30_000);
  assert.equal((await pay(0, c)).status, 200); // the one extension
  await M.prisma.$executeRawUnsafe(`ALTER TABLE contracts DISABLE TRIGGER d13_log_due_trg`);
  await M.prisma.contract.update({ where: { id: c.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
  await M.prisma.$executeRawUnsafe(`ALTER TABLE contracts ENABLE TRIGGER d13_log_due_trg`);
  for (const inst of [0, 1]) {
    const r = await pay(inst, c);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "PAYMENT_DEADLINE_PASSED");
  }
  const swept = await M.job(1, "paymentDeadline");
  assert.equal(swept.error, undefined);
  assert.equal((await row(c.id)).status, "CANCELLED");
  assert.equal(await dueChanges(c.id), 1, "still only the first extension");
  void HOUR;
});
