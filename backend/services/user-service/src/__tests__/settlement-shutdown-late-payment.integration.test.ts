/**
 * D64-C timeout compatibility, case 2 - SIGTERM arrives while the sweep waits on a payment-service that answers AFTER the
 * shutdown deadline (real: '40 s' > 30 s grace; here 1/10 scale: 4 s > 3 s). See settlement-shutdown-slow-payment.integration.test.ts
 * for case 1 and for the labels (BACKEND INTEGRATION, payment-service = TEST FIXTURE). In production the container would be
 * SIGKILLed at the deadline; here the original call is simply left running inside the test process while "the next instance"
 * acts, which is the observable equivalent:
 *   - the shutdown reports NOT drained (exit code 1) with the row left PROCESSING (claimed, attempt consumed, not SETTLED);
 *   - the next instance CANNOT claim it until it is stale (SESSION_SETTLEMENT_STALE_PROCESSING_MS, default 2 min) - a recovery
 *     delay, not a double payment;
 *   - once stale, the next instance replays the SAME idempotency key; when the dead instance's call finally returns, its
 *     apply-once flip loses: the ledger moved once and releasedToPt counts 450000 once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { runSessionMoneyRow } from "../services/contract-payout.service";
import { gracefulShutdown, trackJob } from "../lifecycle";
import { addSession, cleanup, makeContract, makePt, patch, skip } from "./pt-restriction.test-helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RELEASE = { released: { pt: "450000", gym: "0", platform: "50000" } };

test("shutdown + payment-service answering AFTER the deadline ('40 s' > '30 s'): not drained (exit 1), row left PROCESSING, next instance waits for stale then replays by key - ledger and bookkeeping applied once", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: contract.id, sessionId: session.id, status: "FAILED", attempts: 1, lastError: "payment-service unreachable" },
  });
  const ledger = new Map<string, number>();
  let calls = 0;
  const restore = patch(paymentClient, "releaseSession", async (body: any) => {
    const nth = ++calls;
    ledger.set(body.idempotencyKey, 1); // idempotent: the replay with the same key moves nothing more
    if (nth === 1) await sleep(4000); // the slow first call: answers after the shutdown deadline
    return RELEASE;
  });
  let exitCode: number | undefined;
  try {
    const sweep = trackJob(runSettlementSweep());
    const t0 = Date.now();
    while (calls < 1 && Date.now() - t0 < 5000) await sleep(20);
    assert.equal(calls, 1);

    const result = await gracefulShutdown("SIGTERM", { stopJobs: () => {}, disconnect: async () => {}, graceMs: 3000, exit: (c) => (exitCode = c) });
    assert.equal(result.drained, false);
    assert.equal(result.pendingJobs, 1);
    assert.equal(exitCode, 1, "the deadline cut the drain off");

    // The process is gone in production; the row is exactly what a crash would have left.
    const midway = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([midway.status, midway.attempts], ["PROCESSING", 2], "claimed, attempt consumed, NOT settled");

    // 1. The next instance cannot take a fresh PROCESSING row (stale threshold default 2 min): no double claim, but a recovery delay.
    const claimedNow = await sessionSettlementRepository.claim(row.id, { staleBefore: new Date(Date.now() - 2 * 60 * 1000), takeover: false });
    assert.equal(claimedNow, null, "a sweep cannot start a row another runner holds (not stale yet)");

    // 2. Once stale, the next instance replays by the same key (what its sweep does: takeover=false).
    process.env.SESSION_SETTLEMENT_STALE_PROCESSING_MS = "300";
    await sleep(400);
    await runSessionMoneyRow({ id: row.id, kind: "SESSION_RELEASE", contractId: contract.id, sessionId: session.id, reason: null }, { takeover: false });
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).releasedToPt.toString(), "450000");

    // 3. The dead instance's call finally returns: its flip loses, nothing is applied twice.
    await sweep;
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).releasedToPt.toString(), "450000", "bookkeeping applied exactly once");
    assert.equal(ledger.get(`SESSION_RELEASE:${session.id}`), 1, "one ledger movement for the key");
    assert.equal(calls, 2, "the same key was sent twice (original + replay)");
  } finally {
    delete process.env.SESSION_SETTLEMENT_STALE_PROCESSING_MS;
    restore();
    await cleanup([pt], [contract.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
});
