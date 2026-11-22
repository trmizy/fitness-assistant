import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { prisma } from '../repositories/prisma';
import { authServiceClient } from '../clients/auth-service.client';
import { paymentClient } from '../clients/payment.client';
import { userClient } from '../clients/user.client';

/**
 * Gym Owner handoff items 1 and 3 (owner decisions 22/11/2026), gym-service side, through the REAL Express app:
 *   POST /owner/gyms/:gymId/withdrawals  - the destination is the partner's REGISTERED payout account read from GymPartner.payoutBank*;
 *        a `payoutInfo` in the body is ignored; no (or incomplete) registered account -> 409 PAYOUT_ACCOUNT_REQUIRED and payment-service is NOT called;
 *        the requester sent to payment-service is the authenticated user.
 *   POST /internal/gyms/:gymId/withdrawal-recipients - the owners to notify (service secret required).
 * evidence label: BACKEND INTEGRATION (real routes + real *_test database). auth-service token check and paymentClient are TEST FIXTURE stubs.
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
function tokenFor(id: string, role: 'GYM_OWNER' | 'ADMIN'): string {
  const tok = `tok-${id}`;
  tokens.set(tok, { id, role, email: `${id.slice(0, 8)}@wd.gymini.test` });
  return tok;
}

const created = { partners: [] as string[], brands: [] as string[], gyms: [] as string[] };
const restores: Array<() => void> = [];
const paymentCalls: Array<{ gymId: string; amount: string; payout: any; origin: unknown }> = [];
let server: http.Server | undefined;
let baseUrl = '';
const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

test.before(async () => {
  if (!usable) return;
  restores.push(
    patch(authServiceClient, 'verifyToken', async (authHeader: string) => {
      const u = tokens.get(String(authHeader).replace(/^Bearer /, ''));
      if (!u) throw Object.assign(new Error('invalid token'), { response: { status: 401, data: { error: 'Unauthorized' } } });
      return { user: u };
    }),
    patch(userClient, 'notifyUser', async () => {}),
    patch(userClient, 'notifyUserChecked', async () => false),
    patch(userClient, 'notifyAdmins', async () => {}),
    patch(userClient, 'countActivePtContractsByGyms', async () => 0),
    patch(paymentClient, 'requestGymWithdrawal', async (gymId: string, amount: string, payout: any, origin: unknown) => {
      paymentCalls.push({ gymId, amount, payout, origin });
      return { id: randomUUID(), status: 'PENDING', amount };
    }),
  );
  const { default: app } = await import('../app');
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (usable) {
    if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } }).catch(() => {});
    if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } }).catch(() => {});
    if (created.partners.length) {
      await prisma.gymPartnerAccount.deleteMany({ where: { partnerId: { in: created.partners } } }).catch(() => {});
      await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } }).catch(() => {});
    }
  }
  restores.reverse().forEach((r) => r());
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown; secret?: string } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.secret ? { 'x-service-secret': opts.secret } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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

async function seed(payout: { bank?: string | null; number?: string | null; holder?: string | null } | null) {
  const ownerId = randomUUID();
  const partner = await prisma.gymPartner.create({
    data: {
      legalName: `WD partner ${randomUUID().slice(0, 6)}`,
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
      ...(payout ? { payoutBankName: payout.bank ?? null, payoutBankAccountNumber: payout.number ?? null, payoutBankAccountHolder: payout.holder ?? null } : {}),
    },
  });
  created.partners.push(partner.id);
  await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'WD Brand', approvedName: 'WD Brand' } });
  created.brands.push(brand.id);
  await prisma.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
  const gym = await prisma.gym.create({
    data: { ownerId, brandId: brand.id, name: 'WD Gym', approvedName: 'Gym Quận 1', address: '1 Test', approvedAddress: '1 Test', status: 'APPROVED', operationalStatus: 'OPEN', dataOrigin: 'REAL' },
  });
  created.gyms.push(gym.id);
  return { ownerId, partner, gym };
}

test('withdrawal: the destination is the REGISTERED account; a payoutInfo in the body is ignored; the requester is the authenticated user', { skip }, async () => {
  paymentCalls.length = 0;
  const s = await seed({ bank: 'Vietcombank', number: '0123456789', holder: 'NGUYEN VAN A' });
  const tok = tokenFor(s.ownerId, 'GYM_OWNER');
  const r = await call('POST', `/owner/gyms/${s.gym.id}/withdrawals`, { token: tok, body: { amount: '200000', payoutInfo: 'ATTACKER BANK 999999 — SOMEONE ELSE', requestedByUserId: 'forged-user' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(paymentCalls.length, 1);
  assert.equal(paymentCalls[0].gymId, s.gym.id);
  assert.equal(paymentCalls[0].amount, '200000');
  assert.equal(paymentCalls[0].payout.payoutInfo, 'Vietcombank — 0123456789 — NGUYEN VAN A');
  assert.doesNotMatch(JSON.stringify(paymentCalls[0]), /ATTACKER|forged-user/);
  assert.equal(paymentCalls[0].payout.requestedByUserId, s.ownerId);
});

test('withdrawal: a body without payoutInfo works (the field is gone from the contract)', { skip }, async () => {
  paymentCalls.length = 0;
  const s = await seed({ bank: 'ACB', number: '555', holder: 'B' });
  const r = await call('POST', `/owner/gyms/${s.gym.id}/withdrawals`, { token: tokenFor(s.ownerId, 'GYM_OWNER'), body: { amount: '100000' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(paymentCalls[0].payout.payoutInfo, 'ACB — 555 — B');
});

test('withdrawal: no registered account -> 409 PAYOUT_ACCOUNT_REQUIRED and payment-service is not called', { skip }, async () => {
  paymentCalls.length = 0;
  const none = await seed(null);
  const r1 = await call('POST', `/owner/gyms/${none.gym.id}/withdrawals`, { token: tokenFor(none.ownerId, 'GYM_OWNER'), body: { amount: '100000', payoutInfo: 'typed by the client' } });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error.code, 'PAYOUT_ACCOUNT_REQUIRED');
  assert.match(r1.body.error.message, /tài khoản nhận tiền/i);

  const partial = await seed({ bank: 'ACB', number: '555', holder: null });
  const r2 = await call('POST', `/owner/gyms/${partial.gym.id}/withdrawals`, { token: tokenFor(partial.ownerId, 'GYM_OWNER'), body: { amount: '100000' } });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error.code, 'PAYOUT_ACCOUNT_REQUIRED');
  assert.equal(paymentCalls.length, 0);
});

test('internal withdrawal-recipients: the branch owner + the ACTIVE OWNER account of its partner, once each; managers / revoked excluded; secret required; 404 unknown', { skip }, async () => {
  const s = await seed({ bank: 'ACB', number: '555', holder: 'B' });
  const manager = randomUUID();
  const revokedOwner = randomUUID();
  await prisma.gymPartnerAccount.create({ data: { partnerId: s.partner.id, userId: manager, role: 'MANAGER', scopedGymIds: [s.gym.id], status: 'ACTIVE', activatedAt: new Date() } });
  await prisma.gymPartnerAccount.create({ data: { partnerId: s.partner.id, userId: revokedOwner, role: 'OWNER', scopedGymIds: [], status: 'REVOKED' } });
  // a branch still listed under an earlier owner user id (the branch's own ownerId differs from the partner's ACTIVE owner): both are told
  const earlierOwner = randomUUID();
  const moved = await prisma.gym.create({
    data: { ownerId: earlierOwner, brandId: s.gym.brandId, name: 'WD Gym 2', address: '2 Test', approvedAddress: '2 Test', status: 'APPROVED', operationalStatus: 'OPEN', dataOrigin: 'REAL' },
  });
  created.gyms.push(moved.id);

  const same = await call('POST', `/internal/gyms/${s.gym.id}/withdrawal-recipients`, { secret: SECRET, body: {} });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.deepEqual(same.body.data.userIds, [s.ownerId], 'the owner is both the branch owner and the ACTIVE OWNER account: once');
  assert.equal(same.body.data.gymName, 'Gym Quận 1');

  const both = await call('POST', `/internal/gyms/${moved.id}/withdrawal-recipients`, { secret: SECRET, body: {} });
  assert.equal(both.status, 200, JSON.stringify(both.body));
  assert.deepEqual([...both.body.data.userIds].sort(), [earlierOwner, s.ownerId].sort());
  assert.ok(!both.body.data.userIds.includes(manager) && !both.body.data.userIds.includes(revokedOwner));

  const path = `/internal/gyms/${s.gym.id}/withdrawal-recipients`;
  assert.ok([401, 403].includes((await call('POST', path, { body: {} })).status), 'no secret -> refused');
  assert.ok([401, 403].includes((await call('POST', path, { secret: 'wrong', body: {} })).status), 'wrong secret -> refused');
  const missing = await call('POST', `/internal/gyms/${randomUUID()}/withdrawal-recipients`, { secret: SECRET, body: {} });
  assert.equal(missing.status, 404);
});
