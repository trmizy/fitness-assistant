/**
 * Financial Hardening (D75) FH-1 — N7 / D48: REGRESSION tests that a PT-fault money step on contract A can no longer draw
 * on money that belongs to ANOTHER contract of the same PT, leave the PT a debt, or make the platform front the money.
 * (They were [DEFECT N7] proofs that passed while the defect was present; FH-1 flipped them.)
 *
 * Evidence label: BACKEND INTEGRATION - payment-service ledger functions called directly, REAL ledger rows and wallet
 * balances in an isolated *_test database. Not a cross-service run: the callers' discipline (user-service's 409
 * CONTRACT_ENDING gate, D59) is deliberately NOT in play, because the point of N7 is that the ledger itself must not do
 * what D48 forbids even when it is asked to (a replayed FAILED row, a caller that misses the gate, a legacy sub-ledger
 * that is already short).
 *
 * The D48 rule they pin:
 *   - compensation for contract X is paid only out of X's own pending;
 *   - a shortfall is recorded as an unpaid obligation of X - never drawn from the PT's pooled AVAILABLE, never fronted
 *     by the platform, never booked as a PT receivable;
 *   - the result never reports a client "made whole" for money that was not there (paid / owed / unpaid).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables). It needs its own database whose NAME ends in _test:
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fha_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/fin-hardening-n7-cross-contract-draw.integration.test.ts
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

test("[REGRESSION N7 / P1] a no-show on contract A whose own money is gone is NOT charged to the PT's pooled AVAILABLE: B's earnings stay, the client gets only what A could fund, the rest is an OPEN obligation", skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 2); // the PT earned 2 x 225.000 = 450.000 on B: that is ALL the PT has in AVAILABLE
  await end(m, A, 'MUTUAL'); // A is over: 100% refund, A's pending is empty, and the PT got nothing from A
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '450000.00', "precondition: the PT's available money is B's earnings, nothing else");
  assert.equal(await pendingOf(m, 'PT', PT, A.txnId), '0.00', 'precondition: A has no pending left for the PT');
  const revenueBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');
  const clientBefore = (await bucketsOf(m, 'CLIENT', 'client-A')).available;

  const r = await noShow(m, A);

  assert.equal(r.charged.pt, '0.00', 'nothing was charged to the PT');
  assert.equal(r.owed, '250000.00');
  assert.equal(r.paid, '0.00');
  assert.equal(r.unpaid, '250000.00');
  assert.equal(r.compensation, '0.00', 'and the result does not claim a compensation that was not paid');
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '450000.00', "B's earnings are intact");
  assert.deepEqual(await bucketsOf(m, 'PLATFORM', 'REVENUE'), revenueBefore, 'REVENUE did not move');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, clientBefore, 'the client of A was credited nothing more (1.000.000 on a 1.000.000 contract)');
  assert.equal((await rowsOf(m, 'Contract A no-show')).length, 0, 'no ledger row at all');
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PT debt');
  const obligations = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(obligations.length, 1, 'exactly one obligation');
  assert.equal(obligations[0].id, r.obligationId);
  assert.equal(obligations[0].kind, 'NO_SHOW');
  assert.equal(obligations[0].party, 'CLIENT');
  assert.equal(obligations[0].status, 'OPEN');
  assert.equal(obligations[0].owed.toFixed(2), '250000.00');
  assert.equal(obligations[0].paid.toFixed(2), '0.00');
  assert.equal(obligations[0].unpaid.toFixed(2), '250000.00');
  assert.equal(obligations[0].key, 'PT_NO_SHOW:A:1');
  await m.reconcile.assertInvariant('N7 strict P1');
});

test('[REGRESSION N7 / P1] when the PT has no money at all the platform does NOT front it and NO debt is booked: the PT keeps the full session of an unrelated contract', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  await fundRevenue(m, 1_000_000); // the platform HAS revenue it could front with: it must not
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await end(m, A, 'MUTUAL'); // PT has 0 AVAILABLE and A has 0 pending
  const revenueBefore = new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available);

  const r = await noShow(m, A);

  assert.equal(r.charged.pt, '0.00');
  assert.equal(r.paid, '0.00');
  assert.equal(r.unpaid, '250000.00');
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PT debt');
  assert.equal(
    revenueBefore.minus((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available).toFixed(2),
    '0.00',
    'the platform paid nothing (no fronting, not even its own share)',
  );
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1000000.00');

  // The PT then teaches ONE session of a completely different contract C: all of it reaches the PT.
  const C = await paidContract(m, { id: 'C', pt: PT, price: 1_000_000, sessions: 4 });
  const ptBefore = await bucketsOf(m, 'PT', PT);
  await deliver(m, C, 1);
  const ptAfter = await bucketsOf(m, 'PT', PT);
  assert.equal(new m.Prisma.Decimal(ptAfter.available).minus(ptBefore.available).toFixed(2), '225000.00', 'the PT received the full 225.000 of contract C');
  assert.equal((await rowsOf(m, 'Contract C session 1')).filter((l) => /withheld against outstanding debt/.test(l)).length, 0, 'nothing withheld');
  await m.reconcile.assertInvariant('N7 strict no fronting');
});

test("[REGRESSION N7 / P3a] terminateContract does NOT claw an 'over-released' amount out of the PT's pooled AVAILABLE and does not forfeit it to REVENUE: it records an OVER_RELEASED incident", skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 2); // PT AVAILABLE = 450.000, all of it from B
  assert.equal(A.releasedTo.pt.toFixed(2), '0.00', 'A never released a dong to the PT');
  const revenueBefore = new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available);

  // The caller (user-service) believes 225.000 was already released to the PT on A.
  const r = await end(m, A, 'MUTUAL', { releasedPt: '225000.00' });

  assert.equal(r.topUp.pt, '0.00', 'the PT was not "clawed back"');
  assert.equal((await bucketsOf(m, 'PT', PT)).available, '450000.00', "B's earnings are untouched");
  assert.equal(
    new m.Prisma.Decimal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available).minus(revenueBefore).toFixed(2),
    '0.00',
    "nothing was forfeited to the platform's revenue",
  );
  assert.equal((await rowsOf(m, 'Contract A termination')).filter((l) => /over-released/.test(l)).length, 0, 'no claw-back row');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1000000.00', "the client of A still gets the full refund, out of A's own pending");
  assert.equal(r.unpaid, '0.00');
  assert.deepEqual(r.overReleased?.map((o) => [o.party, o.amount]), [['PT', '225000.00']]);
  const o = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(o.length, 1);
  assert.equal(o[0].kind, 'OVER_RELEASED');
  assert.equal(o[0].party, 'PT');
  assert.equal(o[0].status, 'OPEN');
  assert.equal(o[0].unpaid.toFixed(2), '225000.00');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  await m.reconcile.assertInvariant('N7 strict P3a');
});
