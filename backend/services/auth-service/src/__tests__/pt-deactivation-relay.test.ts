import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptPtDeactivationCall,
  relayPtActiveStateChange,
  type RelayDeps,
} from "../services/pt-deactivation-relay.service";

/**
 * Money-flow redesign plan item 2.6 — unit coverage for the relay itself (pure DI, no DB/HTTP).
 * End-to-end proof that locking a PT's account actually calls this now lives in
 * set-user-active-relays-pt-deactivation.test.ts.
 *
 * PT-lock slice 1 additions: a command that has a newer one for the same PT is SUPERSEDED and never
 * sent; a "stale" answer from user-service retires the row; the command's seq travels to user-service.
 */

function deps(overrides: Partial<RelayDeps> = {}): { deps: RelayDeps; calls: string[] } {
  const calls: string[] = [];
  const d: RelayDeps = {
    createRow: async () => {
      calls.push("createRow");
      return { id: "row-1", seq: 7n };
    },
    hasNewerCall: async () => {
      calls.push("hasNewerCall");
      return false;
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
    markSuperseded: async (id) => {
      calls.push("markSuperseded");
      assert.equal(id, "row-1");
    },
    ...overrides,
  };
  return { deps: d, calls };
}

test("a successful relay call is recorded SETTLED", async () => {
  const { deps: d, calls } = deps();
  await relayPtActiveStateChange("pt-1", "DEACTIVATE", "admin-1", "vi phạm điều khoản", d);
  assert.deepEqual(calls, ["createRow", "hasNewerCall", "callUserService", "markSettled"]);
});

test("a failing relay call is recorded FAILED and does NOT throw — the account lock itself must still succeed", async () => {
  const { deps: d, calls } = deps({
    callUserService: async () => {
      throw new Error("user-service unreachable");
    },
  });

  await assert.doesNotReject(() => relayPtActiveStateChange("pt-1", "DEACTIVATE", "admin-1", undefined, d));
  assert.deepEqual(calls, ["createRow", "hasNewerCall", "markFailed:user-service unreachable"]);
});

test("REACTIVATE is relayed the same way as DEACTIVATE, and the command's seq goes with it", async () => {
  const args: unknown[] = [];
  const { deps: d, calls } = deps({
    callUserService: async (ptUserId, action, adminId, reason, seq) => {
      calls.push("callUserService");
      args.push([ptUserId, action, adminId, reason, seq]);
    },
  });

  await relayPtActiveStateChange("pt-1", "REACTIVATE", "admin-1", undefined, d);
  assert.deepEqual(args[0], ["pt-1", "REACTIVATE", "admin-1", undefined, 7n]);
});

test("a command with a NEWER command for the same PT is retired as SUPERSEDED and never sent", async () => {
  const { deps: d, calls } = deps({
    hasNewerCall: async () => {
      calls.push("hasNewerCall");
      return true;
    },
  });

  const result = await attemptPtDeactivationCall({ id: "row-1", ptUserId: "pt-1", action: "DEACTIVATE", adminId: "a", seq: 5n }, d);
  assert.equal(result, "SUPERSEDED");
  assert.deepEqual(calls, ["hasNewerCall", "markSuperseded"]);
});

test("the newer-command check is made against THIS row's seq and PT", async () => {
  const seen: unknown[] = [];
  const { deps: d } = deps({
    hasNewerCall: async (ptUserId, seq) => {
      seen.push([ptUserId, seq]);
      return false;
    },
  });
  await attemptPtDeactivationCall({ id: "row-1", ptUserId: "pt-9", action: "DEACTIVATE", adminId: "a", seq: 42n }, d);
  assert.deepEqual(seen, [["pt-9", 42n]]);
});

test("user-service refusing the command as stale retires the row instead of retrying it forever", async () => {
  const { deps: d, calls } = deps({
    callUserService: async () => {
      calls.push("callUserService");
      return { stale: true };
    },
  });

  const result = await attemptPtDeactivationCall({ id: "row-1", ptUserId: "pt-1", action: "DEACTIVATE", adminId: "a", seq: 5n }, d);
  assert.equal(result, "SUPERSEDED");
  assert.deepEqual(calls, ["hasNewerCall", "callUserService", "markSuperseded"]);
});

test("an incomplete unwind (user-service answered with an error) keeps the row FAILED so the sweep retries it", async () => {
  const { deps: d, calls } = deps({
    callUserService: async () => {
      throw new Error("user-service 500: 1 hợp đồng chưa xử lý xong [c-1: payment-service 503]");
    },
  });

  const result = await attemptPtDeactivationCall({ id: "row-1", ptUserId: "pt-1", action: "DEACTIVATE", adminId: "a", seq: 5n }, d);
  assert.equal(result, "FAILED");
  assert.match(calls[calls.length - 1], /^markFailed:user-service 500: 1 hợp đồng chưa xử lý xong/);
});
