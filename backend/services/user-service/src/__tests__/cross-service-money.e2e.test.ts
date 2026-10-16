/**
 * Phase 2.5A (bổ sung 11/10, section H; backlog item C) - the money paths run END TO END between the REAL
 * user-service and the REAL payment-service ledger. No payment-service stub anywhere in this file.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between two real service processes' code (user-service's Express
 * app in this process, payment-service as a spawned `node --import tsx src/server.ts` child), real ledger, isolated
 * test databases (gymcoach_user_test + gymcoach_payment_test). TEST FIXTURE steps are limited to: the contract row
 * (born PENDING_PAYMENT), the gateway's signed IPN (the one party that cannot run here), session rows at their
 * starting state (e.g. "already over"), and auth-service's token table. Not covered: gateway, browser, a real
 * payment gateway, mobile. See cross-service-money.harness.ts for the exact wiring.
 *
 * It spawns payment-service and TRUNCATEs its ledger tables, so it is opt-in and must be run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 \
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money.e2e.test.ts
 *
 * Money maths used below (all derived by hand, not read back from the code under test): price 5,000,000 / 10 sessions
 * => one session = 500,000 = PT 450,000 (90%) + platform 50,000 (10%); no gym, holdback off. A client's own
 * cancellation refunds 90% of the unused value and the remaining 10% is shared 90/10 PT/platform; PT_CANCELLED,
 * PT_BANNED and the restriction exit refund 100% of the unused value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

let H: Harness;

test.before(async () => {
  if (skip) return;
  H = await startHarness();
});
test.after(async () => {
  if (H) await H.close();
});

const ADMIN = "admin-e2e";
const EXIT = "CLIENT_EXIT_DUE_TO_PT_RESTRICTION";
const UNIT = 500_000;
const PT_UNIT = 450_000;
const PLAT_UNIT = 50_000;
const P = 5_000_000;

const suspendInput = (pt: string) => ({ ptUserId: pt, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW" as const, reasonText: "nội bộ", publicReason: "Đang xem xét một phản ánh" });
const restrictInput = (pt: string, contractId: string) => ({ ptUserId: pt, contractId, adminId: ADMIN, ...{ reasonCategory: "COMPLAINT_REVIEW" as const, reasonText: "nội bộ", publicReason: "Đang xem xét một phản ánh" } });

const w = (a: number, p = 0, l = 0) => ({ a, p, l });
const show = (label: string, o: Record<string, unknown>) => console.log(`[E2E-MONEY] ${label} ${JSON.stringify(o)}`);

async function contractRow(id: string) {
  return H.m.prisma.contract.findUniqueOrThrow({ where: { id } });
}
async function statusOf(sessionId: string) {
  return (await H.m.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status;
}
/** Run a scenario with a clean payment ledger and always clean the user-service rows it made. */
async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    await H.startPayment().catch(() => {}); // a scenario may have stopped it
    await H.cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// A. Baseline regression
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("A1. client completes 2 sessions -> PT and platform released exactly; ordinary client cancellation refunds 90% of the unused value, once", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);

    // the real payment settled the ledger: price in escrow, split into the parties' PENDING buckets
    assert.deepEqual(await H.escrow(), w(P));
    assert.deepEqual(await H.wallet("PT", pt), w(0, 4_500_000));
    assert.deepEqual(await H.revenue(), w(0, 500_000));

    await H.deliver(c, 2);
    const mid = await contractRow(c.id);
    assert.equal(mid.usedSessions, 2);
    assert.equal(mid.releasedToPt.toString(), String(2 * PT_UNIT));
    assert.equal(mid.releasedToPlatform.toString(), String(2 * PLAT_UNIT));
    assert.equal(mid.releasedToGym.toString(), "0");
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT, 4_500_000 - 2 * PT_UNIT));
    assert.deepEqual(await H.revenue(), w(2 * PLAT_UNIT, 500_000 - 2 * PLAT_UNIT));
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(0));
    assert.deepEqual(await H.escrow(), w(P));
    await H.invariant("after 2 sessions");
    show("A1 after 2 sessions", { ptAvailable: 900_000, ptPending: 3_600_000, platformAvailable: 100_000, platformPending: 400_000, client: 0 });

    // preview, then the real cancellation
    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(Number(preview.body.refundIfCancelledNow), 3_600_000);
    assert.equal(preview.body.exitReasonIfCancelledNow, "CLIENT_CANCELLED");
    assert.equal(preview.body.canExitWithoutPenalty, false);

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reason, "CLIENT_CANCELLED");
    assert.equal(Number(res.body.settlement.refund), 3_600_000);

    // 8 unused sessions = 4,000,000; 90% back to the client; the 10% fee (400,000) is shared 90/10
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(3_600_000));
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT + 360_000, 0));
    assert.deepEqual(await H.revenue(), w(2 * PLAT_UNIT + 40_000, 0));
    assert.deepEqual(await H.escrow(), w(P));
    assert.equal(await H.net(c.txnId, "PT", "PENDING"), 0);
    assert.equal(await H.net(c.txnId, "PLATFORM", "PENDING"), 0);
    const clientRows = (await H.entries(c.txnId)).filter((e) => e.ownerType === "CLIENT");
    assert.equal(clientRows.length, 1, "exactly one refund credit on the client wallet");
    assert.deepEqual([clientRows[0].type, clientRows[0].bucket, clientRows[0].amount], ["CREDIT", "AVAILABLE", 3_600_000]);
    const after = await contractRow(c.id);
    assert.deepEqual([after.status, after.terminationReason, after.usedSessions], ["CANCELLED", "CLIENT_CANCELLED", 2]);
    await H.invariant("after client cancel");
    show("A1 after cancel", { client: 3_600_000, ptAvailable: 1_260_000, platformAvailable: 140_000, held: 0 });

    // the same request again moves nothing
    const snap = await H.snapshot();
    const again = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(await H.snapshot(), snap, "a repeated cancellation moves no money");
  });
});

test("A2. PT-initiated cancellation: 100% of the unused value goes back, holdback off so no compensation, no receivable", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.settlement.refund), 4_000_000);
    assert.equal(res.body.settlement.ptHoldback, undefined, "no holdback on this contract");

    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(4_000_000));
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT, 0), "the PT keeps exactly what the 2 delivered sessions earned");
    assert.deepEqual(await H.revenue(), w(2 * PLAT_UNIT, 0));
    const rows = await H.entries(c.txnId);
    assert.equal(rows.filter((e) => e.ownerType === "CLIENT").length, 1, "one credit on the client, no separate compensation row");
    assert.ok(!rows.some((e) => /compensation/i.test(e.description) && e.ownerType === "CLIENT" && e.amount !== 4_000_000), "no compensation");
    assert.equal((await H.snapshot()).receivables, 0, "no receivable raised against the PT");
    const after = await contractRow(c.id);
    assert.deepEqual([after.status, after.terminationReason], ["CANCELLED", "PT_CANCELLED"]);
    await H.invariant("after PT cancel");
    show("A2 after PT cancel", { client: 4_000_000, ptAvailable: 900_000, platformAvailable: 100_000, compensation: 0 });

    const snap = await H.snapshot();
    const again = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.ok([200, 400, 409].includes(again.status), `repeat answered ${again.status}`);
    assert.deepEqual(await H.snapshot(), snap, "a repeated PT cancellation moves no money");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// B. The owner's main case - An with 4 paid contracts, only An-Bình restricted
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("B. An has 4 paid contracts and only An-Bình is restricted: An keeps earning exactly the shares of Chi/Dũng/Em, Bình's contract earns nothing, and Bình leaving touches none of the others' money", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const binh = await H.paidContract(pt, { packageName: "Gói binh" });
    const chi = await H.paidContract(pt, { packageName: "Gói chi" });
    const dung = await H.paidContract(pt, { packageName: "Gói dung" });
    const em = await H.paidContract(pt, { packageName: "Gói em" });
    const slot = await H.m.scope.openSlotFor(pt);
    assert.deepEqual(await H.wallet("PT", pt), w(0, 18_000_000));
    assert.deepEqual(await H.escrow(), w(4 * P));

    // Bình's past-and-confirmed session: the thing An would have reported done (fixture)
    const binhPast = await H.m.base.addSession(binh, "CONFIRMED", new Date(Date.now() - 3 * HOUR));
    const binhEntriesBefore = await H.entries(binh.txnId);

    // the admin restricts ONLY An-Bình (real admin service function)
    const r = await H.m.ptRestrictionService.restrictContract(restrictInput(pt, binh.id));
    assert.equal(r.changed, true);
    assert.equal(r.restriction.scope, "CONTRACT");
    assert.equal((await H.m.prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false, "An himself is not suspended");

    // (4) An cannot coach Bình; Bình cannot book
    const noCoach = await H.call("PATCH", `/sessions/${binhPast.id}/complete`, binh.ptToken, { ptNotes: "ok" });
    assert.deepEqual([noCoach.status, noCoach.body.code], [409, "CONTRACT_PAUSED_BY_ADMIN"]);
    const noBook = await H.call("POST", "/sessions", binh.clientToken, { contractId: binh.id, ...slot });
    assert.deepEqual([noBook.status, noBook.body.code], [409, "CONTRACT_PAUSED_BY_ADMIN"]);
    assert.equal(await statusOf(binhPast.id), "CONFIRMED");

    // (1-3) An still books and teaches Chi: a real booking + real PT confirmation
    const booked = await H.call("POST", "/sessions", chi.clientToken, { contractId: chi.id, ...slot });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const confirmed = await H.call("PATCH", `/sessions/${booked.body.id}/confirm`, chi.ptToken);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

    // ... and earns from Chi (2), Dũng (1), Em (3) - the real release path, real ledger
    await H.deliver(chi, 2);
    await H.deliver(dung, 1);
    await H.deliver(em, 3);
    for (const [c, n] of [[chi, 2], [dung, 1], [em, 3]] as Array<[PaidContract, number]>) {
      const row = await contractRow(c.id);
      assert.equal(row.usedSessions, n);
      assert.equal(row.releasedToPt.toString(), String(n * PT_UNIT));
      assert.equal(await H.net(c.txnId, "PT", "AVAILABLE"), n * PT_UNIT, "An's AVAILABLE grew by exactly this contract's shares");
      assert.equal(await H.net(c.txnId, "PT", "PENDING"), 4_500_000 - n * PT_UNIT);
    }
    // An's AVAILABLE is exactly the six delivered sessions' shares - nothing from Bình
    assert.deepEqual(await H.wallet("PT", pt), w(6 * PT_UNIT, 18_000_000 - 6 * PT_UNIT));
    assert.deepEqual(await H.revenue(), w(6 * PLAT_UNIT, 2_000_000 - 6 * PLAT_UNIT));
    // (5 of the money side) Bình's contract earned nothing and nothing in its ledger moved
    assert.deepEqual(await H.entries(binh.txnId), binhEntriesBefore, "Bình's ledger rows are exactly the payment's, nothing since");
    assert.equal(await H.net(binh.txnId, "PT", "AVAILABLE"), 0);
    assert.equal(await H.net(binh.txnId, "PT", "PENDING"), 4_500_000);
    const binhRow = await contractRow(binh.id);
    assert.deepEqual([binhRow.usedSessions, binhRow.releasedToPt.toString()], [0, "0"]);
    await H.invariant("after deliveries");
    show("B after deliveries", { ptAvailable: 2_700_000, ptPending: 15_300_000, platformAvailable: 300_000, binhEarned: 0 });

    // (6) Bình leaves: full refund of the unused value, and nothing of the other three is touched
    const others = [chi, dung, em];
    const rowsBefore = await Promise.all(others.map((c) => H.entries(c.txnId)));
    const exit = await H.call("POST", `/contracts/${binh.id}/terminate`, binh.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(exit.status, 200, JSON.stringify(exit.body));
    assert.deepEqual([exit.body.reason, exit.body.exitWithoutPenalty], [EXIT, true]);
    assert.equal(Number(exit.body.settlement.refund), P);
    assert.deepEqual(await H.wallet("CLIENT", binh.clientUserId), w(P));
    assert.equal(await H.net(binh.txnId, "PT", "PENDING"), 0);
    assert.equal(await H.net(binh.txnId, "PT", "AVAILABLE"), 0, "the restricted contract paid An nothing");
    assert.equal(await H.net(binh.txnId, "PLATFORM", "PENDING"), 0);
    const rowsAfter = await Promise.all(others.map((c) => H.entries(c.txnId)));
    assert.deepEqual(rowsAfter, rowsBefore, "Chi/Dũng/Em's ledger rows are untouched by anything Bình-related");
    assert.deepEqual(await H.wallet("PT", pt), w(6 * PT_UNIT, 3 * 4_500_000 - 6 * PT_UNIT));
    assert.deepEqual(await H.escrow(), w(4 * P));
    const binhAfter = await contractRow(binh.id);
    assert.deepEqual([binhAfter.status, binhAfter.terminationReason], ["CANCELLED", EXIT]);
    for (const c of others) assert.equal((await contractRow(c.id)).status, "ACTIVE");

    // An keeps earning after Bình left: one more of Em's sessions
    await H.deliver(em, 1);
    assert.deepEqual(await H.wallet("PT", pt), w(7 * PT_UNIT, 3 * 4_500_000 - 7 * PT_UNIT));
    await H.invariant("end of B");
    show("B after Bình exit + 1 more Em session", { ptAvailable: 3_150_000, ptPending: 10_350_000, binhRefund: P, binhEarned: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// C. Exit with unresolved sessions held, then resolved
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("C. Bình exits with 4 used, 1 awaiting confirmation, 1 disputed, 4 not happened: 4 sessions refunded, 2 held; confirm -> one session released; ruling 'not delivered' -> one more refunded; final = 5 used / 5 unused; repeats move nothing", { skip }, async () => {
  await scenario(async () => {
    const T = Date.now();
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 4);
    const awaiting = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 1 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
    const disputed = await H.m.base.addSession(c, "DISPUTED", new Date(T - 2 * DAY), { disputeReason: "x", disputedAt: new Date(T - DAY), disputeType: "DELIVERY_DISPUTE" });
    const future: string[] = [];
    for (const [status, d] of [["CONFIRMED", 1], ["CONFIRMED", 2], ["REQUESTED", 3], ["REQUESTED", 4]] as const) {
      future.push((await H.m.base.addSession(c, status, new Date(T + d * DAY))).id);
    }
    assert.deepEqual(await H.wallet("PT", pt), w(4 * PT_UNIT, 4_500_000 - 4 * PT_UNIT));
    await H.m.ptRestrictionService.suspend(suspendInput(pt));

    // the preview the client sees first
    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(Number(preview.body.refundIfCancelledNow), 4 * UNIT);
    assert.equal(Number(preview.body.unresolvedAmountHeld), 2 * UNIT);
    assert.equal(preview.body.unresolvedSessions, 2);

    const exit = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(exit.status, 200, JSON.stringify(exit.body));
    assert.deepEqual([exit.body.reason, exit.body.unresolvedSessions], [EXIT, 2]);
    assert.equal(Number(exit.body.settlement.refund), 4 * UNIT, "exactly 4 sessions refunded");
    // user-service rows
    const afterExit = await contractRow(c.id);
    assert.deepEqual([afterExit.status, afterExit.terminationReason, afterExit.usedSessions], ["CANCELLED", EXIT, 4]);
    assert.equal(await statusOf(awaiting.id), "PENDING_CLIENT_CONFIRMATION");
    assert.equal(await statusOf(disputed.id), "DISPUTED");
    for (const f of future) assert.equal(await statusOf(f), "CANCELLED");
    // payment-service ledger: 4 refunded, 2 held in the PT's and platform's pending for THIS contract
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(4 * UNIT));
    assert.deepEqual(await H.wallet("PT", pt), w(4 * PT_UNIT, 2 * PT_UNIT));
    assert.deepEqual(await H.revenue(), w(4 * PLAT_UNIT, 2 * PLAT_UNIT));
    assert.equal(await H.net(c.txnId, "PT", "PENDING"), 2 * PT_UNIT);
    await H.invariant("after exit");
    show("C after exit", { client: 4 * UNIT, ptAvailable: 4 * PT_UNIT, ptHeld: 2 * PT_UNIT, platformAvailable: 4 * PLAT_UNIT, platformHeld: 2 * PLAT_UNIT });

    // the client confirms the awaiting session (a restricted PT does not stop the client): released for exactly one session
    const confirm = await H.call("POST", `/sessions/${awaiting.id}/confirm`, c.clientToken);
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(await statusOf(awaiting.id), "COMPLETED");
    const afterConfirm = await contractRow(c.id);
    assert.equal(afterConfirm.usedSessions, 5);
    assert.equal(afterConfirm.releasedToPt.toString(), String(5 * PT_UNIT), "what the ledger really released is tracked");
    assert.deepEqual(await H.wallet("PT", pt), w(5 * PT_UNIT, 1 * PT_UNIT));
    assert.deepEqual(await H.revenue(), w(5 * PLAT_UNIT, 1 * PLAT_UNIT));
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(4 * UNIT), "client unchanged by the delivered session");
    await H.invariant("after confirm");
    show("C after confirm", { ptAvailable: 5 * PT_UNIT, ptHeld: PT_UNIT, platformAvailable: 5 * PLAT_UNIT, client: 4 * UNIT });

    // the admin rules the disputed session NOT delivered: one more session refunded
    const ruling = await H.call("POST", `/admin/sessions/${disputed.id}/resolve`, H.tokenFor(ADMIN, "ADMIN"), { resolution: "CANCELLED", note: "không dạy" });
    assert.equal(ruling.status, 200, JSON.stringify(ruling.body));
    assert.equal(await statusOf(disputed.id), "CANCELLED");
    assert.equal((await contractRow(c.id)).usedSessions, 5, "not delivered does not count");
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(5 * UNIT));
    assert.deepEqual(await H.wallet("PT", pt), w(5 * PT_UNIT, 0));
    assert.deepEqual(await H.revenue(), w(5 * PLAT_UNIT, 0));
    assert.deepEqual(await H.escrow(), w(P));
    // nothing left in this contract's pending
    assert.equal(await H.net(c.txnId, "PT", "PENDING"), 0);
    assert.equal(await H.net(c.txnId, "PLATFORM", "PENDING"), 0);
    // settlement rows (user-service side): one per session, both SETTLED, with the matching outcome
    const rows = await H.m.prisma.sessionSettlement.findMany({ where: { contractId: c.id, kind: "UNRESOLVED_SESSION_RESOLUTION" } });
    assert.deepEqual(rows.map((r) => `${r.reason}:${r.status}`).sort(), ["DELIVERED:SETTLED", "NOT_DELIVERED:SETTLED"]);
    await H.invariant("after ruling");
    show("C final", { used: 5, unused: 5, client: 5 * UNIT, ptAvailable: 5 * PT_UNIT, platformAvailable: 5 * PLAT_UNIT, pendingLeft: 0 });

    // repeats: terminate, confirm, ruling, a direct replay of each resolution and the opposite outcome - nothing moves
    const snap = await H.snapshot();
    const again = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.alreadyTerminated, true);
    assert.ok((await H.call("POST", `/sessions/${awaiting.id}/confirm`, c.clientToken)).status >= 400, "a second confirm is refused");
    assert.ok((await H.call("POST", `/admin/sessions/${disputed.id}/resolve`, H.tokenFor(ADMIN, "ADMIN"), { resolution: "COMPLETED", note: "lại" })).status >= 400, "a second ruling is refused");
    await H.m.payout.resolveUnresolvedSessionMoney(c.id, awaiting.id, "DELIVERED");
    await H.m.payout.resolveUnresolvedSessionMoney(c.id, disputed.id, "NOT_DELIVERED");
    await H.m.payout.resolveUnresolvedSessionMoney(c.id, awaiting.id, "NOT_DELIVERED"); // the other way: refused loudly, never applied
    await H.m.payout.resolveUnresolvedSessionMoney(c.id, disputed.id, "DELIVERED");
    assert.deepEqual(await H.snapshot(), snap, "no second movement of any kind");
    assert.equal((await contractRow(c.id)).usedSessions, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// D. expectNoPenalty and a failed payment call
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("D1. expectNoPenalty after the restriction was lifted: 409 with the current terms, the contract stays ACTIVE and the ledger does not move at all", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    await H.m.ptRestrictionService.suspend(suspendInput(pt));
    await H.m.ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "đã xong" });
    const snap = await H.snapshot();

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.deepEqual([res.status, res.body.code], [409, "PT_RESTRICTION_LIFTED"], JSON.stringify(res.body));
    assert.equal(Number(res.body.currentTerms.refundIfCancelledNow), 3_600_000, "the client is shown what cancelling costs NOW (90% of the unused value)");
    assert.equal(res.body.currentTerms.canExitWithoutPenalty, false);
    const row = await contractRow(c.id);
    assert.deepEqual([row.status, row.terminationReason, row.clientExitAcceptedAt], ["ACTIVE", null, null]);
    assert.deepEqual(await H.snapshot(), snap, "not one ledger row, wallet change or operation");
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(0));
    show("D1", { status: res.status, code: res.body.code, ledgerMoved: false });
  });
});

test("D2. accepted exit whose payment call fails (payment-service down): nothing moves, the acceptance is kept; after the lift and payment-service back, the retry settles with the NEUTRAL reason and exactly one refund", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 1);
    await H.m.ptRestrictionService.suspend(suspendInput(pt));
    const snap = await H.snapshot();

    await H.stopPayment(); // the one call that fails: payment-service is really gone
    const failed = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    // D59: loud, never "ended": the ending is RECORDED but unconfirmed -> 409 CONTRACT_ENDING (it used to be a bare 500 with nothing recorded).
    assert.equal(failed.status, 409, `the exit must fail loudly while payment-service is down, got ${failed.status}`);
    assert.equal(failed.body.code, "CONTRACT_ENDING");
    const mid = await contractRow(c.id);
    assert.equal(mid.status, "ACTIVE", "not cancelled without a refund");
    assert.ok(mid.clientExitAcceptedAt, "the server's acceptance of the no-fee terms is durable");

    await H.m.ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "đã xong" }); // the restriction ends before the retry
    await H.startPayment();
    assert.deepEqual(await H.snapshot(), snap, "the failed attempt moved nothing");

    const retry = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.reason, EXIT, "the accepted terms survive the lift");
    assert.equal(Number(retry.body.settlement.refund), 9 * UNIT, "100% of the 9 unused sessions");
    const after = await contractRow(c.id);
    assert.deepEqual([after.status, after.terminationReason], ["CANCELLED", EXIT]);
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(9 * UNIT));
    assert.deepEqual(await H.wallet("PT", pt), w(PT_UNIT, 0));
    assert.deepEqual(await H.revenue(), w(PLAT_UNIT, 0));
    const clientCredits = (await H.entries(c.txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT");
    assert.equal(clientCredits.length, 1, "exactly one refund");
    await H.invariant("after retry");

    const done = await H.snapshot();
    const repeat = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body));
    assert.equal(repeat.body.alreadyTerminated, true);
    assert.deepEqual(await H.snapshot(), done, "a repeat refunds nothing more");
    show("D2", { failedStatus: failed.status, client: 9 * UNIT, ptAvailable: PT_UNIT, refunds: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// E. Account-scope suspension
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("E. suspending a PT with 2 contracts terminates nothing and moves nothing; lifting moves nothing; a client exiting during a suspension gets the neutral 100% refund and the other contract is untouched", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const x = await H.paidContract(pt, { packageName: "Gói X" });
    const y = await H.paidContract(pt, { packageName: "Gói Y" });
    await H.deliver(x, 1);
    await H.deliver(y, 1);
    const s0 = await H.snapshot();

    await H.m.ptRestrictionService.suspend(suspendInput(pt));
    for (const c of [x, y]) {
      const row = await contractRow(c.id);
      assert.deepEqual([row.status, row.terminationReason], ["ACTIVE", null], "no termination");
    }
    assert.deepEqual(await H.snapshot(), s0, "suspension: no ledger movement at all");

    await H.m.ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "đã xong" });
    assert.deepEqual(await H.snapshot(), s0, "lift: nothing moved either");
    for (const c of [x, y]) assert.equal((await contractRow(c.id)).status, "ACTIVE");

    // suspended again; X's client leaves
    await H.m.ptRestrictionService.suspend(suspendInput(pt));
    const yRows = await H.entries(y.txnId);
    const exit = await H.call("POST", `/contracts/${x.id}/terminate`, x.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(exit.status, 200, JSON.stringify(exit.body));
    assert.deepEqual([exit.body.reason, exit.body.exitWithoutPenalty], [EXIT, true]);
    assert.equal(Number(exit.body.settlement.refund), 9 * UNIT, "neutral: 100% of the unused value, no fee");
    assert.deepEqual(await H.wallet("CLIENT", x.clientUserId), w(9 * UNIT));
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT, 4_500_000 - PT_UNIT), "PT: both delivered sessions kept, Y's pending untouched");
    assert.deepEqual(await H.entries(y.txnId), yRows, "Y's ledger rows are untouched");
    assert.equal((await contractRow(y.id)).status, "ACTIVE");
    assert.equal((await H.snapshot()).receivables, 0, "no compensation, no receivable");
    await H.invariant("end of E");
    show("E", { suspendMoved: false, liftMoved: false, clientX: 9 * UNIT, ptAvailable: 2 * PT_UNIT, ptPendingY: 4_050_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// F. Permanent ban unwind
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("F. permanent-ban unwind with 3 contracts: each client gets 100% of the unused value exactly once; rerunning the unwind (same command, a newer one, and the per-contract unwind) moves nothing", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const cs = [await H.paidContract(pt, { packageName: "F1" }), await H.paidContract(pt, { packageName: "F2" }), await H.paidContract(pt, { packageName: "F3" })];
    const used = [1, 2, 0];
    for (let i = 0; i < 3; i++) if (used[i]) await H.deliver(cs[i], used[i]);
    const cmd = { ptUserId: pt, adminId: ADMIN, reason: "khoá vĩnh viễn", seq: 1n };

    const run = await H.m.ptDeactivationService.deactivatePT(cmd);
    assert.equal(run.complete, true);
    assert.equal(run.outcomes.length, 3);
    const byContract = new Map(run.outcomes.map((o) => [o.contractId, o]));
    for (let i = 0; i < 3; i++) {
      const o = byContract.get(cs[i].id)!;
      const expected = (10 - used[i]) * UNIT;
      assert.equal(o.status, "REFUNDED");
      assert.equal(o.refundAmount, expected);
      assert.deepEqual(await H.wallet("CLIENT", cs[i].clientUserId), w(expected), `contract ${i + 1}: 100% of the unused value`);
      const row = await contractRow(cs[i].id);
      assert.deepEqual([row.status, row.terminationReason, row.usedSessions], ["CANCELLED", "PT_BANNED", used[i]]);
      assert.equal((await H.entries(cs[i].txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT").length, 1, "one refund per contract");
      assert.equal(await H.net(cs[i].txnId, "PT", "PENDING"), 0);
    }
    assert.deepEqual(await H.wallet("PT", pt), w(3 * PT_UNIT, 0), "the PT keeps only the 3 delivered sessions");
    assert.deepEqual(await H.revenue(), w(3 * PLAT_UNIT, 0));
    assert.equal((await H.snapshot()).receivables, 0);
    await H.invariant("after unwind");
    show("F after unwind", { clients: [4_500_000, 4_000_000, 5_000_000], ptAvailable: 3 * PT_UNIT, platformAvailable: 3 * PLAT_UNIT });

    const snap = await H.snapshot();
    const retry = await H.m.ptDeactivationService.deactivatePT(cmd); // the very same command (relay retry)
    const newer = await H.m.ptDeactivationService.deactivatePT({ ...cmd, seq: 2n });
    assert.deepEqual([retry.complete, retry.outcomes.length, newer.complete, newer.outcomes.length], [true, 0, true, 0]);
    // the strongest replay: the per-contract unwind runs again against the real ledger -> payment-service replays its first answer
    for (let i = 0; i < 3; i++) {
      const o = await H.m.ptDeactivationService.unwindContract(await contractRow(cs[i].id), "khoá vĩnh viễn", { adminId: ADMIN, seq: 1n });
      assert.equal(o.status, "ALREADY_ENDED");
      assert.equal(o.refundAmount, (10 - used[i]) * UNIT, "the replay reports the same refund and pays none");
    }
    assert.deepEqual(await H.snapshot(), snap, "no second refund of any kind");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// G. Preview equals execution (7 sessions, so the maths is not whole-đồng by luck)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("G1. ordinary contract: the preview's refund equals what the real cancellation credits, to the đồng", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { totalSessions: 7 });
    await H.deliver(c, 2);
    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.exitReasonIfCancelledNow, "CLIENT_CANCELLED");
    const quoted = preview.body.refundIfCancelledNow as string;

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const credited = (await H.wallet("CLIENT", c.clientUserId)).a;
    assert.equal(credited, Number(quoted), `credited ${credited} vs quoted ${quoted}`);
    assert.equal(Number(res.body.settlement.refund), Number(quoted));
    assert.ok(credited > 0 && credited < 5 * (P / 7), "a real 90% figure, not zero or the full unused value");
    await H.invariant("G1");
    show("G1", { quoted, credited });
  });
});

test("G2. account-restricted contract with a session awaiting confirmation: the preview's refund AND held amount equal what the real exit credits and keeps held", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { totalSessions: 7 });
    await H.deliver(c, 3);
    await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), { clientConfirmDeadline: new Date(Date.now() + 2 * DAY) });
    await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() + 2 * DAY));
    await H.m.ptRestrictionService.suspend(suspendInput(pt));

    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual([preview.body.exitReasonIfCancelledNow, preview.body.canExitWithoutPenalty, preview.body.unresolvedSessions], [EXIT, true, 1]);
    const quoted = preview.body.refundIfCancelledNow as string;
    const quotedHeld = preview.body.unresolvedAmountHeld as string;

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const credited = (await H.wallet("CLIENT", c.clientUserId)).a;
    assert.equal(credited, Number(quoted), `credited ${credited} vs quoted ${quoted}`);
    const heldInLedger = (await H.net(c.txnId, "PT", "PENDING")) + (await H.net(c.txnId, "PLATFORM", "PENDING"));
    assert.equal(Math.round(heldInLedger * 100) / 100, Number(quotedHeld), `held ${heldInLedger} vs quoted ${quotedHeld}`);
    assert.equal(Number(res.body.settlement.unresolved.amountHeld), Number(quotedHeld));
    await H.invariant("G2");
    show("G2", { quotedRefund: quoted, credited, quotedHeld, heldInLedger });
  });
});

test("G3. contract-scope restricted contract: the preview's refund equals what the real exit credits, to the đồng", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { totalSessions: 7 });
    await H.deliver(c, 2);
    await H.m.ptRestrictionService.restrictContract(restrictInput(pt, c.id));

    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual([preview.body.exitReasonIfCancelledNow, preview.body.canExitWithoutPenalty], [EXIT, true]);
    const quoted = preview.body.refundIfCancelledNow as string;

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reason, EXIT);
    const credited = (await H.wallet("CLIENT", c.clientUserId)).a;
    assert.equal(credited, Number(quoted), `credited ${credited} vs quoted ${quoted}`);
    assert.equal(Number(res.body.settlement.refund), Number(quoted));
    await H.invariant("G3");
    show("G3", { quoted, credited });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// H. Probe found while building the harness (NOT one of the owner's scenarios): the gateway amount
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// Fixed in payment-service: the IPN's signed vnp_Amount is now compared with the transaction's price and a mismatch
// answers RspCode 04 without settling (vnpay-callback.service.ts / webhook.service.ts handleEvent). Was `todo` while it failed.
test("H1. a correctly SIGNED IPN that reports a smaller paid amount than the contract price must not settle the full price", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const { row, txnId } = await H.startCheckout(pt);
    const ipn = await H.gatewayIpn(txnId, 1_000); // gateway says 1,000 VND was paid for a 5,000,000 VND contract
    const escrow = (await H.escrow()).a;
    const contract = await contractRow(row.id);
    show("H1", { ipn, escrowAfterIpnOf1000: escrow, contractStatus: contract.status });
    assert.ok(escrow <= 1_000, `escrow was credited ${escrow} for an IPN that reported 1000 paid`);
    assert.notEqual(contract.status, "ACTIVE", "the contract must not activate on a short payment");
  });
});
