/**
 * FH-8 - READ-ONLY backlog inventory for the payment database (entry point: scripts/fh8-inventory.ts).
 *
 * Counts and amounts only: no ids, no names, no free text, no connection string. The logic follows
 * _warroom/evidence/obligations_inventory_D57_payment.sql (P-01..P-09) and reuses the shared negative-wallet /
 * sub-ledger / mismatch statements from ledger-state-checks.ts. Runs in a READ ONLY transaction.
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { findNegativeSubledgers, findNegativeWallets, findWalletLedgerMismatches } from './ledger-state-checks';

export interface InventoryGroup {
  label: string;
  count: number;
  amount: string;
}

export interface Inventory {
  database: string;
  generatedAt: string;
  staleMinutes: number;
  escrow: { escrow: string; claims: string; drift: string };
  negativeWallets: number;
  negativeSubledgers: { count: number; unbackedTotal: string; byOwnerType: InventoryGroup[] };
  walletLedgerMismatches: { nonEscrow: number; escrowDifference: string };
  /** Positive PENDING sub-ledgers of non-contract purposes (orders / memberships) - money held for someone. */
  nonContractPending: InventoryGroup[];
  receivablesByOrigin: { origin: string; state: string; count: number; amount: string; recovered: string; waived: string; outstanding: string }[];
  fronted: { total: string; recovered: string; waived: string; outstanding: string };
  stuckPaid: InventoryGroup[];
  unpaidObligations: { kind: string; status: string; count: number; unpaid: string }[];
}

const money = (v: unknown) => new Prisma.Decimal(String(v ?? 0)).toFixed(2);

export function databaseNameFromUrl(url: string | undefined): string {
  try {
    return decodeURIComponent(new URL(url ?? '').pathname.replace(/^\/+/, ''));
  } catch {
    return '<unknown>';
  }
}

export async function buildInventory(opts: { staleMinutes?: number; databaseUrl?: string } = {}): Promise<Inventory> {
  const staleMinutes = opts.staleMinutes ?? 30;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const inv = (
        await tx.$queryRawUnsafe<{ escrow: string; claims: string }[]>(
          `SELECT (SELECT coalesce(sum(available_balance),0)::text FROM wallets WHERE owner_type='PLATFORM' AND owner_id='ESCROW') AS escrow,
                  (SELECT coalesce(sum(available_balance+pending_balance+locked_balance),0)::text FROM wallets WHERE NOT (owner_type='PLATFORM' AND owner_id='ESCROW')) AS claims`,
        )
      )[0];
      const negWallets = await findNegativeWallets(tx, 1);
      const negSub = await findNegativeSubledgers(tx, 1_000_000);
      const mism = await findWalletLedgerMismatches(tx, 1_000_000);

      const byOwner = new Map<string, { count: number; amount: Prisma.Decimal }>();
      for (const r of negSub.rows) {
        const g = byOwner.get(r.ownerType) ?? { count: 0, amount: new Prisma.Decimal(0) };
        g.count += 1;
        g.amount = g.amount.plus(new Prisma.Decimal(r.net).abs());
        byOwner.set(r.ownerType, g);
      }

      const nonContract = await tx.$queryRawUnsafe<{ purpose: string; c: number; amount: string }[]>(
        `SELECT purpose::text AS purpose, count(*)::int AS c, coalesce(sum(net),0)::text AS amount FROM (
           SELECT t.purpose, e.wallet_id, e.transaction_id,
                  sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) AS net
             FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id JOIN payment_transactions t ON t.id=e.transaction_id
            WHERE e.bucket='PENDING' AND NOT (w.owner_type='PLATFORM' AND w.owner_id='ESCROW') AND t.purpose <> 'PT_CONTRACT'
            GROUP BY t.purpose, e.wallet_id, e.transaction_id
           HAVING sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) > 0) s
         GROUP BY purpose ORDER BY purpose`,
      );

      const rec = await tx.$queryRawUnsafe<any[]>(
        `SELECT CASE WHEN reason ILIKE '%no-show%' THEN 'NO_SHOW'
                     WHEN reason ILIKE '%late%' THEN 'LATE_ARRIVAL'
                     WHEN reason ILIKE '%clawback%' THEN 'REFERRAL_CLAWBACK'
                     WHEN reason ILIKE '%refund%' THEN 'REFUND_SHORTFALL'
                     ELSE 'OTHER' END AS origin,
                CASE WHEN settled_at IS NOT NULL THEN 'CLOSED' WHEN suspended_at IS NOT NULL THEN 'SUSPENDED' ELSE 'ACTIVE' END AS state,
                count(*)::int AS c, sum(amount)::text AS amount, sum(recovered)::text AS recovered, sum(waived)::text AS waived,
                sum(amount-recovered-waived)::text AS outstanding
           FROM partner_receivables GROUP BY 1,2 ORDER BY 1,2`,
      );
      const fronted = (
        await tx.$queryRawUnsafe<any[]>(
          `SELECT coalesce(sum(amount),0)::text AS total, coalesce(sum(recovered),0)::text AS recovered,
                  coalesce(sum(waived),0)::text AS waived, coalesce(sum(amount-recovered-waived),0)::text AS outstanding
             FROM partner_receivables`,
        )
      )[0];

      const stuck = await tx.$queryRawUnsafe<{ label: string; c: number; amount: string }[]>(
        `SELECT purpose::text || ' / ' || activation_status::text AS label, count(*)::int AS c, coalesce(sum(amount),0)::text AS amount
           FROM payment_transactions
          WHERE status='PAID' AND activation_status IN ('PENDING','ACTIVATION_FAILED')
            AND paid_at < now() - ($1::int * interval '1 minute')
          GROUP BY 1 ORDER BY 1`,
        staleMinutes,
      );
      const ob = await tx.$queryRawUnsafe<any[]>(
        `SELECT kind::text AS kind, status::text AS status, count(*)::int AS c, coalesce(sum(unpaid),0)::text AS unpaid
           FROM contract_unpaid_obligations GROUP BY 1,2 ORDER BY 1,2`,
      );

      const escrowDiff = mism.rows.find((r) => r.isEscrow);
      const drift = new Prisma.Decimal(inv.escrow).minus(new Prisma.Decimal(inv.claims));
      return {
        database: databaseNameFromUrl(opts.databaseUrl ?? process.env.DATABASE_URL),
        generatedAt: new Date().toISOString(),
        staleMinutes,
        escrow: { escrow: money(inv.escrow), claims: money(inv.claims), drift: drift.toFixed(2) },
        negativeWallets: negWallets.total,
        negativeSubledgers: {
          count: negSub.total,
          unbackedTotal: negSub.unbackedTotal,
          byOwnerType: [...byOwner.entries()].map(([label, g]) => ({ label, count: g.count, amount: g.amount.toFixed(2) })),
        },
        walletLedgerMismatches: { nonEscrow: mism.nonEscrowTotal, escrowDifference: escrowDiff ? escrowDiff.difference : '0.00' },
        nonContractPending: nonContract.map((r) => ({ label: r.purpose, count: r.c, amount: money(r.amount) })),
        receivablesByOrigin: rec.map((r) => ({
          origin: r.origin,
          state: r.state,
          count: r.c,
          amount: money(r.amount),
          recovered: money(r.recovered),
          waived: money(r.waived),
          outstanding: money(r.outstanding),
        })),
        fronted: { total: money(fronted.total), recovered: money(fronted.recovered), waived: money(fronted.waived), outstanding: money(fronted.outstanding) },
        stuckPaid: stuck.map((r) => ({ label: r.label, count: r.c, amount: money(r.amount) })),
        unpaidObligations: ob.map((r) => ({ kind: r.kind, status: r.status, count: r.c, unpaid: money(r.unpaid) })),
      } satisfies Inventory;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000, maxWait: 10_000 },
  );
}

export function formatInventory(i: Inventory): string[] {
  const L: string[] = [];
  L.push(`FH-8 inventory (READ ONLY) database=${i.database} at ${i.generatedAt} (stale threshold ${i.staleMinutes} min)`);
  L.push(`P-01 escrow=${i.escrow.escrow} claims=${i.escrow.claims} drift=${i.escrow.drift}`);
  L.push(`P-02 wallets with a negative bucket: ${i.negativeWallets}`);
  L.push(`P-03 non-escrow wallet buckets != ledger: ${i.walletLedgerMismatches.nonEscrow}; escrow wallet - ledger = ${i.walletLedgerMismatches.escrowDifference}`);
  L.push(`P-04 negative PENDING sub-ledgers: ${i.negativeSubledgers.count}; unbacked total ${i.negativeSubledgers.unbackedTotal}`);
  for (const g of i.negativeSubledgers.byOwnerType) L.push(`       ${g.label}: ${g.count} sub-ledger(s), ${g.amount}`);
  L.push('P-05 positive PENDING sub-ledgers of non-contract purposes:');
  if (i.nonContractPending.length === 0) L.push('       none');
  for (const g of i.nonContractPending) L.push(`       ${g.label}: ${g.count}, ${g.amount}`);
  L.push('P-06 partner receivables by origin / state (count, amount, recovered, waived, outstanding):');
  if (i.receivablesByOrigin.length === 0) L.push('       none');
  for (const r of i.receivablesByOrigin) L.push(`       ${r.origin} / ${r.state}: ${r.count}, ${r.amount}, ${r.recovered}, ${r.waived}, ${r.outstanding}`);
  L.push(`       fronted total ${i.fronted.total}, recovered ${i.fronted.recovered}, waived ${i.fronted.waived}, outstanding ${i.fronted.outstanding}`);
  L.push('P-07 PAID but not activated beyond the threshold:');
  if (i.stuckPaid.length === 0) L.push('       none');
  for (const g of i.stuckPaid) L.push(`       ${g.label}: ${g.count}, ${g.amount}`);
  L.push('P-08 unpaid obligations by kind / status (count, unpaid):');
  if (i.unpaidObligations.length === 0) L.push('       none');
  for (const o of i.unpaidObligations) L.push(`       ${o.kind} / ${o.status}: ${o.count}, ${o.unpaid}`);
  return L;
}
