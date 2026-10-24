import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { walletService } from '../services/wallet.service';
import { buildFinanceOverview } from '../services/finance-report.service';
import { buildReconciliationReport } from '../services/reconcile.service';

/**
 * B29 — the admin finance overview's netRevenue used to sum only `platform_commissions` rows
 * (written only by the legacy wallet transfer), so it was 0 for the contract/membership flows
 * even though the ledger held platform revenue. It must now come from the revenue wallet's
 * ledger (AVAILABLE bucket), with PENDING reported separately.
 *
 *   evidence label: BACKEND INTEGRATION (real service + isolated *_test DB).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/finance-overview-ledger-revenue.integration.test.ts
 *
 * Entries are re-dated to 2031 so the assertions are about exactly this test's rows whatever else
 * sits in the table; the pending snapshot is compared with the reconciliation report instead.
 */

const D = (n: number | string) => new Prisma.Decimal(n);
const FROM = new Date('2031-03-01T00:00:00Z');
const TO = new Date('2031-04-01T00:00:00Z');

async function mkTxn(purpose: 'PT_CONTRACT' | 'REFUND' | 'WITHDRAWAL', amount: number) {
  return prisma.paymentTransaction.create({
    data: { id: randomUUID(), payerId: randomUUID(), purpose, amount: D(amount), idempotencyKey: `test:${randomUUID()}`, status: 'PAID' },
  });
}

async function redate(transactionIds: string[], when: Date) {
  await prisma.walletLedgerEntry.updateMany({ where: { transactionId: { in: transactionIds } }, data: { createdAt: when } });
}

test('netRevenue is the ledger AVAILABLE revenue (contract flow, no PlatformCommission row); pending is reported apart; refund lowers it; withdrawal does not; out-of-window ignored', async () => {
  const revenue = await walletService.getRevenueWallet();
  const escrow = await walletService.getEscrowWallet();
  const inMarch = new Date('2031-03-10T05:00:00Z');
  // Re-runnable: rows from a previous run stay in the test DB, so assert on the delta.
  const baseline = D((await buildFinanceOverview({ from: FROM, to: TO, groupBy: 'month' })).totals.netRevenue);

  // 1) Contract-like earning: 65,700 released to AVAILABLE, 19,823,000 still PENDING.
  const earn = await mkTxn('PT_CONTRACT', 20_000_000);
  await walletService.withWallets([revenue.id, escrow.id], earn.id, async (ops) => {
    await ops.credit(escrow.id, D(19_888_700), 'escrow intake');
    await ops.credit(revenue.id, D(65_700), 'platform commission released', 'AVAILABLE');
    await ops.credit(revenue.id, D(19_823_000), 'platform commission pending', 'PENDING');
  });
  // 2) A clawback on a refund: -5,700 (DEBIT AVAILABLE) under a REFUND transaction.
  const refund = await mkTxn('REFUND', 5_700);
  await walletService.withWallets([revenue.id, escrow.id], refund.id, async (ops) => {
    await ops.debit(revenue.id, D(5_700), 'commission clawed back', 'AVAILABLE');
    await ops.debit(escrow.id, D(5_700), 'refund paid out');
  });
  // 3) Platform takes 10,000 of its revenue out: must NOT read as lost revenue.
  const payout = await mkTxn('WITHDRAWAL', 10_000);
  await walletService.withWallets([revenue.id, escrow.id], payout.id, async (ops) => {
    await ops.debit(revenue.id, D(10_000), 'revenue withdrawal', 'AVAILABLE');
    await ops.debit(escrow.id, D(10_000), 'withdrawal paid');
  });
  await redate([earn.id, refund.id, payout.id], inMarch);

  // 4) Revenue outside the window (April): ignored.
  const april = await mkTxn('PT_CONTRACT', 1_000);
  await walletService.withWallets([revenue.id, escrow.id], april.id, async (ops) => {
    await ops.credit(escrow.id, D(1_000), 'escrow intake');
    await ops.credit(revenue.id, D(1_000), 'later commission', 'AVAILABLE');
  });
  await redate([april.id], new Date('2031-04-05T00:00:00Z'));


  const report = await buildFinanceOverview({ from: FROM, to: TO, groupBy: 'month' });

  assert.equal(D(report.totals.netRevenue).minus(baseline).toFixed(2), '60000.00', '65,700 earned - 5,700 clawed back; withdrawal and April excluded');
  assert.equal(report.buckets.find((b) => b.netRevenue !== '0.00')?.period, '2031-03-01T00:00:00.000Z');

  const recon = await buildReconciliationReport();
  assert.equal(report.platformRevenue.pending, recon.breakdown.platformRevenuePending);
  assert.equal(report.platformRevenue.available, recon.breakdown.platformRevenueAvailable);
  assert.ok(D(report.platformRevenue.pending).greaterThanOrEqualTo(19_823_000), 'pending revenue is surfaced separately');
});
