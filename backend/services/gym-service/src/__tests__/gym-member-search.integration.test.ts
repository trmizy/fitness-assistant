/**
 * BACKEND INTEGRATION (DB `*_test`, real /owner router, fake auth-service):
 * GET /owner/gyms/:gymId/memberships?q= - search members by display name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

process.env.INTERNAL_SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.CHECKIN_TOKEN_SECRET = process.env.CHECKIN_TOKEN_SECRET || 'test_checkin_secret_32_chars_minimum_xx';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const id = { owner: randomUUID(), manager: randomUUID(), recep: randomUUID(), acct: randomUUID(), ownerB: randomUUID() };
const TOKENS: Record<string, string> = { owner: id.owner, manager: id.manager, recep: id.recep, acct: id.acct, ownerB: id.ownerB };
const gym = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
const brand = { a: randomUUID(), b: randomUUID() };
const plan = randomUUID();
const client = { nguyen: randomUUID(), tran: randomUUID(), other: randomUUID() };
const NAMES: Record<string, string> = { [client.nguyen]: 'nguyen', [client.tran]: 'tran', [client.other]: 'nguyen' };
const partnerIds: string[] = [];

let authMode: 'ok' | 'down' = 'ok';
const searchBatches: string[][] = [];
let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let resetLimiter: () => void;

test.before(async () => {
  if (!process.env.DATABASE_URL) return;
  authServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (req.url === '/auth/verify') {
        const uid = TOKENS[String(req.headers.authorization || '').replace('Bearer ', '')];
        if (!uid) { res.statusCode = 401; return res.end('{}'); }
        return res.end(JSON.stringify({ user: { id: uid, role: 'GYM_OWNER', email: `${uid}@search.test` } }));
      }
      if (req.url === '/auth/internal/users/search-by-name') {
        if (authMode === 'down') { res.statusCode = 500; return res.end('{}'); }
        searchBatches.push(body.userIds);
        const needle = String(body.q).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
        return res.end(JSON.stringify({ matchedIds: body.userIds.filter((u: string) => NAMES[u]?.includes(needle)) }));
      }
      if (req.url === '/auth/internal/users/batch') {
        return res.end(JSON.stringify({ users: body.userIds.map((u: string) => ({ id: u, email: 'x@y.test', firstName: NAMES[u] ?? 'x', lastName: null })) }));
      }
      return res.end('{}');
    });
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;
  prisma = (await import('../repositories/prisma')).prisma;
  resetLimiter = (await import('../services/membership.service')).__resetMemberSearchLimiter;

  const mkPartner = async () => {
    const p = await prisma.gymPartner.create({ data: { legalName: `Search ${randomUUID().slice(0, 8)}`, contactEmail: `${randomUUID().slice(0, 8)}@search.test`, status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
    partnerIds.push(p.id);
    return p.id;
  };
  const mkAcc = (partnerId: string, userId: string, role: any, scopedGymIds: string[]) =>
    prisma.gymPartnerAccount.create({ data: { partnerId, userId, role, scopedGymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
  await prisma.gymBrand.createMany({ data: [{ id: brand.a, ownerId: id.owner, name: 'Search A' }, { id: brand.b, ownerId: id.ownerB, name: 'Search B' }] });
  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: id.owner, brandId: brand.a, name: 'A1', address: '1', status: 'APPROVED' },
      { id: gym.a2, ownerId: id.owner, brandId: brand.a, name: 'A2', address: '2', status: 'APPROVED' },
      { id: gym.b1, ownerId: id.ownerB, brandId: brand.b, name: 'B1', address: '3', status: 'APPROVED' },
    ],
  });
  const pA = await mkPartner();
  await mkAcc(pA, id.owner, 'OWNER', []);
  await mkAcc(pA, id.manager, 'MANAGER', [gym.a1]);
  await mkAcc(pA, id.recep, 'RECEPTIONIST', [gym.a1]);
  await mkAcc(pA, id.acct, 'ACCOUNTANT', []);
  await mkAcc(await mkPartner(), id.ownerB, 'OWNER', []);
  await prisma.gymMembershipPlan.create({ data: { id: plan, brandId: brand.a, name: 'Tháng', price: 700000, durationDays: 30, status: 'ACTIVE' } });
  const mk = (gymId: string, clientId: string, status: string) =>
    prisma.gymMembershipContract.create({ data: { gymId, planId: plan, clientId, priceAtPurchase: 700000, durationDaysSnapshot: 30, status, endDate: new Date(Date.now() + 864e6) } as any });
  await mk(gym.a1, client.nguyen, 'ACTIVE');
  await mk(gym.a1, client.tran, 'ACTIVE');
  await mk(gym.a2, client.other, 'ACTIVE');

  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/owner', ownerRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  const gymIds = Object.values(gym);
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { id: plan } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: Object.values(brand) } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
});

async function search(token: string, gymId: string, q: string, extra = '') {
  const res = await fetch(`${base}/owner/gyms/${gymId}/memberships?q=${encodeURIComponent(q)}${extra}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as any };
}

integrationTest('owner and manager find members by name, accent-insensitive, only inside the branch', async () => {
  resetLimiter();
  for (const token of ['owner', 'manager']) {
    const r = await search(token, gym.a1, 'Nguyễn');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.map((m: any) => m.clientId), [client.nguyen]);
  }
  assert.ok(searchBatches.every((b) => !b.includes(client.other)), 'a client of another branch is never sent for matching');
});

integrationTest('no match returns an empty page, never the full list', async () => {
  resetLimiter();
  const r = await search('owner', gym.a1, 'khong-co-ai');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, []);
});

integrationTest('accountant gets 403 MEMBER_SEARCH_FORBIDDEN; receptionist and out-of-scope callers are refused', async () => {
  resetLimiter();
  const acct = await search('acct', gym.a1, 'nguyen');
  assert.equal(acct.status, 403);
  assert.equal(acct.body.error.code, 'MEMBER_SEARCH_FORBIDDEN');
  assert.equal(acct.body.data, undefined);
  assert.equal((await search('recep', gym.a1, 'nguyen')).status, 403);
  const scoped = await search('manager', gym.a2, 'nguyen');
  assert.equal(scoped.status, 403);
  assert.equal(scoped.body.error.code, 'GYM_OUT_OF_SCOPE');
  assert.equal((await search('ownerB', gym.a1, 'nguyen')).status, 403);
});

integrationTest('invalid q is 400 INVALID_QUERY, including empty and blank', async () => {
  resetLimiter();
  for (const q of ['', '   ', 'a', 'x'.repeat(65), '́́']) {
    const r = await search('owner', gym.a1, q);
    assert.equal(r.status, 400, `q=${JSON.stringify(q)}`);
    assert.equal(r.body.error.code, 'INVALID_QUERY');
    assert.equal(r.body.data, undefined);
  }
  const repeated = await fetch(`${base}/owner/gyms/${gym.a1}/memberships?q=ab&q=cd`, { headers: { authorization: 'Bearer owner' } });
  assert.equal(repeated.status, 400);
});

integrationTest('name service failure is 503, never an unfiltered or empty success', async () => {
  resetLimiter();
  authMode = 'down';
  try {
    const r = await search('owner', gym.a1, 'nguyen');
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'MEMBER_SEARCH_UNAVAILABLE');
    assert.equal(r.body.data, undefined);
  } finally {
    authMode = 'ok';
  }
});

integrationTest('the 31st search in a minute is 429; the list without q is not limited', async () => {
  resetLimiter();
  for (let i = 0; i < 30; i += 1) assert.equal((await search('owner', gym.a1, 'nguyen')).status, 200);
  const limited = await search('owner', gym.a1, 'nguyen');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'SEARCH_RATE_LIMITED');
  const plain = await fetch(`${base}/owner/gyms/${gym.a1}/memberships`, { headers: { authorization: 'Bearer owner' } });
  assert.equal(plain.status, 200);
  assert.equal(((await plain.json()) as any).data.length, 2);
  resetLimiter();
});
