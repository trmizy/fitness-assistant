import test from "node:test";
import assert from "node:assert/strict";
import { relayPtActiveStateChange, type RelayDeps } from "../services/pt-deactivation-relay.service";

/**
 * Money-flow redesign plan item 2.6 — unit coverage for the relay itself (pure DI, no DB/HTTP).
 * End-to-end proof that locking a PT's account actually calls this now lives in
 * set-user-active-relays-pt-deactivation.test.ts.
 */

function deps(overrides: Partial<RelayDeps> = {}): { deps: RelayDeps; calls: string[] } {
  const calls: string[] = [];
  const d: RelayDeps = {
    createRow: async () => {
      calls.push("createRow");
      return { id: "row-1" };
    },
    callUserService: async () => {
      calls.push("callUserService");
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
  return { deps: d, calls };
}

test("a successful relay call is recorded SETTLED", async () => {
  const { deps: d, calls } = deps();
  await relayPtActiveStateChange("pt-1", "DEACTIVATE", "admin-1", "vi phạm điều khoản", d);
  assert.deepEqual(calls, ["createRow", "callUserService", "markSettled"]);
});

test("a failing relay call is recorded FAILED and does NOT throw — the account lock itself must still succeed", async () => {
  const { deps: d, calls } = deps({
    callUserService: async () => {
      throw new Error("user-service unreachable");
    },
  });

  await assert.doesNotReject(() => relayPtActiveStateChange("pt-1", "DEACTIVATE", "admin-1", undefined, d));
  assert.deepEqual(calls, ["createRow", "markFailed:user-service unreachable"]);
});

test("REACTIVATE is relayed the same way as DEACTIVATE", async () => {
  const args: unknown[] = [];
  const { deps: d, calls } = deps({
    callUserService: async (ptUserId, action, adminId, reason) => {
      calls.push("callUserService");
      args.push([ptUserId, action, adminId, reason]);
    },
  });

  await relayPtActiveStateChange("pt-1", "REACTIVATE", "admin-1", undefined, d);
  assert.deepEqual(args[0], ["pt-1", "REACTIVATE", "admin-1", undefined]);
});
