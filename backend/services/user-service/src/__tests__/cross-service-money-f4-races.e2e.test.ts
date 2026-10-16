/**
 * F4 (D56) + Decision A (D52) with the REAL payment-service ledger.
 *
 *  (1) Races next to a contract ENDING - the client's late cancel, the PT's late cancel, the PT admitting a no-show, the PT
 *      blocking the day, the room-close sweep - each runs against the ending in every order (ending first, action first,
 *      simultaneous). The invariant: exactly ONE valid business outcome; the ending's refund is computed from the session's
 *      FINAL state; no đồng is paid twice or lost; the escrow invariant holds; the loser gets a coded 409.
 *  (2) A compensation that FAILED while payment-service was down is settled by the ending BEFORE it prices the refund, and
 *      the settlement sweep cannot pay it a second time.
 *  (3) Decision A - a PT_NO_SHOW_REPORTED session at the ending is HELD like a disputed one: the other unused sessions are
 *      refunded at once per the ending reason, the held session's 500,000 stays PENDING, and the admin's ruling
 *      (NOT_DELIVERED / DELIVERED) settles it exactly once.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated test databases. TEST FIXTURE: the contract row, the signed gateway IPN,
 * session rows at their starting state, auth-service's token table. See cross-service-money.harness.ts. Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-f4-races.e2e.test.ts
 *
 * Hand-computed money (price 5,000,000 / 10 sessions; one session = 500,000 = PT 450,000 + platform 50,000; no gym; holdback
 * off). Contract A has 2 delivered sessions (PT 900,000 + platform 100,000 AVAILABLE) and 8 sessions of unused value.
 * CLIENT_CANCELLED refunds 90% of the unused value; the other 10% is split 90/10 PT / platform.
 *   ending with 8 unused:                       client 3,600,000   PT avail 900,000 + 360,000 = 1,260,000  platform 100,000 + 40,000 = 140,000
 *   cancel won (1 more delivered, 7 unused):    client 3,150,000   PT avail 3 x 450,000 + 315,000 = 1,665,000  platform 3 x 50,000 + 35,000 = 185,000
 *   no-show won (1 compensated, 7 unused):      client 500,000 + 3,150,000 = 3,650,000   PT avail 900,000 + 315,000 = 1,215,000  platform 135,000
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

async function aNet(A: PaidContract) {
  return {
    client: (await H.wallet("CLIENT", A.clientUserId)).a,
    ptAvail: await H.net(A.txnId, "PT", "AVAILABLE"),
    ptPend: await H.net(A.txnId, "PT", "PENDING"),
    platAvail: await H.net(A.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await H.net(A.txnId, "PLATFORM", "PENDING", "REVENUE"),
  };
}

/** A PT with an innocent contract B (3 delivered => 1,350,000 available) and the contract A that will end (2 delivered). */
async function setUp() {
  const pt = await H.makePt();
  const A = await H.paidContract(pt, { packageName: "Gói A" });
  const B = await H.paidContract(pt, { packageName: "Gói B" });
  await H.deliver(B, 3);
  await H.deliver(A, 2);
  return { pt, A, B };
}

type Lane = "ending-first" | "op-first" | "simultaneous";
const LANES: Lane[] = ["ending-first", "op-first", "simultaneous"];
const endReq = (A: PaidContract) => () => H.call("POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" });

/** Real HTTP: the ending's controller does work before it reaches the lock, so which request takes the lock first is NOT forced here (the forced orders are in contract-race-family.integration.test.ts); every outcome must satisfy the invariant. */
async function launch<T>(lane: Lane, end: () => Promise<{ status: number; body: any }>, op: () => Promise<T>) {
  if (lane === "ending-first") {
    const e = end();
    await sleep(15);
    const o = op();
    return { e: await e, o: await o };
  }
  if (lane === "op-first") {
    const o = op();
    await sleep(15);
    const e = end();
    return { o: await o, e: await e };
  }
  const [e, o] = await Promise.all([end(), op()]);
  return { e, o };
}

const AFTER_ENDING_ONLY = { client: 3_600_000, ptAvail: 900_000 + 360_000, platAvail: 100_000 + 40_000 };
const AFTER_CANCEL_THEN_ENDING = { client: 3_150_000, ptAvail: 3 * 450_000 + 315_000, platAvail: 3 * 50_000 + 35_000 };
const AFTER_NOSHOW_THEN_ENDING = { client: 3_650_000, ptAvail: 900_000 + 315_000, platAvail: 100_000 + 35_000 };

function assertCoded409(o: { status: number; body: any }, lane: string) {
  assert.ok(o.status === 409 || o.status === 400, `${lane}: a clear refusal, got ${o.status} ${JSON.stringify(o.body)}`);
  assert.ok(["CONTRACT_ENDED", "CONTRACT_ENDING", "SESSION_STATE_NOT_ALLOWED", "SESSION_ALREADY_PROCESSED"].includes(o.body?.code), `${lane}: coded: ${JSON.stringify(o.body)}`);
}

// ── 1. client late cancel vs ending ────────────────────────────────────────────────────────────

for (const lane of LANES) {
  test(`F4 E1 ${lane}: the client's late cancel (<24h, charged + PT paid) vs the client ending the contract - one outcome, the refund is priced from the final state`, { skip }, async () => {
    await scenario(async () => {
      const { pt, A, B } = await setUp();
      const leftover = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
      const bEntries = await H.entries(B.txnId);
      const before = await aNet(A);
      const { e, o } = await launch(lane, endReq(A), () => H.call("PATCH", `/sessions/${leftover.id}/cancel`, A.clientToken, { reason: "bận" }));
      assert.equal(e.status, 200, JSON.stringify(e.body) + H.paymentLog().slice(-800));
      const won = o.status === 200;
      const sess = await sessionRow(leftover.id);
      const aRow = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } });
      const after = await aNet(A);
      show(`F4 E1 ${lane}`, { cancelWon: won, before, after, usedSessions: aRow.usedSessions });
      if (won) {
        assert.deepEqual([sess.cancelledBy, sess.sessionDeducted, aRow.usedSessions], [A.clientUserId, true, 3]);
        assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_CANCEL_THEN_ENDING);
      } else {
        assertCoded409(o, lane);
        assert.deepEqual([sess.cancelledBy, sess.sessionDeducted, aRow.usedSessions], ["SYSTEM", false, 2]);
        assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_ENDING_ONLY);
      }
      assert.deepEqual([after.ptPend, after.platPend], [0, 0]);
      assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000, "contract A's price is fully accounted for");
      assert.deepEqual(await H.entries(B.txnId), bEntries, "the PT's other contract is untouched");
      assert.ok(pt);
    });
  });
}

// Forced orders with the real ledger: both sides are called as services (no controller preamble). The second request is started
// only once the first is PROVABLY inside the lock - its payment-service call has begun (observed at the paymentClient boundary,
// the real HTTP call still goes out). A fixed 20 ms stagger (the earlier version) flipped the order on a loaded machine
// (AUDIT D57-3: "forced cancel first" failed 2 of 13 / 1 of 1 loaded runs with the ending taking the lock first).
function whenCalled(method: "terminate" | "releaseSession") {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  let seen!: () => void;
  const called = new Promise<void>((r) => (seen = r));
  pc[method] = function (...args: unknown[]) {
    seen();
    return original.apply(this, args);
  };
  return {
    called: Promise.race([called, sleep(10_000).then(() => { throw new Error(`${method} was never called - the first side never reached its money step`); })]),
    restore: () => { pc[method] = original; },
  };
}
for (const first of ["ending", "cancel"] as const) {
  test(`F4 E1 forced ${first} first: the ${first} holds the lock, the other waits and then sees its final state (real ledger)`, { skip }, async () => {
    await scenario(async () => {
      const { A, B } = await setUp();
      const leftover = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
      const bEntries = await H.entries(B.txnId);
      const end = () => H.m.payout.terminateContractMoney(A.id, "CLIENT_CANCELLED", { cancelledBy: A.clientUserId });
      const cancel = () => H.m.bookingService.cancelSession(leftover.id, A.clientUserId, "bận");
      const gate = whenCalled(first === "ending" ? "terminate" : "releaseSession");
      let ra: PromiseSettledResult<unknown>;
      let rb: PromiseSettledResult<unknown>;
      try {
        const a = first === "ending" ? end() : cancel();
        a.catch(() => {}); // observed below; never an unhandled rejection while we wait for the gate
        await gate.called; // the first side is inside the lock
        const b = first === "ending" ? cancel() : end();
        [ra, rb] = await Promise.allSettled([a, b]);
      } finally {
        gate.restore();
      }
      const cancelRes = first === "ending" ? rb : ra;
      const endRes = first === "ending" ? ra : rb;
      assert.equal(endRes.status, "fulfilled", String((endRes as any).reason?.stack));
      const after = await aNet(A);
      const sess = await sessionRow(leftover.id);
      show(`F4 E1 forced ${first}-first`, { cancel: cancelRes.status, code: (cancelRes as any).reason?.code, after });
      if (first === "ending") {
        assert.equal(cancelRes.status, "rejected");
        assert.ok(["CONTRACT_ENDED", "CONTRACT_ENDING", "SESSION_STATE_NOT_ALLOWED"].includes((cancelRes as any).reason.code), "coded refusal");
        assert.ok([400, 409].includes((cancelRes as any).reason.status));
        assert.deepEqual([sess.cancelledBy, sess.sessionDeducted], ["SYSTEM", false]);
        assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_ENDING_ONLY);
      } else {
        assert.equal(cancelRes.status, "fulfilled");
        assert.deepEqual([sess.cancelledBy, sess.sessionDeducted], [A.clientUserId, true]);
        assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_CANCEL_THEN_ENDING);
      }
      assert.deepEqual([after.ptPend, after.platPend], [0, 0]);
      assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
      assert.deepEqual(await H.entries(B.txnId), bEntries);
    });
  });
}

// ── 2-4. the three compensating paths vs ending ────────────────────────────────────────────────

type CompCase = {
  name: string;
  makeSession: (A: PaidContract) => Promise<{ id: string; scheduledStartAt: Date }>;
  op: (A: PaidContract, pt: string, s: { id: string; scheduledStartAt: Date }) => Promise<{ status: number; body: any }>;
};
function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const COMP_CASES: CompCase[] = [
  {
    name: "PT admits its own no-show (PATCH /no-show)",
    makeSession: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR)),
    op: (A, _pt, s) => H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" }),
  },
  {
    name: "PT cancels <24h before the start (PATCH /cancel)",
    makeSession: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    op: (A, _pt, s) => H.call("PATCH", `/sessions/${s.id}/cancel`, A.ptToken, { reason: "bận" }),
  },
  {
    name: "PT blocks the day (POST /availability/me/exceptions)",
    makeSession: (A) => H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    op: (A, _pt, s) => H.call("POST", "/availability/me/exceptions", A.ptToken, { date: localDay(s.scheduledStartAt), reason: "bận" }),
  },
  {
    name: "room-close sweep (client in the room, PT never joined)",
    makeSession: (A) =>
      H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE", roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000) }),
    op: async () => {
      const { runRoomCloseResolution } = await import("../services/room-close-resolution.service");
      const r = await runRoomCloseResolution();
      return { status: 200, body: r };
    },
  },
];

for (const cc of COMP_CASES) {
  for (const lane of LANES) {
    test(`F4 E2 ${cc.name} vs the ending, ${lane}: compensated once inside the ending's snapshot, or not at all`, { skip }, async () => {
      await scenario(async () => {
        const { pt, A, B } = await setUp();
        const s = await cc.makeSession(A);
        const bEntries = await H.entries(B.txnId);
        const before = await aNet(A);
        const { e, o } = await launch(lane, endReq(A), () => cc.op(A, pt, s));
        assert.equal(e.status, 200, JSON.stringify(e.body) + H.paymentLog().slice(-800));
        const sess = await sessionRow(s.id);
        const aRow = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } });
        const after = await aNet(A);
        const compensated = sess.status === "NO_SHOW";
        show(`F4 E2 ${cc.name} ${lane}`, { compensated, before, after, compensatedSessions: aRow.compensatedSessions });
        if (compensated) {
          assert.equal(aRow.compensatedSessions, 1);
          assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_NOSHOW_THEN_ENDING);
        } else {
          assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"]);
          assert.equal(aRow.compensatedSessions, 0);
          assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_ENDING_ONLY);
          if (o.status >= 400) assertCoded409(o, lane);
        }
        assert.deepEqual([after.ptPend, after.platPend], [0, 0]);
        assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000, "no đồng created or lost");
        assert.deepEqual(await H.entries(B.txnId), bEntries, "the PT's other contract is untouched");
        assert.equal(
          (await H.entries(A.txnId)).filter((x) => x.ownerType === "CLIENT" && x.description.toLowerCase().includes("no-show")).length <= 1,
          true,
          "at most one compensation credit",
        );
      });
    });
  }
}

// ── 5. a compensation that failed while payment-service was down ───────────────────────────────

test("F4 E3: a PT no-show compensation that FAILED (payment-service down) is paid by the ending BEFORE the refund is priced - once; the sweep cannot pay it again", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const s = await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR));
    await H.stopPayment();
    const noShow = await H.call("PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" });
    assert.equal(noShow.status, 200, "the PT's admission stands; the money is recorded for retry (plan 1.6)");
    const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${s.id}` } });
    assert.equal(row.status, "FAILED");
    await H.startPayment();
    const mid = await aNet(A);
    assert.equal(mid.client, 0, "nothing was paid while it was down");

    const res = await endReq(A)();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await aNet(A);
    show("F4 E3", { before: mid, after });
    assert.deepEqual({ client: after.client, ptAvail: after.ptAvail, platAvail: after.platAvail }, AFTER_NOSHOW_THEN_ENDING, "500,000 compensation + 3,150,000 refund, priced as 1 compensated + 7 unused");
    assert.equal((await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${s.id}` } })).status, "SETTLED");
    const snap = await H.snapshot();
    const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
    await runSettlementSweep();
    assert.deepEqual(await H.snapshot(), snap, "the sweep moves nothing: the compensation is paid once");
    assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
  });
});

// ── 6. Decision A ─────────────────────────────────────────────────────────────────────────────

type ACase = {
  reason: string;
  by: "client" | "pt" | "admin";
  atEnd: { client: number; ptAvail: number; ptPend: number; platAvail: number; platPend: number };
  notDelivered: { client: number; ptAvail: number; platAvail: number };
  delivered: { client: number; ptAvail: number; platAvail: number };
};
const A_CASES: ACase[] = [
  {
    // 7 unused sessions refunded at once (the held one is NOT in them): 90% x 3,500,000 = 3,150,000; fee 350,000 -> PT 315,000 / platform 35,000
    reason: "CLIENT_CANCELLED",
    by: "client",
    atEnd: { client: 3_150_000, ptAvail: 900_000 + 315_000, ptPend: 450_000, platAvail: 100_000 + 35_000, platPend: 50_000 },
    notDelivered: { client: 3_150_000 + 500_000, ptAvail: 900_000 + 315_000, platAvail: 135_000 },
    delivered: { client: 3_150_000, ptAvail: 900_000 + 315_000 + 450_000, platAvail: 135_000 + 50_000 },
  },
  {
    // PT_CANCELLED: no fee, 100% of the 7 unused = 3,500,000
    reason: "PT_CANCELLED",
    by: "pt",
    atEnd: { client: 3_500_000, ptAvail: 900_000, ptPend: 450_000, platAvail: 100_000, platPend: 50_000 },
    notDelivered: { client: 3_500_000 + 500_000, ptAvail: 900_000, platAvail: 100_000 },
    delivered: { client: 3_500_000, ptAvail: 900_000 + 450_000, platAvail: 150_000 },
  },
];

for (const c of A_CASES) {
  for (const outcome of ["NOT_DELIVERED", "DELIVERED"] as const) {
    test(`Decision A ${c.reason}: PT_NO_SHOW_REPORTED is HELD at the ending (other unused value refunded now); admin rules ${outcome} -> settled once, escrow invariant`, { skip }, async () => {
      await scenario(async () => {
        const { A, B } = await setUp();
        const rep = await H.m.base.addSession(A, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * HOUR), { disputeReason: "PT không đến", disputedAt: new Date() });
        const bEntries = await H.entries(B.txnId);
        const before = await aNet(A);
        const token = c.by === "client" ? A.clientToken : c.by === "pt" ? A.ptToken : H.tokenFor(ADMIN, "ADMIN");
        const res = await H.call("POST", `/contracts/${A.id}/terminate`, token, { reason: c.reason });
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const held = await sessionRow(rep.id);
        assert.deepEqual([held.status, held.disputeType, held.ptAtFault, held.sessionDeducted], ["DISPUTED", "PT_NO_SHOW_CLAIM", false, false], "held; no auto-completion, no PT no-show conclusion");
        const atEnd = await aNet(A);
        show(`Decision A ${c.reason} AT END`, { before, atEnd });
        assert.deepEqual(atEnd, c.atEnd, "other unused sessions refunded now per the reason; the held session's 500,000 (PT 450,000 + platform 50,000) stays PENDING");
        assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } })).compensatedSessions, 0, "no compensation before the obligation is determined");
        await H.invariant("held");
        assert.deepEqual(await H.entries(B.txnId), bEntries, "the PT's other contract is untouched");

        // the PT cannot answer any more (L2), only the admin rules
        const agree = await H.call("POST", `/sessions/${rep.id}/respond-no-show`, A.ptToken, { response: "AGREE" });
        assert.ok(agree.status >= 400, `AGREE refused: ${agree.status}`);
        const queue = await H.call("GET", "/admin/sessions/disputed", H.tokenFor(ADMIN, "ADMIN"));
        if (queue.status === 200) assert.ok(JSON.stringify(queue.body).includes(rep.id), "in the admin dispute queue");

        const adminTok = H.tokenFor(ADMIN, "ADMIN");
        const ruling = outcome === "NOT_DELIVERED" ? "PT_NO_SHOW_CONFIRMED" : "COMPLETED";
        const [r1, r2] = await Promise.all([
          H.call("POST", `/admin/sessions/${rep.id}/resolve`, adminTok, { resolution: ruling, note: "đã kiểm tra" }),
          H.call("POST", `/admin/sessions/${rep.id}/resolve`, H.tokenFor("admin-2", "ADMIN"), { resolution: outcome === "NOT_DELIVERED" ? "CANCELLED" : "COMPLETED", note: "admin thứ hai, cùng kết luận" }),
        ]);
        assert.equal([r1, r2].filter((r) => r.status === 200).length, 1, `two admins cannot rule it two ways: ${r1.status}/${r2.status}`);
        const fin = await aNet(A);
        show(`Decision A ${c.reason} ${outcome} FINAL`, fin);
        const expected = outcome === "NOT_DELIVERED" ? c.notDelivered : c.delivered;
        // both admins reach the same outcome class, so the money is the same whichever request is processed first
        assert.deepEqual({ client: fin.client, ptAvail: fin.ptAvail, platAvail: fin.platAvail }, expected);
        assert.deepEqual([fin.ptPend, fin.platPend], [0, 0], "the held unit was settled");
        assert.equal(fin.client + fin.ptAvail + fin.platAvail, 5_000_000, "no đồng created or lost");
        const used = (await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } })).usedSessions;
        assert.equal(used, outcome === "DELIVERED" ? 3 : 2);

        const snap = await H.snapshot();
        const again = await H.call("POST", `/admin/sessions/${rep.id}/resolve`, adminTok, { resolution: "COMPLETED", note: "lại" });
        assert.ok(again.status >= 400);
        assert.deepEqual(await H.snapshot(), snap, "a repeated ruling moves nothing");
      });
    });
  }
}

test("Decision A contrast (the 'before' picture): without the hold, the same report would have been cancelled and refunded at the ending's 90% - shown with an ordinary CONFIRMED session", { skip }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    await H.m.base.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR));
    await endReq(A)();
    const x = await aNet(A);
    show("Decision A contrast: a not-started session at CLIENT_CANCELLED", x);
    assert.equal(x.client, 3_600_000, "90% of 8 unused sessions - the figure a PT_NO_SHOW_REPORTED session used to get before Decision A (when the PT really did not come the client was paid 450,000 for the session instead of 500,000)");
  });
});
