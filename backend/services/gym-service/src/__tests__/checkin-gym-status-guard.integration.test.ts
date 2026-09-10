import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { checkinService } from '../services/checkin.service';
import { signGymCheckinToken } from '../utils/checkinToken';

/**
 * Money-flow redesign plan item 2.5 — chốt chặn thứ hai: `checkin.service.ts`'s raw-SQL
 * membership lookup joined only `gym_membership_contracts`, never `gyms` — a client with a
 * genuinely ACTIVE membership could still check in at a gym the platform had just SUSPENDED
 * for a violation, making "suspended" toothless at the one place that actually lets someone
 * physically walk in.
 *
 * Integration test against the real dev DB (gymcoach_gym) — the query under test is raw SQL
 * with a FOR UPDATE lock, which cannot be meaningfully mocked at the ORM-method level the way
 * the rest of this codebase's unit tests do. Creates real rows, cleans them up after.
 */

// Plans are brand-scoped now (one owner, one brand) — check-in eligibility joins the scanned
// gym's brandId to the membership's plan.brandId, so every fixture gym here needs one.
async function makeBrandGymAndPlan(
  status: 'APPROVED' | 'SUSPENDED',
  operationalStatus: 'OPEN' | 'TEMPORARILY_CLOSED' = 'OPEN',
) {
  const brand = await prisma.gymBrand.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: 'Test Brand' },
  });
  const gym = await prisma.gym.create({
    data: {
      id: randomUUID(),
      ownerId: brand.ownerId,
      brandId: brand.id,
      name: `Test Gym ${status}`,
      address: '123 Test St',
      status,
      operationalStatus,
    },
  });
  const plan = await prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'Test Plan', price: 500_000, durationDays: 30 },
  });
  return { brand, gym, plan };
}

async function makeActiveMembership(gymId: string, planId: string, clientId: string) {
  return prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId,
      planId,
      clientId,
      status: 'ACTIVE',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 30,
      startDate: new Date(),
      endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
  });
}

async function cleanup(brandId: string, gymId: string, planId: string, membershipId: string) {
  await prisma.gymCheckIn.deleteMany({ where: { membershipId } });
  await prisma.gymMembershipContract.delete({ where: { id: membershipId } }).catch(() => {});
  await prisma.gymMembershipPlan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
  await prisma.gymBrand.delete({ where: { id: brandId } }).catch(() => {});
}

integrationTest('a client with an ACTIVE membership cannot check in at a SUSPENDED gym', async () => {
  const { brand, gym, plan } = await makeBrandGymAndPlan('SUSPENDED');
  const clientId = randomUUID();
  const membership = await makeActiveMembership(gym.id, plan.id, clientId);
  const { token } = signGymCheckinToken(gym.id);

  try {
    await assert.rejects(() => checkinService.checkInByGymToken(clientId, token));

    // The membership's usedVisits must NOT have moved — a rejected check-in is a true no-op.
    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.usedVisits, 0);
  } finally {
    await cleanup(brand.id, gym.id, plan.id, membership.id);
  }
});

// Vòng 4 / Phase C3 — same chokepoint, second axis: an APPROVED gym the owner has
// temporarily closed must block check-in exactly like a SUSPENDED one does above.
integrationTest('a client with an ACTIVE membership cannot check in at a TEMPORARILY_CLOSED gym', async () => {
  const { brand, gym, plan } = await makeBrandGymAndPlan('APPROVED', 'TEMPORARILY_CLOSED');
  const clientId = randomUUID();
  const membership = await makeActiveMembership(gym.id, plan.id, clientId);
  const { token } = signGymCheckinToken(gym.id);

  try {
    await assert.rejects(() => checkinService.checkInByGymToken(clientId, token));
    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.usedVisits, 0);
  } finally {
    await cleanup(brand.id, gym.id, plan.id, membership.id);
  }
});

integrationTest('a client with an ACTIVE membership CAN check in at an APPROVED gym', async () => {
  const { brand, gym, plan } = await makeBrandGymAndPlan('APPROVED');
  const clientId = randomUUID();
  const membership = await makeActiveMembership(gym.id, plan.id, clientId);
  const { token } = signGymCheckinToken(gym.id);

  try {
    const result = await checkinService.checkInByGymToken(clientId, token);
    assert.ok(result);

    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.usedVisits, 1);
  } finally {
    await cleanup(brand.id, gym.id, plan.id, membership.id);
  }
});
