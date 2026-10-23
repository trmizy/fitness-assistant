/**
 * [REGRESSION D48] DQ-1 S - the membership referral commission settlement runs on the own-funds model.
 *
 * Before: settleMembershipReferral moved what the membership's gym pending held and, when that was short, called
 * coverShortfall: the platform fronted the rest, booked a PartnerReceivable (a gym debt) and credited the PT in full.
 * Now: only the gym's pending for THIS membership's transaction moves; the PT's unpaid commission is a durable,
 * idempotent OPEN OVER_RELEASED incident in contract_unpaid_obligations (party PT, owed = the commission, paid = what
 * moved) - no PartnerReceivable, no platform fronting, no pooled draw. There is no flag that restores the old
 * platform fronting.
 *
 * BACKEND INTEGRATION (real ledger, isolated *_test database). Run THIS FILE ALONE (it TRUNCATEs the ledger):
 *   DATABASE_URL=".../gymcoach_payment_g6_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     npx tsx --test src/__tests__/membership-referral-settle-own-funds.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { HOSTILE_FLAG_VALUES, withRemovedFlag } from './support/d48-flag';
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
}

/** A paid, settled membership (gym pending 900.000, platform pending 100.000 for a 1.000.000 price). No referral yet. */
async function seedMembership(m: Mods, opts: { gymId?: string; ptUserId?: string; price?: number } = {}): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const gymId = opts.gymId ?? `gym-${suffix}`;
  const ptUserId = opts.ptUserId ?? `pt-${suffix}`;
  const clientId = `client-${suffix}`;
  const membershipId = `membership-${suffix}`;
  const price = opts.price ?? 1_000_000;
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
  return { txnId: txn.id, membershipId, gymId, ptUserId, clientId };
}

/** The membership ended: its pending was released to the parties' AVAILABLE, so its gym pending is now zero. */
async function matureMembership(m: Mods, f: Fixture) {
  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: null,
    refundToClient: D(m, 0), label: 'ended', idempotencyKey: `MEMBERSHIP_RELEASE:${f.membershipId}`,
  });
}

function refArgs(m: Mods, f: Fixture, amount: string, key = `MEMBERSHIP_REFERRAL:${f.membershipId}`) {
  return {
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId, amount: D(m, amount),
    label: `referral ${f.membershipId}`, idempotencyKey: key,
  };
}

async function snap(m: Mods, f: Fixture) {
  const [gym, pt, revenue] = await Promise.all([
    m.ledger.readWallet('GYM', f.gymId), m.ledger.readWallet('PT', f.ptUserId), m.wallet.getRevenueWallet(),
  ]);
  return {
    gymPending: gym.pendingBalance, gymAvailable: gym.availableBalance, ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance, revenueAvailable: revenue.availableBalance.toFixed(2),
    revenuePending: revenue.pendingBalance.toFixed(2),
  };
}

async function assertSound(m: Mods, ctx: string) {
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PartnerReceivable was created');
  const report = await m.reconcile.assertInvariant(ctx);
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
  assert.equal(report.balanced, true, 'escrow == sum of claims');
}

test('[REGRESSION D48] enough gym pending: the commission moves in full - no obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m);
  const before = await snap(m, f);

  const r = await m.membership.settleMembershipReferral(refArgs(m, f, '100000'));

  assert.deepEqual(r, { moved: '100000.00', shortfall: '0.00', owed: '100000.00', paid: '100000.00', unpaid: '0.00' });
  const after = await snap(m, f);
  assert.equal(after.gymPending, '800000.00');
  assert.equal(after.ptPending, '100000.00');
  assert.equal(after.revenueAvailable, before.revenueAvailable, 'platform fronted nothing');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertSound(m, 'D48 settle full');
});

test('[REGRESSION D48] short gym pending: partial move + exactly one OPEN obligation for the unpaid part, nothing fronted', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m); // gym pending 900.000
  const before = await snap(m, f);

  const r = await m.membership.settleMembershipReferral(refArgs(m, f, '1000000'));

  assert.equal(r.moved, '900000.00');
  assert.equal(r.paid, '900000.00');
  assert.equal(r.owed, '1000000.00');
  assert.equal(r.unpaid, '100000.00');
  assert.equal(r.shortfall, '100000.00');
  assert.ok(r.obligationId, 'obligationId returned');
  const after = await snap(m, f);
  assert.equal(after.gymPending, '0.00');
  assert.equal(after.ptPending, '900000.00', 'PT is credited only what was moved, not the unfunded 100.000');
  assert.equal(after.revenueAvailable, before.revenueAvailable, 'platform fronted nothing');
  assert.equal(after.revenuePending, before.revenuePending);
  const rows = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, r.obligationId);
  assert.equal(rows[0].kind, 'OVER_RELEASED');
  assert.equal(rows[0].party, 'PT');
  assert.equal(rows[0].status, 'OPEN');
  assert.equal(rows[0].transactionId, f.txnId);
  assert.equal(rows[0].owed.toFixed(2), '1000000.00');
  assert.equal(rows[0].paid.toFixed(2), '900000.00');
  assert.equal(rows[0].unpaid.toFixed(2), '100000.00');
  await assertSound(m, 'D48 settle partial');
});

test('[REGRESSION D48] zero gym pending: nothing moves, only an OPEN obligation for the whole commission', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m);
  await matureMembership(m, f); // gym pending for this txn = 0, gym AVAILABLE = 900.000
  const before = await snap(m, f);

  const r = await m.membership.settleMembershipReferral(refArgs(m, f, '100000'));

  assert.equal(r.moved, '0.00');
  assert.equal(r.paid, '0.00');
  assert.equal(r.owed, '100000.00');
  assert.equal(r.unpaid, '100000.00');
  assert.ok(r.obligationId);
  assert.deepEqual(await snap(m, f), before, 'no balance changed: neither the gym AVAILABLE nor the platform was touched');
  const rows = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unpaid.toFixed(2), '100000.00');
  assert.equal(rows[0].status, 'OPEN');
  await assertSound(m, 'D48 settle zero');
});

test('[REGRESSION D48] retry with the same key replays the stored result: one effect, one obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m);
  const first = await m.membership.settleMembershipReferral(refArgs(m, f, '1000000'));
  const afterFirst = await snap(m, f);

  const second = await m.membership.settleMembershipReferral(refArgs(m, f, '1000000'));

  assert.deepEqual(second, first);
  assert.deepEqual(await snap(m, f), afterFirst);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  await assertSound(m, 'D48 settle replay');
});

test('[REGRESSION D48] concurrent identical settlements (Promise.all) have exactly one effect', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m);
  const rs = await Promise.all([1, 2, 3, 4].map(() => m.membership.settleMembershipReferral(refArgs(m, f, '1000000'))));
  for (const r of rs) assert.deepEqual(r, rs[0]);
  const s = await snap(m, f);
  assert.equal(s.gymPending, '0.00');
  assert.equal(s.ptPending, '900000.00', 'moved once, not four times');
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { transactionId: f.txnId } }), 1);
  await assertSound(m, 'D48 settle concurrent');
});

test('[REGRESSION D48] a zero commission is a no-op: nothing written, no obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedMembership(m);
  const before = await snap(m, f);
  const r = await m.membership.settleMembershipReferral(refArgs(m, f, '0'));
  assert.deepEqual(r, { moved: '0.00', shortfall: '0.00' });
  assert.deepEqual(await snap(m, f), before);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertSound(m, 'D48 settle zero amount');
});

test('[REGRESSION D48] a neighbouring membership of the same gym keeps its pending; the PT and gym pooled AVAILABLE are not drawn', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await seedMembership(m);
  const b = await seedMembership(m, { gymId: a.gymId, ptUserId: a.ptUserId }); // same gym wallet, same PT
  await matureMembership(m, a); // A: gym pending 0 (gym AVAILABLE 900.000); B: gym pending 900.000 untouched
  const gymBefore = await m.ledger.readWallet('GYM', a.gymId);
  assert.equal(gymBefore.pendingBalance, '900000.00', "B's pending is the only pending left in the pooled gym bucket");
  assert.equal(gymBefore.availableBalance, '900000.00');

  const r = await m.membership.settleMembershipReferral(refArgs(m, a, '100000'));

  assert.equal(r.paid, '0.00', "A's own pending is gone; B's pending / the gym's AVAILABLE are not A's to give");
  assert.equal(r.unpaid, '100000.00');
  const gymAfter = await m.ledger.readWallet('GYM', a.gymId);
  assert.equal(gymAfter.pendingBalance, '900000.00', "B's pending untouched");
  assert.equal(gymAfter.availableBalance, '900000.00', 'gym pooled AVAILABLE untouched');
  assert.equal((await m.ledger.readWallet('PT', a.ptUserId)).pendingBalance, '0.00');
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { transactionId: b.txnId } }), 0);
  // B can still pay its own commission in full afterwards.
  const rb = await m.membership.settleMembershipReferral(refArgs(m, b, '100000'));
  assert.equal(rb.paid, '100000.00');
  assert.equal(rb.unpaid, '0.00');
  await assertSound(m, 'D48 settle neighbour');
});

test('[REGRESSION D48-INVARIANT] LEDGER_STRICT_OWN_FUNDS=false / garbage is inert: a referral commission settle is still own-funds only - no platform fronting, no PartnerReceivable, OPEN incident', skipOpts, async () => {
  const m = await load();
  for (const value of HOSTILE_FLAG_VALUES) {
    await withRemovedFlag(value, async () => {
      const tag = `flag=${JSON.stringify(value)}`;
      await resetLedger(m);
      const f = await seedMembership(m);
      // Give the platform plenty of REVENUE AVAILABLE: the legacy path would have fronted the gap with it.
      const revenue = await m.wallet.getRevenueWallet();
      const escrow = await m.wallet.getEscrowWallet();
      await m.wallet.withWallets([revenue.id, escrow.id], f.txnId, async (ops) => {
        await ops.credit(revenue.id, D(m, 200_000), 'seed - platform revenue', 'AVAILABLE');
        await ops.credit(escrow.id, D(m, 200_000), 'seed - escrow');
      });
      const r = await m.membership.settleMembershipReferral(refArgs(m, f, '1000000'));
      assert.deepEqual([r.moved, r.shortfall, r.paid, r.unpaid], ['900000.00', '100000.00', '900000.00', '100000.00'], tag);
      assert.ok(r.obligationId, tag);
      assert.equal((await m.ledger.readWallet('PT', f.ptUserId)).pendingBalance, '900000.00', `${tag}: PT credited only what the membership funded`);
      assert.equal((await m.prisma.wallet.findUniqueOrThrow({ where: { id: revenue.id } })).availableBalance.toFixed(2), '200000.00', `${tag}: REVENUE AVAILABLE untouched`);
      assert.equal(await m.prisma.partnerReceivable.count(), 0, `${tag}: no PartnerReceivable`);
      assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { status: 'OPEN', kind: 'OVER_RELEASED', party: 'PT' } }), 1, tag);
      await assertSound(m, `D48 invariant settle ${tag}`);
    });
  }
});
