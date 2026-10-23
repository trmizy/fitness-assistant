/**
 * D77 on a GYM contract with the REAL payment-service ledger - what the room-close sweep really moves when the PT joins late, where the
 * "late" line is, and that the compensation happens once however often / however many instances run the sweep.
 *
 * Evidence label: BACKEND INTEGRATION - real HTTP between user-service's Express app (this process) and a spawned payment-service child,
 * real ledger, isolated test databases. TEST FIXTURE: the contract row (inserted PENDING_PAYMENT, then really paid through contractService.pay
 * + a signed gateway IPN), gym-service (gymClient.getActiveCollaboration answers the contract's own rates - no gym-service process), the
 * session rows (born CONFIRMED, online, already over, with the room-attendance timestamps the scenario needs), auth-service's token table.
 * The three "instances" of the concurrency test are three copies of the room-close module in this one process (each has its own in-process
 * `running` guard, as three servers would), all against the same Postgres - the cross-instance guard under test is the database / ledger one.
 * Opt-in; run ALONE:
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="...gymcoach_user_fhj_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_fhj_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/cross-service-money-d77-boundary.e2e.test.ts
 *
 * Hand-computed money. Contract: 1,000,000 for 3 sessions, platform 0.10 / PT 0.60 / gym 0.30 (a gym contract), so pending after payment is
 * PT 600,000 / gym 300,000 / platform 100,000.
 *   unit value            = 1,000,000 / 3 = 333,333.33 -> rounded UP for the client = 333,334
 *   late-arrival comp     = HALF of that, rounded up      = 166,667
 *   split of the comp     = PT floor(100,000.2) = 100,000 / gym floor(50,000.1) = 50,000 / platform = the remainder 16,667   (sum 166,667)
 *   session release       = unit rounded DOWN = 333,333 -> PT 199,999 / gym 99,999 / platform 33,335
 *   release after the comp (D77: deducted from THAT session's value) = PT 99,999 / gym 49,999 / platform 16,668
 *   comp + release        = 166,667 + 99,999 + 49,999 + 16,668 = 333,333 = the session's whole value, nothing created or lost.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const RATES = { platformRate: "0.1", ptRate: "0.6", gymRate: "0.3" };
const COMP = { total: 166_667, pt: 100_000, gym: 50_000, platform: 16_667 };
const RELEASE_AFTER_COMP = { pt: 99_999, gym: 49_999, platform: 16_668 };

let H: Harness;
let restoreGym: () => void = () => {};
test.before(async () => {
  if (skip) return;
  H = await startHarness();
  const { gymClient } = await import("../clients/gym.client");
  const original = gymClient.getActiveCollaboration;
  (gymClient as any).getActiveCollaboration = async () => ({ collaborationId: "agr-d77", ...RATES, brandId: null, agreementScope: null });
  // Codex #6 (TEST FIXTURE): the gym contract has a fixed duration (60 days, set by the harness) and the client's membership at that gym covers it.
  const originalMembership = gymClient.getClientMembershipAtGym;
  (gymClient as any).getClientMembershipAtGym = async () => ({
    hasActiveMembership: true,
    brandId: null,
    membership: { membershipId: "mem-d77", planName: "fixture", purchaseGymId: "gym", startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 365 * 86_400_000).toISOString() },
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
    await H.invariant("end of scenario");
  } finally {
    await H.cleanup();
  }
}

async function gymContract() {
  const pt = await H.makePt();
  const gymId = randomUUID();
  const c = await H.paidContract(pt, { price: 1_000_000, totalSessions: 3, gym: { gymId, ...RATES } });
  assert.equal(c.gymId, gymId);
  return { c, gymId };
}

/** An online session that is already over, with the attendance the scenario needs. */
const onlineSession = (c: PaidContract, join: { pt: number | null; client: number | null }) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, {
    sessionMode: "ONLINE",
    roomPtJoinedAt: join.pt === null ? null : new Date(start.getTime() + join.pt),
    roomClientJoinedAt: join.client === null ? null : new Date(start.getTime() + join.client),
  });
};

const net = async (c: PaidContract, gymId: string) => ({
  client: (await H.wallet("CLIENT", c.clientUserId)).a,
  ptPend: await H.net(c.txnId, "PT", "PENDING"),
  ptAvail: await H.net(c.txnId, "PT", "AVAILABLE"),
  gymPend: await H.net(c.txnId, "GYM", "PENDING", gymId),
  gymAvail: await H.net(c.txnId, "GYM", "AVAILABLE", gymId),
  platPend: await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE"),
  platAvail: await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
});

const opsFor = async (key: string) =>
  ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;

const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
/** A separate copy of the module = a separate `running` guard = what another server would have. */
function freshSweep(): () => Promise<{ scanned: number; resolved: number }> {
  const id = require.resolve("../services/room-close-resolution.service");
  const saved = require.cache[id];
  delete require.cache[id];
  const copy = require(id);
  if (saved) require.cache[id] = saved;
  return copy.runRoomCloseResolution;
}

const START_BALANCES = { client: 0, ptPend: 600_000, ptAvail: 0, gymPend: 300_000, gymAvail: 0, platPend: 100_000, platAvail: 0 };

test("D77 late PT on a GYM contract: the half-session comp (166,667, rounded) is charged PT 100,000 / gym 50,000 / platform 16,667 from THIS contract's pending, the client gets exactly the sum, and the session's own release is reduced by it", { skip }, async () => {
  await scenario(async () => {
    const { c, gymId } = await gymContract();
    assert.deepEqual(await net(c, gymId), START_BALANCES, "fixture: a paid 60/30/10 gym contract");

    const S = await onlineSession(c, { pt: GRACE_MS + 1, client: MIN }); // PT 15:00.001 late, client on time
    const r = await runSweep();
    assert.deepEqual(r, { scanned: 1, resolved: 1 });

    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.equal(sess.status, "PENDING_CLIENT_CONFIRMATION", "still completes; not a no-show");
    assert.equal(sess.ptAtFault, false);
    assert.equal(sess.ptNotes, "PT vào phòng học muộn");
    const contract = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(contract.compensatedSessions, 0, "the client's entitlement is not touched by a late arrival");
    assert.equal(contract.usedSessions, 0);

    const after = await net(c, gymId);
    assert.deepEqual(after, {
      ...START_BALANCES,
      client: COMP.total,
      ptPend: 600_000 - COMP.pt,
      gymPend: 300_000 - COMP.gym,
      platPend: 100_000 - COMP.platform,
    });
    assert.equal(COMP.pt + COMP.gym + COMP.platform, COMP.total);
    assert.equal(after.client, START_BALANCES.ptPend - after.ptPend + (START_BALANCES.gymPend - after.gymPend) + (START_BALANCES.platPend - after.platPend), "client + X = PT + gym + platform reductions, to the đồng");

    const settlement = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
    assert.equal(settlement.status, "SETTLED");
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${S.id}`), 1);
    const res = (settlement.result as any)?.result ?? settlement.result;
    assert.deepEqual([res.owed, res.paid, res.unpaid], ["166667.00", "166667.00", "0.00"]);

    // ── sweep again (twice) and replay the money call by key: nothing moves ──
    const entries = (await H.entries(c.txnId)).length;
    assert.deepEqual(await runSweep(), { scanned: 0, resolved: 0 }, "the session left CONFIRMED: the sweep has nothing to do");
    assert.deepEqual(await runSweep(), { scanned: 0, resolved: 0 });
    await H.m.payout.compensateLateArrivalMoney(c.id, S.id);
    assert.equal((await H.entries(c.txnId)).length, entries, "a replay of the same key writes no ledger row");
    assert.deepEqual(await net(c, gymId), after);
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${S.id}`), 1);

    // ── the client confirms: the session's release is its value MINUS the comp, party by party ──
    const conf = await H.call("POST", `/sessions/${S.id}/confirm`, c.clientToken);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    const done = await net(c, gymId);
    assert.deepEqual(
      { pt: done.ptAvail, gym: done.gymAvail, platform: done.platAvail },
      RELEASE_AFTER_COMP,
      "PT 199,999-100,000 / gym 99,999-50,000 / platform 33,335-16,667",
    );
    assert.equal(COMP.total + RELEASE_AFTER_COMP.pt + RELEASE_AFTER_COMP.gym + RELEASE_AFTER_COMP.platform, 333_333, "comp + release = the session's whole value");
    assert.equal(done.client, COMP.total, "no second credit to the client");
  });
});

test("D77 boundary on the real ledger: the PT joins at EXACTLY start + 15:00 -> not late, nothing moves; at +15:00.001 -> late, one compensation", { skip }, async () => {
  await scenario(async () => {
    const { c, gymId } = await gymContract();
    const onTime = await onlineSession(c, { pt: GRACE_MS, client: MIN });
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    assert.equal((await H.m.prisma.session.findUniqueOrThrow({ where: { id: onTime.id } })).status, "PENDING_CLIENT_CONFIRMATION");
    assert.equal((await H.m.prisma.session.findUniqueOrThrow({ where: { id: onTime.id } })).ptNotes, null);
    assert.deepEqual(await net(c, gymId), START_BALANCES, "15:00.000 is inside the grace: not a cent moved");
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${onTime.id}`), 0);
    assert.equal(await H.m.prisma.sessionSettlement.count({ where: { contractId: c.id } }), 0, "no money intent was even recorded");

    const late = await onlineSession(c, { pt: GRACE_MS + 1, client: MIN });
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${late.id}`), 1);
    const n = await net(c, gymId);
    assert.equal(n.client, COMP.total);
    assert.equal(n.ptPend, 600_000 - COMP.pt);
  });
});

test("D77 client absent: the PT joined (even an hour late) but the client never did -> no compensation, no ledger movement, the session waits for the client's confirm/dispute", { skip }, async () => {
  await scenario(async () => {
    const { c, gymId } = await gymContract();
    const S = await onlineSession(c, { pt: HOUR, client: null });
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.equal(sess.status, "PENDING_CLIENT_CONFIRMATION");
    assert.equal(sess.ptNotes, "Client không vào phòng học");
    assert.deepEqual(await net(c, gymId), START_BALANCES);
    assert.equal(await H.m.prisma.sessionSettlement.count({ where: { contractId: c.id } }), 0);
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${S.id}`), 0);
  });
});

test("D77 PT never joined (client did): the NO-SHOW path - a FULL session (333,334) is compensated, not the late half, and the session is not counted as delivered", { skip }, async () => {
  await scenario(async () => {
    const { c, gymId } = await gymContract();
    const S = await onlineSession(c, { pt: null, client: MIN });
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.equal(sess.status, "NO_SHOW");
    assert.equal(sess.ptAtFault, true);
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${S.id}`), 0, "not the late-arrival path");
    assert.equal(await opsFor(`PT_NO_SHOW:${S.id}`), 1);
    const n = await net(c, gymId);
    // full session: roundUp(333,333.33) = 333,334 -> PT floor(200,000.4) = 200,000 / gym floor(100,000.2) = 100,000 / platform 33,334
    assert.equal(n.client, 333_334);
    assert.equal(n.ptPend, 600_000 - 200_000);
    assert.equal(n.gymPend, 300_000 - 100_000);
    assert.equal(n.platPend, 100_000 - 33_334);
    assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).compensatedSessions, 1);
  });
});

test("D77 several instances run the sweep at the same moment over one late session -> exactly ONE compensation, one ledger operation, one intent", { skip }, async () => {
  await scenario(async () => {
    const { c, gymId } = await gymContract();
    const S = await onlineSession(c, { pt: GRACE_MS + MIN, client: MIN }); // 16:00 late
    const instances = [freshSweep(), freshSweep(), freshSweep(), runSweep];
    const results = await Promise.all(instances.map((run) => run()));
    const resolved = results.reduce((s, r) => s + r.resolved, 0);
    assert.equal(resolved, 1, `exactly one instance resolved the session: ${JSON.stringify(results)}`);

    const n = await net(c, gymId);
    assert.deepEqual(
      { client: n.client, ptPend: n.ptPend, gymPend: n.gymPend, platPend: n.platPend },
      { client: COMP.total, ptPend: 600_000 - COMP.pt, gymPend: 300_000 - COMP.gym, platPend: 100_000 - COMP.platform },
      "one compensation, not two",
    );
    assert.equal(await opsFor(`PT_LATE_ARRIVAL:${S.id}`), 1);
    assert.equal(await H.m.prisma.sessionSettlement.count({ where: { contractId: c.id, idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } }), 1, "one intent row");
    const notes = await H.m.prisma.notification.findMany({ where: { userId: c.clientUserId, entityId: S.id } });
    assert.equal(notes.length, 1, "the client is told once");
    assert.deepEqual(await runSweep(), { scanned: 0, resolved: 0 });
  });
});
