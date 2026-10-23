/**
 * FH-3a + FH-3b (Financial Hardening) - BACKEND INTEGRATION against the isolated *_test database (real SQL and transactions);
 * payment-service is replaced at the paymentClient boundary (TEST FIXTURE). The same crash against a REAL payment-service and a
 * REAL killed user-service process is in cross-service-money-restart-recovery.e2e.test.ts (R6 / R7 / R8).
 *
 * FH-3b (DQ-8) - natural completion used to write the contract status COMPLETED first and the CONTRACT_TERMINATION intent
 * afterwards: a crash between the two left a COMPLETED contract with no intent, the settlement sweep never saw it and the PT / gym
 * were never settled. Now both are ONE transaction:
 *   1. the status and the intent commit together; with payment-service down the contract is COMPLETED, the intent exists, and the
 *      sweep completes it later (exactly one confirmed ending, SETTLED);
 *   2. if the intent cannot be written, the status is NOT written (rollback) - there is no half state;
 *   3. a contract with no money behind it records no intent; a contract that ended another way meanwhile is not completed;
 *   4. COMPLETED is not "money settled": the detection query lists an ended + paid contract with no SETTLED termination row
 *      (with or without an intent) and stops listing it only when the row is SETTLED.
 * FH-3a - the parked states are real statuses: park / markFailed / claim / the attention list work on status, the request snapshot
 * is written with the intent, and the migration's backfill maps the old prefixes to the new statuses.
 *
 * Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_fhd_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/contract-natural-completion-atomic-intent.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { contractService } from "../services/contract.service";
import { completeContractRecordingEnding } from "../services/contract-payout.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const KEY = (contractId: string) => `CONTRACT_TERMINATE:${contractId}`;
const termRow = (contractId: string) => prisma.sessionSettlement.findUnique({ where: { idempotencyKey: KEY(contractId) } });

/** A paid contract whose sessions are all used up: the next checkAndCompleteContract completes it. */
async function exhausted(pt: string, over: Record<string, unknown> = {}) {
  return makeContract(pt, { usedSessions: 10, ...over });
}

test("FH-3b 1. natural completion writes COMPLETED + the CONTRACT_TERMINATION intent in one commit; payment-service down -> COMPLETED with an unconfirmed intent, and the sweep settles it exactly once", { skip }, async () => {
  const pt = await makePt();
  const c = await exhausted(pt);
  const s = stubs();
  let down = true;
  let confirmed = 0;
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    s.payments.push({ method: "terminate", body });
    if (down) throw new Error("payment-service down");
    confirmed++;
    return { reason: body.reason, refund: "0.00" };
  });
  try {
    await contractService.checkAndCompleteContract(c.id);

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "COMPLETED");
    assert.ok(after.completedAt, "completedAt is written with the status");
    const row = await termRow(c.id);
    assert.ok(row, "the intent is durable together with the COMPLETED status");
    assert.deepEqual([row.kind, row.reason, row.sessionId], ["CONTRACT_TERMINATION", "COMPLETED", null]);
    assert.notEqual(row.status, "SETTLED", "COMPLETED is not 'money settled'");
    assert.equal(confirmed, 0);
    const snap = row.requestSnapshot as any;
    assert.equal(snap.v, 1);
    assert.equal(snap.idempotencyKey, KEY(c.id));
    assert.equal(snap.reason, "COMPLETED");
    assert.equal(snap.facts.usedSessions, 10);
    assert.equal(snap.facts.totalSessions, 10);
    assert.equal(snap.facts.paymentTransactionId, c.paymentTransactionId);

    // detection: ended + paid + no SETTLED termination row -> listed (the intent exists, so the sweep is carrying it)
    const gap = (await sessionSettlementRepository.findEndedPaidWithoutSettledTermination()).find((g) => g.contractId === c.id);
    assert.ok(gap, "listed while the money is not confirmed");
    assert.deepEqual([gap.hasIntent, gap.contractStatus, gap.settlementStatus], [true, "COMPLETED", "FAILED"]);

    // payment-service is back: the SWEEP alone completes it
    down = false;
    await runSettlementSweep();
    const settled = await termRow(c.id);
    assert.equal(settled!.status, "SETTLED");
    assert.equal(confirmed, 1, "exactly one confirmed ending");
    const done = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([done.status, done.terminationReason], ["COMPLETED", "COMPLETED"]);
    assert.ok(done.terminatedAt);
    assert.equal(
      (await sessionSettlementRepository.findEndedPaidWithoutSettledTermination()).some((g) => g.contractId === c.id),
      false,
      "no longer listed once the termination row is SETTLED",
    );

    // a second sweep / a repeated completion changes nothing
    await runSettlementSweep();
    await contractService.checkAndCompleteContract(c.id);
    assert.equal(confirmed, 1);
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: c.id } }), 1);
  } finally {
    restoreTerminate();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("FH-3b 2. atomic: if the intent cannot be written the status is NOT written (rollback) - there is no COMPLETED contract without an intent", { skip }, async () => {
  const pt = await makePt();
  const c = await exhausted(pt);
  const s = stubs();
  const restore = patch(sessionSettlementRepository, "upsertPending", async () => {
    throw new Error("database blinked while recording the intent");
  });
  try {
    await assert.rejects(completeContractRecordingEnding(c.id, { completedAt: new Date() }), /database blinked/);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.status, after.completedAt], ["ACTIVE", null], "the status write was rolled back with the failed intent");
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: c.id } }), 0);
  } finally {
    restore();
    // the retry (e.g. the next session action, or the expiry sweep) then completes it normally
    await contractService.checkAndCompleteContract(c.id);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "COMPLETED");
    assert.ok(await termRow(c.id));
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("FH-3b 3. a contract with no money behind it records no intent; a contract that ended another way meanwhile is not completed and records nothing", { skip }, async () => {
  const pt = await makePt();
  const unpaid = await exhausted(pt, { paymentTransactionId: null });
  const cancelled = await exhausted(pt, { status: "CANCELLED" });
  const s = stubs();
  try {
    const done = await completeContractRecordingEnding(unpaid.id, { completedAt: new Date() });
    assert.equal(done?.status, "COMPLETED");
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: unpaid.id } }), 0, "nothing was ever paid: nothing to settle");
    assert.equal(await completeContractRecordingEnding(cancelled.id, { completedAt: new Date() }), null);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: cancelled.id } });
    assert.deepEqual([after.status, after.completedAt], ["CANCELLED", null], "the other ending owns the contract");
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: cancelled.id } }), 0);
  } finally {
    s.restore();
    await cleanup([pt], [unpaid.id, cancelled.id]);
  }
});

test("FH-3b 4. detection query: lists ended + paid contracts without a SETTLED termination row (legacy 'no intent' window and 'not yet confirmed'), never settled / unpaid / running ones", { skip }, async () => {
  const pt = await makePt();
  const legacyNoIntent = await makeContract(pt, { status: "COMPLETED", usedSessions: 10 }); // the pre-FH-3b crash window: COMPLETED, no row
  const unconfirmed = await makeContract(pt, { status: "COMPLETED", usedSessions: 10 });
  const confirmedOk = await makeContract(pt, { status: "COMPLETED", usedSessions: 10 });
  const unpaid = await makeContract(pt, { status: "COMPLETED", usedSessions: 10, paymentTransactionId: null });
  const running = await makeContract(pt, { status: "ACTIVE", usedSessions: 3 });
  const mk = (contractId: string, status: "PENDING" | "SETTLED") =>
    prisma.sessionSettlement.create({
      data: { kind: "CONTRACT_TERMINATION", idempotencyKey: KEY(contractId), contractId, reason: "COMPLETED", status, ...(status === "SETTLED" ? { settledAt: new Date() } : {}) },
    });
  await mk(unconfirmed.id, "PENDING");
  await mk(confirmedOk.id, "SETTLED");
  const ids = [legacyNoIntent.id, unconfirmed.id, confirmedOk.id, unpaid.id, running.id];
  try {
    const mine = (await sessionSettlementRepository.findEndedPaidWithoutSettledTermination({ limit: 5000 })).filter((g) => ids.includes(g.contractId));
    assert.deepEqual(
      mine.map((g) => [g.contractId, g.hasIntent, g.settlementStatus]).sort(),
      [
        [legacyNoIntent.id, false, null],
        [unconfirmed.id, true, "PENDING"],
      ].sort(),
    );
    const fresh = (await sessionSettlementRepository.findEndedPaidWithoutSettledTermination({ minAgeMs: 3_600_000, limit: 5000 })).filter((g) => ids.includes(g.contractId));
    assert.equal(fresh.length, 0, "an ending written a moment ago is simply in flight, not a gap");
  } finally {
    await cleanup([pt], ids);
  }
});

test("FH-3a 5. real statuses: park() sets NEEDS_HUMAN / CONFLICT (+ conflict_note) and keeps the prefix text; ENDED_UNSETTLED stays FAILED + label; a parked row is never claimed (even by a live caller) and a late failure never un-parks it", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const intent = (n: string) => ({ kind: "SESSION_RELEASE" as const, idempotencyKey: `SESSION_RELEASE:${n}-${randomUUID()}`, sessionId: randomUUID(), contractId: c.id, reason: null });
  try {
    const a = await sessionSettlementRepository.upsertPending(intent("a"));
    const b = await sessionSettlementRepository.upsertPending(intent("b"));
    const o = await sessionSettlementRepository.upsertPending(intent("o"));
    await sessionSettlementRepository.park(a.id, "NEEDS_RECONCILIATION:", "cap reached");
    await sessionSettlementRepository.park(b.id, "CONFLICT:", "ledger says another reason");
    await sessionSettlementRepository.park(o.id, "ENDED_UNSETTLED:CONTRACT_MISSING", "gone");
    const [ra, rb, ro] = await Promise.all([a, b, o].map((r) => prisma.sessionSettlement.findUniqueOrThrow({ where: { id: r.id } })));
    assert.deepEqual([ra.status, ra.lastError], ["NEEDS_HUMAN", "NEEDS_RECONCILIATION: cap reached"]);
    assert.deepEqual([rb.status, rb.lastError, rb.conflictNote], ["CONFLICT", "CONFLICT: ledger says another reason", "CONFLICT: ledger says another reason"]);
    assert.deepEqual([ro.status, ro.lastError], ["FAILED", "ENDED_UNSETTLED:CONTRACT_MISSING gone"]);

    const stale = { staleBefore: new Date(Date.now() + 1000) };
    for (const r of [a, b, o]) {
      assert.equal(await sessionSettlementRepository.claim(r.id, stale), null, "a sweep never claims a parked row");
      assert.equal(await sessionSettlementRepository.claim(r.id, { ...stale, takeover: true }), null, "nor does a live caller taking over");
    }
    // the retry queue excludes all three
    const retry = (await sessionSettlementRepository.findRetryable(500, 0)).map((r) => r.id);
    assert.ok(![a.id, b.id, o.id].some((id) => retry.includes(id)));
    // a late failure from a runner that raced the park does not un-park a handed-over row
    await sessionSettlementRepository.markFailed(a.id, "late failure");
    await sessionSettlementRepository.markFailed(b.id, "late failure");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: a.id } })).status, "NEEDS_HUMAN");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: b.id } })).status, "CONFLICT");
    // all of them still count as unsettled (they keep an ending refused), the orphan label aside
    const unsettled = (await sessionSettlementRepository.findUnsettledSessionMoney(c.id)).map((r) => r.id);
    assert.ok(unsettled.includes(a.id) && unsettled.includes(b.id) && !unsettled.includes(o.id));
    // attention: CONFLICT first, NEEDS_HUMAN next, orphan label never
    const attention = (await sessionSettlementRepository.findNeedingAttention(12, 50)).filter((r) => r.contractId === c.id).map((r) => r.id);
    assert.deepEqual(attention, [b.id, a.id]);
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("FH-3a 6. the request snapshot is written when the intent is recorded (create only: a retry never rewrites it)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const input = { kind: "SESSION_RELEASE" as const, idempotencyKey: `SESSION_RELEASE:snap-${randomUUID()}`, sessionId: randomUUID(), contractId: c.id, reason: null };
  try {
    const first = await sessionSettlementRepository.upsertPending({ ...input, snapshotFacts: { usedSessions: 3 } });
    const snap = first.requestSnapshot as any;
    assert.deepEqual([snap.v, snap.kind, snap.idempotencyKey, snap.sessionId, snap.contractId, snap.facts], [1, "SESSION_RELEASE", input.idempotencyKey, input.sessionId, c.id, { usedSessions: 3 }]);
    const again = await sessionSettlementRepository.upsertPending({ ...input, snapshotFacts: { usedSessions: 99 } });
    assert.deepEqual(again.requestSnapshot, first.requestSnapshot, "an existing intent keeps its original snapshot");
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("FH-3a 7. the migration's backfill maps NEEDS_RECONCILIATION: -> NEEDS_HUMAN and CONFLICT: -> CONFLICT (+ note); ENDED_UNSETTLED and everything else is left alone", { skip }, async () => {
  const migDir = path.resolve(__dirname, "../../prisma/migrations/20261019100100_session_settlement_columns_and_backfill/migration.sql");
  const sql = fs.readFileSync(migDir, "utf8");
  const updates = sql.slice(sql.indexOf("UPDATE")).split(";").map((x) => x.trim()).filter((x) => x.startsWith("UPDATE"));
  assert.equal(updates.length, 2);
  const pt = await makePt();
  const c = await makeContract(pt);
  const row = (n: string, status: "FAILED" | "PENDING", lastError: string | null) =>
    prisma.sessionSettlement.create({
      data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:bf-${n}-${randomUUID()}`, contractId: c.id, sessionId: randomUUID(), status, lastError },
    });
  try {
    const nr = await row("nr", "FAILED", "NEEDS_RECONCILIATION: cap");
    const cf = await row("cf", "FAILED", "CONFLICT: y");
    const orphan = await row("or", "FAILED", "ENDED_UNSETTLED:NO_PAYMENT z");
    const plain = await row("pl", "FAILED", "boom NEEDS_RECONCILIATION: only mentioned later");
    const pending = await row("pe", "PENDING", null);
    for (const u of updates) await prisma.$executeRawUnsafe(u);
    const get = (id: string) => prisma.sessionSettlement.findUniqueOrThrow({ where: { id } });
    assert.equal((await get(nr.id)).status, "NEEDS_HUMAN");
    const cfAfter = await get(cf.id);
    assert.deepEqual([cfAfter.status, cfAfter.conflictNote], ["CONFLICT", "CONFLICT: y"]);
    assert.equal((await get(orphan.id)).status, "FAILED");
    assert.equal((await get(plain.id)).status, "FAILED");
    assert.equal((await get(pending.id)).status, "PENDING");
    for (const u of updates) await prisma.$executeRawUnsafe(u); // idempotent
    assert.equal((await get(nr.id)).status, "NEEDS_HUMAN");
  } finally {
    await cleanup([pt], [c.id]);
  }
});
