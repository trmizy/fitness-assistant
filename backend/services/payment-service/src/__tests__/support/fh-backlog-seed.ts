/**
 * Seeds a payment database with every kind of backlog the FH-4 part 2 report and the FH-8 tools deal with.
 * The money rows come from the REAL ledger (settleContractPayment / releaseSession / compensateNoShow through
 * walletService.withWallets); the few defects the fixed ledger can no longer produce (a negative sub-ledger, a wallet that
 * differs from its ledger, a legacy receivable, an old un-activated payment) are written as TEST FIXTURE rows and labelled so.
 * Only use against a *_test database: it TRUNCATEs the ledger tables.
 */
import { randomUUID } from 'crypto';

export const PT = 'pt-fhf';
export const GYM = 'gym-fhf';

export async function seedBacklog() {
  const { prisma } = await import('../../repositories/prisma');
  const { Prisma } = await import('../../generated/prisma');
  const ledger = await import('../../services/contract-ledger.service');
  const { walletService } = await import('../../services/wallet.service');
  const D = (v: string | number) => new Prisma.Decimal(v);

  await prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, partner_receivable_events, contract_unpaid_obligation_events, contract_unpaid_obligations, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );

  const rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const mkTxn = (id: string, data: Record<string, unknown> = {}) =>
    prisma.paymentTransaction.create({
      data: {
        payerId: `client-${id}`, purpose: 'PT_CONTRACT', amount: 1_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
        providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
        relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test', ...data,
      } as any,
    });
  const settle = async (id: string) => {
    const txn = await mkTxn(id);
    const parties = { ptUserId: PT, gymId: null, clientUserId: `client-${id}` };
    await ledger.settleContractPayment({ transactionId: txn.id, price: D(1_000_000), rates, parties, label: `fhf ${id}` });
    return { txn, parties };
  };

  // Contract A: all four sessions delivered, then the PT no-shows twice -> two OPEN obligations (nothing left to pay from).
  const A = await settle('A');
  for (let i = 1; i <= 4; i++) {
    await ledger.releaseSession({
      transactionId: A.txn.id, price: D(1_000_000), totalSessions: 4, rates, parties: A.parties, label: `fhf A s${i}`,
      idempotencyKey: `SESSION_RELEASE:fhf-A:${i}`,
    });
  }
  for (let i = 1; i <= 2; i++) {
    await ledger.compensateNoShow({
      transactionId: A.txn.id, price: D(1_000_000), totalSessions: 4, rates, parties: A.parties, label: `fhf A no-show ${i}`,
      idempotencyKey: `PT_NO_SHOW:fhf-A:${i}`,
    });
  }
  // Contract B: paid, nothing delivered -> the PT's PENDING pool holds B's money.
  const B = await settle('B');

  // TEST FIXTURE: a negative sub-ledger (what the pre-FH-1 pooled drain left behind): contract A's id debited the PT's
  // PENDING pool (B's money) and the platform kept it.
  const ptW = await walletService.getOrCreateWallet('PT', PT);
  const revW = await walletService.getOrCreateWallet('PLATFORM', 'REVENUE');
  await walletService.withWallets([ptW.id, revW.id], A.txn.id, async (ops) => {
    await ops.debit(ptW.id, D(50_000), 'TEST FIXTURE: legacy pooled drain', 'PENDING');
    await ops.credit(revW.id, D(50_000), 'TEST FIXTURE: legacy pooled drain', 'AVAILABLE');
  });

  // TEST FIXTURE: legacy receivables of the PT (2 active, 1 already suspended).
  const mkRec = (amount: number, reason: string, extra: Record<string, unknown> = {}) =>
    prisma.partnerReceivable.create({ data: { partnerType: 'PT', partnerId: PT, amount, reason, transactionId: A.txn.id, ...extra } });
  const recA = await mkRec(70_000, 'PT no-show compensation shortfall - fronted');
  const recB = await mkRec(30_000, 'Contract fhf refund shortfall');
  const recS = await mkRec(20_000, 'Referral clawback shortfall (fhf)', { suspendedAt: new Date(), suspendedBy: 'fixture', suspensionReason: 'fixture', suspensionRef: 'FIX-1' });

  // TEST FIXTURE: PAID but never activated, 2 hours old (listed) and 1 minute old (not listed at 30 min).
  const stuck = await mkTxn('stuck', { status: 'PAID', paidAt: new Date(Date.now() - 2 * 3600_000), activationStatus: 'ACTIVATION_FAILED' });
  await mkTxn('fresh', { status: 'PAID', paidAt: new Date(Date.now() - 60_000), activationStatus: 'PENDING' });

  // A gym-membership payment that is PAID + ACTIVATED with the gym's PENDING money still held (candidate for "activated but
  // cancelled"; whether the membership is really cancelled is owned by gym-service and is NOT known here).
  const gymW = await walletService.getOrCreateWallet('GYM', GYM);
  const escW = await walletService.getOrCreateWallet('PLATFORM', 'ESCROW');
  const mem = await mkTxn('mem', { purpose: 'GYM_MEMBERSHIP', relatedEntityType: 'GYM_MEMBERSHIP', status: 'PAID', paidAt: new Date(), activationStatus: 'ACTIVATED', amount: 500_000 });
  await walletService.withWallets([escW.id, gymW.id], mem.id, async (ops) => {
    await ops.credit(escW.id, D(500_000), 'TEST FIXTURE membership cash in', 'AVAILABLE');
    await ops.credit(gymW.id, D(450_000), 'TEST FIXTURE membership gym share', 'PENDING');
  });

  // TEST FIXTURE: a wallet bucket that differs from its own ledger by 7.
  await prisma.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance + 7 WHERE owner_type='GYM' AND owner_id='${GYM}'`);

  const obligations = await prisma.contractUnpaidObligation.findMany({ orderBy: { createdAt: 'asc' } });
  return { prisma, Prisma, A, B, recA, recB, recS, stuck, mem, obligations };
}

/** Row counts of every table the read-only report must never change. */
export async function tableCounts(prisma: { $queryRawUnsafe: (q: string) => Promise<any> }) {
  const tables = [
    'wallets', 'wallet_ledger_entries', 'payment_transactions', 'partner_receivables', 'partner_receivable_events',
    'contract_unpaid_obligations', 'contract_unpaid_obligation_events', 'ledger_operations', 'platform_commissions',
  ];
  const out: Record<string, string> = {};
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe(
      t === 'wallets'
        ? `SELECT count(*)::text AS c, coalesce(sum(available_balance+pending_balance+locked_balance),0)::text AS s FROM ${t}`
        : t === 'partner_receivables'
          ? `SELECT count(*)::text AS c, coalesce(sum(recovered),0)::text AS s FROM ${t}`
          : `SELECT count(*)::text AS c, '' AS s FROM ${t}`,
    );
    out[t] = `${r[0].c}/${r[0].s}`;
  }
  return out;
}
