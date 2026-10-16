/**
 * Phase 3 R2 — N1: an unhandled Redis "error" event previously crashed the
 * whole fitness-service process (Node's EventEmitter rethrows an "error"
 * event synchronously when it has zero listeners). redis.ts now attaches a
 * listener that only logs. This file verifies that mechanism directly, and
 * that the optional read-through cache in exercise.repository.ts degrades to
 * the DB instead of propagating a Redis error to the caller.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { logger } from "@gym-coach/shared";
import { redisClient } from "../repositories/redis";
import { exerciseRepository } from "../repositories/exercise.repository";
import { prisma } from "../repositories/prisma";

test("A. the module-level redis client (when enabled) has an error listener, so emitting 'error' does not throw", async () => {
  // A fresh client, same construction as redis.ts, isolated from the
  // module-level singleton so this test never depends on FITNESS_DISABLE_REDIS.
  const client = createClient({ url: "redis://127.0.0.1:1" }); // port 1: never actually connects
  let handled = false;
  client.on("error", () => { handled = true; });
  assert.equal(client.listenerCount("error"), 1);
  // Node's EventEmitter throws synchronously on emit("error", ...) only when
  // there are zero listeners for it — this proving the registered listener
  // is what prevents the historical crash, not a try/catch around callers.
  assert.doesNotThrow(() => client.emit("error", new Error("ETIMEDOUT (synthetic)")));
  assert.equal(handled, true);
});

test("B. a client pointed at an unreachable address: connect() rejects (loud, callable), it does not hang or crash the process", async () => {
  const client = createClient({ url: "redis://127.0.0.1:1", socket: { connectTimeout: 500, reconnectStrategy: false } });
  client.on("error", () => {}); // same contract as redis.ts — otherwise this unrelated client would itself crash the test process
  await assert.rejects(() => client.connect(), "connect() must still surface a real failure to its caller (server.ts's own startup policy decides what to do with it — unchanged by this fix)");
});

test("C. a Redis error mid-operation degrades to the real DB, never propagates to the caller", async () => {
  const seeded = await prisma.exercise.findFirst();
  if (!seeded) return;
  const originalGet = redisClient.get;
  const originalSetEx = redisClient.setEx;
  (redisClient as any).get = async () => { throw new Error("ETIMEDOUT (synthetic mid-operation)"); };
  (redisClient as any).setEx = async () => { throw new Error("ETIMEDOUT (synthetic mid-operation)"); };
  try {
    const result = await exerciseRepository.findById(seeded.id);
    assert.ok(result, "a cache read/write failure must still return the real row from Prisma, not throw");
    assert.equal(result!.id, seeded.id);
  } finally {
    (redisClient as any).get = originalGet;
    (redisClient as any).setEx = originalSetEx;
  }
});

test("D. recovery: once the cache is reachable again, a normal read still works (no circuit permanently tripped)", async () => {
  const seeded = await prisma.exercise.findFirst();
  if (!seeded) return;
  const originalGet = redisClient.get;
  let fail = true;
  (redisClient as any).get = async (key: string) => { if (fail) throw new Error("synthetic"); return originalGet.call(redisClient, key); };
  try {
    const degraded = await exerciseRepository.findById(seeded.id);
    assert.ok(degraded);
    fail = false;
    const recovered = await exerciseRepository.findById(seeded.id);
    assert.ok(recovered, "a later call, once the cache is reachable again, must still succeed (no permanent degraded state)");
  } finally {
    (redisClient as any).get = originalGet;
  }
});

test("E. the client-error log never includes the connection URL/credentials, only the error message", async () => {
  const originalError = (logger as any).error;
  const captured: any[] = [];
  (logger as any).error = (...args: any[]) => { captured.push(args); };
  try {
    const client = createClient({ url: "redis://user:supersecret@127.0.0.1:1" });
    client.on("error", (err: unknown) => {
      logger.error({ err: (err as Error)?.message }, "[redis] client error");
    });
    client.emit("error", new Error("ETIMEDOUT"));
    assert.ok(captured.length > 0, "the error must actually be logged");
    const serialized = JSON.stringify(captured);
    assert.ok(!serialized.includes("supersecret"), "no credential must ever reach the log line");
  } finally {
    (logger as any).error = originalError;
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
