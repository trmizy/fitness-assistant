/**
 * PT holdback (FH-9) — user-service side: the snapshot (rate + policy version), the pass-through to payment-service, the feature flag
 * for NEW contracts, and the sweep that picks up the held money of ENDED contracts.
 *
 * Evidence labels: BACKEND INTEGRATION for everything that reads or writes the real Postgres
 * (the isolated gymcoach_user_*_test database, NEVER the dev one — user-service's .env points at
 * dev, so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_fh9_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-holdback.integration.test.ts
 * payment-service itself is NOT running here: paymentClient's methods are stubbed at the client
 * boundary (TEST FIXTURE for that half), so these tests pin what user-service SENDS and what it
 * does with the answer. The money rules live in payment-service's fh9-pt-holdback.integration.test.ts / pt-holdback.integration.test.ts.
 *
 * Replaces the old idle-release tests: there is no idle clock any more (owner rule: release only after the contract has ended and is
 * reconciled; never early).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { paymentClient } from "../clients/payment.client";
import { releaseSessionMoney, terminateContractMoney, compensateNoShowMoney, holdbackArgOf } from "../services/contract-payout.service";
import { runContractHoldbackSweep } from "../services/contract-expiry-sweep.service";
import {
  resolvePtHoldbackRate,
  ptHoldbackEnabledForNewContracts,
  PT_HOLDBACK_POLICY_VERSION,
  PT_HOLDBACK_RATE,
  policyVersionForRate,
} from "../services/pt-holdback-rate";

const DAY = 24 * 3600 * 1000;
import { skip } from "./test-db-guard"; // D57-6-5: the database NAME must end with _test (was a loose /_test/ match on the whole URL)

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

/** A paid contract that carries the FH-9 snapshot (rate 0.10 + policy version 1), ACTIVE unless overridden. */
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
      ptHoldbackPolicyVersion: PT_HOLDBACK_POLICY_VERSION,
      ...overrides,
    },
  });
}

async function cleanup(ids: string[]) {
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: ids } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

/** payment-service's answer to release-holdback when the contract is reconciled and nothing is held. */
const DONE = (released = "0.00") => ({ released, heldAfter: "0.00", ended: true, reconciled: true });

// ── The snapshot ─────────────────────────────────────────────────────────────

test("a contract written without the new columns gets rate 0, policy version 0 and no release date — existing rows are not retroactively affected", { skip }, async () => {
  const c = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "legacy", totalSessions: 4 },
  });
  try {
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.ptHoldbackRate.toString(), "0");
    assert.equal(row.ptHoldbackPolicyVersion, 0);
    assert.equal(row.holdbackReleasedAt, null);
    const cols = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string; column_default: string | null; numeric_precision: number | null; numeric_scale: number | null }[]>(
      `SELECT column_name, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_name = 'contracts' AND column_name IN ('pt_holdback_rate', 'holdback_released_at', 'pt_holdback_policy_version') ORDER BY column_name`,
    );
    assert.equal(cols.length, 3);
    const rate = cols.find((x) => x.column_name === "pt_holdback_rate")!;
    assert.equal(rate.is_nullable, "NO", "NOT NULL");
    assert.equal(rate.numeric_precision, 6);
    assert.equal(rate.numeric_scale, 4);
    assert.match(String(rate.column_default), /^0/);
    const ver = cols.find((x) => x.column_name === "pt_holdback_policy_version")!;
    assert.equal(ver.is_nullable, "NO");
    assert.match(String(ver.column_default), /^0/);
    assert.equal(cols.find((x) => x.column_name === "holdback_released_at")!.is_nullable, "YES");
  } finally {
    await cleanup([c.id]);
  }
});

test("contractRepository.create stamps the policy version from the rate: 0 for no holdback, the current version otherwise", { skip }, async () => {
  const mk = (rate?: string) =>
    contractRepository.create({ ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "snap", totalSessions: 4, ...(rate !== undefined ? { ptHoldbackRate: rate } : {}) });
  const none = await mk();
  const zero = await mk("0");
  const ten = await mk("0.10");
  try {
    assert.equal(none.ptHoldbackPolicyVersion, 0);
    assert.equal(zero.ptHoldbackPolicyVersion, 0);
    assert.equal(ten.ptHoldbackPolicyVersion, PT_HOLDBACK_POLICY_VERSION);
    assert.equal(ten.ptHoldbackRate.toString(), "0.1");
    assert.equal(policyVersionForRate("0"), 0);
    assert.equal(policyVersionForRate("0.0000"), 0);
    assert.equal(policyVersionForRate(null), 0);
    assert.equal(policyVersionForRate("0.10"), PT_HOLDBACK_POLICY_VERSION);
  } finally {
    await cleanup([none.id, zero.id, ten.id]);
  }
});

// ── The feature flag for NEW contracts (default OFF) ─────────────────────────

test("flag: resolvePtHoldbackRate is 0 by default and only an exact 'true' + a released terms version stating the rule + this PT's confirmation give 0.10", async () => {
  const base = { termsVersion: "v-final", termsAreDraft: false, hasAcceptedCurrent: async () => true };
  const on = { PT_HOLDBACK_NEW_CONTRACTS_ENABLED: "true", PT_HOLDBACK_TERMS_VERSION: "v-final" } as unknown as NodeJS.ProcessEnv;
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: {} as NodeJS.ProcessEnv }), "0", "default OFF");
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: on }), PT_HOLDBACK_RATE);
  assert.equal(PT_HOLDBACK_RATE, "0.10");
  for (const v of ["TRUE", " True "]) {
    assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: { ...on, PT_HOLDBACK_NEW_CONTRACTS_ENABLED: v } as unknown as NodeJS.ProcessEnv }), PT_HOLDBACK_RATE, `${JSON.stringify(v)} (case/trim-insensitive)`);
  }
  for (const v of ["false", "", "1", "yes", "on"]) {
    assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: { ...on, PT_HOLDBACK_NEW_CONTRACTS_ENABLED: v } as unknown as NodeJS.ProcessEnv }), "0", `${JSON.stringify(v)} is not "true"`);
  }
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: { PT_HOLDBACK_NEW_CONTRACTS_ENABLED: "true" } as unknown as NodeJS.ProcessEnv }), "0", "no terms version named: off");
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, env: { ...on, PT_HOLDBACK_TERMS_VERSION: "other" } as unknown as NodeJS.ProcessEnv }), "0", "the served terms are not the version that states the rule");
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, termsAreDraft: true, env: on }), "0", "a draft is never enforced");
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, hasAcceptedCurrent: async () => false, env: on }), "0", "a PT who did not confirm that version is not held to it");
  assert.equal(await resolvePtHoldbackRate("pt", { ...base, hasAcceptedCurrent: async () => { throw new Error("db down"); }, env: on }), "0", "cannot tell -> off, never on a guess");
  assert.equal(ptHoldbackEnabledForNewContracts({} as NodeJS.ProcessEnv), false);
  // the real, unmocked call (the terms are a draft today): 0
  assert.equal(await resolvePtHoldbackRate("pt", { env: on }), "0");
});

test("turning the flag off later changes nothing for a contract that already carries the snapshot: its rules and its rate still go to payment-service", { skip }, async () => {
  const c = await makeContract();
  const prev = process.env.PT_HOLDBACK_NEW_CONTRACTS_ENABLED;
  delete process.env.PT_HOLDBACK_NEW_CONTRACTS_ENABLED;
  const bodies: any[] = [];
  const restores = [
    patch(paymentClient, "releaseSession", async (b: any) => {
      bodies.push(b);
      return { released: { pt: "0.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" };
    }),
    patch(paymentClient, "terminate", async (b: any) => {
      bodies.push(b);
      return {};
    }),
  ];
  try {
    await releaseSessionMoney(c.id, "s1");
    await terminateContractMoney(c.id, "MUTUAL");
    assert.equal(bodies.length, 2);
    for (const b of bodies) assert.equal(b.ptHoldbackRate, "0.1", "the snapshot, not the flag, decides");
  } finally {
    if (prev !== undefined) process.env.PT_HOLDBACK_NEW_CONTRACTS_ENABLED = prev;
    restores.forEach((r) => r());
    await cleanup([c.id]);
  }
});

// ── Pass-through to payment-service ──────────────────────────────────────────

test("rate 0: release-session and terminate bodies carry NO holdback key at all — byte-for-byte what they were", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0", ptHoldbackPolicyVersion: 0 });
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

test("rate 0.10 under policy 1: release-session and terminate send ptHoldbackRate; no-show never does", { skip }, async () => {
  const c = await makeContract();
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

test("non-retroactive: a row with a rate but NO policy version (not an FH-9 contract) never sends a rate — it can never start holding money", { skip }, async () => {
  const c = await makeContract({ ptHoldbackRate: "0.10", ptHoldbackPolicyVersion: 0 });
  assert.deepEqual(holdbackArgOf(c as any), {});
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

test("the rate still goes to payment-service after holdbackReleasedAt is set (the ledger, not this flag, knows what is held)", { skip }, async () => {
  const c = await makeContract({ holdbackReleasedAt: new Date() });
  assert.deepEqual(holdbackArgOf(c as any), { ptHoldbackRate: "0.1" });
  await cleanup([c.id]);
});

test("releasedToPt grows by what payment-service REALLY released: 0 for the held first session, then the rest", { skip }, async () => {
  const c = await makeContract();
  const answers = [
    { released: { pt: "0.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" },
    { released: { pt: "450000.00", gym: "0.00", platform: "50000.00" }, unit: "500000.00" },
  ];
  const restore = patch(paymentClient, "releaseSession", async () => answers.shift());
  try {
    await releaseSessionMoney(c.id, "s1");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).releasedToPt.toFixed(2), "0.00");
    await releaseSessionMoney(c.id, "s2");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.releasedToPt.toFixed(2), "450000.00");
    assert.equal(row.releasedToPlatform.toFixed(2), "100000.00");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

// ── Which contracts the sweep looks at ───────────────────────────────────────

test("sweep candidates: only an ENDED, paid contract that carries the FH-9 snapshot and has not been marked — never a running one, however quiet", { skip }, async () => {
  const mk = (o: Record<string, unknown>) => makeContract(o);
  const cases: [string, Awaited<ReturnType<typeof mk>>, boolean][] = [
    ["COMPLETED", await mk({ status: "COMPLETED" }), true],
    ["EXPIRED", await mk({ status: "EXPIRED" }), true],
    ["CANCELLED", await mk({ status: "CANCELLED" }), true],
    ["ACTIVE, no sessions for 40 days (the old idle rule would have released it)", await mk({}), false],
    ["PENDING_PAYMENT", await mk({ status: "PENDING_PAYMENT" }), false],
    ["rate 0", await mk({ status: "COMPLETED", ptHoldbackRate: "0", ptHoldbackPolicyVersion: 0 }), false],
    ["a rate but no policy version (old row)", await mk({ status: "COMPLETED", ptHoldbackPolicyVersion: 0 }), false],
    ["already marked", await mk({ status: "COMPLETED", holdbackReleasedAt: new Date() }), false],
    ["never paid (no transaction)", await mk({ status: "COMPLETED", paymentTransactionId: null }), false],
  ];
  try {
    for (const [name, c, expected] of cases) {
      assert.equal((await contractRepository.findEndedHoldbackCandidates({ id: c.id })).length === 1, expected, name);
    }
  } finally {
    await cleanup(cases.map(([, c]) => c.id));
  }
});

// ── The sweep ────────────────────────────────────────────────────────────────

test("sweep: asks payment-service once per ended contract with the per-contract key; marks it only when the ledger says reconciled and nothing is held", { skip }, async () => {
  const c = await makeContract({ status: "COMPLETED" });
  const calls: any[] = [];
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    calls.push(b);
    return DONE("90000.00");
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
    assert.equal(row.releasedToPt.toFixed(2), "0.00", "no amount is copied here: the ledger is the authority (Z4)");
    assert.equal(row.status, "COMPLETED");

    // A second pass finds nothing to do for it.
    await runContractHoldbackSweep();
    assert.equal(calls.filter((b) => b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`).length, 1, "not asked twice");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: not due yet (the contract still has an open obligation or an undecided session, or its ending has not reached the ledger) -> NOT marked, asked again on the next run", { skip }, async () => {
  const c = await makeContract({ status: "CANCELLED" });
  let answer: any = { released: "0.00", heldAfter: "10000.00", ended: true, reconciled: false, blockedBy: { openObligations: "0.00", unresolvedSessions: 1 } };
  let asked = 0;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`) asked++;
    return answer;
  });
  try {
    await runContractHoldbackSweep();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null, "still held: not marked");
    answer = { released: "0.00", heldAfter: "0.00", ended: false, reconciled: false, blockedBy: { notEnded: true, openObligations: "0.00", unresolvedSessions: 0 } };
    await runContractHoldbackSweep();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null, "ending not in the ledger yet: not marked");
    // reconciled, but money is still held (cannot happen from payment-service; the sweep must not trust reconciled alone)
    answer = { released: "0.00", heldAfter: "5.00", ended: true, reconciled: true };
    await runContractHoldbackSweep();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null, "held money left: not marked");
    answer = DONE("10000.00");
    await runContractHoldbackSweep();
    assert.ok((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, "released at last: marked");
    assert.equal(asked, 4);
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("Z4: a contract that ended BEFORE the sweep is still released and marked (the mark does not depend on the contract being ACTIVE), and nothing is added to releasedToPt", { skip }, async () => {
  const c = await makeContract({ status: "COMPLETED", releasedToPt: 4_050_000, terminationReason: "COMPLETED", terminatedAt: new Date() });
  const restore = patch(paymentClient, "releaseHoldback", async () => DONE("450000.00"));
  try {
    await runContractHoldbackSweep();
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(row.holdbackReleasedAt, "recorded although the contract is not ACTIVE any more");
    assert.equal(row.releasedToPt.toFixed(2), "4050000.00", "the counter is untouched: no amount is copied from the answer, so it can never be double-counted or missed");
    const again = await contractRepository.markHoldbackReleased(c.id, new Date());
    assert.equal(again.count, 0, "a second mark affects nothing");
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: contracts that do not qualify never reach payment-service (rate 0 — every contract today — and running contracts included)", { skip }, async () => {
  const noHoldback = await makeContract({ status: "COMPLETED", ptHoldbackRate: "0", ptHoldbackPolicyVersion: 0 });
  const running = await makeContract();
  const old = await makeContract({ status: "COMPLETED", ptHoldbackPolicyVersion: 0 });
  const calls: any[] = [];
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    calls.push(b);
    return DONE();
  });
  try {
    await runContractHoldbackSweep();
    const ids = calls.map((b) => b.idempotencyKey);
    for (const c of [noHoldback, running, old]) assert.ok(!ids.includes(`HOLDBACK_RELEASE:${c.id}`));
  } finally {
    restore();
    await cleanup([noHoldback.id, running.id, old.id]);
  }
});

test("sweep: a failure on one contract does not block the rest, and the failed one is retried on the next run", { skip }, async () => {
  const bad = await makeContract({ status: "COMPLETED" });
  const good = await makeContract({ status: "COMPLETED" });
  let badFails = true;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${bad.id}` && badFails) throw new Error("payment-service down");
    return DONE("123000.00");
  });
  try {
    await runContractHoldbackSweep();
    const goodRow = await prisma.contract.findUniqueOrThrow({ where: { id: good.id } });
    const badRow = await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } });
    assert.ok(goodRow.holdbackReleasedAt, "the healthy contract was processed");
    assert.equal(badRow.holdbackReleasedAt, null, "the failed one is left unmarked");

    badFails = false;
    await runContractHoldbackSweep();
    const retried = await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } });
    assert.ok(retried.holdbackReleasedAt, "retried and marked");
  } finally {
    restore();
    await cleanup([bad.id, good.id]);
  }
});

test("sweep: two overlapping runs (two instances) are safe — payment-service may be asked twice (it replays) but the contract is marked once", { skip }, async () => {
  const c = await makeContract({ status: "COMPLETED" });
  let paymentCalls = 0;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`) paymentCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return DONE("500000.00");
  });
  try {
    // Bypass the in-process overlap guard on purpose: two instances of the service both running.
    const [a, b] = await Promise.all([contractService.releaseDueHoldbacks(), contractService.releaseDueHoldbacks()]);
    assert.equal(a + b, 1, "exactly one run counts the contract (the guarded update affects one row)");
    assert.ok(paymentCalls >= 1 && paymentCalls <= 2);
    assert.ok((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt);
    const again = await contractRepository.markHoldbackReleased(c.id, new Date());
    assert.equal(again.count, 0);
  } finally {
    restore();
    await cleanup([c.id]);
  }
});

test("sweep: the in-process overlap guard skips a tick while a run is still going", { skip }, async () => {
  const c = await makeContract({ status: "COMPLETED" });
  let calls = 0;
  const restore = patch(paymentClient, "releaseHoldback", async (b: any) => {
    if (b.idempotencyKey === `HOLDBACK_RELEASE:${c.id}`) calls++;
    await new Promise((r) => setTimeout(r, 150));
    return DONE();
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

test("sweep: a contract that is not payable (no transaction) is skipped without error", { skip }, async () => {
  // A candidate must have a paymentTransactionId, so make it vanish between the read and the call.
  const c = await makeContract({ status: "COMPLETED" });
  const restoreClient = patch(paymentClient, "releaseHoldback", async () => {
    throw new Error("must not be called");
  });
  const original = contractRepository.findEndedHoldbackCandidates;
  const restoreRepo = patch(contractRepository, "findEndedHoldbackCandidates", async (opts: any) => {
    const rows = await original(opts);
    await prisma.contract.update({ where: { id: c.id }, data: { paymentTransactionId: null } });
    return rows;
  });
  try {
    // findById then sees no transaction → payableOrNull → null → nothing to release.
    await contractService.releaseDueHoldbacks();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null);
  } finally {
    restoreRepo();
    restoreClient();
    await cleanup([c.id]);
  }
});
