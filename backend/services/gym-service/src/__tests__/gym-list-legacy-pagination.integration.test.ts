/**
 * Legacy `GET /gyms` pagination (AWS DEV bug: ~2.4k approved branches in one unpaginated response exceeded the Lambda
 * 6 MB response limit -> HTTP 413 -> 500 on every call).
 *
 *   - parseLegacyListPage: pure unit checks (TEST FIXTURE-free): default 50, hard max 100, bad values clamped, never 4xx.
 *   - REAL HTTP/API on the real Express app + the isolated test database (BACKEND INTEGRATION label for the service
 *     assertions): 105 approved branches seeded with createdAt in the FUTURE so they are the newest rows of the DB whatever
 *     else the test DB holds; default cap, max cap, offset paging, ordering, response shape, and the ratings / cheapest-plan
 *     aggregates only being computed for the returned page (DB-level take/skip, not an in-memory slice).
 * Auth-service is a TEST FIXTURE (401 for everything; the route is public).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { guardedTest, skip } from './test-db-guard';
import { cleanupRegistry, makeOwner, newRegistry, seed } from './listing-b1.test-helpers';
import {
  LEGACY_LIST_DEFAULT_LIMIT,
  LEGACY_LIST_MAX_LIMIT,
  parseLegacyListPage,
} from '../services/gym.service';

// ── pure unit: query parsing ───────────────────────────────────────────────────────────────

test('parseLegacyListPage: defaults, hard max and clamping of invalid input (never rejects)', () => {
  assert.equal(LEGACY_LIST_DEFAULT_LIMIT, 50);
  assert.equal(LEGACY_LIST_MAX_LIMIT, 100);
  assert.deepEqual(parseLegacyListPage({}), { limit: 50, offset: 0 });
  assert.deepEqual(parseLegacyListPage({ limit: '10', offset: '20' }), { limit: 10, offset: 20 });
  assert.deepEqual(parseLegacyListPage({ limit: '100' }), { limit: 100, offset: 0 });
  assert.deepEqual(parseLegacyListPage({ limit: '101' }), { limit: 100, offset: 0 });
  assert.deepEqual(parseLegacyListPage({ limit: '99999999' }), { limit: 100, offset: 0 });
  // invalid / non-positive limit -> default; invalid / negative offset -> 0
  for (const bad of ['0', '-5', 'abc', '', '1.5', '1e3', ' ', '99999999999']) {
    assert.equal(parseLegacyListPage({ limit: bad }).limit, 50, `limit=${JSON.stringify(bad)}`);
  }
  for (const bad of ['-1', 'abc', '', '2.5', '99999999999']) {
    assert.equal(parseLegacyListPage({ offset: bad }).offset, 0, `offset=${JSON.stringify(bad)}`);
  }
  // repeated / object query params (?limit=1&limit=2, ?limit[a]=1)
  assert.deepEqual(parseLegacyListPage({ limit: ['7', '9'], offset: ['3'] }), { limit: 7, offset: 3 });
  assert.deepEqual(parseLegacyListPage({ limit: { a: '1' }, offset: { a: '1' } }), { limit: 50, offset: 0 });
});

// ── REAL HTTP/API on the isolated test DB ──────────────────────────────────────────────────

const TOTAL = 105;
const reg = newRegistry();
let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let seededIdsNewestFirst: string[] = [];

async function list(qs = '') {
  const res = await fetch(`${base}/gyms${qs}`);
  const json: any = await res.json();
  return { status: res.status, json, data: json.data as any[] };
}

guardedTest.before(async () => {
  if (skip) return;
  process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4062';
  authServer = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => authServer.listen(4062, '127.0.0.1', r));
  prisma = (await import('../repositories/prisma')).prisma;
  const app = (await import('../app')).default;
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;

  const owner = await makeOwner(reg);
  // createdAt in the future, 1 s apart: index 0 is the newest; they outrank every other row the test DB may hold.
  const start = Date.now() + 24 * 3600 * 1000;
  const rows = Array.from({ length: TOTAL }, (_, i) => ({ id: randomUUID(), createdAt: new Date(start + (TOTAL - i) * 1000) }));
  seededIdsNewestFirst = rows.map((r) => r.id);
  await seed(async (tx) => {
    await tx.gym.createMany({
      data: rows.map((r, i) => ({
        id: r.id,
        ownerId: owner.ownerId,
        brandId: owner.brandId,
        name: `Legacy page ${i}`,
        approvedName: `Legacy page ${i}`,
        address: 'Addr 1',
        approvedAddress: 'Addr 1',
        status: 'APPROVED' as const,
        operationalStatus: 'OPEN' as const,
        listingVersion: 1,
        createdAt: r.createdAt,
      })),
    });
  });
  reg.gyms.push(...seededIdsNewestFirst);
});

guardedTest.after(async () => {
  if (skip) return;
  await cleanupRegistry(reg);
  await prisma.$disconnect();
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

guardedTest('no params: 200, { success, data: array }, default cap 50, newest first, legacy DTO shape kept', async () => {
  const r = await list();
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(Array.isArray(r.data));
  assert.equal(r.data.length, 50);
  assert.deepEqual(r.data.map((g) => g.id), seededIdsNewestFirst.slice(0, 50));
  const g = r.data[0];
  for (const k of ['id', 'brandId', 'name', 'address', 'status', 'createdAt', 'amenities', 'coverPhotoUrl', 'brand', 'averageRating', 'reviewCount', 'fromPrice']) {
    assert.ok(k in g, `field ${k} present`);
  }
  assert.equal(g.averageRating, 0);
  assert.equal(g.reviewCount, 0);
  assert.equal(g.fromPrice, null);
  assert.equal('distanceKm' in g, false);
});

guardedTest('hard max: limit above 100 is clamped to 100; limit=100 returns exactly 100', async () => {
  const big = await list('?limit=100000');
  assert.equal(big.status, 200);
  assert.equal(big.data.length, 100);
  assert.deepEqual(big.data.map((g) => g.id), seededIdsNewestFirst.slice(0, 100));
  const exact = await list('?limit=100');
  assert.equal(exact.data.length, 100);
});

guardedTest('invalid / negative params are clamped, not rejected (old clients never see a 4xx)', async () => {
  for (const qs of ['?limit=0', '?limit=-3', '?limit=abc', '?limit=', '?limit=1.5']) {
    const r = await list(qs);
    assert.equal(r.status, 200, qs);
    assert.equal(r.data.length, 50, qs);
  }
  const neg = await list('?offset=-10&limit=3');
  assert.equal(neg.status, 200);
  assert.deepEqual(neg.data.map((g) => g.id), seededIdsNewestFirst.slice(0, 3));
});

guardedTest('offset paging: pages are disjoint, contiguous, equal to one big page, and ordered createdAt desc', async () => {
  const p1 = await list('?limit=10&offset=0');
  const p2 = await list('?limit=10&offset=10');
  const p3 = await list('?limit=10&offset=20');
  const ids = [...p1.data, ...p2.data, ...p3.data].map((g) => g.id);
  assert.equal(new Set(ids).size, 30, 'no repeated row across pages');
  assert.deepEqual(ids, seededIdsNewestFirst.slice(0, 30));
  assert.deepEqual(ids, (await list('?limit=30')).data.map((g) => g.id));
  const times = [...p1.data, ...p2.data, ...p3.data].map((g) => new Date(g.createdAt).getTime());
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], 'createdAt desc');

  // the tail of the seeded block: the 5 oldest seeded rows are at offset 100..104
  const tail = await list('?limit=5&offset=100');
  assert.deepEqual(tail.data.map((g) => g.id), seededIdsNewestFirst.slice(100, 105));

  // far past the end -> still the legacy shape, empty array
  const past = await list('?offset=100000000');
  assert.equal(past.status, 200);
  assert.deepEqual(past.json, { success: true, data: [] });
});

guardedTest('the page is cut in the DB: rating + cheapest-plan aggregates only run for the returned page', async () => {
  const { reviewRepository } = await import('../repositories/review.repository');
  const { planRepository } = await import('../repositories/plan.repository');
  const origRatings = reviewRepository.aggregateForGyms;
  const origCheapest = planRepository.findCheapestActiveByBrands;
  const seen = { ratingIds: [] as string[][], brandIds: [] as string[][] };
  reviewRepository.aggregateForGyms = ((ids: string[]) => {
    seen.ratingIds.push(ids);
    return origRatings.call(reviewRepository, ids);
  }) as typeof origRatings;
  planRepository.findCheapestActiveByBrands = ((ids: string[]) => {
    seen.brandIds.push(ids);
    return origCheapest.call(planRepository, ids);
  }) as typeof origCheapest;
  try {
    await list('?limit=7&offset=2');
    await list();
    await list('?limit=5000');
  } finally {
    reviewRepository.aggregateForGyms = origRatings;
    planRepository.findCheapestActiveByBrands = origCheapest;
  }
  assert.deepEqual(seen.ratingIds.map((a) => a.length), [7, 50, 100]);
  assert.deepEqual(seen.ratingIds[0], seededIdsNewestFirst.slice(2, 9));
  assert.ok(seen.brandIds.every((a) => a.length <= 1), 'all seeded branches share one brand');
});
