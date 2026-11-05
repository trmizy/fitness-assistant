/**
 * B-1 release gate (Ngai, 03/11 direction A; 04/11 A2 APPROVED WITH CONDITIONS): the guard key is   outcome | L:<state of L> | C:<ACTIVE|ENDED>   and the state is READ from the real facts.
 * OPENED_D77_COMBINATIONS holds exactly the four SETTLED_CASH keys; this suite proves each through the REAL production path (defaultExecDeps, NO test seam) and that every other key still blocks.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Case API + executor + ruling core, real payment-service child, isolated *_test databases). NO test seam is used in this file: the executor runs
 * with defaultExecDeps(). TEST FIXTURES: the session / contract rows, the cut of the PT's pending (partial L),
 * the UNCONFIRMED -> record-only door for an OPEN L, the stopped payment-service for a PENDING L.
 *
 * HAND-COMPUTED (1,000,000 / 4 sessions, 90/10, V = 250,000 = PT 225,000 + platform 25,000, L = 125,000 taken out of V = PT 112,500 + platform 12,500):
 *   COMPLETED / ACTIVE / L cash:    client 125,000 (=L), PT 112,500, platform 12,500, pending 750,000; used 1, compensated 0.  Ending later (CLIENT_CANCELLED, 3 unused x 90%): client 800,000, PT 180,000, platform 20,000.
 *   COMPLETED / ENDED  / L cash:    final client 800,000, PT 180,000, platform 20,000, pending 0; used 1, compensated 0.
 *   PT_NO_SHOW / ACTIVE / L cash:   client 250,000 (V; L is INSIDE it - never V + L = 375,000), PT 0, platform 0, pending 750,000; used 0, compensated 1. Ending later: client 925,000, PT 67,500, platform 7,500.
 *   PT_NO_SHOW / ENDED  / L cash:   final client 925,000, PT 67,500, platform 7,500, pending 0; used 0, compensated 0 (ended contract: nothing booked).
 * Run ALONE (same command shape as the other cross-service files).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";
process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const L = 125_000;
let OPENED: ReadonlyArray<string> = [];
type Outcome = "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED";
const FINDING = { COMPLETED: "VERIFIED_DELIVERED", CANCELLED: "VERIFIED_NOT_DELIVERED_NO_FAULT", PT_NO_SHOW_CONFIRMED: "VERIFIED_PT_ABSENT" } as const;
type Kind = "SETTLED_CASH" | "SETTLED_PARTIAL_OPEN" | "OPEN" | "PENDING";
const K = (outcome: string, l: string, phase: string) => `${outcome}|L:${l}|C:${phase}`;

let H: Harness;
let X: {
  helpers: typeof import("./dispute-case-exec.test-helpers");
  exec: typeof import("../services/dispute-case/execution.service");
  svc: typeof import("../services/dispute-case/dispute-case.service").disputeCaseService;
  key: typeof import("../services/dispute-case/d77-key");
};
test.before(async () => {
  if (skip) return;
  process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  H = await startHarness({ paymentAuth: true });
  OPENED = (await import("../services/dispute-case/execution-guard")).OPENED_D77_COMBINATIONS;
  X = {
    helpers: await import("./dispute-case-exec.test-helpers"),
    exec: await import("../services/dispute-case/execution.service"),
    svc: (await import("../services/dispute-case/dispute-case.service")).disputeCaseService,
    key: await import("../services/dispute-case/d77-key"),
  };
});
test.after(async () => {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
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
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = { client: await at("CLIENT", "AVAILABLE"), pt: await at("PT", "AVAILABLE"), platform: await at("PLATFORM", "AVAILABLE", "REVENUE"), pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")) };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
/** TEST FIXTURE: a ledger whose PT pending was already short (escrow lowered by the same amount, invariant holds). */
async function cutPtPending(ptUserId: string, cut: number) {
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = 'PT' AND owner_id = $1`, ptUserId);
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
}

interface Fx {
  c: PaidContract;
  S: { id: string };
  pt: string;
}
/** A DISPUTED session with a D77 in the requested real state; `phase` ENDED then ends the contract (CLIENT_CANCELLED). */
async function build(kind: Kind, phase: "ACTIVE" | "ENDED"): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  if (kind === "SETTLED_PARTIAL_OPEN") await cutPtPending(pt, 800_000); // PT pending 900,000 -> 100,000: L's PT part (112,500) cannot be fully funded
  const S = await lateSession(c);
  const payDown = kind === "PENDING" || kind === "OPEN";
  if (payDown) await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  if (payDown) await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  if (kind === "OPEN") {
    assert.notEqual(row.status, "SETTLED");
    await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
    assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  } else if (kind === "PENDING") assert.notEqual(row.status, "SETTLED");
  else assert.equal(row.status, "SETTLED");
  const disp = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(disp.status, 200, JSON.stringify(disp.body));
  if (phase === "ENDED") assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
  return { c, S, pt };
}
async function caseToExecutable(fx: Fx, outcome: Outcome) {
  const a = await X.helpers.approvedCaseFor(fx.S.id, FINDING[outcome] as any);
  const ev = await H.m.prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: a.caseId } });
  const proposed = (await X.svc.proposePolicyEligibility(a.investigator, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "Hợp đồng thuộc chính sách hiện hành (đối chiếu hợp đồng và thông báo)" })).result;
  await X.svc.approvePolicyEligibility(X.helpers.admin(), a.caseId, proposed.reviewId, { reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  return a;
}
/** The PRODUCTION deps. The wrapper only COUNTS calls of the ruling core; it opens nothing (openedD77Combinations is never set). */
function depsWith(_unused: ReadonlyArray<string> = []) {
  const base = X.exec.defaultExecDeps();
  assert.equal((base as any).openedD77Combinations, undefined, "no test seam");
  const counter = { calls: 0 };
  return {
    counter,
    deps: {
      ...base,
      resolveCore: (async (...args: Parameters<typeof base.resolveCore>) => {
        counter.calls++;
        return base.resolveCore(...args);
      }) as typeof base.resolveCore,
    },
  };
}

// ═════════ 1. the key reads the REAL state ═════════
for (const kind of ["SETTLED_CASH", "SETTLED_PARTIAL_OPEN", "OPEN", "PENDING"] as Kind[]) {
  test(`KEY reads the real state: L ${kind} - the guard stays shut for it unless that exact key is opened`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build(kind, "ACTIVE");
      const read = await X.key.readLateState(H.m.prisma, fx.S.id, fx.c.id);
      assert.deepEqual(read, { lState: kind, phase: "ACTIVE" });
      const ob: any[] = await H.payDb.$queryRawUnsafe(`SELECT status::text AS status, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1`, fx.c.txnId);
      if (kind === "SETTLED_PARTIAL_OPEN") {
        // the settlement row IS settled, yet an obligation is still owed with something already paid: this is NOT plain SETTLED
        const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${fx.S.id}` } });
        assert.equal(row.status, "SETTLED");
        assert.equal(ob.length, 1);
        assert.equal(ob[0].status, "OPEN");
        assert.ok(Number(ob[0].paid) > 0 && Number(ob[0].unpaid) > 0, JSON.stringify(ob));
      }
      if (kind === "OPEN") assert.deepEqual([ob[0].status, Number(ob[0].paid), Number(ob[0].unpaid)], ["OPEN", 0, L]);
      if (kind === "SETTLED_CASH") assert.equal(ob.length, 0);
      // PRODUCTION list (four cash keys only): every other real state is blocked for BOTH outcomes, the core is not called, nothing moves
      if (kind !== "SETTLED_CASH") {
        for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED"] as Outcome[]) {
          const fx2: Fx = outcome === "COMPLETED" ? fx : await build(kind, "ACTIVE");
          const a = await caseToExecutable(fx2, outcome);
          const snap = await H.snapshot();
          const { deps, counter } = depsWith();
          await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "EXEC_BLOCKED" && e.details?.reason === "D77_COMBINATION_UNRESOLVED", `${outcome} / ${kind}`);
          assert.equal(counter.calls, 0);
          assert.deepEqual(await H.snapshot(), snap, "the ledger did not move");
          const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx2.S.id } });
          assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["DISPUTED", null]);
        }
      }
      // the phase part of the key follows the contract
      assert.equal((await H.call("POST", `/contracts/${fx.c.id}/terminate`, fx.c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
      const after = await X.key.readLateState(H.m.prisma, fx.S.id, fx.c.id);
      assert.equal((after as any).phase, "ENDED");
    });
  });
}

// ═════════ 2. the four low-risk candidates, opened ONLY through the test seam, one exact key each ═════════
const CANDIDATES: Array<[Outcome, "ACTIVE" | "ENDED"]> = [
  ["COMPLETED", "ACTIVE"],
  ["COMPLETED", "ENDED"],
  ["PT_NO_SHOW_CONFIRMED", "ACTIVE"],
  ["PT_NO_SHOW_CONFIRMED", "ENDED"],
];
const AFTER_RULING = {
  "COMPLETED|ACTIVE": { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000 },
  "PT_NO_SHOW_CONFIRMED|ACTIVE": { client: 250_000, pt: 0, platform: 0, pending: 750_000 },
  "COMPLETED|ENDED": { client: 800_000, pt: 180_000, platform: 20_000, pending: 0 },
  "PT_NO_SHOW_CONFIRMED|ENDED": { client: 925_000, pt: 67_500, platform: 7_500, pending: 0 },
} as const;
const FINAL = { COMPLETED: { client: 800_000, pt: 180_000, platform: 20_000, pending: 0 }, PT_NO_SHOW_CONFIRMED: { client: 925_000, pt: 67_500, platform: 7_500, pending: 0 } } as const;
for (const [outcome, phase] of CANDIDATES) {
  test(`CANDIDATE ${outcome} / ${phase} / L SETTLED in cash: blocked while only OTHER keys are opened; opened by its exact key (test seam) -> hand-computed money and quota, no double transfer, no other contract/session touched`, { skip }, async () => {
    await scenario(async () => {
      // a bystander: another paid contract with one delivered session (its money must not move at all)
      const bPt = await H.makePt();
      const bc = await H.paidContract(bPt, { price: PRICE, totalSessions: 4 });
      await H.deliver(bc, 1);
      const bystander0 = await totals(bc);
      const bystanderWallets0 = [await H.wallet("CLIENT", bc.clientUserId), await H.wallet("PT", bPt)];

      const fx = await build("SETTLED_CASH", phase);
      assert.deepEqual(await X.key.readLateState(H.m.prisma, fx.S.id, fx.c.id), { lState: "SETTLED_CASH", phase });
      const a = await caseToExecutable(fx, outcome);

      assert.ok(OPENED.includes(K(outcome, "SETTLED_CASH", phase)), "this key is in the production list");
      // (1) the state changes between the executor's read and the ruling (STATE CHANGED under the lock): the core refuses; nothing is written
      //     (TEST FIXTURE: the core is called the way the executor calls it, with a read that no longer matches the real state)
      await H.m.prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "EXECUTING", execDecisionId: a.approvalId } });
      const { resolveDisputeCore } = await import("../services/booking.service");
      const snap = await H.snapshot();
      const wrongPhase = phase === "ACTIVE" ? "ENDED" : "ACTIVE";
      await assert.rejects(
        resolveDisputeCore(fx.S.id, "admin-x", outcome, "ruling", { caseDecisionId: a.approvalId, d77Read: { lState: "SETTLED_CASH", phase: wrongPhase } }),
        (e: any) => e.status === 409 && e.code === "D77_COMBINATION_UNRESOLVED" && e.details?.stateChanged === true,
        "phase changed",
      );
      await assert.rejects(
        resolveDisputeCore(fx.S.id, "admin-x", outcome, "ruling", { caseDecisionId: a.approvalId, d77Read: { lState: "PENDING", phase } }),
        (e: any) => e.status === 409 && e.code === "D77_COMBINATION_UNRESOLVED",
        "row is SETTLED but the read said PENDING",
      );
      await assert.rejects(resolveDisputeCore(fx.S.id, "admin-x", outcome, "ruling", { caseDecisionId: a.approvalId }), (e: any) => e.status === 409 && e.code === "D77_COMBINATION_UNRESOLVED", "no read at all");
      assert.deepEqual(await H.snapshot(), snap, "nothing moved");
      await H.m.prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "NOT_STARTED", execDecisionId: null } });

      // (2) the REAL production path, no seam: executes once
      const { deps, counter } = depsWith();
      const r = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps);
      assert.equal(r.executionState, "BUSINESS_DONE");
      assert.equal(counter.calls, 1);
      await drain(fx.c.id);
      const after = await totals(fx.c);
      const exp = AFTER_RULING[`${outcome}|${phase}` as keyof typeof AFTER_RULING];
      assert.deepEqual({ client: after.client, pt: after.pt, platform: after.platform, pending: after.pending }, exp, "hand-computed state right after the ruling");
      assert.equal(after.sum, PRICE, "client + PT + platform + pending = the contract price");
      const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
      const expQuota = outcome === "COMPLETED" ? [1, 0] : [0, phase === "ACTIVE" ? 1 : 0];
      assert.deepEqual([k.usedSessions, k.compensatedSessions], expQuota, "quota");
      if (outcome === "PT_NO_SHOW_CONFIRMED" && phase === "ACTIVE") assert.notEqual(after.client, 250_000 + L, "NO_SHOW pays V (L inside), never V + L");
      // no double transfer: L exists once in the ledger and the session's money step exists once
      assert.equal(await opCount(`PT_LATE_ARRIVAL:${fx.S.id}`), 1, "L exists once");
      const stepKey = outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`;
      assert.equal((await opCount(stepKey)) + (phase === "ENDED" ? await opCount(`UNRESOLVED_SESSION:${fx.S.id}`) : 0), 1, "the money step exists once");
      assert.equal(await H.m.prisma.sessionSettlement.count({ where: { sessionId: fx.S.id, status: { not: "SETTLED" } } }), 0);
      // replay: nothing more moves, the core is not called again
      const again = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps);
      assert.equal(again.replayed, true);
      assert.equal(counter.calls, 1);
      await drain(fx.c.id);
      assert.deepEqual(await totals(fx.c), after, "a replay and the sweeps move nothing");
      // the running contract ends later: the final shares are exactly the ended-contract figures
      if (phase === "ACTIVE") {
        assert.equal((await H.call("POST", `/contracts/${fx.c.id}/terminate`, fx.c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
        await drain(fx.c.id);
      }
      const fin = await totals(fx.c);
      assert.deepEqual({ client: fin.client, pt: fin.pt, platform: fin.platform, pending: fin.pending, sum: fin.sum }, { ...FINAL[outcome as "COMPLETED" | "PT_NO_SHOW_CONFIRMED"], sum: PRICE });
      // no money from another contract / session
      assert.deepEqual(await totals(bc), bystander0, "the bystander contract's money did not move");
      assert.deepEqual([await H.wallet("CLIENT", bc.clientUserId), await H.wallet("PT", bPt)], bystanderWallets0);
      await H.invariant(`B-1 key ${outcome}/${phase}`);
    });
  });
}

test("CANCELLED x D77 stays blocked even when the test opens every key of every outcome and state", { skip }, async () => {
  await scenario(async () => {
    // a CANCELLED finding over a D77 cannot even become a proposal (I6), so - as in b1-executor - the case is approved while the session has no D77, then a settled D77 step appears
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
    const T = Date.now();
    const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
    assert.equal((await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" })).status, 200);
    const fx: Fx = { c, S, pt };
    const a = await caseToExecutable(fx, "CANCELLED");
    await H.m.prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${S.id}`, sessionId: S.id, contractId: c.id, status: "SETTLED" } });
    const everything = (["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as const).flatMap((o) =>
      (["ACTIVE", "ENDED"] as const).flatMap((p) => (["SETTLED_CASH", "SETTLED_PARTIAL_OPEN", "OPEN", "PENDING", "CLOSED_OTHER"] as const).map((l) => K(o, l, p))),
    );
    const snap = await H.snapshot();
    const { deps } = depsWith();
    // (1) the executor refuses (the D77 step changed the live evidence after approval, or EXEC_BLOCKED): a first, independent block
    await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "EXEC_BLOCKED" || /thay đổi|EVIDENCE/i.test(String(e?.message) + String(e?.code)));
    assert.deepEqual(await H.snapshot(), snap);
    // (2) the CORE, called the way the executor calls it (case EXECUTING for this decision), with every key opened AND the executor's real read of L (SETTLED_CASH, ACTIVE): CANCELLED is still refused
    await H.m.prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "EXECUTING", execDecisionId: a.approvalId } });
    const { resolveDisputeCore } = await import("../services/booking.service");
    await assert.rejects(
      resolveDisputeCore(fx.S.id, "admin-x", "CANCELLED", "ruling", { caseDecisionId: a.approvalId, openedD77Combinations: everything, d77Read: { lState: "SETTLED_CASH", phase: "ACTIVE" } }),
      (e: any) => e.status === 409 && e.code === "CANCELLED_BLOCKED_BY_D77",
    );
    assert.deepEqual(await H.snapshot(), snap);
    const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
    assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["DISPUTED", null]);
  });
});

test("CODE AUDIT: OPENED_D77_COMBINATIONS is exactly the four approved cash-L keys - no CANCELLED, no other L state, no outcome-only entry", async () => {
  const { OPENED_D77_COMBINATIONS } = await import("../services/dispute-case/execution-guard");
  assert.deepEqual([...OPENED_D77_COMBINATIONS].sort(), [
    "COMPLETED|L:SETTLED_CASH|C:ACTIVE",
    "COMPLETED|L:SETTLED_CASH|C:ENDED",
    "PT_NO_SHOW_CONFIRMED|L:SETTLED_CASH|C:ACTIVE",
    "PT_NO_SHOW_CONFIRMED|L:SETTLED_CASH|C:ENDED",
  ]);
});
