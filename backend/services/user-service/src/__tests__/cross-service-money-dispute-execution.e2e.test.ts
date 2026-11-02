/**
 * DISPUTE CASE slice 2 / S2.1 - the CaseDecision EXECUTOR on the REAL payment-service ledger (cross-service acceptance).
 *
 * Evidence label: BACKEND INTEGRATION (cross-service) - real HTTP between user-service's Express app (this process) and a spawned payment-service
 * child, real ledger, isolated *_test databases. The Case workflow (open -> assess -> finding -> proposal -> four-eyes approval -> execute) is the
 * REAL service code. TEST FIXTURE: the contract row (really paid via contractService.pay + a signed gateway IPN), the session rows (born
 * PENDING_CLIENT_CONFIRMATION, then really disputed through POST /sessions/:id/dispute), auth-service's token table, the crash seams of the
 * executor, and the adversarial D77 writer of the race test. The flag DISPUTE_CASE_EXECUTION_ENABLED is on ONLY through the fail-closed rule
 * (NODE_ENV=test + the preload's DB_ISOLATION=accepted). No product money behaviour is changed or asserted from the code under test: expectations are
 * the policy invariants I1-I4 of the S2.0 brief (V = 250,000 for a 1,000,000 / 4-session contract at 10 / 90) and EQUALITY with what the OLD exit
 * produces for an identical contract.
 *
 * Opt-in; run ALONE (spawns payment-service, TRUNCATEs its ledger tables):
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL="...gymcoach_user_<x>_test?schema=public" E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_<x>_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-dispute-execution.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DAY, HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

const PRICE = 1_000_000;
const SESSIONS = 4;
const V = 250_000;
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
type Outcome = "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED";
const OUTCOMES: Outcome[] = ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"];
const FINDING = { COMPLETED: "VERIFIED_DELIVERED", CANCELLED: "VERIFIED_NOT_DELIVERED_NO_FAULT", PT_NO_SHOW_CONFIRMED: "VERIFIED_PT_ABSENT" } as const;

let H: Harness;
let X: {
  helpers: typeof import("./dispute-case-exec.test-helpers");
  exec: typeof import("../services/dispute-case/execution.service");
};
test.before(async () => {
  if (skip) return;
  process.env.NODE_ENV = "test";
  process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  H = await startHarness({ paymentAuth: true });
  X = { helpers: await import("./dispute-case-exec.test-helpers"), exec: await import("../services/dispute-case/execution.service") };
});
test.after(async () => {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  if (H) await H.close();
});

const num = (v: unknown) => Number(v ?? 0);
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
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}

interface Fx {
  c: PaidContract;
  S: { id: string };
  ended: boolean;
}
/** A DISPUTED session (really disputed by the client) on a running or an ENDED contract, no D77 anywhere. */
async function setup(ended: boolean): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: SESSIONS });
  const T = Date.now();
  const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - DAY), { clientConfirmDeadline: new Date(T + 2 * DAY), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
  const d = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  if (ended) {
    const t = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(t.status, 200, JSON.stringify(t.body));
  }
  return { c, S, ended };
}

async function facts(fx: Fx) {
  const { c, S } = fx;
  const k = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
  const entries = await H.entries(c.txnId);
  const sumNet = entries.filter((e) => !(e.ownerType === "PLATFORM" && e.ownerId === "ESCROW")).reduce((s, e) => s + (e.type === "CREDIT" ? e.amount : -e.amount), 0);
  const obs: any[] = await H.payDb.$queryRawUnsafe(`SELECT key, kind::text AS kind, status::text AS status, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY key`, c.txnId);
  return {
    status: sess.status as string,
    ptAtFault: sess.ptAtFault,
    deducted: sess.sessionDeducted,
    used: k.usedSessions as number,
    comp: k.compensatedSessions as number,
    contract: k.status as string,
    client: (await H.wallet("CLIENT", c.clientUserId)).a,
    partiesAvail: (await H.net(c.txnId, "PT", "AVAILABLE")) + (await H.net(c.txnId, "PLATFORM", "AVAILABLE", "REVENUE")),
    pending: (await H.net(c.txnId, "PT", "PENDING")) + (await H.net(c.txnId, "PLATFORM", "PENDING", "REVENUE")),
    sumNet: Math.round(sumNet),
    obligations: obs.map((o) => `${o.kind}:${o.status}:${num(o.unpaid)}`),
    ops: ((await H.payDb.$queryRawUnsafe(`SELECT key FROM ledger_operations WHERE key LIKE '%:${S.id}' ORDER BY key`)) as any[]).map((r) => String(r.key).replace(S.id, "<S>")),
    settlements: (await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: S.id }, orderBy: { idempotencyKey: "asc" } })).map((r) => `${r.kind}:${r.status}`),
  };
}
type Facts = Awaited<ReturnType<typeof facts>>;

async function viaOldExit(fx: Fx, outcome: Outcome) {
  const token = H.tokenFor(randomUUID(), "ADMIN");
  const r = await H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, token, { resolution: outcome, note: "old exit" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await drain(fx.c.id);
}
async function approve(fx: Fx, outcome: Outcome) {
  return X.helpers.approvedCaseFor(fx.S.id, FINDING[outcome]);
}
async function viaExecutor(fx: Fx, outcome: Outcome) {
  const a = await approve(fx, outcome);
  const r = await X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {});
  assert.equal(r.executionState, "BUSINESS_DONE");
  await drain(fx.c.id);
  return { a, r };
}

/** Policy expectations (I1-I4), no D77: what each outcome must do to the ledger, quota and session. */
function assertPolicy(outcome: Outcome, ended: boolean, before: Facts, after: Facts) {
  const refund = after.client - before.client;
  assert.equal(after.sumNet, PRICE, "I4: the buckets of the transaction add up to the price");
  assert.deepEqual(after.obligations, [], "this contract can fund the session: nothing is left OPEN");
  if (outcome === "COMPLETED") {
    assert.equal(refund, 0, "I1: the client gets no cash for a delivered session");
    assert.equal(after.partiesAvail - before.partiesAvail, V, "I2: PT + platform receive V");
    assert.deepEqual([after.used, after.comp], [before.used + 1, before.comp], "I3");
    assert.equal(after.status, "COMPLETED");
  } else if (outcome === "PT_NO_SHOW_CONFIRMED") {
    assert.equal(refund, V, "I1: the client is refunded V");
    assert.equal(after.partiesAvail - before.partiesAvail, 0, "I2: the PT is not paid for the session");
    // I3 counts the compensated session on a RUNNING contract; on an ended one the counters no longer drive money (see S2.0 report, I3 note)
    if (!ended) assert.deepEqual([after.used, after.comp], [before.used, before.comp + 1], "I3 (DQ-2(a))");
    assert.deepEqual([after.status, after.ptAtFault], ["NO_SHOW", true]);
  } else {
    assert.equal(after.status, "CANCELLED");
    assert.deepEqual([after.used, after.comp], [before.used, before.comp], "I3: unchanged");
    assert.equal(after.partiesAvail - before.partiesAvail, 0);
    // running contract: nothing moves at all; ended contract: the held value goes back to the client
    assert.equal(refund, ended ? V : 0, ended ? "I1: the held value is returned" : "nothing moves");
  }
  assert.equal(after.pending, ended ? 0 : (SESSIONS - after.used - after.comp - (outcome === "CANCELLED" ? 0 : 0)) * V, "I4b: pending funds exactly the sessions still to come");
}

for (const ended of [false, true]) {
  for (const outcome of OUTCOMES) {
    test(`S2.1 acceptance: ${outcome} through the executor on a ${ended ? "ENDED" : "running"} contract (no D77) -> ledger obeys I1-I4 AND equals what the old exit produces for an identical contract`, { skip }, async () => {
      await scenario(async () => {
        // A: the executor
        const a = await setup(ended);
        const beforeA = await facts(a);
        const { a: dec } = await viaExecutor(a, outcome);
        const afterA = await facts(a);
        assertPolicy(outcome, ended, beforeA, afterA);
        const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: a.S.id } });
        assert.equal(sess.resolvedByCaseDecisionId, dec.approvalId, "the decision <-> session link");
        const settle = await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: a.S.id } });
        for (const row of settle.filter((r) => r.kind !== "CONTRACT_TERMINATION")) assert.equal((row.requestSnapshot as any).caseDecisionId, dec.approvalId, `${row.kind} carries the decision id`);
        assert.ok(settle.every((r) => r.status === "SETTLED"), `every money step reached the ledger: ${settle.map((r) => r.status)}`);

        // B: an identical contract through the OLD exit
        const b = await setup(ended);
        const beforeB = await facts(b);
        await viaOldExit(b, outcome);
        const afterB = await facts(b);
        const strip = (f: Facts, x: Facts) => ({ ...f, client: f.client - x.client, partiesAvail: f.partiesAvail - x.partiesAvail });
        assert.deepEqual(strip(afterA, beforeA), strip(afterB, beforeB), "the money / quota / session effect of the executor == the old exit (same ledger, same keys, same settlements)");
        const settleB = await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: b.S.id } });
        for (const row of settleB) assert.equal((row.requestSnapshot as any).caseDecisionId, undefined);

        // the money axis is derived from the ledger now that it is confirmed
        const again = await X.exec.executionService.executeDecision(X.helpers.admin(), dec.caseId, {});
        assert.equal(again.replayed, true);
        if (outcome === "CANCELLED" && !ended) assert.equal((again.money as any).group, "NO_RECORDED_SETTLEMENT");
        else assert.equal((again.money as any).group, "F1", JSON.stringify(again.money));
      });
    });
  }
}

test("S2.1 concurrency with the REAL ledger: two execute commands at once -> one ruling, one ledger effect", { skip }, async () => {
  for (let i = 0; i < 3; i++) {
    await scenario(async () => {
      const fx = await setup(false);
      const before = await facts(fx);
      const a = await approve(fx, "PT_NO_SHOW_CONFIRMED");
      const [r1, r2] = await Promise.allSettled([X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}), X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {})]);
      const wins = [r1, r2].filter((r) => r.status === "fulfilled" && !(r as any).value.replayed);
      assert.equal(wins.length, 1, "exactly one command ran the ruling");
      await drain(fx.c.id);
      const after = await facts(fx);
      assert.equal(after.client - before.client, V, "one refund, not two");
      assert.deepEqual([after.used, after.comp], [before.used, before.comp + 1]);
      assert.deepEqual(after.ops, ["PT_NO_SHOW:<S>"]);
    });
  }
});

// ── crash recovery with money ──────────────────────────────────────────────────────────────────────────────────────────
const crash = () => Object.assign(new Error("simulated process death"), {});
for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED"] as Outcome[]) {
  for (const boundary of [1, 2, 3] as const) {
    test(`S2.1 crash boundary ${boundary} (${["after EXECUTING / before the core", "inside the core, after the committed decision / before the money step", "after the core / before BUSINESS_DONE"][boundary - 1]}) with ${outcome}: recovery -> the ledger equals a crash-free run; no refund twice, no quota twice, no settlement twice`, { skip }, async () => {
      await scenario(async () => {
        // reference: a crash-free run on an identical contract
        const ref = await setup(false);
        const refBefore = await facts(ref);
        await viaExecutor(ref, outcome);
        const refAfter = await facts(ref);

        const fx = await setup(false);
        const before = await facts(fx);
        const a = await approve(fx, outcome);
        const seam = boundary === 1 ? { afterExecutingCas: async () => Promise.reject(crash()) } : boundary === 2 ? { afterDecisionCommitted: async () => Promise.reject(crash()) } : { afterCore: async () => Promise.reject(crash()) };
        await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, { ...X.exec.defaultExecDeps(), ...seam }), /simulated process death/);
        const mid = await facts(fx);
        assert.equal((await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } })).execStatus, "EXECUTING");
        if (boundary === 1) assert.deepEqual([mid.status, mid.client - before.client], ["DISPUTED", 0], "nothing happened yet");
        else assert.notEqual(mid.status, "DISPUTED", "the decision had committed");
        const rec = await X.exec.executionService.reconcileExecution(X.helpers.admin(), a.caseId);
        assert.equal(rec.action, boundary === 1 ? "RERAN_CORE" : "BUSINESS_DONE");
        await drain(fx.c.id); // the settlement sweep finishes the money step the crash interrupted
        const after = await facts(fx);
        const rel = (f: Facts, b: Facts) => ({ ...f, client: f.client - b.client, partiesAvail: f.partiesAvail - b.partiesAvail });
        assert.deepEqual(rel(after, before), rel(refAfter, refBefore), "ledger, quota, settlements and ledger operations after recovery == a run without a crash");
        assert.equal((await H.m.prisma.sessionSettlement.count({ where: { sessionId: fx.S.id } })), (await H.m.prisma.sessionSettlement.count({ where: { sessionId: ref.S.id } })), "no settlement twice");
        assert.equal((await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } })).execStatus, "BUSINESS_DONE");
        assert.equal((await X.exec.executionService.reconcileExecution(X.helpers.admin(), a.caseId)).action, "NOTHING_TO_RECONCILE");
      });
    });
  }
}

// ── B-1 with the real D77 ──────────────────────────────────────────────────────────────────────────────────────────────
/** A session with a REAL D77: the room-close sweep records it (PT 16 minutes late, client on time), then the client disputes. */
async function setupD77(): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: SESSIONS });
  const start = new Date(Date.now() - 2 * HOUR);
  const S = await H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
  assert.deepEqual(await (await import("../services/room-close-resolution.service")).runRoomCloseResolution(), { scanned: 1, resolved: 1 });
  const d = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  return { c, S, ended: false };
}

// POLICY CHANGE I6 = A (Ngai, 31/10/2026): CANCELLED over a D77 never becomes a proposal; B-1 (EXEC_BLOCKED) stays for COMPLETED and PT_NO_SHOW_CONFIRMED.
test("I6 with a real settled D77: a CANCELLED finding creates NO proposal (POLICY_PENDING), and the old exit refuses CANCELLED with 409 CANCELLED_BLOCKED_BY_D77 - not one ledger row, wallet, quota or session field moves", { skip }, async () => {
  await scenario(async () => {
    const fx = await setupD77();
    const snapshot = await H.snapshot();
    const before = await facts(fx);
    // I6 on the old exit while the session has NO Case yet (with a Case, D65 track B answers CASE_EXISTS first - asserted below)
    const old = await H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, H.tokenFor(randomUUID(), "ADMIN"), { resolution: "CANCELLED", note: "I6" });
    assert.equal(old.status, 409, JSON.stringify(old.body));
    assert.match(JSON.stringify(old.body), /CANCELLED_BLOCKED_BY_D77/);
    const at = await X.helpers.caseAtFinding(fx.S.id, "VERIFIED_NOT_DELIVERED_NO_FAULT");
    const { disputeCaseService } = await import("../services/dispute-case/dispute-case.service");
    const r = (await disputeCaseService.propose(at.investigator, at.caseId, undefined)).result;
    assert.equal(r.policyPending, true);
    assert.equal(r.blocked, "CANCELLED_BLOCKED_BY_D77");
    assert.equal(await H.m.prisma.disputeCaseProposal.count({ where: { caseId: at.caseId } }), 0);
    assert.equal((await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: at.caseId } })).status, "POLICY_PENDING");
    const oldAgain = await H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, H.tokenFor(randomUUID(), "ADMIN"), { resolution: "CANCELLED", note: "I6" });
    assert.deepEqual([oldAgain.status, oldAgain.body.code], [409, "CASE_EXISTS"], "D65 track B: with a Case, the old exit stops at CASE_EXISTS");
    assert.deepEqual(await H.snapshot(), snapshot, "the ledger did not move");
    assert.deepEqual(await facts(fx), before, "session, quota, settlements, obligations: untouched");
  });
});

for (const outcome of OUTCOMES.filter((o) => o !== "CANCELLED")) {
  test(`B-1 with a real settled D77: ${outcome} stays EXEC_BLOCKED (D77_COMBINATION_UNRESOLVED) - not one ledger row, wallet, quota or session field moves`, { skip }, async () => {
    await scenario(async () => {
      const fx = await setupD77();
      const a = await approve(fx, outcome);
      assert.equal((await H.m.prisma.disputeCaseProposal.findFirstOrThrow({ where: { caseId: a.caseId } })).executionBlockedReason, "D77_COMBINATION_UNRESOLVED", "flagged already at proposal time (Slice 1)");
      const snapshot = await H.snapshot();
      const before = await facts(fx);
      await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}), (e: any) => e.code === "EXEC_BLOCKED" && e.details?.reason === "D77_COMBINATION_UNRESOLVED");
      assert.deepEqual(await H.snapshot(), snapshot, "the ledger did not move");
      assert.deepEqual(await facts(fx), before, "session, quota, settlements, obligations: untouched");
      assert.equal((await H.m.prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } })).execStatus, "EXEC_BLOCKED");
    });
  });
}

test("B-1 race: a D77 intent written IN PARALLEL with the execution (same writer lock as room-close: withRunningContract) -> either the executor is BLOCKED and moves nothing, or it ran fully BEFORE the writer; never a mix. 24 rounds, the writer starting 0-40 ms apart", { skip }, async () => {
  const { withRunningContract } = await import("../services/contract-lock");
  const tally: Record<string, number> = {};
  let blocked = 0;
  let ranFirst = 0;
  for (let i = 0; i < 24; i++) {
    await scenario(async () => {
      const fx = await setup(false);
      const outcome = OUTCOMES[i % 3];
      const a = await approve(fx, outcome);
      const before = await facts(fx);
      const delay = (i * 7) % 41; // ms: sweeps the writer across the executor's pre-checks, start, and lock
      const writer = new Promise((r) => setTimeout(r, delay)).then(() => withRunningContract(fx.c.id, async (tx) => H.m.payout.recordLateArrivalIntent(tx, fx.c.id, fx.S.id)));
      const exec = X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}).then(
        (r) => ({ ok: true as const, r }),
        (e) => ({ ok: false as const, e }),
      );
      const [, res] = await Promise.all([writer, exec]);
      const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
      const intents = await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: fx.S.id } });
      const keys = intents.map((r) => r.idempotencyKey).sort();
      if (!res.ok) {
        // the writer won the lock: the guard (under the same lock, before the CAS) saw the trace
        // EXEC_BLOCKED = the D77 guard (early check or, when the writer slipped in after it, the guard UNDER THE LOCK); EVIDENCE_CHANGED = the intent changed the case's evidence first
        assert.ok(["EXEC_BLOCKED", "EVIDENCE_CHANGED"].includes((res.e as any).code), `${(res.e as any).code}`);
        tally[`${(res.e as any).code}${(res.e as any).details?.reason ? ":" + (res.e as any).details.reason : ""}`] = (tally[`${(res.e as any).code}${(res.e as any).details?.reason ? ":" + (res.e as any).details.reason : ""}`] ?? 0) + 1;
        assert.equal(sess.status, "DISPUTED", "BLOCKED: the session was not touched");
        assert.equal(sess.resolvedByCaseDecisionId, null);
        assert.deepEqual(keys, [`PT_LATE_ARRIVAL:${fx.S.id}`], "only the writer's intent exists");
        const after = await facts(fx);
        assert.deepEqual([after.client, after.used, after.comp, after.pending], [before.client, before.used, before.comp, before.pending], "no money, no quota");
        blocked++;
      } else {
        // the executor won the lock and ran before the writer: its own effect is exactly the no-D77 effect
        assert.equal(sess.resolvedByCaseDecisionId, a.approvalId);
        assert.ok(keys.includes(`PT_LATE_ARRIVAL:${fx.S.id}`));
        ranFirst++;
        // only the executor's money step is settled here; the writer's late row (a state the real writer cannot create on a ruled session: it needs CONFIRMED) is NOT swept
        const after = await facts(fx);
        const refund = after.client - before.client;
        assert.equal(refund, outcome === "PT_NO_SHOW_CONFIRMED" ? V : 0, `${outcome}: the executor's effect is the no-D77 effect`);
      }
      await H.invariant("race");
    });
  }
  assert.equal(blocked + ranFirst, 24);
  console.log(`[S2.1 race] blocked=${blocked} (${JSON.stringify(tally)}) executor-first=${ranFirst}`);
});

test("B-1 under the lock, deterministic: the D77 writer HOLDS the contract lock when the core arrives (the early checks already passed) -> the core waits, then the guard sees the committed intent and refuses BEFORE its CAS; for all three outcomes nothing moves", { skip }, async () => {
  const { withRunningContract } = await import("../services/contract-lock");
  for (const outcome of OUTCOMES) {
    await scenario(async () => {
      const fx = await setup(false);
      const a = await approve(fx, outcome);
      const before = await facts(fx);
      const snapshot = await H.snapshot();
      let writer: Promise<unknown> = Promise.resolve();
      const deps = {
        ...X.exec.defaultExecDeps(),
        // the early checks have passed and the case is EXECUTING; now a D77 writer takes the contract lock and keeps it for 400 ms before writing its intent
        afterExecutingCas: async () => {
          writer = withRunningContract(fx.c.id, async (tx) => {
            await new Promise((r) => setTimeout(r, 400));
            await H.m.payout.recordLateArrivalIntent(tx, fx.c.id, fx.S.id);
          });
          await new Promise((r) => setTimeout(r, 120)); // the writer now holds the lock; the core below must queue behind it
        },
      };
      const t0 = Date.now();
      await assert.rejects(X.exec.executionService.executeDecision(X.helpers.admin(), a.caseId, {}, deps), (e: any) => e.code === "EXEC_BLOCKED" && e.details?.reason === "D77_COMBINATION_UNRESOLVED");
      assert.ok(Date.now() - t0 >= 350, "the core really waited for the writer's lock");
      await writer;
      const rows = await H.m.prisma.disputeCaseExecution.findMany({ where: { caseId: a.caseId }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(rows.map((r) => r.state), ["STARTED", "BLOCKED"], "it passed the early checks and was stopped by the guard under the lock");
      const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
      assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId, sess.sessionDeducted], ["DISPUTED", null, false]);
      const after = await facts(fx);
      assert.deepEqual([after.client, after.used, after.comp, after.pending, after.partiesAvail], [before.client, before.used, before.comp, before.pending, before.partiesAvail]);
      assert.deepEqual((await H.snapshot()).wallets, snapshot.wallets, "no wallet moved");
      assert.deepEqual(after.settlements, ["PT_LATE_ARRIVAL_COMPENSATION:PENDING"], "only the writer's intent");
    });
  }
});

test("S2.2 T0 over REAL HTTP: with the flag on, POST /admin/sessions/:id/resolve answers 409 CASE_REQUIRED and moves nothing; the executor still rules; with the flag off the route works as before", { skip }, async () => {
  await scenario(async () => {
    const fx = await setup(false);
    const token = H.tokenFor(randomUUID(), "ADMIN");
    process.env.DISPUTE_CASE_T0 = "true";
    try {
      const snapshot = await H.snapshot();
      const before = await facts(fx);
      const r = await H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, token, { resolution: "PT_NO_SHOW_CONFIRMED", note: "old exit under T0" });
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, "CASE_REQUIRED");
      assert.deepEqual(await H.snapshot(), snapshot, "the ledger did not move");
      assert.deepEqual(await facts(fx), before);
      // the executor is the one door that stays open
      const { r: ok } = await viaExecutor(fx, "PT_NO_SHOW_CONFIRMED");
      assert.equal(ok.executionState, "BUSINESS_DONE");
      assert.equal((await facts(fx)).client - before.client, V);
    } finally {
      delete process.env.DISPUTE_CASE_T0;
    }
    const other = await setup(false);
    const r2 = await H.call("POST", `/admin/sessions/${other.S.id}/resolve`, token, { resolution: "CANCELLED", note: "T0 off" });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
  });
});
