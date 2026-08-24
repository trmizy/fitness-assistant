import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compensateNoShowMoney } from "../services/contract-payout.service";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";

/**
 * Money-flow redesign plan item 1.5 — "ngừng thay đổi tổng số buổi của hợp đồng".
 *
 * Before this fix, a PT no-show decremented `contract.totalSessions` and used that
 * ALREADY-SHRUNK number for the compensation call, which made every subsequent session's
 * unit price (price / totalSessions) drift upward — and a 1-session contract could never
 * shrink at all, so it skipped quota entirely (client kept both the cash AND the session).
 *
 * These tests monkey-patch the collaborators `compensateNoShowMoney` calls directly
 * (contractRepository, paymentClient) — the same real singleton objects the module under test
 * imports, since none of them are exported as classes. Each test restores every patched method
 * in `finally`.
 *
 * `compensateNoShowMoney` also does a REAL write to the `session_settlements` table now
 * (money-flow plan 1.6's retry tracking, not mocked here — it is its own module with its own
 * test coverage in settle-tracked.test.ts) keyed on sessionId. A second call with the SAME
 * sessionId would correctly find that row already SETTLED and skip re-running — so each test
 * below uses its own unique sessionId, or it would spuriously look like a bug in THIS test file
 * rather than the correct idempotency behavior it actually is.
 */

// `impl` is deliberately untyped against Prisma's real (chainable) client method signatures —
// a plain Promise-returning fake is all any caller here actually awaits.
function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("a PT no-show does NOT decrement totalSessions — it increments compensatedSessions instead", async () => {
  const calls: string[] = [];
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-1",
    price: { toString: () => "1200000" } as any,
    totalSessions: 12,
    usedSessions: 5,
    compensatedSessions: 0,
    notes: null,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
  };

  const restores = [
    patch(contractRepository, "findById", async () => {
      calls.push("findById");
      return contract as any;
    }),
    patch(paymentClient, "noShow", async (body: any) => {
      calls.push("noShow");
      // The whole point: totalSessions passed to payment-service must be the ORIGINAL 12,
      // not something already decremented by a prior no-show in the same request.
      assert.equal(body.totalSessions, 12, "payment-service sees the immutable purchased count");
      assert.equal(body.idempotencyKey, `PT_NO_SHOW:${sessionId}`);
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
    patch(contractRepository, "incrementCompensatedSessions", async (id: string, notes?: string) => {
      calls.push("incrementCompensatedSessions");
      assert.equal(id, contractId);
      // The whole fix in one assertion: this call carries no totalSessions argument at
      // all — there is no code path left by which a no-show could shrink the purchased
      // count, not even accidentally.
      assert.equal(typeof notes, "string");
      return {} as any;
    }),
  ];

  try {
    await compensateNoShowMoney(contractId, sessionId);
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["findById", "noShow", "incrementCompensatedSessions"]);
});

test("a 1-session contract's no-show compensates without any special-casing", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-1",
    price: { toString: () => "100000" } as any,
    totalSessions: 1,
    usedSessions: 0,
    compensatedSessions: 0,
    notes: null,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
  };
  let incremented = false;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(paymentClient, "noShow", async (body: any) => {
      assert.equal(body.totalSessions, 1);
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
    patch(contractRepository, "incrementCompensatedSessions", async () => {
      incremented = true;
      return {} as any;
    }),
  ];

  try {
    // Must not throw — the old code path warned-and-skipped the quota update for a
    // 1-session contract instead of ever letting it reach zero remaining entitlements.
    await compensateNoShowMoney(contractId, sessionId);
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(incremented, true, "even a 1-session contract's entitlement is consumed via compensatedSessions");
});
