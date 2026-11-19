import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { buildReconciliationReport, recordJobRunIfChanged } from '../services/reconcile.service';
import { PLATFORM_ESCROW_ID } from '../services/wallet.service';

/**
 * G-06 - against the REAL service and the isolated *_test database. The admin identity check goes to a TEST FIXTURE auth-service
 * on 127.0.0.1:4060.
 *   - GET /admin/payments/reconciliation keeps its OLD contract (200 balanced / 409 drift, { success, data }) and WRITES NOTHING;
 *   - POST /admin/payments/reconciliation/runs records exactly one ADMIN run (201 { run }), throttled per admin (429);
 *   - the job records a run only when the status/drift changed or the latest JOB run is older than 60 min;
 *   - GET /admin/payments/reconciliation/runs lists them (order, paging, filter, no PII).
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real Prisma + isolated *_test DB; auth-service = TEST FIXTURE).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test --test-concurrency=1 src/__tests__/admin-reconciliation-runs.integration.test.ts
 *
 * Marker: every wallet owner id / admin id / run seeded here starts with `W8-`; cleanup removes only those rows (and the runs this file
 * recorded, found by the `W8-` admin ids or by the ids collected). The balanced fixture moves the shared ESCROW wallet by +X and a W8 wallet
 * by +X in ONE transaction (net zero) and reverses both afterwards.
 */

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4060';
const D = (n: number | string) => new Prisma.Decimal(n);

const RUN = randomUUID();
/** Bearer `admin-<name>` -> a distinct admin id `W8-admin-<name>-<RUN>` (the POST throttle is per admin). */
const adminId = (name: string) => `W8-admin-${name}-${RUN}`;
const as = (name: string) => ({ Authorization: `Bearer admin-${name}` });
const ADMIN = as('main');
const trackedRunIds: string[] = [];
const walletIds: string[] = [];

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';

async function call(method: 'GET' | 'POST', path: string, headers: Record<string, string> = ADMIN) {
  const res = await fetch(`${baseUrl}/admin/payments${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}
const getJson = (path: string, headers?: Record<string, string>) => call('GET', path, headers);
const postJson = (path: string, headers?: Record<string, string>) => call('POST', path, headers);
const w8RunCount = () => prisma.reconciliationRun.count({ where: { triggeredBy: { startsWith: 'W8-' } } });

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const m = /^Bearer admin-(.+)$/.exec(String(req.headers.authorization || ''));
      if (m) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: adminId(m[1]), email: 'w8@example.com', role: 'ADMIN' } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4060, '127.0.0.1', r));

  const { default: adminRoutes } = await import('../routes/admin.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments', adminRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  try {
    await prisma.reconciliationRun.deleteMany({ where: { OR: [{ id: { in: trackedRunIds } }, { triggeredBy: { startsWith: 'W8-' } }, { id: { startsWith: 'W8-' } }] } });
    await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  } finally {
    await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
    await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
    await prisma.$disconnect();
  }
});

test('GET /reconciliation, balanced: 200 { success: true, data: report } and it WRITES NOTHING', async () => {
  const baseline = await buildReconciliationReport();
  const amount = D('250.00');
  const walletId = randomUUID();
  walletIds.push(walletId);
  // Net-zero fixture: a W8 client claim of X and X more cash in ESCROW, in one transaction.
  await prisma.$transaction([
    prisma.wallet.create({ data: { id: walletId, ownerType: 'CLIENT', ownerId: `W8-client-${randomUUID()}`, availableBalance: amount } }),
    prisma.wallet.updateMany({ where: { ownerType: 'PLATFORM', ownerId: PLATFORM_ESCROW_ID }, data: { availableBalance: { increment: amount } } }),
  ]);
  try {
    const rowsBefore = await prisma.reconciliationRun.count();
    const w8Before = await w8RunCount();
    const { status, body } = await getJson('/reconciliation');
    assert.equal(body.success, body.data.balanced, 'success mirrors balanced');
    assert.equal(status, body.data.balanced ? 200 : 409);
    assert.equal(body.data.drift, D(body.data.escrow).minus(D(body.data.claims)).toFixed(2));
    assert.equal(body.data.drift, baseline.drift, 'the fixture is net zero');
    if (baseline.balanced) {
      assert.equal(status, 200);
      assert.equal(body.success, true);
    }
    assert.ok(body.data.breakdown && Array.isArray(body.data.negativeWallets));
    assert.equal('status' in body.data || 'runId' in body.data, false, 'the old report shape: no status/runId fields');
    assert.equal(await w8RunCount(), w8Before, 'GET wrote no W8 run');
    assert.equal(await prisma.reconciliationRun.count(), rowsBefore, 'GET wrote no run at all (row count unchanged)');
  } finally {
    await prisma.$transaction([
      prisma.wallet.updateMany({ where: { ownerType: 'PLATFORM', ownerId: PLATFORM_ESCROW_ID }, data: { availableBalance: { decrement: amount } } }),
      prisma.wallet.deleteMany({ where: { id: walletId } }),
    ]);
  }
});

test('GET /reconciliation, drift: 409 { success: false, data: report } with the exact drift, and it WRITES NOTHING', async () => {
  const bigId = randomUUID();
  const negId = randomUUID();
  const negOwner = `W8-neg-owner-${randomUUID()}`;
  walletIds.push(bigId, negId);
  await prisma.wallet.createMany({
    data: [
      { id: bigId, ownerType: 'CLIENT', ownerId: `W8-client-${randomUUID()}`, availableBalance: D('900000000.00') },
      { id: negId, ownerType: 'CLIENT', ownerId: negOwner, availableBalance: D('-5.00') },
    ],
  });
  try {
    const w8Before = await w8RunCount();
    const { status, body } = await getJson('/reconciliation');
    assert.equal(status, 409);
    assert.equal(body.success, false);
    assert.equal(body.data.balanced, false);
    assert.equal(body.data.drift, D(body.data.escrow).minus(D(body.data.claims)).toFixed(2));
    assert.ok(body.data.negativeWallets.some((w: { ownerId: string }) => w.ownerId === negOwner));
    assert.equal(await w8RunCount(), w8Before, 'GET wrote no run');
  } finally {
    await prisma.wallet.deleteMany({ where: { id: { in: [bigId, negId] } } });
  }
});

test('POST /reconciliation/runs: 201 { run }, ONE ADMIN run stored with the token user and the live figures; summary has no ids', async () => {
  const negId = randomUUID();
  const negOwner = `W8-neg-owner-${randomUUID()}`;
  walletIds.push(negId);
  await prisma.wallet.create({ data: { id: negId, ownerType: 'CLIENT', ownerId: negOwner, availableBalance: D('-5.00') } });
  try {
    const before = await prisma.reconciliationRun.count({ where: { triggeredBy: adminId('main') } });
    const { status, body } = await postJson('/reconciliation/runs');
    assert.equal(status, 201);
    const run = body.run;
    assert.deepEqual(Object.keys(run).sort(), ['claimsTotal', 'drift', 'errorCode', 'escrowBalance', 'finishedAt', 'id', 'startedAt', 'status', 'summary', 'trigger', 'triggeredBy']);
    assert.equal(run.trigger, 'ADMIN');
    assert.equal(run.triggeredBy, adminId('main'), 'the verified token user');
    assert.ok(run.status === 'BALANCED' || run.status === 'DRIFT');
    assert.equal(run.drift, D(run.escrowBalance).minus(D(run.claimsTotal)).toFixed(2));
    assert.equal(await prisma.reconciliationRun.count({ where: { triggeredBy: adminId('main') } }), before + 1, 'exactly one run recorded');
    const row = await prisma.reconciliationRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(row.drift?.toFixed(2), run.drift);
    assert.equal(row.errorCode, null);
    const summaryText = JSON.stringify(row.summary);
    assert.ok(!summaryText.includes(negOwner) && !summaryText.includes(negId), 'summary must not carry owner or wallet ids');
    assert.deepEqual(Object.keys(row.summary as object).sort(), ['breakdown', 'negativeWalletCount']);
    assert.ok((row.summary as { negativeWalletCount: number }).negativeWalletCount >= 1);
  } finally {
    await prisma.wallet.deleteMany({ where: { id: negId } });
  }
});

test('POST /reconciliation/runs throttle: the same admin again within 30 s -> 429 RECONCILIATION_RUN_TOO_SOON and nothing is run; another admin is not blocked', async () => {
  const before = await prisma.reconciliationRun.count({ where: { triggeredBy: adminId('main') } });
  const again = await postJson('/reconciliation/runs');
  assert.equal(again.status, 429);
  assert.equal(again.body.code, 'RECONCILIATION_RUN_TOO_SOON');
  assert.ok(again.body.error.length > 0);
  assert.equal(await prisma.reconciliationRun.count({ where: { triggeredBy: adminId('main') } }), before, 'no run recorded by the refused call');

  const other = await postJson('/reconciliation/runs', as('second'));
  assert.equal(other.status, 201);
  assert.equal(other.body.run.triggeredBy, adminId('second'));

  // A run older than 30 s no longer blocks: age the first admin's run, then it works again.
  await prisma.reconciliationRun.updateMany({ where: { triggeredBy: adminId('main') }, data: { startedAt: new Date(Date.now() - 31_000) } });
  const later = await postJson('/reconciliation/runs');
  assert.equal(later.status, 201);
});

test('POST /reconciliation/runs refuses a body (400 INVALID_BODY) and records nothing', async () => {
  const before = await w8RunCount();
  const res = await fetch(`${baseUrl}/admin/payments/reconciliation/runs`, { method: 'POST', headers: { ...as('body'), 'Content-Type': 'application/json' }, body: '{"triggeredBy":"x"}' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, 'INVALID_BODY');
  assert.equal(await w8RunCount(), before);
});

test('job dedupe on the database: unchanged -> not recorded; changed drift -> recorded as JOB (no triggeredBy)', async () => {
  const live = await buildReconciliationReport();
  const liveStatus = live.balanced ? 'BALANCED' : 'DRIFT';
  const seed = async (drift: string, status: string, trigger: string, startedAt: Date) => {
    const id = `W8-run-${randomUUID()}`;
    trackedRunIds.push(id);
    await prisma.reconciliationRun.create({
      data: { id, startedAt, finishedAt: startedAt, trigger, triggeredBy: trigger === 'ADMIN' ? 'W8-seed' : null, status, escrowBalance: D('1.00'), claimsTotal: D('1.00'), drift: D(drift), summary: {} },
    });
    return id;
  };
  const future = (n: number) => new Date(Date.UTC(2034, 0, 1, 0, n, 0)); // later than any real run: it is "the latest run of any trigger"

  // 1) latest run (any trigger) has the live status+drift, and the latest JOB run is recent -> nothing recorded.
  await seed(live.drift, liveStatus, 'JOB', new Date(Date.now() - 1000));
  const latestAnySame = await seed(live.drift, liveStatus, 'ADMIN', future(1));
  const jobsBefore = await prisma.reconciliationRun.count({ where: { trigger: 'JOB' } });
  const unchanged = await recordJobRunIfChanged();
  assert.equal(unchanged.recorded, false);
  assert.equal(unchanged.reason, 'UNCHANGED');
  assert.equal(await prisma.reconciliationRun.count({ where: { trigger: 'JOB' } }), jobsBefore, 'no JOB row written');

  // 2) the latest run now has a DIFFERENT drift -> the job records a JOB run.
  await prisma.reconciliationRun.delete({ where: { id: latestAnySame } });
  await seed('123456.78', 'DRIFT', 'ADMIN', future(2));
  const changed = await recordJobRunIfChanged();
  assert.equal(changed.recorded, true);
  assert.equal(changed.reason, 'CHANGED');
  assert.ok(changed.runId);
  trackedRunIds.push(changed.runId!);
  const row = await prisma.reconciliationRun.findUniqueOrThrow({ where: { id: changed.runId! } });
  assert.equal(row.trigger, 'JOB');
  assert.equal(row.triggeredBy, null);
  assert.equal(row.status, row.drift?.isZero() ? 'BALANCED' : 'DRIFT');
  // The 2034 seeds must not sit on top of the 2033 list fixture of the next test.
  await prisma.reconciliationRun.deleteMany({ where: { id: { startsWith: 'W8-run-' }, startedAt: { gte: future(0) } } });
});

test('runs list: newest first, DTO shape, amounts as strings, ERROR row has null amounts, no PII fields', async () => {
  // Seeded in 2033: later than any real run, so they are the first page of an unfiltered list.
  const base = Date.UTC(2033, 0, 10, 12, 0, 0);
  const specs = [
    { n: 1, status: 'BALANCED', trigger: 'JOB', by: null as string | null, amounts: ['100.00', '100.00', '0.00'] },
    { n: 2, status: 'DRIFT', trigger: 'ADMIN', by: 'W8-admin-seed', amounts: ['100.00', '99.50', '0.50'] },
    { n: 3, status: 'ERROR', trigger: 'JOB', by: null, amounts: null as string[] | null },
    { n: 4, status: 'BALANCED', trigger: 'ADMIN', by: 'W8-admin-seed', amounts: ['7.00', '7.00', '0.00'] },
    { n: 5, status: 'DRIFT', trigger: 'JOB', by: null, amounts: ['1.00', '3.25', '-2.25'] },
  ];
  for (const s of specs) {
    const id = `W8-run-${randomUUID()}`;
    trackedRunIds.push(id);
    await prisma.reconciliationRun.create({
      data: {
        id,
        startedAt: new Date(base + s.n * 60_000),
        finishedAt: new Date(base + s.n * 60_000 + 500),
        trigger: s.trigger,
        triggeredBy: s.by,
        status: s.status,
        escrowBalance: s.amounts ? D(s.amounts[0]) : null,
        claimsTotal: s.amounts ? D(s.amounts[1]) : null,
        drift: s.amounts ? D(s.amounts[2]) : null,
        summary: s.status === 'ERROR' ? {} : { breakdown: { clientBalances: s.amounts![1] }, negativeWalletCount: 0 },
        errorCode: s.status === 'ERROR' ? 'REPORT_FAILED' : null,
      },
    });
  }
  const { status, body, text } = await getJson('/reconciliation/runs?limit=5');
  assert.equal(status, 200);
  assert.equal(body.limit, 5);
  assert.equal(body.offset, 0);
  assert.ok(body.total >= 5);
  assert.equal(body.hasMore, body.total > 5);
  assert.equal(body.items.length, 5);
  assert.deepEqual(
    body.items.map((i: { startedAt: string }) => i.startedAt),
    [5, 4, 3, 2, 1].map((n) => new Date(base + n * 60_000).toISOString()),
    'ordered by startedAt desc',
  );
  const first = body.items[0];
  assert.deepEqual(Object.keys(first).sort(), ['claimsTotal', 'drift', 'errorCode', 'escrowBalance', 'finishedAt', 'id', 'startedAt', 'status', 'summary', 'trigger', 'triggeredBy']);
  assert.equal(first.escrowBalance, '1.00');
  assert.equal(first.claimsTotal, '3.25');
  assert.equal(first.drift, '-2.25', 'a negative drift keeps its sign and scale');
  const err = body.items[2];
  assert.equal(err.status, 'ERROR');
  assert.equal(err.escrowBalance, null);
  assert.equal(err.drift, null);
  assert.equal(err.errorCode, 'REPORT_FAILED');
  for (const word of ['email', 'ownerId', 'walletId', 'payoutInfo', 'bankReference', 'w8@example.com']) {
    assert.ok(!text.includes(word), `history payload must not contain "${word}"`);
  }
});

test('runs list: paging by limit/offset is stable and hasMore flips on the last page', async () => {
  const all = await getJson('/reconciliation/runs?limit=100');
  assert.equal(all.status, 200);
  const total: number = all.body.total;
  const p1 = await getJson('/reconciliation/runs?limit=2&offset=0');
  const p2 = await getJson('/reconciliation/runs?limit=2&offset=2');
  assert.equal(p1.body.items.length, 2);
  assert.equal(p2.body.items.length, 2);
  assert.equal(p1.body.hasMore, true);
  const ids = [...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id);
  assert.equal(new Set(ids).size, 4, 'no row repeated across pages');
  assert.deepEqual(ids, all.body.items.slice(0, 4).map((i: { id: string }) => i.id), 'pages are slices of the same ordering');
  const last = await getJson(`/reconciliation/runs?limit=1&offset=${total - 1}`);
  assert.equal(last.body.items.length, 1);
  assert.equal(last.body.hasMore, false);
  const beyond = await getJson(`/reconciliation/runs?limit=5&offset=${total + 10}`);
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.body.items, []);
  assert.equal(beyond.body.hasMore, false);
});

test('runs list: ?status= filters, and the filtered total counts only that status', async () => {
  const errors = await getJson('/reconciliation/runs?status=ERROR&limit=100');
  assert.equal(errors.status, 200);
  assert.ok(errors.body.items.length >= 1);
  assert.ok(errors.body.items.every((i: { status: string }) => i.status === 'ERROR'));
  assert.equal(errors.body.total, await prisma.reconciliationRun.count({ where: { status: 'ERROR' } }));
  const drift = await getJson('/reconciliation/runs?status=DRIFT&limit=100');
  assert.ok(drift.body.items.every((i: { status: string }) => i.status === 'DRIFT'));
});

test('the /runs paths are not shadowed by a "/:id/..." route', async () => {
  const res = await getJson('/reconciliation/runs');
  assert.equal(res.status, 200);
  assert.equal(res.body.limit, 20, 'default limit 20');
  assert.ok(Array.isArray(res.body.items));
});
