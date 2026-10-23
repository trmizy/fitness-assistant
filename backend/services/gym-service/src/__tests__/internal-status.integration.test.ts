/**
 * FH-4 - read-only internal status routes for payment-service's reconciliation report:
 *   GET  /internal/gym-memberships/by-transaction/:txnId
 *   POST /internal/gym-memberships/status   { ids?, txnIds? } (<= 100)
 *
 * Evidence label: BACKEND INTEGRATION + REAL HTTP/API (real Express app on an ephemeral port, real Prisma on an isolated
 * `*_test` database; the suite SKIPS unless DATABASE_URL names a database ending in `_test`).
 * Run (from backend/services/gym-service):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_g3_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/internal-status.integration.test.ts
 */
import { guardedTest as test, skip } from './test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const SECRET = 'fh4-status-test-secret';
process.env.INTERNAL_SERVICE_SECRET = SECRET;
const DAY = 24 * 60 * 60 * 1000;

let server: http.Server;
let baseUrl = '';
let prismaRef: typeof import('../repositories/prisma').prisma;
const created = { memberships: [] as string[], plans: [] as string[], gyms: [] as string[], brands: [] as string[] };
let gymId = '';
let planId = '';

test.before(async () => {
  const { default: app } = await import('../app');
  prismaRef = (await import('../repositories/prisma')).prisma;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  if (skip) return;
  const brand = await prismaRef.gymBrand.create({ data: { id: randomUUID(), ownerId: randomUUID(), name: 'FH4 Brand' } });
  created.brands.push(brand.id);
  const g = await prismaRef.gym.create({
    data: { id: randomUUID(), ownerId: brand.ownerId, brandId: brand.id, name: 'FH4 Gym', address: '1 Test St', status: 'APPROVED' },
  });
  created.gyms.push(g.id);
  gymId = g.id;
  const plan = await prismaRef.gymMembershipPlan.create({ data: { id: randomUUID(), brandId: brand.id, name: 'FH4 Plan', price: 500_000, durationDays: 30 } });
  created.plans.push(plan.id);
  planId = plan.id;
});

test.after(async () => {
  if (!skip) {
    await prismaRef.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
    await prismaRef.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
    await prismaRef.gym.deleteMany({ where: { id: { in: created.gyms } } });
    await prismaRef.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
    await prismaRef.$disconnect();
  }
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

async function mk(status: any, txn: string | null, endDate: Date | null = new Date(Date.now() + 15 * DAY)) {
  const m = await prismaRef.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId, planId, clientId: 'client-secret-' + randomUUID(), status, paymentTxnId: txn,
      priceAtPurchase: 500_000, durationDaysSnapshot: 30, startDate: new Date(Date.now() - DAY), endDate,
    },
  });
  created.memberships.push(m.id);
  return m;
}

async function call(method: 'GET' | 'POST', path: string, opts: { secret?: string | null; body?: unknown } = {}) {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(secret === null ? {} : { 'x-service-secret': secret }), 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

test('the secret is required on both routes: 401 without it and with a wrong one', async () => {
  assert.equal((await call('GET', '/internal/gym-memberships/by-transaction/x', { secret: null })).status, 401);
  assert.equal((await call('GET', '/internal/gym-memberships/by-transaction/x', { secret: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/internal/gym-memberships/status', { secret: null, body: { ids: ['x'] } })).status, 401);
  assert.equal((await call('POST', '/internal/gym-memberships/status', { secret: 'wrong', body: { ids: ['x'] } })).status, 401);
});

test('by-transaction returns only the status facts; unknown transaction is 404', async () => {
  const txn = 'txn-' + randomUUID();
  const m = await mk('ACTIVE', txn);
  const r = await call('GET', `/internal/gym-memberships/by-transaction/${txn}`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.data).sort(), ['id', 'paymentTxnId', 'status', 'validUntil']);
  assert.equal(r.body.data.id, m.id);
  assert.equal(r.body.data.status, 'ACTIVE');
  assert.equal(r.body.data.paymentTxnId, txn);
  assert.equal(r.body.data.validUntil, m.endDate!.toISOString());
  assert.ok(!JSON.stringify(r.body).includes('client-secret'), 'no client id leaks');
  assert.equal((await call('GET', `/internal/gym-memberships/by-transaction/nope-${randomUUID()}`)).status, 404);
});

test('batch by ids and by txnIds, mixed statuses incl. CANCELLED and a null end date', async () => {
  const t1 = 'txn-' + randomUUID();
  const t2 = 'txn-' + randomUUID();
  const a = await mk('ACTIVE', t1);
  const c = await mk('CANCELLED', t2, null);
  const byIds = await call('POST', '/internal/gym-memberships/status', { body: { ids: [a.id, c.id, randomUUID()] } });
  assert.equal(byIds.status, 200);
  const rows = byIds.body.data as any[];
  assert.equal(rows.length, 2, 'unknown ids are simply absent');
  assert.equal(rows.find((x) => x.id === a.id).status, 'ACTIVE');
  const cx = rows.find((x) => x.id === c.id);
  assert.equal(cx.status, 'CANCELLED');
  assert.equal(cx.validUntil, null);
  const byTxn = await call('POST', '/internal/gym-memberships/status', { body: { txnIds: [t1, t2] } });
  assert.deepEqual((byTxn.body.data as any[]).map((x) => x.paymentTxnId).sort(), [t1, t2].sort());
});

test('bad input is 400: empty, missing, non-array, over 100', async () => {
  const bodies = [{}, { ids: [] }, { ids: 'a' }, { ids: [1] }, { txnIds: Array.from({ length: 101 }, (_, i) => `t${i}`) }, { ids: Array.from({ length: 101 }, (_, i) => `i${i}`) }];
  for (const body of bodies) {
    assert.equal((await call('POST', '/internal/gym-memberships/status', { body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  const ok = await call('POST', '/internal/gym-memberships/status', { body: { ids: Array.from({ length: 100 }, (_, i) => `i${i}`) } });
  assert.equal(ok.status, 200);
});

test('read-only: the routes change no row', async () => {
  const t = 'txn-' + randomUUID();
  const m = await mk('ACTIVE', t);
  const before = await prismaRef.gymMembershipContract.findUnique({ where: { id: m.id } });
  await call('GET', `/internal/gym-memberships/by-transaction/${t}`);
  await call('POST', '/internal/gym-memberships/status', { body: { ids: [m.id] } });
  const after = await prismaRef.gymMembershipContract.findUnique({ where: { id: m.id } });
  assert.deepEqual(after, before);
});
