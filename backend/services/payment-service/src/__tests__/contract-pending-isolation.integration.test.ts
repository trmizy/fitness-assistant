/**
 * One contract's money operations must only ever move THAT contract's money.
 *
 * Why this file exists. A PT, a gym and the platform's REVENUE account each have ONE wallet,
 * and its PENDING bucket pools the not-yet-earned money of every contract that party is
 * running — plus, for a gym, its memberships, and for a PT, any membership referral
 * commission. terminateContract used to read that bucket with ops.balance(walletId, 'PENDING')
 * — the whole wallet — and "drain whatever is left": ending contract A emptied the PT's, the
 * gym's and the platform's pending for every OTHER contract and membership too, and booked
 * everything beyond A's own refund to REVENUE as a "forfeited share". releaseSession,
 * compensateNoShow, compensateLateArrival and the personalized-service ledger read the same
 * pooled figure. The system invariant (escrow = every claim on it) cannot see any of this —
 * the money only changed owner, it never left — which is why no sibling suite caught it.
 *
 * So nothing here stops at assertInvariant. Every scenario puts a second, unrelated holder of
 * pending money in the same wallets and asserts on REAL ledger rows and wallet balances:
 *
 *  · differential — contract A's postings, results and wallet deltas while it shares its
 *    wallets must be exactly what they are when A is the only contract in the database (the
 *    single-contract behaviour is what the sibling suites already pin);
 *  · absolute — the neighbours' pending is still in the wallet afterwards, to the đồng, and
 *    they go on to release and settle correctly.
 *
 * Every operation of a contract runs under the contract's own payment transaction id, exactly
 * as user-service's contract-payout.service.ts calls it (`contract.paymentTransactionId` for
 * settle, release, no-show, late arrival and terminate). That id is what the ledger now scopes
 * "this contract's pending" by, so a test that invented a fresh id per call would not be
 * exercising the production path.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables, like its siblings):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test src/__tests__/contract-pending-isolation.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  membership: typeof import('../services/membership-ledger.service');
  orders: typeof import('../services/personalized-service-ledger.service');
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
      orders: await import('../services/personalized-service-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
type Rates = import('../services/contract-money').RateTable;
type Reason = import('../services/contract-money').TerminationReason;
type OwnerType = 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';

/**
 * Every scenario starts from an empty ledger, ledger_operations included: the business keys
 * below are deterministic (the differential runs depend on identical labels), so a key left
 * behind by an earlier scenario would make the call under test replay a stale result.
 */
async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
}

function rateTable(m: Mods, platform: string, pt: string, gym: string): Rates {
  return {
    platformRate: new m.Prisma.Decimal(platform),
    ptRate: new m.Prisma.Decimal(pt),
    gymRate: new m.Prisma.Decimal(gym),
  };
}

interface Contract {
  id: string;
  /** The contract's payment transaction — every one of its ledger calls carries this id. */
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  totalSessions: number;
  rates: Rates;
  /** What user-service keeps on the Contract row, updated the way it updates it. */
  usedSessions: number;
  compensatedSessions: number;
  releasedTo: { pt: Dec; gym: Dec; platform: Dec };
  /** Makes every business key of this contract unique within a scenario. */
  seq: number;
  /** The PT holdback rate this contract carries (absent = none), sent on every call that takes it. */
  holdbackRate?: string;
}

/**
 * A contract the client has paid for: escrow holds the price, the parties' pending the split.
 * Ids are fixed by the caller, never random, so the same scenario run twice produces the same
 * ledger descriptions and wallet owners — that is what lets one run be compared to another.
 */
async function paidContract(
  m: Mods,
  o: { id: string; pt: string; gym?: string | null; price?: number; sessions?: number; holdbackRate?: string },
): Promise<Contract> {
  const gymId = o.gym ?? null;
  const price = o.price ?? 1_000_000;
  const clientUserId = `client-${o.id}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId,
      purpose: 'PT_CONTRACT',
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`,
      idempotencyKey: `checkout-${o.id}-${randomUUID()}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
    },
  });
  const c: Contract = {
    id: o.id,
    txnId: txn.id,
    parties: { ptUserId: o.pt, gymId, clientUserId },
    price: new m.Prisma.Decimal(price),
    totalSessions: o.sessions ?? 4,
    rates: gymId ? rateTable(m, '0.10', '0.55', '0.35') : rateTable(m, '0.10', '0.90', '0'),
    usedSessions: 0,
    compensatedSessions: 0,
    releasedTo: { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) },
    seq: 0,
    holdbackRate: o.holdbackRate,
  };
  await m.ledger.settleContractPayment({
    transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${c.id}`,
  });
  return c;
}

/**
 * Confirm `count` sessions. Mirrors user-service's releaseSessionMoney: the amounts the call
 * REPORTS are added to the contract's releasedTo* running totals, which termination later
 * hands back as `alreadyReleased`.
 */
async function deliver(m: Mods, c: Contract, count: number) {
  const results: Awaited<ReturnType<Mods['ledger']['releaseSession']>>[] = [];
  for (let i = 0; i < count; i++) {
    const n = ++c.seq;
    const r = await m.ledger.releaseSession({
      transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions,
      rates: c.rates, parties: c.parties, label: `Contract ${c.id} session ${c.usedSessions + 1}`,
      idempotencyKey: `SESSION_RELEASE:${c.id}:${n}`,
      ...(c.holdbackRate !== undefined ? { ptHoldbackRate: new m.Prisma.Decimal(c.holdbackRate) } : {}),
    });
    c.usedSessions++;
    c.releasedTo.pt = c.releasedTo.pt.plus(r.released.pt);
    c.releasedTo.gym = c.releasedTo.gym.plus(r.released.gym);
    c.releasedTo.platform = c.releasedTo.platform.plus(r.released.platform);
    results.push(r);
  }
  return results;
}

/** The PT missed a session: compensate the client, and count the entitlement as consumed. */
async function noShow(m: Mods, c: Contract) {
  const n = ++c.seq;
  const r = await m.ledger.compensateNoShow({
    transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions,
    rates: c.rates, parties: c.parties, label: `Contract ${c.id} no-show ${n}`,
    idempotencyKey: `PT_NO_SHOW:${c.id}:${n}`,
  });
  c.compensatedSessions++;
  return r;
}

/** The PT joined late: half a no-show's compensation, the entitlement is NOT consumed. */
async function lateArrival(m: Mods, c: Contract) {
  const n = ++c.seq;
  return m.ledger.compensateLateArrival({
    transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions,
    rates: c.rates, parties: c.parties, label: `Contract ${c.id} late arrival ${n}`,
    idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${n}`,
  });
}

/** End the contract the way user-service's terminateContractMoney does. */
async function end(m: Mods, c: Contract, reason: Reason) {
  return m.ledger.terminateContract({
    transactionId: c.txnId,
    price: c.price,
    totalSessions: c.totalSessions,
    usedSessions: c.usedSessions,
    compensatedSessions: c.compensatedSessions,
    rates: c.rates,
    reason,
    alreadyReleased: c.releasedTo,
    parties: c.parties,
    label: `Contract ${c.id} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
    ...(c.holdbackRate !== undefined ? { ptHoldbackRate: new m.Prisma.Decimal(c.holdbackRate) } : {}),
  });
}

/**
 * Gives REVENUE an available balance to front a shortfall with: an unrelated one-session
 * contract of a PT nobody else in the scenario uses, delivered. It leaves no pending behind.
 */
async function fundRevenue(m: Mods, amount: number) {
  const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: amount * 10, sessions: 1 });
  await deliver(m, funder, 1);
}

/**
 * The ledger rows whose description mentions `needle`, as readable lines, sorted. Selected by
 * description rather than by transaction id because a contract's settlement, releases,
 * compensations and termination all share ONE transaction id in production; sorted because
 * several rows share a millisecond and ids are random — what is pinned is the SET of postings.
 */
async function rowsOf(m: Mods, needle: string): Promise<string[]> {
  const rows = await m.prisma.walletLedgerEntry.findMany({
    where: { description: { contains: needle } },
    include: { wallet: true },
  });
  return rows
    .map((r) => {
      const who = r.wallet.ownerType === 'PLATFORM' ? r.wallet.ownerId : `${r.wallet.ownerType} ${r.wallet.ownerId}`;
      return `${who} ${r.entryType} ${r.bucket} ${r.amount.toFixed(2)} | ${r.description}`;
    })
    .sort();
}

async function bucketsOf(m: Mods, ownerType: OwnerType, ownerId: string) {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  return {
    pending: w.pendingBalance.toFixed(2),
    available: w.availableBalance.toFixed(2),
    locked: w.lockedBalance.toFixed(2),
  };
}

/**
 * What the LEDGER says one transaction still has pending in one wallet: its PENDING credits
 * minus its PENDING debits. Computed here from the raw rows, independently of the service's
 * own helper, so the two cannot agree by sharing a mistake.
 */
async function ledgerPending(m: Mods, ownerType: OwnerType, ownerId: string, transactionId: string): Promise<string> {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  const rows = await m.prisma.walletLedgerEntry.findMany({
    where: { walletId: w.id, transactionId, bucket: 'PENDING' },
    select: { entryType: true, amount: true },
  });
  return rows
    .reduce((sum, r) => (r.entryType === 'CREDIT' ? sum.plus(r.amount) : sum.minus(r.amount)), new m.Prisma.Decimal(0))
    .toFixed(2);
}

/**
 * Conservation, checked four ways:
 *
 *  1. The system-wide invariant of money-flow §6 (escrow = every claim on it, no negative
 *     wallet).
 *  2. Every bucket balance is fully explained by its ledger rows.
 *  3. Every posted amount and every balance is a whole number of đồng.
 *  4. No transaction has had more PENDING debited from a wallet than was ever credited to it
 *     under that same transaction. This is the fingerprint of the defect itself: a contract
 *     that reaches into a neighbour's pending does so under its OWN transaction id, so its own
 *     pending goes negative while the wallet's total stays healthy — invisible to 1–3.
 */
async function assertBooksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);

  const mismatched = await m.prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT w.id
      FROM wallets w
      CROSS JOIN (VALUES ('PENDING'), ('AVAILABLE'), ('LOCKED')) AS b(bucket)
      LEFT JOIN wallet_ledger_entries e ON e.wallet_id = w.id AND e.bucket::text = b.bucket
     GROUP BY w.id, b.bucket, w.pending_balance, w.available_balance, w.locked_balance
    HAVING COALESCE(SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)
           <> CASE b.bucket WHEN 'PENDING' THEN w.pending_balance
                            WHEN 'LOCKED' THEN w.locked_balance
                            ELSE w.available_balance END`);
  assert.equal(mismatched.length, 0, `${context}: every bucket balance is fully explained by its ledger rows`);

  const fractional = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT (SELECT COUNT(*) FROM wallet_ledger_entries WHERE amount <> TRUNC(amount))
         + (SELECT COUNT(*) FROM wallets WHERE pending_balance <> TRUNC(pending_balance)
                                            OR available_balance <> TRUNC(available_balance)
                                            OR locked_balance <> TRUNC(locked_balance)) AS n`);
  assert.equal(Number(fractional[0].n), 0, `${context}: every amount is a whole number of đồng`);

  await assertNoTransactionOverdrewPending(m, context);
}

async function assertNoTransactionOverdrewPending(m: Mods, context: string) {
  const overdrawn = await m.prisma.$queryRawUnsafe<{ owner: string; transaction_id: string; net: string }[]>(`
    SELECT w.owner_type::text || ' ' || w.owner_id AS owner, e.transaction_id,
           SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END)::text AS net
      FROM wallet_ledger_entries e
      JOIN wallets w ON w.id = e.wallet_id
     WHERE e.bucket::text = 'PENDING'
     GROUP BY w.owner_type, w.owner_id, e.transaction_id
    HAVING SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END) < 0`);
  assert.deepEqual(overdrawn, [], `${context}: no transaction took more pending out of a wallet than it ever put in`);
}

// ── The differential: A alone vs A sharing its wallets ───────────────────────

interface Plan {
  reason: Reason;
  /** Sessions of A confirmed before it ends. */
  used: number;
  /** PT no-shows compensated on A before anything else. */
  noShows?: number;
  /** PT late arrivals compensated on A before anything else. */
  lateArrivals?: number;
  withGym: boolean;
  price?: number;
  sessions?: number;
  /** A's own PT holdback rate, when the scenario is about that term. */
  holdbackRate?: string;
  /** Give REVENUE the means to front a shortfall — in BOTH worlds, so they stay comparable. */
  fundRevenue?: boolean;
}

const PT = 'pt-1';
const GYM = 'gym-1';

/**
 * Runs contract A through `plan` and returns everything it did. With `shared`, A's wallets
 * already hold other people's pending money before A is even paid for:
 *
 *  · B — the SAME PT (and the same gym, when A has one): 2.000.000đ over 8 sessions, one
 *    delivered, so B holds both released and still-pending money;
 *  · C — when A has a gym, a DIFFERENT PT at that same gym: 600.000đ over 3 sessions,
 *    untouched. The gym wallet and REVENUE hold C's pending; A's PT has nothing to do with it.
 */
async function runA(m: Mods, plan: Plan, shared: boolean) {
  await resetLedger(m);
  const gym = plan.withGym ? GYM : null;
  if (plan.fundRevenue) await fundRevenue(m, 1_000_000);

  let B: Contract | null = null;
  let C: Contract | null = null;
  if (shared) {
    B = await paidContract(m, { id: 'B', pt: PT, gym, price: 2_000_000, sessions: 8 });
    await deliver(m, B, 1);
    if (gym) C = await paidContract(m, { id: 'C', pt: 'pt-2', gym, price: 600_000, sessions: 3 });
  }

  const A = await paidContract(m, { id: 'A', pt: PT, gym, price: plan.price, sessions: plan.sessions, holdbackRate: plan.holdbackRate });
  const snapshot = async () => ({
    pt: await bucketsOf(m, 'PT', PT),
    gym: gym ? await bucketsOf(m, 'GYM', gym) : null,
    revenue: await bucketsOf(m, 'PLATFORM', 'REVENUE'),
    client: await bucketsOf(m, 'CLIENT', A.parties.clientUserId),
    escrow: await bucketsOf(m, 'PLATFORM', 'ESCROW'),
  });
  const start = await snapshot();

  const compensations: Awaited<ReturnType<Mods['ledger']['compensateNoShow']>>[] = [];
  for (let i = 0; i < (plan.noShows ?? 0); i++) compensations.push(await noShow(m, A));
  for (let i = 0; i < (plan.lateArrivals ?? 0); i++) compensations.push(await lateArrival(m, A));
  const releases = await deliver(m, A, plan.used);
  const result = await end(m, A, plan.reason);
  const finish = await snapshot();

  const diff = (a: { pending: string; available: string; locked: string }, b: typeof a) => ({
    pending: new m.Prisma.Decimal(b.pending).minus(a.pending).toFixed(2),
    available: new m.Prisma.Decimal(b.available).minus(a.available).toFixed(2),
    locked: new m.Prisma.Decimal(b.locked).minus(a.locked).toFixed(2),
  });
  const receivables = (await m.prisma.partnerReceivable.findMany({ orderBy: { createdAt: 'asc' } }))
    .map((d) => `${d.partnerType} ${d.partnerId} owes ${d.amount.toFixed(2)} | ${d.reason}`);

  return {
    A, B, C, gym,
    /** Everything A's own calls returned, in order. */
    returned: { compensations, releases, result },
    /** Every ledger row A's releases, compensations and termination wrote. */
    rows: await rowsOf(m, 'Contract A '),
    /** How far each wallet A touches moved between "A is paid for" and "A has ended". */
    moved: {
      pt: diff(start.pt, finish.pt),
      gym: start.gym && finish.gym ? diff(start.gym, finish.gym) : null,
      revenue: diff(start.revenue, finish.revenue),
      client: diff(start.client, finish.client),
      escrow: diff(start.escrow, finish.escrow),
    },
    receivables,
  };
}

/**
 * B's and C's pending money, hand-computed, as it must still stand in the shared wallets once
 * A has ended — A's own pending is gone, so what is left in each wallet is exactly this.
 *
 *   B, no gym  : 2.000.000 × 0,90 = 1.800.000 − one session (225.000) = 1.575.000 PT
 *                2.000.000 × 0,10 =   200.000 − one session ( 25.000) =   175.000 platform
 *   B, with gym: 1.100.000 − 137.500 = 962.500 PT · 700.000 − 87.500 = 612.500 gym · 175.000 platform
 *   C          :   330.000 PT (another PT's wallet) · 210.000 gym · 60.000 platform
 */
function neighboursPending(withGym: boolean) {
  return withGym
    ? { pt: '962500.00', gym: '822500.00', revenue: '235000.00', otherPt: '330000.00' }
    : { pt: '1575000.00', gym: null, revenue: '175000.00', otherPt: null };
}

/** One more session of B, after A has ended: the per-session split B was signed on. */
function sessionOfB(withGym: boolean) {
  return withGym
    ? { pt: '137500.00', gym: '87500.00', platform: '25000.00' }
    : { pt: '225000.00', gym: '0.00', platform: '25000.00' };
}

async function assertAIsContained(m: Mods, plan: Plan, context: string) {
  const solo = await runA(m, plan, false);
  await assertBooksSound(m, `${context} — A alone`);
  const shared = await runA(m, plan, true);

  // 1. A did exactly what it does when nobody else is around: same rows, same answers, same
  //    movement in every wallet it touches, same debts raised.
  assert.deepEqual(shared.rows, solo.rows, `${context}: A posts the same ledger rows whether or not it shares its wallets`);
  assert.deepEqual(shared.returned, solo.returned, `${context}: A's calls return the same figures`);
  assert.deepEqual(shared.moved, solo.moved, `${context}: A moves each wallet by the same amounts`);
  assert.deepEqual(shared.receivables, solo.receivables, `${context}: A raises the same receivables`);

  // 2. The neighbours' pending is still in the wallets, to the đồng.
  const expected = neighboursPending(plan.withGym);
  assert.equal((await bucketsOf(m, 'PT', PT)).pending, expected.pt, `${context}: the PT's pending still holds all of B's`);
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, expected.revenue, `${context}: REVENUE's pending still holds B's (and C's) commission`);
  if (plan.withGym) {
    assert.equal((await bucketsOf(m, 'GYM', GYM)).pending, expected.gym, `${context}: the gym's pending still holds B's and C's shares`);
    assert.equal((await bucketsOf(m, 'PT', 'pt-2')).pending, expected.otherPt, `${context}: the other PT's pending is untouched`);
  }
  assert.equal(await ledgerPending(m, 'PT', PT, shared.A.txnId), '0.00', `${context}: A's own PT pending is exactly spent — not overdrawn`);
  assert.equal(await ledgerPending(m, 'PLATFORM', 'REVENUE', shared.A.txnId), '0.00', `${context}: A's own platform pending is exactly spent`);
  if (plan.withGym) assert.equal(await ledgerPending(m, 'GYM', GYM, shared.A.txnId), '0.00', `${context}: A's own gym pending is exactly spent`);
  await assertBooksSound(m, `${context} — A sharing its wallets`);

  // 3. B carries on: its next session releases what B was signed on, out of B's own pending.
  const B = shared.B!;
  const before = { pt: await bucketsOf(m, 'PT', PT), revenue: await bucketsOf(m, 'PLATFORM', 'REVENUE') };
  const [next] = await deliver(m, B, 1);
  const per = sessionOfB(plan.withGym);
  assert.deepEqual(next.released, per, `${context}: B's next session reports its normal split`);
  const after = { pt: await bucketsOf(m, 'PT', PT), revenue: await bucketsOf(m, 'PLATFORM', 'REVENUE') };
  assert.equal(new m.Prisma.Decimal(before.pt.pending).minus(after.pt.pending).toFixed(2), per.pt, `${context}: and that much really left the PT's pending`);
  assert.equal(new m.Prisma.Decimal(before.revenue.pending).minus(after.revenue.pending).toFixed(2), per.platform, `${context}: and the platform's`);
  await assertBooksSound(m, `${context} — B's next session`);
}

const REASONS: Reason[] = ['CLIENT_CANCELLED', 'PT_CANCELLED', 'PT_BANNED', 'MUTUAL', 'PT_REPEATED_NO_SHOW', 'EXPIRED', 'COMPLETED'];
const USAGE: [string, number][] = [['nothing used', 0], ['1 of 4 sessions used', 1], ['all 4 sessions used', 4]];

for (const withGym of [false, true]) {
  for (const reason of REASONS) {
    for (const [usage, used] of USAGE) {
      test(`${reason}, ${usage}, ${withGym ? 'gym share (gym wallet also holds an unrelated contract)' : 'no gym'}: ending A moves only A's money`, skipOpts, async () => {
        const m = await load();
        await assertAIsContained(m, { reason, used, withGym }, `${reason}/${used}/${withGym ? 'gym' : 'no gym'}`);
      });
    }
  }
}

// ── A had a PT no-show or a late arrival before it ended ─────────────────────

for (const withGym of [false, true]) {
  const where = withGym ? 'gym share' : 'no gym';

  test(`A had a compensated PT no-show, then the client cancels (${where}): neither the compensation nor the termination reaches B`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'CLIENT_CANCELLED', used: 1, noShows: 1, withGym }, `no-show then CLIENT_CANCELLED (${where})`);
  });

  test(`A had three PT no-shows and the client ends it for PT_REPEATED_NO_SHOW (${where})`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'PT_REPEATED_NO_SHOW', used: 1, noShows: 3, withGym }, `3 no-shows then PT_REPEATED_NO_SHOW (${where})`);
  });

  test(`A had a compensated PT no-show and then ran to COMPLETED (${where})`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'COMPLETED', used: 3, noShows: 1, withGym }, `no-show then COMPLETED (${where})`);
  });

  test(`A had a compensated PT no-show and then EXPIRED with sessions unused (${where})`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'EXPIRED', used: 1, noShows: 1, withGym }, `no-show then EXPIRED (${where})`);
  });

  // A late arrival takes half a session out of A's pending WITHOUT consuming an entitlement,
  // so when A ends early its own pending is short of "refund + final shares" by exactly that
  // compensation. The single-contract rule for that gap already exists — the platform fronts
  // it and books it against the PT — and it must be the rule here too: the gap may not be
  // quietly filled from B's pending instead. REVENUE is funded in both worlds so the fronting
  // can happen.
  test(`A had a PT late arrival, then the client cancels (${where}): the gap is fronted and booked exactly as for a lone contract, not filled from B`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'CLIENT_CANCELLED', used: 1, lateArrivals: 1, withGym, fundRevenue: true }, `late arrival then CLIENT_CANCELLED (${where})`);
  });

  test(`A had a PT late arrival and then ran to COMPLETED (${where}): its last release moves only what A has left`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'COMPLETED', used: 4, lateArrivals: 1, withGym }, `late arrival then COMPLETED (${where})`);
  });

  test(`PT_CANCELLED on a contract carrying a 10% holdback (${where}): the compensation comes out of A's own held-back pending, B's pending is not the source`, skipOpts, async () => {
    const m = await load();
    await assertAIsContained(m, { reason: 'PT_CANCELLED', used: 2, withGym, holdbackRate: '0.10' }, `PT_CANCELLED with holdback (${where})`);
  });
}

test('a price that does not divide evenly (1.000.000đ over 3 sessions, gym share): rounding stays inside A', skipOpts, async () => {
  const m = await load();
  await assertAIsContained(m, { reason: 'CLIENT_CANCELLED', used: 1, withGym: true, sessions: 3 }, 'uneven price');
});

// ── The reported reproduction, row for row ───────────────────────────────────

test('the reproduction: one PT, two 1.000.000đ contracts, the client of A cancels before any session — B keeps every đồng and runs to completion', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, sessions: 10 });
  const B = await paidContract(m, { id: 'B', pt: PT, sessions: 10 });
  assert.equal((await bucketsOf(m, 'PT', PT)).pending, '1800000.00', 'the PT wallet pools both contracts');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '200000.00', 'and so does REVENUE');

  const out = await end(m, A, 'CLIENT_CANCELLED');

  // 90% of the unused 1.000.000 goes back to A's client; the other 100.000 is shared 90/10.
  // The two "pending released" rows are A's own remaining pending — 810.000 and 90.000 — not
  // the 1.710.000 and 190.000 the pooled drain used to write, and there is no "forfeited
  // share" row at all: A forfeits nothing beyond what the split already gave the platform.
  assert.deepEqual(await rowsOf(m, 'Contract A termination'), [
    `PT ${PT} DEBIT PENDING 90000.00 | Contract A termination — final settlement`,
    `PT ${PT} CREDIT AVAILABLE 90000.00 | Contract A termination — final settlement`,
    'REVENUE DEBIT PENDING 10000.00 | Contract A termination — final settlement',
    'REVENUE CREDIT AVAILABLE 10000.00 | Contract A termination — final settlement',
    `PT ${PT} DEBIT PENDING 810000.00 | Contract A termination — pending released on termination`,
    'REVENUE DEBIT PENDING 90000.00 | Contract A termination — pending released on termination',
    'CLIENT client-A CREDIT AVAILABLE 900000.00 | Contract A termination — refund (CLIENT_CANCELLED)',
  ].sort());
  assert.deepEqual(out, {
    reason: 'CLIENT_CANCELLED',
    refund: '900000.00',
    entitlement: { pt: '90000.00', gym: '0.00', platform: '10000.00' },
    topUp: { pt: '90000.00', gym: '0.00', platform: '10000.00' },
    returnedToEscrow: '900000.00',
    shortfall: '0.00',
  });
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '90000.00', locked: '0.00' }, 'B’s 900.000 is still pending');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '100000.00', available: '10000.00', locked: '0.00' }, 'B’s 100.000 commission is still pending, not revenue');
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '900000.00', 'and the ledger agrees it is B’s');
  await assertBooksSound(m, 'reproduction — A cancelled');

  // B then runs its whole life. Every session reports, and really moves, 90.000 + 10.000.
  for (let i = 1; i <= 10; i++) {
    const before = await bucketsOf(m, 'PT', PT);
    const [r] = await deliver(m, B, 1);
    assert.deepEqual(r.released, { pt: '90000.00', gym: '0.00', platform: '10000.00' }, `B session ${i} reports its split`);
    const after = await bucketsOf(m, 'PT', PT);
    assert.equal(new m.Prisma.Decimal(before.pending).minus(after.pending).toFixed(2), '90000.00', `B session ${i} really left pending`);
    assert.equal(new m.Prisma.Decimal(after.available).minus(before.available).toFixed(2), '90000.00', `B session ${i} really reached available`);
  }
  const done = await end(m, B, 'COMPLETED');
  assert.deepEqual(await rowsOf(m, 'Contract B termination'), [], 'a fully delivered contract has nothing left to post');
  assert.equal(done.shortfall, '0.00', 'B was paid in full along the way');

  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '990000.00', locked: '0.00' }, 'PT: 90.000 from A + all 900.000 of B');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '0.00', available: '110000.00', locked: '0.00' }, 'platform: 10.000 from A + 100.000 from B');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '900000.00', 'client of A: the refund');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-B')).available, '0.00', 'client of B: nothing — they used the contract');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'ESCROW')).available, '2000000.00', 'escrow never moved');
  await assertBooksSound(m, 'reproduction — B completed');
});

test('A runs to COMPLETED while B has not started: B is untouched, and B can still be cancelled for its full refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, sessions: 10 });
  const B = await paidContract(m, { id: 'B', pt: PT, sessions: 10 });
  await deliver(m, A, 10);

  const out = await end(m, A, 'COMPLETED');

  assert.deepEqual(await rowsOf(m, 'Contract A termination'), [], 'A was fully delivered and released — completing it posts nothing');
  assert.equal(out.returnedToEscrow, '0.00', 'nothing was drained');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '900000.00', locked: '0.00' }, 'A’s 900.000 earned, B’s 900.000 still pending');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '100000.00', available: '100000.00', locked: '0.00' });
  await assertBooksSound(m, 'A completed');

  // B's client changes their mind before the first session: the refund is funded entirely
  // from B's own pending, with nothing fronted by the platform and no debt for the PT.
  const cancelled = await end(m, B, 'CLIENT_CANCELLED');
  assert.equal(cancelled.refund, '900000.00');
  assert.equal(cancelled.shortfall, '0.00', 'B’s pending was all there to fund it');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-B')).available, '900000.00', 'client of B refunded in full');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '990000.00', locked: '0.00' });
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '0.00', available: '110000.00', locked: '0.00' });
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no receivable anywhere');
  await assertBooksSound(m, 'B cancelled after A completed');
});

// ── Membership money and referral commission in the same wallets ─────────────

/**
 * A gym membership, paid for and settled the way the webhook settles one: through the same
 * settleContractPayment as a contract, with the gym standing in the PT slot at ptRate 0 — so
 * 90% lands in the GYM wallet's pending and 10% in REVENUE's, under the membership's own
 * transaction id.
 */
async function paidMembership(m: Mods, o: { id: string; gym: string; price: number }) {
  const clientId = `member-${o.id}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId,
      purpose: 'GYM_MEMBERSHIP',
      amount: o.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`,
      idempotencyKey: `membership-${o.id}-${randomUUID()}`,
      relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: o.id,
      sourceService: 'integration-test',
    },
  });
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(o.price),
    rates: rateTable(m, '0.10', '0', '0.90'),
    parties: { ptUserId: o.gym, gymId: o.gym, clientUserId: clientId },
    label: `GYM_MEMBERSHIP ${o.id}`,
  });
  return { id: o.id, txnId: txn.id, gymId: o.gym, clientId };
}

for (const reason of ['CLIENT_CANCELLED', 'PT_BANNED', 'EXPIRED', 'COMPLETED'] as const) {
  test(`${reason}: a membership's pending in the gym wallet and the PT's referral commission survive the PT's contract ending, and the membership still releases in full`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);

    // Membership M at the gym: 900.000 gym + 100.000 platform pending. The PT referred the
    // member, so 100.000 of the gym's moves to the PT's pending — settleMembershipReferral,
    // the real thing. All three rows of pending sit under M's transaction id.
    const M = await paidMembership(m, { id: 'M', gym: GYM, price: 1_000_000 });
    const referral = await m.membership.settleMembershipReferral({
      transactionId: M.txnId, gymId: GYM, ptUserId: PT, amount: new m.Prisma.Decimal(100_000),
      label: 'Membership M referral', idempotencyKey: 'MEMBERSHIP_REFERRAL:M',
    });
    assert.deepEqual(referral, { moved: '100000.00', shortfall: '0.00' });

    // Contract A: the same PT at the same gym, 55/35/10, one of four sessions delivered.
    const A = await paidContract(m, { id: 'A', pt: PT, gym: GYM });
    await deliver(m, A, 1);
    assert.equal((await bucketsOf(m, 'PT', PT)).pending, '512500.00', 'PT pending: 412.500 of A + the 100.000 referral');
    assert.equal((await bucketsOf(m, 'GYM', GYM)).pending, '1062500.00', 'gym pending: 262.500 of A + 800.000 of the membership');
    assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '175000.00', 'platform pending: 75.000 of A + 100.000 of the membership');

    await end(m, A, reason);

    assert.equal((await bucketsOf(m, 'PT', PT)).pending, '100000.00', 'the referral commission is still pending for the PT');
    assert.equal((await bucketsOf(m, 'GYM', GYM)).pending, '800000.00', 'the membership’s gym share is still pending');
    assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '100000.00', 'the membership’s platform share is still pending');
    assert.equal(await ledgerPending(m, 'PT', PT, M.txnId), '100000.00');
    assert.equal(await ledgerPending(m, 'GYM', GYM, M.txnId), '800000.00');
    assert.equal(await ledgerPending(m, 'PLATFORM', 'REVENUE', M.txnId), '100000.00');
    assert.equal((await rowsOf(m, 'Contract A termination')).filter((l) => /forfeited share/.test(l)).length, 0,
      'nothing of the membership or the referral was reclassified as a forfeited share');
    await assertBooksSound(m, `${reason} — contract ended beside a membership`);

    // The membership then expires naturally: all three parts come out, in full.
    const released = await m.membership.releaseMembershipPending({
      transactionId: M.txnId, gymId: GYM, clientId: M.clientId, ptUserId: PT,
      refundToClient: new m.Prisma.Decimal(0), label: 'Membership M expiry', idempotencyKey: 'MEMBERSHIP_RELEASE:M',
    });
    assert.deepEqual(released, {
      released: { gym: '800000.00', platform: '100000.00', ptReferral: '100000.00' },
      refundedToClient: '0.00',
      forfeitedToRevenue: '0.00',
      shortfall: '0.00',
    });
    assert.equal((await bucketsOf(m, 'PT', PT)).pending, '0.00');
    assert.equal((await bucketsOf(m, 'GYM', GYM)).pending, '0.00');
    assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '0.00');
    await assertBooksSound(m, `${reason} — membership released`);
  });
}

test('CLIENT_CANCELLED beside a membership and a referral, to the đồng: every party ends with exactly its own money', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const M = await paidMembership(m, { id: 'M', gym: GYM, price: 1_000_000 });
  await m.membership.settleMembershipReferral({
    transactionId: M.txnId, gymId: GYM, ptUserId: PT, amount: new m.Prisma.Decimal(100_000),
    label: 'Membership M referral', idempotencyKey: 'MEMBERSHIP_REFERRAL:M',
  });
  const A = await paidContract(m, { id: 'A', pt: PT, gym: GYM });
  await deliver(m, A, 1);

  await end(m, A, 'CLIENT_CANCELLED');

  // 750.000 unused → 675.000 refunded; the 325.000 that stays is shared 55/35/10 =
  // 178.750 / 113.750 / 32.500, of which 137.500 / 87.500 / 25.000 was already released.
  assert.deepEqual(await rowsOf(m, 'Contract A termination'), [
    `PT ${PT} DEBIT PENDING 41250.00 | Contract A termination — final settlement`,
    `PT ${PT} CREDIT AVAILABLE 41250.00 | Contract A termination — final settlement`,
    `GYM ${GYM} DEBIT PENDING 26250.00 | Contract A termination — final settlement`,
    `GYM ${GYM} CREDIT AVAILABLE 26250.00 | Contract A termination — final settlement`,
    'REVENUE DEBIT PENDING 7500.00 | Contract A termination — final settlement',
    'REVENUE CREDIT AVAILABLE 7500.00 | Contract A termination — final settlement',
    `PT ${PT} DEBIT PENDING 371250.00 | Contract A termination — pending released on termination`,
    `GYM ${GYM} DEBIT PENDING 236250.00 | Contract A termination — pending released on termination`,
    'REVENUE DEBIT PENDING 67500.00 | Contract A termination — pending released on termination',
    'CLIENT client-A CREDIT AVAILABLE 675000.00 | Contract A termination — refund (CLIENT_CANCELLED)',
  ].sort());

  await m.membership.releaseMembershipPending({
    transactionId: M.txnId, gymId: GYM, clientId: M.clientId, ptUserId: PT,
    refundToClient: new m.Prisma.Decimal(0), label: 'Membership M expiry', idempotencyKey: 'MEMBERSHIP_RELEASE:M',
  });

  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '278750.00', locked: '0.00' }, 'PT: 178.750 from A + the 100.000 referral');
  assert.deepEqual(await bucketsOf(m, 'GYM', GYM), { pending: '0.00', available: '913750.00', locked: '0.00' }, 'gym: 113.750 from A + 800.000 from the membership');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '0.00', available: '132500.00', locked: '0.00' }, 'platform: 32.500 from A + 100.000 from the membership');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '675000.00', 'client of A: the refund');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'ESCROW')).available, '2000000.00', 'escrow never moved');
  await assertBooksSound(m, 'membership + referral, to the đồng');
});

// ── The other operations with the same reach ─────────────────────────────────

test('a session of A confirmed AFTER A was terminated releases nothing — it does not pay itself out of B', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, gym: GYM });
  const B = await paidContract(m, { id: 'B', pt: PT, gym: GYM, price: 2_000_000, sessions: 8 });
  await deliver(m, A, 1);
  await end(m, A, 'CLIENT_CANCELLED');
  const before = {
    pt: await bucketsOf(m, 'PT', PT), gym: await bucketsOf(m, 'GYM', GYM), revenue: await bucketsOf(m, 'PLATFORM', 'REVENUE'),
  };
  assert.equal(before.pt.pending, '1100000.00', 'only B’s pending is left in the PT wallet');

  // A session still awaiting the client's confirmation when the contract ended is confirmed
  // (or auto-confirmed) days later, and user-service asks for its release as usual.
  const [late] = await deliver(m, A, 1);

  assert.deepEqual(late.released, { pt: '0.00', gym: '0.00', platform: '0.00' }, 'the call reports that nothing moved');
  assert.deepEqual(await rowsOf(m, 'Contract A session 2'), [], 'and nothing was posted');
  assert.deepEqual({
    pt: await bucketsOf(m, 'PT', PT), gym: await bucketsOf(m, 'GYM', GYM), revenue: await bucketsOf(m, 'PLATFORM', 'REVENUE'),
  }, before, 'no wallet moved');
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '1100000.00', 'B’s pending is intact');
  await assertBooksSound(m, 'release after termination');
});

for (const kind of ['no-show', 'late arrival'] as const) {
  test(`a PT ${kind} on a contract whose own pending is already spent is charged to earnings, not to B's pending`, skipOpts, async () => {
    const m = await load();
    const run = async (shared: boolean) => {
      await resetLedger(m);
      if (shared) await paidContract(m, { id: 'B', pt: PT, gym: GYM, price: 2_000_000, sessions: 8 });
      const A = await paidContract(m, { id: 'A', pt: PT, gym: GYM });
      await deliver(m, A, 4); // every session released: A has no pending left, only earnings
      const result = kind === 'no-show' ? await noShow(m, A) : await lateArrival(m, A);
      return { result, rows: await rowsOf(m, `Contract A ${kind}`) };
    };

    const solo = await run(false);
    const shared = await run(true);

    assert.deepEqual(shared.rows, solo.rows, 'the charge lands on the same buckets as when A is alone');
    assert.deepEqual(shared.result, solo.result);
    assert.equal(shared.rows.filter((l) => / PENDING /.test(l)).length, 0, 'not one row touches a pending bucket');
    assert.equal(shared.rows.filter((l) => / DEBIT AVAILABLE /.test(l)).length, 3, 'PT, gym and platform each pay out of what they were released');
    assert.equal((await bucketsOf(m, 'PT', PT)).pending, '1100000.00', 'B’s PT pending is whole');
    assert.equal((await bucketsOf(m, 'GYM', GYM)).pending, '700000.00', 'B’s gym pending is whole');
    assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '200000.00', 'B’s platform pending is whole');
    await assertBooksSound(m, `${kind} with A's pending spent`);
  });
}

// ── releaseSession reports what it moved ─────────────────────────────────────

test('releaseSession reports the amounts it actually moved, and termination still reconciles on them', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT });

  // A late arrival takes 112.500 + 12.500 out of A's pending without using up a session, so
  // by the fourth session A has only half a session's money left to release.
  await lateArrival(m, A);
  const releases = await deliver(m, A, 4);

  assert.deepEqual(releases.slice(0, 3).map((r) => r.released), Array(3).fill({ pt: '225000.00', gym: '0.00', platform: '25000.00' }), 'the first three sessions release in full');
  assert.deepEqual(releases[3].released, { pt: '112500.00', gym: '0.00', platform: '12500.00' },
    'the fourth reports the 112.500 + 12.500 it really moved — not the 225.000 + 25.000 the formula would have liked');
  assert.deepEqual(await rowsOf(m, 'Contract A session 4'), [
    `PT ${PT} DEBIT PENDING 112500.00 | Contract A session 4 — release to available`,
    `PT ${PT} CREDIT AVAILABLE 112500.00 | Contract A session 4 — session earned`,
    'REVENUE DEBIT PENDING 12500.00 | Contract A session 4 — release to available',
    'REVENUE CREDIT AVAILABLE 12500.00 | Contract A session 4 — session earned',
  ].sort(), 'and the rows say the same');
  assert.equal(A.releasedTo.pt.toFixed(2), '787500.00', 'so the caller’s running total is what the PT truly holds from A');

  // Termination is handed those truthful totals. A's pending is spent, so there is nothing to
  // top up with and nothing to drain: the 125.000 the late arrival cost is reported as a
  // shortfall instead of being hidden behind a "released" figure that never happened.
  const out = await end(m, A, 'COMPLETED');
  assert.deepEqual(await rowsOf(m, 'Contract A termination'), [], 'nothing left to post');
  assert.deepEqual(out, {
    reason: 'COMPLETED',
    refund: '0.00',
    entitlement: { pt: '900000.00', gym: '0.00', platform: '100000.00' },
    topUp: { pt: '0.00', gym: '0.00', platform: '0.00' },
    returnedToEscrow: '0.00',
    shortfall: '125000.00',
  });

  // Every đồng of A's price is accounted for, and none of it came from B.
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '125000.00', 'client: the late-arrival compensation');
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '787500.00', 'PT: 900.000 − its 112.500 share of that compensation');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, '87500.00', 'platform: 100.000 − its 12.500 share');
  assert.equal((await bucketsOf(m, 'PT', PT)).pending, '1800000.00', 'B’s pending is whole');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '200000.00', 'B’s platform pending is whole');
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '1800000.00');
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no debt was raised for it');
  await assertBooksSound(m, 'truthful release totals');
});

// ── The personalized-service ledger: same pooled read, same reach ────────────

interface Order {
  id: string;
  txnId: string;
  parties: { ptUserId: string; clientUserId: string };
  price: Dec;
  rates: { ptRate: Dec; platformRate: Dec };
}

/** A personalized-service order, held: settled through the generic checkout pipeline. */
async function heldOrder(m: Mods, o: { id: string; pt: string; price: number }): Promise<Order> {
  const clientUserId = `buyer-${o.id}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId,
      purpose: 'PERSONALIZED_SERVICE_PURCHASE',
      amount: o.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'MOCK',
      idempotencyKey: `order-${o.id}-${randomUUID()}`,
      relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
    },
  });
  const price = new m.Prisma.Decimal(o.price);
  await m.ledger.settleContractPayment({
    transactionId: txn.id, price, rates: rateTable(m, '0.10', '0.90', '0'),
    parties: { ptUserId: o.pt, gymId: null, clientUserId }, label: `PERSONALIZED_SERVICE_PURCHASE ${o.id}`,
  });
  return {
    id: o.id, txnId: txn.id, parties: { ptUserId: o.pt, clientUserId }, price,
    rates: { ptRate: new m.Prisma.Decimal('0.90'), platformRate: new m.Prisma.Decimal('0.10') },
  };
}

test('refunding an order that was already accepted claws back the PT’s earnings, not the pending of the PT’s contract', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, sessions: 10 });
  const O = await heldOrder(m, { id: 'O', pt: PT, price: 1_000_000 });
  await m.orders.releaseOrder({
    transactionId: O.txnId, price: O.price, rates: O.rates, parties: O.parties,
    label: 'Order O accepted', idempotencyKey: 'PERSONALIZED_RELEASE:O',
  });
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '900000.00', locked: '0.00' }, 'order earned, contract B still pending');

  const refund = await m.orders.refundOrder({
    transactionId: O.txnId, refundAmount: new m.Prisma.Decimal(500_000), rates: O.rates, parties: O.parties,
    label: 'Order O admin refund', idempotencyKey: 'PERSONALIZED_REFUND:O:500000.00',
  });

  // The order's own pending is gone — it was released on acceptance — so the documented path
  // applies: claw back from AVAILABLE. Taking it from PENDING would be taking it from B.
  assert.deepEqual(await rowsOf(m, 'Order O admin refund'), [
    `PT ${PT} DEBIT AVAILABLE 450000.00 | Order O admin refund — refund clawed back from available`,
    'REVENUE DEBIT AVAILABLE 50000.00 | Order O admin refund — refund clawed back from available',
    'CLIENT buyer-O CREDIT AVAILABLE 500000.00 | Order O admin refund — refund',
  ].sort());
  assert.deepEqual(refund, { refund: '500000.00', clawedBack: { pt: '450000.00', platform: '50000.00' }, shortfall: '0.00' });
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '450000.00', locked: '0.00' }, 'B’s pending is whole');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '100000.00', available: '50000.00', locked: '0.00' });
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '900000.00');
  await assertBooksSound(m, 'order refunded after acceptance');
});

test('accepting an order that was partly refunded releases only what the ORDER still has pending, not a slice of the PT’s contract', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, sessions: 10 });
  const O = await heldOrder(m, { id: 'O', pt: PT, price: 1_000_000 });

  // 300.000 refunded before acceptance: 270.000 + 30.000 out of the order's own pending.
  await m.orders.refundOrder({
    transactionId: O.txnId, refundAmount: new m.Prisma.Decimal(300_000), rates: O.rates, parties: O.parties,
    label: 'Order O partial refund', idempotencyKey: 'PERSONALIZED_REFUND:O:300000.00',
  });
  assert.equal(await ledgerPending(m, 'PT', PT, O.txnId), '630000.00', 'the order has 630.000 of PT pending left');

  const accepted = await m.orders.releaseOrder({
    transactionId: O.txnId, price: O.price, rates: O.rates, parties: O.parties,
    label: 'Order O accepted', idempotencyKey: 'PERSONALIZED_RELEASE:O',
  });

  assert.deepEqual(accepted, { released: { pt: '630000.00', platform: '70000.00' } }, 'what the order had left — not the full 900.000 + 100.000');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '630000.00', locked: '0.00' }, 'B’s 900.000 is still pending');
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '100000.00', available: '70000.00', locked: '0.00' });
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '900000.00');
  assert.equal((await bucketsOf(m, 'CLIENT', 'buyer-O')).available, '300000.00');
  await assertBooksSound(m, 'order accepted after a partial refund');
});

// ── Wallets the old pooled drain has already been through ────────────────────
//
// On a database where the defect has run, a past termination debited its neighbours' pending
// under ITS OWN transaction id. Per-transaction sums are then wrong in both directions: the
// terminated contract reads as over-debited (negative), and each victim still "has" pending on
// paper that the wallet no longer holds. Nothing here repairs that — these tests only prove
// the scoped code stays safe on it: no bucket goes negative, no money is invented, a contract
// never gets more than the wallet really holds, and what is missing stays visible as a
// reported shortfall.

/**
 * Replays, row for row, what the pooled terminateContract wrote when the client of A cancelled
 * an unused 1.000.000đ contract while the same PT's B (also 1.000.000đ, unused) was running —
 * the reproduction at the top of this file's story. Written straight to the ledger under A's
 * transaction id, as the old code did. TEST FIXTURE, not a call into the service.
 */
async function damagedByOldDrain(m: Mods) {
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, sessions: 10 });
  const B = await paidContract(m, { id: 'B', pt: PT, sessions: 10 });
  const [pt, revenue, client] = await Promise.all([
    m.wallet.getOrCreateWallet('PT', PT),
    m.wallet.getRevenueWallet(),
    m.wallet.getOrCreateWallet('CLIENT', A.parties.clientUserId),
  ]);
  const D = (v: number) => new m.Prisma.Decimal(v);
  const label = 'Legacy A termination';
  await m.wallet.withWallets([pt.id, revenue.id, client.id], A.txnId, async (ops) => {
    await ops.debit(pt.id, D(90_000), `${label} — final settlement`, 'PENDING');
    await ops.credit(pt.id, D(90_000), `${label} — final settlement`, 'AVAILABLE');
    await ops.debit(revenue.id, D(10_000), `${label} — final settlement`, 'PENDING');
    await ops.credit(revenue.id, D(10_000), `${label} — final settlement`, 'AVAILABLE');
    await ops.debit(pt.id, D(1_710_000), `${label} — pending released on termination`, 'PENDING'); // 900.000 of it was B's
    await ops.debit(revenue.id, D(190_000), `${label} — pending released on termination`, 'PENDING'); // 100.000 of it was B's
    await ops.credit(client.id, D(900_000), `${label} — refund (CLIENT_CANCELLED)`, 'AVAILABLE');
    await ops.credit(revenue.id, D(1_000_000), `${label} — forfeited share`, 'AVAILABLE'); // B's whole value
  });

  // The damaged state, as described: balanced overall, B's money gone from pending, and the
  // per-transaction sums wrong in both directions.
  await m.reconcile.assertInvariant('damaged fixture');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '90000.00', locked: '0.00' });
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), { pending: '0.00', available: '1010000.00', locked: '0.00' });
  assert.equal(await ledgerPending(m, 'PT', PT, A.txnId), '-900000.00', 'A reads as over-debited');
  assert.equal(await ledgerPending(m, 'PT', PT, B.txnId), '900000.00', 'B still "has" pending the wallet does not hold');
  return { A, B };
}

/** No bucket below zero anywhere, the invariant holds, and the ledger explains every balance. */
async function assertSafeOnDamagedData(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  const below = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(
    'SELECT COUNT(*) AS n FROM wallet_ledger_entries WHERE balance_after < 0 OR balance_before < 0');
  assert.equal(Number(below[0].n), 0, `${context}: no ledger row ever took a bucket below zero`);
}

test('damaged wallet: a session of the victim contract releases nothing, says so, and nothing goes negative', skipOpts, async () => {
  const m = await load();
  const { B } = await damagedByOldDrain(m);

  const [r] = await deliver(m, B, 1);

  assert.deepEqual(r.released, { pt: '0.00', gym: '0.00', platform: '0.00' }, 'the wallet holds none of B’s money, and the call reports exactly that');
  assert.deepEqual(await rowsOf(m, 'Contract B session'), [], 'nothing was posted');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '90000.00', locked: '0.00' });
  assert.equal(B.releasedTo.pt.toFixed(2), '0.00', 'so the caller records nothing as released');
  await assertSafeOnDamagedData(m, 'victim release');
});

test('damaged wallet: terminating the victim contract still makes its client whole, and the missing money shows as a shortfall', skipOpts, async () => {
  const m = await load();
  const { B } = await damagedByOldDrain(m);

  const out = await end(m, B, 'CLIENT_CANCELLED');

  // B's own pending is not there to drain, so the existing rule for an empty pending bucket
  // applies unchanged: the platform fronts the refund and books it against the PT.
  assert.deepEqual(await rowsOf(m, 'Contract B termination'), [
    'CLIENT client-B CREDIT AVAILABLE 900000.00 | Contract B termination — refund (CLIENT_CANCELLED)',
    'REVENUE DEBIT AVAILABLE 900000.00 | Termination refund shortfall (Contract B termination, CLIENT_CANCELLED) — fronted by the platform',
  ].sort());
  assert.equal(out.refund, '900000.00');
  assert.equal(out.returnedToEscrow, '0.00', 'nothing was drained — nothing was there');
  assert.equal(out.shortfall, '1000000.00', 'the 900.000 refund and the 90.000 + 10.000 final shares, none of which B’s pending could fund');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-B')).available, '900000.00', 'the client is paid in full');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '90000.00', locked: '0.00' }, 'the PT wallet is not pushed below zero');
  const debts = await m.prisma.partnerReceivable.findMany();
  assert.equal(debts.length, 1, 'the gap is on the books as a receivable, where an operator can see it');
  assert.equal(debts[0].amount.toFixed(2), '900000.00');
  await assertSafeOnDamagedData(m, 'victim termination');
});

test('damaged wallet: the over-debited contract cannot reach into money that arrives later', skipOpts, async () => {
  const m = await load();
  const { A } = await damagedByOldDrain(m);
  // The same PT signs a new contract: 900.000 + 100.000 of fresh, genuine pending.
  const N = await paidContract(m, { id: 'N', pt: PT, sessions: 10 });

  // A's ledger pending is −900.000. Read naively that is "less than nothing"; it must be
  // treated as nothing, so neither a stray late release nor a late no-show on A may take a
  // đồng of N's pending.
  const [late] = await deliver(m, A, 1);
  assert.deepEqual(late.released, { pt: '0.00', gym: '0.00', platform: '0.00' });
  const missed = await noShow(m, A);

  assert.deepEqual(await rowsOf(m, 'Contract A session'), [], 'the late release posted nothing');
  assert.equal((await rowsOf(m, 'Contract A no-show')).filter((l) => / PENDING /.test(l)).length, 0, 'the no-show charge touched no pending bucket');
  assert.equal(missed.charged.pt, '90000.00', 'it was charged to the PT’s earnings instead');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '900000.00', available: '0.00', locked: '0.00' }, 'N’s pending is whole');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).pending, '100000.00', 'N’s platform pending is whole');
  assert.equal(await ledgerPending(m, 'PT', PT, N.txnId), '900000.00');
  await assertSafeOnDamagedData(m, 'over-debited contract');
});

test('damaged wallet: across the victim and a later contract nothing is invented — the loss surfaces once, as a reported shortfall', skipOpts, async () => {
  const m = await load();
  const { B } = await damagedByOldDrain(m);
  const N = await paidContract(m, { id: 'N', pt: PT, sessions: 10 });

  // The wallet now holds 900.000 of pending and TWO contracts each show 900.000 on paper. No
  // row tells B's phantom claim from N's real one — telling them apart is data repair, which
  // this fix deliberately does not attempt. What it does guarantee is the ceiling: a contract
  // is never given more than the wallet holds, so the two together cannot draw more than the
  // 900.000 that exists, whichever of them asks first.
  const forB = await deliver(m, B, 10);
  const forN = await deliver(m, N, 10);
  const sum = (rs: typeof forB) => rs.reduce((s, r) => s.plus(r.released.pt), new m.Prisma.Decimal(0)).toFixed(2);
  assert.equal(new m.Prisma.Decimal(sum(forB)).plus(sum(forN)).toFixed(2), '900000.00', 'together they released exactly what the wallet held');
  assert.equal((await bucketsOf(m, 'PT', PT)).pending, '0.00', 'pending ends at zero, not below');
  await assertSafeOnDamagedData(m, 'victim and newcomer delivered');

  const endB = await end(m, B, 'COMPLETED');
  const endN = await end(m, N, 'COMPLETED');

  // Whoever came up short is told so. The total reported is the 1.000.000 the old drain
  // booked to REVENUE as a "forfeited share" — the damage, visible, and counted once.
  assert.equal(new m.Prisma.Decimal(endB.shortfall).plus(endN.shortfall).toFixed(2), '1000000.00');
  assert.deepEqual(await bucketsOf(m, 'PT', PT), { pending: '0.00', available: '990000.00', locked: '0.00' }, 'PT: 90.000 from A + the 900.000 that was really there');
  assert.equal((await bucketsOf(m, 'PLATFORM', 'ESCROW')).available, '3000000.00', 'escrow never moved');
  await assertSafeOnDamagedData(m, 'victim and newcomer completed');
});
