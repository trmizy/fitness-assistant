import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { checkinService } from '../services/checkin.service';
import { signGymCheckinToken } from '../utils/checkinToken';

/**
 * Money-flow redesign plan item 3.7 — "hết lượt nhưng gói vẫn còn hiệu lực".
 *
 * `checkin.service.ts` blocked a check-in once `used_visits >= total_visits`, but the check-in
 * that CAUSED that condition never flipped the membership's own status — it stayed ACTIVE
 * until it also passed `endDate` (which could be weeks later for a long membership), during
 * which the gym's/platform's/referral's payout share sat stuck in pending for no reason, since
 * the payout sweep only expires memberships past their end date.
 */

async function makeGym() {
  return prisma.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: 'Test Gym', address: '123 Test St', status: 'APPROVED' },
  });
}

async function makePlan(gymId: string, visitLimit: number) {
  return prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), gymId, name: 'Visit-limited Plan', price: 500_000, durationDays: 365, visitLimit },
  });
}

async function makeActiveMembership(gymId: string, planId: string, clientId: string, totalVisits: number, usedVisits: number) {
  return prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId,
      planId,
      clientId,
      status: 'ACTIVE',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 365,
      totalVisits,
      usedVisits,
      startDate: new Date(),
      endDate: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000), // far from expiring by date
    },
  });
}

async function cleanup(gymId: string, planId: string, membershipId: string) {
  await prisma.gymCheckIn.deleteMany({ where: { membershipId } });
  await prisma.gymMembershipContract.delete({ where: { id: membershipId } }).catch(() => {});
  await prisma.gymMembershipPlan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
}

test('the check-in that consumes the LAST visit flips the membership to EXPIRED immediately', async () => {
  const gym = await makeGym();
  const plan = await makePlan(gym.id, 10);
  const clientId = randomUUID();
  // Already used 9 of 10 — this next check-in is the last one.
  const membership = await makeActiveMembership(gym.id, plan.id, clientId, 10, 9);
  const { token } = signGymCheckinToken(gym.id);

  try {
    const result = await checkinService.checkInByGymToken(clientId, token);
    assert.equal(result.usedVisits, 10);

    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.status, 'EXPIRED', 'exhausting the last visit must expire the membership right away, not wait for endDate');
  } finally {
    await cleanup(gym.id, plan.id, membership.id);
  }
});

test('a check-in that leaves visits remaining does NOT expire the membership', async () => {
  const gym = await makeGym();
  const plan = await makePlan(gym.id, 10);
  const clientId = randomUUID();
  const membership = await makeActiveMembership(gym.id, plan.id, clientId, 10, 3);
  const { token } = signGymCheckinToken(gym.id);

  try {
    await checkinService.checkInByGymToken(clientId, token);

    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.status, 'ACTIVE');
    assert.equal(after?.usedVisits, 4);
  } finally {
    await cleanup(gym.id, plan.id, membership.id);
  }
});

test('an unlimited-visit membership (total_visits null) never auto-expires from a check-in', async () => {
  const gym = await makeGym();
  const plan = await prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), gymId: gym.id, name: 'Unlimited Plan', price: 500_000, durationDays: 365 }, // no visitLimit
  });
  const clientId = randomUUID();
  const membership = await prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId: gym.id,
      planId: plan.id,
      clientId,
      status: 'ACTIVE',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 365,
      totalVisits: null,
      usedVisits: 500, // an arbitrarily large used count — must never matter when there is no cap
      startDate: new Date(),
      endDate: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
    },
  });
  const { token } = signGymCheckinToken(gym.id);

  try {
    await checkinService.checkInByGymToken(clientId, token);
    const after = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(after?.status, 'ACTIVE');
  } finally {
    await cleanup(gym.id, plan.id, membership.id);
  }
});
