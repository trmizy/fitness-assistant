/**
 * Audit D57-1 - groups 5-7: an instance is KILLED (hard, no handler) while it holds a contract lock and is in the middle of
 * a payment-service call or between two steps; a lock held by "another instance" outlasts the wait; the settlement retry
 * paths run on several instances at once.
 *
 * Evidence label: BACKEND INTEGRATION (real ledger). Kill = taskkill /F (TerminateProcess) = SIGKILL semantics.
 * Phase 0 (D58/D63): the tests that used to be named "PROVES DEFECT ..." (they asserted the DEFECTIVE numbers on purpose and
 * passed while the defect was present) are now [REGRESSION] tests asserting the CORRECT behaviour with the same kill. What changed
 * in the code: the decision (status CAS + counters + intent row) commits in ONE short transaction and the lock is released BEFORE the
 * payment-service call, so a kill leaves either nothing or a complete decision plus a durable intent that another instance's sweep
 * repeats with the same key (bookkeeping applied once); an ending is recorded before its money call. One test keeps the label
 * [KNOWN-ISSUE]: K5's head-of-line wait is a configuration matter (CONTRACT_LOCK_WAIT_MS / CONTRACT_LOCK_MAX_HOLDERS), not a defect fixed in code.
 *
 *   RUN_MULTI_INSTANCE=1 ./node_modules/.bin/tsx --test src/__tests__/multi-instance/mi-crash.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, DAY, skip, sleep, startMi, type Mi, type PaidContract } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 3, instanceEnv: { SESSION_SETTLEMENT_STALE_PROCESSING_MS: "3000" } });
});
test.after(async () => {
  if (M) await M.close();
});
const show = (label: string, o: Record<string, unknown>) => console.log(`[MI] ${label} ${JSON.stringify(o)}`);

async function scenario(fn: () => Promise<void>) {
  await M.resetAll();
  for (const i of M.instances) {
    i.proxy.clearArms();
    if (!i.alive()) await i.start();
  }
  await M.startPayment();
  await fn();
  await M.invariant("end of scenario");
}
async function aNet(A: PaidContract) {
  return {
    client: (await M.wallet("CLIENT", A.clientUserId)).a,
    ptAvail: await M.net(A.txnId, "PT", "AVAILABLE"),
    ptPend: await M.net(A.txnId, "PT", "PENDING"),
    platAvail: await M.net(A.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await M.net(A.txnId, "PLATFORM", "PENDING", "REVENUE"),
  };
}
async function setUp() {
  const pt = await M.makePt();
  const A = await M.paidContract(pt, { packageName: "Gói A" });
  const B = await M.paidContract(pt, { packageName: "Gói B" });
  await M.deliver(B, 1);
  await M.deliver(A, 2);
  return { pt, A, B };
}
const pick = (x: { client: number; ptAvail: number; platAvail: number }) => ({ client: x.client, ptAvail: x.ptAvail, platAvail: x.platAvail });
/** A killed client does not abort a statement that is BLOCKED on a lock: Postgres only notices a dead peer when it next reads or writes the socket. Terminate those backends the way a dropped connection would. */
async function dropBlockedBackends(like: string) {
  const r = (await M.prisma.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%${like}%' AND datname = current_database() AND pid <> pg_backend_pid()`)) as any[];
  return r.length;
}
async function until(fn: () => Promise<boolean>, ms = 15_000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Date.now() - t0;
    await sleep(step);
  }
  throw new Error("until: timed out");
}
const endReq = (inst: number, A: PaidContract, reason = "CLIENT_CANCELLED") => M.call(inst, "POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason });

// ── K1: SIGKILL while confirm holds the lock and waits for payment-service ────────────────────────────────────────

test("K1 [REGRESSION G1] SIGKILL during a client confirm's release call: the decision (claim + usedSessions + intent) was committed atomically BEFORE the call, so the kill leaves a complete decision and a durable intent; the retry changes nothing and the sweep settles the row once - usedSessions counts the session once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 3 * DAY), { clientConfirmDeadline: new Date(Date.now() + 3 * DAY), ptNotes: "ok" });
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("release-session"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = M.call(2, "POST", `/sessions/${S.id}/confirm`, A.clientToken);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    const r1 = await first;
    const lockKey = await M.hashOf(A.id);
    assert.ok(!(await M.advisoryLocks()).includes(lockKey), "no advisory lock is held across the payment-service call: nothing to free after the kill");
    const sess1 = await M.sessionRow(S.id);
    const c1 = await M.contractRow(A.id);
    const row1 = await M.prisma.sessionSettlement.findUnique({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
    const state1 = {
      killedRequestStatus: r1.status,
      session: [sess1.status, sess1.sessionDeducted],
      usedSessions: c1.usedSessions,
      releasedToPt: Number(c1.releasedToPt),
      settlementRow: row1?.status ?? null,
      ledgerReleaseOps: await M.opCount(`SESSION_RELEASE:${S.id}`),
      ptAvail: await M.net(A.txnId, "PT", "AVAILABLE"),
    };
    show("K1 after kill", state1);
    assert.equal(state1.killedRequestStatus, 0, "the client never got an answer");
    assert.deepEqual(state1.session, ["COMPLETED", true], "the decision is committed WHOLE: the claim did not roll back with the dead connection");
    assert.equal(state1.usedSessions, 3, "... together with its count");
    assert.equal(state1.settlementRow, "PROCESSING", "... and its durable intent (claimed by the dead instance)");
    assert.equal(state1.ledgerReleaseOps, 1, "payment-service had already released the money");
    assert.equal(state1.releasedToPt, 900_000, "the bookkeeping waits for the settle (applied with it, once)");

    // the client retries on another instance: the session is already COMPLETED - nothing is counted again
    const retry = await M.call(0, "POST", `/sessions/${S.id}/confirm`, A.clientToken);
    assert.equal(retry.status, 400, "nothing left to confirm");
    assert.equal((await M.contractRow(A.id)).usedSessions, 3, "usedSessions is NOT counted a second time");

    // the sweep of another instance settles the (stale) row: ledger replay, bookkeeping once
    await sleep(3200);
    const at = Date.now() + 300;
    await Promise.all([0, 1].map((i) => M.job(i, "settlement", at)));
    const c2 = await M.contractRow(A.id);
    assert.equal((await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } })).status, "SETTLED");
    assert.equal(Number(c2.releasedToPt), 1_350_000, "bookkeeping applied exactly once by two sweeps");
    assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), 1, "the ledger is idempotent: still one release");

    const end = await endReq(1, A);
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const after = await aNet(A);
    show("K1 after ending", { actual: pick(after), correct: { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 } });
    assert.deepEqual(pick(after), { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 }, "priced on the 3 sessions really delivered");
  });
});

test("K1b [REGRESSION G1] (no human retry needed): after the kill the auto-confirm sweep on another instance finds nothing to count again; the settlement sweep settles the row once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 3 * DAY), { clientConfirmDeadline: new Date(Date.now() - HOUR), ptNotes: "ok" });
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("release-session"), afterPayment: () => victim.kill(), dropResponse: true });
    // the victim's own sweep (not an HTTP call) is the one that gets killed
    const victimJob = M.job(2, "autoConfirm", 0).catch(() => null);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    await victimJob;
    assert.equal((await M.contractRow(A.id)).usedSessions, 3);
    const res = await M.job(0, "autoConfirm", 0);
    const c = await M.contractRow(A.id);
    show("K1b", { sweepOnI0: res.result, usedSessions: c.usedSessions });
    assert.equal(res.result.confirmed, 0, "the session was already decided: nothing to confirm again");
    assert.equal(c.usedSessions, 3, "3 sessions delivered, counter 3");
    await sleep(3200);
    await M.job(0, "settlement", Date.now() + 200);
    assert.equal(Number((await M.contractRow(A.id)).releasedToPt), 1_350_000);
    assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), 1);
  });
});

test("K1c [REGRESSION G1c] after the kill the session is already COMPLETED (counted and paid, atomically): a dispute is refused, and the contract can be ended normally - it is never stuck by a 'cannot fund shortfall'", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 3 * DAY), { clientConfirmDeadline: new Date(Date.now() + 3 * DAY), ptNotes: "ok" });
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("release-session"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = M.call(2, "POST", `/sessions/${S.id}/confirm`, A.clientToken);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    await first;
    const disp = await M.call(0, "POST", `/sessions/${S.id}/dispute`, A.clientToken, { reason: "không đúng" });
    assert.ok(disp.status === 400 || disp.status === 409, `the session was already confirmed: dispute refused (${disp.status})`);
    const c = await M.contractRow(A.id);
    assert.equal(c.usedSessions, 3);
    assert.equal((await M.sessionRow(S.id)).status, "COMPLETED");
    // the client ends the contract: the outstanding release is settled first (replay), then the ending is priced on the truth
    const end1 = await endReq(1, A);
    assert.equal(end1.status, 200, JSON.stringify(end1.body));
    const c2 = await M.contractRow(A.id);
    assert.deepEqual([c2.status, c2.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.doesNotMatch(M.paymentLog(), /cannot fund [0-9]+ shortfall/);
    const after = await aNet(A);
    assert.deepEqual(pick(after), { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 });
    assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
  });
});

// ── K2: SIGKILL during a late cancel (autocommit steps): the sweep heals the money ────────────────────────────────

test("K2 SIGKILL during a client late cancel's release call: statuses are committed, the stale-PROCESSING settlement row is retried by another instance's sweep, ledger paid once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("release-session"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = M.call(2, "PATCH", `/sessions/${S.id}/cancel`, A.clientToken, { reason: "bận" });
    await fired;
    await until(async () => !victim.alive(), 10_000);
    await first;
    const lockKey = await M.hashOf(A.id);
    await until(async () => !(await M.advisoryLocks()).includes(lockKey), 30_000, 50);
    const s1 = await M.sessionRow(S.id);
    const c1 = await M.contractRow(A.id);
    const row1 = await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
    show("K2 after kill", { session: [s1.status, s1.sessionDeducted], used: c1.usedSessions, releasedToPt: Number(c1.releasedToPt), row: row1.status, ledgerOps: await M.opCount(`SESSION_RELEASE:${S.id}`) });
    assert.deepEqual([s1.status, s1.sessionDeducted, c1.usedSessions, row1.status], ["CANCELLED", true, 3, "PROCESSING"]);
    assert.equal(Number(c1.releasedToPt), 900_000, "user-service bookkeeping never saw the answer");
    // the sweep ignores a FRESH processing row ...
    const early = await M.job(0, "settlement", 0);
    assert.equal(early.result.scanned, 0, "fresh PROCESSING row is left alone (could be a live caller)");
    await sleep(3200);
    // ... and retries it once it is stale; two instances at once
    const at = Date.now() + 300;
    const res = await Promise.all([0, 1].map((i) => M.job(i, "settlement", at)));
    const row2 = await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
    const c2 = await M.contractRow(A.id);
    show("K2 after sweeps", { results: res.map((r) => r.result), row: row2.status, releasedToPt: Number(c2.releasedToPt), ledgerOps: await M.opCount(`SESSION_RELEASE:${S.id}`) });
    assert.equal(row2.status, "SETTLED");
    assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), 1);
    assert.equal(Number(c2.releasedToPt), 1_350_000, "bookkeeping healed, counted once (the lock serialised the two sweeps)");
    assert.equal(await M.net(A.txnId, "PT", "AVAILABLE"), 1_350_000);
  });
});

// ── K3: SIGKILL between the status CAS and the next step (no durable intent) ──────────────────────────────────────

test("K3 [REGRESSION G2] SIGKILL while a late cancel is between its status write and its charge: the status, the charge and the intent are ONE transaction - the kill rolls ALL of it back, nothing half-done; the retry on another instance does the whole thing once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // a "slow" row lock on the contract row freezes the charge (UPDATE contracts) AFTER the session CAS ran inside the decision's transaction
    const holder = M.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM contracts WHERE id = '${A.id}' FOR UPDATE`);
        await gate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await sleep(300);
    const first = M.call(2, "PATCH", `/sessions/${S.id}/cancel`, A.clientToken, { reason: "bận" });
    // the instance's charge is now parked on the contract row lock: that is the instant between the two statements
    await until(async () => {
      const blocked = (await M.prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%contracts%' AND datname = current_database()")) as any[];
      return blocked[0].n > 0;
    }, 10_000, 20);
    const frozen = await M.sessionRow(S.id);
    assert.deepEqual([frozen.status, frozen.sessionDeducted], ["CONFIRMED", false], "the status write is NOT visible: it belongs to the still-open decision transaction");
    await M.instances[2].kill();
    const dropped = await dropBlockedBackends("contracts");
    assert.ok(dropped >= 1, "the parked UPDATE was aborted together with its dead client");
    release();
    await holder;
    await first;
    await sleep(500);
    const s1 = await M.sessionRow(S.id);
    const c1 = await M.contractRow(A.id);
    const state = { session: [s1.status, s1.sessionDeducted], used: c1.usedSessions, releaseOps: await M.opCount(`SESSION_RELEASE:${S.id}`), settlementRows: await M.prisma.sessionSettlement.count({ where: { sessionId: S.id } }) };
    show("K3 after kill", state);
    assert.deepEqual(state.session, ["CONFIRMED", false], "rolled back whole");
    assert.equal(state.used, 2, "no charge");
    assert.equal(state.releaseOps, 0);
    assert.equal(state.settlementRows, 0, "no half-written intent either");

    const retry = await M.call(0, "PATCH", `/sessions/${S.id}/cancel`, A.clientToken, { reason: "lại" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const s2 = await M.sessionRow(S.id);
    assert.deepEqual([s2.status, s2.sessionDeducted], ["CANCELLED", true]);
    assert.equal((await M.contractRow(A.id)).usedSessions, 3);
    assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), 1);

    const end = await endReq(1, A);
    assert.equal(end.status, 200, JSON.stringify(end.body));
    const after = await aNet(A);
    show("K3 after ending", { actual: pick(after), correct: { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 } });
    assert.deepEqual(pick(after), { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 }, "priced with the charge and the PT's payout");
    assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
  });
});

test("K3b [REGRESSION G2] (no-show): SIGKILL while the PT no-show's intent row is being written: the NO_SHOW status and the intent are ONE transaction, so the kill rolls both back; the retry compensates the client once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = M.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("LOCK TABLE session_settlements IN SHARE ROW EXCLUSIVE MODE");
        await gate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await sleep(300);
    const first = M.call(2, "PATCH", `/sessions/${S.id}/no-show`, A.ptToken, { noShowBy: "PT" });
    await until(async () => ((await M.prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%session_settlements%' AND datname = current_database()")) as any[])[0].n > 0, 10_000, 20);
    assert.equal((await M.sessionRow(S.id)).status, "CONFIRMED", "the NO_SHOW status is not visible while its intent is still being written");
    await M.instances[2].kill();
    assert.ok((await dropBlockedBackends("session_settlements")) >= 1);
    release();
    await holder;
    await first;
    await sleep(500);
    assert.equal((await M.sessionRow(S.id)).status, "CONFIRMED", "rolled back with the dead connection");
    assert.equal(await M.prisma.sessionSettlement.count({ where: { sessionId: S.id } }), 0, "no half-written intent");
    assert.equal(await M.opCount(`PT_NO_SHOW:${S.id}`), 0, "no compensation in the ledger");
    const retry = await M.call(1, "PATCH", `/sessions/${S.id}/no-show`, A.ptToken, { noShowBy: "PT" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(await M.opCount(`PT_NO_SHOW:${S.id}`), 1, "the client is compensated exactly once");
    const end = await endReq(1, A);
    assert.equal(end.status, 200);
    const after = await aNet(A);
    show("K3b after ending", { actual: pick(after), correct: { client: 3_650_000, ptAvail: 1_215_000, platAvail: 135_000 } });
    assert.deepEqual(pick(after), { client: 3_650_000, ptAvail: 1_215_000, platAvail: 135_000 }, "the compensation is in the final figures");
  });
});

// ── K4: SIGKILL during the ENDING's payment call ──────────────────────────────────────────────────────────────────

test("K4 SIGKILL during the ending's terminate call: ledger already terminated, contract still ACTIVE; a retry on another instance completes it with the same money, other contracts untouched", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, B } = await setUp();
    const open = await M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * DAY));
    const bEntries = await M.entries(B.txnId);
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("/contracts/terminate"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = endReq(2, A);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    await first;
    const lockKey = await M.hashOf(A.id);
    const t0 = Date.now();
    await until(async () => !(await M.advisoryLocks()).includes(lockKey), 30_000, 50);
    const c1 = await M.contractRow(A.id);
    const mid = await aNet(A);
    show("K4 after kill", { lockFreedAfterMs: Date.now() - t0, status: c1.status, ledgerTerminateOps: await M.opCount(`CONTRACT_TERMINATE:${A.id}`), ledger: pick(mid) });
    assert.equal(c1.status, "ACTIVE", "the status write never happened");
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1, "but the money did");
    const intent = await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${A.id}` } });
    assert.deepEqual([intent.kind, intent.reason], ["CONTRACT_TERMINATION", "CLIENT_CANCELLED"], "the accepted ending was RECORDED before the money call (D58)");
    assert.notEqual(intent.status, "SETTLED");
    const retry = await endReq(0, A);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const c2 = await M.contractRow(A.id);
    const after = await aNet(A);
    show("K4 after retry", { status: c2.status, reason: c2.terminationReason, ledger: pick(after), openSession: (await M.sessionRow(open.id)).status });
    assert.deepEqual([c2.status, c2.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.deepEqual(pick(after), { client: 3_600_000, ptAvail: 1_260_000, platAvail: 140_000 });
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    assert.deepEqual(await M.entries(B.txnId), bEntries);
  });
});

test("K4b [REGRESSION D59] SIGKILL mid-terminate, then the EXPIRY sweep of another instance finishes the RECORDED ending (no human retry, no re-labelling as EXPIRED)", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    await M.prisma.contract.update({ where: { id: A.id }, data: { endDate: new Date(Date.now() - HOUR) } });
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("/contracts/terminate"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = endReq(2, A);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    await first;
    const res = await M.job(0, "expiry", 0);
    const c = await M.contractRow(A.id);
    const after = await aNet(A);
    show("K4b", { sweep: res.result, status: c.status, reason: c.terminationReason, ledger: pick(after) });
    // The ledger was terminated under the CLIENT_CANCELLED terms (90% refund) by the killed attempt; the ending was RECORDED with that
    // reason, so the expiry sweep (asking for EXPIRED) completes THAT ending: status and ledger agree (D59: the reason is never recomputed).
    assert.deepEqual([c.status, c.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
    assert.deepEqual(pick(after), { client: 3_600_000, ptAvail: 1_260_000, platAvail: 140_000 }, "money and status both follow the FIRST (recorded) reason");
  });
});

// ── K5: a lock held by "another instance" - lock_timeout and process-wide holder cap ───────────────────────────────

test("K5 [KNOWN-ISSUE G5 - configuration] a foreign holder keeps contract locks: waiters answer 503 CONTRACT_LOCK_BUSY after CONTRACT_LOCK_WAIT_MS and change nothing; with CONTRACT_LOCK_MAX_HOLDERS=2 an UNRELATED contract on the same instance waits behind them, another instance does not", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const pt2 = await M.makePt();
    const X1 = await M.paidContract(pt, { packageName: "X1" });
    const X2 = await M.paidContract(pt, { packageName: "X2" });
    const Y = await M.paidContract(pt2, { packageName: "Y" });
    const yS = await M.addSession(Y, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    const yS2 = await M.addSession(Y, "CONFIRMED", new Date(Date.now() + 4 * HOUR));
    // instance 1: small cap and a short wait
    await M.instances[1].kill();
    await M.instances[1].start({ CONTRACT_LOCK_WAIT_MS: "2500", CONTRACT_LOCK_MAX_HOLDERS: "2" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = M.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${X1.id}')), pg_advisory_xact_lock(hashtext('${X2.id}'))`);
        await gate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await sleep(300);
    const t0 = Date.now();
    const x1 = endReq(1, X1);
    const x2 = endReq(1, X2);
    await sleep(500);
    const yOn1 = M.call(1, "PATCH", `/sessions/${yS.id}/cancel`, Y.clientToken, { reason: "bận" });
    const yOn0 = M.call(0, "PATCH", `/sessions/${yS2.id}/cancel`, Y.clientToken, { reason: "bận" });
    const [r1, r2, ry1, ry0] = await Promise.all([x1, x2, yOn1, yOn0]);
    show("K5", { x1: [r1.status, r1.body?.code, r1.ms], x2: [r2.status, r2.body?.code, r2.ms], yOnSameInstance: [ry1.status, ry1.ms], yOnOtherInstance: [ry0.status, ry0.ms], totalMs: Date.now() - t0 });
    assert.equal(r1.status, 503);
    assert.equal(r1.body?.code, "CONTRACT_LOCK_BUSY");
    assert.equal(r2.status, 503);
    assert.ok(r1.ms >= 2300 && r1.ms < 6000, `waited about the configured 2.5 s, got ${r1.ms}`);
    assert.equal(ry0.status, 200);
    assert.ok(ry0.ms < 1500, `another instance is unaffected: ${ry0.ms} ms`);
    assert.equal(ry1.status, 200);
    show("K5 head-of-line", { sameInstanceMs: ry1.ms, otherInstanceMs: ry0.ms });
    assert.ok(ry1.ms > 1500, `DEFECT G5 (availability): an uncontended contract on the SAME instance waited ${ry1.ms} ms behind the two foreign-held ones`);
    for (const X of [X1, X2]) {
      assert.equal((await M.contractRow(X.id)).status, "ACTIVE", "a refused ending changed nothing");
      assert.equal(await M.opCount(`CONTRACT_TERMINATE:${X.id}`), 0);
    }
    release();
    await holder;
    const ok = await endReq(1, X1);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    await M.instances[1].kill();
    await M.instances[1].start();
  });
});

// ── K6: the settlement retry paths on several instances ──────────────────────────────────────────────────────────

test("K6a FAILED PT no-show compensations (payment-service was down) retried by the sweep on 3 instances at once, with an ending racing them: each paid once, counters exact", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, B } = await setUp();
    const s: string[] = [];
    for (let i = 0; i < 3; i++) s.push((await M.addSession(A, "CONFIRMED", new Date(Date.now() - (2 + i) * HOUR))).id);
    const bEntries = await M.entries(B.txnId);
    await M.stopPayment();
    for (let i = 0; i < 3; i++) {
      const r = await M.call(i, "PATCH", `/sessions/${s[i]}/no-show`, A.ptToken, { noShowBy: "PT" });
      assert.equal(r.status, 200, "the admission stands; money recorded for retry");
    }
    const rows = await M.prisma.sessionSettlement.findMany({ where: { contractId: A.id } });
    assert.equal(rows.filter((r) => r.status === "FAILED").length, 3);
    await M.startPayment();
    const at = Date.now() + 500;
    const [j0, j1, j2, end] = await Promise.all([
      M.job(0, "settlement", at),
      M.job(1, "settlement", at),
      M.job(2, "settlement", at),
      (async () => (await sleep(at - Date.now() + 20), endReq(0, A)))(),
    ]);
    const c = await M.contractRow(A.id);
    const after = await aNet(A);
    show("K6a", { sweeps: [j0.result, j1.result, j2.result], ending: end.status, compensated: c.compensatedSessions, status: c.status, ledger: pick(after) });
    assert.equal(end.status === 200 || end.status === 409, true, JSON.stringify(end.body));
    for (const id of s) assert.ok((await M.opCount(`PT_NO_SHOW:${id}`)) <= 1);
    const paid = (await Promise.all(s.map((id) => M.opCount(`PT_NO_SHOW:${id}`)))).reduce((a, b) => a + b, 0);
    if (end.status === 200) {
      assert.equal(c.status, "CANCELLED");
      assert.equal(paid, 3, "the ending settled all three compensations before pricing the refund");
    }
    assert.equal(c.compensatedSessions, paid, "counter == compensations really paid");
    assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
    assert.deepEqual(await M.entries(B.txnId), bEntries);
  });
});

test("K6b FAILED unresolved-session resolution retried by the sweep on 3 instances at once (this dispatch is NOT under the contract lock): ledger once; releasedToPt bookkeeping", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A } = await setUp();
    const S = await M.addSession(A, "DISPUTED", new Date(Date.now() - 3 * DAY), { disputeReason: "x", disputedAt: new Date() });
    const end = await endReq(0, A);
    assert.equal(end.status, 200, JSON.stringify(end.body));
    await M.stopPayment();
    const rule = await M.call(1, "POST", `/admin/sessions/${S.id}/resolve`, M.tokenFor("admin-k6b", "ADMIN"), { resolution: "COMPLETED", note: "đã diễn ra" });
    show("K6b ruling while payment down", { status: rule.status });
    await M.startPayment();
    const row = await M.prisma.sessionSettlement.findUnique({ where: { idempotencyKey: `UNRESOLVED_SESSION:${S.id}` } });
    assert.equal(row?.status, "FAILED");
    const before = await M.contractRow(A.id);
    const at = Date.now() + 400;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "settlement", at)));
    const after = await M.contractRow(A.id);
    const ledger = await aNet(A);
    show("K6b", { sweeps: res.map((r) => r.result), releasedToPtBefore: Number(before.releasedToPt), releasedToPtAfter: Number(after.releasedToPt), ptAvailLedger: ledger.ptAvail, ledgerOps: await M.opCount(`UNRESOLVED_SESSION:${S.id}%`) });
    assert.equal(await M.opCount(`UNRESOLVED_SESSION:${S.id}%`), 1, "payment-service moved the held value once");
    assert.equal((await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `UNRESOLVED_SESSION:${S.id}` } })).status, "SETTLED");
    assert.equal(ledger.ptPend, 0);
    assert.equal(ledger.client + ledger.ptAvail + ledger.platAvail, 5_000_000);
    const increments = (Number(after.releasedToPt) - Number(before.releasedToPt)) / 450_000;
    show("K6b increments of releasedToPt (1 = correct)", { increments });
    assert.equal(increments, 1, "apply-once: three sweeps at once added the held session's release to releasedToPt exactly once (it used to add it 2-3 times, audit G3)");
  });
});

// ── K7: the real server.ts with its real setInterval timers on two instances ──────────────────────────────────────

test("K7 the REAL server.ts timers on two instances at once (short intervals): auto-confirm, expiry, settlement, room-close, payment-deadline - consistent outcome, one money operation each", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const A = await M.paidContract(pt, { packageName: "timers" });
    const exp: PaidContract[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await M.paidContract(pt, { packageName: `exp${i}` });
      exp.push(c);
    }
    const conf: string[] = [];
    for (let i = 0; i < 4; i++) conf.push((await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - (3 + i) * DAY), { clientConfirmDeadline: new Date(Date.now() + 2500) })).id);
    const rooms: string[] = [];
    for (let i = 0; i < 3; i++) rooms.push((await M.addSession(A, "CONFIRMED", new Date(Date.now() - (2 + i) * HOUR), { sessionMode: "ONLINE", roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000) })).id);
    const timers = {
      MI_REAL_SERVER: "1",
      SESSION_AUTO_CONFIRM_INTERVAL_MS: "700",
      CONTRACT_EXPIRY_SWEEP_INTERVAL_MS: "700",
      CONTRACT_PAYMENT_DEADLINE_SWEEP_INTERVAL_MS: "700",
      CONTRACT_HOLDBACK_SWEEP_INTERVAL_MS: "700",
      SESSION_SETTLEMENT_SWEEP_INTERVAL_MS: "700",
      ROOM_CLOSE_RESOLUTION_INTERVAL_MS: "700",
      RESCHEDULE_EXPIRY_INTERVAL_MS: "700",
    };
    for (const e of exp) await M.prisma.contract.update({ where: { id: e.id }, data: { endDate: new Date(Date.now() - HOUR) } });
    // swap instances 0 and 1 for the real server.ts (their timers start with the process)
    for (const i of [0, 1]) {
      await M.instances[i].kill();
      await M.instances[i].start(timers);
    }
    await sleep(9000);
    const rows = await Promise.all(conf.map((id) => M.sessionRow(id)));
    const roomRows = await Promise.all(rooms.map((id) => M.sessionRow(id)));
    const c = await M.contractRow(A.id);
    show("K7", { confirmed: rows.filter((r) => r.status === "COMPLETED").length, rooms: roomRows.map((r) => r.status), used: c.usedSessions, compensated: c.compensatedSessions });
    assert.ok(rows.every((r) => r.status === "COMPLETED" && r.sessionDeducted));
    assert.ok(roomRows.every((r) => r.status === "NO_SHOW"));
    assert.equal(c.usedSessions, 4);
    assert.equal(c.compensatedSessions, 3);
    for (const id of conf) assert.equal(await M.opCount(`SESSION_RELEASE:${id}`), 1);
    for (const id of rooms) assert.equal(await M.opCount(`PT_NO_SHOW:${id}`), 1);
    for (const e of exp) {
      assert.equal((await M.contractRow(e.id)).status, "EXPIRED");
      assert.equal(await M.opCount(`CONTRACT_TERMINATE:${e.id}`), 1);
    }
    for (const i of [0, 1]) {
      await M.instances[i].kill();
      await M.instances[i].start();
    }
  });
});

// ── K8: the per-PT lock across instances: a suspension vs the client leaving ───────────────────────────────────────

test("K8 PT lock across instances: admin suspension (I1) vs the client's cancel (I2) at six skews - the termination reason always matches the restriction record and the ledger", { skip, timeout: 400_000 }, async () => {
  const offs = [[0, 150], [150, 0], [0, 0], [0, 300], [300, 0], [60, 0]];
  const seen: Array<Record<string, unknown>> = [];
  for (const [i, off] of offs.entries()) {
    await scenario(async () => {
      const { pt, A, B } = await setUp();
      const S = await M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * DAY));
      const bEntries = await M.entries(B.txnId);
      const at = Date.now() + 400;
      const admin = M.tokenFor("admin-k8", "ADMIN");
      const [sus, cancel] = await Promise.all([
        (async () => (await sleep(at + off[0] - Date.now()), M.call(1, "POST", `/admin/pts/${pt}/suspend`, admin, { category: "CONDUCT_REVIEW", reason: "đang xem xét" })))(),
        (async () => (await sleep(at + off[1] - Date.now()), M.call(2, "POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" })))(),
      ]);
      const c = await M.contractRow(A.id);
      const restriction = await M.prisma.ptRestriction.findFirst({ where: { ptUserId: pt, endedAt: null, scope: "ACCOUNT" } });
      const after = await aNet(A);
      const s = await M.sessionRow(S.id);
      show("K8", { i, suspend: sus.status, cancel: cancel.status, reason: c.terminationReason, status: c.status, restrictionStartedBeforeEnd: restriction && c.terminatedAt ? restriction.startedAt <= c.terminatedAt : null, session: s.status, ledger: pick(after) });
      assert.equal(sus.status, 200, JSON.stringify(sus.body));
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      assert.ok(restriction, "the suspension exists");
      if (c.terminationReason === "CLIENT_EXIT_DUE_TO_PT_RESTRICTION") {
        assert.deepEqual(pick(after), { client: 4_000_000, ptAvail: 900_000, platAvail: 100_000 }, "100% of the unused value, no fee");
      } else {
        assert.equal(c.terminationReason, "CLIENT_CANCELLED");
        assert.deepEqual(pick(after), { client: 3_600_000, ptAvail: 1_260_000, platAvail: 140_000 }, "ordinary cancellation, 90%");
      }
      assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
      assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
      assert.deepEqual(await M.entries(B.txnId), bEntries, "B (paused, not ended) untouched");
      seen.push({ i, reason: c.terminationReason, sessionStatus: s.status });
    });
  }
  show("K8 summary", { seen });
});

// ── K9: head-of-line coupling through the PT lock ────────────────────────────────────────────────────────────────

test("K9 [REGRESSION G6] availability: while A's contract lock is held by somebody else for ~8 s, the PT's report on A is refused 503 CONTRACT_LOCK_BUSY after the bounded wait (not a 500 'Transaction already closed' after 8 s), and the PT's report on the UNRELATED contract B is no longer failed - it is delayed at most by that bounded wait", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, B } = await setUp();
    const SA = await M.addSession(A, "CONFIRMED", new Date(Date.now() - 3 * HOUR));
    const SB = await M.addSession(B, "CONFIRMED", new Date(Date.now() - 3 * HOUR));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = M.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${A.id}'))`);
        await gate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await sleep(500);
    const t0 = Date.now();
    const reportA = M.call(2, "PATCH", `/sessions/${SA.id}/complete`, A.ptToken, { ptNotes: "x" });
    await sleep(300);
    const reportB = M.call(0, "PATCH", `/sessions/${SB.id}/complete`, B.ptToken, { ptNotes: "x" });
    await sleep(2000);
    setTimeout(() => release(), 6000); // a foreign holder lets go after ~8 s in total
    const [ra, rb] = await Promise.all([reportA, reportB]);
    show("K9", { reportOnA: [ra.status, ra.ms, ra.body?.code ?? ra.body?.error ?? null], reportOnB: [rb.status, rb.ms, rb.body?.error ?? null], totalMs: Date.now() - t0 });
    await holder;
    const sb = await M.sessionRow(SB.id);
    assert.equal(ra.status, 503, "A: refused cleanly");
    assert.equal(ra.body?.code, "CONTRACT_LOCK_BUSY");
    assert.ok(ra.ms < 5000, `A's refusal comes after the bounded wait (${ra.ms} ms), not after Prisma's 5 s transaction timeout`);
    assert.equal(rb.status, 200, `B (no contention of its own) is not failed: ${JSON.stringify(rb.body)}`);
    assert.ok(rb.ms < 6000, `B waited only for the PT lock A's request held during its bounded wait (${rb.ms} ms)`);
    assert.equal(sb.status, "PENDING_CLIENT_CONFIRMATION");
  });
});

