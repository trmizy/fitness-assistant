import test from "node:test";
import assert from "node:assert/strict";
import { deductQuotaOnce, type QuotaDeps } from "../services/booking.service";

/**
 * The client's quota must be charged exactly once per session, no matter how many code
 * paths reach it — a manual confirm, an admin ruling on a dispute, and the auto-confirm
 * sweep can all target the same session, and the sweep can fire while a confirm is in
 * flight. The guarantee lives in the guarded `claimDeduction` update: only the caller
 * that actually flips `sessionDeducted` false → true is allowed to move the counter.
 */

/** Stand-in for the DB flag, so a "claim" can only succeed once across all callers. */
function makeDeps(alreadyDeducted = false) {
  const calls = { claim: 0, increment: 0, checkComplete: 0 };
  let deducted = alreadyDeducted;
  const deps: QuotaDeps = {
    claimDeduction: async () => {
      calls.claim++;
      if (deducted) return false; // row no longer matches `sessionDeducted: false`
      deducted = true;
      return true;
    },
    incrementSession: async () => {
      calls.increment++;
    },
    checkAndCompleteContract: async () => {
      calls.checkComplete++;
    },
  };
  return { deps, calls };
}

test("charges the contract exactly once on the first deduction", async () => {
  const { deps, calls } = makeDeps();

  const claimed = await deductQuotaOnce("s1", "c1", deps);

  assert.strictEqual(claimed, true);
  assert.strictEqual(calls.increment, 1, "contract counter must move exactly once");
  assert.strictEqual(calls.checkComplete, 1);
});

test("a second confirm of the same session does not charge again", async () => {
  const { deps, calls } = makeDeps();

  const first = await deductQuotaOnce("s1", "c1", deps);
  const second = await deductQuotaOnce("s1", "c1", deps);

  assert.strictEqual(first, true);
  assert.strictEqual(second, false, "second call must report it did not deduct");
  assert.strictEqual(calls.increment, 1, "quota must not be charged twice");
});

test("concurrent confirms race safely — only one wins", async () => {
  const { deps, calls } = makeDeps();

  const results = await Promise.all([
    deductQuotaOnce("s1", "c1", deps),
    deductQuotaOnce("s1", "c1", deps),
    deductQuotaOnce("s1", "c1", deps),
  ]);

  assert.strictEqual(
    results.filter(Boolean).length,
    1,
    "exactly one caller may claim the deduction",
  );
  assert.strictEqual(calls.increment, 1);
});

test("a session already deducted before this call is never charged again", async () => {
  // e.g. the auto-confirm sweep reaching a session the client confirmed a moment earlier.
  const { deps, calls } = makeDeps(true);

  const claimed = await deductQuotaOnce("s1", "c1", deps);

  assert.strictEqual(claimed, false);
  assert.strictEqual(calls.increment, 0, "must not touch the contract counter");
  assert.strictEqual(calls.checkComplete, 0);
});

test("does not run contract completion when nothing was deducted", async () => {
  const { deps, calls } = makeDeps(true);

  await deductQuotaOnce("s1", "c1", deps);

  assert.strictEqual(calls.checkComplete, 0);
});
