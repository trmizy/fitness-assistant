/**
 * AWS DEV bug: GET /admin/partners/overview-stats returned 500 on the deployed server. There `testAccountsBlocked()` is
 * true, auth-service returns ~37k test-account ids, and `{ notIn: ids }` / `{ in: ids }` bound one variable per id:
 * "Assertion violation on the database: too many bind variables in prepared statement, expected maximum of 32767,
 * received 37409". Locally the filter is off, so it never reproduced.
 *
 * Evidence label: BACKEND INTEGRATION (real service function `partnerDiligenceService.overviewStats` + isolated *_test DB).
 * The auth-service id list is a TEST FIXTURE (40,000 generated uuids plus the seeded "test" owner ids).
 */
import { guardedTest, skip } from './test-db-guard';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cleanupRegistry, makeGym, makeOwner, newRegistry } from './listing-b1.test-helpers';

const reg = newRegistry();
let prisma: typeof import('../repositories/prisma').prisma;
let overviewStats: (ids?: string[] | null) => Promise<any>;

const FAKE_COUNT = 40_000; // > 32767
const fakeIds = () => Array.from({ length: FAKE_COUNT }, () => randomUUID());

// 2 "test" owners (excluded) and 2 normal owners; each has one partner + one gym with distinct statuses.
let testA: Awaited<ReturnType<typeof makeOwner>>;
let testB: Awaited<ReturnType<typeof makeOwner>>;
let normA: Awaited<ReturnType<typeof makeOwner>>;
let normB: Awaited<ReturnType<typeof makeOwner>>;

guardedTest.before(async () => {
  if (skip) return;
  prisma = (await import('../repositories/prisma')).prisma;
  overviewStats = (await import('../services/partner-diligence.service')).partnerDiligenceService.overviewStats.bind(
    (await import('../services/partner-diligence.service')).partnerDiligenceService,
  );
  testA = await makeOwner(reg, { partnerStatus: 'ACTIVE' });
  testB = await makeOwner(reg, { partnerStatus: 'SUSPENDED' });
  normA = await makeOwner(reg, { partnerStatus: 'ACTIVE' });
  normB = await makeOwner(reg, { partnerStatus: 'TERMINATED' });
  await makeGym(reg, { ownerId: testA.ownerId, brandId: testA.brandId, status: 'APPROVED' });
  await makeGym(reg, { ownerId: testB.ownerId, brandId: testB.brandId, status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' });
  await makeGym(reg, { ownerId: normA.ownerId, brandId: normA.brandId, status: 'APPROVED' });
  await makeGym(reg, { ownerId: normB.ownerId, brandId: normB.brandId, status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' });
});

guardedTest.after(async () => {
  if (skip) return;
  await cleanupRegistry(reg);
  await prisma.$disconnect();
});

guardedTest('reproduction: Prisma notIn with 40,000 ids exceeds the 32767 bind-variable limit (the AWS DEV failure)', async () => {
  await assert.rejects(
    () => prisma.gym.count({ where: { status: 'APPROVED', ownerId: { notIn: fakeIds() } } }),
    (e: any) => /too many bind variables|32767/i.test(String(e?.message)),
  );
});

guardedTest('overviewStats with ~40,000 excluded ids no longer throws, and excludes exactly the test owners (partners + branches)', async () => {
  const ids = fakeIds();
  // Baseline: 40k fake ids that match nothing real (only test-domain contact emails, if the DB holds any, are excluded in both runs).
  const base = await overviewStats(ids);
  const withTest = await overviewStats([...ids, testA.ownerId, testB.ownerId]);

  // Excluded: testA (ACTIVE partner, APPROVED/OPEN gym) and testB (SUSPENDED partner, APPROVED/TEMPORARILY_CLOSED gym).
  assert.equal(base.totalPartners - withTest.totalPartners, 2);
  assert.equal(base.activePartners - withTest.activePartners, 1);
  assert.equal(base.suspendedPartners - withTest.suspendedPartners, 1);
  assert.equal(base.terminatedPartners - withTest.terminatedPartners, 0);
  assert.equal(base.totalBranches - withTest.totalBranches, 2);
  assert.equal(base.temporarilyClosedBranches - withTest.temporarilyClosedBranches, 1);
  assert.equal(withTest.excludedTestPartners - base.excludedTestPartners, 2);

  // Absolute check against an independent oracle (Prisma, tiny notIn lists — far below the limit).
  const excludedOwners = [testA.ownerId, testB.ownerId];
  const accounts = await prisma.gymPartnerAccount.findMany({ where: { userId: { in: excludedOwners } }, select: { partnerId: true } });
  assert.equal(accounts.length, 2);
  assert.equal(withTest.totalBranches, await prisma.gym.count({ where: { status: 'APPROVED', ownerId: { notIn: excludedOwners } } }));
  assert.equal(withTest.temporarilyClosedBranches, await prisma.gym.count({ where: { operationalStatus: 'TEMPORARILY_CLOSED', ownerId: { notIn: excludedOwners } } }));
  // The normal owners' rows are counted (>= : the shared test DB may hold other rows).
  assert.ok(withTest.totalBranches >= 2 && withTest.temporarilyClosedBranches >= 1);
  assert.ok(withTest.activePartners >= 1 && withTest.terminatedPartners >= 1);
  void normA; void normB;
});

guardedTest('overviewStats: small list, empty list and null keep working (local path unchanged)', async () => {
  const small = await overviewStats([testA.ownerId]);
  const withAll = await overviewStats([testA.ownerId, testB.ownerId]);
  assert.equal(small.totalPartners - withAll.totalPartners, 1);

  const empty = await overviewStats([]);
  const none = await overviewStats(null);
  assert.equal(none.excludedTestPartners, null);
  assert.equal(none.totalBranches, await prisma.gym.count({ where: { status: 'APPROVED' } }));
  assert.equal(none.totalPartners, await prisma.gymPartner.count());
  // [] excludes no owner: same branch counts as no filter.
  assert.equal(empty.totalBranches, none.totalBranches);
  assert.equal(empty.temporarilyClosedBranches, none.temporarilyClosedBranches);
});
