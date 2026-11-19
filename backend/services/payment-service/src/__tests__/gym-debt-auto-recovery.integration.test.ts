/**
 * FIX3-PAY (15/11/2026) - an OPEN GYM_DEBT obligation is recovered AUTOMATICALLY from the gym's NEXT income.
 * BACKEND INTEGRATION on an isolated *_test database (real ledger services, real Postgres, serial). TEST FIXTURE for the setup only: a membership paid + refunded, the
 * gym drained by a withdrawal, then a real supplementary refund (refundMembershipAppealSupplement) that opens the GYM_DEBT; every "income" is a REAL membership release
 * (releaseMembershipPending), i.e. the pending -> available sweep. After every step the escrow/claims invariant is asserted (assertInvariant = buildReconciliationReport).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fix3pay_test" npx tsx --test --test-concurrency=1 src/__tests__/gym-debt-auto-recovery.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skip = isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.';

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  membership: typeof import('../services/membership-ledger.service');
  supplement: typeof import('../services/membership-appeal-supplement.service');
  reconcile: typeof import('../services/reconcile.service');
  recovery: typeof import('../services/gym-debt-recovery');
  withdrawal: (typeof import('../services/withdrawal.service'))['withdrawalService'];
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
      supplement: await import('../services/membership-appeal-supplement.service'),
      reconcile: await import('../services/reconcile.service'),
      recovery: await import('../services/gym-debt-recovery'),
      withdrawal: (await import('../services/withdrawal.service')).withdrawalService,
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations, withdrawal_requests RESTART IDENTITY CASCADE');
}

const D = (m: Mods, v: number | string) => new m.Prisma.Decimal(v);
const RATES = { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' };

interface Membership { txnId: string; gymId: string; clientId: string }

/** A paid + settled membership of `price`; its money is in PENDING until released. */
async function seedMembership(m: Mods, gymId: string, price: number): Promise<Membership> {
  const suffix = randomUUID().slice(0, 8);
  const clientId = `client-${suffix}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId, purpose: 'GYM_MEMBERSHIP', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY', providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `membership-${suffix}`, relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: `membership-${suffix}`, sourceService: 'integration-test',
      metadata: { rates: RATES, parties: { ptUserId: gymId, gymId, clientUserId: clientId } },
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id, price: D(m, price), rates: { platformRate: D(m, '0.10'), ptRate: D(m, 0), gymRate: D(m, '0.90') },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId }, label: `membership ${suffix}`,
  });
  await m.prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'PAID' } });
  return { txnId: txn.id, gymId, clientId };
}

/** The pending -> available sweep of one membership: the gym receives 90 % of what is not refunded as AVAILABLE income. Returns the key so a test can replay it. */
async function release(m: Mods, mem: Membership, refund = 0, key = `MEMBERSHIP_RELEASE:${randomUUID()}`) {
  await m.membership.releaseMembershipPending({
    transactionId: mem.txnId, gymId: mem.gymId, clientId: mem.clientId, ptUserId: null, refundToClient: D(m, refund), label: `rel ${mem.txnId.slice(0, 8)}`, idempotencyKey: key,
  });
  return key;
}
async function income(m: Mods, gymId: string, price: number) {
  const mem = await seedMembership(m, gymId, price);
  const key = await release(m, mem);
  return { mem, key };
}

async function readGym(m: Mods, gymId: string) {
  const w = await m.ledger.readWallet('GYM', gymId);
  return w.availableBalance;
}
async function revenue(m: Mods) {
  return (await m.wallet.getRevenueWallet()).availableBalance.toFixed(2);
}
async function obligations(m: Mods) {
  return m.prisma.contractUnpaidObligation.findMany({ where: { kind: 'GYM_DEBT' }, orderBy: { createdAt: 'asc' }, include: { events: { orderBy: { createdAt: 'asc' } } } });
}
async function gymWithdraws(m: Mods, gymId: string, txnId: string, amount: number) {
  const [gym, escrow] = await Promise.all([m.wallet.getOrCreateWallet('GYM', gymId), m.wallet.getEscrowWallet()]);
  await m.wallet.withWallets([gym.id, escrow.id], txnId, async (ops) => {
    await ops.debit(gym.id, D(m, amount), 'test withdrawal');
    await ops.debit(escrow.id, D(m, amount), 'test withdrawal');
  });
}
async function supplement(m: Mods, mem: Membership, amount: number) {
  return m.supplement.refundMembershipAppealSupplement({
    transactionId: mem.txnId, gymId: mem.gymId, clientId: mem.clientId, amount: D(m, amount), label: `Membership ${mem.txnId} appeal supplement`, idempotencyKey: `GYM_CASE_APPEAL_SUPPLEMENT:${randomUUID()}`,
  });
}

/**
 * Base state: gym G holds 333,000 after the original 630,000 refund of a 1,000,000 membership; the platform holds 37,000 + 100,000 (a separate membership of another gym
 * released in full: +10 % of its price, so REVENUE can front a gym shortfall). The gym then withdraws down to 13,000.
 */
async function baseline(m: Mods) {
  await reset(m);
  const gymId = `gym-${randomUUID().slice(0, 8)}`;
  const original = await seedMembership(m, gymId, 1_000_000);
  await release(m, original, 630_000);
  await income(m, `other-gym-${randomUUID().slice(0, 6)}`, 1_000_000);
  await gymWithdraws(m, gymId, original.txnId, 320_000);
  assert.equal(await readGym(m, gymId), '13000.00');
  await m.reconcile.assertInvariant('baseline');
  return { gymId, original };
}

test('PARTIAL recovery over two payouts, then the third payout closes the debt; every step balanced, the gym wallet is never negative', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  const rev0 = D(m, await revenue(m));

  const s = await supplement(m, original, 40_000); // gym share 36,000: gym had 13,000 -> debt 23,000, fronted by REVENUE
  assert.equal(s.gymShortfall, '23000.00');
  assert.equal(await readGym(m, gymId), '0.00');
  const revAfterSupplement = D(m, await revenue(m));
  assert.equal(rev0.minus(revAfterSupplement).toFixed(2), '27000.00', 'platform paid its 4,000 share + fronted 23,000');
  await m.reconcile.assertInvariant('after supplement');
  let [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.owed.toFixed(2), ob.paid.toFixed(2), ob.unpaid.toFixed(2)], ['OPEN', '36000.00', '13000.00', '23000.00']);

  // payout 1: a 10,000 membership -> gym earns 9,000 -> ALL of it repays the platform
  await income(m, gymId, 10_000);
  assert.equal(await readGym(m, gymId), '0.00', 'the whole 9,000 went to the debt, the wallet is not negative');
  assert.equal(D(m, await revenue(m)).minus(revAfterSupplement).toFixed(2), '10000.00', 'REVENUE: +1,000 own commission +9,000 repaid');
  [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.paid.toFixed(2), ob.unpaid.toFixed(2)], ['OPEN', '22000.00', '14000.00']);
  assert.equal(ob.events.length, 1);
  assert.deepEqual(
    [ob.events[0].action, ob.events[0].actor, ob.events[0].paidAmount?.toFixed(2), ob.events[0].unpaidAfter?.toFixed(2), ob.events[0].toStatus],
    ['RECOVER_FROM_INCOME', 'SYSTEM:GYM_DEBT_AUTO_RECOVERY', '9000.00', '14000.00', 'OPEN'],
  );
  await m.reconcile.assertInvariant('after payout 1');

  // payout 2: another 9,000
  await income(m, gymId, 10_000);
  assert.equal(await readGym(m, gymId), '0.00');
  [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.paid.toFixed(2), ob.unpaid.toFixed(2), ob.events.length], ['OPEN', '31000.00', '5000.00', 2]);
  await m.reconcile.assertInvariant('after payout 2');

  // payout 3: 9,000 -> only the remaining 5,000 is taken, the gym keeps 4,000, the debt closes
  await income(m, gymId, 10_000);
  assert.equal(await readGym(m, gymId), '4000.00', 'never more than what is owed');
  [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.paid.toFixed(2), ob.unpaid.toFixed(2), ob.events.length, ob.resolvedBy], ['RESOLVED_OTHER', '36000.00', '0.00', 3, 'SYSTEM:GYM_DEBT_AUTO_RECOVERY']);
  assert.ok(ob.resolvedAt);
  assert.deepEqual([ob.events[2].toStatus, ob.events[2].paidAmount?.toFixed(2), ob.events[2].unpaidAfter?.toFixed(2)], ['RESOLVED_OTHER', '5000.00', '0.00']);
  await m.reconcile.assertInvariant('after payout 3 (closed)');

  // a 4th payout is plain income again - nothing is taken once the debt is closed
  await income(m, gymId, 10_000);
  assert.equal(await readGym(m, gymId), '13000.00');
  assert.equal((await obligations(m))[0].events.length, 3);
  await m.reconcile.assertInvariant('after payout 4');

  // the wallet history shows each recovery as its own entry (category GYM_DEBT_RECOVERED) and the summary adds up
  const gymWallet = await m.wallet.getOrCreateWallet('GYM', gymId);
  const entries = await m.prisma.walletLedgerEntry.findMany({ where: { walletId: gymWallet.id, description: { contains: '— gym debt recovered from income' } } });
  const { classifyWalletEntry } = await import('../services/wallet-entry-category');
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.entryType === 'DEBIT' && e.bucket === 'AVAILABLE' && classifyWalletEntry({ description: e.description, entryType: e.entryType }) === 'GYM_DEBT_RECOVERED'));
  assert.equal(entries.reduce((acc, e) => acc.plus(e.amount), D(m, 0)).toFixed(2), '23000.00');
  const sum = await m.recovery.gymDebtSummary(m.prisma, gymId);
  assert.deepEqual([sum.openUnpaid, sum.recoveredTotal, sum.recent.length, sum.recent[0].amount], ['0.00', '23000.00', 3, '5000.00']);
});

test('REPLAY of the same income operation recovers nothing twice', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  await supplement(m, original, 40_000); // debt 23,000
  const mem = await seedMembership(m, gymId, 10_000);
  const key = await release(m, mem);
  const snap = async () => JSON.stringify([await readGym(m, gymId), await revenue(m), (await obligations(m)).map((o) => [o.paid.toFixed(2), o.unpaid.toFixed(2), o.events.length])]);
  const before = await snap();
  const entriesBefore = await m.prisma.walletLedgerEntry.count();
  await release(m, mem, 0, key); // the same business key again (the sweep retrying)
  await release(m, mem, 0, key);
  assert.equal(await snap(), before);
  assert.equal(await m.prisma.walletLedgerEntry.count(), entriesBefore, 'no ledger row is written by a replay');
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count({ where: { action: 'RECOVER_FROM_INCOME' } }), 1);
  await m.reconcile.assertInvariant('after replays');
});

test('MULTIPLE debts are repaid oldest first; a payout that covers the first and part of the second', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  await supplement(m, original, 40_000); // debt A: 23,000 (gym had 13,000 of its 36,000)
  await supplement(m, original, 20_000); // debt B: 18,000 (gym had 0)
  const obs = await obligations(m);
  assert.deepEqual(obs.map((o) => o.unpaid.toFixed(2)), ['23000.00', '18000.00']);
  await m.reconcile.assertInvariant('two debts open');

  await income(m, gymId, 40_000); // gym earns 36,000: 23,000 -> A (closes), 13,000 -> B
  const [a, b] = await obligations(m);
  assert.deepEqual([a.status, a.unpaid.toFixed(2), a.events.length], ['RESOLVED_OTHER', '0.00', 1], 'oldest first, closed');
  assert.deepEqual([b.status, b.paid.toFixed(2), b.unpaid.toFixed(2), b.events.length], ['OPEN', '13000.00', '5000.00', 1]);
  assert.equal(await readGym(m, gymId), '0.00');
  await m.reconcile.assertInvariant('after the first payout');

  await income(m, gymId, 20_000); // gym earns 18,000: 5,000 -> B (closes), the gym keeps 13,000
  const [, b2] = await obligations(m);
  assert.deepEqual([b2.status, b2.unpaid.toFixed(2)], ['RESOLVED_OTHER', '0.00']);
  assert.equal(await readGym(m, gymId), '13000.00');
  await m.reconcile.assertInvariant('after the second payout');
});

test('WITHDRAWAL: income is net of the debt automatically; a debt being collected by hand is kept out of the withdrawable amount (net rule, not a blanket block)', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  await supplement(m, original, 40_000); // debt 23,000

  // (a) automatic path: income 90,000 -> 23,000 repays, the gym can withdraw exactly its remaining 67,000
  await income(m, gymId, 100_000);
  assert.equal(await readGym(m, gymId), '67000.00');
  await assert.rejects(() => m.withdrawal.requestWithdrawal('GYM', gymId, '67001', 'bank'), (e: any) => e.code === 'EXCEEDS_WITHDRAWABLE_BALANCE');
  const ok = await m.withdrawal.requestWithdrawal('GYM', gymId, '67000', 'bank');
  assert.equal(ok.status, 'PENDING');
  await m.reconcile.assertInvariant('after withdrawal request');

  // (b) a debt in the manual lifecycle (AWAITING_EVIDENCE) is NOT auto-recovered, so the money lands in AVAILABLE - the withdrawal rule must keep the debt out of reach
  const second = await baseline(m);
  await supplement(m, second.original, 40_000);
  await m.prisma.contractUnpaidObligation.updateMany({ where: { kind: 'GYM_DEBT' }, data: { status: 'AWAITING_EVIDENCE' } });
  await income(m, second.gymId, 100_000); // gym earns 90,000, none recovered
  assert.equal(await readGym(m, second.gymId), '90000.00');
  assert.equal((await obligations(m))[0].events.length, 0, 'in-flight manual collection: no automatic recovery');
  await assert.rejects(
    () => m.withdrawal.requestWithdrawal('GYM', second.gymId, '67001', 'bank'),
    (e: any) => e.code === 'EXCEEDS_WITHDRAWABLE_BALANCE' && /nợ nền tảng 23\.000đ/.test(e.message),
  );
  const ok2 = await m.withdrawal.requestWithdrawal('GYM', second.gymId, '67000', 'bank');
  assert.equal(ok2.status, 'PENDING');
  await m.reconcile.assertInvariant('after net-rule withdrawal');
});

test('A gym WITHOUT a debt is untouched (no recovery row, no event)', { skip }, async () => {
  const m = await load();
  await reset(m);
  const gymId = `gym-${randomUUID().slice(0, 8)}`;
  await income(m, gymId, 100_000);
  assert.equal(await readGym(m, gymId), '90000.00');
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 0);
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { description: { contains: 'gym debt recovered' } } }), 0);
  await m.reconcile.assertInvariant('no debt');
});

test('Another gym income never repays this gym debt', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  await supplement(m, original, 40_000);
  await income(m, `unrelated-${randomUUID().slice(0, 6)}`, 100_000);
  const [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.unpaid.toFixed(2), ob.events.length], ['OPEN', '23000.00', 0]);
  assert.equal(await readGym(m, gymId), '0.00');
  await m.reconcile.assertInvariant('unrelated income');
});

test('A REJECTED withdrawal that is restored to AVAILABLE repays the open debt first (every AVAILABLE credit path recovers)', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  const req = await m.withdrawal.requestWithdrawal('GYM', gymId, '10000', 'bank'); // gym 13,000 -> asks 10,000
  await m.withdrawal.approve(req.id, 'admin-1'); // 10,000 moves to LOCKED, 3,000 stays AVAILABLE
  await supplement(m, original, 40_000); // gym share 36,000; it can fund only the 3,000 left -> debt 33,000
  assert.equal(await readGym(m, gymId), '0.00');
  await m.withdrawal.reject(req.id, 'admin-1', 'test: restore the locked money');
  assert.equal(await readGym(m, gymId), '0.00', 'the restored 10,000 went to the debt');
  const [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.paid.toFixed(2), ob.unpaid.toFixed(2), ob.events.length], ['OPEN', '13000.00', '23000.00', 1]);
  await m.reconcile.assertInvariant('after restored withdrawal');
});

test('CONCURRENT incomes of one gym: both recover, nothing is double-taken, no deadlock', { skip }, async () => {
  const m = await load();
  const { gymId, original } = await baseline(m);
  await supplement(m, original, 40_000); // debt 23,000
  await Promise.all([income(m, gymId, 10_000), income(m, gymId, 10_000), income(m, gymId, 10_000)]); // 3 x 9,000 = 27,000 of income
  const [ob] = await obligations(m);
  assert.deepEqual([ob.status, ob.unpaid.toFixed(2)], ['RESOLVED_OTHER', '0.00']);
  assert.equal(await readGym(m, gymId), '4000.00', '27,000 income - 23,000 debt');
  assert.equal(ob.events.reduce((a, e) => a.plus(e.paidAmount ?? 0), D(m, 0)).toFixed(2), '23000.00');
  await m.reconcile.assertInvariant('after concurrent incomes');
});
