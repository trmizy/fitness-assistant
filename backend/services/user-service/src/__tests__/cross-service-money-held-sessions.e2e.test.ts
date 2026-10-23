/**
 * F2 (D45 / L3) with the REAL payment-service ledger - a contract that ends for ANY reason HOLDS the value of its
 * awaiting-confirmation / disputed sessions (no auto-split to PT / gym / platform), refunds / releases the rest on time,
 * and each held session is settled exactly once by its own confirm / ruling; the escrow invariant holds throughout.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated test databases. TEST FIXTURE: the contract row, the signed gateway IPN,
 * session rows at their starting state, auth-service's token table. See cross-service-money.harness.ts. Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-held-sessions.e2e.test.ts
 *
 * Hand-computed money (price 5,000,000 / 10 sessions; one session = 500,000 = PT 450,000 + platform 50,000; no gym;
 * holdback off). Contract A: 2 delivered, 1 awaiting confirmation (P), 1 disputed (D), 6 unused.
 *   CLIENT_CANCELLED  refund 90% x 3,000,000 = 2,700,000; fee 300,000 -> PT 270,000 / platform 30,000
 *   PT_CANCELLED, MUTUAL, PT_BANNED  refund 3,000,000, no fee      EXPIRED  refund 0, the 3,000,000 goes to PT / platform
 *   held at the ending: P + D = 1,000,000 (PT 900,000 + platform 100,000), still PENDING.
 *   then P confirmed -> +450,000 PT / +50,000 platform AVAILABLE;  D ruled "not delivered" -> 500,000 to the client.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, skip, startHarness, type Harness } from "./cross-service-money.harness";

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
const sessionStatus = async (id: string) => (await H.m.prisma.session.findUniqueOrThrow({ where: { id } })).status;

/** Contract A (the one that ends) + an innocent contract B of the same PT with money of its own. */
async function setUp() {
  const pt = await H.makePt();
  const A = await H.paidContract(pt, { packageName: "Gói A" });
  const B = await H.paidContract(pt, { packageName: "Gói B" });
  await H.deliver(B, 3);
  await H.deliver(A, 2);
  const T = Date.now();
  const P = await H.m.base.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(T - 1 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
  const D = await H.m.base.addSession(A, "DISPUTED", new Date(T - 2 * DAY), { disputeReason: "không dạy", disputedAt: new Date(T - DAY), disputeType: "DELIVERY_DISPUTE" });
  const future = await H.m.base.addSession(A, "CONFIRMED", new Date(T + 3 * HOUR));
  return { pt, A, B, P, D, future };
}

const aNet = async (A: { txnId: string; clientUserId: string }) => ({
  client: await H.wallet("CLIENT", A.clientUserId).then((x) => x.a),
  ptAvail: await H.net(A.txnId, "PT", "AVAILABLE"),
  ptPend: await H.net(A.txnId, "PT", "PENDING"),
  platAvail: await H.net(A.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
  platPend: await H.net(A.txnId, "PLATFORM", "PENDING", "REVENUE"),
});

type Case = {
  reason: string;
  by: "client" | "pt" | "admin" | "ban";
  atEnd: { client: number; ptAvail: number; ptPend: number; platAvail: number; platPend: number };
  final: { client: number; ptAvail: number; platAvail: number };
};
const CASES: Case[] = [
  {
    reason: "CLIENT_CANCELLED",
    by: "client",
    atEnd: { client: 2_700_000, ptAvail: 2 * PT_UNIT + 270_000, ptPend: 900_000, platAvail: 100_000 + 30_000, platPend: 100_000 },
    final: { client: 3_200_000, ptAvail: 2 * PT_UNIT + 270_000 + PT_UNIT, platAvail: 130_000 + 50_000 },
  },
  {
    reason: "EXPIRED",
    by: "admin",
    atEnd: { client: 0, ptAvail: 3_600_000, ptPend: 900_000, platAvail: 400_000, platPend: 100_000 },
    final: { client: 500_000, ptAvail: 3_600_000 + PT_UNIT, platAvail: 400_000 + 50_000 },
  },
  {
    reason: "PT_CANCELLED",
    by: "pt",
    atEnd: { client: 3_000_000, ptAvail: 2 * PT_UNIT, ptPend: 900_000, platAvail: 100_000, platPend: 100_000 },
    final: { client: 3_500_000, ptAvail: 2 * PT_UNIT + PT_UNIT, platAvail: 150_000 },
  },
  {
    reason: "MUTUAL",
    by: "admin",
    atEnd: { client: 3_000_000, ptAvail: 2 * PT_UNIT, ptPend: 900_000, platAvail: 100_000, platPend: 100_000 },
    final: { client: 3_500_000, ptAvail: 2 * PT_UNIT + PT_UNIT, platAvail: 150_000 },
  },
  {
    reason: "PT_BANNED",
    by: "ban",
    atEnd: { client: 3_000_000, ptAvail: 2 * PT_UNIT, ptPend: 900_000, platAvail: 100_000, platPend: 100_000 },
    final: { client: 3_500_000, ptAvail: 2 * PT_UNIT + PT_UNIT, platAvail: 150_000 },
  },
];

for (const c of CASES) {
  test(`F2 ${c.reason}: the awaiting + disputed sessions' 1,000,000 stays HELD at the ending, the rest is refunded / released at once; the confirm and the ruling each settle once; escrow invariant holds`, { skip }, async () => {
    await scenario(async () => {
      const { pt, A, B, P, D, future } = await setUp();
      const bEntries = await H.entries(B.txnId);
      const before = await aNet(A);
      show(`F2 ${c.reason} BEFORE`, before);

      // ── the ending ──
      if (c.by === "ban") {
        const r = await H.m.ptDeactivationService.deactivatePT({ ptUserId: pt, adminId: ADMIN, reason: "vi phạm", seq: BigInt(Date.now()) });
        // the lock unwinds the PT's OTHER contract B too (its own refund); only A's rows are asserted below
        assert.equal(r.complete, true, JSON.stringify(r.outcomes));
      } else {
        const token = c.by === "client" ? A.clientToken : c.by === "pt" ? A.ptToken : H.tokenFor(ADMIN, "ADMIN");
        const res = await H.call("POST", `/contracts/${A.id}/terminate`, token, { reason: c.reason });
        assert.equal(res.status, 200, JSON.stringify(res.body));
      }
      assert.equal(await sessionStatus(P.id), "PENDING_CLIENT_CONFIRMATION", "kept");
      assert.equal(await sessionStatus(D.id), "DISPUTED", "kept");
      assert.equal(await sessionStatus(future.id), "CANCELLED", "not started: called off");
      const atEnd = await aNet(A);
      show(`F2 ${c.reason} AT END`, atEnd);
      assert.deepEqual(atEnd, c.atEnd, "refund / release done now; 900,000 PT + 100,000 platform still PENDING for the two held sessions");
      await H.invariant("after the ending");
      if (c.by !== "ban") assert.deepEqual(await H.entries(B.txnId), bEntries, "the PT's other contract is untouched");

      // ── later decisions ──
      const conf = await H.call("POST", `/sessions/${P.id}/confirm`, A.clientToken);
      assert.equal(conf.status, 200, JSON.stringify(conf.body));
      const ruled = await H.call("POST", `/admin/sessions/${D.id}/resolve`, H.tokenFor(ADMIN, "ADMIN"), { resolution: "PT_NO_SHOW_CONFIRMED", note: "PT vắng" });
      assert.equal(ruled.status, 200, JSON.stringify(ruled.body));
      const fin = await aNet(A);
      show(`F2 ${c.reason} FINAL`, fin);
      assert.deepEqual({ client: fin.client, ptAvail: fin.ptAvail, platAvail: fin.platAvail }, c.final);
      assert.deepEqual([fin.ptPend, fin.platPend], [0, 0], "nothing left pending: every held unit was settled");
      assert.equal(fin.client + fin.ptAvail + fin.platAvail, 5_000_000, "contract A's price is fully accounted for - no đồng created or lost");
      const used = (await H.m.prisma.contract.findUniqueOrThrow({ where: { id: A.id } })).usedSessions;
      assert.equal(used, 3, "2 delivered + the confirmed one; the ruled-absent one is not charged");

      // ── repeats move nothing ──
      const snap = await H.snapshot();
      assert.equal((await H.call("POST", `/sessions/${P.id}/confirm`, A.clientToken)).status >= 400, true);
      assert.equal((await H.call("POST", `/admin/sessions/${D.id}/resolve`, H.tokenFor(ADMIN, "ADMIN"), { resolution: "COMPLETED", note: "lại" })).status >= 400, true);
      assert.deepEqual(await H.snapshot(), snap, "a second confirm / a second ruling moves no money");
      await H.invariant("end");
    });
  });
}

test("F2 a disputed session ruled DELIVERED after the ending releases its 500,000 (PT 450,000 + platform 50,000) once; a late client dispute of the awaiting one keeps it held", { skip }, async () => {
  await scenario(async () => {
    const { A, P, D } = await setUp();
    await H.call("POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" });
    // the client disputes the awaiting one after the ending: it stays held (DISPUTED), nothing moves
    const snap = await H.snapshot();
    const dispute = await H.call("POST", `/sessions/${P.id}/dispute`, A.clientToken, { reason: "không đúng" });
    assert.equal(dispute.status, 200, JSON.stringify(dispute.body));
    assert.deepEqual(await H.snapshot(), snap, "disputing moves nothing");
    for (const s of [P, D]) {
      const ruled = await H.call("POST", `/admin/sessions/${s.id}/resolve`, H.tokenFor(ADMIN, "ADMIN"), { resolution: "COMPLETED", note: "đã dạy" });
      assert.equal(ruled.status, 200, JSON.stringify(ruled.body));
    }
    const fin = await aNet(A);
    show("F2 both DELIVERED", fin);
    assert.deepEqual(fin, { client: 2_700_000, ptAvail: 2 * PT_UNIT + 270_000 + 2 * PT_UNIT, ptPend: 0, platAvail: 130_000 + 100_000, platPend: 0 });
    assert.equal(fin.client + fin.ptAvail + fin.platAvail, 5_000_000);
  });
});

test("F2 race: the client confirms the awaiting session while the client cancels the contract (real HTTP, both orders) - the contract ends with the same final money either way", { skip }, async () => {
  for (let i = 0; i < 3; i++) {
    await scenario(async () => {
      const { A, P } = await setUp();
      const [a, b] = await Promise.all([
        H.call("POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" }),
        H.call("POST", `/sessions/${P.id}/confirm`, A.clientToken),
      ]);
      assert.equal(a.status, 200, JSON.stringify(a.body) + " / payment-service: " + H.paymentLog().slice(-1800));
      assert.equal(b.status, 200, JSON.stringify(b.body));
      // D (disputed) is still held: 500,000 (PT 450,000 + platform 50,000) pending, whichever order won
      const mid = await aNet(A);
      assert.equal(mid.ptPend, PT_UNIT);
      assert.equal(mid.platPend, 50_000);
      // 3 delivered, 6 unused (D is held, 1 future called off): refund 90% x 3,000,000; fee 300,000
      assert.deepEqual(
        { client: mid.client, ptAvail: mid.ptAvail, platAvail: mid.platAvail },
        { client: 2_700_000, ptAvail: 3 * PT_UNIT + 270_000, platAvail: 3 * 50_000 + 30_000 },
        `iteration ${i}: the same figures whichever of the two won`,
      );
      assert.equal(mid.client + mid.ptAvail + mid.ptPend + mid.platAvail + mid.platPend, 5_000_000);
    });
  }
});
