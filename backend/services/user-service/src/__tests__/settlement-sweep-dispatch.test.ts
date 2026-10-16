import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { contractRepository } from "../repositories/contract.repository";
import { prisma } from "../repositories/profile.repository";
import { SessionSettlementKind, SessionSettlementStatus } from "../generated/prisma";
import { DAY, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

/**
 * Money-flow redesign plan item 1.6 - the sweep worker that retries whatever `settleTracked` left PENDING / FAILED /
 * stale-PROCESSING. Proves the dispatch routes each `SessionSettlementKind` to the right underlying financial operation, that
 * a successful retry marks the row SETTLED and applies its bookkeeping exactly once, and that one row's failure does not stop
 * the rest of the batch.
 *
 * Phase 0 / D58: these tests used to fake the repositories ("findRetryable" returned made-up rows for contracts and sessions that
 * did not exist). The sweep now checks a row's PREMISE (the session's state) before it moves money, so the fixtures are REAL
 * rows. Evidence label: BACKEND INTEGRATION against the isolated *_test database (real sweep, real claim / apply-once SQL, real
 * settleTracked lifecycle); payment-service is replaced at the paymentClient boundary (TEST FIXTURE).
 */

async function clearRows() {
  await prisma.sessionSettlement.deleteMany({});
}

async function backdate(rowId: string, ms: number) {
  await prisma.$executeRaw`UPDATE session_settlements SET updated_at = ${new Date(Date.now() - ms)} WHERE id = ${rowId}`;
}

test("retries a FAILED PT_NO_SHOW_COMPENSATION row via compensateNoShowMoney: one payment call, SETTLED, compensatedSessions counted once", { skip }, async () => {
  await clearRows();
  const pt = await makePt();
  const c = await makeContract(pt);
  const session = await addSession(c, "NO_SHOW", new Date(Date.now() - DAY), { ptAtFault: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey: `PT_NO_SHOW:${session.id}`, contractId: c.id, sessionId: session.id, status: SessionSettlementStatus.FAILED, attempts: 1, lastError: "payment-service unreachable" },
  });
  const s = stubs();
  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 1, retried: 1 });
    assert.deepEqual(s.payments.map((p) => p.method), ["noShow"]);
    assert.equal(s.payments[0].body.idempotencyKey, `PT_NO_SHOW:${session.id}`);
    const after = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "SETTLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).compensatedSessions, 1);
    // a second tick finds nothing to do - the compensation is not counted twice
    assert.deepEqual(await runSettlementSweep(), { scanned: 0, retried: 0 });
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).compensatedSessions, 1);
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("retries a FAILED SESSION_RELEASE row via releaseSessionMoney: SETTLED, releasedTo* counted once", { skip }, async () => {
  await clearRows();
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(c, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: c.id, sessionId: session.id, status: SessionSettlementStatus.FAILED, attempts: 1, lastError: "payment-service unreachable" },
  });
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"]);
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.releasedToPt.toString(), "450000");
    assert.equal(after.releasedToPlatform.toString(), "50000");
    await runSettlementSweep();
    assert.equal(s.payments.length, 1, "a SETTLED row is not run again");
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("retries a stale PROCESSING CONTRACT_TERMINATION row with the RECORDED reason and marks it SETTLED on success, writing the contract's final status", { skip }, async () => {
  await clearRows();
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 10 });
  const row = await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.CONTRACT_TERMINATION, idempotencyKey: `CONTRACT_TERMINATE:${c.id}`, contractId: c.id, sessionId: null, reason: "COMPLETED", status: SessionSettlementStatus.PROCESSING, attempts: 1 },
  });
  await backdate(row.id, 60 * 60 * 1000);
  const s = stubs();
  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 1, retried: 1 });
    assert.deepEqual(s.payments.map((p) => p.method), ["terminate"]);
    assert.equal(s.payments[0].body.reason, "COMPLETED");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED", "a successful retry must mark the row SETTLED, or it would be retried forever");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.status, after.terminationReason], ["COMPLETED", "COMPLETED"]);
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("an unexpected error fetching one row's contract does not stop the rest of the batch", { skip }, async () => {
  // A genuine DB blip reading a contract DOES propagate out of the row's dispatch - this is what the sweep's own per-row
  // try/catch exists to isolate.
  await clearRows();
  const pt = await makePt();
  const good = await makeContract(pt, { usedSessions: 1 });
  const goodSession = await addSession(good, "NO_SHOW", new Date(Date.now() - DAY), { ptAtFault: true });
  const badContractId = randomUUID();
  const bad = await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey: `PT_NO_SHOW:${randomUUID()}`, contractId: badContractId, sessionId: randomUUID(), status: SessionSettlementStatus.FAILED, attempts: 1, lastError: "x" },
  });
  await backdate(bad.id, 2 * 60 * 60 * 1000); // older: attempted first
  await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey: `PT_NO_SHOW:${goodSession.id}`, contractId: good.id, sessionId: goodSession.id, status: SessionSettlementStatus.FAILED, attempts: 1, lastError: "x" },
  });
  const s = stubs();
  const attempted: string[] = [];
  const original = contractRepository.findById;
  const restore = patch(contractRepository, "findById", async (id: string, db?: unknown) => {
    attempted.push(id);
    if (id === badContractId) throw new Error("transient DB error");
    return (original as any)(id, db);
  });
  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 2, retried: 1 }, "the bad row does not count as retried, but the sweep continues past it");
    assert.ok(attempted.includes(badContractId) && attempted.includes(good.id), "both rows are attempted despite the first one's DB error");
    assert.deepEqual(s.payments.map((p) => p.method), ["noShow"]);
  } finally {
    restore();
    s.restore();
    await cleanup([pt], [good.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
});

test("the sweep never pays a row whose session the system does not consider delivered (D57 a5): the row is PARKED with the reason, no payment call, the history stays", { skip }, async () => {
  await clearRows();
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  // The decision (confirm) never committed: the session is still waiting for the client, but an intent row exists.
  const waiting = await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), { clientConfirmDeadline: new Date(Date.now() + DAY) });
  const row = await prisma.sessionSettlement.create({
    data: { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: `SESSION_RELEASE:${waiting.id}`, contractId: c.id, sessionId: waiting.id, status: SessionSettlementStatus.PENDING },
  });
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.equal(s.payments.filter((p) => p.method === "releaseSession").length, 0, "the PT is not paid for a session that is not delivered");
    const after = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "FAILED");
    assert.match(after.lastError ?? "", /^NEEDS_RECONCILIATION:.*not delivered/);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: waiting.id } })).status, "PENDING_CLIENT_CONFIRMATION", "the session is untouched");
    // parked rows are not picked up again
    assert.deepEqual(await runSettlementSweep(), { scanned: 0, retried: 0 });
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});
