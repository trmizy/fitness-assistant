import test from "node:test";
import assert from "node:assert/strict";
import { settleTracked, type SettlementDeps, type SettlementRow } from "../services/session-settlement.service";
import { SessionSettlementKind } from "../generated/prisma";

/**
 * Money-flow redesign plan item 1.6 — unit coverage for the retry-tracking wrapper itself
 * (pure DI, no DB). The end-to-end proof that this actually fixes the stuck-session bug lives
 * in no-show-compensation-is-retryable.test.ts, which exercises the real
 * compensateNoShowMoney/addException call sites.
 */

function deps(overrides: Partial<SettlementDeps> = {}): { deps: SettlementDeps; calls: string[]; row: SettlementRow } {
  const calls: string[] = [];
  const row: SettlementRow = { id: "row-1", status: "PENDING" };
  const d: SettlementDeps = {
    upsertPending: async () => {
      calls.push("upsertPending");
      return row;
    },
    markProcessing: async (id) => {
      calls.push("markProcessing");
      assert.equal(id, "row-1");
    },
    markSettled: async (id) => {
      calls.push("markSettled");
      assert.equal(id, "row-1");
    },
    markFailed: async (id, error) => {
      calls.push("markFailed:" + error);
      assert.equal(id, "row-1");
    },
    ...overrides,
  };
  return { deps: d, calls, row };
}

test("a successful run is recorded PROCESSING then SETTLED, in order", async () => {
  const { deps: d, calls } = deps();
  let ran = false;

  await settleTracked(
    { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: "SESSION_RELEASE:s1", contractId: "c1", sessionId: "s1" },
    async () => {
      ran = true;
    },
    d,
  );

  assert.equal(ran, true);
  assert.deepEqual(calls, ["upsertPending", "markProcessing", "markSettled"]);
});

test("a failing run is recorded FAILED and does NOT rethrow", async () => {
  const { deps: d, calls } = deps();

  await assert.doesNotReject(() =>
    settleTracked(
      { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey: "PT_NO_SHOW:s1", contractId: "c1", sessionId: "s1" },
      async () => {
        throw new Error("payment-service unreachable");
      },
      d,
    ),
  );

  assert.deepEqual(calls, ["upsertPending", "markProcessing", "markFailed:payment-service unreachable"]);
});

test("an already-SETTLED row is left alone — run is never called again", async () => {
  const calls: string[] = [];
  const d: SettlementDeps = {
    upsertPending: async () => {
      calls.push("upsertPending");
      return { id: "row-1", status: "SETTLED" };
    },
    markProcessing: async () => {
      calls.push("markProcessing");
    },
    markSettled: async () => {
      calls.push("markSettled");
    },
    markFailed: async () => {
      calls.push("markFailed");
    },
  };
  let ran = false;

  await settleTracked(
    { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: "SESSION_RELEASE:s1", contractId: "c1" },
    async () => {
      ran = true;
    },
    d,
  );

  assert.equal(ran, false, "a retry of an already-settled operation must not run the money-moving code again");
  assert.deepEqual(calls, ["upsertPending"]);
});

test("a FAILED row is retried — markProcessing runs again even though status was not PENDING", async () => {
  const calls: string[] = [];
  const d: SettlementDeps = {
    upsertPending: async () => {
      calls.push("upsertPending");
      return { id: "row-1", status: "FAILED" };
    },
    markProcessing: async () => {
      calls.push("markProcessing");
    },
    markSettled: async () => {
      calls.push("markSettled");
    },
    markFailed: async () => {
      calls.push("markFailed");
    },
  };
  let ran = false;

  await settleTracked(
    { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: "SESSION_RELEASE:s1", contractId: "c1" },
    async () => {
      ran = true;
    },
    d,
  );

  assert.equal(ran, true);
  assert.deepEqual(calls, ["upsertPending", "markProcessing", "markSettled"]);
});
