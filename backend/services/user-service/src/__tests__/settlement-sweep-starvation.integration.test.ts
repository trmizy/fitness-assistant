/**
 * D57-5-1 / D62-E (Phase 0 unit 5) - the settlement sweep must not be STARVED by rows it can never change.
 *
 * It used to take the 50 OLDEST non-SETTLED rows and, for a row whose contract no longer exists (or has no payment), return
 * without touching it - so the row was selected again on every tick and, from 50 of them on, no younger row was ever retried.
 * The dev database holds 62 of these (32 PT_NO_SHOW_COMPENSATION + 30 SESSION_RELEASE, every contract deleted by the dev wipes).
 * The earlier version of this file PINNED that defect ("D57-5-1 KNOWN DEFECT"); these are the REGRESSION tests of the fix:
 *   1. rows are scanned least-recently-tried first and PAGED, so 55 unprocessable rows no longer hide a processable one;
 *   2. D64-A / D65: with SETTLEMENT_SWEEP_PARK_ORPHANS="true" (explicit) the orphans are PARKED - never deleted, never SETTLED - with an
 *      explicit terminal reason (ENDED_UNSETTLED:CONTRACT_MISSING) and leave the queue; by DEFAULT (variable unset - owner decision D65)
 *      or "false" they are only skipped and left byte-identical, and the live row behind them is still retried;
 *   3. a row that keeps failing has an attempt cap + back-off: it is parked (NEEDS_RECONCILIATION, history kept), stops being
 *      retried, and STILL keeps an ending refused (its effect on the ledger is unknown).
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database (real sweep, real SQL, real contract / session rows);
 * ONLY payment-service is stubbed at the client boundary. Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_crash_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/settlement-sweep-starvation.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { terminateContractMoney } from "../services/contract-payout.service";
import { addSession, makeContract, makePt, patch, skip } from "./pt-restriction.test-helpers";

const ORPHANS = 55; // > the sweep's batch size (50)
const MANY_ORPHANS = 65;
const RELEASE = { released: { pt: "450000", gym: "0", platform: "50000" } };

async function seed(orphans = ORPHANS) {
  await prisma.sessionSettlement.deleteMany({});
  const old = new Date("2026-08-01T00:00:00Z");
  await prisma.sessionSettlement.createMany({
    data: Array.from({ length: orphans }, (_, i) => ({
      id: randomUUID(),
      kind: "SESSION_RELEASE" as const,
      idempotencyKey: `SESSION_RELEASE:orphan-${i}-${randomUUID()}`,
      contractId: randomUUID(), // a contract that does not exist
      sessionId: randomUUID(),
      status: "FAILED" as const,
      attempts: 1,
      lastError: "payment-service unreachable",
      createdAt: new Date(old.getTime() + i * 1000),
    })),
  });
  // make the orphans the LEAST recently tried: they sit at the front of the queue
  await prisma.$executeRaw`UPDATE session_settlements SET updated_at = ${old}`;
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const live = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: contract.id, sessionId: session.id, status: "FAILED", attempts: 1, lastError: "payment-service unreachable" },
  });
  return { pt, contract, session, live };
}

async function cleanup(pt: string, contractId: string) {
  await prisma.sessionSettlement.deleteMany({});
  await prisma.session.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.userProfile.deleteMany({ where: { userId: pt } });
}

test("D57-5-1 regression: with 55 orphan FAILED rows older than a live FAILED row, the sweep still retries the live one - and (D64-A, parking explicitly enabled) parks the orphans with their reason, deleting nothing", { skip }, async () => {
  const { pt, contract, live } = await seed();
  const keepFlag = process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = "true";
  const calls: string[] = [];
  const restore = patch(paymentClient, "releaseSession", async () => {
    calls.push("releaseSession");
    return RELEASE;
  });
  try {
    const first = await runSettlementSweep();
    assert.equal(calls.length, 1, "the live row's payment call was made although 55 older, unprocessable rows sit in front of it");
    assert.equal(first.retried, 1);
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.id } });
    assert.equal(row.status, "SETTLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).releasedToPt.toString(), "450000");

    // D64-A: every orphan is parked with the explicit terminal reason; none deleted, none SETTLED, none paid.
    const orphans = await prisma.sessionSettlement.findMany({ where: { contractId: { not: contract.id } } });
    assert.equal(orphans.length, ORPHANS, "no row deleted");
    assert.ok(
      orphans.every((o) => o.status === "FAILED" && o.attempts === 1 && /^ENDED_UNSETTLED:CONTRACT_MISSING contract .* no longer exists.*previous error: payment-service unreachable$/.test(o.lastError ?? "")),
      "every orphan is FAILED (not SETTLED), keeps its attempts, carries the reason AND its previous error",
    );
    // and the next tick is not blocked either, and does nothing
    await runSettlementSweep();
    assert.equal(calls.length, 1, "the SETTLED row is not run again, no orphan produced a payment call");
  } finally {
    if (keepFlag === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = keepFlag;
    restore();
    await cleanup(pt, contract.id);
  }
});

test("D64-A opt-out: with SETTLEMENT_SWEEP_PARK_ORPHANS=false the orphans are only skipped - exactly as they were, still not deleted - and the live row is still retried", { skip }, async () => {
  const { pt, contract, live } = await seed();
  const restore = patch(paymentClient, "releaseSession", async () => RELEASE);
  const keepFlag = process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = "false";
  try {
    await runSettlementSweep();
    await runSettlementSweep();
    const orphans = await prisma.sessionSettlement.findMany({ where: { contractId: { not: contract.id } } });
    assert.equal(orphans.length, ORPHANS, "history kept: no row deleted");
    assert.ok(orphans.every((o) => o.status === "FAILED" && o.attempts === 1 && o.lastError === "payment-service unreachable"), "existing data is not modified");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.id } })).status, "SETTLED");
  } finally {
    if (keepFlag === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = keepFlag;
    restore();
    await cleanup(pt, contract.id);
  }
});

test("D65 DEFAULT OFF: with SETTLEMENT_SWEEP_PARK_ORPHANS UNSET, 65 older orphan rows do not starve the live row, are left byte-identical (nothing parked / deleted / SETTLED), and make zero payment-service calls", { skip }, async () => {
  const keepFlag = process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  const { pt, contract, live } = await seed(MANY_ORPHANS);
  const calls: string[] = [];
  const restore = patch(paymentClient, "releaseSession", async () => {
    calls.push("releaseSession");
    return RELEASE;
  });
  try {
    const snap = async () =>
      (await prisma.sessionSettlement.findMany({ where: { contractId: { not: contract.id } }, orderBy: { id: "asc" } })).map((o) => JSON.stringify({ ...o, updatedAt: o.updatedAt.toISOString(), createdAt: o.createdAt.toISOString() }));
    const before = await snap();
    assert.equal(before.length, MANY_ORPHANS);

    const first = await runSettlementSweep();
    assert.equal(first.retried, 1, "the live row behind 65 older orphans was retried");
    assert.deepEqual(calls, ["releaseSession"], "exactly one payment call: the live row's; none for any orphan");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.id } })).status, "SETTLED");

    await runSettlementSweep();
    await runSettlementSweep();
    assert.equal(calls.length, 1, "later ticks make no payment call either");
    assert.deepEqual(await snap(), before, "every orphan row is byte-identical (status, attempts, last_error, updated_at, settled_at): not parked, not deleted, not SETTLED");
  } finally {
    if (keepFlag === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = keepFlag;
    restore();
    await cleanup(pt, contract.id);
  }
});

test("attempt cap + back-off: a step that keeps failing is parked (NEEDS_RECONCILIATION, history kept), is retried no more, and still keeps an ending refused", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: contract.id, sessionId: session.id, status: "FAILED", attempts: 0, lastError: "first failure" },
  });
  let calls = 0;
  const restore = patch(paymentClient, "releaseSession", async () => {
    calls++;
    throw new Error("payment-service 503");
  });
  const restoreTerminate = patch(paymentClient, "terminate", async () => {
    throw new Error("the ending must be refused before any money call");
  });
  process.env.SETTLEMENT_MAX_ATTEMPTS = "3";
  process.env.SETTLEMENT_BACKOFF_BASE_MS = "3600000"; // beyond the free attempts the wait is an hour: only the cap is under test
  try {
    for (let i = 0; i < 6; i++) await runSettlementSweep();
    assert.equal(calls, 3, "retried exactly up to the cap, then never again");
    const row = await prisma.sessionSettlement.findFirstOrThrow({ where: { contractId: contract.id } });
    assert.equal(row.status, "NEEDS_HUMAN");
    assert.equal(row.attempts, 3);
    assert.match(row.lastError ?? "", /^NEEDS_RECONCILIATION: 3 failed attempts \(cap 3\); last error: payment-service 503/);

    // The ledger effect of the parked step is UNKNOWN: an ending of the contract is refused until a human settles it.
    await assert.rejects(
      () => terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }),
      (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING",
    );
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, "ACTIVE");
  } finally {
    delete process.env.SETTLEMENT_MAX_ATTEMPTS;
    delete process.env.SETTLEMENT_BACKOFF_BASE_MS;
    restore();
    restoreTerminate();
    await cleanup(pt, contract.id);
  }
});
