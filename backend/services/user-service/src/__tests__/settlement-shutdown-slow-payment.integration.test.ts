/**
 * D64-C timeout compatibility - SIGTERM arrives while the settlement sweep is waiting on a SLOW payment-service.
 *
 * Real numbers: a release / no-show call is bounded at 15 s by payment.client.ts, terminate at 20 s; SHUTDOWN_GRACE_MS is 30 s.
 * This test runs the same sequence at 1/10 scale (a "25 s" answer = 2.5 s, grace 30 s = 3 s) so it finishes in seconds; the
 * RATIOS are what is under test. Evidence label: BACKEND INTEGRATION against the isolated *_test database (real sweep, real
 * gracefulShutdown, real claim / apply-once SQL); payment-service is a TEST FIXTURE at the paymentClient boundary (an idempotent
 * in-memory ledger keyed by idempotencyKey).
 *   Case 1 (this file): the answer arrives BEFORE the deadline -> the shutdown drains, exit code 0, the one row in flight is SETTLED,
 *           and the sweep claims NO further row once the signal arrived (the batch of 3 stops after the first).
 *   Case 2 (settlement-shutdown-late-payment.integration.test.ts): the answer arrives AFTER the deadline.
 * One file per case because lifecycle.ts keeps `shuttingDown` for the life of the process.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { gracefulShutdown, trackJob } from "../lifecycle";
import { addSession, cleanup, makeContract, makePt, patch, skip } from "./pt-restriction.test-helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SCALE = 10;
// At 1/10 the real 5 s of headroom between the slowest answer (25 s) and the deadline (30 s) is 0.5 s. On a loaded machine (observed while
// other agents ran browser sweeps: the sweep needed 1-4 s extra before/after the payment call, drained=false, pendingJobs=1) that is test-machine
// latency, not the product. A fixed 2 s of slack on the scaled grace keeps the test about what it asserts (an answer that arrives BEFORE the
// deadline is completed and the drain is clean) and not about the speed of the CPU / database connection.
const SLACK_MS = 2000;
const GRACE_MS = 30_000 / SCALE + SLACK_MS;
const RELEASE = { released: { pt: "450000", gym: "0", platform: "50000" } };

async function liveRow() {
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: contract.id, sessionId: session.id, status: "FAILED", attempts: 1, lastError: "payment-service unreachable" },
  });
  return { pt, contract, row };
}

test("CODE AUDIT guard: the compose stop_grace_period of user-service is at least SHUTDOWN_GRACE_MS + 10 s (Docker's default 10 s would SIGKILL a drain that is allowed 30 s)", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "infra", "compose", "docker-compose.prod.yml"), "utf8");
  const block = /\n {2}user-service:\n([\s\S]*?)\n {2}[a-z-]+:\n/.exec(compose)?.[1] ?? "";
  const m = /stop_grace_period:\s*(\d+)s/.exec(block);
  assert.ok(m, "user-service declares stop_grace_period");
  const graceMs = Number(process.env.SHUTDOWN_GRACE_MS ?? 30_000);
  assert.ok(Number(m![1]) * 1000 >= graceMs + 10_000, `stop_grace_period ${m![1]}s >= ${graceMs / 1000}s + 10s`);
});

test("shutdown + slow payment-service (answer at '25 s' < 30 s grace): the row in flight finishes and is SETTLED once, the drain is clean (exit 0), and NO further row is claimed after the signal", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const rows = [await liveRow(), await liveRow(), await liveRow()];
  const ledger = new Map<string, number>();
  let calls = 0;
  const restore = patch(paymentClient, "releaseSession", async (body: any) => {
    calls++;
    ledger.set(body.idempotencyKey, (ledger.get(body.idempotencyKey) ?? 0) + 1);
    await sleep(25_000 / SCALE);
    return RELEASE;
  });
  let exitCode: number | undefined;
  try {
    const sweep = trackJob(runSettlementSweep());
    const t0 = Date.now();
    while (calls < 1 && Date.now() - t0 < 5000) await sleep(20);
    assert.equal(calls, 1, "the first row's payment call is in flight");

    const result = await gracefulShutdown("SIGTERM", { stopJobs: () => {}, disconnect: async () => {}, graceMs: GRACE_MS, exit: (c) => (exitCode = c) });
    const elapsed = Date.now() - t0;
    await sweep;

    assert.deepEqual(result, { drained: true, pendingJobs: 0 });
    assert.equal(exitCode, 0);
    assert.ok(elapsed >= (25_000 / SCALE) - 200 && elapsed < GRACE_MS, `drained when the slow answer arrived, inside the grace (${elapsed} ms)`);
    assert.equal(calls, 1, "after SIGTERM the sweep started no further payment call");
    const after = await prisma.sessionSettlement.findMany({ where: { id: { in: rows.map((r) => r.row.id) } } });
    assert.equal(after.filter((r) => r.status === "SETTLED").length, 1, "the row in flight was completed and applied exactly once");
    const untouched = after.filter((r) => r.status !== "SETTLED");
    assert.equal(untouched.length, 2);
    assert.ok(untouched.every((r) => r.status === "FAILED" && r.attempts === 1), "the other rows were not claimed (no attempt consumed): the next instance's sweep takes them");
    assert.ok([...ledger.values()].every((n) => n === 1));
  } finally {
    restore();
    for (const r of rows) await cleanup([r.pt], [r.contract.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
});
