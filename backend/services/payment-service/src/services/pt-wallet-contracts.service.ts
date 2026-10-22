import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { splitThreeWays, type RateTable } from './contract-money';
import { UNRESOLVED_HELD_MARKER, UNRESOLVED_RESOLVED_MARKER } from './contract-ledger.service';

/**
 * FH-9 - what a PT sees per contract (GET /me/pt-wallet/contracts). READ ONLY, derived from the ledger, never stored.
 *
 * There is exactly ONE real pot of money per contract: the client's payment sitting in ESCROW. What this view shows are the
 * PT's CLAIMS on it, in the order they become real, so no number here is "phantom money":
 *
 *   contractValue        what the client paid for the contract (not the PT's money)
 *   expectedIncome       the PT's share of it under the contract's frozen rates, if every session is delivered
 *   pending              the PT's share of sessions not yet delivered (NOT earned yet)
 *   earned               what the PT has earned so far: paid to AVAILABLE + still held   (compensation paid to a client is not earned)
 *   held                 earned but held back until the contract ends and is reconciled (NOT withdrawable)
 *   availableFromContract  what this contract has already paid into the PT's AVAILABLE balance (withdrawable once in AVAILABLE)
 *   compensationPaid     the part of the hold used for the contract's own verified PT-fault compensation
 *   release              when the held money comes back: only when the contract has ended AND is reconciled - never a date
 *
 * Wallet-level numbers (AVAILABLE, LOCKED/paid out) come from the wallet itself; this adds the per-contract breakdown.
 */

export type HoldbackReleaseState =
  | 'NO_HOLDBACK' // nothing is held back on this contract
  | 'RUNNING' // the contract is running: released when it has ended and is reconciled
  | 'WAITING_RECONCILIATION' // ended, but something of THIS contract is not settled yet (an obligation or an undecided session)
  | 'RELEASED'; // ended, reconciled, nothing held any more

export interface PtWalletContractRow {
  contractId: string | null;
  transactionId: string;
  paidAt: string | null;
  contractValue: string;
  expectedIncome: string;
  /** The hold's target for this contract (0 when the contract carries no holdback). */
  holdbackTarget: string;
  pending: string;
  earned: string;
  held: string;
  availableFromContract: string;
  compensationPaid: string;
  release: {
    state: HoldbackReleaseState;
    ended: boolean;
    /** Held because of a dispute / undecided session of THIS contract. */
    heldDueToDispute: boolean;
    undecidedSessions: number;
    /** Unpaid amount of this contract's OPEN obligations. */
    openObligations: string;
    /** What is kept in HOLDBACK as a reserve for a related item of THIS contract (each reserve has a review deadline). */
    reserved: string;
    /** A potential PT-fault amount (or a risk that could not be computed) is waiting for an admin decision. Nothing is paid before it is verified. */
    pendingFaultReview: boolean;
    /** The earliest review-by deadline of the open reserves, if any. */
    reviewBy: string | null;
    reviewOverdue: boolean;
  };
}

export interface PtWalletContractsView {
  generatedAt: string;
  wallet: { available: string; pending: string; held: string; locked: string };
  contracts: PtWalletContractRow[];
  totals: { held: string; heldDueToDispute: string; contractsHolding: number };
}

const money = (v: unknown) => new Prisma.Decimal(String(v ?? 0)).toFixed(2);

export async function buildPtWalletContractsView(ptUserId: string, opts: { limit?: number } = {}): Promise<PtWalletContractsView> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const wallet = await prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'PT', ownerId: ptUserId } } });
  const zero = money(0);
  if (!wallet) {
    return { generatedAt: new Date().toISOString(), wallet: { available: zero, pending: zero, held: zero, locked: zero }, contracts: [], totals: { held: zero, heldDueToDispute: zero, contractsHolding: 0 } };
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT e.transaction_id,
                t.amount::text AS price, t.metadata, t.paid_at, t.related_entity_id,
                coalesce(sum(CASE WHEN e.bucket='AVAILABLE' AND e.entry_type='CREDIT' THEN e.amount ELSE 0 END),0)::text AS avail_credit,
                coalesce(sum(CASE WHEN e.bucket='HOLDBACK' THEN (CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) ELSE 0 END),0)::text AS held,
                coalesce(sum(CASE WHEN e.bucket='PENDING' THEN (CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) ELSE 0 END),0)::text AS pending,
                coalesce(sum(CASE WHEN e.bucket='HOLDBACK' AND e.entry_type='DEBIT' AND e.description LIKE '%used for compensation%' THEN e.amount ELSE 0 END),0)::text AS comp
           FROM wallet_ledger_entries e
           JOIN payment_transactions t ON t.id = e.transaction_id
          WHERE e.wallet_id = $1 AND t.purpose = 'PT_CONTRACT'
          GROUP BY e.transaction_id, t.amount, t.metadata, t.paid_at, t.related_entity_id
          ORDER BY t.paid_at DESC NULLS LAST, e.transaction_id
          LIMIT $2`,
        wallet.id,
        limit,
      );
      const ids = rows.map((r) => r.transaction_id as string);

      const endedRows = ids.length
        ? await tx.$queryRawUnsafe<{ transaction_id: string }[]>(
            `SELECT DISTINCT transaction_id FROM ledger_operations WHERE kind = 'TERMINATE' AND transaction_id = ANY($1::text[])`,
            ids,
          )
        : [];
      const ended = new Set(endedRows.map((r) => r.transaction_id));

      const obRows = ids.length
        ? await tx.$queryRawUnsafe<{ transaction_id: string; unpaid: string }[]>(
            `SELECT transaction_id, coalesce(sum(unpaid),0)::text AS unpaid FROM contract_unpaid_obligations
              WHERE transaction_id = ANY($1::text[]) AND unpaid > 0
                AND status IN ('OPEN','UNDER_REVIEW','APPROVED_FOR_PAYMENT','AWAITING_EVIDENCE','PAID_EXTERNALLY')
              GROUP BY transaction_id`,
            ids,
          )
        : [];
      const openOb = new Map(obRows.map((r) => [r.transaction_id, r.unpaid]));

      // Unresolved-session markers live in the platform REVENUE wallet's PENDING bucket (zero-amount rows).
      const markers = ids.length
        ? await tx.$queryRawUnsafe<{ transaction_id: string; description: string }[]>(
            `SELECT e.transaction_id, e.description FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
              WHERE w.owner_type = 'PLATFORM' AND w.owner_id = 'REVENUE' AND e.bucket = 'PENDING'
                AND e.transaction_id = ANY($1::text[])
                AND (e.description LIKE $2 OR e.description LIKE $3)`,
            ids,
            `%${UNRESOLVED_HELD_MARKER}%`,
            `%${UNRESOLVED_RESOLVED_MARKER}%`,
          )
        : [];
      const undecided = new Map<string, number>();
      for (const id of ids) {
        const mine = markers.filter((m) => m.transaction_id === id);
        const opened = mine.find((m) => m.description.includes(UNRESOLVED_HELD_MARKER));
        const n = opened ? Number(opened.description.split(UNRESOLVED_HELD_MARKER).pop()) : 0;
        const resolved = mine.filter((m) => m.description.includes(UNRESOLVED_RESOLVED_MARKER)).length;
        undecided.set(id, Number.isInteger(n) && n > 0 ? Math.max(0, n - resolved) : 0);
      }

      const revRows = ids.length
        ? await tx.$queryRawUnsafe<{ transaction_id: string; kind: string; reserve: string; review_by: Date }[]>(
            `SELECT transaction_id, kind::text AS kind, reserve::text AS reserve, review_by FROM pt_holdback_reviews WHERE status = 'OPEN' AND transaction_id = ANY($1::text[])`,
            ids,
          )
        : [];
      const reviewsOf = (id: string) => revRows.filter((r) => r.transaction_id === id);

      let totalHeld = new Prisma.Decimal(0);
      let totalDispute = new Prisma.Decimal(0);
      let holding = 0;
      const contracts: PtWalletContractRow[] = rows.map((r) => {
        const meta = (r.metadata ?? {}) as { rates?: Record<string, string>; ptHoldback?: { target?: string } };
        let expected = new Prisma.Decimal(0);
        if (meta.rates) {
          try {
            const rates: RateTable = {
              platformRate: new Prisma.Decimal(meta.rates.platformRate ?? 0),
              ptRate: new Prisma.Decimal(meta.rates.ptRate ?? 0),
              gymRate: new Prisma.Decimal(meta.rates.gymRate ?? 0),
            };
            expected = splitThreeWays(new Prisma.Decimal(r.price), rates).pt;
          } catch {
            expected = new Prisma.Decimal(0);
          }
        }
        const held = Prisma.Decimal.max(new Prisma.Decimal(r.held), 0);
        const isEnded = ended.has(r.transaction_id);
        const obligations = new Prisma.Decimal(openOb.get(r.transaction_id) ?? 0);
        const undecidedN = undecided.get(r.transaction_id) ?? 0;
        const hasHoldback = new Prisma.Decimal(meta.ptHoldback?.target ?? 0).greaterThan(0);
        const state: HoldbackReleaseState = !hasHoldback && held.isZero()
          ? 'NO_HOLDBACK'
          : !isEnded
            ? 'RUNNING'
            : held.greaterThan(0)
              ? 'WAITING_RECONCILIATION'
              : 'RELEASED';
        const reviews = reviewsOf(r.transaction_id);
        const reserved = reviews.reduce((a, x) => a.plus(x.reserve), new Prisma.Decimal(0));
        const faultPending = reviews.some((x) => x.kind === 'UNCOMPUTABLE');
        const earliest = reviews.map((x) => new Date(x.review_by).getTime()).sort((a, b) => a - b)[0];
        const dispute = held.greaterThan(0) && isEnded && reviews.length > 0;
        if (held.greaterThan(0)) {
          totalHeld = totalHeld.plus(held);
          holding += 1;
        }
        if (dispute) totalDispute = totalDispute.plus(held);
        const availCredit = new Prisma.Decimal(r.avail_credit);
        return {
          contractId: r.related_entity_id ?? null,
          transactionId: r.transaction_id,
          paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
          contractValue: money(r.price),
          expectedIncome: expected.toFixed(2),
          holdbackTarget: money(meta.ptHoldback?.target ?? 0),
          pending: money(Prisma.Decimal.max(new Prisma.Decimal(r.pending), 0)),
          earned: availCredit.plus(held).toFixed(2),
          held: held.toFixed(2),
          availableFromContract: availCredit.toFixed(2),
          compensationPaid: money(r.comp),
          release: {
            state,
            ended: isEnded,
            heldDueToDispute: dispute,
            undecidedSessions: undecidedN,
            openObligations: obligations.toFixed(2),
            reserved: reserved.toFixed(2),
            pendingFaultReview: faultPending,
            reviewBy: earliest === undefined ? null : new Date(earliest).toISOString(),
            reviewOverdue: earliest !== undefined && earliest < Date.now(),
          },
        };
      });

      return {
        generatedAt: new Date().toISOString(),
        wallet: {
          available: wallet.availableBalance.toFixed(2),
          pending: wallet.pendingBalance.toFixed(2),
          held: wallet.holdbackBalance.toFixed(2),
          locked: wallet.lockedBalance.toFixed(2),
        },
        contracts,
        totals: { held: totalHeld.toFixed(2), heldDueToDispute: totalDispute.toFixed(2), contractsHolding: holding },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000, maxWait: 10_000 },
  );
}
