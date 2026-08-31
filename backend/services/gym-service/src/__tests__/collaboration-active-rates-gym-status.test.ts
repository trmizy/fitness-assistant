import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { collaborationService } from '../services/collaboration.service';

/**
 * Money-flow redesign plan item 2.5 — chốt chặn thứ ba: `activeRates` only filtered
 * `status: 'ACCEPTED'` on the collaboration row itself, never checking whether the GYM on that
 * row was still APPROVED. A gym suspended for a violation would still hand out its frozen
 * PT/gym/platform split to any new PT-contract created "through" it — new revenue-splitting
 * business at a gym the platform had just shut down.
 *
 * Integration test (real dev DB) — simplest way to build a genuinely ACCEPTED collaboration
 * row plus a gym whose status varies, without re-deriving collaboration.service.ts's own
 * accept-flow invariants in a mock.
 */

async function makeGym(status: 'APPROVED' | 'SUSPENDED') {
  return prisma.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: `Test Gym ${status}`, address: '123 Test St', status },
  });
}

async function makeAcceptedCollaboration(gymId: string, ptUserId: string) {
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      proposedPtRate: 0.6,
      proposedGymRate: 0.3,
      platformRate: 0.1,
      status: 'ACCEPTED',
      proposedBy: 'PT',
      round: 1,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(),
    },
  });
}

integrationTest('activeRates returns null for an ACCEPTED collaboration at a SUSPENDED gym', async () => {
  const gym = await makeGym('SUSPENDED');
  const ptUserId = randomUUID();
  const row = await makeAcceptedCollaboration(gym.id, ptUserId);

  try {
    const rates = await collaborationService.activeRates(gym.id, ptUserId);
    assert.equal(rates, null, 'a suspended gym must not hand out a rate table for new contracts');
  } finally {
    await prisma.gymPtCollaboration.delete({ where: { id: row.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});

integrationTest('activeRates still returns the frozen split at an APPROVED gym', async () => {
  const gym = await makeGym('APPROVED');
  const ptUserId = randomUUID();
  const row = await makeAcceptedCollaboration(gym.id, ptUserId);

  try {
    const rates = await collaborationService.activeRates(gym.id, ptUserId);
    assert.ok(rates);
    assert.equal(rates!.ptRate, '0.6');
    assert.equal(rates!.gymRate, '0.3');
    assert.equal(rates!.platformRate, '0.1');
  } finally {
    await prisma.gymPtCollaboration.delete({ where: { id: row.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});
