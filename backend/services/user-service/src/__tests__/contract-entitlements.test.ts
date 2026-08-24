import test from "node:test";
import assert from "node:assert/strict";
import { getRemainingEntitlements } from "../services/contract.service";

/**
 * Money-flow redesign plan item 1.5 — the single shared formula every caller must use instead
 * of re-deriving "how many sessions does this contract still owe":
 *
 *   consumedEntitlements  = usedSessions + compensatedSessions
 *   remainingEntitlements = totalSessions (purchasedSessions) − consumedEntitlements
 *
 * `totalSessions` is immutable once signed (see the schema.prisma comment on
 * Contract.totalSessions) — before this fix it was decremented on every PT no-show, which is
 * exactly the case these tests pin down: compensatedSessions must reach the same completion
 * outcome WITHOUT ever mutating totalSessions.
 */

test("a fresh contract with nothing consumed owes everything", () => {
  assert.equal(getRemainingEntitlements({ totalSessions: 10, usedSessions: 0, compensatedSessions: 0 }), 10);
});

test("used and compensated sessions both count toward consumed", () => {
  // 12 sessions bought, PT no-showed twice (compensated), client trained 10 — this is the
  // exact scenario the plan calls out: usedSessions alone (10) never reaches totalSessions
  // (12), so a completion check that only looks at usedSessions would leave this contract
  // ACTIVE forever with its escrow money stuck.
  assert.equal(getRemainingEntitlements({ totalSessions: 12, usedSessions: 10, compensatedSessions: 2 }), 0);
});

test("a one-session contract completes on a single no-show — no special-casing needed", () => {
  // The plan's "lợi ích kèm theo": compensateNoShowMoney used to refuse to shrink a
  // 1-session contract's quota (division-by-zero guard), which let the client keep BOTH the
  // cash compensation AND the right to book the session again. With compensatedSessions this
  // resolves on its own — no branch required.
  assert.equal(getRemainingEntitlements({ totalSessions: 1, usedSessions: 0, compensatedSessions: 1 }), 1 - 1);
});

test("never goes negative when consumed somehow exceeds purchased", () => {
  // Defensive: a data inconsistency must not produce a negative "remaining" that a naive
  // `remaining > 0` check would treat as truthy in some contexts.
  assert.equal(getRemainingEntitlements({ totalSessions: 5, usedSessions: 4, compensatedSessions: 3 }), 0);
});

test("compensated-only exhaustion completes the contract just like used-only exhaustion", () => {
  assert.equal(getRemainingEntitlements({ totalSessions: 3, usedSessions: 0, compensatedSessions: 3 }), 0);
});
