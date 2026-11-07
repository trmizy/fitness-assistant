/**
 * QUOTA A+ - the booking of a PT no-show's entitlement at the terminal change (decided by Ngai, 01/11/2026), REAL payment-service.
 *
 *   rule: a validly confirmed PT no-show (the session reaches the terminal status NO_SHOW while the contract is ACTIVE) books compensatedSessions + 1 exactly once, in the SAME transaction, under the contract
 *         lock, without waiting for payment. A per-session mark (sessions.no_show_quota_booked_at, set by compare-and-set) makes it once. totalSessions - (used + compensated) is unchanged.
 *   the ending sends payment-service the number of no-shows REALLY compensated (quota counter minus the booked ones still unpaid); an unpaid booked no-show is HELD by the ending (NOT_DELIVERED) so
 *   neither a release nor the termination can hand its value to the PT / platform.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service). TEST FIXTURES named where used. Hand numbers: 1,000,000 / 4 sessions, V = 250,000, L = 125,000, 90/10.
 *
 * Opt-in; run ALONE (same command shape as the other cross-service files).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;

let H: Harness;
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
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
const lateSession = (c: PaidContract) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
};
const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const stepRow = async (contractId: string, kind: string) => (await H.m.prisma.sessionSettlement.findMany({ where: { contractId } })).find((r) => r.kind === kind);
const entitlement = async (c: PaidContract) => {
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const { getRemainingEntitlements } = await import("../services/contract.service");
  return { status: k.status, total: k.totalSessions, used: k.usedSessions, compensated: k.compensatedSessions, remaining: getRemainingEntitlements(k) };
};
const sessionOf = (id: string) => H.m.prisma.session.findUniqueOrThrow({ where: { id } });
const ptAdmits = (c: PaidContract, sid: string) => H.call("PATCH", `/sessions/${sid}/no-show`, c.ptToken, {});
const confirmedPast = (c: PaidContract) => H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE" });

/** A session whose L is OPEN at the ledger (the real record-only door), the absence admitted by the PT: the refund is parked NEEDS_HUMAN. */
async function parkedNoShow() {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  const S = await lateSession(c);
  await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
  assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } });
  assert.equal((await ptAdmits(c, S.id)).status, 200);
  assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "NEEDS_HUMAN");
  return { c, S };
}

// ═════════════════════ the entry points and the plain cases ═════════════════════
test("N1 NO D77: the PT admits the absence -> NO_SHOW, compensated 1 AT the terminal change, the refund 250,000 paid, the settlement does NOT count it again; a replay / sweeps change nothing", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const S = await confirmedPast(c);
    assert.equal((await ptAdmits(c, S.id)).status, 200);
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.ptAtFault, s.sessionDeducted], ["NO_SHOW", true, false]);
    assert.ok(s.noShowQuotaBookedAt);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    assert.equal(await opCount(`PT_NO_SHOW:${S.id}`), 1);
    await drain(c.id, 3);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    const second = await ptAdmits(c, S.id);
    assert.equal(second.status, 400, "a second admission (sequential) is refused: the session is no longer in a state that can be admitted");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    await H.invariant("N1");
  });
});

test("N2 D77 SETTLED (L paid at the sweep): NO_SHOW -> compensated 1 once, the client gets V = 250,000 in all (L inside), PT 0", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const S = await lateSession(c);
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } });
    assert.equal((await ptAdmits(c, S.id)).status, 200);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    await H.invariant("N2");
  });
});

test("N3 a LEGACY row (no mark; the NO_SHOW happened before the fix, its money step was waiting): when it settles it books the quota the old way ONCE and sets the mark; a second sweep adds nothing (TEST FIXTURE: pre-fix state set by SQL)", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const S = await confirmedPast(c);
    await H.stopPayment();
    assert.equal((await ptAdmits(c, S.id)).status, 200);
    await H.startPayment();
    assert.notEqual((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    // the pre-fix state: nothing was booked at the terminal change
    await H.m.prisma.session.update({ where: { id: S.id }, data: { noShowQuotaBookedAt: null } });
    await H.m.prisma.contract.update({ where: { id: c.id }, data: { compensatedSessions: 0 } });
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 0, remaining: 4 });
    await drain(c.id, 3);
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 }, "booked by the settlement, once");
    assert.ok((await sessionOf(S.id)).noShowQuotaBookedAt, "and the mark is set");
    await drain(c.id, 3);
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 });
    assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    await H.invariant("N3");
  });
});

test("N4 the contract has ENDED when the session becomes terminal (a held disputed session ruled PT_NO_SHOW_CONFIRMED): the historical branch - nothing is booked, no mark; the held value goes back to the client", { skip }, async () => {
  await scenario(async () => {
    const T = Date.now();
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 }); // default policy review fixture: the ruling is allowed
    const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
    assert.equal((await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" })).status, 200);
    assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
    const admin = H.tokenFor("adm-n4", "ADMIN");
    const ruled = await H.call("POST", `/admin/sessions/${S.id}/resolve`, admin, { resolution: "PT_NO_SHOW_CONFIRMED", note: "N4" });
    assert.equal(ruled.status, 200, JSON.stringify(ruled.body));
    const s = await sessionOf(S.id);
    assert.deepEqual([s.status, s.noShowQuotaBookedAt], ["NO_SHOW", null]);
    assert.deepEqual(await entitlement(c), { status: "CANCELLED", total: 4, used: 0, compensated: 0, remaining: 4 }, "the contract is over: nothing is booked");
    // hand: 3 unused sessions at 90% (client 675,000, PT 67,500, platform 7,500) + the held V 250,000 back to the client
    assert.deepEqual(await totals(c), { client: 925_000, pt: 67_500, platform: 7_500, pending: 0, sum: PRICE });
    await H.invariant("N4");
  });
});

test("N5 ptAtFault is unchanged: set exactly as before for the PT-confirmed no-shows, and the count the client's three-times right reads is the same", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const S1 = await confirmedPast(c);
    const S2 = await confirmedPast(c);
    assert.equal((await ptAdmits(c, S1.id)).status, 200);
    assert.equal((await ptAdmits(c, S2.id)).status, 200);
    const flagged = await H.m.prisma.session.count({ where: { contractId: c.id, status: "NO_SHOW", ptAtFault: true } });
    assert.equal(flagged, 2);
    const eligibility = await H.m.contractService.repeatedNoShowEligibility(c.id);
    assert.deepEqual([eligibility.count, eligibility.eligible], [2, false], "the threshold (3) and the count are untouched");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 2, remaining: 2 });
    await H.invariant("N5");
  });
});

test("N6 NATURAL COMPLETION with the no-show money unpaid (payment-service was down): the ending HOLDS its value, the contract completes with used 3 + compensated 1, and the sweep resolves the hold to the client - NO second claim (no OPEN obligation)", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    await H.deliver(c, 2);
    const S = await confirmedPast(c);
    await H.stopPayment();
    assert.equal((await ptAdmits(c, S.id)).status, 200);
    await H.startPayment();
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "FAILED");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 2, compensated: 1, remaining: 1 }, "A+: the entitlement is consumed although nothing was paid");
    await H.deliver(c, 1); // the last entitlement: used 3 + compensated 1 = 4 -> the contract completes by itself
    assert.deepEqual(await entitlement(c), { status: "COMPLETED", total: 4, used: 3, compensated: 1, remaining: 0 });
    // hand: the PT earned 3 x 225,000 = 675,000, platform 3 x 25,000 = 75,000; the no-show session's 250,000 is HELD (not paid to the PT, not lost)
    assert.deepEqual(await totals(c), { client: 0, pt: 675_000, platform: 75_000, pending: 250_000, sum: PRICE });
    // the sweep: the held value is resolved to the client (NOT_DELIVERED) against the held money; the step row is closed with it
    await drain(c.id, 3);
    assert.deepEqual(await totals(c), { client: 250_000, pt: 675_000, platform: 75_000, pending: 0, sum: PRICE });
    assert.equal((await stepRow(c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    assert.equal(await opCount(`UNRESOLVED_SESSION:${S.id}`), 1);
    assert.equal(await opCount(`PT_NO_SHOW:${S.id}`), 0, "the compensation key itself was never performed: the hold was resolved under the resolution key");
    const obs = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contract_unpaid_obligations WHERE transaction_id = $1`, c.txnId);
    assert.equal((obs as any[])[0].n, 0, "no OPEN obligation: the value was held, so it is not claimed twice");
    assert.deepEqual(await entitlement(c), { status: "COMPLETED", total: 4, used: 3, compensated: 1, remaining: 0 });
    await drain(c.id, 3);
    assert.deepEqual(await totals(c), { client: 250_000, pt: 675_000, platform: 75_000, pending: 0, sum: PRICE });
    await H.invariant("N6");
  });
});

// ═════════════════════ races ═════════════════════
test("C1 NO_SHOW races bookings (6 rounds): never more sessions than the entitlement - used + compensated + active <= total - and compensated is exactly +1", { skip }, async () => {
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
      await H.deliver(c, 2); // used 2
      const S = await confirmedPast(c);
      const slots = [await H.m.scope.openSlotFor(c.ptUserId, 30), await H.m.scope.openSlotFor(c.ptUserId, 31)];
      const book = (slot: { scheduledDate: string; scheduledTime: string }) => H.call("POST", "/sessions", c.clientToken, { contractId: c.id, ...slot });
      const fire = [() => ptAdmits(c, S.id), () => book(slots[0]), () => book(slots[1])];
      if (round % 2 === 1) fire.reverse();
      const results = await Promise.all(fire.map((f) => f()));
      const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      const active = await H.m.prisma.session.count({ where: { contractId: c.id, status: { in: ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "DISPUTED", "PT_NO_SHOW_REPORTED"] } } });
      assert.ok(k.usedSessions + k.compensatedSessions + active <= k.totalSessions, `round ${round}: used ${k.usedSessions} + comp ${k.compensatedSessions} + active ${active} > ${k.totalSessions} (${results.map((r) => r.status).join(",")})`);
      assert.equal(k.compensatedSessions, 1, `round ${round}`);
      assert.equal((await sessionOf(S.id)).status, "NO_SHOW", `round ${round}`);
      const created = results.filter((r) => r.status === 201).length;
      assert.equal(created, 1, `round ${round}: exactly one new session fits (4 - 2 used - 1 compensated); got ${results.map((r) => r.status).join(",")}`);
      await H.invariant(`C1 ${round}`);
    });
  }
});

test("C2 NO_SHOW races the contract ending (6 rounds): the quota is booked iff the session became NO_SHOW while ACTIVE; used + compensated never exceeds the total; the books balance", { skip }, async () => {
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
      const S = await confirmedPast(c);
      const fire = [() => ptAdmits(c, S.id), () => H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })];
      if (round % 2 === 1) fire.reverse();
      const results = await Promise.all(fire.map((f) => f()));
      await drain(c.id, 3);
      const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      const s = await sessionOf(S.id);
      assert.ok(k.usedSessions + k.compensatedSessions <= k.totalSessions, `round ${round}`);
      assert.equal(k.compensatedSessions, s.status === "NO_SHOW" && s.noShowQuotaBookedAt ? 1 : 0, `round ${round}: session ${s.status}, mark ${!!s.noShowQuotaBookedAt}, results ${results.map((r) => r.status).join(",")}`);
      assert.ok((await opCount(`PT_NO_SHOW:${S.id}`)) <= 1, `round ${round}`);
      await H.invariant(`C2 ${round}`);
    });
  }
});

test("C3 two NO_SHOW admissions of the SAME session at once (6 rounds): one wins, the other is refused, compensated is +1 and the ledger moves once", { skip }, async () => {
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
      const S = await confirmedPast(c);
      const results = await Promise.all([ptAdmits(c, S.id), ptAdmits(c, S.id)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], `round ${round}`);
      assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 0, compensated: 1, remaining: 3 }, `round ${round}`);
      assert.equal(await opCount(`PT_NO_SHOW:${S.id}`), 1, `round ${round}`);
      assert.deepEqual(await totals(c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE }, `round ${round}`);
      await H.invariant(`C3 ${round}`);
    });
  }
});

// ═════════════════════ the ending holds the unpaid value ═════════════════════
test("V1 the CLIENT ends the contract while the no-show refund is blocked: the held 250,000 does NOT go to the PT or the platform; quota 1 before and after", { skip }, async () => {
  await scenario(async () => {
    const { c } = await parkedNoShow();
    assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
    // hand: 3 unused sessions at 90% -> client 675,000, PT 67,500, platform 7,500; the held V (PT 225,000 + platform 25,000) is still PENDING
    assert.deepEqual(await totals(c), { client: 675_000, pt: 67_500, platform: 7_500, pending: 250_000, sum: PRICE });
    assert.deepEqual(await entitlement(c), { status: "CANCELLED", total: 4, used: 0, compensated: 1, remaining: 3 });
    await H.invariant("V1");
  });
});

test("V2 the PT ends the contract (PT_CANCELLED) while the no-show refund is blocked: the held 250,000 does NOT go to the PT or the platform", { skip }, async () => {
  await scenario(async () => {
    const { c } = await parkedNoShow();
    const ended = await H.call("POST", `/contracts/${c.id}/terminate`, c.ptToken, { reason: "PT_CANCELLED" });
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    const t = await totals(c);
    assert.equal(t.sum, PRICE);
    assert.equal(t.pt, 0, "the PT earns nothing from a PT-fault ending");
    assert.equal(t.platform, 0);
    assert.equal(t.pending, 250_000, "the held value stays pending - it is NOT drained to the parties");
    assert.equal(t.client, 750_000, "the 3 unused sessions are refunded in full");
    assert.deepEqual(await entitlement(c), { status: "CANCELLED", total: 4, used: 0, compensated: 1, remaining: 3 });
    await H.invariant("V2");
  });
});

test("V3 release of OTHER sessions while the no-show refund is blocked can never take its value: after 3 releases the held 250,000 is intact (PT 675,000, platform 75,000)", { skip }, async () => {
  await scenario(async () => {
    const { c } = await parkedNoShow();
    await H.deliver(c, 2);
    assert.deepEqual(await totals(c), { client: 0, pt: 450_000, platform: 50_000, pending: 500_000, sum: PRICE }, "2 sessions released; the other 500,000 = one session + the blocked no-show value");
    assert.deepEqual(await entitlement(c), { status: "ACTIVE", total: 4, used: 2, compensated: 1, remaining: 1 });
    await H.invariant("V3");
  });
});

// ═════════════════════ the reading side ═════════════════════
test("D1 the number sent to payment-service: quota counter minus the booked-but-unpaid no-shows; a paid one counts as compensated (unit-level on the real database)", { skip }, async () => {
  await scenario(async () => {
    const { c } = await parkedNoShow();
    const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(k.compensatedSessions, 1);
    assert.equal(await H.m.payout.compensatedPaidFor(c.id, k.compensatedSessions), 0, "booked but unpaid -> not sent as compensated");
    const terms = await H.m.payout.terminationTermsFor(c.id, "CLIENT_CANCELLED");
    assert.deepEqual([terms.unresolvedSessions, terms.compensatedPaid], [1, 0], "held instead");
    assert.equal(terms.unresolvedSessionIds?.length, 1);
  });
});
