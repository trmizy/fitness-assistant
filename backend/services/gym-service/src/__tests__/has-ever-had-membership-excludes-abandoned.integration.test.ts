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
 *
 * P0 cluster E3 extends this: the original fix only excluded the CURRENT status
 * PENDING_PAYMENT — but `cancelIfPending` (a client explicitly cancelling their own unpaid
 * order) and the new pending-payment-expiry sweep (P0 cluster E3, an order nobody ever paid
 * for and nobody explicitly cancelled either) BOTH move a never-paid order OUT of
 * PENDING_PAYMENT into CANCELLED — the exact status the table below already treats as "was
 * genuinely paid for". The query now checks `paymentTxnId IS NOT NULL` instead of the current
 * status at all: that column is only ever set by activateIfPending (a real, confirmed
 * payment), so it stays a reliable signal regardless of what status a never-paid order later
 * lands in.
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

async function makeMembership(gymId: string, planId: string, clientId: string, status: string, paymentTxnId: string | null = null) {
  return prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId,
      planId,
      clientId,
      status: status as any,
      paymentTxnId,
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

test('P0 E3 — a never-paid PENDING_PAYMENT order that timed out into CANCELLED (sweep, or the client\'s own explicit cancelPending) still does not count', async () => {
  const gym = await makeGym();
  const plan = await makePlan(gym.id);
  const clientId = randomUUID();
  // Exactly cancelIfPending's / the expiry sweep's own output shape: CANCELLED, but no
  // paymentTxnId was ever set because no payment ever confirmed.
  const membership = await makeMembership(gym.id, plan.id, clientId, 'CANCELLED', null);

  try {
    const result = await membershipRepository.hasEverHadMembershipAt(clientId, gym.id);
    assert.equal(result, false, 'a never-paid order does not become a real first purchase just because it is now CANCELLED instead of PENDING_PAYMENT');
  } finally {
    await prisma.gymMembershipContract.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.gymMembershipPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});

for (const status of ['ACTIVE', 'EXPIRED', 'CANCELLED']) {
  test(`a ${status} membership that WAS actually paid for (paymentTxnId set) DOES count`, async () => {
    const gym = await makeGym();
    const plan = await makePlan(gym.id);
    const clientId = randomUUID();
    const membership = await makeMembership(gym.id, plan.id, clientId, status, `txn-${randomUUID()}`);

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
