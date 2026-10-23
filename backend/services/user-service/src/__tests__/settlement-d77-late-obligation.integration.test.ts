/**
 * D77 follow-up (owner decision, final) - a late-arrival compensation payment-service NEVER performed is not lost when the contract
 * ends: it is recorded as an OPEN obligation to the client under the original `PT_LATE_ARRIVAL:<sessionId>` key, and the settlement row
 * turns terminal pointing at it. BACKEND INTEGRATION against the isolated *_test user database (real rows, real ending / sweep code);
 * payment-service is a TEST FIXTURE at the client boundary (records the bodies, answers like the real record-only operation).
 * The REAL ledger (one obligation however many endings, FH-8 resolve/waive, the admin report) is in
 * cross-service-money-d77-obligation.e2e.test.ts and payment-service's fh-d77-late-obligation.integration.test.ts.
 *
 * Run ALONE (it clears session_settlements):
 *   DATABASE_URL=".../gymcoach_user_fhg_test?schema=public" FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test --test-concurrency=1 \
 *     src/__tests__/settlement-d77-late-obligation.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { settleContractTermination, terminateContractMoney } from "../services/contract-payout.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { ptLateArrivalClientMessage, readPtFaultMoney } from "../services/pt-fault-session-wording";
import { addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const DAY = 24 * 3600 * 1000;
const axiosErr = (status: number, code: string) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, error: { code, message: `${code} (fixture)` } } } });
const reload = (id: string) => prisma.sessionSettlement.findUniqueOrThrow({ where: { id } });
const lateKey = (sessionId: string) => `PT_LATE_ARRIVAL:${sessionId}`;

/** 5,000,000 / 10 sessions, one delivered session (the late one) whose compensation row is in `status`. */
async function lateRow(status: string, over: { contract?: Record<string, unknown>; attempts?: number } = {}) {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1, ...(over.contract ?? {}) });
  const late = await addSession(contract, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: {
      kind: "PT_LATE_ARRIVAL_COMPENSATION",
      idempotencyKey: lateKey(late.id),
      contractId: contract.id,
      sessionId: late.id,
      status: status as any,
      attempts: over.attempts ?? 12,
      lastError: status === "NEEDS_HUMAN" ? "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" : status === "FAILED" ? "payment-service 503" : null,
    },
  });
  return { pt, contract, late, row };
}
const recorded = (s: ReturnType<typeof stubs>) => s.payments.filter((p) => p.method === "recordLateArrivalObligation");

test("the ending records the obligation BEFORE it is recorded itself: payment-service unreachable at that moment -> 409, the row is untouched, no ending; once it is back the ending goes through and records it once", { skip }, async () => {
  const { pt, contract, late, row } = await lateRow("NEEDS_HUMAN");
  const s = stubs();
  let down = true;
  const undo = patch(paymentClient, "recordLateArrivalObligation", async (body: any) => {
    s.payments.push({ method: "recordLateArrivalObligation", body });
    if (down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    return { compensation: "0.00", charged: { pt: "0.00", gym: "0.00", platform: "0.00" }, shortfall: "250000.00", owed: "250000.00", paid: "0.00", unpaid: "250000.00", obligationId: "obl-1", recordedOnly: true };
  });
  try {
    await assert.rejects(terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal((await reload(row.id)).status, "NEEDS_HUMAN", "nothing recorded locally while the obligation is not durable");
    assert.equal(s.payments.filter((p) => p.method === "terminate").length, 0, "no ending, no refund");
    assert.equal(await prisma.sessionSettlement.count({ where: { kind: "CONTRACT_TERMINATION", contractId: contract.id } }), 0);
    down = false;
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED");
    assert.equal((after.result as any).obligationId, "obl-1");
    assert.equal(s.payments.filter((p) => p.method === "terminate").length, 1);
    assert.equal(late.id.length > 0, true);
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("two endings racing over the same late row: the row is SETTLED once with one stored answer; a replayed ending asks payment-service for nothing more", { skip }, async () => {
  const { pt, contract, row } = await lateRow("NEEDS_HUMAN");
  const s = stubs();
  try {
    const results = await Promise.allSettled([
      settleContractTermination(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }),
      settleContractTermination(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }),
    ]);
    assert.ok(results.some((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => r.status)));
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED");
    assert.equal((after.result as any).recordedOnly, true);
    assert.ok(recorded(s).length >= 1 && recorded(s).every((p) => p.body.idempotencyKey === `PT_LATE_ARRIVAL:${row.sessionId}`), "every call carries the ORIGINAL key (payment-service makes it one obligation)");
    const before = recorded(s).length;
    await settleContractTermination(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    assert.equal(recorded(s).length, before, "a replay records nothing");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).compensatedSessions, 0);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("the ledger had performed the compensation after all (no recordedOnly): its real result is applied, the row is SETTLED, no obligation is claimed", { skip }, async () => {
  const { pt, contract, row } = await lateRow("NEEDS_HUMAN");
  const s = stubs();
  const real = { compensation: "250000.00", charged: { pt: "225000.00", gym: "0.00", platform: "25000.00" }, shortfall: "0.00", owed: "250000.00", paid: "250000.00", unpaid: "0.00" };
  const undo = patch(paymentClient, "recordLateArrivalObligation", async () => real);
  try {
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED");
    assert.deepEqual(after.result, real);
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("an answer that cannot be trusted (an obligation owed but none recorded) is parked NEEDS_HUMAN and keeps the ending refused; a 409 key conflict parks CONFLICT", { skip }, async () => {
  for (const mode of ["INVALID", "CONFLICT"] as const) {
    const { pt, contract, row } = await lateRow("NEEDS_HUMAN");
    const s = stubs();
    const undo = patch(paymentClient, "recordLateArrivalObligation", async () => {
      if (mode === "CONFLICT") throw axiosErr(409, "IDEMPOTENCY_KEY_CONFLICT");
      return { compensation: "0.00", shortfall: "250000.00", owed: "250000.00", paid: "0.00", unpaid: "250000.00", recordedOnly: true };
    });
    try {
      await assert.rejects(terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
      assert.equal((await reload(row.id)).status, mode === "INVALID" ? "NEEDS_HUMAN" : "CONFLICT");
      assert.match((await reload(row.id)).lastError ?? "", mode === "INVALID" ? /not valid/ : /IDEMPOTENCY_KEY_CONFLICT/);
      assert.equal(s.payments.filter((p) => p.method === "terminate").length, 0);
    } finally {
      undo();
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  }
});

test("a row whose ledger record EXISTS is applied from it and records nothing new; SETTLING_D65B=false keeps the old blocking (nothing recorded)", { skip }, async () => {
  const { pt, contract, late, row } = await lateRow("NEEDS_HUMAN");
  const s = stubs();
  s.ledger.ops.set(lateKey(late.id), {
    key: lateKey(late.id), kind: "LATE_ARRIVAL", transactionId: contract.paymentTransactionId,
    result: { compensation: "250000.00", charged: { pt: "225000.00", gym: "0.00", platform: "25000.00" }, shortfall: "0.00", owed: "250000.00", paid: "250000.00", unpaid: "0.00" },
    createdAt: new Date().toISOString(), fingerprinted: true,
  });
  try {
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    assert.equal((await reload(row.id)).status, "SETTLED");
    assert.equal(recorded(s).length, 0, "the ledger already had it: nothing to record");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
  const off = await lateRow("NEEDS_HUMAN");
  const s2 = stubs();
  const prev = process.env.SETTLING_D65B;
  process.env.SETTLING_D65B = "false";
  try {
    await assert.rejects(terminateContractMoney(off.contract.id, "CLIENT_CANCELLED", { cancelledBy: off.contract.clientUserId }), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(recorded(s2).length, 0);
    assert.equal((await reload(off.row.id)).status, "NEEDS_HUMAN");
  } finally {
    if (prev === undefined) delete process.env.SETTLING_D65B;
    else process.env.SETTLING_D65B = prev;
    s2.restore();
    await cleanup([off.pt], [off.contract.id]);
  }
});

test("natural completion (the contract is already COMPLETED when the sweep meets the unsettled late row): the sweep records the obligation instead of parking it 'not paid'; a second tick does nothing", { skip }, async () => {
  const { pt, contract, row } = await lateRow("PENDING", { contract: { status: "COMPLETED", usedSessions: 10, terminationReason: "COMPLETED", terminatedAt: new Date() }, attempts: 0 });
  await prisma.sessionSettlement.create({
    data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${contract.id}`, contractId: contract.id, reason: "COMPLETED", status: "SETTLED", settledAt: new Date() },
  });
  await prisma.sessionSettlement.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - DAY), updatedAt: new Date(Date.now() - DAY) } as any }).catch(() => {});
  const s = stubs();
  try {
    await runSettlementSweep();
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED", `${after.status} ${after.lastError ?? ""}`);
    assert.equal((after.result as any).recordedOnly, true);
    assert.equal(recorded(s).length, 1);
    assert.equal(s.payments.filter((p) => p.method === "lateArrival").length, 0, "no compensation was paid after the ending");
    await runSettlementSweep();
    assert.equal(recorded(s).length, 1, "a second tick records nothing");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a late row an EARLIER build left UNCONFIRMED (it held nothing) is healed by the sweep: recorded as an obligation, terminal, once", { skip }, async () => {
  const { pt, contract, row } = await lateRow("UNCONFIRMED", { contract: { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date() } });
  const s = stubs();
  try {
    await runSettlementSweep();
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED");
    assert.equal((after.result as any).obligationId, lateKeyObligation(row.sessionId!));
    assert.equal(recorded(s).length, 1);
    await runSettlementSweep();
    assert.equal(recorded(s).length, 1);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
const lateKeyObligation = (sessionId: string) => `obl-${lateKey(sessionId)}`;

test("the client is never told they were compensated when they were not: no amount-paid sentence for a step that did not complete, none stored by the ending", { skip }, async () => {
  const failed = { state: "FAILED", error: "payment-service 503" };
  const text = ptLateArrivalClientMessage(readPtFaultMoney(failed), "01/01/2027");
  assert.doesNotMatch(text, /Đã bồi thường/);
  assert.match(text, /đang được xử lý/);
  assert.doesNotMatch(ptLateArrivalClientMessage(readPtFaultMoney({ state: "SETTLED", result: { owed: "250000.00", paid: "0.00", unpaid: "250000.00" } }), "01/01/2027"), /Đã bồi thường/);

  const { pt, contract } = await lateRow("NEEDS_HUMAN");
  const s = stubs(undefined, { realNotifications: true });
  try {
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    const notes = await prisma.notification.findMany({ where: { userId: contract.clientUserId } });
    assert.ok(notes.every((n) => !/đã bồi thường|Đã bồi thường|bồi thường đủ/i.test(n.text)), notes.map((n) => n.text).join(" | "));
  } finally {
    s.restore();
    await prisma.notification.deleteMany({ where: { userId: contract.clientUserId } }).catch(() => {});
    await cleanup([pt], [contract.id]);
  }
});

// ── PT no-show rows of a contract that ENDED before they settled (natural completion never drains rows) ───────────────────────

const noShowKey = (sessionId: string) => `PT_NO_SHOW:${sessionId}`;
const recordedNs = (s: ReturnType<typeof stubs>) => s.payments.filter((p) => p.method === "recordNoShowObligation");
const REAL_NO_SHOW = { compensation: "500000.00", charged: { pt: "450000.00", gym: "0.00", platform: "50000.00" }, shortfall: "0.00", owed: "500000.00", paid: "500000.00", unpaid: "0.00" };
const RECORD_ONLY_NO_SHOW = { compensation: "0.00", charged: { pt: "0.00", gym: "0.00", platform: "0.00" }, shortfall: "500000.00", owed: "500000.00", paid: "0.00", unpaid: "500000.00", obligationId: "obl-x", recordedOnly: true };

/** A COMPLETED contract (10/10 used) with a NO_SHOW session whose compensation row never settled. */
async function endedNoShowRow(rowStatus: string, lastError: string | null = null) {
  const pt = await makePt();
  const contract = await makeContract(pt, { status: "COMPLETED", usedSessions: 10, terminationReason: "COMPLETED", terminatedAt: new Date() });
  const ns = await addSession(contract, "NO_SHOW", new Date(Date.now() - DAY), { ptAtFault: true });
  await prisma.sessionSettlement.create({
    data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${contract.id}`, contractId: contract.id, reason: "COMPLETED", status: "SETTLED", settledAt: new Date() },
  });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: noShowKey(ns.id), contractId: contract.id, sessionId: ns.id, status: rowStatus as any, attempts: 3, lastError },
  });
  // older than the "its own request is about to start it" grace, like a row a sweep tick really finds
  await prisma.sessionSettlement.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - DAY) } });
  return { pt, contract, ns, row };
}
const ledgerRecord = (key: string, txn: string | null, result: unknown) => ({ key, kind: "NO_SHOW", transactionId: txn, result, createdAt: new Date().toISOString(), fingerprinted: true });

test("natural completion with a pending NO_SHOW row: the sweep records ONE OPEN obligation under the original key (no money), row SETTLED + recordedOnly, compensatedSessions untouched, a second tick does nothing", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const { pt, contract, ns, row } = await endedNoShowRow("PENDING");
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.equal(recordedNs(s).length, 1);
    assert.equal(recordedNs(s)[0].body.idempotencyKey, noShowKey(ns.id));
    assert.match(recordedNs(s)[0].body.reason, /PT vắng mặt/);
    for (const m of ["noShow", "lateArrival", "terminate", "releaseSession"]) assert.equal(s.payments.filter((p) => p.method === m).length, 0, `no ${m}`);
    const after = await reload(row.id);
    assert.equal(after.status, "SETTLED");
    assert.equal((after.result as any).recordedOnly, true);
    assert.equal(Number((after.result as any).paid), 0);
    assert.equal((after.result as any).obligationId, `obl-${noShowKey(ns.id)}`);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).compensatedSessions, 0);
    await runSettlementSweep();
    assert.equal(recordedNs(s).length, 1);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a NO_SHOW row an EARLIER build parked 'ENDED_UNSETTLED: contract ... not paid' is healed the same way; an orphan marker row is NOT touched", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const a = await endedNoShowRow("FAILED", "ENDED_UNSETTLED: contract X is COMPLETED; PT_NO_SHOW_COMPENSATION for session Y not paid - needs a human");
  const b = await endedNoShowRow("FAILED", "ENDED_UNSETTLED:CONTRACT_MISSING contract y no longer exists");
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.equal((await reload(a.row.id)).status, "SETTLED");
    assert.equal(recordedNs(s).length, 1);
    assert.equal(recordedNs(s)[0].body.idempotencyKey, noShowKey(a.ns.id));
    const untouched = await reload(b.row.id);
    assert.equal(untouched.status, "FAILED");
    assert.match(untouched.lastError ?? "", /^ENDED_UNSETTLED:CONTRACT_MISSING/);
  } finally {
    s.restore();
    await cleanup([a.pt], [a.contract.id]);
    await cleanup([b.pt], [b.contract.id]);
  }
});

test("the ledger had performed the NO_SHOW after all: its real result is applied ONCE (compensatedSessions +1), no obligation; a stored record-only result does NOT count the session", { skip }, async () => {
  for (const [result, expected] of [[REAL_NO_SHOW, 1], [RECORD_ONLY_NO_SHOW, 0]] as const) {
    await prisma.sessionSettlement.deleteMany({});
    const { pt, contract, ns, row } = await endedNoShowRow("PENDING");
    const s = stubs();
    s.ledger.ops.set(noShowKey(ns.id), ledgerRecord(noShowKey(ns.id), contract.paymentTransactionId, result));
    try {
      await runSettlementSweep();
      assert.equal(recordedNs(s).length, 0);
      assert.equal((await reload(row.id)).status, "SETTLED");
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).compensatedSessions, expected);
    } finally {
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  }
});

test("an unreachable payment-service leaves the NO_SHOW row as it is (retried later); nothing is recorded locally; the client is not notified", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const { pt, contract, row } = await endedNoShowRow("PENDING");
  const s = stubs(undefined, { realNotifications: true });
  s.ledger.unreachable = true;
  try {
    await runSettlementSweep();
    assert.notEqual((await reload(row.id)).status, "SETTLED");
    assert.equal(recordedNs(s).length, 0);
    assert.equal(await prisma.notification.count({ where: { userId: contract.clientUserId } }), 0);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
