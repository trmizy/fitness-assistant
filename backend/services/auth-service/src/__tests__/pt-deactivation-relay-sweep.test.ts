import test from "node:test";
import assert from "node:assert/strict";
import { runPtDeactivationRelaySweep } from "../services/pt-deactivation-relay-sweep.service";
import { prisma } from "../repositories/auth.repository";
import * as relayModule from "../services/pt-deactivation-relay.service";
import type { RelayDeps } from "../services/pt-deactivation-relay.service";

/**
 * Money-flow redesign plan item 2.6 — the sweep worker that retries FAILED relay calls.
 * Patches `prisma.ptDeactivationCall.findMany` (an object method, patchable) to choose which
 * rows retry, and injects the delivery dependencies (RelayDeps) so no DB write or network call
 * happens.
 *
 * PT-lock slice 1: the sweep re-sends the SAME row (it no longer creates a fresh one each tick,
 * which left the old FAILED row to be re-sent forever), and a row with a newer command for the
 * same PT is retired as SUPERSEDED instead of sent.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const row = (over: Record<string, unknown>) => ({
  id: "call-1",
  ptUserId: "pt-1",
  action: "DEACTIVATE",
  adminId: "admin-1",
  reason: null,
  status: "FAILED",
  seq: 1n,
  ...over,
});

function fakeDeps(log: string[], overrides: Partial<RelayDeps> = {}): RelayDeps {
  return {
    createRow: async () => {
      log.push("createRow");
      return { id: "never", seq: 0n };
    },
    hasNewerCall: async () => false,
    callUserService: async (pt, action, _admin, _reason, seq) => {
      log.push(`call:${pt}:${action}:${seq}`);
    },
    markSettled: async (id) => {
      log.push(`settled:${id}`);
    },
    markFailed: async (id, e) => {
      log.push(`failed:${id}:${e}`);
    },
    markSuperseded: async (id) => {
      log.push(`superseded:${id}`);
    },
    ...overrides,
  };
}

test("retries a FAILED row IN PLACE (same row, same seq) and marks that row SETTLED", async () => {
  const log: string[] = [];
  const restore = patch(prisma.ptDeactivationCall, "findMany", async () => [row({ seq: 12n, reason: "vi phạm" })]);
  try {
    const result = await runPtDeactivationRelaySweep(fakeDeps(log));
    assert.deepEqual(result, { scanned: 1, retried: 1, superseded: 0 });
  } finally {
    restore();
  }
  assert.deepEqual(log, ["call:pt-1:DEACTIVATE:12", "settled:call-1"], "no new row is created");
});

test("an old FAILED lock for a PT that has since been unlocked is retired, never re-sent", async () => {
  const log: string[] = [];
  const restore = patch(prisma.ptDeactivationCall, "findMany", async () => [row({ id: "old-lock", seq: 5n })]);
  try {
    const result = await runPtDeactivationRelaySweep(
      fakeDeps(log, { hasNewerCall: async (pt, seq) => pt === "pt-1" && seq === 5n }),
    );
    assert.deepEqual(result, { scanned: 1, retried: 0, superseded: 1 });
  } finally {
    restore();
  }
  assert.deepEqual(log, ["superseded:old-lock"], "user-service is not called at all");
});

test("the sweep selects FAILED rows and PENDING rows that went quiet, oldest seq first", async () => {
  let seen: any;
  const restore = patch(prisma.ptDeactivationCall, "findMany", async (args: any) => {
    seen = args;
    return [];
  });
  try {
    await runPtDeactivationRelaySweep(fakeDeps([]));
  } finally {
    restore();
  }
  assert.deepEqual(seen.orderBy, { seq: "asc" });
  assert.equal(seen.where.OR.length, 2);
  assert.deepEqual(seen.where.OR[0], { status: "FAILED" });
  assert.equal(seen.where.OR[1].status, "PENDING");
  assert.ok(seen.where.OR[1].updatedAt.lt instanceof Date);
});

test("one row's failure does not stop the rest of the batch", async () => {
  const attempted: string[] = [];
  const restore = patch(prisma.ptDeactivationCall, "findMany", async () => [
    row({ id: "call-1", ptUserId: "pt-1", seq: 1n }),
    row({ id: "call-2", ptUserId: "pt-2", action: "REACTIVATE", seq: 2n }),
  ]);
  try {
    const result = await runPtDeactivationRelaySweep(
      fakeDeps([], {
        callUserService: async (pt) => {
          attempted.push(pt);
          throw new Error("user-service unreachable");
        },
      }),
    );
    assert.equal(result.scanned, 2);
    assert.deepEqual(attempted, ["pt-1", "pt-2"]);
  } finally {
    restore();
  }
});

test("relayPtActiveStateChange import used by the sweep is the real one", () => {
  assert.equal(typeof relayModule.relayPtActiveStateChange, "function");
  assert.equal(typeof relayModule.attemptPtDeactivationCall, "function");
});
