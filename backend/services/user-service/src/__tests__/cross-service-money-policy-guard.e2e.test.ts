/**
 * POLICY GUARD FIX (Q1 - Q4) - ordinary sessions, D77, the ending's stale-snapshot retry, REAL payment-service.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): this process runs the real user-service app; payment-service is a real child process on an isolated *_test database; the money
 * is read from the REAL ledger. TEST FIXTURES are named where used. Contracts are made with `eligibility: false` (the harness spelling of `eligibility: "none"`): NO D-NEW-12 review,
 * i.e. the ordinary contract that was never disputed.
 *
 *   A. ordinary sessions WITHOUT a policy review (the guard must not hold them):
 *      A1 COMPLETED + no D77            A2 NO_SHOW + no D77
 *      A3 COMPLETED + D77 SETTLED       A4 NO_SHOW + D77 SETTLED      (L already paid by the ledger: settles normally, no flag needed)
 *      A5 COMPLETED + D77 OPEN          A6 NO_SHOW + D77 OPEN         (the ledger refuses LATE_OPEN_FLAG_REQUIRED: nothing moves; measured recovery workflow)
 *      A7 ending the contract while A5 / A6 wait
 *   B. the dispute-ruling guard is untouched: the old admin resolve and the Case Executor on an unreviewed contract still refuse 409, nothing written
 *   C. TERMINATE_SNAPSHOT_STALE: bounded retry (valid concurrent update -> success; persistent stray door -> CONFLICT after exactly 3 attempts; two terminates with different keys)
 *
 * Opt-in; run ALONE:  RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... SETTLEMENT_INFLIGHT_WAIT_MS=300 \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-policy-guard.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const num = (v: unknown) => Number(v ?? 0);

let H: Harness;
let X: {
  helpers: typeof import("./dispute-case-exec.test-helpers");
  exec: typeof import("../services/dispute-case/execution.service");
  svc: typeof import("../services/dispute-case/dispute-case.service").disputeCaseService;
};
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  H = await startHarness({ paymentAuth: true });
  X = {
    helpers: await import("./dispute-case-exec.test-helpers"),
    exec: await import("../services/dispute-case/execution.service"),
    svc: (await import("../services/dispute-case/dispute-case.service")).disputeCaseService,
  };
});
test.after(async () => {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  if (H) await H.close();
});

// ── kit ──────────────────────────────────────────────────────────────────────

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
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = {
    client: await at("CLIENT", "AVAILABLE"),
    pt: await at("PT", "AVAILABLE"),
    platform: await at("PLATFORM", "AVAILABLE", "REVENUE"),
    pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")),
  };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
const rowsOf = (contractId: string) => H.m.prisma.sessionSettlement.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
const stepRow = async (contractId: string, kind: string) => (await rowsOf(contractId)).find((r) => r.kind === kind);
const endContract = (c: PaidContract) => H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
const adminToken = () => H.tokenFor(`adm-${randomUUID()}`, "ADMIN");

type D77 = "NONE" | "SETTLED" | "OPEN";
type Outcome = "COMPLETED" | "NO_SHOW";
interface Fx {
  c: PaidContract;
  S: { id: string };
}
/** An ORDINARY contract (no review) with one session in the state the client / PT acts on. D77: NONE = a plain session; SETTLED = the late-arrival compensation was paid by the ledger at the sweep;
 *  OPEN = the ledger was down at the sweep and the REAL record-only door wrote the OPEN obligation (the UNCONFIRMED status of the sweep row is the TEST FIXTURE that lets it run). */
async function build(d77: D77, outcome: Outcome): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  assert.equal(await H.m.prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: c.id } }), 0, "the contract has no policy review");
  let S: { id: string };
  if (d77 === "NONE") {
    const T = Date.now();
    S =
      outcome === "COMPLETED"
        ? await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" })
        : await H.m.base.addSession(c, "CONFIRMED", new Date(T - 2 * HOUR), { sessionMode: "ONLINE" });
  } else {
    S = await lateSession(c);
    if (d77 === "OPEN") await H.stopPayment();
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    if (d77 === "OPEN") {
      await H.startPayment();
      const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
      assert.notEqual(row.status, "SETTLED");
      await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
      assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
    }
    const late = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
    assert.equal(late.status, "SETTLED", "the D77 step is SETTLED (paid L, or the OPEN obligation is recorded)");
    // the sweep leaves the session waiting for the client; for the no-show outcome the PT admits the absence on a CONFIRMED session (TEST FIXTURE: status put back to CONFIRMED)
    if (outcome === "NO_SHOW") await H.m.prisma.session.update({ where: { id: S.id }, data: { status: "CONFIRMED" } });
  }
  return { c, S };
}
/** The ordinary action: the client confirms, or the PT admits the no-show. */
async function act(fx: Fx, outcome: Outcome) {
  const r = outcome === "COMPLETED" ? await H.call("POST", `/sessions/${fx.S.id}/confirm`, fx.c.clientToken) : await H.call("PATCH", `/sessions/${fx.S.id}/no-show`, fx.c.ptToken, {});
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
}
async function counters(fx: Fx) {
  const s = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
  return { session: s.status, deducted: s.sessionDeducted, contract: k.status, used: k.usedSessions, compensated: k.compensatedSessions };
}
const PAID_WORDING = /Đã (hoàn|bồi thường|thanh toán)|\d[\d.]*đ/;
async function notesAfter(fx: Fx, since: Date) {
  return H.m.prisma.notification.findMany({ where: { entityId: fx.S.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });
}

// ═════════════════════ A1 / A2 : no D77 (old behaviour unchanged) ═════════════════════
test("A1 COMPLETED, no D77, no review: confirmed and paid as always (PT 225,000, platform 25,000, pending 750,000)", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("NONE", "COMPLETED");
    await act(fx, "COMPLETED");
    assert.deepEqual(await counters(fx), { session: "COMPLETED", deducted: true, contract: "ACTIVE", used: 1, compensated: 0 });
    assert.deepEqual(await totals(fx.c), { client: 0, pt: 225_000, platform: 25_000, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    await H.invariant("A1");
  });
});
test("A2 NO_SHOW (PT admits), no D77, no review: the client gets the session value 250,000 back, the PT nothing, compensatedSessions 1", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("NONE", "NO_SHOW");
    await act(fx, "NO_SHOW");
    assert.deepEqual(await counters(fx), { session: "NO_SHOW", deducted: false, contract: "ACTIVE", used: 0, compensated: 1 });
    assert.deepEqual(await totals(fx.c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    await H.invariant("A2");
  });
});

// ═════════════════════ A3 / A4 : D77 SETTLED (L already paid), still no review ═════════════════════
test("A3 COMPLETED, D77 SETTLED (L 125,000 paid to the client), no review: the release is NOT held - client 125,000 (L), PT 112,500, platform 12,500, pending 750,000", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("SETTLED", "COMPLETED");
    assert.equal((await totals(fx.c)).client, 125_000, "L was paid at the sweep");
    await act(fx, "COMPLETED");
    assert.deepEqual(await counters(fx), { session: "COMPLETED", deducted: true, contract: "ACTIVE", used: 1, compensated: 0 });
    assert.deepEqual(await totals(fx.c), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "SESSION_RELEASE"))?.status, "SETTLED");
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    await H.invariant("A3");
  });
});
test("A4 NO_SHOW, D77 SETTLED, no review: I5 = A - the no-show owes V in total with L inside it: client 250,000 in all, PT 0, compensatedSessions 1", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("SETTLED", "NO_SHOW");
    await act(fx, "NO_SHOW");
    assert.deepEqual(await counters(fx), { session: "NO_SHOW", deducted: false, contract: "ACTIVE", used: 0, compensated: 1 });
    assert.deepEqual(await totals(fx.c), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: PRICE });
    assert.equal((await stepRow(fx.c.id, "PT_NO_SHOW_COMPENSATION"))?.status, "SETTLED");
    await H.invariant("A4");
  });
});

// ═════════════════════ A5 / A6 : D77 OPEN, no review: the ledger refuses, nothing moves ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`A5/A6 ${outcome}, D77 OPEN, no review: the session changes state, the ledger refuses LATE_OPEN_FLAG_REQUIRED, NOTHING moves; the step is parked NEEDS_HUMAN (never retried by code), listed by the admin report; quota right; no "paid" wording`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build("OPEN", outcome);
      const before = await totals(fx.c);
      const startedAt = new Date();
      await act(fx, outcome);
      const stepKind = outcome === "COMPLETED" ? "SESSION_RELEASE" : "PT_NO_SHOW_COMPENSATION";
      // session rights: COMPLETED (quota used) / NO_SHOW (entitlement consumed at once under Quota A+: compensatedSessions 1, though no money moved)
      assert.deepEqual(
        await counters(fx),
        outcome === "COMPLETED"
          ? { session: "COMPLETED", deducted: true, contract: "ACTIVE", used: 1, compensated: 0 }
          : { session: "NO_SHOW", deducted: false, contract: "ACTIVE", used: 0, compensated: 1 }, // QUOTA A+: booked at the terminal change, before and without the payment (was 0 while the money waited)
      );
      // the money: not a cent moved, the OPEN obligation is untouched
      assert.deepEqual(await totals(fx.c), before, "nothing moved");
      assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: 125_000, paid: 0, unpaid: 125_000 }]);
      assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 0, "the ledger wrote nothing for the step");
      // the row
      const row = (await stepRow(fx.c.id, stepKind))!;
      assert.equal(row.status, "NEEDS_HUMAN");
      assert.match(row.lastError ?? "", /^NEEDS_RECONCILIATION: .*LATE_OPEN_FLAG_REQUIRED/);
      assert.equal(row.attempts, 1);
      // not retried by code: sweeps (with the back-off cleared) change nothing
      await drain(fx.c.id, 3);
      const again = (await stepRow(fx.c.id, stepKind))!;
      assert.deepEqual([again.status, again.attempts], ["NEEDS_HUMAN", 1], "no automatic retry");
      assert.deepEqual(await totals(fx.c), before);
      // the existing reconciliation queue shows it (admin, READ-ONLY report - there is no action on a row)
      const rec = await H.call("GET", `/admin/sessions/reconciliation?minAgeMinutes=0`, adminToken());
      assert.equal(rec.status, 200);
      const item = rec.body.needsAttention.items.find((i: any) => i.sessionId === fx.S.id);
      assert.ok(item, "the parked step is on the admin report");
      assert.deepEqual([item.kind, item.status, item.reason, item.errorCode, item.amountAtStake], [stepKind, "NEEDS_HUMAN", "NEEDS_HUMAN", "NEEDS_RECONCILIATION", 250_000]);
      // no "paid" notification: whatever was sent after the action names no amount and says nothing like "Đã hoàn / Đã bồi thường"
      for (const n of await notesAfter(fx, startedAt)) assert.doesNotMatch(n.text, PAID_WORDING, `notification to ${n.userId === fx.c.clientUserId ? "client" : "PT"}: ${n.text}`);
      // the gate sends no flag, and there is no review and no case to give it one
      assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: false });
      await assert.rejects(X.svc.openCase(X.helpers.admin(), fx.S.id), (e: any) => e.status === 409 && e.code === "SESSION_NOT_DISPUTED");
      await H.invariant(`A5/A6 ${outcome}`);
    });
  });
}

// ═════════════════════ A7 : the contract ends while the A5 / A6 step waits ═════════════════════
for (const outcome of ["COMPLETED", "NO_SHOW"] as const) {
  test(`A7 ${outcome}: the contract ENDS while the D77-OPEN step waits - the session is HELD (UNCONFIRMED), the ending settles, books balance, the 250,000 stays pending and L stays OPEN: STUCK (no code path can pay it)`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build("OPEN", outcome);
      await act(fx, outcome);
      const stepKind = outcome === "COMPLETED" ? "SESSION_RELEASE" : "PT_NO_SHOW_COMPENSATION";
      const ended = await endContract(fx.c);
      assert.equal(ended.status, 200, JSON.stringify(ended.body));
      const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
      assert.equal(k.status, "CANCELLED");
      assert.equal((await stepRow(fx.c.id, "CONTRACT_TERMINATION"))?.status, "SETTLED");
      const held = (await stepRow(fx.c.id, stepKind))!;
      assert.equal(held.status, "UNCONFIRMED", "the session's step is HELD by the ending (the ledger never performed it)");
      assert.equal(await opCount(`CONTRACT_TERMINATE:${fx.c.id}`), 1);
      // 3 unused sessions refunded at the CLIENT_CANCELLED rate (675,000 / 67,500 / 7,500); the held session's 250,000 is still pending (PT 225,000 + platform 25,000), L still OPEN
      assert.deepEqual(await totals(fx.c), { client: 675_000, pt: 67_500, platform: 7_500, pending: 250_000, sum: PRICE });
      assert.deepEqual(await obligations(fx.c.txnId), [{ kind: "LATE_ARRIVAL", status: "OPEN", owed: 125_000, paid: 0, unpaid: 125_000 }]);
      await H.invariant(`A7 ${outcome}`);
      // retries do not move it
      const frozen = await totals(fx.c);
      await drain(fx.c.id, 3);
      assert.deepEqual(await totals(fx.c), frozen);
      assert.equal((await stepRow(fx.c.id, stepKind))?.status, "UNCONFIRMED");
      // the resolution of the held session (what a recovery would call): the ledger refuses it WITHOUT the flag, and there is no way to get a flag
      const answer = await H.m.payout.resolveUnconfirmedSessionMoney(fx.c.id, fx.S.id, outcome === "COMPLETED" ? "DELIVERED" : "NOT_DELIVERED");
      assert.deepEqual(answer, { state: "PARKED" });
      const resolution = (await stepRow(fx.c.id, "UNRESOLVED_SESSION_RESOLUTION"))!;
      assert.equal(resolution.status, "NEEDS_HUMAN");
      assert.match(resolution.lastError ?? "", /LATE_OPEN_FLAG_REQUIRED/);
      assert.deepEqual(await totals(fx.c), frozen, "the refused resolution moved nothing");
      assert.deepEqual(await H.m.payout.lateOpenGate(fx.S.id), { settle: false });
      await assert.rejects(X.svc.openCase(X.helpers.admin(), fx.S.id), (e: any) => e.status === 409 && e.code === "SESSION_NOT_DISPUTED");
      await H.invariant(`A7 ${outcome} after resolution attempt`);
    });
  });
}

// ═════════════════════ B : the dispute-ruling guard is untouched ═════════════════════
async function disputedUnreviewed() {
  const T = Date.now();
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
  assert.equal((await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" })).status, 200);
  return { c, S };
}
test("B1 the old admin resolve on a DISPUTED session of an unreviewed contract -> 409 POLICY_ELIGIBILITY_UNVERIFIED, nothing written (REAL payment-service up)", { skip }, async () => {
  await scenario(async () => {
    const { S } = await disputedUnreviewed();
    const before = await H.snapshot();
    for (const resolution of ["COMPLETED", "PT_NO_SHOW_CONFIRMED"]) {
      const r = await H.call("POST", `/admin/sessions/${S.id}/resolve`, adminToken(), { resolution, note: "policy guard" });
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.match(JSON.stringify(r.body), /POLICY_ELIGIBILITY_UNVERIFIED/);
    }
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedBy], ["DISPUTED", false, null]);
    assert.equal(await H.m.prisma.sessionSettlement.count({ where: { sessionId: S.id } }), 0);
    assert.deepEqual(await H.snapshot(), before, "not one ledger row written");
    await H.invariant("B1");
  });
});
test("B2 the Case Executor on an APPROVED decision of an unreviewed contract -> refused 409 POLICY_ELIGIBILITY_UNVERIFIED before any ruling, nothing written", { skip }, async () => {
  await scenario(async () => {
    const { S } = await disputedUnreviewed();
    const a = await X.helpers.approvedCaseFor(S.id, "VERIFIED_DELIVERED" as any);
    const before = await H.snapshot();
    await assert.rejects(
      X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, X.exec.defaultExecDeps()),
      (e: any) => e.status === 409 && e.code === "POLICY_ELIGIBILITY_UNVERIFIED",
    );
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
    assert.deepEqual([sess.status, sess.sessionDeducted], ["DISPUTED", false]);
    assert.deepEqual(await H.snapshot(), before);
    await H.invariant("B2");
  });
});

// ═════════════════════ C : TERMINATE_SNAPSHOT_STALE - bounded retry ═════════════════════
/** Wraps paymentClient.terminate: records every body, HOLDS the first call until the test lets it go. */
function terminateSpy() {
  const pc = H.m.paymentClient as any;
  const original = pc.terminate;
  const bodies: any[] = [];
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  let go!: () => void;
  const proceed = new Promise<void>((r) => (go = r));
  pc.terminate = async function (b: any) {
    bodies.push(b);
    if (bodies.length === 1) {
      enter();
      await proceed;
    }
    return original.call(this, b);
  };
  return { bodies, entered, go, restore: () => (pc.terminate = original) };
}
const doorBody = (c: PaidContract) => ({
  transactionId: c.txnId,
  price: c.price!.toString(),
  totalSessions: c.totalSessions,
  rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
  parties: { ptUserId: c.ptUserId, gymId: c.gymId ?? null, clientUserId: c.clientUserId },
});

test("C1 a VALID concurrent update: the first terminate is refused STALE, the figures are re-read, the second call succeeds - one ledger operation, books balance", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const spy = terminateSpy();
    try {
      const ending = endContract(c);
      await spy.entered; // the snapshot (used 0, released 0) is in the request body
      // a step past the user-service freeze commits at the ledger AND its bookkeeping lands in the contract row (TEST FIXTURE for that step: ledger door + the contract counters it would write)
      const pc = H.m.paymentClient as any;
      const rel = await pc.releaseSession({ ...doorBody(c), label: "C1 in-flight release", idempotencyKey: `SESSION_RELEASE:${randomUUID()}` });
      assert.equal(rel.released.pt, "225000.00");
      await H.m.prisma.contract.update({ where: { id: c.id }, data: { usedSessions: { increment: 1 }, releasedToPt: { increment: 225_000 }, releasedToPlatform: { increment: 25_000 } } });
      spy.go();
      const ended = await ending;
      assert.equal(ended.status, 200, JSON.stringify(ended.body));
      assert.equal(spy.bodies.length, 2, "refused once, accepted on the second call");
      assert.equal(spy.bodies[0].usedSessions, 0);
      assert.equal(spy.bodies[1].usedSessions, 1, "the second call carries the RE-READ figures");
      assert.equal(num(spy.bodies[1].alreadyReleased.pt), 225_000);
      assert.equal(num(spy.bodies[1].alreadyReleased.platform), 25_000);
      assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 1);
      assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED");
      assert.equal((await stepRow(c.id, "CONTRACT_TERMINATION"))?.status, "SETTLED");
      assert.deepEqual(await totals(c), { client: 675_000, pt: 292_500, platform: 32_500, pending: 0, sum: PRICE });
      await H.invariant("C1");
    } finally {
      spy.go();
      spy.restore();
    }
  });
});

test("C2 a PERSISTENT mismatch (a stray door outside user-service, never reflected in the contract row): exactly 3 attempts, then CONFLICT; nothing written; no further attempt by retry, sweep or a second request", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const spy = terminateSpy();
    try {
      const ending = endContract(c);
      await spy.entered;
      const pc = H.m.paymentClient as any;
      await pc.releaseSession({ ...doorBody(c), label: "C2 stray release", idempotencyKey: `SESSION_RELEASE:${randomUUID()}` });
      const afterStray = await totals(c);
      spy.go();
      const ended = await ending;
      assert.equal(ended.status, 409, JSON.stringify(ended.body));
      assert.equal(spy.bodies.length, 3, "exactly the fixed number of attempts");
      assert.deepEqual(spy.bodies.map((b) => b.usedSessions), [0, 0, 0], "the figures are re-read each time (nothing changed, so they stay)");
      const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
      assert.equal(row.status, "CONFLICT");
      assert.match(row.lastError ?? "", /TERMINATE_SNAPSHOT_STALE/);
      assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 0, "no ledger operation from a stale snapshot");
      assert.deepEqual(await totals(c), afterStray, "no money written");
      assert.equal((await obligations(c.txnId)).filter((o) => o.kind === "REFUND_SHORT").length, 0);
      // parked rows are never retried: a second request and the sweeps make no new attempt
      const second = await endContract(c);
      assert.equal(second.status, 409);
      await drain(c.id, 3);
      assert.equal(spy.bodies.length, 3, "no attempt after the CONFLICT");
      assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 0);
      await H.invariant("C2");
    } finally {
      spy.go();
      spy.restore();
    }
  });
});

// C3 (final safety gate, P0): the ledger refuses a second ending of the same payment transaction under ANOTHER idempotency key (409 CONTRACT_ALREADY_TERMINATED). It used to succeed with refund 0 and
// write a phantom REFUND_SHORT of the whole price (measured 01/11). Sequential first, then concurrent rounds in both orders: exactly one side wins, the loser has no side effect.
const keysOf = (c: PaidContract) => [`CONTRACT_TERMINATE:${c.id}`, `CONTRACT_TERMINATE:${c.id}:other`];
const endBody = (c: PaidContract) => ({ ...doorBody(c), usedSessions: 0, compensatedSessions: 0, alreadyReleased: { pt: "0", gym: "0", platform: "0" }, reason: "MUTUAL", label: "C3 end" });
async function refundShortCount(txnId: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contract_unpaid_obligations WHERE transaction_id = $1 AND kind::text = 'REFUND_SHORT'`, txnId)) as any[])[0].n as number;
}

test("C3a SEQUENTIAL: a second terminate under another key is refused 409 CONTRACT_ALREADY_TERMINATED; the same key replays; no operation, obligation or refund is written by the refusal", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const pc = H.m.paymentClient as any;
    const [k1, k2] = keysOf(c);
    const first = await pc.terminate({ ...endBody(c), idempotencyKey: k1 });
    const after = await totals(c);
    const replay = await pc.terminate({ ...endBody(c), idempotencyKey: k1 });
    assert.deepEqual(replay, first, "the same key replays the stored answer");
    let error: any;
    try {
      await pc.terminate({ ...endBody(c), idempotencyKey: k2 });
    } catch (e) {
      error = e;
    }
    assert.equal(error?.response?.status, 409);
    assert.equal(error?.response?.data?.error?.code, "CONTRACT_ALREADY_TERMINATED");
    assert.equal(await opCount(k2), 0);
    assert.equal(await opCount(k1), 1);
    assert.equal(await refundShortCount(c.txnId), 0);
    assert.deepEqual(await obligations(c.txnId), []);
    assert.deepEqual(await totals(c), after);
    await H.invariant("C3a");
  });
});

test("C3b CONCURRENT, 6 rounds in both orders: exactly one terminate wins, the loser is refused 409 with no side effect, never a REFUND_SHORT", { skip }, async () => {
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
      const pc = H.m.paymentClient as any;
      const keys = keysOf(c);
      if (round % 2 === 1) keys.reverse();
      const results = await Promise.allSettled(keys.map((k) => pc.terminate({ ...endBody(c), idempotencyKey: k })));
      const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `round ${round}: ${results.map((r) => r.status).join(",")}`);
      assert.equal(lost.length, 1);
      assert.equal(lost[0].reason?.response?.status, 409, `round ${round}`);
      assert.equal(lost[0].reason?.response?.data?.error?.code, "CONTRACT_ALREADY_TERMINATED", `round ${round}`);
      const ops = ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key LIKE $1`, `CONTRACT_TERMINATE:${c.id}%`)) as any[])[0].n;
      assert.equal(ops, 1, `round ${round}: one ending in the ledger`);
      assert.equal(await refundShortCount(c.txnId), 0, `round ${round}: no phantom REFUND_SHORT`);
      assert.deepEqual(await obligations(c.txnId), []);
      assert.deepEqual(await totals(c), { client: PRICE, pt: 0, platform: 0, pending: 0, sum: PRICE });
      await H.invariant(`C3b round ${round}`);
    });
  }
});

test("C3c user-service: a ledger answer CONTRACT_ALREADY_TERMINATED is a definite refusal - the ending is parked CONFLICT and never retried (no second call)", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const pc = H.m.paymentClient as any;
    // a stray caller already ended the transaction under its own key
    await pc.terminate({ ...endBody(c), idempotencyKey: `STRAY:${c.id}` });
    const spy = terminateSpy();
    try {
      spy.go();
      const ended = await endContract(c);
      assert.equal(ended.status, 409, JSON.stringify(ended.body));
      assert.equal(spy.bodies.length, 1, "one call: a definite refusal is not retried");
      const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
      assert.equal(row.status, "CONFLICT");
      assert.match(row.lastError ?? "", /CONTRACT_ALREADY_TERMINATED/);
      await drain(c.id, 3);
      assert.equal(spy.bodies.length, 1);
      assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 0);
      assert.equal(await refundShortCount(c.txnId), 0);
      await H.invariant("C3c");
    } finally {
      spy.go();
      spy.restore();
    }
  });
});
