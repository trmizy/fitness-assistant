import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { SessionSettlementKind, SessionSettlementStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan item 1.6 — the sweep worker that retries whatever `settleTracked`
 * left PENDING/FAILED/stale-PROCESSING. Proves the dispatch routes each `SessionSettlementKind`
 * to the right underlying financial operation, and that one row's failure does not stop the
 * rest of the batch (same shape as session-autoconfirm's equivalent test).
 *
 * Patches the real singletons the whole call chain touches — `sessionSettlementRepository`
 * (so no real DB row selection is needed to choose WHICH rows retry) and the leaf
 * `contractRepository`/`paymentClient` each underlying function calls — while letting the REAL
 * compensateNoShowMoney/releaseSessionMoney/terminateContractMoney/settleTracked run, so this
 * also exercises the actual settleTracked → mark PROCESSING/SETTLED/FAILED lifecycle against
 * the real `session_settlements` table (only the business-logic leaves are faked).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fixtureContract(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    paymentTransactionId: "txn-1",
    price: { toString: () => "1000000" } as any,
    totalSessions: 10,
    usedSessions: 5,
    compensatedSessions: 0,
    notes: null,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
    releasedToPt: { toString: () => "0" },
    releasedToGym: { toString: () => "0" },
    releasedToPlatform: { toString: () => "0" },
    ...overrides,
  };
}

test("retries a PENDING PT_NO_SHOW_COMPENSATION row via compensateNoShowMoney", async () => {
  const sessionId = randomUUID();
  const contract = fixtureContract();
  const calls: string[] = [];

  const restores = [
    patch(sessionSettlementRepository, "findRetryable", async () => [
      { id: "row-1", kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, contractId: contract.id, sessionId, reason: null, status: SessionSettlementStatus.FAILED },
    ]),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementCompensatedSessions", async () => {
      calls.push("incrementCompensatedSessions");
      return {} as any;
    }),
    patch(paymentClient, "noShow", async () => {
      calls.push("paymentClient.noShow");
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
  ];

  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 1, retried: 1 });
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["paymentClient.noShow", "incrementCompensatedSessions"]);
});

test("retries a FAILED SESSION_RELEASE row via releaseSessionMoney", async () => {
  const sessionId = randomUUID();
  const contract = fixtureContract();
  const calls: string[] = [];

  const restores = [
    patch(sessionSettlementRepository, "findRetryable", async () => [
      { id: "row-1", kind: SessionSettlementKind.SESSION_RELEASE, contractId: contract.id, sessionId, reason: null, status: SessionSettlementStatus.FAILED },
    ]),
    patch(contractRepository, "findById", async () => contract as any),
    patch(prisma.contract, "update", async () => ({}) as any),
    patch(paymentClient, "releaseSession", async () => {
      calls.push("paymentClient.releaseSession");
      return { released: { pt: "90000.00", gym: "0.00", platform: "10000.00" } };
    }),
  ];

  try {
    await runSettlementSweep();
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["paymentClient.releaseSession"]);
});

test("retries a stale CONTRACT_TERMINATION row via terminateContractMoney and marks it SETTLED on success", async () => {
  const contract = fixtureContract();
  const calls: string[] = [];
  let markedSettled = false;

  const restores = [
    patch(sessionSettlementRepository, "findRetryable", async () => [
      { id: "row-1", kind: SessionSettlementKind.CONTRACT_TERMINATION, contractId: contract.id, sessionId: null, reason: "COMPLETED", status: SessionSettlementStatus.PROCESSING },
    ]),
    patch(contractRepository, "findById", async () => contract as any),
    patch(prisma.contract, "update", async () => ({}) as any),
    patch(paymentClient, "terminate", async (body: any) => {
      calls.push("paymentClient.terminate");
      assert.equal(body.reason, "COMPLETED");
      return { refund: "0.00" };
    }),
    patch(sessionSettlementRepository, "markSettled", async (id: string) => {
      markedSettled = true;
      assert.equal(id, "row-1");
      return {} as any;
    }),
    // markProcessing is still hit by the sweep's re-entry through settleTracked — stub it
    // out so the (unmocked) real DB write path for row-1 (which does not actually exist)
    // is never attempted.
    patch(sessionSettlementRepository, "upsertPending", async () => ({ id: "row-1", status: "PROCESSING" })),
    patch(sessionSettlementRepository, "markProcessing", async () => ({}) as any),
  ];

  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 1, retried: 1 });
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["paymentClient.terminate"]);
  assert.equal(markedSettled, true, "a successful retry must mark the row SETTLED, or it would be retried forever");
});

test("an unexpected error fetching one row's contract does not stop the rest of the batch", async () => {
  // Unlike a payment-service failure (already caught inside settleTracked, so dispatch()
  // never throws for that case — see settle-tracked.test.ts), contractRepository.findById is
  // called BEFORE settleTracked in every one of the three underlying functions. A genuine DB
  // blip fetching the contract DOES propagate out of dispatch() — this is what the sweep's
  // own per-row try/catch exists to isolate.
  const badSessionId = randomUUID();
  const goodSessionId = randomUUID();
  const badContractId = randomUUID();
  const goodContract = fixtureContract();
  const attempted: string[] = [];

  const restores = [
    patch(sessionSettlementRepository, "findRetryable", async () => [
      { id: "row-bad", kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, contractId: badContractId, sessionId: badSessionId, reason: null, status: SessionSettlementStatus.FAILED },
      { id: "row-good", kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, contractId: goodContract.id, sessionId: goodSessionId, reason: null, status: SessionSettlementStatus.FAILED },
    ]),
    patch(contractRepository, "findById", async (id: string) => {
      attempted.push(id);
      if (id === badContractId) throw new Error("transient DB error");
      return goodContract as any;
    }),
    patch(contractRepository, "incrementCompensatedSessions", async () => ({}) as any),
    patch(paymentClient, "noShow", async () => ({
      compensation: "100000.00",
      pt: "90000.00",
      gym: "0.00",
      platform: "10000.00",
      shortfall: "0.00",
    })),
  ];

  try {
    const result = await runSettlementSweep();
    assert.deepEqual(result, { scanned: 2, retried: 1 }, "the bad row does not count as retried, but the sweep continues past it");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(attempted, [badContractId, goodContract.id], "both rows are attempted despite the first one's DB error");
});
