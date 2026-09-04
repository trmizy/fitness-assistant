import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compensateNoShowMoney } from "../services/contract-payout.service";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";

/**
 * Money-flow redesign plan item 1.6 — the exact bug `addException` and `markNoShow` hit: a
 * no-show compensation that failed used to REthrow, and both callers awaited it with nothing
 * catching the error — which, in `addException`'s case, also aborted the rest of that date's
 * conflicting sessions (a throw inside a bare `for` loop body stops the loop). By the time the
 * error reached either caller, the session had ALREADY been flipped to NO_SHOW, and there is no
 * path back to retry compensation for a session that is no longer CONFIRMED.
 *
 * This test proves the fix at the source: `compensateNoShowMoney` must never let a
 * payment-service failure escape as a thrown error, regardless of what its callers do or don't
 * catch.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("a payment-service outage during no-show compensation does not throw", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-1",
    price: { toString: () => "1000000" } as any,
    totalSessions: 10,
    usedSessions: 3,
    compensatedSessions: 0,
    notes: null,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
  };
  let incrementCalled = false;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(paymentClient, "noShow", async () => {
      throw new Error("payment-service unreachable");
    }),
    patch(contractRepository, "incrementCompensatedSessions", async () => {
      incrementCalled = true;
      return {} as any;
    }),
  ];

  try {
    // This is the whole fix, in one assertion: before 1.6, this call rejected and — inside
    // addException's bare for-loop, or markNoShow's uncaught await — that rejection would
    // propagate straight out to the HTTP caller with the session already flipped to NO_SHOW
    // and no way to retry. Now it must resolve, leaving the retry to the settlement sweep.
    await assert.doesNotReject(() => compensateNoShowMoney(contractId, sessionId));
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(incrementCalled, false, "the quota is not consumed for a compensation that never actually paid out");
});
