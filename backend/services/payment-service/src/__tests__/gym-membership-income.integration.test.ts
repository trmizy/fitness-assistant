/**
 * BACKEND INTEGRATION + REAL HTTP/API (isolated *_test database) - read-only owner analytics:
 *   GET /internal/gyms/:gymId/membership-income?from&to   (service-secret; used by gym-service /owner/gyms/:gymId/analytics)
 *
 * Every number here comes out of the REAL ledger code paths (settleContractPayment, settleMembershipReferral, releaseMembershipPending) - the test never
 * writes a ledger row of its own for a figure it then asserts, except the ones that are DEFINED as noise (a debt-recovery leg, a withdrawal). The ledger
 * rows' `created_at` is moved onto fixed Vietnam instants afterwards (TEST FIXTURE) so the day boundaries can be asserted.
 *
 * This file does NOT truncate anything (it uses its own gym ids), so it can share the test database with other suites.
 *   DATABASE_URL="postgresql://<user>:<pw>@localhost:55433/gymcoach_payment_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/gym-membership-income.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skipOpts = { skip: isTestDatabaseUrl(process.env.DATABASE_URL) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
process.env.INTERNAL_SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  membership: typeof import('../services/membership-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      membership: await import('../services/membership-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
    };
  }
  return mods;
}

let server: http.Server;
let base = '';
test.before(async () => {
  if (skipOpts.skip) return;
  const app = express();
  app.use(express.json());
  app.use('/internal', (await import('../routes/internal.routes')).default);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.after(async () => {
  if (skipOpts.skip) return;
  await new Promise<void>((r) => server.close(() => r()));
  if (mods) await mods.prisma.$disconnect();
});

const SECRET = 'test_internal_service_secret_32_chars_minimum';
const call = (gymId: string, qs: string, secret: string | null = SECRET) =>
  fetch(`${base}/internal/gyms/${gymId}/membership-income?${qs}`, { headers: secret ? { 'x-service-secret': secret } : {} });

// Mon 2025-03-03 .. Sun 2025-03-09 in Vietnam time, as instants
const FROM = '2025-03-02T17:00:00.000Z';
const TO = '2025-03-09T17:00:00.000Z';
const RANGE = `from=${FROM}&to=${TO}`;

interface Sale { txnId: string; membershipId: string; clientId: string }

async function settleMembership(m: Mods, gymId: string, price: number, opts: { platformRate?: string } = {}): Promise<Sale> {
  const sfx = randomUUID().slice(0, 8);
  const platformRate = opts.platformRate ?? '0.10';
  const membershipId = `membership-${sfx}`;
  const clientId = `client-${sfx}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId, purpose: 'GYM_MEMBERSHIP', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${sfx}`, idempotencyKey: `membership-${sfx}`, relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: membershipId, gymId,
      sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(price),
    rates: { platformRate: new m.Prisma.Decimal(platformRate), ptRate: new m.Prisma.Decimal(0), gymRate: new m.Prisma.Decimal((1 - Number(platformRate)).toFixed(4)) },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId },
    // The real webhook labels `${purpose} ${relatedEntityId}` (webhook.service.ts).
    label: `GYM_MEMBERSHIP ${membershipId}`,
  });
  return { txnId: txn.id, membershipId, clientId };
}

/** Moves every ledger row of `txnId` whose description matches onto `iso` (TEST FIXTURE: the service stamps now()). */
async function stamp(m: Mods, txnId: string, descriptionLike: string, iso: string) {
  await m.prisma.$executeRaw`UPDATE wallet_ledger_entries SET created_at = ${iso}::timestamp WHERE transaction_id = ${txnId} AND description LIKE ${descriptionLike}`;
}

const day = (date: string, v: Partial<Record<string, number>>) => ({ date, sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0, ...v });

test('membership-income · net per VN day from the REAL ledger: sale, referral, refund-on-release, natural release; matches the gym wallet; noise excluded', skipOpts, async () => {
  const m = await load();
  const gymId = `gym-income-${randomUUID().slice(0, 8)}`;
  const ptId = `pt-income-${randomUUID().slice(0, 8)}`;

  // A: 1,000,000 sold at 23:59:59.999 VN Mon 03/03 (UTC 16:59:59.999 same date), PT referral 100,000 on the same instant.
  const A = await settleMembership(m, gymId, 1_000_000);
  await m.membership.settleMembershipReferral({ transactionId: A.txnId, gymId, ptUserId: ptId, amount: new m.Prisma.Decimal(100_000), label: `Membership ${A.membershipId} referral`, idempotencyKey: `MEMBERSHIP_REFERRAL:${A.membershipId}` });
  await stamp(m, A.txnId, '%', '2025-03-03T16:59:59.999');
  // B: 500,000 sold at 00:00:00.000 VN Tue 03/04 (UTC date is still 03/03).
  const B = await settleMembership(m, gymId, 500_000);
  await stamp(m, B.txnId, '%', '2025-03-03T17:00:00.000');
  // B is refunded 200,000 by an admin on Thu 03/06 (release with refundToClient): the gym keeps 270,000 of its 450,000.
  await m.membership.releaseMembershipPending({ transactionId: B.txnId, gymId, clientId: B.clientId, ptUserId: null, refundToClient: new m.Prisma.Decimal(200_000), label: `Membership ${B.membershipId} admin refund (TEST)`, idempotencyKey: `MEMBERSHIP_RELEASE:${B.membershipId}` });
  await stamp(m, B.txnId, '%admin refund%', '2025-03-06T05:00:00.000');
  // A ends naturally on Sun 03/08: nothing refunded, everything released.
  await m.membership.releaseMembershipPending({ transactionId: A.txnId, gymId, clientId: A.clientId, ptUserId: ptId, refundToClient: new m.Prisma.Decimal(0), label: `Membership ${A.membershipId} natural expiry`, idempotencyKey: `MEMBERSHIP_RELEASE:${A.membershipId}` });
  await stamp(m, A.txnId, '%natural expiry%', '2025-03-08T09:00:00.000');
  await m.reconcile.assertInvariant('membership-income after fixtures');

  const expectedDays = [
    day('2025-03-03', { sales: 1, grossPrice: 1_000_000, gymShare: 900_000, feeAtSale: 100_000, referralCommission: 100_000, adjustments: 0, net: 800_000 }),
    day('2025-03-04', { sales: 1, grossPrice: 500_000, gymShare: 450_000, feeAtSale: 50_000, net: 450_000 }),
    day('2025-03-06', { adjustments: -180_000, net: -180_000 }), // pending 450,000 drained, 270,000 released
    day('2025-03-08', {}),                                        // 800,000 drained from pending, 800,000 released: nets to 0
  ];
  const expectedTotals = { sales: 2, grossPrice: 1_500_000, gymShare: 1_350_000, feeAtSale: 150_000, referralCommission: 100_000, adjustments: -180_000, net: 1_070_000 };

  let res = await call(gymId, RANGE);
  assert.equal(res.status, 200);
  let body = ((await res.json()) as any).data;
  assert.equal(body.walletFound, true);
  assert.deepEqual(body.daily, expectedDays);
  assert.deepEqual(body.totals, expectedTotals);

  // The ledger is the authority: the series adds up to what the gym wallet really holds (pending + available).
  const wallet = await m.ledger.readWallet('GYM', gymId);
  assert.equal(new m.Prisma.Decimal(wallet.availableBalance).plus(wallet.pendingBalance).toFixed(2), '1070000.00');
  assert.equal(body.totals.net, 1_070_000);

  // ---- noise that must NOT change a single number ----
  // 1. A PT-contract share booked on the same gym wallet (PT_CONTRACT purpose).
  const ptTxn = await m.prisma.paymentTransaction.create({
    data: { payerId: 'c-pt', purpose: 'PT_CONTRACT', amount: 2_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY', idempotencyKey: `ptc-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `ptc-${randomUUID()}`, sourceService: 'integration-test' },
  });
  await m.ledger.settleContractPayment({
    transactionId: ptTxn.id, price: new m.Prisma.Decimal(2_000_000),
    rates: { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal('0.50'), gymRate: new m.Prisma.Decimal('0.40') },
    parties: { ptUserId: ptId, gymId, clientUserId: 'c-pt' }, label: `PT_CONTRACT ${randomUUID()}`,
  });
  await stamp(m, ptTxn.id, '%', '2025-03-04T05:00:00.000');
  // 2. A withdrawal leg on the gym wallet (WITHDRAWAL purpose) and a gym-debt-recovery leg on a membership transaction.
  const gymWallet = await m.prisma.wallet.findUniqueOrThrow({ where: { ownerType_ownerId: { ownerType: 'GYM', ownerId: gymId } } });
  const wTxn = await m.prisma.paymentTransaction.create({
    data: { payerId: 'sys', purpose: 'WITHDRAWAL', amount: 400_000, currency: 'VND', status: 'PAID', provider: 'MOCK', idempotencyKey: `wd-${randomUUID()}`, sourceService: 'integration-test' },
  });
  await m.prisma.walletLedgerEntry.createMany({
    data: [
      { walletId: gymWallet.id, transactionId: wTxn.id, entryType: 'DEBIT', bucket: 'AVAILABLE', amount: 400_000, balanceBefore: 1, balanceAfter: 1, description: 'Withdrawal x paid - ref', createdAt: new Date('2025-03-05T05:00:00.000Z') },
      { walletId: gymWallet.id, transactionId: B.txnId, entryType: 'DEBIT', bucket: 'AVAILABLE', amount: 5_000, balanceBefore: 1, balanceAfter: 1, description: `Membership ${B.membershipId} admin refund (TEST) — released — gym debt recovered from income (obligation abc12345)`, createdAt: new Date('2025-03-08T05:00:00.000Z') },
    ],
  });
  // 3. Another gym's sale on a day inside the range, and this gym's sales exactly ON the (exclusive) end and one millisecond BEFORE the start.
  const other = await settleMembership(m, `gym-other-${randomUUID().slice(0, 6)}`, 300_000);
  await stamp(m, other.txnId, '%', '2025-03-04T05:00:00.000');
  const edgeAfter = await settleMembership(m, gymId, 100_000);
  await stamp(m, edgeAfter.txnId, '%', '2025-03-09T17:00:00.000');
  const edgeBefore = await settleMembership(m, gymId, 100_000);
  await stamp(m, edgeBefore.txnId, '%', '2025-03-02T16:59:59.999');

  res = await call(gymId, RANGE);
  body = ((await res.json()) as any).data;
  assert.deepEqual(body.daily, expectedDays, 'PT contract, withdrawal, debt-recovery leg, other gym and out-of-range sales change nothing');
  assert.deepEqual(body.totals, expectedTotals);

  // The two edge sales belong to the neighbouring days: Mon 03/10 00:00 VN and Sun 03/02 23:59:59.999 VN.
  const after = ((await (await call(gymId, `from=${TO}&to=2025-03-10T17:00:00.000Z`)).json()) as any).data;
  assert.deepEqual(after.daily.map((d: any) => [d.date, d.sales, d.gymShare]), [['2025-03-10', 1, 90_000]]);
  const before = ((await (await call(gymId, `from=2025-03-01T17:00:00.000Z&to=${FROM}`)).json()) as any).data;
  assert.deepEqual(before.daily.map((d: any) => [d.date, d.sales, d.gymShare]), [['2025-03-02', 1, 90_000]]);
});

test('membership-income · a gym without a wallet answers zeros and does NOT create one (read-only)', skipOpts, async () => {
  const m = await load();
  const gymId = `gym-nowallet-${randomUUID().slice(0, 8)}`;
  const res = await call(gymId, RANGE);
  assert.equal(res.status, 200);
  const d = ((await res.json()) as any).data;
  assert.equal(d.walletFound, false);
  assert.deepEqual(d.daily, []);
  assert.deepEqual(d.totals, { sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 });
  assert.equal(await m.prisma.wallet.count({ where: { ownerType: 'GYM', ownerId: gymId } }), 0, 'no wallet was created by the read');
});

test('membership-income · the commission is whatever the ledger booked (no rate in the reader): a 20% platform cut shows as 20%', skipOpts, async () => {
  const m = await load();
  const gymId = `gym-rate-${randomUUID().slice(0, 8)}`;
  const S = await settleMembership(m, gymId, 1_000_000, { platformRate: '0.20' });
  await stamp(m, S.txnId, '%', '2025-03-05T05:00:00.000');
  const d = ((await (await call(gymId, RANGE)).json()) as any).data;
  assert.deepEqual(d.daily, [day('2025-03-05', { sales: 1, grossPrice: 1_000_000, gymShare: 800_000, feeAtSale: 200_000, net: 800_000 })]);
});

test('membership-income · service-secret and query validation (401/403 without secret, 400 on bad or oversized range)', skipOpts, async () => {
  const gymId = 'gym-validate';
  const noSecret = await call(gymId, RANGE, null);
  assert.ok([401, 403].includes(noSecret.status), `status ${noSecret.status}`);
  const wrong = await call(gymId, RANGE, 'definitely-not-the-secret');
  assert.ok([401, 403].includes(wrong.status), `status ${wrong.status}`);
  assert.equal((await call(gymId, 'from=banana&to=2025-03-09T17:00:00.000Z')).status, 400);
  assert.equal((await call(gymId, `from=${FROM}`)).status, 400);
  const inverted = await call(gymId, `from=${TO}&to=${FROM}`);
  assert.equal(inverted.status, 400);
  assert.equal(((await inverted.json()) as any).error.code, 'INVALID_RANGE');
  assert.equal(((await (await call(gymId, `from=${FROM}&to=${FROM}`)).json()) as any).error.code, 'INVALID_RANGE', 'empty range');
  const huge = await call(gymId, 'from=2024-01-01T00:00:00.000Z&to=2025-03-01T00:00:00.000Z');
  assert.equal(huge.status, 400);
  assert.equal(((await huge.json()) as any).error.code, 'INVALID_RANGE');
  // 93 days is the most one call accepts (gym-service sends at most 92 inclusive days).
  assert.equal((await call(gymId, 'from=2025-01-01T00:00:00.000Z&to=2025-04-04T00:00:00.000Z')).status, 200);
  assert.equal((await call(gymId, 'from=2025-01-01T00:00:00.000Z&to=2025-04-04T00:00:00.001Z')).status, 400);
});
