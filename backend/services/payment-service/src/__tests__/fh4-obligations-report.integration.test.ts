/**
 * FH-4 part 2 - GET /admin/payments/obligations. REAL HTTP against the real admin router + real Postgres (*_test database),
 * data built with the real ledger (see support/fh-backlog-seed.ts; TEST FIXTURE rows are labelled there).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fhf_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh4-obligations-report.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { seedBacklog, tableCounts, PT } from './support/fh-backlog-seed';

const skipOpts = {
  skip: isTestDatabaseUrl(process.env.DATABASE_URL) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4057';

let authServer: http.Server;
let app: http.Server;
let base = '';
let prismaRef: Awaited<ReturnType<typeof seedBacklog>>['prisma'] | undefined;

test.before(async () => {
  if (skipOpts.skip) return;
  authServer = http.createServer((req, res) => {
    const a = String(req.headers.authorization || '');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/auth/verify' && a === 'Bearer admin') {
      res.end(JSON.stringify({ user: { id: 'admin-1', email: 'a@example.com', role: 'ADMIN' } }));
    } else if (req.method === 'POST' && req.url === '/auth/verify' && a === 'Bearer customer') {
      res.end(JSON.stringify({ user: { id: 'cust-1', email: 'c@example.com', role: 'CUSTOMER' } }));
    } else {
      res.statusCode = 401;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => authServer.listen(4057, '127.0.0.1', r));
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const server = express();
  server.use(express.json());
  server.use('/admin/payments', adminRoutes);
  app = http.createServer(server);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as any).port}`;
});

test.after(async () => {
  if (skipOpts.skip) return;
  await new Promise<void>((r) => app.close(() => r()));
  await new Promise<void>((r) => authServer.close(() => r()));
  if (prismaRef) await prismaRef.$disconnect();
});

const get = (path: string, token?: string) =>
  fetch(`${base}/admin/payments/obligations${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('403 for a non-admin, 401 without a token; neither touches the data', skipOpts, async () => {
  const seeded = await seedBacklog();
  prismaRef = seeded.prisma;
  assert.equal((await get('')).status, 401);
  assert.equal((await get('', 'customer')).status, 403);
  assert.equal((await get('', 'nonsense')).status, 401);
});

test('200 for ADMIN: every block is present, counts match the seeded ledger, and NOTHING is written', skipOpts, async () => {
  const seeded = await seedBacklog();
  prismaRef = seeded.prisma;
  const before = await tableCounts(seeded.prisma);

  const res = await get('', 'admin');
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.success, true);
  const d = body.data;

  // negative sub-ledger: contract A's id debited the PT's PENDING pool by 50.000 (fixture) -> exactly one, -50000
  assert.equal(d.summary.negativeSubledgers.count, 1);
  assert.equal(d.summary.negativeSubledgers.unbackedTotal, '50000.00');
  assert.equal(d.negativeSubledgers.length, 1);
  assert.equal(d.negativeSubledgers[0].ownerType, 'PT');
  assert.equal(d.negativeSubledgers[0].owner, PT.slice(0, 8));
  assert.equal(d.negativeSubledgers[0].net, '-50000.00');
  assert.equal(d.negativeSubledgers[0].transactionId, seeded.A.txn.id);
  assert.equal(d.summary.negativeWallets, 0);

  // wallet differs from its ledger by 7 (fixture), plus the escrow row is flagged but not counted as a defect
  assert.ok(d.walletMismatches.some((r: any) => !r.isEscrow && r.difference === '7.00' && r.bucket === 'AVAILABLE'));
  assert.equal(d.summary.walletMismatches.nonEscrowCount, d.walletMismatches.filter((r: any) => !r.isEscrow).length);

  // receivables: split active vs suspended; outstanding = amount - recovered - waived
  assert.equal(d.summary.receivables.active.count, 2);
  assert.equal(d.summary.receivables.active.outstanding, '100000.00');
  assert.equal(d.summary.receivables.suspended.count, 1);
  assert.equal(d.summary.receivables.suspended.outstanding, '20000.00');
  assert.equal(d.receivables.length, 3);
  assert.deepEqual(d.receivables.map((r: any) => r.state), ['ACTIVE', 'ACTIVE', 'SUSPENDED']);
  assert.equal(d.receivables[0].outstanding, '70000.00', 'largest active first');
  assert.equal(d.receivables[2].suspensionRef, 'FIX-1');

  // unpaid obligations produced by the real ledger (two no-shows after everything was delivered)
  assert.equal(d.summary.unpaidObligations.open.count, 2);
  assert.equal(d.unpaidObligations.length, 2);
  for (const o of d.unpaidObligations) {
    assert.equal(o.kind, 'NO_SHOW');
    assert.equal(o.party, 'CLIENT');
    assert.equal(o.status, 'OPEN');
    assert.equal(o.transactionId, seeded.A.txn.id);
    assert.equal(o.unpaid, o.owed);
  }

  // PAID but not activated beyond 30 min: only the 2-hour-old one
  assert.equal(d.summary.paidNotActivated, 1);
  assert.equal(d.paidNotActivated[0].transactionId, seeded.stuck.id);
  assert.equal(d.paidNotActivated[0].activationStatus, 'ACTIVATION_FAILED');
  assert.ok(d.paidNotActivated[0].ageMinutes >= 119);
  const wide = (await (await get('?staleMinutes=1', 'admin')).json()) as any;
  assert.equal(wide.data.summary.paidNotActivated, 2, 'a 1-minute threshold also lists the fresh one');

  // FH-4 accuracy: money still in PENDING never implies CANCELLED. The group is the neutral "unverified" one
  // (the seeded membership is a normal PAID + ACTIVATED one) and the old cancellation-warning key is gone.
  assert.equal(d.activatedButCancelled, undefined);
  assert.equal(d.summary.activatedButCancelled, undefined);
  assert.equal(d.truncated.activatedButCancelled, undefined);
  assert.equal(d.targetUnverified.status, 'TARGET_STATUS_UNVERIFIED');
  assert.equal(d.summary.targetUnverified.status, 'TARGET_STATUS_UNVERIFIED');
  assert.equal(d.targetUnverified.candidates.length, 1);
  assert.equal(d.targetUnverified.candidates[0].transactionId, seeded.mem.id);
  assert.equal(d.targetUnverified.candidates[0].partnerPendingRemaining, '450000.00');

  // no PII / no long ids of people: partner ids are cut to 8 characters, no payer ids anywhere
  const text = JSON.stringify(d);
  assert.ok(!text.includes('client-A'), 'payer ids never appear');
  assert.ok(!text.includes(PT + 'x'));
  assert.ok(!/payerId/.test(text));

  // READ-ONLY: every table and every wallet balance is exactly as before
  assert.deepEqual(await tableCounts(seeded.prisma), before);
});

test('limit caps every list, says so in `truncated`, and counts stay exact', skipOpts, async () => {
  const seeded = await seedBacklog();
  prismaRef = seeded.prisma;
  const body = (await (await get('?limit=1', 'admin')).json()) as any;
  const d = body.data;
  assert.equal(d.params.limit, 1);
  assert.equal(d.receivables.length, 1);
  assert.equal(d.truncated.receivables, true);
  assert.equal(d.summary.receivables.active.count, 2, 'counts are not capped');
  assert.equal(d.unpaidObligations.length, 1);
  assert.equal(d.truncated.unpaidObligations, true);
  assert.equal(d.summary.unpaidObligations.open.count, 2);
  assert.equal(d.truncated.negativeSubledgers, false);
  const huge = (await (await get('?limit=999999', 'admin')).json()) as any;
  assert.equal(huge.data.params.limit, 200, 'limit is clamped');
});

test('there is no write route: POST/PUT/PATCH/DELETE on /obligations are not served', skipOpts, async () => {
  await seedBacklog().then((s) => (prismaRef = s.prisma));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(`${base}/admin/payments/obligations`, {
      method,
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : '{}',
    });
    assert.equal(res.status, 404, `${method} must not be routed`);
  }
});

test('the READ ONLY transaction pattern really refuses a write', skipOpts, async () => {
  const { prisma, Prisma } = await seedBacklog().then((s) => ({ prisma: s.prisma, Prisma: s.Prisma }));
  prismaRef = prisma;
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance + 1`);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    ),
    /read-only transaction/i,
  );
});
