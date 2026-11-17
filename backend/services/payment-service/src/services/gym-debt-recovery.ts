import { Prisma } from '../generated/prisma';
import type { LedgerOps } from './wallet.service';

/**
 * FIX3-PAY (owner decision 15/11/2026) - automatic recovery of an open GYM_DEBT from the gym's NEXT income.
 *
 * A GYM_DEBT obligation (membership-appeal-supplement.service.ts) is what the PLATFORM fronted out of REVENUE when a gym's AVAILABLE wallet could not fund its share of a
 * supplementary refund. From then on, EVERY credit that lands in that gym wallet's AVAILABLE bucket first repays the platform, inside the SAME DB transaction as the credit:
 *
 *   recovered = min(the credit that just landed, what is still unpaid), oldest obligation first
 *   gym wallet AVAILABLE   -recovered      (never more than the credit, so the wallet can never go negative because of this)
 *   REVENUE wallet AVAILABLE +recovered    (the platform gets back what it fronted; escrow does not move, so assertInvariant stays exact)
 *   obligation.paid += recovered, unpaid -= recovered; unpaid = 0 closes it as RESOLVED_OTHER (the same status holdback-review.service.ts uses when a ledger path
 *     settles an obligation; the "paid to the CLIENT by the session settlement" status stays single-writer, audited by fh-d77)
 *   one append-only RECOVER_FROM_INCOME event per obligation per credit (the timeline the admin reads)
 *
 * Idempotency: the credit event IS a wallet ledger entry (unique id, created exactly once inside an idempotent ledger operation). The event row is keyed
 * `GYM_DEBT_RECOVERY:<obligationId>:<creditEntryId>` (unique), so a replayed operation moves nothing and even a re-run of this function cannot recover twice for one credit.
 *
 * Only OPEN / UNDER_REVIEW obligations are touched. APPROVED_FOR_PAYMENT / AWAITING_EVIDENCE mean a person is collecting it manually outside the ledger - the money is
 * left alone (it is still kept out of the gym's withdrawable amount, see withdrawal.service.ts) so the two collection routes can never both take it.
 */

export const GYM_DEBT_RECOVERY_ACTOR = 'SYSTEM:GYM_DEBT_AUTO_RECOVERY';
/** Ledger description fragment (wallet-entry-category.ts reads it): both legs carry it. */
export const GYM_DEBT_RECOVERED_FRAGMENT = '— gym debt recovered from income';

/** 9000 -> "9.000đ" (the admin reads these notes). */
const vnd = (v: Prisma.Decimal) => `${v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

interface DebtRow {
  id: string;
  status: string;
  owed: unknown;
  paid: unknown;
  unpaid: unknown;
}

/** The gym's recoverable obligations, oldest first, row-locked (the admin lifecycle takes the same lock). */
export async function lockRecoverableGymDebts(tx: Prisma.TransactionClient, gymId: string): Promise<DebtRow[]> {
  return tx.$queryRaw<DebtRow[]>(Prisma.sql`
    SELECT o.id, o.status::text AS status, o.owed, o.paid, o.unpaid
      FROM contract_unpaid_obligations o
      JOIN payment_transactions t ON t.id = o.transaction_id
     WHERE o.kind::text = 'GYM_DEBT'
       AND o.status::text IN ('OPEN', 'UNDER_REVIEW')
       AND o.unpaid > 0
       AND (t.metadata -> 'parties' ->> 'gymId') = ${gymId}
     ORDER BY o.created_at ASC, o.id ASC
       FOR UPDATE OF o`);
}

/**
 * Called by the wallet layer right after `credit` landed in a GYM wallet's AVAILABLE bucket. Both wallets are already locked by `ops`.
 * Returns what was recovered (0 when the gym has no recoverable debt).
 */
export async function recoverGymDebtFromCredit(
  ops: LedgerOps,
  p: { gymWalletId: string; gymId: string; revenueWalletId: string; creditEntryId: string; creditAmount: Prisma.Decimal; creditDescription: string },
): Promise<Prisma.Decimal> {
  const zero = new Prisma.Decimal(0);
  if (p.creditAmount.lessThanOrEqualTo(0)) return zero;
  const debts = await lockRecoverableGymDebts(ops.tx, p.gymId);
  if (debts.length === 0) return zero;

  let room = p.creditAmount; // never more than what this credit just made available
  let total = zero;
  for (const d of debts) {
    if (room.lessThanOrEqualTo(0)) break;
    const unpaid = new Prisma.Decimal(String(d.unpaid));
    const paid = new Prisma.Decimal(String(d.paid));
    const take = Prisma.Decimal.min(room, unpaid);
    if (take.lessThanOrEqualTo(0)) continue;
    const remaining = unpaid.minus(take);
    const closing = remaining.lessThanOrEqualTo(0);
    const note = `${p.creditDescription} ${GYM_DEBT_RECOVERED_FRAGMENT} (obligation ${d.id.slice(0, 8)})`;

    await ops.debit(p.gymWalletId, take, note, 'AVAILABLE');
    await ops.credit(p.revenueWalletId, take, `${note} - platform repaid`, 'AVAILABLE');

    await ops.tx.contractUnpaidObligation.update({
      where: { id: d.id },
      data: {
        paid: paid.plus(take),
        unpaid: remaining,
        ...(closing
          ? { status: 'RESOLVED_OTHER', resolvedAt: new Date(), resolvedBy: GYM_DEBT_RECOVERY_ACTOR, resolvedNote: 'Đã thu hồi đủ từ thu nhập mới của phòng gym (tự động)' }
          : {}),
      },
    });
    await ops.tx.contractUnpaidObligationEvent.create({
      data: {
        obligationId: d.id,
        action: 'RECOVER_FROM_INCOME',
        note: `Tự động thu hồi ${vnd(take)} từ khoản thu nhập mới của phòng gym; ${closing ? 'khoản nợ đã được trả đủ' : `còn nợ ${vnd(remaining)}`}`,
        actor: GYM_DEBT_RECOVERY_ACTOR,
        approvalRef: p.creditEntryId,
        idempotencyKey: `GYM_DEBT_RECOVERY:${d.id}:${p.creditEntryId}`,
        fromStatus: d.status as any,
        toStatus: (closing ? 'RESOLVED_OTHER' : d.status) as any,
        unpaid,
        paidAmount: take,
        unpaidAfter: remaining,
      },
    });
    room = room.minus(take);
    total = total.plus(take);
  }
  return total;
}

/** What a gym still owes the platform through open GYM_DEBT obligations that are not closed (any non-terminal status). */
export async function gymDebtUnpaid(client: Prisma.TransactionClient | { $queryRaw: Prisma.TransactionClient['$queryRaw'] }, gymId: string): Promise<Prisma.Decimal> {
  const rows = await client.$queryRaw<Array<{ total: unknown }>>(Prisma.sql`
    SELECT COALESCE(SUM(o.unpaid), 0) AS total
      FROM contract_unpaid_obligations o
      JOIN payment_transactions t ON t.id = o.transaction_id
     WHERE o.kind::text = 'GYM_DEBT'
       AND o.status::text IN ('OPEN', 'UNDER_REVIEW', 'APPROVED_FOR_PAYMENT', 'AWAITING_EVIDENCE')
       AND (t.metadata -> 'parties' ->> 'gymId') = ${gymId}`);
  return new Prisma.Decimal(String(rows[0]?.total ?? 0));
}

export interface GymDebtSummary {
  /** Still owed to the platform (open GYM_DEBT, any non-terminal status). */
  openUnpaid: string;
  /** Total already recovered automatically from the gym's income. */
  recoveredTotal: string;
  /** Newest first, at most 10: one row per automatic recovery (the gym-owner wallet view shows them as "Đã trừ nợ nền tảng"). */
  recent: Array<{ at: string; amount: string; unpaidAfter: string }>;
}

/** Read-only summary for the gym-owner wallet view (GET /internal/wallets/GYM/:gymId adds it, additive). */
export async function gymDebtSummary(client: { $queryRaw: Prisma.TransactionClient['$queryRaw'] }, gymId: string): Promise<GymDebtSummary> {
  const openUnpaid = await gymDebtUnpaid(client, gymId);
  const rows = await client.$queryRaw<Array<{ at: Date; amount: unknown; unpaid_after: unknown }>>(Prisma.sql`
    SELECT e.created_at AS at, e.paid_amount AS amount, e.unpaid_after
      FROM contract_unpaid_obligation_events e
      JOIN contract_unpaid_obligations o ON o.id = e.obligation_id
      JOIN payment_transactions t ON t.id = o.transaction_id
     WHERE e.action::text = 'RECOVER_FROM_INCOME'
       AND (t.metadata -> 'parties' ->> 'gymId') = ${gymId}
     ORDER BY e.created_at DESC, e.id DESC`);
  const recoveredTotal = rows.reduce((s, r) => s.plus(new Prisma.Decimal(String(r.amount ?? 0))), new Prisma.Decimal(0));
  return {
    openUnpaid: openUnpaid.toFixed(2),
    recoveredTotal: recoveredTotal.toFixed(2),
    recent: rows.slice(0, 10).map((r) => ({ at: new Date(r.at).toISOString(), amount: new Prisma.Decimal(String(r.amount ?? 0)).toFixed(2), unpaidAfter: new Prisma.Decimal(String(r.unpaid_after ?? 0)).toFixed(2) })),
  };
}
