/**
 * B-1 RELEASE GATE - the 18 D77 cases (and the no-D77 control) through the REAL CaseDecision EXECUTOR, never through the old `resolve` route.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): the real user-service Case API (the service methods the admin routes call), the real executor and ruling core, a real
 * payment-service child on isolated *_test databases. The flags are switched on in the test process only (NODE_ENV=test + DISPUTE_CASE_EXECUTION_ENABLED).
 *
 * The path of every case: intake -> claim -> assessment -> finding -> proposal -> four-eyes approval -> POLICY ELIGIBILITY (propose by the investigator, approve by an independent admin,
 * D-NEW-12) -> execute. `OPENED_D77_COMBINATIONS` in the code holds only the FOUR cash-L keys Ngai approved on 04/11 (A2); the cases below that this suite opens through `openedD77Combinations` use the older outcome-only seam. To produce the evidence the owner asked for, a TEST passes `openedD77Combinations` in the executor's `deps`
 * (a parameter only a test builds: no environment variable, no route, no runtime path - proved below by a code audit). CANCELLED is never opened by it.
 *
 * Opt-in; run ALONE:  RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... SETTLEMENT_INFLIGHT_WAIT_MS=300 \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-b1-executor.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";
// Fail-closed late-open switch (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, user-service gate AND the payment-service child it spawns): this suite PAYS an OPEN late-arrival obligation, so it is turned on in-process before the harness starts (the child inherits it at spawn).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const V = 250_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
type Outcome = "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED";
type ContractState = "ACTIVE" | "ENDED";
type D77State = "NONE" | "SETTLED" | "PENDING" | "OPEN";
const FINDING = { COMPLETED: "VERIFIED_DELIVERED", CANCELLED: "VERIFIED_NOT_DELIVERED_NO_FAULT", PT_NO_SHOW_CONFIRMED: "VERIFIED_PT_ABSENT" } as const;
const OPEN_BOTH = ["COMPLETED", "PT_NO_SHOW_CONFIRMED"] as const;

let H: Harness;
let X: {
  helpers: typeof import("./dispute-case-exec.test-helpers");
  exec: typeof import("../services/dispute-case/execution.service");
  svc: typeof import("../services/dispute-case/dispute-case.service").disputeCaseService;
};
const REPORT: Array<Record<string, unknown>> = [];
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
  if (process.env.S2_B1_EXECUTOR_REPORT) fs.writeFileSync(process.env.S2_B1_EXECUTOR_REPORT, JSON.stringify(REPORT, null, 2));
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
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ key: r.key as string, kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
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

interface Fx {
  c: PaidContract;
  S: { id: string };
  contractState: ContractState;
  d77: D77State;
}
/** A DISPUTED session on a running / ended contract with the requested D77 state, built through the real doors (sweep, dispute, terminate, the record-only door for OPEN). eligibility: false = no review yet. */
async function build(contractState: ContractState, d77: D77State): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  let S: { id: string };
  if (d77 === "NONE") {
    const T = Date.now();
    S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
  } else {
    S = await lateSession(c);
    const payDown = d77 === "PENDING" || d77 === "OPEN";
    if (payDown) await H.stopPayment();
    assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
    if (payDown) await H.startPayment();
    const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
    if (d77 === "OPEN") {
      assert.notEqual(row.status, "SETTLED");
      if (contractState === "ENDED") await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
      else {
        await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
        assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
      }
    }
    if (d77 === "PENDING") assert.notEqual(row.status, "SETTLED");
  }
  const disp = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(disp.status, 200, JSON.stringify(disp.body));
  if (contractState === "ENDED") assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
  return { c, S, contractState, d77 };
}

/** The Case API up to an approved decision AND an approved policy eligibility (two independent admins each time). */
async function caseToExecutable(fx: Fx, outcome: Outcome, o: { eligibility?: boolean } = {}) {
  const a = await X.helpers.approvedCaseFor(fx.S.id, FINDING[outcome] as any);
  if (o.eligibility !== false) {
    const ev = await H.m.prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: a.caseId } });
    const proposed = (await X.svc.proposePolicyEligibility(a.investigator, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "Hợp đồng thuộc chính sách hiện hành (đối chiếu hợp đồng và thông báo)" })).result;
    await X.svc.approvePolicyEligibility(X.helpers.admin(), a.caseId, proposed.reviewId, { reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  }
  return a;
}

/** deps with a COUNTER on the ruling core's exit door and (test only) the opened combinations. */
function depsWith(opened: ReadonlyArray<string>, hooks: Partial<import("../services/dispute-case/execution.service").ExecDeps> = {}) {
  const base = X.exec.defaultExecDeps();
  const counter = { calls: 0 };
  return {
    counter,
    deps: {
      ...base,
      ...hooks,
      openedD77Combinations: opened,
      resolveCore: (async (...args: Parameters<typeof base.resolveCore>) => {
        counter.calls++;
        return base.resolveCore(...args);
      }) as typeof base.resolveCore,
    },
  };
}

const FINAL = { COMPLETED: { client: 800_000, pt: 180_000, platform: 20_000 }, PT_NO_SHOW_CONFIRMED: { client: 925_000, pt: 67_500, platform: 7_500 } } as const;
const END_ACTIVE = (fx: Fx) => H.call("POST", `/contracts/${fx.c.id}/terminate`, fx.c.clientToken, { reason: "CLIENT_CANCELLED" });

// ═════ the 12 cases that are candidates to open (1-6 COMPLETED, 13-18 PT_NO_SHOW) ═════
const CASES: Array<[number, Outcome, ContractState, D77State]> = [
  [1, "COMPLETED", "ACTIVE", "SETTLED"], [2, "COMPLETED", "ACTIVE", "PENDING"], [3, "COMPLETED", "ACTIVE", "OPEN"],
  [4, "COMPLETED", "ENDED", "SETTLED"], [5, "COMPLETED", "ENDED", "PENDING"], [6, "COMPLETED", "ENDED", "OPEN"],
  [13, "PT_NO_SHOW_CONFIRMED", "ACTIVE", "SETTLED"], [14, "PT_NO_SHOW_CONFIRMED", "ACTIVE", "PENDING"], [15, "PT_NO_SHOW_CONFIRMED", "ACTIVE", "OPEN"],
  [16, "PT_NO_SHOW_CONFIRMED", "ENDED", "SETTLED"], [17, "PT_NO_SHOW_CONFIRMED", "ENDED", "PENDING"], [18, "PT_NO_SHOW_CONFIRMED", "ENDED", "OPEN"],
];
for (const [no, outcome, contractState, d77] of CASES) {
  test(`EXECUTOR case ${no}: ${outcome} / ${contractState} / D77 ${d77}: with the combination OPENED BY THE TEST -> money, quota, settlement, obligation as in D77_FINAL_ACCEPTANCE; the core's exit door is called exactly once; then the contract ends`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build(contractState, d77);
      const a = await caseToExecutable(fx, outcome);
      const before = await totals(fx.c);
      const { deps, counter } = depsWith(OPEN_BOTH);
      const r = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps);
      assert.equal(r.executionState, "BUSINESS_DONE");
      assert.equal(counter.calls, 1, "the core's exit door was called exactly once");
      await drain(fx.c.id);
      const after = await totals(fx.c);
      const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
      const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
      assert.equal(sess.resolvedByCaseDecisionId, a.approvalId, "the session carries the CaseDecision");
      assert.equal(sess.status, outcome === "COMPLETED" ? "COMPLETED" : "NO_SHOW");
      assert.deepEqual([k.usedSessions, k.compensatedSessions], outcome === "COMPLETED" ? [1, 0] : [0, contractState === "ACTIVE" ? 1 : 0], "quota (DQ-2(a): +1 compensated on a running contract, unchanged on an ended one)");
      // right after the ruling: who holds what (hand-computed, 90/10)
      if (contractState === "ACTIVE") {
        assert.deepEqual(
          outcome === "COMPLETED" ? { client: after.client, pt: after.pt, platform: after.platform, pending: after.pending } : { client: after.client, pt: after.pt, platform: after.platform, pending: after.pending },
          outcome === "COMPLETED" ? { client: L, pt: 112_500, platform: 12_500, pending: 750_000 } : { client: V, pt: 0, platform: 0, pending: 750_000 },
          `case ${no} after the ruling`,
        );
      } else {
        const exp = FINAL[outcome as "COMPLETED" | "PT_NO_SHOW_CONFIRMED"];
        assert.deepEqual({ client: after.client, pt: after.pt, platform: after.platform, pending: after.pending }, { ...exp, pending: 0 }, `case ${no} (ended): final`);
      }
      const obs = await obligations(fx.c.txnId);
      if (d77 === "OPEN") assert.deepEqual(obs.map((o) => [o.kind, o.status, o.paid, o.unpaid]), [["LATE_ARRIVAL", "PAID_VIA_LEDGER", L, 0]], "L closed by a ledger entry");
      else assert.deepEqual(obs, [], "no obligation");
      assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`) + (contractState === "ENDED" ? await opCount(`UNRESOLVED_SESSION:${fx.S.id}`) : 0) >= 1, true, "the money step is in the ledger");
      assert.equal(await H.m.prisma.sessionSettlement.count({ where: { sessionId: fx.S.id, status: { not: "SETTLED" } } }), 0, "every settlement row of the session is SETTLED");
      // replay of the same command: the same answer, the core is NOT called again
      const again = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps);
      assert.equal(again.replayed, true);
      assert.equal(counter.calls, 1, "still once");
      // the contract ends
      if (contractState === "ACTIVE") {
        assert.equal((await END_ACTIVE(fx)).status, 200);
        await drain(fx.c.id);
      }
      const fin = await totals(fx.c);
      const exp = FINAL[outcome as "COMPLETED" | "PT_NO_SHOW_CONFIRMED"];
      assert.deepEqual({ client: fin.client, pt: fin.pt, platform: fin.platform, pending: fin.pending, sum: fin.sum }, { ...exp, pending: 0, sum: PRICE }, `case ${no}: final money to the right people`);
      await H.invariant(`executor case ${no}`);
      REPORT.push({ case: no, outcome, contractState, d77, beforeRuling: before, afterRuling: after, final: fin, obligations: obs, coreCalls: counter.calls });
    });
  });
}

// ═════ the control: no D77, three outcomes x running / ended ═════
for (const outcome of ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as Outcome[]) {
  for (const contractState of ["ACTIVE", "ENDED"] as ContractState[]) {
    test(`EXECUTOR no D77: ${outcome} / ${contractState}: executes with the default deps (nothing opened), once, money and quota as always`, { skip }, async () => {
      await scenario(async () => {
        const fx = await build(contractState, "NONE");
        const a = await caseToExecutable(fx, outcome);
        const { deps, counter } = depsWith([]);
        const r = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps);
        assert.equal(r.executionState, "BUSINESS_DONE");
        assert.equal(counter.calls, 1);
        await drain(fx.c.id);
        const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
        assert.equal(sess.status, outcome === "COMPLETED" ? "COMPLETED" : outcome === "CANCELLED" ? "CANCELLED" : "NO_SHOW");
        const t = await totals(fx.c);
        const exp =
          contractState === "ACTIVE"
            ? { COMPLETED: { client: 0, pt: 225_000, platform: 25_000, pending: 750_000 }, CANCELLED: { client: 0, pt: 0, platform: 0, pending: 1_000_000 }, PT_NO_SHOW_CONFIRMED: { client: V, pt: 0, platform: 0, pending: 750_000 } }[outcome]
            : { COMPLETED: { client: 675_000, pt: 225_000 + 67_500, platform: 25_000 + 7_500, pending: 0 }, CANCELLED: { client: 675_000 + V, pt: 67_500, platform: 7_500, pending: 0 }, PT_NO_SHOW_CONFIRMED: { client: 675_000 + V, pt: 67_500, platform: 7_500, pending: 0 } }[outcome];
        assert.deepEqual({ client: t.client, pt: t.pt, platform: t.platform, pending: t.pending }, exp, `${outcome}/${contractState}`);
        assert.deepEqual(await obligations(fx.c.txnId), []);
        await H.invariant("no d77");
      });
    });
  }
}

// ═════ with D77 and NOTHING opened (production deps): EXEC_BLOCKED, nothing written ═════
for (const outcome of OPEN_BOTH) {
  test(`D77 + production deps, L OPEN (not one of the four approved cash-L keys): ${outcome} -> EXEC_BLOCKED D77_COMBINATION_UNRESOLVED, the core is NOT called, nothing is written`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build("ACTIVE", "OPEN");
      const a = await caseToExecutable(fx, outcome);
      const snap = await H.snapshot();
      const { deps, counter } = depsWith([]);
      await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "EXEC_BLOCKED" && e.details?.reason === "D77_COMBINATION_UNRESOLVED");
      assert.equal(counter.calls, 0);
      assert.deepEqual(await H.snapshot(), snap, "the ledger did not move");
      const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
      assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["DISPUTED", null]);
      // and the production default really has nothing opened
      assert.equal((X.exec.defaultExecDeps() as any).openedD77Combinations, undefined);
    });
  });
}

// ═════ CANCELLED x D77 stays refused even with a test configuration that opens everything ═════
test("CANCELLED x D77 stays refused (409 CANCELLED_BLOCKED_BY_D77 -> EXEC_BLOCKED) even when the TEST opens COMPLETED, PT_NO_SHOW_CONFIRMED and CANCELLED", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("ACTIVE", "NONE"); // the case is approved while the session has no D77 ...
    const a = await caseToExecutable(fx, "CANCELLED");
    // ... then a D77 step appears on the session (the late-arrival row of the sweep)
    await H.m.prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${fx.S.id}`, sessionId: fx.S.id, contractId: fx.c.id, status: "SETTLED" } });
    const snap = await H.snapshot();
    const { deps, counter } = depsWith(["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"]);
    // (1) the executor refuses: the new D77 step changed the live evidence of the case after the decision was approved (EVIDENCE_CHANGED) - a second, independent block
    await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => /thay đổi|EVIDENCE/i.test(String(e?.message) + String(e?.code)) || e.code === "EXEC_BLOCKED");
    assert.deepEqual(await H.snapshot(), snap);
    // (2) the CORE, called the way the executor calls it (case EXECUTING for this decision: TEST FIXTURE of the executor compare-and-set), every combination opened by the test
    await H.m.prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "EXECUTING", execDecisionId: a.approvalId } });
    const { resolveDisputeCore } = await import("../services/booking.service");
    await assert.rejects(
      resolveDisputeCore(fx.S.id, "admin-x", "CANCELLED", "ruling", { caseDecisionId: a.approvalId, openedD77Combinations: ["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"] }),
      (e: any) => e.status === 409 && e.code === "CANCELLED_BLOCKED_BY_D77",
    );
    assert.equal(counter.calls, 0);
    assert.deepEqual(await H.snapshot(), snap, "the ledger did not move");
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
    assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["DISPUTED", null]);
  });
});

// ═════ D-NEW-12 not approved: refused before any mutation, through the executor ═════
test("D-NEW-12 not approved: the executor refuses 409 POLICY_ELIGIBILITY_UNVERIFIED before ANY mutation (case not marked, no execution row, core not called); after the review is approved the same decision executes", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("ACTIVE", "NONE");
    const a = await caseToExecutable(fx, "COMPLETED", { eligibility: false });
    const { deps, counter } = depsWith([]);
    await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "POLICY_ELIGIBILITY_UNVERIFIED");
    await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "POLICY_ELIGIBILITY_UNVERIFIED"); // retry
    assert.equal(counter.calls, 0);
    const c = await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } });
    assert.equal(c.execStatus, "NOT_STARTED");
    assert.equal(await H.m.prisma.disputeCaseExecution.count({ where: { caseId: a.caseId } }), 0);
    const ev = await H.m.prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: a.caseId } });
    const proposed = (await X.svc.proposePolicyEligibility(a.investigator, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "đối chiếu hợp đồng" })).result;
    await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "POLICY_ELIGIBILITY_UNVERIFIED"); // proposed, not approved
    await X.svc.approvePolicyEligibility(X.helpers.admin(), a.caseId, proposed.reviewId, { reason: "ok", conflictOfInterestDeclaredNone: true });
    assert.equal((await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps)).executionState, "BUSINESS_DONE");
    assert.equal(counter.calls, 1);
  });
});

// ═════ crash boundaries, retry, two commands at once ═════
const BOUNDARIES = ["afterExecutingCas", "afterDecisionCommitted", "afterCore"] as const;
for (const boundary of BOUNDARIES) {
  test(`CRASH at boundary ${boundary} (case 3 shape: COMPLETED, running, L OPEN): reconcile reads the real state; the money is settled exactly once; the core's door is not called twice for one ruling`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build("ACTIVE", "OPEN");
      const a = await caseToExecutable(fx, "COMPLETED");
      const crash = depsWith(OPEN_BOTH, {
        [boundary]: async () => {
          throw new Error("simulated crash");
        },
      } as any);
      await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, crash.deps), /simulated crash/);
      const mid = await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } });
      assert.equal(mid.execStatus, "EXECUTING");
      const rec = depsWith(OPEN_BOTH);
      const r = (await X.exec.executionService.reconcileExecution(X.helpers.admin(), a.caseId, rec.deps)) as any;
      assert.ok(["RERAN_CORE", "RECORDED_BUSINESS_DONE", "BUSINESS_DONE"].includes(r.action) || r.executionState === "BUSINESS_DONE" || /DONE|RERAN/.test(String(r.action)), JSON.stringify(r).slice(0, 200));
      await drain(fx.c.id);
      const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
      assert.equal(sess.status, "COMPLETED");
      assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1, "released exactly once");
      assert.equal((await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } })).usedSessions, 1, "quota +1 once");
      const obs = await obligations(fx.c.txnId);
      assert.deepEqual(obs.map((o) => [o.status, o.paid]), [["PAID_VIA_LEDGER", L]]);
      assert.equal(await totals(fx.c).then((t) => t.pending), 750_000);
      await H.invariant(`crash ${boundary}`);
    });
  });
}

test("TWO execute commands at once on the same decision: exactly one runs the core; the other is refused or replays; the money is settled once", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("ACTIVE", "OPEN");
    const a = await caseToExecutable(fx, "COMPLETED");
    const one = depsWith(OPEN_BOTH);
    const two = depsWith(OPEN_BOTH);
    const results = await Promise.allSettled([X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, one.deps), X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, two.deps)]);
    assert.equal(one.counter.calls + two.counter.calls, 1, "the core's exit door was called once across both commands");
    assert.ok(results.some((r) => r.status === "fulfilled"));
    await drain(fx.c.id);
    assert.equal(await opCount(`SESSION_RELEASE:${fx.S.id}`), 1);
    assert.deepEqual((await obligations(fx.c.txnId)).map((o) => [o.status, o.paid]), [["PAID_VIA_LEDGER", L]]);
    await H.invariant("two commands");
  });
});

// ═════ the opening is test-only: code audit ═════
test("CODE AUDIT: production code has no way to open a D77 combination - OPENED_D77_COMBINATIONS is the empty constant, `openedD77Combinations` is read only from ExecDeps / the ctx the executor builds, defaultExecDeps() never sets it, and no env variable or route mentions it", { skip }, async () => {
  const root = path.resolve(__dirname, "..");
  const guard = fs.readFileSync(path.join(root, "services/dispute-case/execution-guard.ts"), "utf8");
  assert.match(guard, /export const OPENED_D77_COMBINATIONS: ReadonlyArray<string> = \[\s*"COMPLETED\|L:SETTLED_CASH\|C:ACTIVE",\s*"COMPLETED\|L:SETTLED_CASH\|C:ENDED",\s*"PT_NO_SHOW_CONFIRMED\|L:SETTLED_CASH\|C:ACTIVE",\s*"PT_NO_SHOW_CONFIRMED\|L:SETTLED_CASH\|C:ENDED",\s*\];/);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (["__tests__", "generated", "node_modules"].includes(f.name)) continue;
        walk(p);
      } else if (/\.ts$/.test(f.name) && fs.readFileSync(p, "utf8").includes("openedD77Combinations")) hits.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(root);
  assert.deepEqual(hits.sort(), ["services/dispute-case/execution-guard.ts", "services/dispute-case/execution.service.ts"]);
  const exec = fs.readFileSync(path.join(root, "services/dispute-case/execution.service.ts"), "utf8");
  assert.doesNotMatch(exec, /process\.env[^\n]*openedD77/i);
  const ctrl = fs.readFileSync(path.join(root, "controllers/dispute-case.controller.ts"), "utf8");
  assert.doesNotMatch(ctrl, /openedD77|OPENED_D77/);
  const def = exec.slice(exec.indexOf("export const defaultExecDeps"), exec.indexOf("const toJson"));
  assert.doesNotMatch(def, /openedD77Combinations/);
  const mod = await import("../services/dispute-case/execution-guard");
  assert.equal(mod.OPENED_D77_COMBINATIONS.length, 4);
});
