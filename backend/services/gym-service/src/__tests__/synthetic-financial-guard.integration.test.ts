import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { prisma } from '../repositories/prisma';
import { authServiceClient } from '../clients/auth-service.client';
import { profileClient } from '../clients/profile.client';
import { paymentClient } from '../clients/payment.client';
import { userClient } from '../clients/user.client';
import { membershipRepository } from '../repositories/membership.repository';
import { membershipService } from '../services/membership.service';
import { complaintCaseService } from '../services/complaint-case/case.service';
import { partnerService } from '../services/partner.service';
import { runSweep as runMembershipPayoutSweep } from '../services/membershipPayout.sweep';
import { runReferralSettlementSweep } from '../services/referral-settlement-sweep.service';

/**
 * Seed-discovery Dot X — SYNTHETIC isolation for `gym-service`.
 * BACKEND INTEGRATION against isolated `gymcoach_gym_test` DB + real Express `app` HTTP routes.
 * Auth identity, profile referral resolution, user notification, and paymentClient are stubbed at client boundaries.
 */

const usable = /_test$/.test((() => {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
})());
const skip = usable ? false : 'Requires DATABASE_URL pointing at a *_test database';

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const tokens = new Map<string, { id: string; email: string; role: string }>();
function tokenFor(id: string, role: 'CUSTOMER' | 'PT' | 'GYM_OWNER' | 'ADMIN', email?: string): string {
  const tok = `tok-${id}`;
  tokens.set(tok, { id, role, email: email ?? `${id.slice(0, 8)}@scale.gymini.test` });
  return tok;
}

const created = {
  partners: [] as string[],
  brands: [] as string[],
  gyms: [] as string[],
  plans: [] as string[],
  memberships: [] as string[],
  complaints: [] as string[],
};

let server: http.Server | undefined;
let baseUrl = '';
const restores: Array<() => void> = [];
const paymentCalls: Array<{ method: string; body: unknown }> = [];
let fakeReferralResolver: (code: string) => Promise<string | null> = async () => null;
const originalEnvCaseFlag = process.env.GYM_COMPLAINT_CASE_ENABLED;

test.before(async () => {
  if (!usable) return;
  process.env.GYM_COMPLAINT_CASE_ENABLED = 'true';
  restores.push(
    patch(authServiceClient, 'verifyToken', async (authHeader: string) => {
      const tok = String(authHeader).replace(/^Bearer /, '');
      const u = tokens.get(tok);
      if (!u) throw Object.assign(new Error('invalid token'), { response: { status: 401, data: { error: 'Unauthorized' } } });
      return { user: u };
    }),
    patch(profileClient, 'resolveReferralCode', async (code: string) => fakeReferralResolver(code)),
    patch(userClient, 'notifyUser', async () => {}),
    patch(userClient, 'notifyUserChecked', async () => false),
    patch(userClient, 'notifyAdmins', async () => {}),
    patch(userClient, 'countActivePtContractsByGyms', async () => 0),
    patch(paymentClient, 'checkout', async (b: any) => {
      paymentCalls.push({ method: 'checkout', body: b });
      return { transactionId: randomUUID(), status: 'PENDING', redirectUrl: null, qrCodeUrl: null, provider: 'MOCK' };
    }),
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => {
      paymentCalls.push({ method: 'releaseMembershipPending', body: b });
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: '0', shortfall: '0' };
    }),
    patch(paymentClient, 'forfeitMembershipOnCancel', async (b: any) => {
      paymentCalls.push({ method: 'forfeitMembershipOnCancel', body: b });
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: '0', shortfall: '0' };
    }),
    patch(paymentClient, 'clawbackReferral', async (b: any) => {
      paymentCalls.push({ method: 'clawbackReferral', body: b });
      return { recovered: '0', shortfall: '0' };
    }),
    patch(paymentClient, 'settleReferral', async (b: any) => {
      paymentCalls.push({ method: 'settleReferral', body: b });
      return { moved: '0', shortfall: '0' };
    }),
    patch(paymentClient, 'requestGymWithdrawal', async (gymId: string, amount: string, payoutInfo: string) => {
      paymentCalls.push({ method: 'requestGymWithdrawal', body: { gymId, amount, payoutInfo } });
      return { id: randomUUID() };
    }),
    patch(paymentClient, 'getTransaction', async (id: string) => ({
      id,
      status: 'PAID',
      relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: 'any',
    })),
    patch(paymentClient, 'getWallet', async () => ({ availableBalance: '0', pendingBalance: '0' })),
  );

  const { default: app } = await import('../app');
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function cleanupFixtures() {
  if (!usable) return;
  if (created.gyms.length) {
    await prisma.gymCaseEvent.deleteMany({ where: { case: { gymId: { in: created.gyms } } } }).catch(() => {});
    await prisma.gymCaseRefundQuote.deleteMany({ where: { case: { gymId: { in: created.gyms } } } }).catch(() => {});
    await prisma.gymComplaintCase.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
    await prisma.gymComplaint.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
    await prisma.gymReview.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
    await prisma.gymMembershipReferral.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
    await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
    await prisma.gymPtCollaboration.deleteMany({ where: { gymId: { in: created.gyms } } }).catch(() => {});
  }
  if (created.plans.length) await prisma.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } }).catch(() => {});
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } }).catch(() => {});
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } }).catch(() => {});
  if (created.partners.length) {
    await prisma.gymPartnerAccount.deleteMany({ where: { partnerId: { in: created.partners } } }).catch(() => {});
    await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } }).catch(() => {});
  }
  created.complaints.length = 0;
  created.memberships.length = 0;
  created.plans.length = 0;
  created.gyms.length = 0;
  created.brands.length = 0;
  created.partners.length = 0;
}

test.after(async () => {
  await cleanupFixtures();
  restores.reverse().forEach((r) => r());
  if (originalEnvCaseFlag === undefined) delete process.env.GYM_COMPLAINT_CASE_ENABLED;
  else process.env.GYM_COMPLAINT_CASE_ENABLED = originalEnvCaseFlag;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

async function callHttp(method: string, path: string, token?: string, body?: unknown, headersExtra: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headersExtra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function seedGymFixture(dataOrigin: 'REAL' | 'SYNTHETIC') {
  const ownerId = randomUUID();
  const partner = await prisma.gymPartner.create({
    data: { legalName: `Partner ${dataOrigin} ${randomUUID().slice(0, 6)}`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
  });
  created.partners.push(partner.id);
  await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: `Brand ${dataOrigin}`, approvedName: `Brand ${dataOrigin}` } });
  created.brands.push(brand.id);
  await prisma.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
  const gym = await prisma.gym.create({
    data: {
      ownerId,
      brandId: brand.id,
      name: `Gym ${dataOrigin}`,
      approvedName: `Gym ${dataOrigin}`,
      address: '100 Test Street',
      approvedAddress: '100 Test Street',
      status: 'APPROVED',
      operationalStatus: 'OPEN',
      dataOrigin,
    },
  });
  created.gyms.push(gym.id);
  const plan = await prisma.gymMembershipPlan.create({
    data: { brandId: brand.id, name: 'Monthly', price: 600_000, durationDays: 30, status: 'ACTIVE' },
  });
  created.plans.push(plan.id);
  return { ownerId, partner, brand, gym, plan };
}

async function rowCounts() {
  const [memberships, referrals, complaints, cases, reviews] = await Promise.all([
    prisma.gymMembershipContract.count(),
    prisma.gymMembershipReferral.count(),
    prisma.gymComplaint.count(),
    prisma.gymComplaintCase.count(),
    prisma.gymReview.count(),
  ]);
  return { memberships, referrals, complaints, cases, reviews };
}

test('Dot X: purchase, lifecycle, complaint, case, review, and withdrawal on SYNTHETIC gym/membership return 409 and write zero rows', { skip }, async () => {
  paymentCalls.length = 0;
  const syn = await seedGymFixture('SYNTHETIC');
  const real = await seedGymFixture('REAL');
  const clientId = randomUUID();
  const adminId = randomUUID();
  const clientTok = tokenFor(clientId, 'CUSTOMER');
  const ownerTok = tokenFor(syn.ownerId, 'GYM_OWNER');
  const adminTok = tokenFor(adminId, 'ADMIN', 'admin@gymini.test');

  // S1-shaped SYNTHETIC EXPIRED (5 days ago, within 30-day complaint window) + forced ACTIVE & PENDING_PAYMENT rows
  const s1Expired = await prisma.gymMembershipContract.create({
    data: {
      gymId: syn.gym.id,
      planId: syn.plan.id,
      clientId,
      status: 'EXPIRED',
      dataOrigin: 'SYNTHETIC',
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
      startDate: new Date(Date.now() - 35 * 86_400_000),
      endDate: new Date(Date.now() - 5 * 86_400_000),
    },
  });
  const synActive = await prisma.gymMembershipContract.create({
    data: {
      gymId: syn.gym.id,
      planId: syn.plan.id,
      clientId: randomUUID(),
      status: 'ACTIVE',
      dataOrigin: 'SYNTHETIC',
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
      paymentTxnId: `fake-${randomUUID()}`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 25 * 86_400_000),
    },
  });
  const synPending = await prisma.gymMembershipContract.create({
    data: {
      gymId: syn.gym.id,
      planId: syn.plan.id,
      clientId: randomUUID(),
      status: 'PENDING_PAYMENT',
      dataOrigin: 'SYNTHETIC',
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
    },
  });
  // Simulated SYNTHETIC complaint row (e.g. legacy/fixture) to verify complaintCaseService.openCase blocks it
  const synComplaint = await prisma.gymComplaint.create({
    data: {
      gymId: syn.gym.id,
      partnerId: syn.partner.id,
      source: 'MEMBER_REPORT',
      issueType: 'CLEANLINESS',
      reporterUserId: clientId,
      description: 'Fixture synthetic complaint',
      photoTokens: [],
    },
  });
  created.memberships.push(s1Expired.id, synActive.id, synPending.id);
  created.complaints.push(synComplaint.id);

  const countsBefore = await rowCounts();

  // 1. Purchase on SYNTHETIC gym -> 409
  const buySyn = await callHttp('POST', `/gyms/${syn.gym.id}/memberships`, clientTok, { planId: syn.plan.id });
  assert.equal(buySyn.status, 409);
  assert.equal(buySyn.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // 2. Retry pay & cancel on SYNTHETIC PENDING_PAYMENT -> 409
  const pendingClientTok = tokenFor(synPending.clientId, 'CUSTOMER');
  const retry = await callHttp('POST', `/me/gym-memberships/${synPending.id}/pay`, pendingClientTok, {});
  assert.equal(retry.status, 409);
  assert.equal(retry.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  const cancelPend = await callHttp('POST', `/me/gym-memberships/${synPending.id}/cancel`, pendingClientTok, {});
  assert.equal(cancelPend.status, 409);
  assert.equal(cancelPend.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // 3. Self-cancel & Admin refund on SYNTHETIC ACTIVE -> 409
  const activeClientTok = tokenFor(synActive.clientId, 'CUSTOMER');
  const selfCancel = await callHttp('POST', `/me/gym-memberships/${synActive.id}/cancel-membership`, activeClientTok, {});
  assert.equal(selfCancel.status, 409);
  assert.equal(selfCancel.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  const adminRefund = await callHttp('POST', `/admin/gym-memberships/${synActive.id}/refund`, adminTok, { reason: 'GYM_CLOSED' });
  assert.equal(adminRefund.status, 409);
  assert.equal(adminRefund.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // 4. Internal activate -> 409
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';
  const act = await callHttp('POST', `/internal/gym-memberships/${synPending.id}/activate`, undefined, { transactionId: 't-1' }, { 'x-service-secret': internalSecret });
  assert.equal(act.status, 409);

  // 5. Owner withdrawal on SYNTHETIC gym -> 409
  const wd = await callHttp('POST', `/owner/gyms/${syn.gym.id}/withdrawals`, ownerTok, { amount: '100000', payoutInfo: 'VCB 123' });
  assert.equal(wd.status, 409);
  assert.equal(wd.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // 6. Member complaint on SYNTHETIC EXPIRED within 30 days -> 409 SYNTHETIC_RECORD_NOT_TRANSACTABLE
  const cmp = await callHttp('POST', `/gyms/${syn.gym.id}/complaints`, clientTok, { issueType: 'CLEANLINESS', description: 'Trying to complain' });
  assert.equal(cmp.status, 409);
  assert.equal(cmp.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // Even on a REAL gym, a client holding ONLY a recent SYNTHETIC membership is refused 409 (never treated as eligible)
  const synMemOnReal = await prisma.gymMembershipContract.create({
    data: {
      gymId: real.gym.id,
      planId: real.plan.id,
      clientId,
      status: 'EXPIRED',
      dataOrigin: 'SYNTHETIC',
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
      startDate: new Date(Date.now() - 35 * 86_400_000),
      endDate: new Date(Date.now() - 5 * 86_400_000),
    },
  });
  created.memberships.push(synMemOnReal.id);
  const countsBeforeRealComplaint = await rowCounts();
  const cmpReal = await callHttp('POST', `/gyms/${real.gym.id}/complaints`, clientTok, { issueType: 'BILLING', description: 'Synthetic mem complaint' });
  assert.equal(cmpReal.status, 409);
  assert.equal(cmpReal.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  // 7. Complaint Case V2.1 openCase on SYNTHETIC gym/membership -> 409
  await assert.rejects(
    () => complaintCaseService.openCase({ id: adminId, role: 'ADMIN' }, synComplaint.id, { caseClass: 'MEM_ACCESS', membershipId: s1Expired.id }),
    (e: any) => e.status === 409 && e.code === 'SYNTHETIC_RECORD_NOT_TRANSACTABLE',
  );

  // 8. Reviews on SYNTHETIC gym -> 409
  const rev = await callHttp('POST', `/gyms/${syn.gym.id}/reviews`, clientTok, { rating: 5, comment: 'Fake boost' });
  assert.equal(rev.status, 409);
  assert.equal(rev.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  const delRev = await callHttp('DELETE', `/gyms/${syn.gym.id}/reviews`, clientTok);
  assert.equal(delRev.status, 409);
  assert.equal(delRev.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');

  const countsAfter = await rowCounts();
  assert.deepEqual(countsAfter, countsBeforeRealComplaint);
  assert.equal(paymentCalls.length, 0, 'zero paymentClient calls allowed');
  void countsBefore;
});

test('Dot X: SYNTHETIC PT referral code refused on REAL gym purchase & aggregations exclude SYNTHETIC', { skip }, async () => {
  paymentCalls.length = 0;
  const real = await seedGymFixture('REAL');
  const realClient = randomUUID();
  const realClientTok = tokenFor(realClient, 'CUSTOMER', 'real-buyer@gmail.com');

  const { syntheticNotTransactableError } = await import('../services/synthetic-guard');
  fakeReferralResolver = async (code: string) => {
    if (code === 'SYNPT') throw syntheticNotTransactableError();
    return null;
  };
  try {
    const res = await callHttp('POST', `/gyms/${real.gym.id}/memberships`, realClientTok, { planId: real.plan.id, referralCode: 'SYNPT' });
    assert.equal(res.status, 409);
    assert.equal(res.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');
    assert.equal(paymentCalls.length, 0);
  } finally {
    fakeReferralResolver = async () => null;
  }

  // Mix REAL + SYNTHETIC ACTIVE memberships at same REAL gym -> aggregations & partner termination only touch REAL
  const mReal = await prisma.gymMembershipContract.create({
    data: {
      gymId: real.gym.id,
      planId: real.plan.id,
      clientId: randomUUID(),
      status: 'ACTIVE',
      dataOrigin: 'REAL',
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
      paymentTxnId: `real-txn-${randomUUID()}`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 25 * 86_400_000),
    },
  });
  const mSyn = await prisma.gymMembershipContract.create({
    data: {
      gymId: real.gym.id,
      planId: real.plan.id,
      clientId: randomUUID(),
      status: 'ACTIVE',
      dataOrigin: 'SYNTHETIC',
      priceAtPurchase: 900_000,
      durationDaysSnapshot: 30,
      paymentTxnId: null,
      startDate: new Date(),
      endDate: new Date(Date.now() + 25 * 86_400_000),
    },
  });
  created.memberships.push(mReal.id, mSyn.id);

  const activeRows = await membershipRepository.findActiveByGyms([real.gym.id]);
  assert.deepEqual(activeRows.map((m) => m.id), [mReal.id]);
  const counts = await membershipRepository.countActiveByGyms([real.gym.id]);
  assert.equal(counts.get(real.gym.id), 1);

  // Partner termination PRORATED_REFUND only refunds mReal, never touches mSyn
  paymentCalls.length = 0;
  const term = await partnerService.terminate(real.partner.id, randomUUID(), 'Closure test', 'PRORATED_REFUND');
  assert.equal(term.refunded, 1);
  assert.equal(term.refundErrors.length, 0);
  assert.equal(paymentCalls.filter((c) => c.method === 'releaseMembershipPending').length, 1);
  assert.equal((paymentCalls[0].body as any).entityOrigin, 'REAL');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mSyn.id } })).status, 'ACTIVE');
});

test('Dot X: background sweeps on S1-shaped SYNTHETIC EXPIRED memberships invoke 0 payment calls and mutate nothing', { skip }, async () => {
  paymentCalls.length = 0;
  const syn = await seedGymFixture('SYNTHETIC');
  const s1Mem = await prisma.gymMembershipContract.create({
    data: {
      gymId: syn.gym.id,
      planId: syn.plan.id,
      clientId: randomUUID(),
      status: 'EXPIRED',
      dataOrigin: 'SYNTHETIC',
      paymentTxnId: null,
      payoutReleasedAt: null,
      priceAtPurchase: 600_000,
      durationDaysSnapshot: 30,
      startDate: new Date(Date.now() - 40 * 86_400_000),
      endDate: new Date(Date.now() - 10 * 86_400_000),
    },
  });
  created.memberships.push(s1Mem.id);

  await runMembershipPayoutSweep();
  await runReferralSettlementSweep();
  assert.equal(paymentCalls.length, 0);
  const after = await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: s1Mem.id } });
  assert.equal(after.status, 'EXPIRED');
  assert.equal(after.payoutReleasedAt, null);
  void membershipService;
});
