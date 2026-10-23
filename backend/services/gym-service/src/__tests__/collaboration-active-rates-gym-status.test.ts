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

type OperationalStatus = 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED';

async function makeGym(status: 'APPROVED' | 'SUSPENDED', operationalStatus: OperationalStatus = 'OPEN') {
  return prisma.gym.create({
    data: {
      id: randomUUID(),
      ownerId: randomUUID(),
      name: `Test Gym ${status} ${operationalStatus}`,
      address: '123 Test St',
      status,
      operationalStatus,
    },
  });
}

async function makeAcceptedCollaboration(gymId: string, ptUserId: string, overrides: Record<string, any> = {}) {
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
      ...overrides,
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

// ── Operational status axis ─────────────────────────────────────────────────
//
// `status: 'APPROVED'` alone is the admin's moderation gate. The owner's own switch
// (`operationalStatus`) is a second, independent axis: a branch that is temporarily or
// permanently closed is still APPROVED, and must not take on a NEW gym-tied PT contract.
// Contracts already signed are unaffected — they carry their own rate snapshot and never come
// back through activeRates().

for (const closed of ['TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED'] as const) {
  integrationTest(`activeRates returns null for an ACCEPTED collaboration at an APPROVED but ${closed} gym`, async () => {
    const gym = await makeGym('APPROVED', closed);
    const ptUserId = randomUUID();
    const row = await makeAcceptedCollaboration(gym.id, ptUserId);

    try {
      const rates = await collaborationService.activeRates(gym.id, ptUserId);
      assert.equal(rates, null, `a ${closed} gym must not hand out a rate table for new contracts`);

      const untouched = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(untouched.status, 'ACCEPTED', 'refusing new contracts must not end the collaboration itself');
    } finally {
      await prisma.gymPtCollaboration.delete({ where: { id: row.id } }).catch(() => {});
      await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
    }
  });
}

integrationTest('activeRates hands the split out again once a TEMPORARILY_CLOSED gym reopens', async () => {
  const gym = await makeGym('APPROVED', 'TEMPORARILY_CLOSED');
  const ptUserId = randomUUID();
  const row = await makeAcceptedCollaboration(gym.id, ptUserId);

  try {
    assert.equal(await collaborationService.activeRates(gym.id, ptUserId), null);
    await prisma.gym.update({ where: { id: gym.id }, data: { operationalStatus: 'OPEN' } });
    const rates = await collaborationService.activeRates(gym.id, ptUserId);
    assert.ok(rates, 'a temporary closure pauses new contracts, it does not end the agreement');
    assert.equal(rates!.collaborationId, row.id);
  } finally {
    await prisma.gymPtCollaboration.delete({ where: { id: row.id } }).catch(() => {});
    await prisma.gym.delete({ where: { id: gym.id } }).catch(() => {});
  }
});

integrationTest('listAcceptedGymsForPt (client gym picker) only offers gyms that are APPROVED and OPEN', async () => {
  const ptUserId = randomUUID();
  const open = await makeGym('APPROVED', 'OPEN');
  const tempClosed = await makeGym('APPROVED', 'TEMPORARILY_CLOSED');
  const permClosed = await makeGym('APPROVED', 'PERMANENTLY_CLOSED');
  const suspended = await makeGym('SUSPENDED', 'OPEN');
  const gyms = [open, tempClosed, permClosed, suspended];
  const rows = await Promise.all(gyms.map((g) => makeAcceptedCollaboration(g.id, ptUserId)));

  try {
    const offered = await collaborationService.listAcceptedGymsForPt(ptUserId);
    assert.deepEqual(
      offered.map((o) => o.gym.id),
      [open.id],
      'a closed or suspended branch must not be offered as a place to train',
    );
  } finally {
    await prisma.gymPtCollaboration.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }).catch(() => {});
    await prisma.gym.deleteMany({ where: { id: { in: gyms.map((g) => g.id) } } }).catch(() => {});
  }
});

integrationTest('listAcceptedGymsForPt never offers a gym that activeRates would then refuse (termination initiated)', async () => {
  const ptUserId = randomUUID();
  const live = await makeGym('APPROVED', 'OPEN');
  const windingDown = await makeGym('APPROVED', 'OPEN');
  const liveRow = await makeAcceptedCollaboration(live.id, ptUserId);
  // Notice-period termination: status stays ACCEPTED until effectiveAt, but no NEW contract.
  const windingDownRow = await makeAcceptedCollaboration(windingDown.id, ptUserId, {
    effectiveAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });

  try {
    const offered = await collaborationService.listAcceptedGymsForPt(ptUserId);
    for (const o of offered) {
      const rates = await collaborationService.activeRates(o.gym.id, ptUserId);
      assert.ok(rates, `picker offered gym ${o.gym.id} but activeRates refuses it`);
    }
    assert.deepEqual(offered.map((o) => o.gym.id), [live.id]);
  } finally {
    await prisma.gymPtCollaboration.deleteMany({ where: { id: { in: [liveRow.id, windingDownRow.id] } } }).catch(() => {});
    await prisma.gym.deleteMany({ where: { id: { in: [live.id, windingDown.id] } } }).catch(() => {});
  }
});
