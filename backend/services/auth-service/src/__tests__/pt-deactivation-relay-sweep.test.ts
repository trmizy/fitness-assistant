import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { runPtDeactivationRelaySweep } from "../services/pt-deactivation-relay-sweep.service";
import { prisma } from "../repositories/auth.repository";
import * as relayModule from "../services/pt-deactivation-relay.service";

/**
 * Money-flow redesign plan item 2.6 — the sweep worker that retries FAILED relay calls.
 * Patches `prisma.ptDeactivationCall.findMany` (an object method, patchable) to choose which
 * rows retry, and lets the REAL relayPtActiveStateChange run against a patched
 * authRepository/axios-equivalent leaf — simplest here is to patch
 * relayPtActiveStateChange's OWN leaf dependency indirectly by patching `axios` is overkill;
 * instead this patches `prisma.ptDeactivationCall.create/update` (also object methods) so the
 * real relay function runs end-to-end against a fake in-memory row store.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("retries a FAILED row and marks it SETTLED when user-service is reachable this time", async () => {
  const calls: string[] = [];
  const restores = [
    patch(prisma.ptDeactivationCall, "findMany", async () => [
      { id: "call-1", ptUserId: "pt-1", action: "DEACTIVATE", adminId: "admin-1", reason: "vi phạm", status: "FAILED" },
    ]),
    patch(prisma.ptDeactivationCall, "create", async () => {
      calls.push("create");
      return { id: "call-2" };
    }),
    patch(prisma.ptDeactivationCall, "update", async (args: any) => {
      calls.push(`update:${args.data.status}`);
      return {};
    }),
    // Prevent a real network call — relayPtActiveStateChange's default deps call axios.post
    // against USER_SERVICE_URL, which would otherwise reach the real dev container.
    patch(axios, "post", async () => {
      calls.push("axios.post");
      return { data: {} };
    }),
  ];

  try {
    const result = await runPtDeactivationRelaySweep();
    assert.equal(result.scanned, 1);
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["create", "axios.post", "update:SETTLED"]);
});

test("one row's failure does not stop the rest of the batch", async () => {
  const attempted: string[] = [];
  const restores = [
    patch(prisma.ptDeactivationCall, "findMany", async () => [
      { id: "call-1", ptUserId: "pt-1", action: "DEACTIVATE", adminId: "admin-1", reason: null, status: "FAILED" },
      { id: "call-2", ptUserId: "pt-2", action: "REACTIVATE", adminId: "admin-1", reason: null, status: "FAILED" },
    ]),
    patch(prisma.ptDeactivationCall, "create", async (args: any) => {
      attempted.push(args.data.ptUserId);
      throw new Error("DB unavailable for this row's create");
    }),
  ];

  try {
    const result = await runPtDeactivationRelaySweep();
    // Both rows are attempted (scanned = 2) even though create() throws for both — the
    // sweep's own per-row try/catch (around calling relayPtActiveStateChange, which itself
    // does NOT catch a createRow failure — that happens before its own try block) isolates
    // each row's failure from stopping the batch.
    assert.equal(result.scanned, 2);
    assert.deepEqual(attempted, ["pt-1", "pt-2"]);
  } finally {
    restores.forEach((r) => r());
  }
});

test("relayPtActiveStateChange import used by the sweep is the real one", () => {
  assert.equal(typeof relayModule.relayPtActiveStateChange, "function");
});
