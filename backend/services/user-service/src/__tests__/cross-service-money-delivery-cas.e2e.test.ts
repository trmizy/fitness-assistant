/**
 * F3 with the REAL payment-service ledger - confirmation / auto-confirmation / admin rulings are compare-and-sets on the
 * session: under real races exactly one decision wins, the loser changes nothing, and the ledger moves exactly once.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated test databases; the races are real concurrent requests (Promise.all).
 * TEST FIXTURE: the contract row, the signed gateway IPN, session rows at their starting state, auth-service's token
 * table. See cross-service-money.harness.ts. Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/cross-service-money-delivery-cas.e2e.test.ts
 *
 * Money (price 5,000,000 / 10 sessions; a session = 500,000 = PT 450,000 + platform 50,000; no gym; holdback off):
 * delivering the session moves PT 450,000 + platform 50,000 from PENDING to AVAILABLE; a PT-absent ruling on a running
 * contract compensates the client 500,000 out of the SAME contract's pending (PT 450,000, platform 50,000).
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
const PLAT_UNIT = 50_000;
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
const row = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });
async function money(c: { txnId: string; clientUserId: string }) {
  return {
    client: (await H.wallet("CLIENT", c.clientUserId)).a,
    ptAvail: await H.net(c.txnId, "PT", "AVAILABLE"),
    ptPend: await H.net(c.txnId, "PT", "PENDING"),
    platAvail: await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"),
  };
}
const admin = () => H.tokenFor(ADMIN, "ADMIN");

async function awaitingSession(deadlinePassed = false) {
  const pt = await H.makePt();
  const c = await H.paidContract(pt);
  await H.deliver(c, 2);
  const T = Date.now();
  const s = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - DAY), {
    clientConfirmDeadline: new Date(deadlinePassed ? T - HOUR : T + 2 * DAY),
  });
  return { pt, c, s };
}

test("F3 client confirm vs client dispute (real concurrent requests): exactly one wins; confirm -> the session's 500,000 released once; dispute -> nothing moves, and the admin's ruling then releases it once", { skip }, async () => {
  for (let i = 0; i < 4; i++) {
    await scenario(async () => {
      const { c, s } = await awaitingSession();
      const before = await money(c);
      const [conf, disp] = await Promise.all([
        H.call("POST", `/sessions/${s.id}/confirm`, c.clientToken),
        H.call("POST", `/sessions/${s.id}/dispute`, c.clientToken, { reason: "không đúng" }),
      ]);
      assert.equal([conf.status, disp.status].filter((x) => x === 200).length, 1, `iteration ${i}: one winner (${conf.status}/${disp.status})`);
      const after = await money(c);
      const r = await row(s.id);
      if (conf.status === 200) {
        assert.deepEqual([r.status, r.sessionDeducted], ["COMPLETED", true]);
        assert.deepEqual(
          { ptAvail: after.ptAvail - before.ptAvail, platAvail: after.platAvail - before.platAvail, ptPend: after.ptPend - before.ptPend },
          { ptAvail: PT_UNIT, platAvail: PLAT_UNIT, ptPend: -PT_UNIT },
        );
        assert.ok([400, 409].includes(disp.status), `the loser is refused (400 = it read the final state, 409 = it lost the compare-and-set): ${disp.status}`);
        show("F3 confirm won", { before, after });
      } else {
        assert.deepEqual([r.status, r.sessionDeducted], ["DISPUTED", false]);
        assert.deepEqual(after, before, "a disputed session moves no money");
        assert.ok([400, 409].includes(conf.status), `the loser is refused (400 = it read the final state, 409 = it lost the compare-and-set): ${conf.status}`);
        const ruled = await H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "COMPLETED", note: "đã dạy" });
        assert.equal(ruled.status, 200, JSON.stringify(ruled.body));
        const fin = await money(c);
        assert.deepEqual({ ptAvail: fin.ptAvail - before.ptAvail, platAvail: fin.platAvail - before.platAvail }, { ptAvail: PT_UNIT, platAvail: PLAT_UNIT });
        show("F3 dispute won, then ruled COMPLETED", { before, afterDispute: after, final: fin });
      }
      // nothing moves a second time
      const snap = await H.snapshot();
      await H.call("POST", `/sessions/${s.id}/confirm`, c.clientToken);
      await H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "COMPLETED", note: "lại" });
      assert.deepEqual(await H.snapshot(), snap, "a repeated confirm / ruling moves nothing");
      assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, 3);
    });
  }
});

test("F3 the auto-confirm sweep vs the client's dispute (real): the dispute is never overwritten by the sweep; whichever wins, the ledger moves at most once", { skip }, async () => {
  const { runAutoConfirm } = await import("../services/session-autoconfirm.service");
  for (let i = 0; i < 4; i++) {
    await scenario(async () => {
      const { c, s } = await awaitingSession(true);
      const before = await money(c);
      const [, disp] = await Promise.all([runAutoConfirm(), H.call("POST", `/sessions/${s.id}/dispute`, c.clientToken, { reason: "không đúng" })]);
      const r = await row(s.id);
      const after = await money(c);
      if (disp.status === 200) {
        assert.deepEqual([r.status, r.autoConfirmed], ["DISPUTED", false], `iteration ${i}`);
        assert.deepEqual(after, before);
      } else {
        assert.deepEqual([r.status, r.autoConfirmed, r.sessionDeducted], ["COMPLETED", true, true]);
        assert.deepEqual({ ptAvail: after.ptAvail - before.ptAvail, platAvail: after.platAvail - before.platAvail }, { ptAvail: PT_UNIT, platAvail: PLAT_UNIT });
      }
    });
  }
});

test("F3 two admins rule the same disputed session two ways at once (real): one ruling, one money movement - COMPLETED releases 500,000, PT-absent compensates the client 500,000 from the contract's own pending", { skip }, async () => {
  for (let i = 0; i < 4; i++) {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt);
      await H.deliver(c, 2);
      const s = await H.m.base.addSession(c, "DISPUTED", new Date(Date.now() - 2 * DAY), { disputeReason: "x", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" });
      const before = await money(c);
      const [a, b] = await Promise.all([
        H.call("POST", `/admin/sessions/${s.id}/resolve`, admin(), { resolution: "COMPLETED", note: "đã dạy" }),
        H.call("POST", `/admin/sessions/${s.id}/resolve`, H.tokenFor("admin-2", "ADMIN"), { resolution: "PT_NO_SHOW_CONFIRMED", note: "PT vắng" }),
      ]);
      assert.equal([a.status, b.status].filter((x) => x === 200).length, 1, `iteration ${i}`);
      const after = await money(c);
      const r = await row(s.id);
      if (a.status === 200) {
        assert.deepEqual([r.status, r.sessionDeducted], ["COMPLETED", true]);
        assert.deepEqual(
          { client: after.client - before.client, ptAvail: after.ptAvail - before.ptAvail, platAvail: after.platAvail - before.platAvail },
          { client: 0, ptAvail: PT_UNIT, platAvail: PLAT_UNIT },
        );
      } else {
        assert.equal(r.status, "NO_SHOW");
        assert.deepEqual(
          { client: after.client - before.client, ptAvail: after.ptAvail - before.ptAvail, ptPend: after.ptPend - before.ptPend, platPend: after.platPend - before.platPend },
          { client: 500_000, ptAvail: 0, ptPend: -PT_UNIT, platPend: -PLAT_UNIT },
        );
        assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).compensatedSessions, 1);
      }
      assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");
    });
  }
});
