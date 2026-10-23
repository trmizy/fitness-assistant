/**
 * F1 (D45 / L1 + L2) with the REAL payment-service ledger - what a contract's ending does to its leftover sessions,
 * and that a session left on an ended contract cannot trigger a compensation (drawn from the PT's POOLED available
 * balance, i.e. other contracts' money) a second time.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated test databases. TEST FIXTURE: the contract row (born PENDING_PAYMENT),
 * the signed gateway IPN, session rows inserted at the state a scenario starts from, auth-service's token table.
 * See cross-service-money.harness.ts. Opt-in; spawns payment-service and TRUNCATEs its ledger tables - run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-session-closure.e2e.test.ts
 *
 * Money maths (by hand): price 5,000,000 / 10 sessions => one session = 500,000 = PT 450,000 + platform 50,000
 * (no gym, holdback off). A client's own cancellation refunds 90% of the unused value, the other 10% is split 90/10.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

let H: Harness;
test.before(async () => {
  if (skip) return;
  H = await startHarness();
});
test.after(async () => {
  if (H) await H.close();
});

const ADMIN = "admin-e2e";
const PT_UNIT = 450_000;
const w = (a: number, p = 0, l = 0) => ({ a, p, l });
const show = (label: string, o: Record<string, unknown>) => console.log(`[E2E-MONEY] ${label} ${JSON.stringify(o)}`);

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}
const sessionRow = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });
async function ledger(pt: string, client: string) {
  return { client: await H.wallet("CLIENT", client), pt: await H.wallet("PT", pt), platform: await H.revenue(), escrow: await H.escrow() };
}

function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A PT with an innocent contract B (3 delivered sessions => 1,350,000 available) and the contract A that will end. */
async function setUp() {
  const pt = await H.makePt();
  const A = await H.paidContract(pt, { packageName: "Gói A" });
  const B = await H.paidContract(pt, { packageName: "Gói B" });
  await H.deliver(B, 3);
  await H.deliver(A, 2);
  // the leftover: booked, confirmed, starts in 3h - a PT cancel / date block now would, on a RUNNING contract, compensate 500,000
  const leftover = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
  return { pt, A, B, leftover };
}

/** Everything the PT could try in order to be "compensated for" / cancel the leftover: all must change nothing. */
async function tryEveryPtAction(pt: string, A: PaidContract, sessionId: string, day: string) {
  const ptTok = A.ptToken;
  const cancel = await H.call("PATCH", `/sessions/${sessionId}/cancel`, ptTok, { reason: "bận" });
  assert.equal(cancel.status, 409, `PT cancel: ${JSON.stringify(cancel.body)}`);
  const noShow = await H.call("PATCH", `/sessions/${sessionId}/no-show`, ptTok, { noShowBy: "PT" });
  assert.equal(noShow.status, 409, `PT no-show: ${JSON.stringify(noShow.body)}`);
  const noShowClient = await H.call("PATCH", `/sessions/${sessionId}/no-show`, ptTok, { noShowBy: "CLIENT" });
  assert.equal(noShowClient.status, 409);
  const done = await H.call("PATCH", `/sessions/${sessionId}/complete`, ptTok, { ptNotes: "x" });
  assert.equal(done.status, 409, `PT completion report: ${JSON.stringify(done.body)}`);
  const block = await H.call("POST", "/availability/me/exceptions", ptTok, { date: day, reason: "bận" });
  assert.equal(block.status, 201, JSON.stringify(block.body));
  const clientCancel = await H.call("PATCH", `/sessions/${sessionId}/cancel`, A.clientToken, { reason: "bận" });
  assert.equal(clientCancel.status, 409, "the client's late cancel of an ended contract's session is refused too");
  await H.m.prisma.pTScheduleException.deleteMany({ where: { ptUserId: pt } });
}

type Case = { reason: string; by: "client" | "pt" | "admin" };
const CASES: Case[] = [
  { reason: "CLIENT_CANCELLED", by: "client" },
  { reason: "PT_CANCELLED", by: "pt" },
  { reason: "MUTUAL", by: "admin" },
  { reason: "EXPIRED", by: "admin" },
  { reason: "COMPLETED", by: "admin" },
  { reason: "PT_REPEATED_NO_SHOW", by: "admin" },
];

for (const c of CASES) {
  test(`F1 ${c.reason}: the leftover CONFIRMED session is called off at the ending; no later action by the PT or client moves a single đồng; the PT's other contract is untouched`, { skip }, async () => {
    await scenario(async () => {
      const { pt, A, B, leftover } = await setUp();
      const bEntriesBefore = await H.entries(B.txnId);
      const before = await ledger(pt, A.clientUserId);
      assert.deepEqual(before.pt, w(5 * PT_UNIT, 4_500_000 - 2 * PT_UNIT + 4_500_000 - 3 * PT_UNIT), "PT: 5 delivered sessions earned, the rest pending");

      const token = c.by === "client" ? A.clientToken : c.by === "pt" ? A.ptToken : H.tokenFor(ADMIN, "ADMIN");
      const res = await H.call("POST", `/contracts/${A.id}/terminate`, token, { reason: c.reason });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const row = await sessionRow(leftover.id);
      assert.deepEqual([row.status, row.cancelledBy, row.sessionDeducted, row.ptAtFault], ["CANCELLED", "SYSTEM", false, false]);
      const aRow = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } });
      assert.equal(aRow.terminationReason, c.reason);
      assert.equal(aRow.usedSessions, 2, "the called-off session is not charged");
      assert.equal(aRow.compensatedSessions, 0, "and not compensated");
      await H.invariant(`after ${c.reason}`);

      const afterEnd = await ledger(pt, A.clientUserId);
      const snap = await H.snapshot();
      // the ending itself did not pay a compensation for the leftover: client got only the reason's refund
      const refundRows = (await H.entries(A.txnId)).filter((e) => e.ownerType === "CLIENT");
      assert.ok(refundRows.length <= 1, "at most the one refund credit on the client wallet");

      // the PT (and the client) now try every action that used to move money on a leftover session. The ending
      // already called the real one off; a LEGACY leftover (a session an older build left open on an ended contract)
      // is inserted behind its back, so the guards - not the call-off - are what is under test here.
      const legacy = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
      await tryEveryPtAction(pt, A, legacy.id, localDay(legacy.scheduledStartAt));
      assert.equal((await sessionRow(legacy.id)).status, "CONFIRMED", "the legacy leftover is inert, not rewritten");
      assert.deepEqual(await H.snapshot(), snap, "no ledger row, no balance changed");
      assert.deepEqual(await ledger(pt, A.clientUserId), afterEnd);
      assert.deepEqual(await H.entries(B.txnId), bEntriesBefore, "the PT's other contract's ledger rows are exactly what they were");
      assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } })).compensatedSessions, 0);

      show(`F1 ${c.reason}`, {
        clientBefore: before.client.a,
        clientAfterEnd: afterEnd.client.a,
        ptAvailableBefore: before.pt.a,
        ptAvailableAfterEnd: afterEnd.pt.a,
        ptPendingAfterEnd: afterEnd.pt.p,
        platformAvailableAfterEnd: afterEnd.platform.a,
        afterPtTriedEverything: "unchanged",
      });
    });
  });
}

test("F1 PT_BANNED (PT lock unwind): the leftover is called off; the ban settles the contract; nothing else moves", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const A = await H.paidContract(pt);
    await H.deliver(A, 2);
    const leftover = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    const second = await H.m.base.addSession(A, "REQUESTED", new Date(Date.now() + 2 * 24 * HOUR));
    const res = await H.m.ptDeactivationService.deactivatePT({ ptUserId: pt, adminId: ADMIN, reason: "vi phạm", seq: BigInt(Date.now()) });
    assert.equal(res.complete, true, JSON.stringify(res.outcomes));
    for (const s of [leftover, second]) assert.equal((await sessionRow(s.id)).status, "CANCELLED");
    // 8 unused sessions refunded 100% (PT_BANNED) = 4,000,000; the PT keeps the 2 delivered
    assert.deepEqual(await H.wallet("CLIENT", A.clientUserId), w(4_000_000));
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT, 0));
    const snap = await H.snapshot();
    // a banned PT cannot be paid for the leftover either: the contract is over, the session is gone
    const cancel = await H.call("PATCH", `/sessions/${leftover.id}/cancel`, A.ptToken, { reason: "x" });
    assert.ok(cancel.status >= 400);
    assert.deepEqual(await H.snapshot(), snap);
  });
});

test("[REGRESSION N7] F1 with NO guard, compensating the leftover of an ended contract no longer pays the client out of the PT's pooled available: the ledger draws only the contract's own pending (none left), nothing is fronted, the whole compensation is an unpaid obligation", { skip }, async () => {
  await scenario(async () => {
    const { pt, A, B, leftover } = await setUp();
    await H.call("POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" });
    const before = await ledger(pt, A.clientUserId);
    // This is exactly what a PT block / late cancel / no-show admission / room-close sweep called on a leftover
    // before the callers were guarded (those callers are still refused - see the other scenarios). Calling the raw step
    // proves the LEDGER itself is now safe even when a caller misses the gate (FH-1: payment-service draws only the
    // contract's own pending; D48 / N7).
    await H.m.payout.compensateNoShowMoney(A.id, leftover.id);
    const after = await ledger(pt, A.clientUserId);
    show("F1 raw compensateNoShowMoney on a leftover of an ended contract (after FH-1)", {
      clientDelta: after.client.a - before.client.a,
      ptAvailableDelta: after.pt.a - before.pt.a,
      platformAvailableDelta: after.platform.a - before.platform.a,
    });
    assert.equal(after.client.a - before.client.a, 0, "the client was NOT paid a second time out of money the contract no longer holds");
    assert.equal(after.pt.a, before.pt.a, "the PT's pooled available (contract B's earnings) is untouched");
    assert.equal(after.platform.a, before.platform.a, "and so is the platform's: nothing was fronted");
    assert.ok(B.id);
    await H.invariant("F1 after FH-1");
  });
});
