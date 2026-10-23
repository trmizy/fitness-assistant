/**
 * Phase 3 / P3.1 - read-only membership lookup (`membership-eligibility.service.ts`) and its
 * internal routes `/internal/clients/:clientId/active-memberships` and `/active-gyms`.
 *
 * Evidence label: BACKEND INTEGRATION + REAL HTTP/API (real Express app on an ephemeral port,
 * real Prisma queries on an isolated `*_test` database). The suite refuses to run (all tests
 * SKIPPED) unless DATABASE_URL names a database ending in `_test` - see test-db-guard.ts.
 *
 * Covers: active / expired-by-status / expired-by-date / out-of-visits / cancelled / pending
 * payment / pending issue (the schema has no "frozen" state), branch -> brand resolution, sibling
 * branches, another brand never counted, another client never counted, a branch without a brand,
 * unknown branch, bad query params, service-secret auth, and that check-in agrees with the lookup
 * on every state (they share the predicates, so they cannot diverge).
 */
import nodeTest from 'node:test';
import { guardedTest as test, skip } from './test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const SECRET = 'p3-1-test-internal-secret';
process.env.INTERNAL_SERVICE_SECRET = SECRET;

import {
  hasPassedEndDate,
  hasVisitsLeft,
  isMembershipActive,
} from '../services/membership-eligibility.service';

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- pure predicates (no DB)
// Plain node:test (no DB involved), so it also runs when the DB guard skips the rest.
nodeTest('isMembershipActive: status, end date and visit limit', () => {
  const now = new Date('2026-10-17T00:00:00Z');
  const base = { status: 'ACTIVE', endDate: new Date(now.getTime() + DAY), totalVisits: null as number | null, usedVisits: 0 };
  assert.equal(isMembershipActive(base, now), true);
  assert.equal(isMembershipActive({ ...base, endDate: null }, now), true, 'no end date = open-ended');
  assert.equal(isMembershipActive({ ...base, endDate: new Date(now.getTime() - 1) }, now), false);
  assert.equal(isMembershipActive({ ...base, endDate: new Date(now.getTime()) }, now), true, 'end date == now is not yet passed (check-in uses <)');
  assert.equal(isMembershipActive({ ...base, totalVisits: 5, usedVisits: 4 }, now), true);
  assert.equal(isMembershipActive({ ...base, totalVisits: 5, usedVisits: 5 }, now), false);
  for (const status of ['EXPIRED', 'CANCELLED', 'PENDING_PAYMENT', 'PENDING_ISSUE']) {
    assert.equal(isMembershipActive({ ...base, status }, now), false, status);
  }
  assert.equal(hasPassedEndDate(null, now), false);
  assert.equal(hasVisitsLeft(null, 999), true);
});

// ---------------------------------------------------------------- DB + HTTP
let server: http.Server;
let baseUrl = '';
let prismaRef: typeof import('../repositories/prisma').prisma;
let checkinRef: typeof import('../services/checkin.service').checkinService;
let signRef: typeof import('../utils/checkinToken').signGymCheckinToken;

const created = { memberships: [] as string[], plans: [] as string[], gyms: [] as string[], brands: [] as string[] };

test.before(async () => {
  const { default: app } = await import('../app');
  prismaRef = (await import('../repositories/prisma')).prisma;
  checkinRef = (await import('../services/checkin.service')).checkinService;
  signRef = (await import('../utils/checkinToken')).signGymCheckinToken;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!skip) {
    await prismaRef.gymCheckIn.deleteMany({ where: { membershipId: { in: created.memberships } } });
    await prismaRef.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
    await prismaRef.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
    await prismaRef.gym.deleteMany({ where: { id: { in: created.gyms } } });
    await prismaRef.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
    await prismaRef.$disconnect();
  }
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

async function brandWithBranches(n: number, branchStatus: 'APPROVED' | 'DRAFT' = 'APPROVED') {
  const brand = await prismaRef.gymBrand.create({ data: { id: randomUUID(), ownerId: randomUUID(), name: 'P3.1 Brand' } });
  created.brands.push(brand.id);
  const gyms: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = await prismaRef.gym.create({
      data: { id: randomUUID(), ownerId: brand.ownerId, brandId: brand.id, name: `P3.1 Gym ${i}`, address: '1 Test St', status: branchStatus },
    });
    created.gyms.push(g.id);
    gyms.push(g.id);
  }
  const plan = await prismaRef.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'P3.1 Plan', price: 500_000, durationDays: 30 },
  });
  created.plans.push(plan.id);
  return { brandId: brand.id, ownerId: brand.ownerId, gyms, planId: plan.id };
}

async function membership(
  gymId: string,
  planId: string,
  clientId: string,
  o: Partial<{ status: any; endDate: Date | null; totalVisits: number | null; usedVisits: number; createdAt: Date }> = {},
) {
  const m = await prismaRef.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId, planId, clientId,
      status: o.status ?? 'ACTIVE',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 30,
      startDate: new Date(Date.now() - DAY),
      endDate: o.endDate === undefined ? new Date(Date.now() + 15 * DAY) : o.endDate,
      totalVisits: o.totalVisits ?? null,
      usedVisits: o.usedVisits ?? 0,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
  created.memberships.push(m.id);
  return m;
}

async function get(path: string, secret: string | null = SECRET) {
  const res = await fetch(baseUrl + path, { headers: secret === null ? {} : { 'x-service-secret': secret } });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const lookup = (clientId: string, qs = '') => get(`/internal/clients/${clientId}/active-memberships${qs}`);

test('active membership: found by branch, by sibling branch (brand-level) and by brand', async () => {
  const b = await brandWithBranches(2);
  const clientId = randomUUID();
  const m = await membership(b.gyms[0], b.planId, clientId, { totalVisits: 10, usedVisits: 3 });

  for (const qs of [`?gymId=${b.gyms[0]}`, `?gymId=${b.gyms[1]}`, `?brandId=${b.brandId}`]) {
    const r = await lookup(clientId, qs);
    assert.equal(r.status, 200, qs);
    assert.equal(r.body.success, true);
    assert.equal(r.body.data.hasActiveMembership, true, qs);
    assert.equal(r.body.data.brandId, b.brandId);
    assert.equal(r.body.data.membership.membershipId, m.id);
    assert.equal(r.body.data.membership.brandId, b.brandId);
    assert.equal(r.body.data.membership.purchaseGymId, b.gyms[0]);
    assert.equal(r.body.data.membership.totalVisits, 10);
    assert.equal(r.body.data.membership.usedVisits, 3);
    assert.equal(r.body.data.memberships.length, 1);
  }
  assert.equal((await lookup(clientId, `?gymId=${b.gyms[1]}`)).body.data.gymId, b.gyms[1]);
});

test('a membership of another brand is not counted; neither is another client', async () => {
  const a = await brandWithBranches(1);
  const other = await brandWithBranches(1);
  const clientId = randomUUID();
  await membership(a.gyms[0], a.planId, clientId);

  const wrongBrand = await lookup(clientId, `?gymId=${other.gyms[0]}`);
  assert.equal(wrongBrand.body.data.hasActiveMembership, false);
  assert.equal(wrongBrand.body.data.brandId, other.brandId);
  assert.equal((await lookup(clientId, `?brandId=${other.brandId}`)).body.data.hasActiveMembership, false);

  const stranger = await lookup(randomUUID(), `?gymId=${a.gyms[0]}`);
  assert.equal(stranger.body.data.hasActiveMembership, false);
  assert.equal(stranger.body.data.membership, null);
  assert.deepEqual(stranger.body.data.memberships, []);
});

test('only an ACTIVE, unexpired membership with visits left counts (all other states do not)', async () => {
  const b = await brandWithBranches(1);
  const cases: Array<[string, Parameters<typeof membership>[3], boolean]> = [
    ['ACTIVE', {}, true],
    ['ACTIVE open-ended (no end date)', { endDate: null }, true],
    ['ACTIVE unlimited visits', { totalVisits: null, usedVisits: 50 }, true],
    ['ACTIVE with visits left', { totalVisits: 5, usedVisits: 4 }, true],
    ['EXPIRED status', { status: 'EXPIRED' }, false],
    ['CANCELLED', { status: 'CANCELLED' }, false],
    ['PENDING_PAYMENT', { status: 'PENDING_PAYMENT' }, false],
    ['PENDING_ISSUE (closest to "frozen": none exists in the schema)', { status: 'PENDING_ISSUE' }, false],
    ['ACTIVE but end date passed', { endDate: new Date(Date.now() - DAY) }, false],
    ['ACTIVE but visits used up', { totalVisits: 5, usedVisits: 5 }, false],
  ];
  for (const [label, o, expected] of cases) {
    const clientId = randomUUID();
    const m = await membership(b.gyms[0], b.planId, clientId, o);
    const r = await lookup(clientId, `?gymId=${b.gyms[0]}`);
    assert.equal(r.body.data.hasActiveMembership, expected, label);
    assert.equal(r.body.data.membership?.membershipId ?? null, expected ? m.id : null, label);
  }
});

test('lookup is read-only: an ACTIVE row past its end date is NOT flipped to EXPIRED by the API', async () => {
  const b = await brandWithBranches(1);
  const clientId = randomUUID();
  const m = await membership(b.gyms[0], b.planId, clientId, { endDate: new Date(Date.now() - DAY) });
  await lookup(clientId, `?gymId=${b.gyms[0]}`);
  const after = await prismaRef.gymMembershipContract.findUniqueOrThrow({ where: { id: m.id } });
  assert.equal(after.status, 'ACTIVE');
  assert.equal(after.usedVisits, 0);
});

test('several active memberships: newest first, all listed; no scope lists every brand', async () => {
  const a = await brandWithBranches(2); // at most one open membership per (client, branch): buy at two branches
  const b = await brandWithBranches(1);
  const clientId = randomUUID();
  const older = await membership(a.gyms[0], a.planId, clientId, { createdAt: new Date(Date.now() - 5 * DAY) });
  const newer = await membership(a.gyms[1], a.planId, clientId);
  const inB = await membership(b.gyms[0], b.planId, clientId);

  const byGym = (await lookup(clientId, `?gymId=${a.gyms[0]}`)).body.data;
  assert.deepEqual(byGym.memberships.map((m: any) => m.membershipId), [newer.id, older.id]);
  assert.equal(byGym.membership.membershipId, newer.id);

  const all = (await lookup(clientId)).body.data;
  assert.equal(all.gymId, null);
  assert.equal(all.brandId, null);
  assert.deepEqual(new Set(all.memberships.map((m: any) => m.membershipId)), new Set([newer.id, older.id, inB.id]));
});

test('a branch without a brand matches nothing (200, brandId null); unknown branch is 404', async () => {
  const brand = await brandWithBranches(1);
  const solo = await prismaRef.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), brandId: null, name: 'P3.1 Solo', address: '1 Test St', status: 'APPROVED' },
  });
  created.gyms.push(solo.id);
  const clientId = randomUUID();
  await membership(brand.gyms[0], brand.planId, clientId);

  const r = await lookup(clientId, `?gymId=${solo.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.hasActiveMembership, false);
  assert.equal(r.body.data.brandId, null);

  const missing = await lookup(clientId, `?gymId=${randomUUID()}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'GYM_NOT_FOUND');
});

test('bad query params are 400 (both ids, empty id, repeated id)', async () => {
  const clientId = randomUUID();
  assert.equal((await lookup(clientId, `?gymId=${randomUUID()}&brandId=${randomUUID()}`)).status, 400);
  assert.equal((await lookup(clientId, '?gymId=')).status, 400);
  assert.equal((await lookup(clientId, '?brandId=')).status, 400);
  assert.equal((await lookup(clientId, `?gymId=${randomUUID()}&gymId=${randomUUID()}`)).status, 400);
});

test('active-gyms (the route pt-discovery calls): every APPROVED branch of an active brand, nothing else', async () => {
  const a = await brandWithBranches(2);
  const other = await brandWithBranches(1);
  const lapsed = await brandWithBranches(1);
  const draftBranch = await prismaRef.gym.create({
    data: { id: randomUUID(), ownerId: a.ownerId, brandId: a.brandId, name: 'P3.1 Draft', address: '1 Test St', status: 'DRAFT' },
  });
  created.gyms.push(draftBranch.id);
  const clientId = randomUUID();
  await membership(a.gyms[0], a.planId, clientId); // bought at branch 0, valid at 0 and 1
  await membership(lapsed.gyms[0], lapsed.planId, clientId, { status: 'EXPIRED' });

  const r = await get(`/internal/clients/${clientId}/active-gyms`);
  assert.equal(r.status, 200);
  assert.deepEqual([...r.body.data.gymIds].sort(), [...a.gyms].sort());
  assert.ok(!r.body.data.gymIds.includes(draftBranch.id));
  assert.ok(!r.body.data.gymIds.includes(other.gyms[0]));
  assert.ok(!r.body.data.gymIds.includes(lapsed.gyms[0]));

  const none = await get(`/internal/clients/${randomUUID()}/active-gyms`);
  assert.deepEqual(none.body.data.gymIds, []);
});

test('internal auth: missing or wrong x-service-secret is 401 on both routes; correct secret is 200', async () => {
  const clientId = randomUUID();
  for (const path of [`/internal/clients/${clientId}/active-memberships`, `/internal/clients/${clientId}/active-gyms`]) {
    assert.equal((await get(path, null)).status, 401, `${path} no secret`);
    assert.equal((await get(path, 'wrong-secret')).status, 401, `${path} wrong secret`);
    assert.equal((await get(path, SECRET)).status, 200, `${path} right secret`);
  }
  // A client JWT/headers are not a substitute for the service secret.
  const res = await fetch(`${baseUrl}/internal/clients/${clientId}/active-memberships`, {
    headers: { authorization: 'Bearer anything', 'x-user-id': clientId, 'x-user-role': 'ADMIN' },
  });
  assert.equal(res.status, 401);
});

test('check-in agrees with the lookup on every state (shared definition)', async () => {
  const b = await brandWithBranches(2);
  const scanned = b.gyms[1]; // bought at branch 0, scanned at branch 1
  const cases: Array<[string, Parameters<typeof membership>[3], boolean, string?]> = [
    ['ACTIVE', {}, true],
    ['ACTIVE, last visit', { totalVisits: 3, usedVisits: 2 }, true],
    ['end date passed', { endDate: new Date(Date.now() - DAY) }, false, 'NOT_ACTIVE'],
    ['visits used up', { totalVisits: 3, usedVisits: 3 }, false, 'VISIT_LIMIT_REACHED'],
    ['EXPIRED status', { status: 'EXPIRED' }, false, 'NOT_ACTIVE'],
    ['CANCELLED', { status: 'CANCELLED' }, false, 'NO_MEMBERSHIP'],
    ['PENDING_PAYMENT', { status: 'PENDING_PAYMENT' }, false, 'NO_MEMBERSHIP'],
  ];
  for (const [label, o, allowed, code] of cases) {
    const clientId = randomUUID();
    const m = await membership(b.gyms[0], b.planId, clientId, o);
    const looked = (await lookup(clientId, `?gymId=${scanned}`)).body.data.hasActiveMembership;
    const { token } = signRef(scanned);
    let outcome: 'ok' | string = 'ok';
    try {
      await checkinRef.checkInByGymToken(clientId, token);
    } catch (e: any) {
      outcome = e.message;
    }
    assert.equal(looked, allowed, `${label}: lookup`);
    assert.equal(outcome === 'ok', allowed, `${label}: check-in outcome ${outcome}`);
    if (code) assert.equal(outcome, code, `${label}: check-in error code (behaviour unchanged)`);
    const row = await prismaRef.gymMembershipContract.findUniqueOrThrow({ where: { id: m.id } });
    // (A past-end-date row stays ACTIVE in the DB after a rejected check-in: the lazy-expire write is rolled
    // back by the NOT_ACTIVE throw. Pre-existing behaviour, deliberately unchanged here.)
    if (label === 'end date passed') assert.equal(row.status, 'ACTIVE');
    if (label === 'ACTIVE, last visit') assert.equal(row.status, 'EXPIRED', 'check-in still expires a membership on its last visit');
  }
});
