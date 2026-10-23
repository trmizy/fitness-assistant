/**
 * FH-4 (real status lookup) - GET /admin/payments/obligations now asks the owning services (read-only batched status
 * routes) about every PAID + ACTIVATED product payment. gym-service has the real route; ai-service is PARTNER-OWNED and has none yet,
 * so the personalized-order lookup is OFF by default (AI_ORDER_STATUS_LOOKUP) and the ai fake here only pins the opt-in client
 * contract the partner's future route must satisfy (see the FH-4 handoff in the report).
 *
 * REAL HTTP against the real admin router + real Postgres (*_test database); the money rows come from the real wallet
 * ledger (TEST FIXTURE rows are labelled). The owning services are local HTTP servers that speak the wire shape the real
 * routes answer with (gym-service/src/__tests__/internal-status.integration.test.ts pins the real gym route against its database).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_g3_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh4-target-status-lookup.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { tableCounts } from './support/fh-backlog-seed';

const skipOpts = {
  skip: isTestDatabaseUrl(process.env.DATABASE_URL) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};
const SECRET = 'fh4-lookup-secret';
process.env.INTERNAL_SERVICE_SECRET = SECRET;
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4058';
process.env.TARGET_STATUS_LOOKUP_TIMEOUT_MS = '400';

type OwnerFacts = Record<string, { status: string; cumulativeRefundedAmount?: number }>;
const owner = {
  gym: { facts: {} as OwnerFacts, mode: 'OK' as 'OK' | 'HANG' | 'DOWN', calls: [] as Array<{ secret: unknown; ids: string[] }> },
  ai: { facts: {} as OwnerFacts, mode: 'OK' as 'OK' | 'HANG' | 'DOWN', calls: [] as Array<{ secret: unknown; ids: string[] }> },
};

function ownerServer(kind: 'gym' | 'ai') {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const o = owner[kind];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      o.calls.push({ secret: req.headers['x-service-secret'], ids: body.ids ?? [] });
      if (o.mode === 'HANG') return; // never answers: the client's deadline must fire
      if (o.mode === 'DOWN') return void req.socket.destroy();
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['x-service-secret'] !== SECRET) {
        res.statusCode = 401;
        return void res.end('{"error":"Invalid service secret"}');
      }
      const data = (body.ids as string[])
        .filter((id) => o.facts[id])
        .map((id) => ({ id, status: o.facts[id].status, ...(kind === 'ai' ? { cumulativeRefundedAmount: o.facts[id].cumulativeRefundedAmount ?? 0 } : {}) }));
      res.end(JSON.stringify({ success: true, data }));
    });
  });
}

let gymSrv: http.Server;
let aiSrv: http.Server;
let authServer: http.Server;
let app: http.Server;
let base = '';
let prismaRef: any;

test.before(async () => {
  if (skipOpts.skip) return;
  gymSrv = ownerServer('gym');
  aiSrv = ownerServer('ai');
  await new Promise<void>((r) => gymSrv.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => aiSrv.listen(0, '127.0.0.1', r));
  process.env.GYM_SERVICE_URL = `http://127.0.0.1:${(gymSrv.address() as AddressInfo).port}`;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(aiSrv.address() as AddressInfo).port}`;
  delete process.env.GYM_LAMBDA_NAME;
  delete process.env.AI_LAMBDA_NAME;

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
  await new Promise<void>((r) => authServer.listen(4058, '127.0.0.1', r));
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const server = express();
  server.use(express.json());
  server.use('/admin/payments', adminRoutes);
  app = http.createServer(server);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (skipOpts.skip) return;
  for (const s of [app, authServer, gymSrv, aiSrv]) await new Promise<void>((r) => s.close(() => r()));
  if (prismaRef) await prismaRef.$disconnect();
});

const get = (token?: string) =>
  fetch(`${base}/admin/payments/obligations?limit=100`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/** TEST FIXTURE: PAID + ACTIVATED product payments with a hand-built ledger (the owner's answer is set per target id). */
async function seedProducts() {
  const { prisma } = await import('../repositories/prisma');
  const { Prisma } = await import('../generated/prisma');
  const { walletService } = await import('../services/wallet.service');
  prismaRef = prisma;
  const D = (v: number) => new Prisma.Decimal(v);
  await prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, partner_receivable_events, contract_unpaid_obligation_events, contract_unpaid_obligations, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  const escW = await walletService.getOrCreateWallet('PLATFORM', 'ESCROW');
  const gymW = await walletService.getOrCreateWallet('GYM', 'gym-g3');
  const ptW = await walletService.getOrCreateWallet('PT', 'pt-g3');

  async function product(kind: 'GYM_MEMBERSHIP' | 'PERSONALIZED_SERVICE_PURCHASE', targetId: string, o: { amount: number; pending: number; refund?: number }) {
    const client = `client-${targetId}`;
    const txn = await prisma.paymentTransaction.create({
      data: {
        payerId: client, purpose: kind, amount: o.amount, currency: 'VND', status: 'PAID', paidAt: new Date(), provider: 'VNPAY',
        providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${targetId}-${randomUUID()}`,
        relatedEntityType: kind, relatedEntityId: targetId, activationStatus: 'ACTIVATED', sourceService: 'integration-test',
      } as any,
    });
    const partnerW = kind === 'GYM_MEMBERSHIP' ? gymW : ptW;
    const clientW = await walletService.getOrCreateWallet('CLIENT', client);
    await walletService.withWallets([escW.id, partnerW.id, clientW.id], txn.id, async (ops) => {
      await ops.credit(escW.id, D(o.amount), 'TEST FIXTURE product cash in', 'AVAILABLE');
      if (o.pending > 0) await ops.credit(partnerW.id, D(o.pending), 'TEST FIXTURE partner share', 'PENDING');
      if (o.refund) await ops.credit(clientW.id, D(o.refund), 'TEST FIXTURE membership - refund', 'AVAILABLE');
    });
    return txn;
  }

  const t = {
    active: await product('GYM_MEMBERSHIP', 'mem-active', { amount: 500_000, pending: 450_000 }),
    expired: await product('GYM_MEMBERSHIP', 'mem-expired', { amount: 500_000, pending: 450_000 }),
    cancelledPaid: await product('GYM_MEMBERSHIP', 'mem-cancelled', { amount: 500_000, pending: 450_000 }),
    refundDone: await product('GYM_MEMBERSHIP', 'mem-refunded', { amount: 500_000, pending: 0, refund: 500_000 }),
    refundShort: await product('GYM_MEMBERSHIP', 'mem-short', { amount: 500_000, pending: 0, refund: 200_000 }),
    notAtOwner: await product('GYM_MEMBERSHIP', 'mem-unknown', { amount: 500_000, pending: 450_000 }),
    orderActive: await product('PERSONALIZED_SERVICE_PURCHASE', 'ord-active', { amount: 300_000, pending: 270_000 }),
    orderRefundDone: await product('PERSONALIZED_SERVICE_PURCHASE', 'ord-refunded-ok', { amount: 300_000, pending: 0, refund: 100_000 }),
    orderRefundShort: await product('PERSONALIZED_SERVICE_PURCHASE', 'ord-refunded-short', { amount: 300_000, pending: 0, refund: 40_000 }),
  };
  owner.gym.facts = {
    'mem-active': { status: 'ACTIVE' },
    'mem-expired': { status: 'EXPIRED' },
    'mem-cancelled': { status: 'CANCELLED' },
    'mem-refunded': { status: 'CANCELLED' },
    'mem-short': { status: 'CANCELLED' },
  };
  owner.ai.facts = {
    'ord-active': { status: 'ACTIVE' },
    'ord-refunded-ok': { status: 'REFUNDED', cumulativeRefundedAmount: 100_000 },
    'ord-refunded-short': { status: 'REFUNDED', cumulativeRefundedAmount: 100_000 },
  };
  process.env.AI_ORDER_STATUS_LOOKUP = 'true'; // opt-in contract mode; the default-off test flips it back
  owner.gym.mode = 'OK';
  owner.ai.mode = 'OK';
  owner.gym.calls.length = 0;
  owner.ai.calls.length = 0;
  return { prisma, t };
}

test('ADMIN 200 / non-ADMIN 403 / no token 401 on the report', skipOpts, async () => {
  await seedProducts();
  assert.equal((await get()).status, 401);
  assert.equal((await get('customer')).status, 403);
  assert.equal((await get('admin')).status, 200);
});

test('real gym lookup + ai opt-in contract: ACTIVE/EXPIRED never in a warning; CANCELLED+PAID detected; refunds split completed vs short; not-at-owner is pending', skipOpts, async () => {
  const { prisma, t } = await seedProducts();
  const before = await tableCounts(prisma);
  const res = await get('admin');
  assert.equal(res.status, 200);
  const d = ((await res.json()) as any).data;

  // the client sends the service secret and batches: ONE call per owning service for the 9 candidates
  assert.equal(owner.gym.calls.length, 1);
  assert.equal(owner.ai.calls.length, 1);
  assert.equal(owner.gym.calls[0].secret, SECRET);
  assert.equal(owner.gym.calls[0].ids.length, 6);
  assert.equal(owner.ai.calls[0].ids.length, 3);

  const pp = d.summary.productPayments;
  assert.equal(pp.activeValid, 3, 'active + expired membership and the active order are alive');
  assert.equal(pp.cancelledPaid, 1);
  assert.equal(pp.refundCompleted, 2);
  assert.equal(pp.refundShort, 2);
  assert.equal(pp.pendingVerification, 1, 'a membership the owner does not know stays unverified');
  assert.equal(pp.lookup, 'PARTIAL');

  // ACTIVE membership never appears anywhere as a problem
  const everything = JSON.stringify([d.cancelledPaid, d.refundOutcomes, d.targetUnverified]);
  for (const alive of [t.active, t.expired, t.orderActive]) assert.ok(!everything.includes(alive.id), `alive target ${alive.id} must not be listed`);

  // warning: CANCELLED + PAID
  assert.equal(d.cancelledPaid.length, 1);
  assert.equal(d.cancelledPaid[0].transactionId, t.cancelledPaid.id);
  assert.equal(d.cancelledPaid[0].targetStatus, 'CANCELLED');
  assert.equal(d.cancelledPaid[0].partnerPendingRemaining, '450000.00');
  assert.equal(d.cancelledPaid[0].refundedToClient, '0.00');

  // refund outcomes joined with the ledger
  const byTxn = Object.fromEntries(d.refundOutcomes.map((r: any) => [r.transactionId, r]));
  assert.equal(byTxn[t.refundDone.id].outcome, 'REFUND_COMPLETED');
  assert.equal(byTxn[t.refundShort.id].outcome, 'REFUND_SHORT');
  assert.equal(byTxn[t.refundShort.id].refundShortBy, '300000.00');
  assert.equal(byTxn[t.orderRefundDone.id].outcome, 'REFUND_COMPLETED', 'owner says 100.000 refunded and the client got 100.000');
  assert.equal(byTxn[t.orderRefundDone.id].ownerRefundedAmount, '100000.00');
  assert.equal(byTxn[t.orderRefundShort.id].outcome, 'REFUND_SHORT', 'owner says 100.000 refunded but the ledger shows 40.000');
  assert.equal(byTxn[t.orderRefundShort.id].refundShortBy, '60000.00');

  // pending verification
  assert.equal(d.targetUnverified.candidates.length, 1);
  assert.equal(d.targetUnverified.candidates[0].transactionId, t.notAtOwner.id);

  // no PII: payer ids never appear; and the report wrote nothing
  assert.ok(!/payerId|client-mem|client-ord/.test(JSON.stringify(d)));
  assert.deepEqual(await tableCounts(prisma), before);
});

test('lookup timeout: the hanging service\'s rows go to "pending verification" (not cancelled, not OK); the other service still answers', skipOpts, async () => {
  const { t } = await seedProducts();
  owner.gym.mode = 'HANG';
  const started = Date.now();
  const d = ((await (await get('admin')).json()) as any).data;
  assert.ok(Date.now() - started < 3000, 'the short deadline bounds the report time');
  const pp = d.summary.productPayments;
  assert.equal(pp.cancelledPaid, 0, 'nothing may be called cancelled without the owner confirming it');
  assert.equal(pp.activeValid, 1, 'the ai-service answer (active order) still counts');
  assert.equal(pp.refundShort, 1);
  assert.equal(pp.refundCompleted, 1);
  // every gym membership candidate that holds money (active, expired, cancelled, unknown) is pending; refund-only rows with no money are dropped
  const pendingIds = d.targetUnverified.candidates.map((c: any) => c.transactionId).sort();
  assert.deepEqual(pendingIds, [t.active.id, t.expired.id, t.cancelledPaid.id, t.notAtOwner.id].sort());
  assert.equal(pp.lookup, 'PARTIAL');
  assert.deepEqual(d.cancelledPaid, []);
});

test('both owners down / wrong secret: everything is pending verification, state UNAVAILABLE, the report still 200', skipOpts, async () => {
  await seedProducts();
  owner.gym.mode = 'DOWN';
  owner.ai.mode = 'DOWN';
  const res = await get('admin');
  assert.equal(res.status, 200);
  const d = ((await res.json()) as any).data;
  assert.equal(d.summary.productPayments.lookup, 'UNAVAILABLE');
  assert.equal(d.summary.productPayments.cancelledPaid, 0);
  assert.equal(d.summary.productPayments.activeValid, 0);
  assert.ok(d.summary.productPayments.pendingVerification >= 5);

  owner.gym.mode = 'OK';
  owner.ai.mode = 'OK';
  const saved = process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = 'a-different-secret';
  try {
    const d2 = ((await (await get('admin')).json()) as any).data;
    assert.equal(d2.summary.productPayments.lookup, 'UNAVAILABLE', 'owners answer 401 -> nothing verified');
    assert.equal(d2.summary.productPayments.cancelledPaid, 0);
  } finally {
    process.env.INTERNAL_SERVICE_SECRET = saved;
  }
});

test('more than 100 candidates are fetched in batches of at most 100', skipOpts, async () => {
  const { createTargetStatusLookup } = await import('../clients/target-status.client');
  owner.gym.calls.length = 0;
  owner.gym.mode = 'OK';
  const refs = Array.from({ length: 230 }, (_, i) => ({ id: `t${i}`, relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: `mem-bulk-${i}` }));
  for (const r of refs) owner.gym.facts[r.relatedEntityId] = { status: 'ACTIVE' };
  const lookup = createTargetStatusLookup({ timeoutMs: 1000 });
  await lookup.prime!(refs);
  assert.deepEqual(owner.gym.calls.map((c) => c.ids.length).sort((a, b) => b - a), [100, 100, 30]);
  assert.equal(await lookup(refs[229]), 'ACTIVE');
  await assert.rejects(lookup({ id: 'x', relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: 'never-asked' }));
});

test('DEFAULT (ai lookup off): memberships are verified, personalized orders stay "pending verification" and ai-service is never called', skipOpts, async () => {
  const { t } = await seedProducts();
  process.env.AI_ORDER_STATUS_LOOKUP = 'false';
  const d = ((await (await get('admin')).json()) as any).data;
  assert.equal(owner.ai.calls.length, 0, 'no call to the partner-owned service');
  assert.equal(owner.gym.calls.length, 1);
  const pp = d.summary.productPayments;
  assert.equal(pp.activeValid, 2, 'active + expired membership');
  assert.equal(pp.cancelledPaid, 1);
  assert.equal(pp.refundCompleted, 1);
  assert.equal(pp.refundShort, 1);
  const pending = d.targetUnverified.candidates.map((c: any) => c.transactionId).sort();
  assert.deepEqual(pending, [t.notAtOwner.id, t.orderActive.id].sort(), 'the unknown membership and the (unverifiable) order');
  assert.ok(d.cancelledPaid.every((r: any) => r.targetType === 'GYM_MEMBERSHIP'));
});
