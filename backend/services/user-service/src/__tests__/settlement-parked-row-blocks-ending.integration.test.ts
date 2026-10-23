/**
 * D64-B rule check, FLIPPED by FH-3c (D65-B). Owner's rule B: block only the unsafe step, do not lock the whole contract for a small
 * separable obligation, keep it pending and explain it. Before FH-3c ONE parked session-level row refused the whole ending
 * ([KNOWN-GAP D64-B]); now (SETTLING_D65B on, the default) the ending looks the step up on the ledger: performed -> its stored result is
 * applied; not performed -> the session's value is HELD and the certain unused part refunds immediately. The flag-off behaviour (the old
 * blocking) and every "cannot tell" case are pinned in settlement-d65b-fh3c.integration.test.ts; the real-ledger money is in
 * cross-service-money-fh6-fh3c.e2e.test.ts.
 *
 * Money example (5.000.000 / 10 sessions = 500.000 per session; split PT 450.000 / platform 50.000): 4 sessions delivered, the
 * release of session 4 failed 12 times and is parked. The client cancels: the 6 unused sessions (3.000.000 - 2.700.000 for a
 * client-initiated cancel) are refundable and have NOTHING to do with session 4's 450.000.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database; payment-service = TEST FIXTURE (records every call).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { terminateContractMoney, releaseSessionMoney } from "../services/contract-payout.service";
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
      status: "NEEDS_HUMAN",
      attempts: 12,
      lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12); last error: payment-service 503",
    },
  });
  return { pt, contract, s3, s4, row };
}

test("[REGRESSION D64-B] ONE parked 450.000 release no longer blocks the ending (client cancel, PT cancel, expiry, mutual, admin ban): the certain part refunds now, session 4's value is HELD", { skip }, async () => {
  for (const reason of ["CLIENT_CANCELLED", "PT_CANCELLED", "EXPIRED", "MUTUAL", "PT_BANNED"] as const) {
    const { pt, contract, row } = await parkedContract();
    const s = stubs({ refund: "3000000.00", owed: "3000000.00", paid: "3000000.00", unpaid: "0.00" });
    try {
      const result = await terminateContractMoney(contract.id, reason, { cancelledBy: contract.clientUserId });
      assert.equal(result.refund, "3000000.00", `${reason}: the unused sessions are refunded immediately`);
      assert.deepEqual(s.payments.map((p) => p.method), ["terminate"]);
      assert.equal(s.payments[0].body.unresolvedSessions, 1, "session 4's value (500.000) is held, not paid out and not refunded");
      assert.equal(s.payments[0].body.usedSessions, 3);
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, reason === "EXPIRED" ? "EXPIRED" : "CANCELLED");
      assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "UNCONFIRMED", "surfaced for the admin path, never retried by code");
    } finally {
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  }
});

test("the block is scoped to the ENDING: the other session's money step on the same contract still runs (this part of rule B already holds)", { skip }, async () => {
  const { pt, contract, s3, row } = await parkedContract();
  const s = stubs();
  try {
    await releaseSessionMoney(contract.id, s3.id);
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"], "session 3's release was sent although session 4's row is parked");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${s3.id}` } })).status, "SETTLED");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "NEEDS_HUMAN", "and the parked row was not touched");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("[REGRESSION D64-B/key poisoning] a row whose premise is void is closed and frees the session's key: when the session IS delivered later, its release is PAID", { skip }, async () => {
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
    assert.match((await prisma.sessionSettlement.findFirstOrThrow({ where: { contractId: contract.id } })).lastError ?? "", /^ENDED_UNSETTLED:PREMISE_VOID:.*not delivered/);
    // the client now confirms: the session really is delivered
    await prisma.session.update({ where: { id: waiting.id }, data: { status: "COMPLETED", sessionDeducted: true } });
    await releaseSessionMoney(contract.id, waiting.id);
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"], "the legitimate release IS sent");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${waiting.id}` } })).status, "SETTLED");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
