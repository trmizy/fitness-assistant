/**
 * FH-6 (honest notices) and FH-3c / D65-B (an unverified session step no longer blocks an ending) with the REAL payment-service
 * ledger.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned payment-service
 * child, real ledger, isolated test databases. TEST FIXTURE: the contract row, the signed gateway IPN, session rows at their
 * starting state, auth-service's token table, the "damaged ledger" SQL of the partial / zero funds cases and the NEEDS_HUMAN status
 * given to a release row (stands for 12 failed attempts). See cross-service-money.harness.ts. Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_fhe_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_fhe_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-fh6-fh3c.e2e.test.ts
 *
 * Hand-computed money
 *  FH-6: 1,000,000 / 4 sessions -> one session = 250,000 (PT 225,000 + platform 25,000).
 *        funded: client +250,000. partial (PT pending cut to 100,000): PT 100,000 + platform 25,000 = client +125,000, unpaid 125,000.
 *        zero: client +0, unpaid 250,000.
 *  FH-3c: 5,000,000 / 10 sessions, 4 delivered (3 released: PT 1,350,000 / platform 150,000), release of session 4 (PT 450,000 / platform 50,000) lost.
 *        PT_CANCELLED (client made whole): 6 unused x 500,000 = 3,000,000 refunded NOW.
 *          ledger never did the release -> session 4 is HELD: PT pending 450,000 / platform pending 50,000; PT available 1,350,000, platform 150,000.
 *          ledger did it but the answer was lost -> applied locally: PT available 1,800,000, platform 200,000, nothing held (a double pay would show 2,250,000).
 *        CLIENT_CANCELLED: refund 90% x 3,000,000 = 2,700,000; fee 300,000 -> PT 270,000 / platform 30,000 (top-up).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

let H: Harness;
test.before(async () => {
  if (skip) return;
  H = await startHarness();
});
test.after(async () => {
  if (H) await H.close();
});

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

// ── FH-6 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** TEST FIXTURE: a ledger whose pending was already short - `cut` taken out of one wallet's pending, escrow lowered by the same amount (invariant holds). */
async function cutPending(ownerType: "PT" | "PLATFORM", ownerId: string, cut: number) {
  await H.payDb.$executeRawUnsafe(
    `UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`,
    ownerType,
    ownerId,
  );
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
}

async function ptNoShow(c: PaidContract) {
  const session = await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
  const res = await H.call("PATCH", `/sessions/${session.id}/no-show`, c.ptToken, { noShowBy: "PT" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const notice = await H.m.prisma.notification.findFirst({ where: { userId: c.clientUserId, entityId: session.id, eventType: "SESSION_NO_SHOW_PT" } });
  assert.ok(notice, "the client notification row is actually stored");
  const row = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  return { session, text: notice.text, contract: row, remaining: (await import("../services/contract.service")).getRemainingEntitlements(row) };
}

test("FH-6 funded: PT no-show on a 4-session / 1,000,000 contract -> 'Đã hoàn 250.000đ vào ví', 3 sessions remain, the row is stored, the wallet really holds 250,000", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 4 });
    const r = await ptNoShow(c);
    assert.match(r.text, /Đã hoàn 250\.000đ vào ví\./);
    assert.doesNotMatch(r.text, /đối soát/);
    assert.match(r.text, /không diễn ra — hoàn tiền/);
    assert.equal(r.contract.compensatedSessions, 1);
    assert.equal(r.remaining, 3);
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 250_000);
  });
});

test("FH-6 partial funds (TEST FIXTURE: the PT's pending is short): 'Đã hoàn 125.000đ … 125.000đ còn lại đang được đối soát', no full-refund claim, still 3 sessions remain", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 4 });
    await cutPending("PT", pt, 800_000); // PT pending 900,000 -> 100,000
    const r = await ptNoShow(c);
    assert.match(r.text, /Đã hoàn 125\.000đ vào ví; 125\.000đ còn lại đang được đối soát\./);
    assert.doesNotMatch(r.text, /Đã hoàn 250\.000đ/);
    assert.equal(r.remaining, 3, "the session is consumed even though only part of it was refunded");
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 125_000, "the notice states what the wallet really received");
    const obligations: any[] = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contract_unpaid_obligations WHERE transaction_id = $1`, c.txnId);
    assert.equal(obligations[0].n, 1, "the unpaid 125,000 is an open obligation (not a PT debt)");
  });
});

test("FH-6 zero funds (TEST FIXTURE: both pending buckets empty): 'Chưa hoàn được vào ví ngay; 250.000đ đang được đối soát', never 'Đã hoàn'", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 4 });
    await cutPending("PT", pt, 900_000);
    await cutPending("PLATFORM", "REVENUE", 100_000);
    const r = await ptNoShow(c);
    assert.match(r.text, /Chưa hoàn được vào ví ngay; 250\.000đ đang được đối soát\./);
    assert.doesNotMatch(r.text, /Đã hoàn/);
    assert.equal(r.remaining, 3);
    assert.equal((await H.wallet("CLIENT", c.clientUserId)).a, 0);
  });
});

// ── FH-3c ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 3 sessions delivered and released, then a 4th that is delivered while payment-service is DOWN (or whose answer is lost): its release row is FAILED. */
async function contractWithLostRelease(mode: "NEVER_PERFORMED" | "PERFORMED_ANSWER_LOST") {
  const pt = await H.makePt();
  const c = await H.paidContract(pt);
  await H.deliver(c, 3);
  const s4 = await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 9 * DAY));
  const done = await H.call("PATCH", `/sessions/${s4.id}/complete`, c.ptToken, { ptNotes: "ok" });
  assert.equal(done.status, 200);
  let undo = () => {};
  if (mode === "NEVER_PERFORMED") {
    await H.stopPayment();
  } else {
    const original = H.m.paymentClient.releaseSession.bind(H.m.paymentClient);
    const saved = H.m.paymentClient.releaseSession;
    (H.m.paymentClient as any).releaseSession = async (body: any) => {
      await original(body); // the ledger performs it ...
      throw new Error("timeout of 15000ms exceeded"); // ... and the answer is lost
    };
    undo = () => ((H.m.paymentClient as any).releaseSession = saved);
  }
  try {
    const conf = await H.call("POST", `/sessions/${s4.id}/confirm`, c.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
  } finally {
    undo();
    await H.startPayment();
  }
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${s4.id}` } });
  assert.equal(row.status, "FAILED", "the release is recorded and unsettled");
  // TEST FIXTURE: 12 failed attempts later it is parked
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
  const after = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(after.usedSessions, 4);
  assert.equal(Number(after.releasedToPt), 1_350_000, "session 4's release was not applied locally");
  return { pt, c, s4, row };
}

const ledgerNet = async (c: PaidContract) => ({
  client: (await H.wallet("CLIENT", c.clientUserId)).a,
  ptAvail: await H.net(c.txnId, "PT", "AVAILABLE"),
  ptPend: await H.net(c.txnId, "PT", "PENDING"),
  platAvail: await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
  platPend: await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"),
});

test("[REGRESSION D64-B] ledger NEVER did the release of session 4 (payment was down): PT_CANCELLED refunds 3,000,000 NOW, HOLDS 500,000 in the contract's own pending, row UNCONFIRMED", { skip }, async () => {
  await scenario(async () => {
    const { c, s4, row } = await contractWithLostRelease("NEVER_PERFORMED");
    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const n = await ledgerNet(c);
    assert.deepEqual(n, { client: 3_000_000, ptAvail: 1_350_000, ptPend: 450_000, platAvail: 150_000, platPend: 50_000 });
    assert.equal((await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "UNCONFIRMED");
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED");

    // later resolution, DELIVERED: exactly the held 500,000 is released, once
    const first = await H.m.payout.resolveUnconfirmedSessionMoney(c.id, s4.id, "DELIVERED");
    assert.equal(first.state, "SETTLED");
    assert.deepEqual(await ledgerNet(c), { client: 3_000_000, ptAvail: 1_800_000, ptPend: 0, platAvail: 200_000, platPend: 0 });
    assert.equal((await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED");
    assert.equal(Number((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt), 1_800_000);
    assert.equal((await H.m.payout.resolveUnconfirmedSessionMoney(c.id, s4.id, "DELIVERED")).state, "NOT_HELD");
    assert.equal((await ledgerNet(c)).ptAvail, 1_800_000, "no second release");
  });
});

test("[REGRESSION D64-B] same, resolved NOT_DELIVERED: the client is refunded the held 500,000 from the contract's own money, the PT gets nothing for session 4", { skip }, async () => {
  await scenario(async () => {
    const { c, s4 } = await contractWithLostRelease("NEVER_PERFORMED");
    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await H.m.prisma.session.update({ where: { id: s4.id }, data: { status: "CANCELLED" } }); // the admin ruling's effect on the session
    assert.equal((await H.m.payout.resolveUnconfirmedSessionMoney(c.id, s4.id, "NOT_DELIVERED")).state, "SETTLED");
    assert.deepEqual(await ledgerNet(c), { client: 3_500_000, ptAvail: 1_350_000, ptPend: 0, platAvail: 150_000, platPend: 0 });
  });
});

test("[REGRESSION D64-B] CLIENT_CANCELLED with the same lost release: refund 2,700,000 now, 500,000 held, fee 300,000 topped up to PT 270,000 / platform 30,000", { skip }, async () => {
  await scenario(async () => {
    const { c } = await contractWithLostRelease("NEVER_PERFORMED");
    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await ledgerNet(c), { client: 2_700_000, ptAvail: 1_620_000, ptPend: 450_000, platAvail: 180_000, platPend: 50_000 });
  });
});

test("[REGRESSION D64-B] 'lost answer': the ledger DID perform the release of session 4 -> applied locally once, 3,000,000 refunded, NOTHING held, PT paid 1,800,000 (not 2,250,000)", { skip }, async () => {
  await scenario(async () => {
    const { c, s4, row } = await contractWithLostRelease("PERFORMED_ANSWER_LOST");
    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await ledgerNet(c), { client: 3_000_000, ptAvail: 1_800_000, ptPend: 0, platAvail: 200_000, platPend: 0 });
    const settled = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(settled.status, "SETTLED");
    assert.equal(Number((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt), 1_800_000, "applied exactly once");
    const ops: any[] = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `SESSION_RELEASE:${s4.id}`);
    assert.equal(ops[0].n, 1, "the release exists once in the ledger");
    // the ending replayed (a retried request) changes nothing
    const again = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.ok(again.status === 200 || again.status === 409, JSON.stringify(again.body));
    assert.equal((await ledgerNet(c)).ptAvail, 1_800_000);
  });
});

test("payment-service unreachable while the ending meets the unverified row: 409, nothing moved, nothing recorded; once it is back the same ending goes through", { skip }, async () => {
  await scenario(async () => {
    const { c } = await contractWithLostRelease("NEVER_PERFORMED");
    const snap = await H.snapshot();
    await H.stopPayment();
    const down = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(down.status, 409, JSON.stringify(down.body));
    assert.equal(down.body.code ?? down.body.error?.code, "SESSION_SETTLEMENT_PENDING");
    assert.equal(await H.m.prisma.sessionSettlement.count({ where: { contractId: c.id, kind: "CONTRACT_TERMINATION" } }), 0);
    await H.startPayment();
    assert.deepEqual(await H.snapshot(), snap, "the ledger is exactly as it was");
    const up = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((await ledgerNet(c)).client, 3_000_000);
  });
});

// ── D77: the preview names the payment transaction ──────────────────────────────────────────────────────────────────────

test("D77: a late arrival on a session that the ending then HOLDS -> the client's preview (refund AND amount held) equals what the ending really credits / keeps", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    const T = Date.now();
    const P = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
    // the PT joined late: the client is compensated in cash, deducted from THIS session's value (D77)
    const late: any = await H.m.payout.compensateLateArrivalMoney(c.id, P.id);
    assert.equal(late.state, "SETTLED", JSON.stringify(late));
    const before = (await H.wallet("CLIENT", c.clientUserId)).a;
    assert.ok(before > 0, "the late-arrival compensation was credited");

    const preview = await H.call("GET", `/contracts/${c.id}/money-breakdown`, c.clientToken);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const previewRefund = Number(preview.body.refundIfCancelledNow);
    const previewHeld = Number(preview.body.unresolvedAmountHeld);

    const res = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const credited = (await H.wallet("CLIENT", c.clientUserId)).a - before;
    const heldNow = (await H.net(c.txnId, "PT", "PENDING")) + (await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"));
    console.log(`[E2E-MONEY] D77 ${JSON.stringify({ late: late.result?.compensation, previewRefund, credited, previewHeld, heldNow })}`);
    assert.equal(credited, previewRefund, "the quote equals what the ending credited");
    assert.equal(previewHeld, heldNow, "the quoted held amount equals what the ledger really keeps for the held session (the late compensation was already taken out of it)");
    assert.ok(heldNow < 500_000, "less than a full session is held: the late compensation came out of this session's value");
  });
});
