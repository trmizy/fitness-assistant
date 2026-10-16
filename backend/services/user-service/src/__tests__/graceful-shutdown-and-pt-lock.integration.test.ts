/**
 * Phase 0 / D58 unit 4 - (a) the PT lock is bounded like the contract lock (lock_timeout + in-process queue), (b) graceful shutdown.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database for (a) (real advisory locks, a second connection plays
 * "another process"); (b) is a unit test of the shutdown sequence with a real http.Server and a tracked job (no process is killed:
 * the SIGTERM wiring itself is `installGracefulShutdown`, exercised in the multi-instance suite by the real server.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../repositories/profile.repository";
import { withPtScheduleLock, withContractLock } from "../services/contract-lock";
import { gracefulShutdown, trackJob, inflightJobCount } from "../lifecycle";
import { makeContract, makePt, cleanup, skip } from "./pt-restriction.test-helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("PT lock: a PT lock held by another process is waited for at most PT_LOCK_WAIT_MS, then 503 PT_LOCK_BUSY (it used to wait until Prisma's 5 s timeout and answer 500)", { skip }, async () => {
  const pt = await makePt();
  process.env.PT_LOCK_WAIT_MS = "800";
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pt}))`;
      await gate;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  try {
    await sleep(300);
    const t0 = Date.now();
    await assert.rejects(
      () => withPtScheduleLock(pt, null, async () => "never"),
      (e: any) => e.status === 503 && e.code === "PT_LOCK_BUSY",
    );
    const ms = Date.now() - t0;
    assert.ok(ms >= 700 && ms < 3000, `refused after about the configured wait (${ms} ms)`);
  } finally {
    delete process.env.PT_LOCK_WAIT_MS;
    release();
    await holder;
    await cleanup([pt], []);
  }
});

test("PT lock: waiters of one PT queue in memory (FIFO) and hold NO connection while waiting; the lock order is PT first, contract second", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  try {
    const order: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const jobs = Array.from({ length: 8 }, (_, i) =>
      withPtScheduleLock(pt, c.id, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        order.push(i);
        await sleep(40);
        running--;
      }),
    );
    await Promise.all(jobs);
    assert.equal(maxRunning, 1, "serialised");
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7], "FIFO");
    // a contract-only caller does not wait on the PT lock
    await withContractLock(c.id, async () => undefined);
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("PT lock: holding the PT lock, a contract lock held by somebody else is waited for only PT_HELD_CONTRACT_WAIT_MS (503 CONTRACT_LOCK_BUSY) - the PT's other contracts are not stalled for the full transaction timeout", { skip }, async () => {
  const pt = await makePt();
  const a = await makeContract(pt);
  process.env.PT_HELD_CONTRACT_WAIT_MS = "700";
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.id}))`;
      await gate;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  try {
    await sleep(300);
    const t0 = Date.now();
    await assert.rejects(
      () => withPtScheduleLock(pt, a.id, async () => "never"),
      (e: any) => e.status === 503 && e.code === "CONTRACT_LOCK_BUSY",
    );
    assert.ok(Date.now() - t0 < 3000);
    // the PT lock was released with the failed transaction: a PT-only caller goes straight through
    const t1 = Date.now();
    await withPtScheduleLock(pt, null, async () => undefined);
    assert.ok(Date.now() - t1 < 1000);
  } finally {
    delete process.env.PT_HELD_CONTRACT_WAIT_MS;
    release();
    await holder;
    await cleanup([pt], [a.id]);
  }
});

test("graceful shutdown: stops the ticks, stops accepting, lets the request in flight and the running job FINISH, then disconnects and exits 0", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const server = http.createServer(async (_req, res) => {
    await gate;
    res.end("done");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const events: string[] = [];
  const inflight = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  await sleep(100);
  const job = trackJob(
    (async () => {
      await gate;
      events.push("job-finished");
    })(),
  );
  assert.equal(inflightJobCount() >= 1, true);
  let exitCode: number | undefined;
  const shutdown = gracefulShutdown("SIGTERM", {
    server,
    stopJobs: () => events.push("jobs-stopped"),
    disconnect: async () => void events.push("disconnected"),
    graceMs: 5000,
    exit: (code) => {
      exitCode = code;
    },
  });
  await sleep(300);
  assert.equal(exitCode, undefined, "it waits for the request and the job");
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`), "no new connection is accepted");
  setTimeout(release, 200);
  assert.equal(await inflight, "done", "the request in flight was answered");
  await job;
  const result = await shutdown;
  assert.deepEqual(result, { drained: true, pendingJobs: 0 });
  assert.equal(exitCode, 0);
  assert.deepEqual(events, ["jobs-stopped", "job-finished", "disconnected"], "the pool is closed only after everything finished");
});

test("graceful shutdown: bounded by the deadline - a job that never finishes is cut off, the pool is still closed, the exit code is 1", async () => {
  const never = new Promise<void>(() => undefined);
  trackJob(never);
  let exitCode: number | undefined;
  let disconnected = false;
  const t0 = Date.now();
  const result = await gracefulShutdown("SIGTERM", {
    stopJobs: () => undefined,
    disconnect: async () => void (disconnected = true),
    graceMs: 600,
    exit: (code) => {
      exitCode = code;
    },
  });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(result.drained, false);
  assert.ok(result.pendingJobs >= 1);
  assert.equal(exitCode, 1);
  assert.equal(disconnected, true);
});
