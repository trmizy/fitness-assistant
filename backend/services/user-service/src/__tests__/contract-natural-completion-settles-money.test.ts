import test from "node:test";
import assert from "node:assert/strict";
import { contractService, type CompleteContractDeps } from "../services/contract.service";
import { ContractStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan item 1.2 — "hợp đồng hoàn thành tự nhiên không bao giờ được
 * quyết toán".
 *
 * `checkAndCompleteContract` used to only flip the contract's status to COMPLETED; it never
 * called `terminateContractMoney`, so the escrow money behind a contract that simply ran out
 * of sessions (the ordinary, happy-path way a PT contract ends) was NEVER released — it sat
 * in the pending buckets forever. Only an explicit manual `terminate` call settled money.
 *
 * Same injectable-deps pattern as `deductQuotaOnce` in booking.service.ts's own tests
 * (session-quota.test.ts) — no DB, no HTTP, just the collaborators this function actually
 * calls, so the money-settlement contract is provable in isolation.
 */

function deps(overrides: Partial<CompleteContractDeps> = {}): { deps: CompleteContractDeps; calls: Record<string, number> } {
  const calls = { findById: 0, updateStatus: 0, settleMoney: 0 };
  const d: CompleteContractDeps = {
    findById: async () => {
      calls.findById++;
      return { id: "c1", status: ContractStatus.ACTIVE, usedSessions: 10, totalSessions: 10, compensatedSessions: 0 };
    },
    updateStatus: async () => {
      calls.updateStatus++;
      return { id: "c1", status: ContractStatus.COMPLETED } as any;
    },
    settleMoney: async () => {
      calls.settleMoney++;
    },
    ...overrides,
  };
  return { deps: d, calls };
}

test("a contract whose sessions are exhausted settles its money on natural completion", async () => {
  const settleArgs: unknown[] = [];
  const { deps: d, calls } = deps({
    settleMoney: async (contractId, reason) => {
      calls.settleMoney++;
      settleArgs.push([contractId, reason]);
    },
  });

  await contractService.checkAndCompleteContract("c1", d);

  assert.equal(calls.updateStatus, 1, "status flips to COMPLETED");
  assert.equal(calls.settleMoney, 1, "terminateContractMoney is called exactly once — the plan 1.2 fix");
  assert.deepEqual(settleArgs[0], ["c1", "COMPLETED"], "settled with the contract id and reason COMPLETED");
});

test("does not settle money when sessions are not yet exhausted", async () => {
  const { deps: d, calls } = deps({
    findById: async () => {
      calls.findById++;
      return { id: "c1", status: ContractStatus.ACTIVE, usedSessions: 5, totalSessions: 10, compensatedSessions: 0 };
    },
    updateStatus: async () => {
      throw new Error("updateStatus must not be called — the contract has not finished");
    },
  });

  const result = await contractService.checkAndCompleteContract("c1", d);

  assert.equal(result, null);
  assert.equal(calls.settleMoney, 0);
});

test("does nothing for a contract that is not ACTIVE", async () => {
  const { deps: d, calls } = deps({
    findById: async () => ({ id: "c1", status: ContractStatus.CANCELLED, usedSessions: 10, totalSessions: 10, compensatedSessions: 0 }),
    updateStatus: async () => {
      throw new Error("updateStatus must not be called");
    },
  });

  const result = await contractService.checkAndCompleteContract("c1", d);

  assert.equal(result, null);
  assert.equal(calls.settleMoney, 0);
});

test("completes via compensatedSessions even though usedSessions alone never reaches totalSessions", async () => {
  // Money-flow plan 1.5's exact worked example: 12 sessions bought, PT no-showed twice
  // (compensated in cash, no quota mutation), client trained 10. Before this fix,
  // totalSessions itself would have been decremented to 10 by the two no-shows, so
  // usedSessions (10) >= totalSessions (10) still accidentally completed it — but for the
  // WRONG reason, and every per-session price along the way would have drifted. Now
  // totalSessions stays 12 (immutable) and completion is driven by consumedEntitlements.
  const { deps: d, calls } = deps({
    findById: async () => {
      calls.findById++;
      return { id: "c1", status: ContractStatus.ACTIVE, usedSessions: 10, totalSessions: 12, compensatedSessions: 2 };
    },
  });

  const result = await contractService.checkAndCompleteContract("c1", d);

  assert.equal(calls.updateStatus, 1, "the contract completes");
  assert.equal(calls.settleMoney, 1, "and its money settles");
  assert.ok(result);
});

test("does NOT complete when usedSessions + compensatedSessions is still short", async () => {
  const { deps: d, calls } = deps({
    findById: async () => {
      calls.findById++;
      return { id: "c1", status: ContractStatus.ACTIVE, usedSessions: 9, totalSessions: 12, compensatedSessions: 2 };
    },
    updateStatus: async () => {
      throw new Error("updateStatus must not be called — one entitlement remains");
    },
  });

  const result = await contractService.checkAndCompleteContract("c1", d);

  assert.equal(result, null);
  assert.equal(calls.settleMoney, 0);
});

test("a money-settlement failure does not roll back the status change", async () => {
  // Best-effort by design: the session lifecycle has already moved on (status flips first),
  // and a payment-service outage must not leave the contract stuck ACTIVE. Idempotency
  // (plan 1.1, key CONTRACT_TERMINATE:<id>) makes a later retry of the settlement safe.
  const { deps: d, calls } = deps({
    settleMoney: async () => {
      calls.settleMoney++;
      throw new Error("payment-service unreachable");
    },
  });

  const result = await contractService.checkAndCompleteContract("c1", d);

  assert.equal(calls.updateStatus, 1, "the contract still completes");
  assert.equal(calls.settleMoney, 1, "settlement was attempted");
  assert.ok(result, "the caller still gets the completed contract back");
});
