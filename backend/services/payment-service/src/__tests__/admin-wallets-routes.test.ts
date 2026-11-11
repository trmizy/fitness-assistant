/**
 * G-09 / G-10 - route-level contract of GET /admin/payments/wallets and /wallets/:id.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; the read service is replaced,
 *   so nothing here reaches Postgres).
 *
 * Covers: admin-only (401 / 403), query validation (400 INVALID_QUERY), id validation (400 INVALID_ID),
 * 404 WALLET_NOT_FOUND, that the validated query reaches the service with the documented defaults, the 500 contract,
 * the pure `kind` mapping (G-10), and that the router exposes GET only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { adminWalletsService, walletEntryKind } from '../services/admin-wallets.service';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4067';

const GOOD_ID = '11111111-1111-4111-8111-111111111111';
const calls: { list: unknown[]; detail: Array<[string, unknown]> } = { list: [], detail: [] };

adminWalletsService.list = (async (q: unknown) => {
  calls.list.push(q);
  return { total: 0, limit: 25, offset: 0, hasMore: false, items: [] };
}) as typeof adminWalletsService.list;
adminWalletsService.detail = (async (id: string, q: unknown) => {
  calls.detail.push([id, q]);
  return id === GOOD_ID ? ({ wallet: { id }, entries: { total: 0, limit: 50, offset: 0, hasMore: false, items: [] } } as never) : null;
}) as typeof adminWalletsService.detail;

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const a = String(req.headers.authorization || '');
      const role = a === 'Bearer real-admin-token' ? 'ADMIN' : a === 'Bearer real-customer-token' ? 'CUSTOMER' : null;
      if (role) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: `u-${role}`, email: 'x@example.com', role } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4067, '127.0.0.1', r));

  const { default: walletsRoutes } = await import('../routes/admin-wallets.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments/wallets', walletsRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

const get = (path: string, headers: Record<string, string> = ADMIN) => fetch(`${baseUrl}/admin/payments/wallets${path}`, { headers });

test('no token -> 401 on both routes', async () => {
  assert.equal((await get('', {})).status, 401);
  assert.equal((await get(`/${GOOD_ID}`, {})).status, 401);
});

test('non-admin (CUSTOMER) token -> 403 on both routes', async () => {
  const customer = { Authorization: 'Bearer real-customer-token' };
  assert.equal((await get('', customer)).status, 403);
  assert.equal((await get(`/${GOOD_ID}`, customer)).status, 403);
});

test('only GET exists: POST / PUT / PATCH / DELETE are not routed (404)', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['', `/${GOOD_ID}`]) {
      const res = await fetch(`${baseUrl}/admin/payments/wallets${path}`, { method, headers: { ...ADMIN, 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.equal(res.status, 404, `${method} ${path}`);
    }
  }
});

test('list: defaults reach the service (limit 25, offset 0, no filters)', async () => {
  calls.list.length = 0;
  const res = await get('');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 0, limit: 25, offset: 0, hasMore: false, items: [] });
  const q = calls.list[0] as Record<string, unknown>;
  assert.equal(q.limit, 25);
  assert.equal(q.offset, 0);
  assert.equal(q.ownerType, undefined);
  assert.equal(q.ownerId, undefined);
});

test('list: a valid full query is parsed (enum, trimmed ownerId, numbers as numbers); platform owner ids pass through', async () => {
  calls.list.length = 0;
  assert.equal((await get('?ownerType=PLATFORM&ownerId=%20ESCROW%20&limit=100&offset=100000')).status, 200);
  const q = calls.list[0] as Record<string, unknown>;
  assert.equal(q.ownerType, 'PLATFORM');
  assert.equal(q.ownerId, 'ESCROW');
  assert.equal(q.limit, 100);
  assert.equal(q.offset, 100000);
});

const BAD_LIST: Array<[string, string]> = [
  ['limit=0', 'limit below 1'],
  ['limit=101', 'limit above 100'],
  ['limit=abc', 'limit not a number'],
  ['limit=1.5', 'limit not an integer'],
  ['offset=-1', 'negative offset'],
  ['offset=100001', 'offset above 100000'],
  ['ownerType=ADMIN', 'unknown ownerType'],
  ['ownerType=client', 'ownerType is case-sensitive'],
  ['ownerId=', 'empty ownerId'],
  ['ownerId=%20%20', 'blank ownerId'],
  [`ownerId=${'x'.repeat(129)}`, 'ownerId over 128 chars'],
  ['foo=bar', 'unknown key'],
  ['ownerType=PT&ownerType=GYM', 'repeated key (array)'],
];
for (const [qs, why] of BAD_LIST) {
  test(`list: ${why} -> 400 INVALID_QUERY`, async () => {
    calls.list.length = 0;
    const res = await get(`?${qs}`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, 'INVALID_QUERY');
    assert.ok(body.error.length > 0);
    assert.equal(calls.list.length, 0, 'service must not be called for an invalid query');
  });
}

test('detail: a non-uuid id -> 400 INVALID_ID and the service is not called', async () => {
  calls.detail.length = 0;
  for (const bad of ['abc', '123', 'ESCROW', `${GOOD_ID}x`]) {
    const res = await get(`/${bad}`);
    assert.equal(res.status, 400, bad);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_ID');
  }
  assert.equal(calls.detail.length, 0);
});

test('detail: defaults reach the service (entriesLimit 50, entriesOffset 0)', async () => {
  calls.detail.length = 0;
  const res = await get(`/${GOOD_ID}`);
  assert.equal(res.status, 200);
  const [id, q] = calls.detail[0] as [string, Record<string, unknown>];
  assert.equal(id, GOOD_ID);
  assert.equal(q.entriesLimit, 50);
  assert.equal(q.entriesOffset, 0);
  assert.equal(q.from, undefined);
  assert.equal(q.to, undefined);
});

test('detail: a valid full query is parsed (dates as Date)', async () => {
  calls.detail.length = 0;
  assert.equal((await get(`/${GOOD_ID}?entriesLimit=200&entriesOffset=100000&from=2026-11-01&to=2026-11-10T00:00:00Z`)).status, 200);
  const q = (calls.detail[0] as [string, Record<string, unknown>])[1];
  assert.equal(q.entriesLimit, 200);
  assert.equal(q.entriesOffset, 100000);
  assert.ok(q.from instanceof Date && q.to instanceof Date);
});

const BAD_DETAIL: Array<[string, string]> = [
  ['entriesLimit=0', 'entriesLimit below 1'],
  ['entriesLimit=201', 'entriesLimit above 200'],
  ['entriesLimit=x', 'entriesLimit not a number'],
  ['entriesOffset=-1', 'negative entriesOffset'],
  ['entriesOffset=100001', 'entriesOffset above 100000'],
  ['from=not-a-date', 'bad from'],
  ['to=2026-13-45', 'bad to'],
  ['from=2026-11-10&to=2026-11-01', 'from after to'],
  ['limit=10', 'the list-only key "limit" is unknown here'],
  ['foo=bar', 'unknown key'],
];
for (const [qs, why] of BAD_DETAIL) {
  test(`detail: ${why} -> 400 INVALID_QUERY`, async () => {
    calls.detail.length = 0;
    const res = await get(`/${GOOD_ID}?${qs}`);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_QUERY');
    assert.equal(calls.detail.length, 0);
  });
}

test('detail: unknown uuid -> 404 WALLET_NOT_FOUND; known uuid -> 200', async () => {
  const miss = await get('/22222222-2222-4222-8222-222222222222');
  assert.equal(miss.status, 404);
  const body = (await miss.json()) as { error: string; code: string };
  assert.equal(body.code, 'WALLET_NOT_FOUND');
  assert.ok(body.error.length > 0);

  const hit = await get(`/${GOOD_ID}`);
  assert.equal(hit.status, 200);
  assert.equal(((await hit.json()) as { wallet: { id: string } }).wallet.id, GOOD_ID);
});

test('a service failure -> 500 with a Vietnamese error and a stable code (no stack/message leak)', async () => {
  const originalList = adminWalletsService.list;
  const originalDetail = adminWalletsService.detail;
  const boom = (async () => {
    throw new Error('secret internal detail');
  }) as never;
  adminWalletsService.list = boom;
  adminWalletsService.detail = boom;
  try {
    const list = await get('');
    assert.equal(list.status, 500);
    const t1 = await list.text();
    assert.ok(!t1.includes('secret internal detail'));
    assert.equal((JSON.parse(t1) as { code: string }).code, 'WALLETS_LIST_FAILED');

    const det = await get(`/${GOOD_ID}`);
    assert.equal(det.status, 500);
    const t2 = await det.text();
    assert.ok(!t2.includes('secret internal detail'));
    assert.equal((JSON.parse(t2) as { code: string }).code, 'WALLET_DETAIL_FAILED');
  } finally {
    adminWalletsService.list = originalList;
    adminWalletsService.detail = originalDetail;
  }
});

test('G-10 kind mapping: purpose -> stable code; refundOfTransactionId wins; unknown / missing -> OTHER', () => {
  const none = null;
  const cases: Array<[string, string | null, string]> = [
    ['GYM_MEMBERSHIP', none, 'GYM_MEMBERSHIP'],
    ['PT_CONTRACT', none, 'PT_CONTRACT'],
    ['GYM_PT_COMBO', none, 'GYM_PT_COMBO'],
    ['WALLET_TOPUP', none, 'WALLET_TOPUP'],
    ['REFUND', none, 'REFUND'],
    ['TRAINING_PACKAGE_PURCHASE', none, 'TRAINING_PACKAGE_PURCHASE'],
    ['PERSONALIZED_SERVICE_PURCHASE', none, 'PERSONALIZED_SERVICE_PURCHASE'],
    ['WITHDRAWAL', none, 'WITHDRAWAL'],
    ['PT_CONTRACT', 'orig-1', 'REFUND'],
    ['WALLET_TOPUP', 'orig-1', 'REFUND'],
    ['SOMETHING_NEW', none, 'OTHER'],
    ['toString', none, 'OTHER'],
  ];
  for (const [purpose, refundOf, expected] of cases) {
    assert.equal(walletEntryKind({ purpose, refundOfTransactionId: refundOf }), expected, `${purpose}/${refundOf}`);
  }
  assert.equal(walletEntryKind(null), 'OTHER');
  assert.equal(walletEntryKind(undefined), 'OTHER');
});
