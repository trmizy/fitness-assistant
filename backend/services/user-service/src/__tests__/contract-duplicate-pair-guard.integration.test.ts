import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { contractService } from "../services/contract.service";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

/**
 * BR-27 - one live PT-client contract per pair (audit finding #1).
 *
 * BACKEND INTEGRATION on an isolated `*_test` database: requestContract / createMarketplaceContract run for real,
 * including the real contracts INSERT, the pair advisory lock and the partial unique index
 * (migration 20261021130000_contract_one_live_per_pair). Only the package / PT-profile / availability /
 * notification reads that belong to other services' data are stubbed at the repository boundary.
 *
 * Before the fix: PENDING_PAYMENT did not count as live (a second request beside a contract awaiting payment was
 * accepted - the client then owed two payments to one PT); two concurrent requests both passed the unlocked
 * pre-check and both inserted; the marketplace path had no retry guard.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const createdIds: string[] = [];

/** Holds every caller until `n` have arrived or `timeoutMs` passed, whichever is first. Without the pair lock all
 *  callers arrive together (the race is forced, not left to timing); with it only one gets in and the rest wait on the
 *  lock, so the timeout lets the first one through. */
function makeBarrier(n: number, timeoutMs: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    if (++arrived >= n) release();
    await Promise.race([gate, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  };
}

function stubRequestDeps(ptUserId: string, barrier?: () => Promise<void>) {
  const packageId = randomUUID();
  const pkg = {
    id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
    sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: null,
    isActive: true, archivedAt: null, version: 1,
  };
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => pkg),
    patch(ptServicePackageRepository, "findByIdForShare", async () => {
      if (barrier) await barrier();
      return pkg;
    }),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
  ];
  return { packageId, restore: () => restores.forEach((r) => r()) };
}

async function seed(ptUserId: string, clientUserId: string, status: ContractStatus, source: ContractSource = ContractSource.INDEPENDENT, extra: Record<string, unknown> = {}) {
  const row = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, price: 1_000_000, status, source, ...extra },
  });
  createdIds.push(row.id);
  return row;
}

const rejects409 = (e: any) => e?.status === 409 || e?.statusCode === 409;

dbTest.after(async () => {
  await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

for (const status of [ContractStatus.PENDING_REVIEW, ContractStatus.PENDING_SIGNATURE, ContractStatus.PENDING_PAYMENT, ContractStatus.ACTIVE]) {
  dbTest(`requestContract is refused 409 while a ${status} contract exists for the pair`, async () => {
    const ptUserId = randomUUID();
    const clientUserId = randomUUID();
    await seed(ptUserId, clientUserId, status);
    const { packageId, restore } = stubRequestDeps(ptUserId);
    try {
      await assert.rejects(() => contractService.requestContract(clientUserId, { ptUserId, packageId }), rejects409);
      assert.equal(await prisma.contract.count({ where: { ptUserId, clientUserId } }), 1, "no second row was written");
    } finally {
      restore();
    }
  });
}

dbTest("terminal contracts (COMPLETED / EXPIRED / CANCELLED / REJECTED) never block a new request", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  for (const status of [ContractStatus.COMPLETED, ContractStatus.EXPIRED, ContractStatus.CANCELLED, ContractStatus.REJECTED]) {
    await seed(ptUserId, clientUserId, status);
  }
  const { packageId, restore } = stubRequestDeps(ptUserId);
  try {
    const created = await contractService.requestContract(clientUserId, { ptUserId, packageId });
    createdIds.push(created.id);
    assert.equal(created.status, ContractStatus.PENDING_REVIEW);
  } finally {
    restore();
  }
});

dbTest("two concurrent requestContract calls for one pair create exactly one contract", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { packageId, restore } = stubRequestDeps(ptUserId, makeBarrier(3, 500));
  try {
    const results = await Promise.allSettled([
      contractService.requestContract(clientUserId, { ptUserId, packageId }),
      contractService.requestContract(clientUserId, { ptUserId, packageId }),
      contractService.requestContract(clientUserId, { ptUserId, packageId }),
    ]);
    const rows = await prisma.contract.findMany({ where: { ptUserId, clientUserId } });
    rows.forEach((r) => createdIds.push(r.id));
    assert.equal(rows.length, 1, "exactly one live contract row");
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(losers.length, 2);
    for (const l of losers) assert.ok(rejects409(l.reason), `loser must be a 409, got ${(l.reason as any)?.status}`);
  } finally {
    restore();
  }
});

dbTest("DB backstop: a second live non-marketplace row for one pair is rejected by the partial unique index", async (t) => {
  const idx = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'`;
  if (Number(idx[0].n) === 0) return t.skip("contracts_one_live_per_pair is not installed on this database");
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  await seed(ptUserId, clientUserId, ContractStatus.PENDING_PAYMENT);
  await assert.rejects(() => seed(ptUserId, clientUserId, ContractStatus.PENDING_REVIEW), (e: any) => e?.code === "P2002");
  // history and marketplace rows are exempt
  await seed(ptUserId, clientUserId, ContractStatus.COMPLETED);
  await seed(ptUserId, clientUserId, ContractStatus.ACTIVE, ContractSource.MARKETPLACE);
  await seed(ptUserId, clientUserId, ContractStatus.ACTIVE, ContractSource.MARKETPLACE);
});

dbTest("marketplace: a paid order's contract is created even beside a PT contract (never refused after payment), and a retry returns the same row", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  await seed(ptUserId, clientUserId, ContractStatus.PENDING_PAYMENT);
  const txn = `txn-${randomUUID()}`;
  const input = { ptUserId, clientUserId, packageName: "Personalized plan", price: 500000, paymentTransactionId: txn };
  const [a, b] = await Promise.all([contractService.createMarketplaceContract(input), contractService.createMarketplaceContract(input)]);
  createdIds.push(a.id, b.id);
  assert.equal(a.id, b.id, "a retry of the same paid order returns its contract");
  assert.equal(await prisma.contract.count({ where: { paymentTransactionId: txn } }), 1);
  assert.equal(a.source, ContractSource.MARKETPLACE);
  assert.equal(a.status, ContractStatus.ACTIVE);
});

dbTest("hasStandingPtContract: live PT contract (PENDING_PAYMENT included) is a conflict; marketplace-only or terminal is not", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  assert.equal(await contractService.hasStandingPtContract(ptUserId, clientUserId), false);
  await seed(ptUserId, clientUserId, ContractStatus.ACTIVE, ContractSource.MARKETPLACE);
  await seed(ptUserId, clientUserId, ContractStatus.CANCELLED);
  assert.equal(await contractService.hasStandingPtContract(ptUserId, clientUserId), false);
  await seed(ptUserId, clientUserId, ContractStatus.PENDING_PAYMENT);
  assert.equal(await contractService.hasStandingPtContract(ptUserId, clientUserId), true);
});
