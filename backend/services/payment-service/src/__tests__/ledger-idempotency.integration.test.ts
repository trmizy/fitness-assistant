/**
 * Business-key idempotency (money-flow redesign plan item 1.1).
 *
 * Every financial operation that a cross-service caller can legitimately retry —
 * because it settled money in payment-service but then failed before the caller
 * (user-service / gym-service) recorded that success locally — must be a no-op the
 * second time it is called with the same business key. Before this file, none of
 * releaseSession / compensateNoShow / terminateContract / settleMembershipReferral /
 * clawbackMembershipReferral had ANY such protection: the `transactionId` parameter
 * they take is only ever used as the FK anchor for WalletLedgerEntry rows (and a
 * human-readable label), never checked for a repeat. Calling any of them twice with
 * the exact same real-world event (same session, same contract, same membership)
 * moved money twice.
 *
 * Each scenario below calls the same ledger function twice with the same
 * `idempotencyKey`, and asserts the second call is a harmless replay: identical
 * result, and no wallet balance changed further. Run THIS FILE ALONE — like its
 * siblings, it TRUNCATEs the ledger:
 *
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/ledger-idempotency.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: /_test/i.test(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

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

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

function rateTable(m: Mods, platform: string, pt: string, gym: string) {
  return {
    platformRate: new m.Prisma.Decimal(platform),
    ptRate: new m.Prisma.Decimal(pt),
    gymRate: new m.Prisma.Decimal(gym),
  };
}

interface ContractFixture {
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: InstanceType<Mods['Prisma']['Decimal']>;
  totalSessions: number;
  rates: ReturnType<typeof rateTable>;
}

async function seedContract(m: Mods, price: number, totalSessions: number): Promise<ContractFixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, gymId: null, clientUserId: `client-${suffix}` };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId,
      purpose: 'PT_CONTRACT',
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `contract-${suffix}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: `contract-${suffix}`,
      sourceService: 'integration-test',
    },
  });
  const rates = rateTable(m, '0.10', '0.90', '0');
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(price),
    rates,
    parties,
    label: 'seed',
  });
  return { txnId: txn.id, parties, price: new m.Prisma.Decimal(price), totalSessions, rates };
}

async function contractBalances(m: Mods, f: ContractFixture) {
  const [pt, client, revenue] = await Promise.all([
    m.ledger.readWallet('PT', f.parties.ptUserId),
    m.ledger.readWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance,
    clientAvailable: client.availableBalance,
    platformPending: revenue.pendingBalance.toFixed(2),
    platformRevenue: revenue.availableBalance.toFixed(2),
  };
}

// ── releaseSession ────────────────────────────────────────────────────────────

test('releaseSession: replaying SESSION_RELEASE:<id> releases money only once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, 1_000_000, 10);
  const idempotencyKey = `SESSION_RELEASE:${randomUUID()}`;

  const first = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'session 1', idempotencyKey,
  } as any);
  const afterFirst = await contractBalances(m, f);
  assert.equal(afterFirst.ptAvailable, '90000.00', 'PT earned one session after the first call');

  const second = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'session 1 retried', idempotencyKey,
  } as any);
  const afterSecond = await contractBalances(m, f);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(afterSecond.ptAvailable, afterFirst.ptAvailable, 'PT was not paid a second time for the same session');
  assert.equal(afterSecond.ptPending, afterFirst.ptPending, 'pending bucket did not move again');
  await m.reconcile.assertInvariant('releaseSession replay');
});

// ── compensateNoShow ──────────────────────────────────────────────────────────

test('compensateNoShow: replaying PT_NO_SHOW:<id> compensates the client only once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, 1_000_000, 10);
  const idempotencyKey = `PT_NO_SHOW:${randomUUID()}`;

  const first = await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'no-show', idempotencyKey,
  } as any);
  const afterFirst = await contractBalances(m, f);
  assert.equal(afterFirst.clientAvailable, '100000.00', 'client compensated one session after the first call');

  const second = await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'no-show retried', idempotencyKey,
  } as any);
  const afterSecond = await contractBalances(m, f);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(afterSecond.clientAvailable, afterFirst.clientAvailable, 'client was not compensated a second time');
  await m.reconcile.assertInvariant('compensateNoShow replay');
});

// ── terminateContract ─────────────────────────────────────────────────────────

test('terminateContract: replaying CONTRACT_TERMINATE:<id> settles the contract only once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, 1_000_000, 10);
  const idempotencyKey = `CONTRACT_TERMINATE:${randomUUID()}`;
  const zero = new m.Prisma.Decimal(0);

  const first = await m.ledger.terminateContract({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, usedSessions: 0,
    rates: f.rates, reason: 'CLIENT_CANCELLED',
    alreadyReleased: { pt: zero, gym: zero, platform: zero },
    parties: f.parties, label: 'termination', idempotencyKey,
  } as any);
  const afterFirst = await contractBalances(m, f);
  assert.equal(afterFirst.clientAvailable, '900000.00', 'client refunded 90% after the first call');

  const second = await m.ledger.terminateContract({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, usedSessions: 0,
    rates: f.rates, reason: 'CLIENT_CANCELLED',
    alreadyReleased: { pt: zero, gym: zero, platform: zero },
    parties: f.parties, label: 'termination retried', idempotencyKey,
  } as any);
  const afterSecond = await contractBalances(m, f);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(afterSecond.clientAvailable, afterFirst.clientAvailable, 'client was not refunded a second time');
  await m.reconcile.assertInvariant('terminateContract replay');
});

// ── settleMembershipReferral / clawbackMembershipReferral ────────────────────

interface MembershipFixture {
  txnId: string;
  gymId: string;
  ptUserId: string;
  clientId: string;
}

async function seedPaidMembership(m: Mods, price: number): Promise<MembershipFixture> {
  const suffix = randomUUID().slice(0, 8);
  const gymId = `gym-${suffix}`;
  const ptUserId = `pt-${suffix}`;
  const clientId = `client-${suffix}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId,
      purpose: 'GYM_MEMBERSHIP',
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `membership-${suffix}`,
      relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: `membership-${suffix}`,
      sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(price),
    rates: { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal(0), gymRate: new m.Prisma.Decimal('0.90') },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId },
    label: 'seed membership',
  });
  return { txnId: txn.id, gymId, ptUserId, clientId };
}

test('settleMembershipReferral: replaying the same key moves the commission only once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  const idempotencyKey = `MEMBERSHIP_REFERRAL:${randomUUID()}`;
  const amount = new m.Prisma.Decimal(100_000);

  const first = await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount, label: 'referral', idempotencyKey,
  } as any);
  const pt1 = await m.ledger.readWallet('PT', f.ptUserId);
  assert.equal(pt1.pendingBalance, '100000.00', 'PT received the commission after the first call');

  const second = await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount, label: 'referral retried', idempotencyKey,
  } as any);
  const pt2 = await m.ledger.readWallet('PT', f.ptUserId);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(pt2.pendingBalance, pt1.pendingBalance, 'PT was not credited the commission a second time');
  await m.reconcile.assertInvariant('settleMembershipReferral replay');
});

test('clawbackMembershipReferral: replaying REFERRAL_CLAWBACK:<id> recovers only once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'referral', idempotencyKey: `MEMBERSHIP_REFERRAL:${randomUUID()}`,
  } as any);

  const idempotencyKey = `REFERRAL_CLAWBACK:${randomUUID()}`;
  const clawbackAmount = new m.Prisma.Decimal(50_000);

  const first = await m.membership.clawbackMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount: clawbackAmount, label: 'clawback', idempotencyKey,
  } as any);
  const gym1 = await m.ledger.readWallet('GYM', f.gymId);
  assert.equal(first.recovered, '50000.00', 'half the commission recovered after the first call');

  const second = await m.membership.clawbackMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount: clawbackAmount, label: 'clawback retried', idempotencyKey,
  } as any);
  const gym2 = await m.ledger.readWallet('GYM', f.gymId);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(gym2.pendingBalance, gym1.pendingBalance, 'gym was not credited the clawback a second time');
  await m.reconcile.assertInvariant('clawbackMembershipReferral replay');
});

// ── releaseMembershipPending ──────────────────────────────────────────────────

test('releaseMembershipPending: replaying MEMBERSHIP_RELEASE:<id> with a refund does not throw or double-refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  const idempotencyKey = `MEMBERSHIP_RELEASE:${randomUUID()}`;

  const first = await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: null,
    refundToClient: new m.Prisma.Decimal(400_000), label: 'release', idempotencyKey,
  } as any);
  const client1 = await m.ledger.readWallet('CLIENT', f.clientId);
  assert.equal(client1.availableBalance, '400000.00', 'client refunded once after the first call');

  // Before the fix, a second call with refundToClient > 0 on an already-drained pending bucket
  // THROWS ("asked to refund ... but this membership's pending is already fully released")
  // instead of safely replaying — this is exactly the retry a caller does when it settled here
  // but crashed before recording success locally.
  const second = await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: null,
    refundToClient: new m.Prisma.Decimal(400_000), label: 'release retried', idempotencyKey,
  } as any);
  const client2 = await m.ledger.readWallet('CLIENT', f.clientId);

  assert.deepEqual(second, first, 'the retry returns the exact same result it committed the first time');
  assert.equal(client2.availableBalance, client1.availableBalance, 'client was not refunded a second time');
  await m.reconcile.assertInvariant('releaseMembershipPending replay');
});

// ── Different keys must NOT be conflated ──────────────────────────────────────

test('two different sessions on the same contract each release independently', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, 1_000_000, 10);

  await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'session 1', idempotencyKey: `SESSION_RELEASE:${randomUUID()}`,
  } as any);
  await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'session 2', idempotencyKey: `SESSION_RELEASE:${randomUUID()}`,
  } as any);

  const b = await contractBalances(m, f);
  assert.equal(b.ptAvailable, '180000.00', 'two DIFFERENT sessions both released — the key must not over-suppress');
  await m.reconcile.assertInvariant('two distinct keys');
});
