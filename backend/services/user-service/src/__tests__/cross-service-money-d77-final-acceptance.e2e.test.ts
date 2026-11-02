/**
 * D77 LEDGER FINAL ACCEPTANCE (01/11/2026, phuong an A) - BACKEND INTEGRATION (cross-service): a REAL user-service (this process) and a REAL payment-service child on isolated
 * *_test databases, the contracts paid through the real pay + signed IPN. PINS hand-computed numbers (V = 250,000, L = 125,000; 90/10; gym 55/35/10), per person.
 *
 *   A  Termination matrix of cases 3 and 15 (L OPEN whole, paid inside the settlement of the session) x MUTUAL / CLIENT_CANCELLED / PT_CANCELLED / EXPIRED / COMPLETED.
 *      Driven at the ledger door through user-service's paymentClient with the bodies contract-payout builds (settleLateOpen true), because user-service has no door for
 *      MUTUAL / EXPIRED. TEST FIXTURE: the "L OPEN whole" is the REAL record-only door.
 *   B  Case 2 through the REAL gate of user-service (releaseSessionMoney / the settlement sweep): the release waits for the D77 step, then the contract goes on and ends.
 *   C  D77 contested in an open dispute case: the release is parked NEEDS_HUMAN, nothing reaches the ledger.
 *   D  Cases 13 / 14 / 16 / 17 with HELD sessions (a NO_SHOW session with a settled L + one or two disputed sessions at the ending), through the REAL doors, to the end.
 *
 * Opt-in; run ALONE (spawns payment-service, TRUNCATEs its ledger tables):
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-d77-final-acceptance.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type GymTerms, type Harness, type PaidContract } from "./cross-service-money.harness";
// Fail-closed late-open switch (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, user-service gate AND the payment-service child it spawns): this suite PAYS an OPEN late-arrival obligation, so it is turned on in-process before the harness starts (the child inherits it at spawn).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const V = 250_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);

let H: Harness;
let restoreGym: () => void = () => {};
test.before(async () => {
  if (skip) return;
  H = await startHarness({ paymentAuth: true });
  const { gymClient } = await import("../clients/gym.client");
  const original = gymClient.getActiveCollaboration;
  const originalMembership = gymClient.getClientMembershipAtGym;
  (gymClient as any).getActiveCollaboration = async () => ({ collaborationId: "agr-final", platformRate: "0.10", ptRate: "0.55", gymRate: "0.35", brandId: null, agreementScope: null });
  (gymClient as any).getClientMembershipAtGym = async () => ({
    hasActiveMembership: true,
    brandId: null,
    membership: { membershipId: "mem-final", planName: "fixture", purchaseGymId: "gym", startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 365 * 86_400_000).toISOString() },
  });
  restoreGym = () => {
    (gymClient as any).getActiveCollaboration = original;
    (gymClient as any).getClientMembershipAtGym = originalMembership;
  };
});
test.after(async () => {
  restoreGym();
  if (H) await H.close();
});

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

/** Who holds what for ONE contract's transaction (credits - debits of its own ledger rows). */
async function totals(c: PaidContract, gymId?: string) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = {
    client: await at("CLIENT", "AVAILABLE"),
    pt: await at("PT", "AVAILABLE"),
    gym: gymId ? await at("GYM", "AVAILABLE") : 0,
    platform: await at("PLATFORM", "AVAILABLE", "REVENUE"),
    pending: (await at("PT", "PENDING")) + (gymId ? await at("GYM", "PENDING") : 0) + (await at("PLATFORM", "PENDING", "REVENUE")),
  };
  return { ...r, sum: r.client + r.pt + r.gym + r.platform + r.pending };
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ key: r.key as string, kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}
const lateSession = (c: PaidContract) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
};
const dispute = async (c: PaidContract, sessionId: string) => {
  const r = await H.call("POST", `/sessions/${sessionId}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
const rule = (adminToken: string, sessionId: string, resolution: string) => H.call("POST", `/admin/sessions/${sessionId}/resolve`, adminToken, { resolution, note: `final acceptance ${resolution}` });

// ═════════ A. termination matrix of cases 3 and 15 ═════════

const ENDINGS = ["MUTUAL", "CLIENT_CANCELLED", "PT_CANCELLED", "EXPIRED", "COMPLETED"] as const;
type Ending = (typeof ENDINGS)[number];

/** Hand-computed final money, 90/10, 1,000,000 / 4, for the session with L OPEN whole settled as `outcome`. After the ending nothing is pending and L is closed. */
const PINNED_90_10: Record<"COMPLETED" | "NO_SHOW", Record<Ending, { client: number; pt: number; platform: number }>> = {
  COMPLETED: {
    MUTUAL: { client: 125_000 + 750_000, pt: 112_500, platform: 12_500 },
    CLIENT_CANCELLED: { client: 125_000 + 675_000, pt: 112_500 + 67_500, platform: 12_500 + 7_500 },
    PT_CANCELLED: { client: 125_000 + 750_000, pt: 112_500, platform: 12_500 },
    EXPIRED: { client: 125_000, pt: 112_500 + 675_000, platform: 12_500 + 75_000 },
    COMPLETED: { client: 125_000, pt: 112_500 + 3 * 225_000, platform: 12_500 + 3 * 25_000 },
  },
  NO_SHOW: {
    MUTUAL: { client: 250_000 + 750_000, pt: 0, platform: 0 },
    CLIENT_CANCELLED: { client: 250_000 + 675_000, pt: 67_500, platform: 7_500 },
    PT_CANCELLED: { client: 250_000 + 750_000, pt: 0, platform: 0 },
    EXPIRED: { client: 250_000, pt: 675_000, platform: 75_000 },
    COMPLETED: { client: 250_000, pt: 3 * 225_000, platform: 3 * 25_000 },
  },
};

function kit(c: PaidContract) {
  const pc = H.m.paymentClient as any;
  const base = {
    transactionId: c.txnId,
    price: c.price!.toString(),
    totalSessions: c.totalSessions,
    rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
    parties: { ptUserId: c.ptUserId, gymId: c.gymId ?? null, clientUserId: c.clientUserId },
  };
  const st = { released: { pt: 0, gym: 0, platform: 0 }, used: 0, comp: 0 };
  const sid = (s: string) => `${c.id}:${s}`;
  return {
    st,
    recordLate: (s: string) => pc.recordLateArrivalObligation({ ...base, label: `late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${sid(s)}`, reason: "the ledger never performed the step" }),
    release: async (s: string) => {
      const r = await pc.releaseSession({ ...base, label: `release ${s}`, idempotencyKey: `SESSION_RELEASE:${sid(s)}`, settleLateOpen: true });
      st.released.pt += num(r.released.pt);
      st.released.gym += num(r.released.gym);
      st.released.platform += num(r.released.platform);
      st.used += 1;
      return r;
    },
    noShow: async (s: string) => {
      const r = await pc.noShow({ ...base, label: `no-show ${s}`, idempotencyKey: `PT_NO_SHOW:${sid(s)}`, settleLateOpen: true });
      st.comp += 1;
      return r;
    },
    terminate: (reason: string) =>
      pc.terminate({
        ...base, usedSessions: st.used, compensatedSessions: st.comp, reason,
        alreadyReleased: { pt: String(st.released.pt), gym: String(st.released.gym), platform: String(st.released.platform) },
        label: `end ${reason}`, idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
      }),
  };
}

for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  for (const ending of ENDINGS) {
    test(`TERMINATION: case ${outcome === "COMPLETED" ? 3 : 15} (L OPEN whole, 90/10) then the contract ends ${ending}: the money goes to the right people, nothing stuck, no forfeited share, L closed`, { skip }, async () => {
      await scenario(async () => {
        const pt = await H.makePt();
        const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
        const k = kit(c);
        await k.recordLate("S1");
        if (outcome === "COMPLETED") await k.release("S1");
        else await k.noShow("S1");
        const mid = await totals(c);
        assert.deepEqual(
          outcome === "COMPLETED" ? { client: mid.client, pt: mid.pt, platform: mid.platform, pending: mid.pending } : { client: mid.client, pt: mid.pt, platform: mid.platform, pending: mid.pending },
          outcome === "COMPLETED" ? { client: L, pt: 112_500, platform: 12_500, pending: 750_000 } : { client: V, pt: 0, platform: 0, pending: 750_000 },
          "right after the settlement of the session: nothing is held back for the OPEN L",
        );
        if (ending === "COMPLETED") for (const s of ["S2", "S3", "S4"]) await k.release(s);
        const t = await k.terminate(ending);
        const end = await totals(c);
        const pin = PINNED_90_10[outcome][ending];
        assert.deepEqual({ client: end.client, pt: end.pt, platform: end.platform, pending: end.pending, sum: end.sum }, { ...pin, pending: 0, sum: PRICE }, `${outcome}/${ending}: ${JSON.stringify(t).slice(0, 300)}`);
        assert.equal(t.overReleased ?? null, null, "no over-release incident");
        const obs = await obligations(c.txnId);
        assert.deepEqual(obs.map((o) => [o.kind, o.status, o.paid, o.unpaid]), [["LATE_ARRIVAL", "PAID_VIA_LEDGER", L, 0]], "the only obligation is closed by a ledger entry");
        await H.invariant(`termination ${outcome} ${ending}`);
      });
    });
  }
}

for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`TERMINATION [G] gym 55/35/10: case ${outcome === "COMPLETED" ? 3 : 15} (L OPEN whole) then MUTUAL: PT / gym / platform by their own rates`, { skip }, async () => {
    await scenario(async () => {
      const pt = await H.makePt();
      const gym: GymTerms = { gymId: randomUUID(), platformRate: "0.10", ptRate: "0.55", gymRate: "0.35" };
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, gym });
      const k = kit(c);
      await k.recordLate("S1");
      if (outcome === "COMPLETED") await k.release("S1");
      else await k.noShow("S1");
      await k.terminate("MUTUAL");
      const end = await totals(c, gym.gymId);
      assert.deepEqual(
        { client: end.client, pt: end.pt, gym: end.gym, platform: end.platform, pending: end.pending },
        outcome === "COMPLETED" ? { client: L + 750_000, pt: 68_750, gym: 43_750, platform: 12_500, pending: 0 } : { client: V + 750_000, pt: 0, gym: 0, platform: 0, pending: 0 },
      );
      await H.invariant("termination gym");
    });
  });
}

// ═════════ B. case 2 through the REAL gate ═════════

for (const ending of ["CLIENT_CANCELLED"] as const) {
  test(`CASE 2 through the REAL user-service gate: the COMPLETED ruling's release WAITS for the D77 step, the sweep settles D77 then the release, the contract goes on (one more session) and ends ${ending}: the money to the right people, pending 0`, { skip }, async () => {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
      const S = await lateSession(c);
      await H.stopPayment(); // the sweep decides the late session while the ledger is down: the D77 step stays PENDING
      assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
      const lateRow = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
      assert.notEqual(lateRow.status, "SETTLED");
      await dispute(c, S.id);
      const adminToken = H.tokenFor(randomUUID(), "ADMIN");
      assert.equal((await rule(adminToken, S.id, "COMPLETED")).status, 200); // the ledger is still DOWN: the D77 step cannot run, so the release must not run
      // the gate: nothing was released before the D77 step (the old order would pay the PT the whole V first)
      assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 0, "no release before D77");
      const waiting = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
      assert.notEqual(waiting.status, "SETTLED");
      await H.startPayment();
      await drain(c.id);
      assert.equal(await opCount(`PT_LATE_ARRIVAL:${S.id}`), 1);
      assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 1);
      const created = await totals(c);
      assert.deepEqual({ client: created.client, pt: created.pt, platform: created.platform, pending: created.pending }, { client: L, pt: 112_500, platform: 12_500, pending: 750_000 });
      // the contract goes on: one more ordinary session, then the client ends it
      await H.deliver(c, 1);
      const end = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: ending });
      assert.equal(end.status, 200, JSON.stringify(end.body));
      await drain(c.id);
      const fin = await totals(c);
      // used 2 (A with L, B), CLIENT_CANCELLED: refund 90% of 500,000
      assert.deepEqual({ client: fin.client, pt: fin.pt, platform: fin.platform, pending: fin.pending, sum: fin.sum }, { client: L + 450_000, pt: 112_500 + 225_000 + 45_000, platform: 12_500 + 25_000 + 5_000, pending: 0, sum: PRICE });
      await H.invariant("case 2 lifecycle");
    });
  });
}

// ═════════ C. D77 contested in an open case ═════════

test("CONTESTED D77: an open dispute case holds a PT_LATE finding LATE_CONTESTED -> the release is parked NEEDS_HUMAN, NOTHING reaches the ledger, the OPEN L and the pending are untouched", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
    const S = await lateSession(c);
    await H.stopPayment();
    await runSweep();
    await H.startPayment();
    await H.m.prisma.sessionSettlement.update({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` }, data: { status: "UNCONFIRMED" } });
    const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
    assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED", "TEST FIXTURE: the REAL record-only door writes the OPEN obligation");
    await dispute(c, S.id);
    const { disputeCaseService: svc } = await import("../services/dispute-case/dispute-case.service");
    const inv = { id: randomUUID(), role: "ADMIN" as const };
    const opened = await svc.openCase(inv, S.id);
    const caseId = opened.result.case.id;
    await svc.assign(inv, caseId, undefined);
    await svc.transition(inv, caseId, "COLLECTING", {});
    await svc.addIssue(inv, caseId, { kind: "PT_LATE", finding: "LATE_CONTESTED", note: "the PT says he was on time" });
    const before = await totals(c);
    const ledgerBefore = await H.snapshot();
    const adminToken = H.tokenFor(randomUUID(), "ADMIN");
    const res = await rule(adminToken, S.id, "COMPLETED");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await drain(c.id, 4);
    const rel = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
    assert.ok(["NEEDS_HUMAN", "CONFLICT", "UNCONFIRMED"].includes(rel.status as string), `the release waits for a person (${rel.status})`);
    assert.equal(await opCount(`SESSION_RELEASE:${S.id}`), 0);
    assert.deepEqual(await totals(c), before);
    assert.deepEqual(await H.snapshot(), ledgerBefore, "the ledger did not move");
    const ob = (await obligations(c.txnId)).find((o) => o.key === `PT_LATE_ARRIVAL:${S.id}`)!;
    assert.deepEqual([ob.status, ob.paid, ob.unpaid], ["OPEN", 0, L]);
  });
});

// ═════════ D. held sessions to the end ═════════

for (const outcome of ["DELIVERED", "NOT_DELIVERED"] as const) {
  test(`CASES 13/14 + HELD X through the real doors (90/10): NO_SHOW(A) with L SETTLED, X DISPUTED at the ending (CLIENT_CANCELLED), X ruled ${outcome === "DELIVERED" ? "COMPLETED" : "CANCELLED"}: the L of A is NOT given to X; pending 0`, { skip }, async () => {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
      const A = await lateSession(c);
      assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
      await dispute(c, A.id);
      const adminToken = H.tokenFor(randomUUID(), "ADMIN");
      assert.equal((await rule(adminToken, A.id, "PT_NO_SHOW_CONFIRMED")).status, 200);
      await drain(c.id);
      assert.equal((await totals(c)).client, V, "A: the client has V in cash (L inside V)");
      const X = await H.m.base.addSession(c, "DISPUTED", new Date(Date.now() - 3 * HOUR), { sessionMode: "ONLINE", disputeReason: "PT không đến", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" });
      const end = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
      assert.equal(end.status, 200, JSON.stringify(end.body));
      await drain(c.id);
      const held = await totals(c);
      assert.deepEqual({ client: held.client, pending: held.pending }, { client: V + 450_000, pending: V }, "X holds its WHOLE value 250,000 (before the fix 125,000); nothing went to the platform as a forfeited share");
      assert.equal(held.platform, 5_000 + 0, "only the cancellation fee share (10% of 50,000)");
      assert.equal((await rule(adminToken, X.id, outcome === "DELIVERED" ? "COMPLETED" : "CANCELLED")).status, 200);
      await drain(c.id);
      const fin = await totals(c);
      assert.deepEqual(
        { client: fin.client, pt: fin.pt, platform: fin.platform, pending: fin.pending, sum: fin.sum },
        outcome === "DELIVERED" ? { client: 700_000, pt: 45_000 + 225_000, platform: 5_000 + 25_000, pending: 0, sum: PRICE } : { client: 950_000, pt: 45_000, platform: 5_000, pending: 0, sum: PRICE },
      );
      await H.invariant(`13/14 + held ${outcome}`);
    });
  });
}

test("CASES 16/17 with TWO held sessions through the real doors (90/10): NO_SHOW(A) + X1 (its own L SETTLED) + X2 (no L) held at the ending; X1 COMPLETED, X2 CANCELLED: exact attribution, pending 0", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
    const A = await lateSession(c);
    const X1 = await lateSession(c);
    assert.deepEqual(await runSweep(), { scanned: 2, resolved: 2 });
    await dispute(c, A.id);
    await dispute(c, X1.id);
    const adminToken = H.tokenFor(randomUUID(), "ADMIN");
    assert.equal((await rule(adminToken, A.id, "PT_NO_SHOW_CONFIRMED")).status, 200);
    const X2 = await H.m.base.addSession(c, "DISPUTED", new Date(Date.now() - 3 * HOUR), { sessionMode: "ONLINE", disputeReason: "PT không đến", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" });
    await drain(c.id);
    const end = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(end.status, 200, JSON.stringify(end.body));
    await drain(c.id);
    const held = await totals(c);
    // remaining = 4 - 0 - 1 (A compensated) - 2 held = 1 -> refund 90% of 250,000; X1 holds V - L (125,000), X2 holds V (250,000)
    assert.deepEqual({ client: held.client, pending: held.pending }, { client: V + L + 225_000, pending: 125_000 + 250_000 });
    assert.equal((await rule(adminToken, X1.id, "COMPLETED")).status, 200);
    assert.equal((await rule(adminToken, X2.id, "CANCELLED")).status, 200);
    await drain(c.id);
    const fin = await totals(c);
    assert.deepEqual({ client: fin.client, pt: fin.pt, platform: fin.platform, pending: fin.pending, sum: fin.sum }, { client: 850_000, pt: 22_500 + 112_500, platform: 2_500 + 12_500, pending: 0, sum: PRICE });
    await H.invariant("16/17 two held");
  });
});

export type { Harness };
