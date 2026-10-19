/**
 * Financial Hardening (D75) — N7 / D48: PROOF that a PT-fault money step on contract A can still draw on money that
 * belongs to ANOTHER contract of the same PT, or leave the PT a debt, or make the platform front the money.
 *
 * Evidence label: BACKEND INTEGRATION — payment-service ledger functions called directly, REAL ledger rows and wallet
 * balances in an isolated *_test database. Not a cross-service run: the callers' discipline (user-service's 409
 * CONTRACT_ENDING gate, D59) is deliberately NOT in play, because the point of N7 is that the ledger itself still does
 * what D48 forbids when it is asked to (a replayed FAILED row, a caller that misses the gate, a legacy sub-ledger that
 * is already short — dev has 7 of those, docs/PT_COMPENSATION_SOURCE_AUDIT.md section 3.5).
 *
 * Convention (same as cross-service-money-timeout-faults): a test named [DEFECT N7 ...] PASSES while the defect is
 * PRESENT. When N7 is fixed (slice FH-1) each of them must be FLIPPED into a [REGRESSION] test asserting the D48 rule:
 *   · compensation for contract X is paid only out of X's own pending / escrow;
 *   · a shortfall is recorded as an unpaid obligation of X — never drawn from the PT's pooled AVAILABLE, never fronted
 *     by the platform, never booked as a PT receivable;
 *   · the result never reports a client "made whole" for money that was not there.
 * The existing suite contract-pending-isolation.integration.test.ts ("a PT no-show on a contract whose own pending is
 * already spent is charged to earnings") pins the pooled draw as CORRECT behaviour and will have to change with them.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables). It needs its own database:
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fin_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/fin-hardening-n7-cross-contract-draw.integration.test.ts
 * (any database whose NAME ends in _test works; the guard refuses everything else and the tests are SKIPPED).
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
type OwnerType = 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';

const PT = 'pt-fin';

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

interface Contract {
  id: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  totalSessions: number;
  rates: Rates;
  usedSessions: number;
  compensatedSessions: number;
  releasedTo: { pt: Dec; gym: Dec; platform: Dec };
  seq: number;
}

/** A contract the client has paid for (no gym: platform 10%, PT 90%), exactly as the contract-isolation suite builds one. */
async function paidContract(m: Mods, o: { id: string; pt: string; price: number; sessions: number }): Promise<Contract> {
  const clientUserId = `client-${o.id}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId,
      purpose: 'PT_CONTRACT',
      amount: o.price,
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
  const D = (v: string) => new m.Prisma.Decimal(v);
  const c: Contract = {
    id: o.id,
    txnId: txn.id,
    parties: { ptUserId: o.pt, gymId: null, clientUserId },
    price: D(String(o.price)),
    totalSessions: o.sessions,
    rates: { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') },
    usedSessions: 0,
    compensatedSessions: 0,
    releasedTo: { pt: D('0'), gym: D('0'), platform: D('0') },
    seq: 0,
  };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${c.id}` });
  return c;
}

async function deliver(m: Mods, c: Contract, count: number) {
  for (let i = 0; i < count; i++) {
    const r = await m.ledger.releaseSession({
      transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions, rates: c.rates, parties: c.parties,
      label: `Contract ${c.id} session ${c.usedSessions + 1}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${++c.seq}`,
    });
    c.usedSessions++;
    c.releasedTo.pt = c.releasedTo.pt.plus(r.released.pt);
    c.releasedTo.gym = c.releasedTo.gym.plus(r.released.gym);
    c.releasedTo.platform = c.releasedTo.platform.plus(r.released.platform);
  }
}

async function noShow(m: Mods, c: Contract) {
  const n = ++c.seq;
  const r = await m.ledger.compensateNoShow({
    transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions, rates: c.rates, parties: c.parties,
    label: `Contract ${c.id} no-show ${n}`, idempotencyKey: `PT_NO_SHOW:${c.id}:${n}`,
  });
  return r;
}

async function end(m: Mods, c: Contract, reason: 'MUTUAL' | 'CLIENT_CANCELLED', over?: { releasedPt?: string }) {
  return m.ledger.terminateContract({
    transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions, usedSessions: c.usedSessions,
    compensatedSessions: c.compensatedSessions, rates: c.rates, reason,
    alreadyReleased: over?.releasedPt ? { ...c.releasedTo, pt: new m.Prisma.Decimal(over.releasedPt) } : c.releasedTo,
    parties: c.parties, label: `Contract ${c.id} termination`, idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  });
}

/** Gives REVENUE an available balance so the platform CAN front a shortfall (otherwise the call is refused outright). */
async function fundRevenue(m: Mods, amount: number) {
  const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: amount * 10, sessions: 1 });
  await deliver(m, funder, 1);
}

async function bucketsOf(m: Mods, ownerType: OwnerType, ownerId: string) {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  return { pending: w.pendingBalance.toFixed(2), available: w.availableBalance.toFixed(2), locked: w.lockedBalance.toFixed(2) };
}

/** Raw PENDING net of one transaction in one wallet, computed here from the rows (independent of the service's helper). */
async function pendingOf(m: Mods, ownerType: OwnerType, ownerId: string, txnId: string): Promise<string> {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { walletId: w.id, transactionId: txnId, bucket: 'PENDING' }, select: { entryType: true, amount: true } });
  return rows.reduce((s, r) => (r.entryType === 'CREDIT' ? s.plus(r.amount) : s.minus(r.amount)), new m.Prisma.Decimal(0)).toFixed(2);
}

async function rowsOf(m: Mods, needle: string): Promise<string[]> {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { description: { contains: needle } }, include: { wallet: true } });
  return rows
    .map((r) => `${r.wallet.ownerType === 'PLATFORM' ? r.wallet.ownerId : `${r.wallet.ownerType} ${r.wallet.ownerId}`} ${r.entryType} ${r.bucket} ${r.amount.toFixed(2)} | ${r.description}`)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A: 1.000.000đ / 4 sessions  → one session = 250.000đ = PT 225.000 + platform 25.000
// B: 2.000.000đ / 8 sessions  → one session = 250.000đ = PT 225.000 + platform 25.000   (same PT as A, other client)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('[DEFECT N7 / P1] a no-show on contract A whose own money is gone is charged to the PT\'s POOLED AVAILABLE — i.e. to what the PT earned on contract B', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 2); // the PT earned 2 x 225.000 = 450.000 on B: that is ALL the PT has in AVAILABLE
  await end(m, A, 'MUTUAL'); // A is over: 100% refund, A's pending is empty, and the PT got nothing from A
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '450000.00', 'precondition: the PT\'s available money is B\'s earnings, nothing else');
  assert.equal(await pendingOf(m, 'PT', PT, A.txnId), '0.00', 'precondition: A has no pending left for the PT');
  const revenueBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');

  // A compensation for A arrives AFTER A's ending (a replayed FAILED row, or a caller that skipped the CONTRACT_ENDING gate).
  const r = await noShow(m, A);

  // What the ledger did — the two things D48 forbids:
  assert.equal(r.charged.pt, '225000.00', 'the PT was charged the full 225.000 for contract A ...');
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '225000.00', '... out of AVAILABLE: half of what the PT earned on contract B is gone');
  assert.equal((await rowsOf(m, 'Contract A no-show')).filter((l) => / DEBIT AVAILABLE /.test(l) && /^PT /.test(l)).length, 1, 'the debit row sits in the PT\'s AVAILABLE bucket, stamped with A\'s transaction id');
  assert.equal(
    new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available).minus(revenueBefore.available).toFixed(2),
    '-25000.00',
    'the platform\'s 25.000 share came out of REVENUE AVAILABLE (pooled platform money) too',
  );
  // The client of A ends with MORE than they paid: 1.000.000 refund + 250.000 compensation on a 1.000.000 contract.
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1250000.00', 'the client of A holds 1.250.000đ on a 1.000.000đ contract');
  assert.equal(r.shortfall, '0.00', 'and the result reports a clean, complete compensation');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  // Not a drift: the books balance, which is exactly why nothing but this kind of test can see it.
  await m.reconcile.assertInvariant('N7 pooled draw');
});

test('[DEFECT N7 / P1] when the PT\'s pooled money is not enough the PLATFORM FRONTS it and a DEBT is booked on the PT — and the next session of an unrelated contract pays that debt', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  await fundRevenue(m, 1_000_000); // the platform has revenue to front with (otherwise the whole call is refused)
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await end(m, A, 'MUTUAL'); // PT has 0 AVAILABLE and A has 0 pending
  const revenueBefore = new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available);

  const r = await noShow(m, A);

  assert.equal(r.charged.pt, '0.00', 'nothing could be charged to the PT');
  assert.equal(r.shortfall, '225000.00', 'the PT\'s 225.000 is a "shortfall" ...');
  const debts = await m.prisma.partnerReceivable.findMany();
  assert.equal(debts.length, 1, '... booked as a DEBT of the PT (automatic PT debt: D48 says no)');
  assert.equal(debts[0].partnerType, 'PT');
  assert.equal(debts[0].amount.toFixed(2), '225000.00');
  assert.equal(
    revenueBefore.minus((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available).toFixed(2),
    '250000.00',
    'the platform paid 25.000 (its own share, from pooled REVENUE) + fronted 225.000 (D20/D48: the platform does not front)',
  );
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1250000.00', 'the client is "made whole" with money no contract of A funded');

  // The PT then teaches ONE session of a completely different contract C. The debt of A is collected from C's earnings.
  const C = await paidContract(m, { id: 'C', pt: PT, price: 1_000_000, sessions: 4 });
  const ptBefore = await bucketsOf(m, 'PT', PT);
  await deliver(m, C, 1); // C's session earns the PT 225.000
  const ptAfter = await bucketsOf(m, 'PT', PT);
  assert.equal(new m.Prisma.Decimal(ptAfter.available).minus(ptBefore.available).toFixed(2), '0.00', 'the PT taught a full session of contract C and received 0đ of it ...');
  assert.ok((await rowsOf(m, 'Contract C session 1')).some((l) => /withheld against outstanding debt/.test(l) && /DEBIT AVAILABLE 225000\.00/.test(l)), '... because 225.000 was withheld against the debt of contract A');
  assert.equal((await m.prisma.partnerReceivable.findFirstOrThrow()).settledAt !== null, true, 'the receivable is marked settled');
  await m.reconcile.assertInvariant('N7 fronted + recovered');
});

test('[DEFECT N7 / P2] terminateContract claws an "over-released" amount back out of the PT\'s POOLED AVAILABLE — it moves B\'s earnings into platform revenue on a counter error of A', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 2); // PT AVAILABLE = 450.000, all of it from B
  assert.equal(A.releasedTo.pt.toFixed(2), '0.00', 'A never released a đồng to the PT');
  const revenueBefore = new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available);

  // The caller (user-service) believes 225.000 was already released to the PT on A. Phase 0 makes that very unlikely —
  // but payment-service does not check it against its own ledger, it just claws the difference back.
  const r = await end(m, A, 'MUTUAL', { releasedPt: '225000.00' });

  assert.equal(r.topUp.pt, '-225000.00', 'the PT was "clawed back" 225.000 ...');
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '225000.00', '... which was taken from AVAILABLE, i.e. from contract B\'s earnings');
  assert.ok((await rowsOf(m, 'Contract A termination')).some((l) => /^PT pt-fin DEBIT AVAILABLE 225000\.00 .*over-released, clawed back/.test(l)));
  assert.equal(
    new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available).minus(revenueBefore).toFixed(2),
    '225000.00',
    'and it ended as "forfeited share" in the platform\'s revenue (the client of A still got the full 1.000.000 refund)',
  );
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1000000.00');
  await m.reconcile.assertInvariant('N7 clawback');
});
