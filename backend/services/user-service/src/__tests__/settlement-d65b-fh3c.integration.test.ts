/**
 * FH-1/FH-2b/FH-3c user-service side - BACKEND INTEGRATION against the isolated *_test user database; payment-service = TEST
 * FIXTURE (paymentClient replaced at the client boundary: records every call, answers a scripted ledger lookup). The REAL ledger
 * is exercised by cross-service-money-fh3c.e2e.test.ts and the multi-instance suite.
 *
 * Covers:
 *  1. payment 409 IDEMPOTENCY_KEY_CONFLICT / 422 REQUEST_DOES_NOT_MATCH_TRANSACTION -> row CONFLICT + [MoneyAttention], never retried;
 *     malformed paid/owed/unpaid -> NEEDS_HUMAN, nothing applied.
 *  3. D65-B (FH-3c): an unverified session row no longer blocks an ending.
 *       executed on the ledger  -> its stored result is applied once (same tx as the SETTLED flip), the ending goes on;
 *       not executed            -> the session's value is HELD (usedSessions-1, unresolvedSessions+1, row UNCONFIRMED), the rest refunds;
 *       cannot be asked         -> 409 SESSION_SETTLEMENT_PENDING as before;  SETTLING_D65B=false -> the old blocking.
 *     A void premise closes the row and frees its key. A later resolution goes through UNRESOLVED_SESSION:<id>.
 *
 * Money example: 5,000,000 / 10 sessions (500,000 each, PT 450,000 + platform 50,000), 4 delivered, 3 released, the release of
 * session 4 parked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "@gym-coach/shared";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import {
  beginContractTermination,
  compensateNoShowMoney,
  releaseSessionMoney,
  resolveUnconfirmedSessionMoney,
  settleContractTermination,
  settleUnsettledSessionMoneyFirst,
  terminateContractMoney,
} from "../services/contract-payout.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const axiosErr = (status: number, code: string) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, error: { code, message: `${code} (fixture)` } } } });
const RELEASED = { pt: "450000.00", gym: "0.00", platform: "50000.00" };
const ledgerRecord = (key: string, kind: string, txn: string | null, result: unknown) => ({ key, kind, transactionId: txn, result, createdAt: new Date().toISOString(), fingerprinted: true });

async function captureAttention() {
  const lines: string[] = [];
  const restore = patch(logger as any, "error", (o: any) => {
    lines.push(typeof o === "string" ? o : JSON.stringify(o));
  });
  return { lines, restore };
}

/** 5,000,000 / 10 sessions, session 1-3 released (counters say so), session 4 delivered and its release row in `status`. */
async function parkedRelease(status: "NEEDS_HUMAN" | "FAILED" | "CONFLICT" = "NEEDS_HUMAN") {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 4, releasedToPt: 1_350_000, releasedToPlatform: 150_000 });
  const s4 = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: {
      kind: "SESSION_RELEASE",
      idempotencyKey: `SESSION_RELEASE:${s4.id}`,
      contractId: contract.id,
      sessionId: s4.id,
      status,
      attempts: 12,
      lastError: status === "CONFLICT" ? "CONFLICT: x" : "NEEDS_RECONCILIATION: 12 failed attempts (cap 12); last error: payment-service 503",
    },
  });
  return { pt, contract, s4, row };
}
const reload = (id: string) => prisma.sessionSettlement.findUniqueOrThrow({ where: { id } });
const contractOf = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });
const termBody = (s: ReturnType<typeof stubs>) => s.payments.filter((p) => p.method === "terminate").map((p) => p.body);

// ── 1. refusals and malformed answers ──────────────────────────────────────────────────────────────────────────────────

for (const [status, code] of [[409, "IDEMPOTENCY_KEY_CONFLICT"], [422, "REQUEST_DOES_NOT_MATCH_TRANSACTION"]] as const) {
  test(`payment ${status} ${code} on a session step -> row CONFLICT + [MoneyAttention], the sweep never retries it, nothing applied`, { skip }, async () => {
    await prisma.sessionSettlement.deleteMany({});
    const pt = await makePt();
    const contract = await makeContract(pt, { usedSessions: 0 });
    const noShow = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000));
    const s = stubs();
    const cap = await captureAttention();
    const undo = patch(paymentClient, "noShow", async (body: any) => {
      s.payments.push({ method: "noShow", body });
      throw axiosErr(status, code);
    });
    try {
      const out = await compensateNoShowMoney(contract.id, noShow.id);
      assert.deepEqual(out, { state: "PARKED", cause: "LEDGER_REFUSAL" });
      const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${noShow.id}` } });
      assert.equal(row.status, "CONFLICT");
      assert.match(row.lastError ?? "", new RegExp(`^CONFLICT: .*${code}`));
      assert.match(row.conflictNote ?? "", new RegExp(code));
      assert.ok(cap.lines.some((l) => l.includes("[MoneyAttention]") && l.includes(code)), "an operator alert was logged");
      assert.equal((await contractOf(contract.id)).compensatedSessions, 0, "nothing applied");
      const before = s.payments.length;
      await runSettlementSweep();
      await compensateNoShowMoney(contract.id, noShow.id);
      assert.equal(s.payments.length, before, "never retried: not by the sweep, not by a live caller");
    } finally {
      cap.restore();
      undo();
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  });
}

test("a malformed answer (paid > owed) is NOT applied and NOT retried: row NEEDS_HUMAN, compensatedSessions untouched", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt);
  const noShow = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000));
  const s = stubs();
  const cap = await captureAttention();
  const undo = patch(paymentClient, "noShow", async (body: any) => {
    s.payments.push({ method: "noShow", body });
    return { compensation: "600000.00", owed: "500000.00", paid: "600000.00", unpaid: "0.00" };
  });
  try {
    assert.deepEqual(await compensateNoShowMoney(contract.id, noShow.id), { state: "PARKED", cause: "MALFORMED_ANSWER" });
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${noShow.id}` } });
    assert.equal(row.status, "NEEDS_HUMAN");
    assert.match(row.lastError ?? "", /malformed payment-service answer: .*paid 600000 greater than owed 500000/);
    assert.ok(cap.lines.some((l) => l.includes("[MoneyAttention]")));
    assert.equal((await contractOf(contract.id)).compensatedSessions, 0);
    await runSettlementSweep();
    assert.equal(s.payments.filter((p) => p.method === "noShow").length, 1, "not retried");
  } finally {
    cap.restore();
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a coherent partial answer (paid 150.000 of 250.000) IS applied: the session still counts as consumed", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { totalSessions: 4, price: 1_000_000 });
  const noShow = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000));
  const s = stubs();
  const undo = patch(paymentClient, "noShow", async () => ({ compensation: "150000.00", owed: "250000.00", paid: "150000.00", unpaid: "100000.00", shortfall: "100000.00", obligationId: "ob-1" }));
  try {
    const out: any = await compensateNoShowMoney(contract.id, noShow.id);
    assert.equal(out.state, "SETTLED");
    assert.equal((await contractOf(contract.id)).compensatedSessions, 1);
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

for (const [status, code] of [[409, "IDEMPOTENCY_KEY_CONFLICT"], [422, "REQUEST_DOES_NOT_MATCH_TRANSACTION"]] as const) {
  test(`payment ${status} ${code} on the TERMINATE call -> ending row CONFLICT, 409 CONTRACT_ENDING_CONFLICT, no retry by the sweep`, { skip }, async () => {
    await prisma.sessionSettlement.deleteMany({});
    const pt = await makePt();
    const contract = await makeContract(pt, { usedSessions: 0 });
    const s = stubs();
    const cap = await captureAttention();
    const undo = patch(paymentClient, "terminate", async (body: any) => {
      s.payments.push({ method: "terminate", body });
      throw axiosErr(status, code);
    });
    try {
      await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }), (e: any) => e.status === 409 && e.code === "CONTRACT_ENDING_CONFLICT");
      const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${contract.id}` } });
      assert.equal(row.status, "CONFLICT");
      assert.ok(cap.lines.some((l) => l.includes("[MoneyAttention]") && l.includes(code)));
      assert.equal((await contractOf(contract.id)).status, "ACTIVE", "never reported as ended");
      await runSettlementSweep();
      await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "CONTRACT_ENDING_CONFLICT");
      assert.equal(termBody(s).length, 1, "one call only");
    } finally {
      cap.restore();
      undo();
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  });
}

test("a malformed TERMINATE answer (unpaid != owed - paid) parks the ending NEEDS_HUMAN and never writes the final status", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 0 });
  const s = stubs();
  const undo = patch(paymentClient, "terminate", async (body: any) => ({ reason: body.reason, refund: "100.00", owed: "1000.00", paid: "100.00", unpaid: "5.00" }));
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "PT_CANCELLED", { cancelledBy: pt }), (e: any) => e.code === "CONTRACT_ENDING_CONFLICT");
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${contract.id}` } });
    assert.equal(row.status, "NEEDS_HUMAN");
    assert.equal((await contractOf(contract.id)).status, "ACTIVE");
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

// ── 3. FH-3c / D65-B ───────────────────────────────────────────────────────────────────────────────────────────────────

test("[REGRESSION D65-B] release of session 4 parked, ledger NEVER performed it -> every ending reason goes through: the session's value is HELD, row UNCONFIRMED, nothing paid twice", { skip }, async () => {
  for (const reason of ["CLIENT_CANCELLED", "PT_CANCELLED", "EXPIRED", "MUTUAL", "PT_BANNED"] as const) {
    const { pt, contract, s4, row } = await parkedRelease();
    const s = stubs();
    try {
      const result = await terminateContractMoney(contract.id, reason, { cancelledBy: contract.clientUserId });
      assert.ok(result, `${reason} ended`);
      assert.deepEqual(s.payments.map((p) => p.method), ["terminate"], `${reason}: only the terminate call - no release was sent`);
      const body = termBody(s)[0];
      assert.equal(body.usedSessions, 3, `${reason}: session 4 is counted once - as held, not also as used`);
      assert.equal(body.unresolvedSessions, 1);
      assert.deepEqual(body.alreadyReleased, { pt: "1350000", gym: "0", platform: "150000" }, "released counters untouched: nothing was applied for session 4");
      assert.deepEqual(s.ledger.lookups, [`SESSION_RELEASE:${s4.id}`]);
      assert.equal((await reload(row.id)).status, "UNCONFIRMED");
      assert.match((await reload(row.id)).lastError ?? "", /^UNCONFIRMED:/);
      const after = await contractOf(contract.id);
      assert.equal(after.status, reason === "EXPIRED" ? "EXPIRED" : "CANCELLED");
      assert.equal(await prisma.sessionSettlement.count({ where: { contractId: contract.id, kind: "CONTRACT_TERMINATION", status: "SETTLED" } }), 1);
    } finally {
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  }
});

test("[REGRESSION D65-B] 'lost answer': the ledger DID perform the release -> its stored result is applied ONCE (releasedTo*), the ending sends the true alreadyReleased, nothing is held, no double pay", { skip }, async () => {
  const { pt, contract, s4, row } = await parkedRelease("FAILED");
  const s = stubs();
  // payment-service answers the retry with an error, but it HAS the operation (the first answer was lost)
  const down = patch(paymentClient, "releaseSession", async (body: any) => {
    s.payments.push({ method: "releaseSession", body });
    throw new Error("timeout of 15000ms exceeded");
  });
  s.ledger.ops.set(`SESSION_RELEASE:${s4.id}`, ledgerRecord(`SESSION_RELEASE:${s4.id}`, "RELEASE_SESSION", contract.paymentTransactionId, { released: RELEASED, unit: "500000.00" }));
  try {
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    // the drain retried the release (idempotent, same key) in its two rounds and it failed; after the lookup nothing more was sent
    assert.deepEqual([...new Set(s.payments.map((p) => p.method))], ["releaseSession", "terminate"]);
    assert.ok(s.payments.filter((p) => p.method === "releaseSession").every((p) => p.body.idempotencyKey === `SESSION_RELEASE:${s4.id}`));
    assert.equal(s.payments[s.payments.length - 1].method, "terminate", "the terminate is the last call: no release after the lookup");
    const body = termBody(s)[0];
    assert.equal(body.usedSessions, 4);
    assert.equal(body.unresolvedSessions, undefined, "nothing held: the session was paid");
    assert.deepEqual(body.alreadyReleased, { pt: "1800000", gym: "0", platform: "200000" }, "1,350,000 + 450,000: the ledger's truth");
    const settled = await reload(row.id);
    assert.equal(settled.status, "SETTLED");
    assert.ok(settled.appliedAt, "applied_at recorded");
    assert.deepEqual(settled.result, { released: RELEASED, unit: "500000.00" });
    const after = await contractOf(contract.id);
    assert.equal(Number(after.releasedToPt), 1_800_000);
    // replaying the whole ending (a retry, the sweep) applies nothing again
    await settleContractTermination(contract.id, "CLIENT_CANCELLED");
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_800_000, "exactly once");
  } finally {
    down();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("[REGRESSION D65-B] two endings race over the same unverified row: the stored result is applied once", { skip }, async () => {
  const { pt, contract, s4 } = await parkedRelease();
  const s = stubs();
  s.ledger.ops.set(`SESSION_RELEASE:${s4.id}`, ledgerRecord(`SESSION_RELEASE:${s4.id}`, "RELEASE_SESSION", contract.paymentTransactionId, { released: RELEASED }));
  try {
    await Promise.allSettled([
      terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }),
      terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }),
    ]);
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_800_000, "added once, not twice");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("(c) payment-service cannot be asked -> the ending stays refused (409 SESSION_SETTLEMENT_PENDING), no money call, no intent, row untouched", { skip }, async () => {
  const { pt, contract, row } = await parkedRelease();
  const s = stubs();
  s.ledger.unreachable = true;
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId }), (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(s.payments.length, 0);
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: contract.id, kind: "CONTRACT_TERMINATION" } }), 0);
    assert.equal((await reload(row.id)).status, "NEEDS_HUMAN");
    assert.equal((await contractOf(contract.id)).status, "ACTIVE");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a CONFLICT row still blocks the ending (payment disagreed - a human decides), even if the ledger holds a record", { skip }, async () => {
  const { pt, contract, s4 } = await parkedRelease("CONFLICT");
  const s = stubs();
  s.ledger.ops.set(`SESSION_RELEASE:${s4.id}`, ledgerRecord(`SESSION_RELEASE:${s4.id}`, "RELEASE_SESSION", contract.paymentTransactionId, { released: RELEASED }));
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(s.payments.length, 0);
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_350_000);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a ledger record that belongs to ANOTHER transaction is never applied: row parked CONFLICT, ending refused", { skip }, async () => {
  const { pt, contract, s4, row } = await parkedRelease();
  const s = stubs();
  s.ledger.ops.set(`SESSION_RELEASE:${s4.id}`, ledgerRecord(`SESSION_RELEASE:${s4.id}`, "RELEASE_SESSION", "txn-of-another-contract", { released: RELEASED }));
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal((await reload(row.id)).status, "CONFLICT");
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_350_000, "nothing applied");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a stored ledger result that is not a valid confirmation (all-zero release) is never applied: row NEEDS_HUMAN, ending refused", { skip }, async () => {
  const { pt, contract, s4, row } = await parkedRelease("NEEDS_HUMAN");
  const s = stubs();
  s.ledger.ops.set(`SESSION_RELEASE:${s4.id}`, ledgerRecord(`SESSION_RELEASE:${s4.id}`, "RELEASE_SESSION", contract.paymentTransactionId, { released: { pt: "0", gym: "0", platform: "0" } }));
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal((await reload(row.id)).status, "NEEDS_HUMAN");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("SETTLING_D65B=false restores the old blocking exactly: no lookup, no hold, 409 SESSION_SETTLEMENT_PENDING", { skip }, async () => {
  const { pt, contract, row } = await parkedRelease();
  const s = stubs();
  process.env.SETTLING_D65B = "false";
  try {
    await assert.rejects(() => terminateContractMoney(contract.id, "CLIENT_CANCELLED"), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(s.ledger.lookups.length, 0);
    assert.equal(s.payments.length, 0);
    assert.equal((await reload(row.id)).status, "NEEDS_HUMAN");
  } finally {
    delete process.env.SETTLING_D65B;
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a PT no-show compensation the ledger never performed is HELD (no counter change, unresolved +1); one it DID perform is applied once (compensatedSessions)", { skip }, async () => {
  for (const executed of [false, true]) {
    await prisma.sessionSettlement.deleteMany({});
    const pt = await makePt();
    const contract = await makeContract(pt, { usedSessions: 0 });
    const noShow = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000));
    const row = await prisma.sessionSettlement.create({
      data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${noShow.id}`, contractId: contract.id, sessionId: noShow.id, status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: x" },
    });
    const s = stubs();
    if (executed) s.ledger.ops.set(row.idempotencyKey, ledgerRecord(row.idempotencyKey, "NO_SHOW", contract.paymentTransactionId, { compensation: "500000.00", owed: "500000.00", paid: "500000.00", unpaid: "0.00", shortfall: "0.00" }));
    try {
      await terminateContractMoney(contract.id, "PT_CANCELLED", { cancelledBy: pt });
      const body = termBody(s)[0];
      const after = await contractOf(contract.id);
      if (executed) {
        assert.equal(body.compensatedSessions, 1);
        assert.equal(body.unresolvedSessions, undefined);
        assert.equal(after.compensatedSessions, 1, "applied exactly once");
        assert.equal((await reload(row.id)).status, "SETTLED");
      } else {
        assert.equal(body.compensatedSessions, 0);
        assert.equal(body.unresolvedSessions, 1, "the session's value is held");
        assert.equal(body.usedSessions, 0);
        assert.equal(after.compensatedSessions, 0);
        assert.equal((await reload(row.id)).status, "UNCONFIRMED");
      }
    } finally {
      s.restore();
      await cleanup([pt], [contract.id]);
    }
  }
});

test("a late-arrival compensation the ledger never performed does not block the ending and holds no session value: row UNCONFIRMED for a human", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const late = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${late.id}`, contractId: contract.id, sessionId: late.id, status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: x" },
  });
  const s = stubs();
  try {
    await terminateContractMoney(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    const body = termBody(s)[0];
    assert.equal(body.unresolvedSessions, undefined);
    assert.equal(body.usedSessions, 1);
    assert.equal((await reload(row.id)).status, "UNCONFIRMED");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("[REGRESSION D64-B/key poisoning] a row whose premise is void is closed (terminal, history kept) and GIVES UP its key: when the session IS delivered later, its release is recorded and PAID", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 0 });
  const waiting = await addSession(contract, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 86_400_000), { clientConfirmDeadline: new Date(Date.now() + 86_400_000) });
  const key = `SESSION_RELEASE:${waiting.id}`;
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: key, contractId: contract.id, sessionId: waiting.id, status: "PENDING" } });
  const s = stubs();
  try {
    await runSettlementSweep();
    const voided = await prisma.sessionSettlement.findFirstOrThrow({ where: { contractId: contract.id } });
    assert.match(voided.lastError ?? "", /^ENDED_UNSETTLED:PREMISE_VOID:.*not delivered/);
    assert.notEqual(voided.status, "SETTLED");
    assert.equal(voided.idempotencyKey, `${key}#VOID:${voided.id}`);
    assert.equal(await prisma.sessionSettlement.findUnique({ where: { idempotencyKey: key } }), null, "the key is free");
    assert.equal(s.payments.length, 0, "nothing was paid for a session nobody delivered");
    // the client confirms: the session really is delivered
    await prisma.session.update({ where: { id: waiting.id }, data: { status: "COMPLETED", sessionDeducted: true } });
    await releaseSessionMoney(contract.id, waiting.id);
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"], "the legitimate release IS sent");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } })).status, "SETTLED");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a void-looking row whose operation the LEDGER DID perform is not voided: parked NEEDS_HUMAN for a person", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 0 });
  const waiting = await addSession(contract, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 86_400_000), { clientConfirmDeadline: new Date(Date.now() + 86_400_000) });
  const key = `SESSION_RELEASE:${waiting.id}`;
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: key, contractId: contract.id, sessionId: waiting.id, status: "PENDING" } });
  const s = stubs();
  s.ledger.ops.set(key, ledgerRecord(key, "RELEASE_SESSION", contract.paymentTransactionId, { released: RELEASED }));
  try {
    await runSettlementSweep();
    const r = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } });
    assert.equal(r.status, "NEEDS_HUMAN");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("later resolution of a HELD session through UNRESOLVED_SESSION:<id>: DELIVERED releases the held value (counters + both rows SETTLED, once); a second call does nothing", { skip }, async () => {
  const { pt, contract, s4, row } = await parkedRelease();
  const s = stubs();
  const resolveCalls: any[] = [];
  const undo = patch(paymentClient, "resolveUnresolvedSession", async (body: any) => {
    resolveCalls.push(body);
    return { moved: { pt: "450000.00", gym: "0.00", platform: "50000.00" } };
  });
  try {
    await terminateContractMoney(contract.id, "PT_CANCELLED", { cancelledBy: pt });
    assert.equal((await reload(row.id)).status, "UNCONFIRMED");
    const out = await resolveUnconfirmedSessionMoney(contract.id, s4.id, "DELIVERED");
    assert.equal(out.state, "SETTLED");
    assert.equal(resolveCalls.length, 1);
    assert.equal(resolveCalls[0].idempotencyKey, `UNRESOLVED_SESSION:${s4.id}`);
    assert.equal(resolveCalls[0].outcome, "DELIVERED");
    assert.equal((await reload(row.id)).status, "SETTLED", "the held row closed in the resolution's transaction");
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_800_000);
    assert.equal((await resolveUnconfirmedSessionMoney(contract.id, s4.id, "DELIVERED")).state, "NOT_HELD");
    assert.equal(resolveCalls.length, 1);
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_800_000, "once");
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("later resolution NOT_DELIVERED (admin ruled the session was not delivered): the client is refunded from the held value, the PT counters do not move", { skip }, async () => {
  const { pt, contract, s4, row } = await parkedRelease();
  const s = stubs();
  const resolveCalls: any[] = [];
  const undo = patch(paymentClient, "resolveUnresolvedSession", async (body: any) => {
    resolveCalls.push(body);
    return { moved: { client: "500000.00" } };
  });
  try {
    await terminateContractMoney(contract.id, "PT_CANCELLED", { cancelledBy: pt });
    await prisma.session.update({ where: { id: s4.id }, data: { status: "CANCELLED" } }); // the admin ruling's effect on the session
    assert.equal((await resolveUnconfirmedSessionMoney(contract.id, s4.id, "NOT_DELIVERED")).state, "SETTLED");
    assert.equal(resolveCalls[0].outcome, "NOT_DELIVERED");
    assert.equal((await reload(row.id)).status, "SETTLED");
    assert.equal(Number((await contractOf(contract.id)).releasedToPt), 1_350_000);
  } finally {
    undo();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("CRASH after the hold was committed but before the terminate call: the intent + the UNCONFIRMED row are durable together, and the settlement sweep finishes the ending WITH the hold", { skip }, async () => {
  const { pt, contract, row } = await parkedRelease();
  const s = stubs();
  try {
    const intent = await beginContractTermination(contract.id, "CLIENT_CANCELLED", { cancelledBy: contract.clientUserId });
    assert.ok(intent?.rowId);
    // -- the process dies here: no terminate call was made --
    assert.equal(s.payments.length, 0);
    assert.equal((await reload(row.id)).status, "UNCONFIRMED");
    assert.equal((await reload(intent!.rowId!)).status, "PENDING");
    await prisma.sessionSettlement.update({ where: { id: intent!.rowId! }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    await runSettlementSweep();
    const body = termBody(s)[0];
    assert.equal(body.unresolvedSessions, 1);
    assert.equal(body.usedSessions, 3);
    assert.equal((await contractOf(contract.id)).status, "CANCELLED");
    assert.equal((await reload(row.id)).status, "UNCONFIRMED");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a runner takes the row between the decision and the hold: nothing is half-kept (no intent, no UNCONFIRMED row) and the attempt is refused", { skip }, async () => {
  const { pt, contract, row } = await parkedRelease();
  const s = stubs();
  try {
    const plan = await settleUnsettledSessionMoneyFirst(contract.id);
    assert.equal(plan.hold.length, 1);
    await prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "PROCESSING" } }); // another instance claimed it
    await assert.rejects(() => beginContractTermination(contract.id, "CLIENT_CANCELLED", undefined, { drain: false, plan }), (e: any) => e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: contract.id, kind: "CONTRACT_TERMINATION" } }), 0);
    assert.equal((await reload(row.id)).status, "PROCESSING");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
