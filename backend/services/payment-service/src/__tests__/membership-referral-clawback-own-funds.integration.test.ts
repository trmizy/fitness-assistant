/**
 * [REGRESSION D48] DQ-3 - the membership referral commission clawback (A2) runs on the own-funds model.
 *
 * Before: clawbackMembershipReferral drew THIS membership's pending of the PT, then the PT's POOLED AVAILABLE (earnings
 * of every other membership / contract / order), and booked a PartnerReceivable (a PT debt) for the rest.
 * Now: only the PT's pending for THIS membership's transaction; what could not be reclaimed (the commission already
 * matured to AVAILABLE and may have been withdrawn) is a durable, idempotent OPEN OVER_RELEASED incident in
 * contract_unpaid_obligations (party PT, owed = the clawback requested, paid = reclaimed) - no PartnerReceivable, no
 * pooled draw, nothing fronted. LEDGER_STRICT_OWN_FUNDS=false restores the legacy behaviour.
 *
 * BACKEND INTEGRATION (real ledger, isolated *_test database). Run THIS FILE ALONE (it TRUNCATEs the ledger):
 *   DATABASE_URL=".../gymcoach_payment_g1_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     npx tsx --test src/__tests__/membership-referral-clawback-own-funds.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skipOpts = {
  skip: isTestDatabaseUrl(process.env.DATABASE_URL || '') ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

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
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, contract_unpaid_obligations, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

const D = (m: Mods, v: string | number) => new m.Prisma.Decimal(v);

interface Fixture {
  txnId: string;
  membershipId: string;
  gymId: string;
  ptUserId: string;
  clientId: string;
  price: InstanceType<Mods['Prisma']['Decimal']>;
}

/** A paid membership with a 100.000 referral commission already moved from the gym's pending to the PT's pending. */
async function seedMembershipWithReferral(m: Mods, price = 1_000_000, commission = 100_000): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const gymId = `gym-${suffix}`;
  const ptUserId = `pt-${suffix}`;
  const clientId = `client-${suffix}`;
  const membershipId = `membership-${suffix}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId, purpose: 'GYM_MEMBERSHIP', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`, idempotencyKey: membershipId, relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: membershipId, sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id, price: D(m, price),
    rates: { platformRate: D(m, '0.10'), ptRate: D(m, 0), gymRate: D(m, '0.90') },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId }, label: `membership ${suffix}`,
  });
  await m.membership.settleMembershipReferral({
    transactionId: txn.id, gymId, ptUserId, amount: D(m, commission), label: `referral ${suffix}`,
    idempotencyKey: `MEMBERSHIP_REFERRAL:${membershipId}`,
  });
  return { txnId: txn.id, membershipId, gymId, ptUserId, clientId, price: D(m, price) };
}

/** The commission matured: the membership ended and its pending was released to the parties' AVAILABLE. */
async function matureMembership(m: Mods, f: Fixture) {
  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: f.ptUserId,
    refundToClient: D(m, 0), label: 'ended', idempotencyKey: `MEMBERSHIP_RELEASE:${f.membershipId}`,
  });
}

/** AVAILABLE the PT earned from OTHER work. */
async function seedPtOtherEarnings(m: Mods, f: Fixture, amount: string) {
  const pt = await m.wallet.getOrCreateWallet('PT', f.ptUserId);
  const escrow = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([pt.id, escrow.id], f.txnId, async (ops) => {
    await ops.credit(pt.id, D(m, amount), 'seed - earnings of other work', 'AVAILABLE');
    await ops.credit(escrow.id, D(m, amount), 'seed - escrow');
  });
}

function clawArgs(m: Mods, f: Fixture, amount: string, key = `REFERRAL_CLAWBACK:${f.membershipId}`) {
  return {
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount: D(m, amount),
    label: `Membership ${f.membershipId} admin refund`, idempotencyKey: key,
  };
}

async function snap(m: Mods, f: Fixture) {
  const [gym, pt, revenue] = await Promise.all([
    m.ledger.readWallet('GYM', f.gymId), m.ledger.readWallet('PT', f.ptUserId), m.wallet.getRevenueWallet(),
  ]);
  return {
    gymPending: gym.pendingBalance, gymAvailable: gym.availableBalance, ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance, revenueAvailable: revenue.availableBalance.toFixed(2),
  };
}

async function assertSound(m: Mods, ctx: string) {
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PartnerReceivable was created');
  const report = await m.reconcile.assertInvariant(ctx);
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
  assert.equal(report.balanced, true, 'escrow == sum of claims');
}

test('[REGRESSION D48] unreleased commission: this membership’s own pending covers the clawback in full - no obligation, PT pooled AVAILABLE untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembershipWithReferral(m);
  await seedPtOtherEarnings(m, f, '300000');
  const before = await snap(m, f);
  assert.equal(before.ptPending, '100000.00');

  const r = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '100000'));

  assert.deepEqual([r.recovered, r.shortfall, r.owed, r.paid, r.unpaid], ['100000.00', '0.00', '100000.00', '100000.00', '0.00']);
  assert.equal(r.obligationId, undefined);
  const after = await snap(m, f);
  assert.equal(after.ptPending, '0.00');
  assert.equal(after.ptAvailable, '300000.00', 'pooled AVAILABLE untouched');
  assert.equal(after.gymPending, '900000.00', 'the commission went back to the gym pending');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertSound(m, 'D48 clawback of pending commission');
});

test('[REGRESSION D48] matured commission: nothing is drawn from the PT’s pooled AVAILABLE - the shortfall is an OPEN incident, no receivable', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembershipWithReferral(m);
  await matureMembership(m, f);
  await seedPtOtherEarnings(m, f, '500000'); // plenty of pooled money that the old code would have drawn
  const before = await snap(m, f);
  assert.equal(before.ptAvailable, '600000.00');

  const r = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '100000'));

  assert.deepEqual([r.recovered, r.shortfall, r.owed, r.paid, r.unpaid], ['0.00', '100000.00', '100000.00', '0.00', '100000.00']);
  const after = await snap(m, f);
  assert.equal(after.ptAvailable, '600000.00', 'PT pooled AVAILABLE untouched');
  assert.equal(after.revenueAvailable, before.revenueAvailable, 'the platform fronted nothing');
  assert.equal(after.gymPending, before.gymPending);
  const rows = await m.prisma.contractUnpaidObligation.findMany({ where: { transactionId: f.txnId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'OVER_RELEASED');
  assert.equal(rows[0].party, 'PT');
  assert.equal(rows[0].status, 'OPEN');
  assert.equal(rows[0].owed.toFixed(2), '100000.00');
  assert.equal(rows[0].paid.toFixed(2), '0.00');
  assert.equal(rows[0].unpaid.toFixed(2), '100000.00');
  assert.equal(r.obligationId, rows[0].id);
  await assertSound(m, 'D48 clawback of matured commission');
});

test('[REGRESSION D48] partial: part from this membership’s pending, the rest an OPEN incident for exactly the unpaid amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembershipWithReferral(m);
  await seedPtOtherEarnings(m, f, '400000');

  const first = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '60000', `REFERRAL_CLAWBACK:${f.membershipId}:a`));
  assert.deepEqual([first.paid, first.unpaid], ['60000.00', '0.00']);
  const second = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '80000', `REFERRAL_CLAWBACK:${f.membershipId}:b`));

  assert.deepEqual([second.owed, second.paid, second.unpaid], ['80000.00', '40000.00', '40000.00']);
  const after = await snap(m, f);
  assert.equal(after.ptPending, '0.00');
  assert.equal(after.ptAvailable, '400000.00');
  assert.equal(after.gymPending, '900000.00', '800.000 + the 60.000 + 40.000 that were reclaimed (the 40.000 unpaid is not invented)');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  await assertSound(m, 'D48 partial clawback');
});

test('[REGRESSION D48] retry with the same key replays the stored result: one effect, one obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembershipWithReferral(m);
  await matureMembership(m, f);
  const first = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '100000'));
  const afterFirst = await snap(m, f);

  const second = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '100000'));

  assert.deepEqual(second, first);
  assert.deepEqual(await snap(m, f), afterFirst);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  await assertSound(m, 'D48 clawback replay');
});

test('[REGRESSION D48] concurrent identical clawbacks (Promise.all) have exactly one effect', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // Pending commission: reclaimed exactly once.
  const f = await seedMembershipWithReferral(m);
  const rs = await Promise.all([1, 2, 3, 4].map(() => m.membership.clawbackMembershipReferral(clawArgs(m, f, '100000'))));
  for (const r of rs) assert.deepEqual(r, rs[0]);
  assert.equal((await snap(m, f)).gymPending, '900000.00', 'returned to the gym pending once, not four times');
  assert.equal((await snap(m, f)).ptPending, '0.00');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);

  // Matured commission: exactly one incident.
  const g = await seedMembershipWithReferral(m);
  await matureMembership(m, g);
  const rs2 = await Promise.all([1, 2, 3].map(() => m.membership.clawbackMembershipReferral(clawArgs(m, g, '100000'))));
  for (const r of rs2) assert.deepEqual(r, rs2[0]);
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { transactionId: g.txnId } }), 1);
  await assertSound(m, 'D48 concurrent clawbacks');
});

test('[REGRESSION D48] a zero clawback is a no-op: nothing written, no obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembershipWithReferral(m);
  const before = await snap(m, f);
  const r = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '0'));
  assert.deepEqual(r, { recovered: '0.00', shortfall: '0.00' });
  assert.deepEqual(await snap(m, f), before);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertSound(m, 'D48 zero clawback');
});

test('[REGRESSION D48] the clawback never reaches a neighbouring membership’s commission held by the same PT', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await seedMembershipWithReferral(m);
  await matureMembership(m, a); // A's commission is AVAILABLE now
  // Build a second membership referred by the SAME PT.
  const suffix = randomUUID().slice(0, 8);
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: `client-${suffix}`, purpose: 'GYM_MEMBERSHIP', amount: 1_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`, idempotencyKey: `membership-${suffix}`, relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: `membership-${suffix}`, sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id, price: D(m, 1_000_000), rates: { platformRate: D(m, '0.10'), ptRate: D(m, 0), gymRate: D(m, '0.90') },
    parties: { ptUserId: `gym2-${suffix}`, gymId: `gym2-${suffix}`, clientUserId: `client-${suffix}` }, label: `membership ${suffix}`,
  });
  await m.membership.settleMembershipReferral({
    transactionId: txn.id, gymId: `gym2-${suffix}`, ptUserId: a.ptUserId, amount: D(m, 100_000), label: 'referral 2',
    idempotencyKey: `MEMBERSHIP_REFERRAL:membership-${suffix}`,
  });
  const ptBefore = await m.ledger.readWallet('PT', a.ptUserId);
  assert.equal(ptBefore.pendingBalance, '100000.00', "the neighbour's commission is pending in the same PT wallet bucket");
  assert.equal(ptBefore.availableBalance, '100000.00');

  const r = await m.membership.clawbackMembershipReferral(clawArgs(m, a, '100000'));

  assert.equal(r.paid, '0.00', "A's own pending is gone; the neighbour's pending / the PT's available are not A's to give");
  const ptAfter = await m.ledger.readWallet('PT', a.ptUserId);
  assert.equal(ptAfter.pendingBalance, '100000.00');
  assert.equal(ptAfter.availableBalance, '100000.00');
  await assertSound(m, 'D48 neighbour membership untouched');
});

test('LEDGER_STRICT_OWN_FUNDS=false (emergency rollback only) restores the legacy pooled draw and receivable', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.LEDGER_STRICT_OWN_FUNDS;
  process.env.LEDGER_STRICT_OWN_FUNDS = 'false';
  try {
    const f = await seedMembershipWithReferral(m);
    await matureMembership(m, f);
    await seedPtOtherEarnings(m, f, '50000'); // PT has 150.000 AVAILABLE in total
    const r = await m.membership.clawbackMembershipReferral(clawArgs(m, f, '200000'));
    assert.equal(r.recovered, '150000.00', 'legacy: pooled AVAILABLE drawn');
    assert.equal(r.shortfall, '50000.00');
    assert.equal(await m.prisma.partnerReceivable.count({ where: { partnerId: f.ptUserId } }), 1, 'legacy: PT debt booked');
    assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
    await m.reconcile.assertInvariant('legacy clawback');
  } finally {
    if (prev === undefined) delete process.env.LEDGER_STRICT_OWN_FUNDS;
    else process.env.LEDGER_STRICT_OWN_FUNDS = prev;
  }
});
