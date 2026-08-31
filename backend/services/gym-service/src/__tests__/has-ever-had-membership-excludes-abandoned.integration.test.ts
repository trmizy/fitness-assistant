import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { membershipRepository } from '../repositories/membership.repository';

/**
 * Money-flow redesign plan item 3.8 — "điều kiện gói đầu tiên đếm cả gói bỏ dở".
 *
 * `hasEverHadMembershipAt` (money-flow §2.5/A2 — a referral code only applies to a client's
 * FIRST membership at a gym) counted every status including PENDING_PAYMENT — a client who
 * clicked "buy" and abandoned the checkout page permanently lost the ability to use a referral
 * code on their real first purchase, and the referring PT lost a legitimate commission.
 */

async function makeGym() {
  return prisma.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: 'Test Gym', address: '123 Test St', status: 'APPROVED' },
  });
}

async function makePlan(gymId: string) {
  return prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), gymId, name: 'Test Plan', price: 500_000, durationDays: 30 },
  });
}

async function makeMembership(gymId: string, planId: string, clientId: string, status: string) {
  return prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId,
      planId,
      clientId,
      status: status as any,
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 30,
    },
  });
}

integrationTest('an abandoned PENDING_PAYMENT membership does not count as "ever had a membership here"', async () => {
  const gym = await makeGym();
  const plan = await makePlan(gym.id);
  const clientId = randomUUID();
  const membership = await makeMembership(gym.id, plan.id, clientId, 'PENDING_PAYMENT');

  try {
    const result = await membershipRepository.hasEverHadMembershipAt(clientId, gym.id);
    assert.equal(result, false, 'clicking buy and abandoning checkout must not burn the client\'s referral-eligible first purchase');
  } finally {
    await prisma.gymMembershipContract.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.gymMembershipPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});

for (const status of ['ACTIVE', 'EXPIRED', 'CANCELLED']) {
  test(`a ${status} membership (was genuinely paid for) DOES count`, async () => {
    const gym = await makeGym();
    const plan = await makePlan(gym.id);
    const clientId = randomUUID();
    const membership = await makeMembership(gym.id, plan.id, clientId, status);

    try {
      const result = await membershipRepository.hasEverHadMembershipAt(clientId, gym.id);
      assert.equal(result, true);
    } finally {
      await prisma.gymMembershipContract.delete({ where: { id: membership.id } }).catch(() => {});
      await prisma.gymMembershipPlan.delete({ where: { id: plan.id } }).catch(() => {});
      await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
    }
  });
}
