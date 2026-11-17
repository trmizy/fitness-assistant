/**
 * Q1 (15/11/2026) - POST /internal/contracts/membership-appeal-supplement.
 * BACKEND INTEGRATION on an isolated *_test database, over the REAL Express route (so the response shape gym-service's client relies on is the one asserted).
 *
 * Fixture (TEST FIXTURE): a 1,000,000 GYM_MEMBERSHIP paid and settled (gym 90 % / platform 10 %, frozen on the payment), then the ORIGINAL refund of 630,000 through
 * the real releaseMembershipPending - after which the gym holds 333,000 and the platform 37,000 as AVAILABLE and the member holds 630,000. The supplement of the
 * appeal is then asked through the HTTP route. After every scenario the escrow/claims invariant is asserted (assertInvariant = buildReconciliationReport).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fix2pay_test" npx tsx --test src/__tests__/membership-appeal-supplement.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skip = isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.';
const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  membership: typeof import('../services/membership-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
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
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}

let server: http.Server | undefined;
let baseUrl = '';
async function call(body: unknown, headers: Record<string, string> = { 'x-service-secret': SECRET }) {
  if (!server) {
    const internalRoutes = (await import('../routes/internal.routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/internal', internalRoutes);
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const res = await fetch(`${baseUrl}/internal/contracts/membership-appeal-supplement`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

test.after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (mods) await mods.prisma.$disconnect();
});

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE');
}

interface Fx {
  txnId: string;
  gymId: string;
  clientId: string;
}

/** A paid + settled 1,000,000 membership whose original refund of `refunded` was already paid through the real release. */
async function seedRefundedMembership(m: Mods, opts: { refunded?: number; release?: boolean } = {}): Promise<Fx> {
  const refunded = opts.refunded ?? 630_000;
  const suffix = randomUUID().slice(0, 8);
  const gymId = `gym-${suffix}`;
  const clientId = `client-${suffix}`;
  const rates = { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId, purpose: 'GYM_MEMBERSHIP', amount: 1_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`, idempotencyKey: `membership-${suffix}`, relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: `membership-${suffix}`,
      sourceService: 'integration-test', metadata: { rates, parties: { ptUserId: gymId, gymId, clientUserId: clientId } },
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(1_000_000),
    rates: { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal(0), gymRate: new m.Prisma.Decimal('0.90') },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId },
    label: `membership ${suffix}`,
  });
  await m.prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'PAID' } });
  if (opts.release !== false) {
    await m.membership.releaseMembershipPending({
      transactionId: txn.id, gymId, clientId, ptUserId: null, refundToClient: new m.Prisma.Decimal(refunded), label: `orig ${suffix}`, idempotencyKey: `MEMBERSHIP_RELEASE:${suffix}`,
    });
  }
  return { txnId: txn.id, gymId, clientId };
}

async function bal(m: Mods, f: Fx) {
  const [gym, client, revenue, escrow] = await Promise.all([m.ledger.readWallet('GYM', f.gymId), m.ledger.readWallet('CLIENT', f.clientId), m.wallet.getRevenueWallet(), m.wallet.getEscrowWallet()]);
  return { gym: gym.availableBalance, gymPending: gym.pendingBalance, client: client.availableBalance, revenue: revenue.availableBalance.toFixed(2), escrow: escrow.availableBalance.toFixed(2) };
}

const body = (f: Fx, amount: string, key: string, extra: Record<string, unknown> = {}) => ({
  transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, amount, label: `Membership ${f.txnId} appeal supplement`, idempotencyKey: key, ...extra,
});
const keyOf = () => `GYM_CASE_APPEAL_SUPPLEMENT:${randomUUID()}`;

/** The gym withdrew money: AVAILABLE leaves the gym wallet and the escrow (a real payout), so the invariant still holds. */
async function gymWithdraws(m: Mods, f: Fx, amount: number) {
  const [gym, escrow] = await Promise.all([m.wallet.getOrCreateWallet('GYM', f.gymId), m.wallet.getEscrowWallet()]);
  await m.wallet.withWallets([gym.id, escrow.id], f.txnId, async (ops) => {
    await ops.debit(gym.id, new m.Prisma.Decimal(amount), 'test withdrawal');
    await ops.debit(escrow.id, new m.Prisma.Decimal(amount), 'test withdrawal');
  });
}

test('FULL gym balance: 70,000 supplement = gym 63,000 + platform 7,000, member paid 70,000, no debt, invariant holds', { skip }, async () => {
  const m = await load();
  await reset(m);
  const f = await seedRefundedMembership(m);
  const before = await bal(m, f);
  assert.deepEqual([before.gym, before.client, before.revenue, before.gymPending], ['333000.00', '630000.00', '37000.00', '0.00'], 'state after the original 630,000 refund');
  await m.reconcile.assertInvariant('before supplement');

  const key = keyOf();
  const r = await call(body(f, '70000.00', key));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.data, {
    refundedToClient: '70000.00', shortfall: '0.00', gymShare: '63000.00', gymDebited: '63000.00', gymShortfall: '0.00', platformShare: '7000.00', platformDebited: '7000.00',
  });
  const after = await bal(m, f);
  assert.deepEqual([after.gym, after.client, after.revenue, after.escrow], ['270000.00', '700000.00', '30000.00', before.escrow], 'gym -63,000, revenue -7,000, member +70,000, escrow unmoved');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0, 'no debt when the gym can fund its share');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key } }), 1);
  // the member now holds exactly the price
  assert.equal(new m.Prisma.Decimal(after.client).toFixed(0), '700000');
  await m.reconcile.assertInvariant('after full-balance supplement');
});

test('SHORT gym balance: gym has 13,000 of its 18,000 share -> member still paid 20,000, platform fronts 5,000, GYM_DEBT obligation owed 18,000 / paid 13,000 / unpaid 5,000', { skip }, async () => {
  const m = await load();
  await reset(m);
  const f = await seedRefundedMembership(m);
  await gymWithdraws(m, f, 320_000); // 333,000 -> 13,000
  const before = await bal(m, f);
  assert.deepEqual([before.gym, before.revenue], ['13000.00', '37000.00']);
  await m.reconcile.assertInvariant('before short supplement');

  const key = keyOf();
  const r = await call(body(f, '20000.00', key));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.data;
  assert.equal(d.refundedToClient, '20000.00', 'the member is paid in full');
  assert.equal(d.shortfall, '0.00', 'what the MEMBER is short is zero (gym-service reads this field)');
  assert.deepEqual([d.gymShare, d.gymDebited, d.gymShortfall, d.platformShare, d.platformDebited], ['18000.00', '13000.00', '5000.00', '2000.00', '7000.00']);
  assert.ok(d.obligationId);
  const after = await bal(m, f);
  assert.deepEqual([after.gym, after.client, after.revenue, after.escrow], ['0.00', '650000.00', '30000.00', before.escrow], 'gym emptied, never negative; revenue -7,000; member +20,000');
  const ob = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(ob.length, 1);
  assert.equal(ob[0].id, d.obligationId);
  assert.deepEqual([ob[0].kind, ob[0].party, ob[0].status, ob[0].owed.toFixed(2), ob[0].paid.toFixed(2), ob[0].unpaid.toFixed(2), ob[0].key], ['GYM_DEBT', 'GYM', 'OPEN', '18000.00', '13000.00', '5000.00', `${key}#GYM_DEBT`]);
  // N15A-08: the reason is plain Vietnamese with the amounts and NO ids
  assert.match(ob[0].reason ?? '', /^Hoàn thêm .* cho hội viên sau kháng nghị khiếu nại phòng gym/);
  assert.match(ob[0].reason ?? '', /nền tảng đã ứng 5.000/);
  assert.doesNotMatch(ob[0].reason ?? '', /[0-9a-f]{8}-[0-9a-f]{4}-|Appeal supplement|gym [0-9a-f]{8}/i);
  assert.equal(ob[0].transactionId, f.txnId);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PartnerReceivable is created (D48 source test stays valid)');
  await m.reconcile.assertInvariant('after short-gym supplement');
});

test('REPLAY: the same key returns the first answer and moves nothing; the same key with a different amount is refused 409', { skip }, async () => {
  const m = await load();
  await reset(m);
  const f = await seedRefundedMembership(m);
  await gymWithdraws(m, f, 320_000);
  const key = keyOf();
  const first = await call(body(f, '20000.00', key));
  assert.equal(first.status, 200);
  const mid = await bal(m, f);
  const rows = await m.prisma.walletLedgerEntry.count();

  const again = await call(body(f, '20000.00', key));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.data, first.body.data, 'same stored answer, same obligation id');
  assert.deepEqual(await bal(m, f), mid, 'no balance moved on the replay');
  assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'no ledger row written on the replay');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1, 'still exactly one obligation');

  const other = await call(body(f, '30000.00', key));
  assert.equal(other.status, 409);
  assert.equal(other.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.deepEqual(await bal(m, f), mid);

  // two concurrent first calls with one key pay once
  const f2 = await seedRefundedMembership(m);
  const k2 = keyOf();
  const [a, b] = await Promise.all([call(body(f2, '70000.00', k2)), call(body(f2, '70000.00', k2))]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.deepEqual(a.body.data, b.body.data);
  assert.equal((await bal(m, f2)).client, '700000.00', 'paid once');
  await m.reconcile.assertInvariant('after replay scenarios');
});

test('OVER-CAP / bad amounts are refused and move nothing; exactly the remaining refundable is accepted, one more dong is not', { skip }, async () => {
  const m = await load();
  await reset(m);
  const f = await seedRefundedMembership(m); // refundable left: 1,000,000 - 630,000 = 370,000
  const before = await bal(m, f);
  const ledgerRows = await m.prisma.walletLedgerEntry.count();

  for (const [amount, code] of [['0', 'INVALID_AMOUNT'], ['-1000', 'INVALID_AMOUNT'], ['1000.50', 'INVALID_AMOUNT']] as const) {
    const r = await call(body(f, amount, keyOf()));
    assert.equal(r.status, 400, `${amount}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error.code, code);
  }
  const bad = await call(body(f, 'abc', keyOf()));
  assert.equal(bad.status, 400);
  const over = await call(body(f, '371000.00', keyOf()));
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'EXCEEDS_REFUNDABLE');
  const badKey = await call(body(f, '1000.00', 'SOMETHING_ELSE:1'));
  assert.equal(badKey.status, 400);
  assert.deepEqual(await bal(m, f), before, 'nothing moved');
  assert.equal(await m.prisma.walletLedgerEntry.count(), ledgerRows);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: { startsWith: 'GYM_CASE_APPEAL_SUPPLEMENT:' } } }), 0, 'a refused call claims no key');

  const exact = await call(body(f, '370000.00', keyOf()));
  assert.equal(exact.status, 200, JSON.stringify(exact.body));
  assert.deepEqual([exact.body.data.gymShare, exact.body.data.platformShare], ['333000.00', '37000.00']);
  const done = await bal(m, f);
  assert.deepEqual([done.gym, done.revenue, done.client], ['0.00', '0.00', '1000000.00'], 'the member holds the whole price, gym and revenue exactly drained, none negative');
  const more = await call(body(f, '1000.00', keyOf()));
  assert.equal(more.status, 409);
  assert.equal(more.body.error.code, 'EXCEEDS_REFUNDABLE');
  await m.reconcile.assertInvariant('after over-cap scenarios');
});

test('PLATFORM funds insufficient: refused 409, NOTHING moves, no obligation, no key claimed; REVENUE never goes negative', { skip }, async () => {
  const m = await load();
  await reset(m);
  const f = await seedRefundedMembership(m);
  await gymWithdraws(m, f, 320_000); // gym 13,000; revenue 37,000
  const before = await bal(m, f);
  const key = keyOf();
  // gym share 54,000 -> gym funds 13,000, platform would have to put in 6,000 + 41,000 = 47,000 > 37,000
  const r = await call(body(f, '60000.00', key));
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PLATFORM_FUNDS_INSUFFICIENT');
  assert.deepEqual(await bal(m, f), before);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key } }), 0);
  await m.reconcile.assertInvariant('after refused supplement');
});

test('guards: membership pending not yet released, wrong gym / member, non-membership payment, synthetic origin, missing secret', { skip }, async () => {
  const m = await load();
  await reset(m);
  const notReleased = await seedRefundedMembership(m, { release: false });
  const early = await call(body(notReleased, '10000.00', keyOf()));
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'MEMBERSHIP_PENDING_NOT_RELEASED');

  const f = await seedRefundedMembership(m);
  const before = await bal(m, f);
  const wrongGym = await call({ ...body(f, '10000.00', keyOf()), gymId: 'someone-else' });
  assert.equal(wrongGym.status, 422);
  assert.equal(wrongGym.body.error.code, 'REQUEST_DOES_NOT_MATCH_TRANSACTION');
  const wrongClient = await call({ ...body(f, '10000.00', keyOf()), clientId: 'someone-else' });
  assert.equal(wrongClient.status, 422);
  const unknown = await call({ ...body(f, '10000.00', keyOf()), transactionId: randomUUID() });
  assert.equal(unknown.status, 404);
  const synthetic = await call({ ...body(f, '10000.00', keyOf()), entityOrigin: 'SYNTHETIC' });
  assert.equal(synthetic.status, 409);
  assert.equal(synthetic.body.error.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE');
  const noSecret = await call(body(f, '10000.00', keyOf()), {});
  assert.ok(noSecret.status === 401 || noSecret.status === 403, `status ${noSecret.status}`);
  const bodyless = await call({ transactionId: f.txnId });
  assert.equal(bodyless.status, 400);

  // a payment that is not a membership payment
  await m.prisma.paymentTransaction.update({ where: { id: f.txnId }, data: { purpose: 'PT_CONTRACT' } });
  const notMembership = await call(body(f, '10000.00', keyOf()));
  assert.equal(notMembership.status, 422);
  assert.equal(notMembership.body.error.code, 'NOT_A_MEMBERSHIP_PAYMENT');
  await m.prisma.paymentTransaction.update({ where: { id: f.txnId }, data: { purpose: 'GYM_MEMBERSHIP', status: 'FAILED' } });
  const notPaid = await call(body(f, '10000.00', keyOf()));
  assert.equal(notPaid.status, 409);
  assert.equal(notPaid.body.error.code, 'PAYMENT_NOT_PAID');
  assert.deepEqual(await bal(m, f), before, 'every refusal left the balances untouched');
});
