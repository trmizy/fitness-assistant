/**
 * P0 cluster C1 — one-time migration for historical marketplace sales credited to the wrong
 * wallet type.
 *
 * ai-service's paymentClient.walletTransfer (used by both TrainingPackage and, before the
 * C2/C3 escrow rewrite, Personalized Service purchases) hardcoded `receiverOwnerType: "CLIENT"`
 * regardless of who the receiver actually was — every seller on both paths is an approved PT
 * (assertApprovedPtSeller / assertApprovedPt gate it), so every such sale credited a
 * CLIENT-type wallet keyed by the PT's own userId instead of their real PT-type wallet.
 * `GET /me/pt-wallet` and `POST /me/withdrawals` are both hard-keyed to the PT wallet type —
 * that money was invisible and unwithdrawable, sitting in a wallet nobody's UI ever reads.
 *
 * This script finds every PAID TRAINING_PACKAGE_PURCHASE / PERSONALIZED_SERVICE_PURCHASE
 * transaction whose receiver wallet is CLIENT-type, and moves the exact net amount that
 * landed there (read from the transaction's own PlatformCommission.partnerPayoutAmount row —
 * the authoritative historical fact, never recomputed from the gross amount, which would risk
 * drifting from what was actually credited) over to the seller's real PT wallet. The move is
 * a real paired ledger debit+credit through walletService.withWallets — the SAME
 * wallet-locking primitive every other ledger write in this service uses — never a raw
 * UPDATE wallets SET available_balance = ... The platform's commission (already correctly
 * credited to REVENUE at the time of the original sale) is untouched; only the seller-facing
 * net amount changes wallets. The PlatformCommission row's own partnerType label is corrected
 * from CLIENT to PT alongside the money move, for reporting accuracy — it carries no money
 * itself.
 *
 * Idempotent by inspection: a transaction already corrected has a wallet_ledger_entries row
 * whose description starts with the MARKER below, so re-running finds nothing left to do for
 * it.
 *
 * Dry-run by default — prints exactly what it would move and why. Pass --apply to write.
 *
 * Usage (from backend/services/payment-service):
 *   npx tsx scripts/reconcile-misrouted-marketplace-wallets.ts           # report only
 *   npx tsx scripts/reconcile-misrouted-marketplace-wallets.ts --apply   # applies the fix
 */
import { prisma } from '../src/repositories/prisma';
import { Prisma } from '../src/generated/prisma';
import { walletService } from '../src/services/wallet.service';
import { assertInvariant } from '../src/services/reconcile.service';

export const MARKER = 'C1 misroute correction';

export interface MisroutedRow {
  transactionId: string;
  purpose: string;
  clientWalletId: string;
  ptUserId: string;
  netAmount: Prisma.Decimal;
}

export async function findMisrouted(): Promise<MisroutedRow[]> {
  const rows = await prisma.$queryRaw<
    { transaction_id: string; purpose: string; receiver_wallet_id: string; owner_id: string; partner_payout_amount: string }[]
  >(Prisma.sql`
    SELECT t.id AS transaction_id, t.purpose, t.receiver_wallet_id, w.owner_id, pc.partner_payout_amount
    FROM payment_transactions t
    JOIN wallets w ON w.id = t.receiver_wallet_id
    JOIN platform_commissions pc ON pc.payment_transaction_id = t.id
    WHERE t.purpose IN ('TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE')
      AND t.status = 'PAID'
      AND w.owner_type = 'CLIENT'
      AND NOT EXISTS (
        SELECT 1 FROM wallet_ledger_entries le
        WHERE le.transaction_id = t.id AND le.description LIKE ${MARKER + '%'}
      )
  `);
  return rows.map((r) => ({
    transactionId: r.transaction_id,
    purpose: r.purpose,
    clientWalletId: r.receiver_wallet_id,
    ptUserId: r.owner_id,
    netAmount: new Prisma.Decimal(r.partner_payout_amount),
  }));
}

export async function migrateOne(row: MisroutedRow): Promise<void> {
  const ptWallet = await walletService.getOrCreateWallet('PT', row.ptUserId);
  await walletService.withWallets([row.clientWalletId, ptWallet.id], row.transactionId, async (ops) => {
    // Clamp to whatever the CLIENT wallet actually still holds — a PT may have already
    // withdrawn from (or otherwise spent down) the misrouted balance before this script ran.
    // Moving less than the original net amount is the honest outcome; the gap is reported,
    // never invented out of thin air by pushing the wallet negative.
    const held = ops.balance(row.clientWalletId, 'AVAILABLE');
    const moving = held.lessThan(row.netAmount) ? held : row.netAmount;
    if (moving.lessThanOrEqualTo(0)) {
      console.warn(`  ! ${row.transactionId}: CLIENT wallet ${row.clientWalletId} has nothing left to move (originally ${row.netAmount.toFixed(2)}) — recording the marker with 0 so this is not retried forever`);
    } else {
      await ops.debit(row.clientWalletId, moving, `${MARKER} — moving to correct PT wallet`);
      await ops.credit(ptWallet.id, moving, `${MARKER} — earnings misrouted here on original sale`);
    }
    // Marker on the CLIENT wallet is written above even when moving is 0 is NOT true — a 0
    // amount debit/credit would be a no-op ledger entry that skips the description write, so
    // the marker itself is recorded as a zero-amount entry in that edge case.
    if (moving.lessThanOrEqualTo(0)) {
      await ops.tx.walletLedgerEntry.create({
        data: {
          walletId: row.clientWalletId,
          transactionId: row.transactionId,
          entryType: 'DEBIT',
          bucket: 'AVAILABLE',
          amount: new Prisma.Decimal(0),
          balanceBefore: held,
          balanceAfter: held,
          description: `${MARKER} — nothing left to move (originally ${row.netAmount.toFixed(2)})`,
        },
      });
    }
  });

  await prisma.platformCommission.updateMany({
    where: { paymentTransactionId: row.transactionId, partnerType: 'CLIENT' as any },
    data: { partnerType: 'PT' as any },
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const misrouted = await findMisrouted();

  if (misrouted.length === 0) {
    console.log('No misrouted marketplace transactions found — nothing to do.');
    return;
  }

  console.log(`Found ${misrouted.length} misrouted transaction(s):`);
  for (const row of misrouted) {
    console.log(`  ${row.transactionId} (${row.purpose}): ${row.netAmount.toFixed(2)} → PT wallet for user ${row.ptUserId}`);
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to actually move this money.');
    return;
  }

  for (const row of misrouted) {
    await migrateOne(row);
    console.log(`  ✓ migrated ${row.transactionId}`);
  }

  const report = await assertInvariant('C1 misroute reconciliation script');
  console.log(`\nDone. Reconciliation invariant holds: balanced=${report.balanced}, drift=${report.drift}`);
}

// Guarded so an integration test can `import { findMisrouted, migrateOne }` from this file
// (to prove the migration logic itself, without live misrouted data to run it against) without
// also triggering a real run — and a real invocation from the CLI still executes normally.
// require.main (not import.meta.url) so this stays valid under this project's CJS module
// target — tsx transpiles per-file at runtime regardless, but `tsc --noEmit` elsewhere in the
// project would otherwise reject import.meta outside an ESM module setting.
const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  main()
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
