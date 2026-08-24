import test from "node:test";
import assert from "node:assert/strict";
import { runAutoConfirm, type AutoConfirmDeps } from "../services/session-autoconfirm.service";

/**
 * Money-flow redesign plan item 1.3 — "tự động xác nhận không giải phóng tiền".
 *
 * The auto-confirm sweep used to do claimDeduction → incrementSession → checkAndCompleteContract
 * directly, re-implementing (and drifting from) the manual-confirm path in booking.service.ts,
 * which skipped `releaseSessionMoney` — the ONE step that actually moves the PT's earned share
 * from pending to available. The fix routes the sweep through `deductQuotaOnce` (the SAME
 * function the manual path uses, already covered by session-quota.test.ts's 5 tests including
 * "the PT must be paid for the session exactly once"), so there is exactly one implementation
 * of "what happens when a session is confirmed" instead of two that can drift apart again.
 *
 * Same injectable-deps pattern as `QuotaDeps`/`CompleteContractDeps` — this test therefore only
 * has to prove `runAutoConfirm` calls `deductQuotaOnce` (not re-derive the money logic, which
 * session-quota.test.ts already owns).
 */

function deps(overrides: Partial<AutoConfirmDeps> = {}): { deps: AutoConfirmDeps; calls: string[] } {
  const calls: string[] = [];
  const d: AutoConfirmDeps = {
    findExpiredPendingConfirmation: async () => {
      calls.push("findExpiredPendingConfirmation");
      return [{ id: "s1", contractId: "c1", clientUserId: "client-1" }];
    },
    deductQuotaOnce: async () => {
      calls.push("deductQuotaOnce");
      return true;
    },
    updateStatus: async () => {
      calls.push("updateStatus");
      return {};
    },
    notify: async () => {
      calls.push("notify");
      return {};
    },
    ...overrides,
  };
  return { deps: d, calls };
}

test("a session past its confirmation deadline is charged and released via deductQuotaOnce", async () => {
  const args: unknown[] = [];
  const { deps: d, calls } = deps({
    deductQuotaOnce: async (sessionId, contractId) => {
      calls.push("deductQuotaOnce");
      args.push([sessionId, contractId]);
      return true;
    },
  });

  const result = await runAutoConfirm(d);

  assert.deepEqual(result, { scanned: 1, confirmed: 1 });
  assert.deepEqual(args[0], ["s1", "c1"], "the exact session and contract the deadline sweep found");
  assert.deepEqual(calls, ["findExpiredPendingConfirmation", "deductQuotaOnce", "updateStatus", "notify"]);
});

test("nothing to confirm short-circuits without touching quota or status", async () => {
  const { deps: d, calls } = deps({
    findExpiredPendingConfirmation: async () => {
      calls.push("findExpiredPendingConfirmation");
      return [];
    },
  });

  const result = await runAutoConfirm(d);

  assert.deepEqual(result, { scanned: 0, confirmed: 0 });
  assert.deepEqual(calls, ["findExpiredPendingConfirmation"]);
});

test("a per-row failure does not stop the rest of the batch", async () => {
  const rows = [
    { id: "s1", contractId: "c1", clientUserId: "client-1" },
    { id: "s2", contractId: "c2", clientUserId: "client-2" },
  ];
  const deducted: string[] = [];
  const { deps: d, calls } = deps({
    findExpiredPendingConfirmation: async () => rows,
    deductQuotaOnce: async (sessionId) => {
      deducted.push(sessionId);
      if (sessionId === "s1") throw new Error("transient DB error");
      return true;
    },
    updateStatus: async () => {
      calls.push("updateStatus");
      return {};
    },
  });

  const result = await runAutoConfirm(d);

  assert.deepEqual(deducted, ["s1", "s2"], "both rows are attempted");
  assert.equal(result.scanned, 2);
  assert.equal(result.confirmed, 1, "only the row that did not throw counts as confirmed");
  assert.equal(calls.filter((c) => c === "updateStatus").length, 1);
});
