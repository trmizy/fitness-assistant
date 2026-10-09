import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import {
  assertHoldbackRateValid,
  computeLateArrivalCompensation,
  computeNoShowCompensation,
  computeSessionRelease,
  computeTermination,
  holdbackTarget,
  splitReleaseWithHoldback,
  splitThreeWays,
  type RateTable,
  type TerminationReason,
  ZERO,
} from './contract-money';
import { pendingForTransaction, walletService, type LedgerOps } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';

/**
 * Moves the money a contract's formulas call for.
 *
 * Split of responsibility: contract-money.ts decides the amounts and proves they reconcile,
 * this file writes them to the ledger. Every routine here runs inside one wallet-locked DB
 * transaction, so a split either lands whole or not at all.
 *
 * Direction of travel, once:
 *   payment  → ESCROW gains P; each party's PENDING bucket gains rate × P
 *   release  → a party's PENDING falls, their AVAILABLE rises (ESCROW untouched: still held)
 *   payout   → a party's AVAILABLE falls and ESCROW falls (cash actually left the building)
 *   refund   → a party's PENDING falls, the client's AVAILABLE rises (ESCROW untouched)
 *
 * ESCROW only changes when money genuinely enters or leaves the platform. Shuffling between
 * buckets and between parties is a reallocation of the same held cash, which is precisely
 * why the reconciliation invariant survives every one of these operations.
 */

export interface ContractParties {
  ptUserId: string;
  gymId?: string | null;
  clientUserId: string;
}

interface ResolvedWallets {
  escrowId: string;
  revenueId: string;
  ptId: string;
  gymId: string | null;
  clientId: string;
  all: string[];
}

async function resolveWallets(parties: ContractParties): Promise<ResolvedWallets> {
  const [escrow, revenue, pt, client] = await Promise.all([
    walletService.getEscrowWallet(),
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('PT', parties.ptUserId),
    walletService.getOrCreateWallet('CLIENT', parties.clientUserId),
  ]);
  const gym = parties.gymId ? await walletService.getOrCreateWallet('GYM', parties.gymId) : null;

  const all = [escrow.id, revenue.id, pt.id, client.id];
  if (gym) all.push(gym.id);
  return {
    escrowId: escrow.id,
    revenueId: revenue.id,
    ptId: pt.id,
    gymId: gym?.id ?? null,
    clientId: client.id,
    all,
  };
}

/**
 * How much PENDING one contract still has in one wallet — never the wallet's pooled bucket.
 *
 * A PT, a gym and the platform REVENUE account each have ONE wallet, and its pending bucket
 * holds the not-yet-earned money of every contract that party is running (plus, for a gym, its
 * memberships and, for a PT, referral commissions). `ops.balance(walletId, 'PENDING')` is the
 * whole pot. Reading it as "this contract's pending" let one contract's termination drain its
 * neighbours' money and book it to REVENUE as a "forfeited share".
 *
 * Every ledger call for a contract runs under the contract's own payment transaction id
 * (withWallets stamps it on each row), so the contract's pending is what the PENDING rows
 * carrying that id net to — the same derivation membership-ledger.service.ts uses.
 *
 * Clamped to [0, what the wallet really holds]. On a database where the old pooled drain has
 * run, a terminated contract's rows net NEGATIVE (it debited its neighbours' pending under its
 * own id) and a neighbour's can net MORE than the wallet still holds. Treating the first as
 * nothing and capping the second at the bucket means this can never push a bucket below zero
 * nor hand a contract money the wallet does not have; whatever the contract is then short of
 * surfaces through the shortfall paths every caller already has.
 */
export async function ownPending(ops: LedgerOps, walletId: string, transactionId: string): Promise<Prisma.Decimal> {
  const own = await pendingForTransaction(ops, walletId, transactionId);
  const held = ops.balance(walletId, 'PENDING');
  if (own.lessThanOrEqualTo(0)) return ZERO;
  return own.lessThan(held) ? own : held;
}

// ── PT holdback bookkeeping ──────────────────────────────────────────────────
//
// A contract that carries a holdback rate keeps the FIRST money its PT earns in the PT's
// PENDING bucket instead of releasing it (contract-money.ts, splitReleaseWithHoldback). That
// money never leaves PENDING, so the bucket balance alone cannot say how much of it is "held"
// as opposed to "unearned, for a session not yet delivered" — both are pending money of the
// same contract. Rather than trust a number from the caller, the pot is derived from this
// contract's own ledger rows, which are written under the contract's payment transaction id:
//
//   held = Σ PENDING credits described "… PT holdback retained"
//        − Σ PENDING debits  described "… PT holdback released (no activity)"
//
// releaseSession writes a retained row for each session's held part (and releases that part
// from "unearned" with the ordinary release-to-available debit, so the net PENDING movement
// is exactly what a contract without a holdback posts: the amount actually paid out).
// releasePtHoldback writes the released row. Termination needs no row of its own: it ends the
// contract and drains its pending, and every later read is clamped to ownPending.
//
// The descriptions are matched by suffix, so the label a caller chooses can never collide.
export const HOLDBACK_RETAINED_SUFFIX = ' — PT holdback retained';
export const HOLDBACK_RELEASED_SUFFIX = ' — PT holdback released (no activity)';

/**
 * What is held back for the PT on this contract right now: the ledger-derived pot, never more
 * than the contract's own pending the PT really has (a PT no-show charge draws on the same
 * pending pool and can, in the extreme, eat into the pot — `held` is then simply what is left).
 */
export async function ptHeld(ops: LedgerOps, ptWalletId: string, transactionId: string): Promise<Prisma.Decimal> {
  const rows = await ops.tx.walletLedgerEntry.findMany({
    where: {
      walletId: ptWalletId,
      transactionId,
      bucket: 'PENDING',
      OR: [
        { entryType: 'CREDIT', description: { endsWith: HOLDBACK_RETAINED_SUFFIX } },
        { entryType: 'DEBIT', description: { endsWith: HOLDBACK_RELEASED_SUFFIX } },
      ],
    },
    select: { entryType: true, amount: true },
  });
  const pot = rows.reduce(
    (sum, r) => (r.entryType === 'CREDIT' ? sum.plus(r.amount) : sum.minus(r.amount)),
    ZERO,
  );
  if (pot.lessThanOrEqualTo(0)) return ZERO;
  const pending = await ownPending(ops, ptWalletId, transactionId);
  return pot.lessThan(pending) ? pot : pending;
}

/**
 * Whether this contract's holdback was already released for inactivity. Once it has been, the
 * contract carries on WITHOUT a holdback — later sessions release in full and a later PT-fault
 * ending pays no compensation — and payment-service enforces that itself, from the ledger,
 * rather than relying on the caller's flag having been saved before the next call arrives.
 */
async function holdbackWasReleased(ops: LedgerOps, ptWalletId: string, transactionId: string): Promise<boolean> {
  const marker = await ops.tx.walletLedgerEntry.findFirst({
    where: {
      walletId: ptWalletId,
      transactionId,
      bucket: 'PENDING',
      entryType: 'DEBIT',
      description: { endsWith: HOLDBACK_RELEASED_SUFFIX },
    },
    select: { id: true },
  });
  return marker !== null;
}

/**
 * A gym share must never be credited when there is no gym wallet to hold it. Rather than
 * silently dropping the money (which would break the invariant), refuse the operation —
 * resolveRates already guarantees gymRate is 0 whenever gymId is absent, so reaching here
 * means the rate table and the parties disagree.
 */
function assertGymConsistency(wallets: ResolvedWallets, gymAmount: Prisma.Decimal): void {
  if (gymAmount.greaterThan(0) && !wallets.gymId) {
    throw new Error(`Rate table allocates ${gymAmount.toString()} to a gym, but the contract has no gymId`);
  }
}

export interface SettlementResult {
  escrowAfter: string;
  pending: { pt: string; gym: string; platform: string };
}

/**
 * Step 1 of the lifecycle: the gateway confirmed the client paid.
 *
 * The whole price lands in escrow, and is simultaneously attributed to the three parties'
 * pending buckets. Nobody can withdraw any of it yet — the sessions have not happened.
 */
export async function settleContractPayment(params: {
  transactionId: string;
  price: Prisma.Decimal;
  rates: RateTable;
  parties: ContractParties;
  label: string;
}): Promise<SettlementResult> {
  const { transactionId, price, rates, parties, label } = params;
  if (price.lessThanOrEqualTo(0)) throw new Error('price must be > 0');

  const wallets = await resolveWallets(parties);
  const split = splitThreeWays(price, rates);
  assertGymConsistency(wallets, split.gym);

  return walletService.withWallets(wallets.all, transactionId, async (ops) => {
    // Compare-and-swap first: only the caller that actually flips the transaction to PAID may
    // move money. Two webhook deliveries racing here serialise on the wallet locks, and the
    // loser sees status already PAID and does nothing. Same guard the top-up path uses.
    const flipped = await ops.tx.paymentTransaction.updateMany({
      where: { id: transactionId, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (flipped.count === 0) {
      logger.info(`[ContractLedger] Transaction ${transactionId} already settled — skipping`);
      return {
        escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
        pending: {
          pt: ops.balance(wallets.ptId, 'PENDING').toFixed(2),
          gym: wallets.gymId ? ops.balance(wallets.gymId, 'PENDING').toFixed(2) : '0.00',
          platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
        },
      };
    }

    await ops.credit(wallets.escrowId, price, `${label} — received`);
    if (split.pt.greaterThan(0)) await ops.credit(wallets.ptId, split.pt, `${label} — PT share`, 'PENDING');
    if (split.gym.greaterThan(0)) await ops.credit(wallets.gymId!, split.gym, `${label} — gym share`, 'PENDING');
    if (split.platform.greaterThan(0)) {
      await ops.credit(wallets.revenueId, split.platform, `${label} — platform share`, 'PENDING');
    }

    return {
      escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
      pending: {
        pt: ops.balance(wallets.ptId, 'PENDING').toFixed(2),
        gym: wallets.gymId ? ops.balance(wallets.gymId, 'PENDING').toFixed(2) : '0.00',
        platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
      },
    };
  });
}

export interface UnactivatedRefundResult {
  /** What the client was credited: everything this transaction's settlement had put in pending. */
  refunded: string;
  returnedFromPending: { pt: string; gym: string; platform: string };
}

/**
 * The contract this payment was for cannot be activated by it any more — it was cancelled,
 * rejected, expired or completed while the client was on the bank's page, or it is already
 * active under a DIFFERENT payment. The client gets this transaction's money back in full.
 *
 * It exactly reverses settleContractPayment for ONE transaction: that call put the price in
 * escrow and into the three parties' pending buckets (all stamped with the transaction id), so
 * this takes each party's pending that carries that same id (`ownPending` — never the pooled
 * bucket, other contracts' money is out of reach) and credits the client with it. Escrow does
 * not move: the cash never left the platform, the claim on it passed from the parties' pending
 * to the client's wallet — the same as the refund leg of terminateContract.
 *
 * Why not terminateContract with a "full refund" reason. Its refund line is labelled with the
 * reason ("refund (MUTUAL)", "refund (PT_BANNED)") — every one of them tells a ledger reader a
 * contract that had run was ended by somebody — and it needs usedSessions / rates /
 * alreadyReleased machinery that has no meaning for a contract that never started. Here nothing
 * is computed at all: the refund IS whatever this transaction put into pending, so no formula,
 * rate or rounding can drift from what settlement booked.
 *
 * The credit's description contains "refund", which is what
 * withdrawal.repository#sumRefundSourcedCredits matches on — the client can withdraw it like
 * any other refund.
 *
 * Exactly once, atomically: the ledger movements, the idempotency key (`CONTRACT_UNACTIVATED_REFUND:
 * <transactionId>`, per TRANSACTION — two different payments for one contract are two refunds)
 * and the transaction's refund marker all commit in the one wallet-locked DB transaction. A
 * failure anywhere rolls the lot back, so a retry always starts clean; a retry after a commit
 * replays the stored result.
 */
export async function refundUnactivatedContractPayment(params: {
  transactionId: string;
  parties: ContractParties;
  label: string;
  /** Machine-readable cause recorded on the transaction, e.g. CONTRACT_NOT_ACTIVATABLE. */
  reason: string;
  /** The contract's status as user-service reported it — for the admin reading the marker. */
  contractStatus: string | null;
}): Promise<UnactivatedRefundResult> {
  const { transactionId, parties, label, reason, contractStatus } = params;
  const idempotencyKey = `CONTRACT_UNACTIVATED_REFUND:${transactionId}`;
  const wallets = await resolveWallets(parties);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      const back = { pt: ZERO, gym: ZERO, platform: ZERO };
      let drained = ZERO;
      for (const [key, id] of [['pt', wallets.ptId], ['gym', wallets.gymId], ['platform', wallets.revenueId]] as const) {
        if (!id) continue;
        const own = await ownPending(ops, id, transactionId);
        if (own.greaterThan(0)) {
          await ops.debit(id, own, `${label} — pending reversed (payment refunded)`, 'PENDING');
          back[key] = own;
          drained = drained.plus(own);
        }
      }

      // What the client paid, per the transaction itself — the authority for "full amount".
      const txn = await ops.tx.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });
      const price = new Prisma.Decimal(txn.amount);
      if (price.lessThanOrEqualTo(0)) throw new Error(`transaction ${transactionId} has no positive amount to refund`);

      await ops.credit(wallets.clientId, price, `${label} — refund (contract could not be activated)`);

      // Reconcile what came out of pending with what the client is owed, as terminateContract
      // does. Normally they are equal to the đồng (settlement put exactly `price` there and
      // nothing has touched this transaction's pending since — it is never released while the
      // contract is not ACTIVE). Surplus cannot come from this transaction's own rows; it is
      // booked to REVENUE rather than lost so the invariant holds whatever happens. A deficit
      // (pending already short — only possible on a ledger damaged by the old pooled drain) is
      // fronted by the platform and booked against the PT, and if even revenue cannot cover it
      // the whole refund is refused and rolled back: a client credited with money nobody
      // funded is worse than a refund that has to be retried.
      const residue = drained.minus(price);
      if (residue.greaterThan(0)) {
        await ops.credit(wallets.revenueId, residue, `${label} — surplus of reversed pending`, 'AVAILABLE');
      } else if (residue.lessThan(0)) {
        await coverShortfall(ops, wallets.revenueId, residue.abs(), {
          partnerType: 'PT',
          partnerId: parties.ptUserId,
          reason: `Refund of unactivated contract payment shortfall (${label})`,
          transactionId,
        });
      }

      // The marker, in the same DB transaction as the money. Not ACTIVATED — nothing was —
      // and not REFUNDED either: that status belongs to the admin refund flow (a REFUND child
      // transaction plus cancel-after-refund) and other code treats it as such. PAID stays true
      // (the gateway did capture the money); ACTIVATION_FAILED takes it out of the retry sweep's
      // selection (activationStatus = PENDING) and the metadata says exactly what happened.
      // Merge, never replace: the frozen rate/party snapshot lives in the same JSON.
      const meta = (txn.metadata ?? {}) as Record<string, unknown>;
      await ops.tx.paymentTransaction.update({
        where: { id: transactionId },
        data: {
          activationStatus: 'ACTIVATION_FAILED',
          metadata: {
            ...meta,
            unactivatedRefund: {
              refundedAt: new Date().toISOString(),
              amount: price.toFixed(2),
              reason,
              contractStatus,
              idempotencyKey,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });

      logger.warn(
        `[ContractLedger] ${label}: contract could not be activated (${contractStatus ?? 'unknown'}) — refunded ${price.toFixed(2)} to client ${parties.clientUserId}`,
      );
      return {
        refunded: price.toFixed(2),
        returnedFromPending: { pt: back.pt.toFixed(2), gym: back.gym.toFixed(2), platform: back.platform.toFixed(2) },
      };
    }),
  );
}

export interface ReleaseResult {
  released: { pt: string; gym: string; platform: string };
  unit: string;
  /**
   * Present only when this call applied a PT holdback (a rate > 0 that has not been released
   * for inactivity). Left off entirely otherwise, so the result — and the copy of it stored for
   * idempotent replay — for a contract without a holdback is exactly what it was before this
   * field existed.
   */
  ptHoldback?: {
    /** H = h × price in whole đồng: how much of the PT's first earnings is held back. */
    target: string;
    /** Taken out of THIS session's PT share and kept in pending. */
    heldNow: string;
    /** The pot after this session. */
    totalHeld: string;
  };
}

/**
 * Step 2: a session was confirmed by the client, so that slice of the price is earned.
 *
 * Pending falls and available rises by the same amount for each party — written as a PENDING
 * debit plus an AVAILABLE credit sharing one transactionId, so the release is one auditable
 * event rather than two unexplained movements. Escrow does not move: the cash is still held,
 * it merely became withdrawable.
 *
 * Releasing per session (rather than at the end) keeps each pending bucket exactly equal to
 * the value of the sessions still owed — which is the same pot a refund draws from, so the
 * two mechanisms stay consistent with no extra bookkeeping.
 *
 * PT holdback. When the contract carries a `ptHoldbackRate` h, the PT's share is not released
 * in full until a pot of H = h × price has been held back from their FIRST earnings: after u
 * sessions the PT has been released exactly max(0, E − H), E being the PT share of u sessions,
 * and the other min(E, H) stays in their pending (contract-money.ts#splitReleaseWithHoldback).
 * The gym and the platform are not affected. The amounts returned in `released` are what
 * REALLY went to available — the first session of a held contract returns 0 for the PT — which
 * is what user-service adds to releasedToPt and hands back at termination as `alreadyReleased`,
 * so the two stay consistent.
 *
 * With no rate (or 0), or once the holdback was released for inactivity, this posts exactly
 * the rows it always has.
 */
export async function releaseSession(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `SESSION_RELEASE:<sessionId>` — a retry with the same key replays the
   * first call's result instead of releasing the session's money a second time (plan 1.1). */
  idempotencyKey: string;
  /** The holdback rate frozen onto THIS contract (0..1). Absent or 0: no holdback. */
  ptHoldbackRate?: Prisma.Decimal;
}): Promise<ReleaseResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey, ptHoldbackRate } = params;
  assertHoldbackRateValid(ptHoldbackRate);
  const wallets = await resolveWallets(parties);
  const rel = computeSessionRelease(price, totalSessions, rates);
  assertGymConsistency(wallets, rel.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      const moved = { pt: ZERO, gym: ZERO, platform: ZERO };
      // Decided once, under the wallet locks: a holdback released for inactivity stays released
      // whatever rate the caller still sends.
      const target = holdbackTarget(price, ptHoldbackRate);
      const holding = target.greaterThan(0) && !(await holdbackWasReleased(ops, wallets.ptId, transactionId));
      let ptHoldback: ReleaseResult['ptHoldback'];

      const move = async (
        walletId: string,
        amount: Prisma.Decimal,
        who: string,
        key: 'pt' | 'gym' | 'platform',
        debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
        holdbackPot?: Prisma.Decimal,
      ) => {
        if (amount.lessThanOrEqualTo(0)) return;
        // Clamp to what THIS CONTRACT still has pending. A contract whose own pending has
        // already been spent (PT no-shows, a late-arrival compensation, a termination) must
        // not push a bucket negative — and must not be paid out of a neighbour's pending
        // either, which is what clamping to the wallet's pooled bucket used to do. Releasing
        // only what remains keeps the invariant intact and the shortfall visible.
        const available = await ownPending(ops, walletId, transactionId);
        const moving = available.lessThan(amount) ? available : amount;
        if (moving.lessThanOrEqualTo(0)) {
          logger.warn(`[ContractLedger] ${who} pending bucket empty for ${label} — nothing to release`);
          return;
        }

        // `moving` is what the party EARNED with this session. All of it leaves "unearned"
        // pending; with a holdback, the part that tops up the held-back pot goes straight back
        // into pending under its own description, and only the rest reaches available. The net
        // PENDING movement is then exactly the amount paid out, as for every other contract.
        let toAvailable = moving;
        let heldNow = ZERO;
        if (holdbackPot) {
          const heldBefore = await ptHeld(ops, walletId, transactionId);
          const split = splitReleaseWithHoldback(moving, heldBefore, holdbackPot);
          toAvailable = split.released;
          heldNow = split.held;
          ptHoldback = {
            target: holdbackPot.toFixed(2),
            heldNow: heldNow.toFixed(2),
            totalHeld: heldBefore.plus(heldNow).toFixed(2),
          };
        }

        await ops.debit(walletId, moving, `${label} — release to available`, 'PENDING');
        if (heldNow.greaterThan(0)) {
          await ops.credit(walletId, heldNow, `${label}${HOLDBACK_RETAINED_SUFFIX}`, 'PENDING');
        }
        if (toAvailable.greaterThan(0)) {
          await ops.credit(walletId, toAvailable, `${label} — session earned`, 'AVAILABLE');
        }
        moved[key] = toAvailable;

        // A partner who owes the platform works the debt off out of what they just earned,
        // before it becomes withdrawable. The platform is never a debtor to itself, so the
        // revenue wallet is not passed a debtor.
        if (debtor && toAvailable.greaterThan(0)) {
          await recoverReceivables({
            ops,
            walletId,
            revenueWalletId: wallets.revenueId,
            ...debtor,
            justCredited: toAvailable,
            label,
          });
        }
      };

      await move(wallets.ptId, rel.pt, 'PT', 'pt', { partnerType: 'PT', partnerId: parties.ptUserId }, holding ? target : undefined);
      if (wallets.gymId) {
        await move(wallets.gymId, rel.gym, 'Gym', 'gym', { partnerType: 'GYM', partnerId: parties.gymId! });
      }
      await move(wallets.revenueId, rel.platform, 'Platform', 'platform');

      // Report what actually moved, not what the formula asked for. The caller adds these
      // figures to the contract's releasedTo* running totals and hands them back at
      // termination as `alreadyReleased`: reporting a release that was clamped to nothing would
      // make termination believe the party had been paid, skip their top-up and — if it then
      // saw them as over-paid — claw the difference out of their AVAILABLE balance.
      return {
        unit: rel.unit.toFixed(2),
        released: { pt: moved.pt.toFixed(2), gym: moved.gym.toFixed(2), platform: moved.platform.toFixed(2) },
        ...(ptHoldback ? { ptHoldback } : {}),
      };
    }),
  );
}

export interface NoShowResult {
  compensation: string;
  charged: { pt: string; gym: string; platform: string };
  shortfall: string;
}

/**
 * The PT failed to attend. The client is paid one session's value in cash, funded by taking
 * that value back off the three parties in proportion — the platform gives back its
 * commission too, since it earned nothing on a session that never happened.
 *
 * The caller must also increment the contract's compensatedSessions by one — never decrement
 * totalSessions (that number, and price, are immutable once the contract is signed; see
 * money-flow plan 1.5). Compensating the client AND leaving the entitlement uncounted would
 * hand them the same session's value twice: once as cash here, once again as an unused
 * session when the contract later settles or terminates. remainingValue() and
 * computeTermination() in contract-money.ts are what actually subtract compensatedSessions
 * back out of "still owed."
 */
export async function compensateNoShow(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `PT_NO_SHOW:<sessionId>` — a retry with the same key replays the first
   * call's result instead of compensating the client a second time (plan 1.1). */
  idempotencyKey: string;
}): Promise<NoShowResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey } = params;
  const wallets = await resolveWallets(parties);
  const c = computeNoShowCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
      if (amount.lessThanOrEqualTo(0)) return;
      let outstanding = amount;
      // Pending first — that is the money set aside for sessions still owed, and this is one
      // of them: THIS contract's pending, not the wallet's pooled bucket (which also holds the
      // party's other contracts' unearned money). Then their available balance: a session that
      // never happened was not earned, so clawing back the released part is fair rather than
      // punitive. Available is one pool per wallet and has always been charged as such; a
      // contract's own pending running out is what sends the charge there, and then to the
      // platform-fronted shortfall below.
      for (const bucket of ['PENDING', 'AVAILABLE'] as const) {
        if (outstanding.lessThanOrEqualTo(0)) break;
        const held = bucket === 'PENDING' ? await ownPending(ops, walletId, transactionId) : ops.balance(walletId, bucket);
        const taken = held.lessThan(outstanding) ? held : outstanding;
        if (taken.greaterThan(0)) {
          await ops.debit(walletId, taken, `${label} — PT no-show charge`, bucket);
          charged[key] = charged[key].plus(taken);
          outstanding = outstanding.minus(taken);
        }
      }
      shortfall = shortfall.plus(outstanding);
    };

    await charge(wallets.ptId, c.pt, 'pt');
    if (wallets.gymId) await charge(wallets.gymId, c.gym, 'gym');
    else if (c.gym.greaterThan(0)) shortfall = shortfall.plus(c.gym);
    await charge(wallets.revenueId, c.platform, 'platform');

    // The client is made whole regardless (section 3.9). Escrow does NOT move: the cash never
    // left the platform, the claim on it simply passed from the parties to the client. Both
    // sides of the invariant fall and rise by the same amount, so it survives untouched.
    await ops.credit(wallets.clientId, c.compensation, `${label} — compensation for a missed session`);

    // Whatever the parties could not fund, the platform fronts out of its own revenue and
    // books as a debt. Fronting it is what keeps claims equal to escrow; leaving the gap open
    // would mean the client holds a claim nobody funded.
    if (shortfall.greaterThan(0)) {
      await coverShortfall(ops, wallets.revenueId, shortfall, {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `PT no-show compensation shortfall (${label})`,
        transactionId,
      });
    }

    return {
      compensation: c.compensation.toFixed(2),
      charged: {
        pt: charged.pt.toFixed(2),
        gym: charged.gym.toFixed(2),
        platform: charged.platform.toFixed(2),
      },
      shortfall: shortfall.toFixed(2),
    };
    }),
  );
}

/**
 * Open-room online session — the PT joined the room, but after the grace window past the
 * scheduled start. Half of compensateNoShow's rate (computeLateArrivalCompensation), same
 * three-way charge/shortfall mechanics. A DELIBERATE near-duplicate of compensateNoShow rather
 * than a shared refactor: compensateNoShow is relied on exactly as it already behaves by its
 * existing callers, and touching it to parameterize the formula risks a regression there for
 * zero benefit — this new function owns its own small blast radius instead.
 */
export async function compensateLateArrival(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `PT_LATE_ARRIVAL:<sessionId>` — a retry with the same key replays the
   * first call's result instead of compensating the client a second time. */
  idempotencyKey: string;
}): Promise<NoShowResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey } = params;
  const wallets = await resolveWallets(parties);
  const c = computeLateArrivalCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
      if (amount.lessThanOrEqualTo(0)) return;
      let outstanding = amount;
      // Same scoping as compensateNoShow: this contract's own pending first, never the pool.
      for (const bucket of ['PENDING', 'AVAILABLE'] as const) {
        if (outstanding.lessThanOrEqualTo(0)) break;
        const held = bucket === 'PENDING' ? await ownPending(ops, walletId, transactionId) : ops.balance(walletId, bucket);
        const taken = held.lessThan(outstanding) ? held : outstanding;
        if (taken.greaterThan(0)) {
          await ops.debit(walletId, taken, `${label} — PT late-arrival charge`, bucket);
          charged[key] = charged[key].plus(taken);
          outstanding = outstanding.minus(taken);
        }
      }
      shortfall = shortfall.plus(outstanding);
    };

    await charge(wallets.ptId, c.pt, 'pt');
    if (wallets.gymId) await charge(wallets.gymId, c.gym, 'gym');
    else if (c.gym.greaterThan(0)) shortfall = shortfall.plus(c.gym);
    await charge(wallets.revenueId, c.platform, 'platform');

    await ops.credit(wallets.clientId, c.compensation, `${label} — compensation for the PT's late arrival`);

    if (shortfall.greaterThan(0)) {
      await coverShortfall(ops, wallets.revenueId, shortfall, {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `PT late-arrival compensation shortfall (${label})`,
        transactionId,
      });
    }

    return {
      compensation: c.compensation.toFixed(2),
      charged: {
        pt: charged.pt.toFixed(2),
        gym: charged.gym.toFixed(2),
        platform: charged.platform.toFixed(2),
      },
      shortfall: shortfall.toFixed(2),
    };
    }),
  );
}

/**
 * The platform funds a gap out of its own revenue and books it as owed by the partner.
 *
 * Called when a party's buckets could not cover a charge the client is nonetheless entitled
 * to. The alternative — letting a wallet go negative, or crediting the client with money
 * nobody funded — would break the reconciliation invariant, and a broken invariant is
 * indistinguishable from theft when someone comes to audit it. If even revenue cannot cover
 * the gap, the whole movement is refused: better a failed operation than untraceable money.
 */
export async function coverShortfall(
  ops: LedgerOps,
  revenueWalletId: string,
  shortfall: Prisma.Decimal,
  debt: { partnerType: 'PT' | 'GYM'; partnerId: string; reason: string; transactionId: string },
): Promise<void> {
  const revenueHeld = ops.balance(revenueWalletId, 'AVAILABLE');
  if (revenueHeld.lessThan(shortfall)) {
    throw new Error(
      `[ContractLedger] cannot fund ${shortfall.toString()} shortfall: platform revenue holds only ${revenueHeld.toString()}`,
    );
  }
  await ops.debit(revenueWalletId, shortfall, `${debt.reason} — fronted by the platform`, 'AVAILABLE');
  await ops.tx.partnerReceivable.create({
    data: {
      partnerType: debt.partnerType,
      partnerId: debt.partnerId,
      amount: shortfall,
      reason: debt.reason,
      transactionId: debt.transactionId,
    },
  });
  logger.warn(`[ContractLedger] platform fronted ${shortfall.toString()} owed by ${debt.partnerType} ${debt.partnerId}`);
}

/**
 * The other half of coverShortfall: take the fronted money back out of what the partner
 * earns next (money-flow §3.9, "khoản phải thu này bị trừ vào các lần ghi có sau").
 *
 * Called immediately after a partner's AVAILABLE bucket is credited, and withholds from
 * that credit before the partner can withdraw it. Three deliberate limits:
 *
 *  · Never more than the credit that just landed. The debt is recovered out of *subsequent
 *    earnings*, not by raiding a balance the partner built up before the debt arose — that
 *    would be a seizure, and it would surprise someone who had already been told a figure.
 *  · Oldest debt first, so a long-standing receivable cannot be starved by newer ones.
 *  · The recovered money goes back to REVENUE, which is where coverShortfall took it from.
 *    Escrow does not move: the partner's claim shrinks and the platform's grows by the same
 *    amount, so the §6 invariant holds without a compensating entry.
 *
 * Partial recovery is normal — a large debt is worked off over several sessions. The row
 * only settles when `recovered` reaches `amount`.
 *
 * Withdrawal requests (VĐ1) now exist, and P0 cluster F gave `WalletLedgerV2` a third bucket
 * (`LOCKED`) for exactly this reason: once a withdrawal is `approve()`d, its amount is moved
 * OUT of AVAILABLE into LOCKED, so this function's `ops.balance(walletId, 'AVAILABLE')` read
 * can no longer touch it — an approved-but-not-yet-paid withdrawal is structurally safe from
 * a clawback that lands afterward. The still-open gap is narrower than the old comment above
 * implied: a withdrawal that is only *requested* (still PENDING, still sitting in AVAILABLE)
 * has no reservation yet, so a same-moment recovery can still shrink the balance a pending
 * request expects to draw from — `requestWithdrawal`/`approve()` do not re-check against an
 * in-flight receivable. Money-flow §15 rules that recovery should outrank a pending request
 * in that case; the check, if added, belongs in `withdrawal.service.ts#approve()`, not here.
 */
export async function recoverReceivables(params: {
  ops: LedgerOps;
  walletId: string;
  revenueWalletId: string;
  partnerType: 'PT' | 'GYM';
  partnerId: string;
  /** Ceiling for this pass: the amount just credited to the partner's AVAILABLE bucket. */
  justCredited: Prisma.Decimal;
  label: string;
}): Promise<Prisma.Decimal> {
  const { ops, walletId, revenueWalletId, partnerType, partnerId, justCredited, label } = params;
  if (justCredited.lessThanOrEqualTo(0)) return ZERO;

  const debts = await ops.tx.partnerReceivable.findMany({
    where: { partnerType, partnerId, settledAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (debts.length === 0) return ZERO;

  // Cap by what is actually in the bucket as well. These should agree, but a bucket that is
  // somehow short must not be pushed negative — that breaks the invariant this whole file
  // exists to protect.
  const held = ops.balance(walletId, 'AVAILABLE');
  let budget = justCredited.lessThan(held) ? justCredited : held;
  let recoveredTotal = ZERO;

  for (const debt of debts) {
    if (budget.lessThanOrEqualTo(0)) break;
    const outstanding = new Prisma.Decimal(debt.amount).minus(debt.recovered);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    const take = outstanding.lessThan(budget) ? outstanding : budget;
    const nowRecovered = new Prisma.Decimal(debt.recovered).plus(take);
    const settled = nowRecovered.greaterThanOrEqualTo(debt.amount);

    await ops.tx.partnerReceivable.update({
      where: { id: debt.id },
      data: { recovered: nowRecovered, settledAt: settled ? new Date() : null },
    });

    budget = budget.minus(take);
    recoveredTotal = recoveredTotal.plus(take);
    logger.info(
      `[ContractLedger] recovered ${take.toString()} of receivable ${debt.id} from ${partnerType} ${partnerId}` +
        (settled ? ' — settled in full' : ` — ${outstanding.minus(take).toString()} still owed`),
    );
  }

  if (recoveredTotal.greaterThan(0)) {
    await ops.debit(walletId, recoveredTotal, `${label} — withheld against outstanding debt`, 'AVAILABLE');
    await ops.credit(revenueWalletId, recoveredTotal, `${label} — debt recovered`, 'AVAILABLE');
  }

  return recoveredTotal;
}

export interface TerminationLedgerResult {
  reason: TerminationReason;
  refund: string;
  entitlement: { pt: string; gym: string; platform: string };
  topUp: { pt: string; gym: string; platform: string };
  returnedToEscrow: string;
  /** What the pending buckets could not fund of the refund and the parties' final shares. */
  shortfall: string;
  /**
   * Present only when a PT holdback was in force when the contract ended (a rate > 0 that had
   * not been released for inactivity). Left off entirely otherwise, so the result — and the
   * copy of it stored for idempotent replay — for every other termination is exactly what it
   * was before this field existed. Kept apart from `shortfall` above so that figure keeps
   * meaning what its existing readers take it to mean.
   */
  ptHoldback?: {
    /** H = h × price in whole đồng. */
    target: string;
    /** What was really still held back for the PT on this contract when it ended. */
    held: string;
    /** Credited to the client on top of `refund`, taken out of `held`. Zero unless PT-fault. */
    compensation: string;
    /** The rest of the pot, paid to the PT inside `topUp.pt`: held − compensation. */
    returnedToPt: string;
  };
}

/** Wording of the client-facing ledger row, per PT-fault reason. Always contains
 * "compensation": withdrawal.repository#sumRefundSourcedCredits matches on that word. */
const PT_FAULT_WORDING: Partial<Record<TerminationReason, string>> = {
  PT_CANCELLED: "the PT's cancellation",
  PT_BANNED: "the PT's removal",
  PT_REPEATED_NO_SHOW: "the PT's repeated no-shows",
};

/**
 * Step 3: the contract stops, for any of the six reasons.
 *
 * One code path serves them all, because the outcome is always the same shape:
 *
 *   final entitlement of a party = rate × (P − refund)
 *
 * So: refund the client, top each party up from pending to whatever their final entitlement
 * exceeds what they were already released, then empty the contract's pending buckets — the
 * residue is the client's refund money and goes back to escrow's custody on their behalf.
 *
 * PT holdback (`ptHoldbackRate`). The held-back pot is still in the PT's pending when the
 * contract ends, and it is part of the PT's final entitlement — so for the endings that are not
 * the PT's fault (COMPLETED, EXPIRED, CLIENT_CANCELLED, MUTUAL) the ordinary top-up above pays it
 * to the PT with no extra step: less was released along the way, so the gap is larger by exactly
 * the pot.
 *
 * For a PT-fault ending (PT_CANCELLED, PT_BANNED, PT_REPEATED_NO_SHOW) the client is also paid
 *
 *   compensation = min( h × base , held , what the PT was still to be paid )
 *
 * where `base` is the value of the sessions never delivered (PT_REPEATED_NO_SHOW adds the
 * sessions already compensated as no-shows — contract-money.ts#holdbackCompensationBase) and
 * `held` is what is really still held back for the PT on this contract at this moment
 * (ptHeld: the ledger-derived pot, clamped to the contract's own pending). It is carved out of
 * that pot: the PT's top-up shrinks by the same amount and the client gets a separate,
 * clearly-described credit. It is NEVER taken from the PT's available balance, never fronted by
 * the platform and never booked as a receivable — nothing held means nothing owed, and the
 * client still gets the normal refund. Whatever of the pot is not used goes to the PT.
 *
 * It runs inside the same wallet-locked transaction and under the same idempotency key as
 * everything else, so it lands with the refund or not at all, and a replay can never post it
 * twice.
 */
export async function terminateContract(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  usedSessions: number;
  /** Cụm A1 — sessions consumed via cash compensation (a PT no-show), not by being trained.
   * Must reach computeTermination or the value of an already-compensated session is handed
   * back to the client a second time on cancellation. Defaults to 0. */
  compensatedSessions?: number;
  rates: RateTable;
  reason: TerminationReason;
  /** Already moved to each party's available bucket, session by session. */
  alreadyReleased: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
  parties: ContractParties;
  label: string;
  /** Business key `CONTRACT_TERMINATE:<contractId>` — a retry with the same key replays the
   * first call's result instead of settling the contract a second time (plan 1.1). */
  idempotencyKey: string;
  /**
   * The PT holdback rate THIS contract carries (0..1), as snapshotted when it was created.
   * Absent or zero means the contract carries no holdback (or it was already released for
   * inactivity — the caller then sends 0), and termination settles exactly as it did before
   * this parameter existed. There is no fallback to a platform-wide rate here or in
   * contract-money.ts: the caller passes the contract's own value or nothing.
   */
  ptHoldbackRate?: Prisma.Decimal;
}): Promise<TerminationLedgerResult> {
  const { transactionId, price, totalSessions, usedSessions, compensatedSessions, rates, reason, alreadyReleased, parties, label, idempotencyKey, ptHoldbackRate } = params;

  const outcome = computeTermination(
    { price, totalSessions, usedSessions, compensatedSessions, rates, ptHoldbackRate },
    reason,
  );
  const holdbackPot = holdbackTarget(price, ptHoldbackRate);
  const wallets = await resolveWallets(parties);
  assertGymConsistency(wallets, outcome.entitlement.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const topUp = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    // The PT holdback, decided under the wallet locks. `held` is what is really still held back
    // for the PT; `compensation` is the client's share of it (zero unless the PT is at fault).
    // Capped three ways, each for a reason:
    //   · the target h × base — the contract term;
    //   · held — the compensation may only ever come out of the held-back pot;
    //   · what the PT was still to be paid (final entitlement − already released) — so carving
    //     the compensation out of the PT's top-up can never push the top-up below zero and
    //     reach into available money.
    const holding = holdbackPot.greaterThan(0) && !(await holdbackWasReleased(ops, wallets.ptId, transactionId));
    let held = ZERO;
    let compensation = ZERO;
    if (holding) {
      held = await ptHeld(ops, wallets.ptId, transactionId);
      if (outcome.ptFaultCompensationTarget.greaterThan(0)) {
        const ptStillToBePaid = Prisma.Decimal.max(outcome.entitlement.pt.minus(alreadyReleased.pt), ZERO);
        compensation = Prisma.Decimal.min(outcome.ptFaultCompensationTarget, held, ptStillToBePaid);
      }
    }

    /**
     * Bring one party from "what they have already been paid" to "what they are finally owed".
     * A positive gap is topped up out of their pending bucket; a negative gap means they were
     * released more than they ended up entitled to and the excess is clawed back.
     *
     * `reserve` is pending money that must stay behind to be drained into the client's credit
     * instead — the PT's compensation. It is only ever non-zero when the PT was still owed at
     * least that much (see the cap above), so it reduces a top-up and never creates a clawback.
     */
    const settleParty = async (
      walletId: string | null,
      entitlement: Prisma.Decimal,
      released: Prisma.Decimal,
      key: 'pt' | 'gym' | 'platform',
      debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
      reserve: Prisma.Decimal = ZERO,
    ) => {
      if (!walletId) return;
      const gap = entitlement.minus(released).minus(reserve);
      if (gap.greaterThan(0)) {
        const pendingHeld = (await ownPending(ops, walletId, transactionId)).minus(reserve);
        const available = pendingHeld.greaterThan(0) ? pendingHeld : ZERO;
        const moving = available.lessThan(gap) ? available : gap;
        if (moving.greaterThan(0)) {
          await ops.debit(walletId, moving, `${label} — final settlement`, 'PENDING');
          await ops.credit(walletId, moving, `${label} — final settlement`, 'AVAILABLE');
          topUp[key] = moving;
          // Last chance to recover: after this the contract is closed and this partner has
          // no further credits from it to withhold against.
          if (debtor) {
            await recoverReceivables({
              ops,
              walletId,
              revenueWalletId: wallets.revenueId,
              ...debtor,
              justCredited: moving,
              label,
            });
          }
        }
        shortfall = shortfall.plus(gap.minus(moving));
      } else if (gap.lessThan(0)) {
        const owed = gap.abs();
        const heldAvailable = ops.balance(walletId, 'AVAILABLE');
        const clawed = heldAvailable.lessThan(owed) ? heldAvailable : owed;
        if (clawed.greaterThan(0)) {
          await ops.debit(walletId, clawed, `${label} — over-released, clawed back`, 'AVAILABLE');
          await ops.credit(walletId, clawed, `${label} — returned to pending`, 'PENDING');
          topUp[key] = clawed.negated();
        }
        shortfall = shortfall.plus(owed.minus(clawed));
      }
    };

    await settleParty(wallets.ptId, outcome.entitlement.pt, alreadyReleased.pt, 'pt', {
      partnerType: 'PT',
      partnerId: parties.ptUserId,
    }, compensation);
    await settleParty(wallets.gymId, outcome.entitlement.gym, alreadyReleased.gym, 'gym',
      parties.gymId ? { partnerType: 'GYM', partnerId: parties.gymId } : undefined);
    await settleParty(wallets.revenueId, outcome.entitlement.platform, alreadyReleased.platform, 'platform');

    // Drain whatever THIS CONTRACT has left in the three pending buckets — that residue is
    // exactly the client's refund (plus any forfeited share, plus the PT-fault compensation
    // reserved above), still sitting under the parties' names. Only this contract's: each of
    // those buckets is a pool that also holds every other contract's, membership's and
    // referral's unearned money, and draining the pool would refund this client out of
    // strangers' money and then book the surplus to REVENUE.
    let drained = ZERO;
    for (const id of [wallets.ptId, wallets.gymId, wallets.revenueId]) {
      if (!id) continue;
      const left = await ownPending(ops, id, transactionId);
      if (left.greaterThan(0)) {
        await ops.debit(id, left, `${label} — pending released on termination`, 'PENDING');
        drained = drained.plus(left);
      }
    }

    if (outcome.refund.greaterThan(0)) {
      await ops.credit(wallets.clientId, outcome.refund, `${label} — refund (${reason})`);
      // Escrow does not move. The cash never left the platform; the claim on it passed from
      // the parties' pending buckets to the client's balance. Only a real payout debits escrow.
    }

    // Its own ledger row, not folded into the refund: the client is owed two different things
    // for two different reasons, and an auditor has to be able to tell them apart. The wording
    // matters — a client may only withdraw credits described as a refund or a compensation
    // (withdrawal.repository#sumRefundSourcedCredits matches on this text). Escrow does not
    // move, for the same reason it does not for the refund.
    if (compensation.greaterThan(0)) {
      await ops.credit(
        wallets.clientId,
        compensation,
        `${label} — compensation for ${PT_FAULT_WORDING[reason] ?? 'the PT'} (from the PT's held-back earnings)`,
      );
    }

    // Every đồng drained out of pending must land somewhere, and the client's refund and
    // compensation must be fully funded. Reconcile the two. The compensation was reserved out
    // of the PT's own pending above, so it is always among what was drained.
    const owedToClient = outcome.refund.plus(compensation);
    const residue = drained.minus(owedToClient);
    if (residue.greaterThan(0)) {
      // Drained more than the client is owed — the surplus is the parties' forfeited share
      // (a cancellation fee, say) and belongs to the platform, not to nobody.
      await ops.credit(wallets.revenueId, residue, `${label} — forfeited share`, 'AVAILABLE');
    } else if (residue.lessThan(0)) {
      // Drained less than the refund: the pending buckets were already short. The platform
      // funds the difference and books it against the PT, exactly as for a no-show.
      await coverShortfall(ops, wallets.revenueId, residue.abs(), {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `Termination refund shortfall (${label}, ${reason})`,
        transactionId,
      });
    }

    return {
      reason,
      refund: outcome.refund.toFixed(2),
      entitlement: {
        pt: outcome.entitlement.pt.toFixed(2),
        gym: outcome.entitlement.gym.toFixed(2),
        platform: outcome.entitlement.platform.toFixed(2),
      },
      topUp: { pt: topUp.pt.toFixed(2), gym: topUp.gym.toFixed(2), platform: topUp.platform.toFixed(2) },
      returnedToEscrow: drained.toFixed(2),
      shortfall: shortfall.plus(residue.lessThan(0) ? residue.abs() : ZERO).toFixed(2),
      // Spread in rather than assigned, so the key does not exist at all when no holdback was
      // in force: an explicit `undefined` would vanish when the result is stored as JSON for
      // replay, and the first call would then differ from every retry of it.
      ...(holding
        ? {
            ptHoldback: {
              target: holdbackPot.toFixed(2),
              held: held.toFixed(2),
              compensation: compensation.toFixed(2),
              returnedToPt: held.minus(compensation).toFixed(2),
            },
          }
        : {}),
    };
    }),
  );
}

export interface ReleaseHoldbackResult {
  /** What went from the PT's pending to their available balance. 0 when nothing was held. */
  released: string;
}

/**
 * The contract has had no session for a long time (user-service decides what "a long time"
 * is): hand the PT the held-back pot now, and from here on treat the contract as having no
 * holdback — releaseSession releases in full and terminateContract owes no compensation,
 * because holdbackWasReleased finds the marker row this writes.
 *
 * The amount is derived from the ledger (ptHeld), not from the caller. Idempotent two ways: the
 * business key (`HOLDBACK_RELEASE:<contractId>`) replays the first result, and the marker row
 * makes a second call under a different key for the same payment a no-op as well. The marker is
 * written even when nothing was held (as a zero-amount row), so "released" is a fact in the
 * ledger whether or not there was anything to release.
 *
 * Safe on a contract that has already ended: its pending has been drained, ptHeld is clamped to
 * that pending, so nothing moves.
 */
export async function releasePtHoldback(params: {
  transactionId: string;
  parties: ContractParties;
  label: string;
  /** Business key `HOLDBACK_RELEASE:<contractId>`. */
  idempotencyKey: string;
}): Promise<ReleaseHoldbackResult> {
  const { transactionId, parties, label, idempotencyKey } = params;
  const wallets = await resolveWallets(parties);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      if (await holdbackWasReleased(ops, wallets.ptId, transactionId)) return { released: '0.00' };

      const pot = await ptHeld(ops, wallets.ptId, transactionId);
      const description = `${label}${HOLDBACK_RELEASED_SUFFIX}`;
      await ops.debit(wallets.ptId, pot, description, 'PENDING');
      if (pot.greaterThan(0)) {
        await ops.credit(wallets.ptId, pot, description, 'AVAILABLE');
        // The PT works any debt they owe the platform off out of what they just earned, as for
        // every other release.
        await recoverReceivables({
          ops,
          walletId: wallets.ptId,
          revenueWalletId: wallets.revenueId,
          partnerType: 'PT',
          partnerId: parties.ptUserId,
          justCredited: pot,
          label,
        });
      }
      logger.info(`[ContractLedger] ${label}: PT holdback of ${pot.toFixed(2)} released for inactivity`);
      return { released: pot.toFixed(2) };
    }),
  );
}

/** Reads both buckets of a wallet without locking — for display and reconciliation only. */
export async function readWallet(ownerType: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM', ownerId: string) {
  const w = await walletService.getOrCreateWallet(ownerType, ownerId);
  return {
    id: w.id,
    ownerType: w.ownerType,
    ownerId: w.ownerId,
    availableBalance: w.availableBalance.toFixed(2),
    pendingBalance: w.pendingBalance.toFixed(2),
    status: w.status,
  };
}

export { prisma as ledgerPrisma };
