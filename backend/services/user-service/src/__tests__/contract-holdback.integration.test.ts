/**
 * PT holdback — user-service side: the column, the pass-through to payment-service, and the
 * idle-release sweep.
 *
 * Evidence labels: BACKEND INTEGRATION for everything that reads or writes the real Postgres
 * (the isolated gymcoach_user_test database, NEVER the dev one — user-service's .env points at
 * dev, so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-holdback.integration.test.ts
 * payment-service itself is NOT running here: paymentClient's methods are stubbed at the client
 * boundary (TEST FIXTURE for that half), so these tests pin what user-service SENDS and what it
 * does with the answer. The money rules live in payment-service's pt-holdback.integration.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { paymentClient } from "../clients/payment.client";
import { releaseSessionMoney, terminateContractMoney, compensateNoShowMoney } from "../services/contract-payout.service";
import { runContractHoldbackSweep } from "../services/contract-expiry-sweep.service";
import { PT_HOLDBACK_IDLE_DAYS } from "../services/pt-holdback-rate";

const DAY = 24 * 3600 * 1000;
const usable = /_test/i.test(process.env.DATABASE_URL ?? "");
const skip = usable ? false : "Requires DATABASE_URL pointing at a *_test database.";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function makeContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Gói 10 buổi",
      totalSessions: 10,
      price: 5_000_000,
      status: "ACTIVE",
      paymentTransactionId: `txn-${randomUUID()}`,
      startDate: new Date(Date.now() - 40 * DAY),
      ptHoldbackRate: "0.10",
      ...overrides,
    },
  });
}

async function addSession(contractId: string, ptUserId: string, clientUserId: string, status: string, startOffsetDays: number) {
  const start = new Date(Date.now() + startOffsetDays * DAY);
  return prisma.session.create({
    data: {
      id: randomUUID(),
      contractId,
      ptUserId,
      clientUserId,
      status: status as any,
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + 3600 * 1000),
    },
  });
}

async function cleanup(ids: string[]) {
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: ids } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

const window = () => {
  const cutoff = new Date(Date.now() - PT_HOLDBACK_IDLE_DAYS * DAY);
  return { activatedBefore: cutoff, sessionsSince: cutoff };
};
const isCandidate = async (id: string) => (await contractRepository.findIdleHoldbackCandidates({ ...window(), id })).length === 1;

// ── The column ───────────────────────────────────────────────────────────────

test("the idle threshold defaults to 30 days", { skip }, () => {
  assert.equal(PT_HOLDBACK_IDLE_DAYS, 30);
});

test("a contract written without the new columns gets rate 0 and no release date — existing rows are not retroactively affected", { skip }, async () => {
  const c = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "legacy", totalSessions: 4 },
  });
  try {
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.ptHoldbackRate.toString(), "0");
    assert.equal(row.holdbackReleasedAt, null);
    const cols = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string; column_default: string | null; numeric_precision: number; numeric_scale: number }[]>(
      `SELECT column_name, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_name = 'contracts' AND column_name IN ('pt_holdback_rate', 'holdback_released_at') ORDER BY column_name`,
    );
    assert.equal(cols.length, 2);
    const rate = cols.find((x) => x.column_name === "pt_holdback_rate")!;
    assert.equal(rate.is_nullable, "NO", "NOT NULL");
    assert.equal(rate.numeric_precision, 6);
    assert.equal(rate.numeric_scale, 4);
    assert.match(String(rate.column_default), /^0/);
    assert.equal(cols.find((x) => x.column_name === "holdback_released_at")!.is_nullable, "YES");
  } finally {
    await cleanup([c.id]);
  }
});

// ── Pass-through to payment-service ──────────────────────────────────────────

test("rate 0: release-session and terminate bodies carry NO holdback key at all — byte-for-byte what they were", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0" });
  const bodies: Record<string, any>[] = [];
  const restoreRelease = patch(paymentClient, "releaseSession", async (b: any) => {
    bodies.push({ call: "release", ...b });
    return { released: { pt: "450000.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" };
  });
  const restoreTerminate = patch(paymentClient, "terminate", async (b: any) => {
    bodies.push({ call: "terminate", ...b });
    return { refund: "0.00" };
  });
  try {
    await releaseSessionMoney(c.id, "session-1");
    await terminateContractMoney(c.id, "PT_CANCELLED");

    assert.equal(bodies.length, 2);
    for (const b of bodies) assert.equal("ptHoldbackRate" in b, false, `${b.call}: no ptHoldbackRate key`);
    // The full release body, exactly.
    assert.deepEqual(bodies[0], {
      call: "release",
      transactionId: c.paymentTransactionId,
      price: "5000000",
      totalSessions: 10,
      rates: { platformRate: "0.1", ptRate: "0.9", gymRate: "0" },
      parties: { ptUserId: c.ptUserId, gymId: null, clientUserId: c.clientUserId },
      label: `Contract ${c.id} session session-1`,
      idempotencyKey: "SESSION_RELEASE:session-1",
    });
    assert.deepEqual(Object.keys(bodies[1]).sort(), [
      "alreadyReleased", "call", "compensatedSessions", "idempotencyKey", "label", "parties", "price", "rates",
      "reason", "totalSessions", "transactionId", "usedSessions",
    ].sort());
  } finally {
    restoreRelease();
    restoreTerminate();
    await cleanup([c.id]);
  }
});

test("rate 0.10: release-session and terminate send ptHoldbackRate; no-show never does", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0.10" });
  const bodies: Record<string, any>[] = [];
  const restores = [
    patch(paymentClient, "releaseSession", async (b: any) => {
      bodies.push({ call: "release", ...b });
      return { released: { pt: "0.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" };
    }),
    patch(paymentClient, "terminate", async (b: any) => {
      bodies.push({ call: "terminate", ...b });
      return {};
    }),
    patch(paymentClient, "noShow", async (b: any) => {
      bodies.push({ call: "noShow", ...b });
      return { compensation: "500000.00", shortfall: "0.00" };
    }),
  ];
  try {
    await releaseSessionMoney(c.id, "s1");
    await compensateNoShowMoney(c.id, "s2");
    await terminateContractMoney(c.id, "PT_CANCELLED");

    const by = (call: string) => bodies.find((b) => b.call === call)!;
    assert.equal(by("release").ptHoldbackRate, "0.1");
    assert.equal(by("terminate").ptHoldbackRate, "0.1");
    assert.equal("ptHoldbackRate" in by("noShow"), false, "payment-service takes from pending first on a no-show; it needs no rate");
  } finally {
    restores.forEach((r) => r());
    await cleanup([c.id]);
  }
});

test("once the holdback is released the effective rate is 0: later calls send no rate", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0.10", holdbackReleasedAt: new Date() });
  const bodies: Record<string, any>[] = [];
  const restores = [
    patch(paymentClient, "releaseSession", async (b: any) => {
      bodies.push(b);
      return { released: { pt: "450000.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" };
    }),
    patch(paymentClient, "terminate", async (b: any) => {
      bodies.push(b);
      return {};
    }),
  ];
  try {
    await releaseSessionMoney(c.id, "s1");
    await terminateContractMoney(c.id, "PT_CANCELLED");
    assert.equal(bodies.length, 2);
    for (const b of bodies) assert.equal("ptHoldbackRate" in b, false);
  } finally {
    restores.forEach((r) => r());
    await cleanup([c.id]);
  }
});

test("releasedToPt grows by what payment-service REALLY released: 0 for the held first session, then the rest", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0.10" });
  const answers = [
    { released: { pt: "0.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" },
    { released: { pt: "400000.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" },
  ];
  const restore = patch(paymentClient, "releaseSession", async () => answers.shift());
  try {
    await releaseSessionMoney(c.id, "s1");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toFixed(2), "0.00");
    await releaseSessionMoney(c.id, "s2");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.releasedToPt.toFixed(2), "400000.00");
    assert.equal(row.releasedToPlatform.toFixed(2), "100000.00");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

// ── The "idle" rule ──────────────────────────────────────────────────────────

test("idle rule: which contracts qualify", { skip }, async () => {
  const mk = async (overrides: Record<string, unknown>, sessions: [string, number][] = []) => {
    const c = await makeContract(overrides);
    for (const [status, offset] of sessions) await addSession(c.id, c.ptUserId, c.clientUserId, status, offset);
    return c;
  };
  const cases: [string, Awaited<ReturnType<typeof mk>>, boolean][] = [
    ["no sessions, activated 40 days ago", await mk({}), true],
    ["only a CANCELLED session, recent", await mk({}, [["CANCELLED", -2]]), true],
    ["a COMPLETED session older than the window", await mk({}, [["COMPLETED", -35]]), true],
    ["a COMPLETED session inside the window", await mk({}, [["COMPLETED", -5]]), false],
    ["a COMPLETED session 29 days ago", await mk({}, [["COMPLETED", -29]]), false],
    ["a NO_SHOW inside the window (a PT who stopped showing up is not 'quiet')", await mk({}, [["NO_SHOW", -3]]), false],
    ["a CONFIRMED session in the future", await mk({}, [["CONFIRMED", 3]]), false],
    ["a REQUESTED session in the future", await mk({}, [["REQUESTED", 3]]), false],
    ["a DISPUTED session from 45 days ago (still holds the entitlement)", await mk({}, [["DISPUTED", -45]]), false],
    ["a PENDING_CLIENT_CONFIRMATION session from 40 days ago", await mk({}, [["PENDING_CLIENT_CONFIRMATION", -40]]), false],
    ["a PT_NO_SHOW_REPORTED session from 40 days ago", await mk({}, [["PT_NO_SHOW_REPORTED", -40]]), false],
    ["activated only 10 days ago", await mk({ startDate: new Date(Date.now() - 10 * DAY) }), false],
    ["activated 29 days ago", await mk({ startDate: new Date(Date.now() - 29 * DAY) }), false],
    ["rate 0 (no holdback)", await mk({ ptHoldbackRate: "0" }), false],
    ["holdback already released", await mk({ holdbackReleasedAt: new Date() }), false],
    ["contract not ACTIVE", await mk({ status: "COMPLETED" }), false],
    ["never paid (no transaction)", await mk({ paymentTransactionId: null }), false],
    ["no startDate", await mk({ startDate: null }), false],
  ];
  try {
    for (const [name, c, expected] of cases) {
      assert.equal(await isCandidate(c.id), expected, name);
    }
  } finally {
    await cleanup(cases.map(([, c]) => c.id));
  }
});

// ── The sweep ────────────────────────────────────────────────────────────────

test("sweep: releases an idle contract once — payment-service is asked with the per-contract key, the flag is set, releasedToPt grows by what was moved", { skip }, async () => {
  const c = await makeContract();
  const calls: any[] = [];
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    calls.push(b);
    return { released: "500000.00" };
  });
  try {
    const first = await runContractHoldbackSweep();
    assert.ok(first.released >= 1);
    const mine = calls.filter((b) => b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`);
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0], {
      transactionId: c.paymentTransactionId,
      parties: { ptUserId: c.ptUserId, gymId: null, clientUserId: c.clientUserId },
      label: `Contract ${c.id} holdback`,
      idempotencyKey: `HOLDBACK_RELEASE:${c.id}`,
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(row.holdbackReleasedAt, "flag set");
    assert.equal(row.releasedToPt.toFixed(2), "500000.00", "what payment-service moved is counted as already released");
    assert.equal(row.status, "ACTIVE", "the contract carries on");

    // A second pass finds nothing to do for it.
    await runContractHoldbackSweep();
    assert.equal(calls.filter((b) => b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`).length, 1, "not asked twice");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toFixed(2), "500000.00");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: contracts that do not qualify never reach payment-service (rate 0 — every contract today — included)", { skip }, async () => {
  const noHoldback = await makeContract({ ptHoldbackRate: "0" });
  const busy = await makeContract();
  await addSession(busy.id, busy.ptUserId, busy.clientUserId, "CONFIRMED", 2);
  const calls: any[] = [];
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    calls.push(b);
    return { released: "0.00" };
  });
  try {
    await runContractHoldbackSweep();
    const ids = calls.map((b) => b.idempotencyKey);
    assert.ok(!ids.includes(`HOLDBACK_RELEASE:${noHoldback.id}`));
    assert.ok(!ids.includes(`HOLDBACK_RELEASE:${busy.id}`));
  } finally {
    restore();
    await cleanup([noHoldback.id, busy.id]);
  }
});

test("sweep: a failure on one contract does not block the rest, and the failed one is retried on the next run", { skip }, async () => {
  const bad = await makeContract({ startDate: new Date(Date.now() - 50 * DAY) });
  const good = await makeContract({ startDate: new Date(Date.now() - 49 * DAY) });
  let badFails = true;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${bad.id}` && badFails) throw new Error("payment-service down");
    return { released: "123000.00" };
  });
  try {
    await runContractHoldbackSweep();
    const goodRow = await prisma.contract.findUniqueOrThrow({ where: { id: good.id } });
    const badRow = await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } });
    assert.ok(goodRow.holdbackReleasedAt, "the healthy contract was processed");
    assert.equal(badRow.holdbackReleasedAt, null, "the failed one is left unmarked");
    assert.equal(badRow.releasedToPt.toFixed(2), "0.00");

    badFails = false;
    await runContractHoldbackSweep();
    const retried = await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } });
    assert.ok(retried.holdbackReleasedAt, "retried and released");
    assert.equal(retried.releasedToPt.toFixed(2), "123000.00");
  } finally {
    restore();
    await cleanup([bad.id, good.id]);
  }
});

test("sweep: the guarded update cannot double-fire — two overlapping runs count the released amount once", { skip }, async () => {
  const c = await makeContract();
  let paymentCalls = 0;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`) paymentCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return { released: "500000.00" };
  });
  try {
    // Bypass the in-process overlap guard on purpose: two instances of the service both running.
    const [a, b] = await Promise.all([contractService.releaseIdleHoldbacks(), contractService.releaseIdleHoldbacks()]);
    assert.ok(a + b >= 1);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.releasedToPt.toFixed(2), "500000.00", "counted once even though payment-service was asked twice (it replays)");
    assert.ok(paymentCalls >= 1 && paymentCalls <= 2);

    // And the repository guard itself: a second mark affects nothing.
    const again = await contractRepository.markHoldbackReleased(c.id, new Prisma.Decimal("500000"), new Date());
    assert.equal(again.count, 0);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toFixed(2), "500000.00");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: the in-process overlap guard skips a tick while a run is still going", { skip }, async () => {
  const c = await makeContract();
  let calls = 0;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`) calls++;
    await new Promise((r) => setTimeout(r, 150));
    return { released: "1.00" };
  });
  try {
    const first = runContractHoldbackSweep();
    await new Promise((r) => setTimeout(r, 20));
    const second = await runContractHoldbackSweep();
    assert.deepEqual(second, { released: 0 }, "the overlapping tick did nothing");
    await first;
    assert.equal(calls, 1);
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: a session booked after the candidate list was read stops the release (the contract is re-checked right before the money call)", { skip }, async () => {
  const c = await makeContract();
  const calls: string[] = [];
  const restoreClient = patch(paymentClient, "releaseHoldback", async (b: any) => {
    calls.push(b.idempotencyKey);
    return { released: "1.00" };
  });
  const original = contractRepository.findIdleHoldbackCandidates;
  const restoreRepo = patch(contractRepository, "findIdleHoldbackCandidates", async (opts: any) => {
    const rows = await original(opts);
    // The first, list-wide read has just returned this contract; now a client books a session.
    if (!opts.id && rows.some((r) => r.id === c.id)) await addSession(c.id, c.ptUserId, c.clientUserId, "REQUESTED", 2);
    return rows;
  });
  try {
    await contractService.releaseIdleHoldbacks();
    assert.ok(!calls.includes(`HOLDBACK_RELEASE:${c.id}`), "no money was released");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null);
  } finally {
    restoreRepo();
    restoreClient();
    await cleanup([c.id]);
  }
});

test("sweep: a contract that is not payable (no transaction) is skipped without error", { skip }, async () => {
  // A candidate must have a paymentTransactionId, so make it vanish between the read and the call.
  const c = await makeContract();
  const restoreClient = patch(paymentClient, "releaseHoldback", async () => {
    throw new Error("must not be called");
  });
  const original = contractRepository.findIdleHoldbackCandidates;
  const restoreRepo = patch(contractRepository, "findIdleHoldbackCandidates", async (opts: any) => {
    const rows = await original(opts);
    if (opts.id === c.id) await prisma.contract.update({ where: { id: c.id }, data: { paymentTransactionId: null } });
    return rows;
  });
  try {
    // findById then sees no transaction → payableOrNull → null → nothing to release.
    await contractService.releaseIdleHoldbacks();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null);
  } finally {
    restoreRepo();
    restoreClient();
    await cleanup([c.id]);
  }
});
