/**
 * FH-1 follow-up - the whole-dong rounding of an exit must never leak into the client's refund.
 *
 * Evidence label: BACKEND INTEGRATION (real ledger, isolated *_test database). Property style: many price / total /
 * used / unresolved / no-show / reason / rate combinations (including 15.000.000 / 7 and 1.000.000 / 3, the shapes whose
 * per-session value is not a whole number of dong). For EACH combination, on a real paid contract that really delivered
 * `used` sessions and compensated `noShows` no-shows:
 *   - the preview (buildMoneyBreakdown, what money-breakdown returns) quotes exactly what terminateContract credits;
 *   - paid = owed, unpaid = 0, no contract_unpaid_obligations row, no PartnerReceivable, no OVER_RELEASED incident;
 *   - the amount held for unresolved sessions equals the preview's;
 *   - the books are sound (escrow = every claim, no negative wallet, every bucket explained by its rows);
 *   - resolving every held session afterwards (half DELIVERED, half NOT_DELIVERED) leaves nothing pending, no obligation
 *     and sound books.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fha_b_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh-rounding-exit-property.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = {
  skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  money: typeof import('../services/contract-money');
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
      money: await import('../services/contract-money'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Reason = import('../services/contract-money').TerminationReason;

interface Combo {
  price: number;
  total: number;
  used: number;
  noShows: number;
  unresolved: number;
  reason: Reason;
  gym: boolean;
  /** D77: how many of the `used` sessions had a late arrival (compensation deducted from that session's release). */
  lateSettled?: number;
  /** D77: how many of the `unresolved` sessions had a late arrival before the exit. */
  lateOpen?: number;
}

const REASONS: Reason[] = ['CLIENT_CANCELLED', 'MUTUAL', 'PT_CANCELLED', 'PT_REPEATED_NO_SHOW', 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION', 'EXPIRED', 'COMPLETED'];
const PRICES = [1_000_000, 1_000_003, 15_000_000, 999_999, 7_777_777, 1_234_567, 5_000_000, 3_333_333];
const TOTALS = [3, 7, 10, 12, 30];

/** Deterministic pseudo-random sampler (mulberry32) so a failing combination can be replayed. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function combos(): Combo[] {
  const out: Combo[] = [];
  // the shapes named in the report, every unresolved count, with and without a gym
  for (const [price, total] of [[15_000_000, 7], [1_000_000, 3], [1_000_003, 3]] as const) {
    for (const gym of [false, true]) {
      for (let used = 0; used < total; used++) {
        for (let unresolved = 0; unresolved <= Math.min(3, total - used); unresolved++) {
          out.push({ price, total, used, noShows: 0, unresolved, reason: 'CLIENT_CANCELLED', gym });
        }
      }
    }
  }
  // D77: late arrivals on released and on held sessions, the named shapes included
  for (const [price, total] of [[15_000_000, 7], [1_000_003, 3], [1_000_000, 3]] as const) {
    for (const gym of [false, true]) {
      out.push({ price, total, used: 2, noShows: 0, unresolved: 1, reason: 'CLIENT_CANCELLED', gym, lateSettled: 1, lateOpen: 1 });
      out.push({ price, total, used: 1, noShows: 0, unresolved: 1, reason: 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION', gym, lateSettled: 1, lateOpen: 0 });
      out.push({ price, total, used: 0, noShows: 0, unresolved: 2, reason: 'MUTUAL', gym, lateSettled: 0, lateOpen: 2 });
    }
  }
  // a random sweep over everything else
  const r = rng(20261019);
  for (let i = 0; i < 90; i++) {
    const price = PRICES[Math.floor(r() * PRICES.length)];
    const total = TOTALS[Math.floor(r() * TOTALS.length)];
    const noShows = r() < 0.3 ? 1 : 0;
    const used = Math.floor(r() * (total - noShows));
    const unresolved = Math.floor(r() * Math.min(4, total - used - noShows + 1));
    const lateSettled = r() < 0.3 ? Math.min(used, 1 + Math.floor(r() * 2)) : 0;
    const lateOpen = r() < 0.3 ? Math.min(unresolved, 1 + Math.floor(r() * 2)) : 0;
    out.push({ price, total, used, noShows, unresolved, reason: REASONS[Math.floor(r() * REASONS.length)], gym: r() < 0.5, lateSettled, lateOpen });
  }
  return out;
}

async function assertBooksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  const mismatched = await m.prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT w.id FROM wallets w
      CROSS JOIN (VALUES ('PENDING'), ('AVAILABLE'), ('LOCKED')) AS b(bucket)
      LEFT JOIN wallet_ledger_entries e ON e.wallet_id = w.id AND e.bucket::text = b.bucket
     GROUP BY w.id, b.bucket, w.pending_balance, w.available_balance, w.locked_balance
    HAVING COALESCE(SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)
           <> CASE b.bucket WHEN 'PENDING' THEN w.pending_balance WHEN 'LOCKED' THEN w.locked_balance ELSE w.available_balance END`);
  assert.equal(mismatched.length, 0, `${context}: every bucket balance is explained by its ledger rows`);
  const overdrawn = await m.prisma.$queryRawUnsafe<{ owner: string }[]>(`
    SELECT w.owner_type::text || ' ' || w.owner_id AS owner
      FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
     WHERE e.bucket::text = 'PENDING'
     GROUP BY w.owner_type, w.owner_id, e.transaction_id
    HAVING SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END) < 0`);
  assert.deepEqual(overdrawn, [], `${context}: no transaction took more pending out of a wallet than it put in`);
}

async function runCombo(m: Mods, c: Combo) {
  const D = (v: string | number) => new m.Prisma.Decimal(v);
  const tag = `${c.price}/${c.total} used ${c.used} noShows ${c.noShows} unresolved ${c.unresolved} ${c.reason} ${c.gym ? 'gym' : 'no gym'}${c.lateSettled ? ` lateSettled ${c.lateSettled}` : ''}${c.lateOpen ? ` lateOpen ${c.lateOpen}` : ''}`;
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, gymId: c.gym ? `gym-${suffix}` : null, clientUserId: `client-${suffix}` };
  const rates = c.gym
    ? { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') }
    : { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const price = D(c.price);
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId, purpose: 'PT_CONTRACT', amount: c.price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`, idempotencyKey: `checkout-${suffix}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: `contract-${suffix}`, activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({ transactionId: txn.id, price, rates, parties, label: `P ${suffix}` });

  const released = { pt: D(0), gym: D(0), platform: D(0) };
  for (let i = 0; i < c.used; i++) {
    if (i < (c.lateSettled ?? 0)) {
      const l = await m.ledger.compensateLateArrival({
        transactionId: txn.id, price, totalSessions: c.total, rates, parties, label: `P ${suffix} late${i}`, idempotencyKey: `PT_LATE_ARRIVAL:${suffix}:${i}`,
      });
      assert.equal(l.unpaid, '0.00', `${tag}: the late compensation was funded`);
    }
    const r = await m.ledger.releaseSession({
      transactionId: txn.id, price, totalSessions: c.total, rates, parties, label: `P ${suffix} s${i}`, idempotencyKey: `SESSION_RELEASE:${suffix}:${i}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.gym = released.gym.plus(r.released.gym);
    released.platform = released.platform.plus(r.released.platform);
  }
  let compCash = D(0);
  for (let i = 0; i < c.noShows; i++) {
    const r = await m.ledger.compensateNoShow({
      transactionId: txn.id, price, totalSessions: c.total, rates, parties, label: `P ${suffix} ns${i}`, idempotencyKey: `PT_NO_SHOW:${suffix}:${i}`,
    });
    assert.equal(r.unpaid, '0.00', `${tag}: the no-show was funded`);
    compCash = compCash.plus(r.paid);
  }

  for (let j = 0; j < (c.lateOpen ?? 0); j++) {
    const l = await m.ledger.compensateLateArrival({
      transactionId: txn.id, price, totalSessions: c.total, rates, parties, label: `P ${suffix} lateu${j}`, idempotencyKey: `PT_LATE_ARRIVAL:${suffix}:u${j}`,
    });
    assert.equal(l.unpaid, '0.00', `${tag}: the late compensation of a held session was funded`);
  }
  const lateArrival = await m.ledger.loadLateArrivalDeductions(m.prisma, txn.id, c.unresolved);
  const input = { price, totalSessions: c.total, usedSessions: c.used, compensatedSessions: c.noShows, unresolvedSessions: c.unresolved, rates, lateArrival };
  const preview = m.money.buildMoneyBreakdown(input, c.reason);
  const clientBefore = (await m.wallet.getOrCreateWallet('CLIENT', parties.clientUserId)).availableBalance;

  const out = await m.ledger.terminateContract({
    transactionId: txn.id, price, totalSessions: c.total, usedSessions: c.used, compensatedSessions: c.noShows, unresolvedSessions: c.unresolved,
    rates, reason: c.reason, alreadyReleased: released, parties, label: `P ${suffix} end`, idempotencyKey: `CONTRACT_TERMINATE:${suffix}`,
  });

  const clientAfter = (await m.wallet.getOrCreateWallet('CLIENT', parties.clientUserId)).availableBalance;
  assert.equal(out.refund, preview.refundIfCancelledNow, `${tag}: preview == refund returned`);
  assert.equal(clientAfter.minus(clientBefore).toFixed(2), preview.refundIfCancelledNow, `${tag}: preview == credited to the client`);
  assert.deepEqual([out.owed, out.paid, out.unpaid], [preview.refundIfCancelledNow, preview.refundIfCancelledNow, '0.00'], `${tag}: paid = owed, nothing unpaid`);
  assert.equal(out.obligationId, undefined, `${tag}: no obligation id`);
  assert.equal(out.overReleased, undefined, `${tag}: no over-release incident`);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0, `${tag}: no obligation row`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${tag}: no receivable`);
  if (c.unresolved > 0) assert.equal(out.unresolved?.amountHeld, preview.unresolvedAmountHeld, `${tag}: held amount == preview`);
  await assertBooksSound(m, `${tag}: after the exit`);

  // every held session is then decided; nothing may be left over or short
  for (let i = 0; i < c.unresolved; i++) {
    const res = await m.ledger.resolveUnresolvedSession({
      transactionId: txn.id, price, totalSessions: c.total, rates, parties, label: `P ${suffix} u${i}`,
      idempotencyKey: `UNRESOLVED_SESSION:${suffix}:${i < (c.lateOpen ?? 0) ? `u${i}` : i}`, outcome: i % 2 === 0 ? 'DELIVERED' : 'NOT_DELIVERED',
    });
    // The per-session split gives the platform the remainder every time, so across a contract's sessions a party's
    // releases can exceed its share of the price by a few dong (releaseSession clamps them the same way). That is the
    // only thing a resolution may report short, and it never becomes an obligation.
    assert.ok(new m.Prisma.Decimal(res.shortfall).lessThanOrEqualTo(2 * c.total), `${tag}: resolved session ${i} is short only by split dust (${res.shortfall})`);
  }
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0, `${tag}: still no obligation after resolving`);
  await assertBooksSound(m, `${tag}: after resolving`);
}

const ALL = combos();

test(`exit rounding property: ${ALL.length} price / sessions / used / unresolved / no-show / reason / rate combinations - preview == credited, no obligation, books sound`, { ...skipOpts, timeout: 1_200_000 }, async () => {
  const m = await load();
  const failures: string[] = [];
  for (const c of ALL) {
    try {
      await runCombo(m, c);
    } catch (e) {
      failures.push(`${JSON.stringify(c)} -> ${(e as Error).message.split('\n')[0]}`);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${ALL.length} combinations failed`);
});

test('the two named shapes, spelled out: 15.000.000 / 7 and 1.000.000 / 3 exit with an unresolved session', skipOpts, async () => {
  const m = await load();
  await runCombo(m, { price: 15_000_000, total: 7, used: 2, noShows: 0, unresolved: 1, reason: 'CLIENT_CANCELLED', gym: true });
  await runCombo(m, { price: 15_000_000, total: 7, used: 2, noShows: 0, unresolved: 1, reason: 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION', gym: false });
  await runCombo(m, { price: 1_000_000, total: 3, used: 1, noShows: 0, unresolved: 1, reason: 'CLIENT_CANCELLED', gym: true });
  await runCombo(m, { price: 1_000_003, total: 3, used: 1, noShows: 0, unresolved: 1, reason: 'MUTUAL', gym: true });
});
