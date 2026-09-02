import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipService } from '../services/membership.service';
import { membershipRepository } from '../repositories/membership.repository';
import { planRepository } from '../repositories/plan.repository';
import { gymRepository } from '../repositories/gym.repository';

/**
 * Money-flow redesign plan item 2.5 — "ba chốt chặn trạng thái phòng tập". This file covers
 * the `membership.service.ts` purchase guard (the other two — checkin.service.ts and
 * collaboration.service.ts#activeRates — have their own test files).
 *
 * A gym's `status` (PENDING_REVIEW / APPROVED / REJECTED / SUSPENDED) had zero effect on
 * whether a client could buy a membership there — the purchase flow never read it at all.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const plan = {
  id: 'plan-1',
  gymId: 'gym-1',
  status: 'ACTIVE',
  price: 500_000,
  durationDays: 30,
  visitLimit: null,
  saleStartsAt: null,
  saleEndsAt: null,
};

test('a client cannot buy a membership at a SUSPENDED gym', async () => {
  let createCalled = false;
  let thrown: Error | null = null;
  const restores = [
    patch(planRepository, 'findById', async () => plan as any),
    patch(gymRepository, 'findById', async () => ({ id: 'gym-1', status: 'SUSPENDED' }) as any),
    patch(membershipRepository, 'findOpenByClientAndGym', async () => null),
    patch(membershipRepository, 'findOtherActiveMemberships', async () => []),
    patch(membershipRepository, 'create', async () => {
      createCalled = true;
      return {} as any;
    }),
  ];

  try {
    await membershipService.purchase('gym-1', 'plan-1', 'client-1');
  } catch (e) {
    thrown = e as Error;
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(thrown, 'purchase must reject for a SUSPENDED gym');
  assert.equal(createCalled, false, 'no membership row is created for a gym that is not APPROVED');
});

test('a client cannot buy a membership at a gym still PENDING_REVIEW', async () => {
  let createCalled = false;
  let thrown: Error | null = null;
  const restores = [
    patch(planRepository, 'findById', async () => plan as any),
    patch(gymRepository, 'findById', async () => ({ id: 'gym-1', status: 'PENDING_REVIEW' }) as any),
    patch(membershipRepository, 'findOpenByClientAndGym', async () => null),
    patch(membershipRepository, 'findOtherActiveMemberships', async () => []),
    patch(membershipRepository, 'create', async () => {
      createCalled = true;
      return {} as any;
    }),
  ];

  try {
    await membershipService.purchase('gym-1', 'plan-1', 'client-1');
  } catch (e) {
    thrown = e as Error;
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(thrown, 'purchase must reject for a gym still PENDING_REVIEW');
  assert.equal(createCalled, false);
});

// Vòng 4 / Phase C3 — same chokepoint, second axis: APPROVED alone is no longer enough, the
// gym must also be OPEN (not TEMPORARILY_CLOSED / PERMANENTLY_CLOSED by its own owner).
test('a client cannot buy a membership at an APPROVED but TEMPORARILY_CLOSED gym', async () => {
  let createCalled = false;
  const restores = [
    patch(planRepository, 'findById', async () => plan as any),
    patch(gymRepository, 'findById', async () => ({ id: 'gym-1', status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' }) as any),
    patch(membershipRepository, 'findOpenByClientAndGym', async () => null),
    patch(membershipRepository, 'findOtherActiveMemberships', async () => []),
    patch(membershipRepository, 'create', async () => {
      createCalled = true;
      return {} as any;
    }),
  ];

  try {
    await assert.rejects(() => membershipService.purchase('gym-1', 'plan-1', 'client-1'));
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(createCalled, false);
});

test('retryPay bị chặn khi phòng gym APPROVED nhưng đã đóng cửa tạm thời (TEMPORARILY_CLOSED)', async () => {
  const contract = { id: 'm-1', clientId: 'client-1', status: 'PENDING_PAYMENT', paymentTxnId: null, gymId: 'gym-1' };
  const restores = [
    patch(membershipRepository, 'findById', async () => contract as any),
    patch(gymRepository, 'findById', async () => ({ id: 'gym-1', status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' }) as any),
  ];
  try {
    await assert.rejects(
      () => membershipService.retryPay('m-1', 'client-1'),
      (e: any) => e.status === 409,
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test('purchase still succeeds normally at an APPROVED gym', async () => {
  let createCalled = false;
  const restores = [
    patch(planRepository, 'findById', async () => plan as any),
    patch(gymRepository, 'findById', async () => ({ id: 'gym-1', status: 'APPROVED', operationalStatus: 'OPEN' }) as any),
    patch(membershipRepository, 'findOpenByClientAndGym', async () => null),
    patch(membershipRepository, 'findOtherActiveMemberships', async () => []),
    patch(membershipRepository, 'create', async () => {
      createCalled = true;
      return { id: 'membership-1' } as any;
    }),
  ];

  try {
    // attemptPayment (private, module-internal) runs next and will likely throw on this fake
    // contract shape — that is fine, this test only needs to prove the gym-status guard did
    // NOT block a legitimately APPROVED gym; any rejection here comes from further down the
    // pipeline, not from the guard itself.
    await membershipService.purchase('gym-1', 'plan-1', 'client-1').catch(() => {});
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(createCalled, true, 'the guard must not block a gym that IS approved');
});
