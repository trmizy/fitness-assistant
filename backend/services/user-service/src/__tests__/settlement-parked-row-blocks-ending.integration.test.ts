/**
 * D64-B rule check - CHARACTERISATION of what Phase-0 code does when ONE session-level settlement row of a contract is parked
 * (NEEDS_RECONCILIATION). The owner's rule B: block only the unsafe step, do not lock the whole contract for a small separable
 * obligation, keep it pending and explain it. Current code does the opposite for the ENDING, so these tests are named
 * [KNOWN-GAP D64-B]: they pin the present behaviour (so nobody mistakes it for the rule) and must be FLIPPED by the Phase 1
 * SETTLING redesign. Nothing here is a product change.
 *
 * Money example (5.000.000 / 10 sessions = 500.000 per session; split PT 450.000 / platform 50.000): 4 sessions delivered, the
 * release of session 4 failed 12 times and is parked. The client now cancels: the 6 unused sessions (3.000.000) are refundable and
 * have NOTHING to do with session 4's 450.000 - yet the whole ending is refused until a human resolves the 450.000 row, and
 * there is no admin tool for that yet (D64-D).
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database; payment-service = TEST FIXTURE (records every call).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { settleContractTermination, terminateContractMoney, releaseSessionMoney } from "../services/contract-payout.service";
import { addSession, cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";

async function parkedContract() {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 4 });
  const s4 = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const s3 = await addSession(contract, "COMPLETED", new Date(Date.now() - 2 * 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: {
      kind: "SESSION_RELEASE",
      idempotencyKey: `SESSION_RELEASE:${s4.id}`,
      contractId: contract.id,
      sessionId: s4.id,
      status: "FAILED",
      attempts: 12,
      lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12); last error: payment-service 503",
    },
  });
  return { pt, contract, s3, s4, row };
}

test("[KNOWN-GAP D64-B] ONE parked 450.000 release blocks the WHOLE ending of the contract for every reason (client cancel, PT cancel, expiry, admin ban): 409 SESSION_SETTLEMENT_PENDING, no payment call, contract stays ACTIVE", { skip }, async () => {
  const { pt, contract, row } = await parkedContract();
  const s = stubs();
  try {
    for (const reason of ["CLIENT_CANCELLED", "PT_CANCELLED", "EXPIRED", "MUTUAL", "PT_BANNED"] as const) {
      await assert.rejects(
        () => terminateContractMoney(contract.id, reason, { cancelledBy: contract.clientUserId }),
        (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING",
        `${reason} is refused`,
      );
    }
    await assert.rejects(() => settleContractTermination(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(s.payments.length, 0, "no money moved - not even the 3.000.000 of unused sessions that has nothing to do with the parked row");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, "ACTIVE");
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: contract.id, kind: "CONTRACT_TERMINATION" } }), 0, "not even an ending intent is recorded (so the client sees no 'ending' state either)");
    const parked = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(parked.status, "FAILED", "the row is still there and still parked - it never unblocks by itself");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("the block is scoped to the ENDING: the other session's money step on the same contract still runs (this part of rule B already holds)", { skip }, async () => {
  const { pt, contract, s3, row } = await parkedContract();
  const s = stubs();
  try {
    await releaseSessionMoney(contract.id, s3.id);
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"], "session 3's release was sent although session 4's row is parked");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${s3.id}` } })).status, "SETTLED");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "FAILED", "and the parked row was not touched");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("[KNOWN-GAP D64-B/key poisoning] a row parked because its session was NOT yet delivered keeps the session's idempotency key: when the session IS delivered later, its release is silently PARKED instead of paid", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 0 });
  const waiting = await addSession(contract, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 86_400_000), { clientConfirmDeadline: new Date(Date.now() + 86_400_000) });
  await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${waiting.id}`, contractId: contract.id, sessionId: waiting.id, status: "PENDING" },
  });
  const s = stubs();
  try {
    const { runSettlementSweep } = await import("../services/session-settlement-sweep.service");
    await runSettlementSweep();
    assert.match((await prisma.sessionSettlement.findFirstOrThrow({ where: { contractId: contract.id } })).lastError ?? "", /^NEEDS_RECONCILIATION:.*not delivered/);
    // the client now confirms: the session really is delivered
    await prisma.session.update({ where: { id: waiting.id }, data: { status: "COMPLETED", sessionDeducted: true } });
    await releaseSessionMoney(contract.id, waiting.id);
    assert.equal(s.payments.length, 0, "the legitimate release is NOT sent: the key is held by the parked row (a human must unpark it)");
    assert.equal((await prisma.sessionSettlement.findFirstOrThrow({ where: { contractId: contract.id } })).status, "FAILED");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
