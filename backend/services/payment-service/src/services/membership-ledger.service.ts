import { Prisma } from '../generated/prisma';
import { ZERO, splitThreeWays, type RateTable } from './contract-money';
import { pendingForTransaction, walletService, type LedgerOps } from './wallet.service';
import { ownPending, recordObligation, recoverReceivables } from './contract-ledger.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';

/**
 * Money movements for gym memberships: the referral commission a PT earns for bringing in a
 * client, and settling a membership's pending money when it ends (naturally, by the client's
 * own cancellation, or by an admin's exceptional refund).
 *
 * A membership settles through the SAME `settleContractPayment` as a PT contract (money-flow
 * plan §2.2/B4b), with `ptRate: '0'` — the whole non-platform share lands in the gym's pending
 * bucket. Everything here either moves a slice of that gym pending sideways into a PT's
 * pending (referral) or drains what remains of a membership's pending buckets to their owners'
 * available buckets (release). Escrow never moves in any of it: nothing here is a real payout,
 * only a reallocation of cash the platform already holds — see contract-ledger.service.ts's
 * header comment for the same principle applied to PT contracts.
 *
 * F2 (money-flow plan feedback): "how much pending belongs to this membership" is never
 * recomputed from price. A gym's PENDING bucket is a POOL shared by every membership it has
 * sold, so `ops.balance(gymWallet, 'PENDING')` cannot be used directly — it would touch other
 * memberships' money. Every entry this file writes shares ONE transactionId per membership
 * (`membership.paymentTxnId`, reused across settlement/referral/clawback/release calls — the
 * same convention contract-payout.service.ts already uses for PT contracts by passing
 * `contract.paymentTransactionId` to every ledger call). `pendingRemainingForTxn` sums exactly
 * the ledger entries tagged with that one transactionId, so it reads what THIS membership
 * still has pending, correctly ignoring every other membership sharing the same gym wallet.
 */

/** Reads how much of a wallet's PENDING bucket is attributable to one transactionId — i.e.
 * one membership's own money, not the wallet's pooled total across every membership.
 * Exported for reuse by personalized-service-ledger.service.ts, which needs the exact same
 * "this wallet's pooled PENDING minus every OTHER order's share" scoping (F2's reasoning
 * applies identically: a PT/platform PENDING bucket is shared across every order they hold). */
export async function pendingRemainingForTxn(ops: LedgerOps, walletId: string, transactionId: string): Promise<Prisma.Decimal> {
  // The implementation lives in wallet.service.ts so contract-ledger.service.ts can use it too
  // without importing this file (which already imports that one).
  return pendingForTransaction(ops, walletId, transactionId);
}

export interface ReferralSettleResult {
  /** Strict mode: exactly what moved out of THIS membership's gym pending into the PT's pending. Legacy: moved + platform-fronted. */
  moved: string;
  /** Strict mode: the commission the membership's own pending could not fund (== `unpaid`). Legacy: the platform-fronted part. */
  shortfall: string;
  /** D48 / DQ-1 S: the commission requested, what was moved, and the rest. Absent on a zero-amount no-op. */
  owed?: string;
  paid?: string;
  unpaid?: string;
  /** Present only when `unpaid > 0` : the OPEN OVER_RELEASED row in contract_unpaid_obligations. */
  obligationId?: string;
}

/**
 * ① The membership activated: move its referral commission from the gym's pending bucket to
 * the referring PT's pending bucket. `amount` is fixed by gym-service at purchase time
 * (GYM_MEMBERSHIP_REFERRAL_RATE × gross price) — this file does not recompute it, the same
 * "one implementation of the formula" rule the PT-contract side follows, except this formula
 * is a plain multiply-and-round gym-service already owns (see plan §2.5), not a three-way
 * split requiring contract-money.ts's reconciliation machinery.
 *
 * D48 / DQ-1 S (own funds only): only what THIS membership's gym pending holds is moved. If it holds
 * less than the commission, the PT is NOT credited the difference out of thin air, the platform does
 * NOT front it and no PartnerReceivable is created against the gym: the unpaid
 * commission is a durable, idempotent OPEN `OVER_RELEASED` row (party PT, same kind/party/key-suffix
 * convention as `clawbackMembershipReferral`) in contract_unpaid_obligations for the admin. REFUND_SHORT
 * is not used: it means "owed to the client", and this is a PT commission, i.e. an admin incident.
 * This is a financial invariant: no flag, env or API restores the old platform fronting.
 */
export async function settleMembershipReferral(params: {
  transactionId: string;
  gymId: string;
  ptUserId: string;
  amount: Prisma.Decimal;
  label: string;
  /** Business key `MEMBERSHIP_REFERRAL:<membershipId>` — a retry with the same key replays
   * the first call's result instead of moving the commission a second time (plan 1.1). */
  idempotencyKey: string;
}): Promise<ReferralSettleResult> {
  const { transactionId, gymId, ptUserId, amount, label, idempotencyKey } = params;
  if (amount.lessThanOrEqualTo(0)) return { moved: '0.00', shortfall: '0.00' };

  const [gymWallet, ptWallet, revenueWallet] = await Promise.all([
    walletService.getOrCreateWallet('GYM', gymId),
    walletService.getOrCreateWallet('PT', ptUserId),
    walletService.getRevenueWallet(),
  ]);

  return walletService.withWallets([gymWallet.id, ptWallet.id, revenueWallet.id], transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      // This membership's own pending, also capped by what the pooled bucket really holds
      // (never push the gym wallet negative).
      const gymPendingForTxn = await ownPending(ops, gymWallet.id, transactionId);
      const moving = gymPendingForTxn.lessThan(amount) ? gymPendingForTxn : amount;
      if (moving.greaterThan(0)) {
        await ops.debit(gymWallet.id, moving, `${label} — referral commission`, 'PENDING');
        await ops.credit(ptWallet.id, moving, `${label} — referral commission`, 'PENDING');
      }
      const shortfall = amount.minus(moving);
      // Should not happen — the commission is always a slice of the gym's own settlement share — but
      // if this membership's pending is short, nothing outside it is touched. The PT's unpaid
      // commission is an OPEN incident for the admin, not a debt of the gym and not fronted money.
      let obligationId: string | undefined;
      if (shortfall.greaterThan(0)) {
        obligationId = await recordObligation(ops, {
          key: `${idempotencyKey}#OVER_RELEASED:PT`,
          transactionId,
          contractRef: label,
          kind: 'OVER_RELEASED',
          party: 'PT',
          owed: amount,
          paid: moving,
          reason: `Referral commission: this membership's own gym pending could not fund the commission owed to PT ${ptUserId}`,
        });
      }
      return {
        moved: moving.toFixed(2),
        shortfall: shortfall.toFixed(2),
        owed: amount.toFixed(2),
        paid: moving.toFixed(2),
        unpaid: shortfall.toFixed(2),
        ...(obligationId ? { obligationId } : {}),
      };
    }),
  );
}

export interface ClawbackResult {
  /** What was actually reclaimed from the referring PT's pending money for THIS membership. */
  recovered: string;
  /** What could not be reclaimed (== `unpaid`). */
  shortfall: string;
  /** D48 / DQ-3: what the clawback asked for, what was reclaimed, and the rest. Absent on a zero-amount no-op. */
  owed?: string;
  paid?: string;
  unpaid?: string;
  /** Present only when `unpaid > 0` : the OPEN OVER_RELEASED row in contract_unpaid_obligations. */
  obligationId?: string;
}

/**
 * ② An admin refund is reversing part or all of a membership. Reclaim the matching share of
 * the referral commission from the PT and return it to the gym's pending bucket, funding the
 * refund the same way the original commission was funded.
 *
 * PENDING scoped to THIS membership's transactionId is reclaimed first — that's where the
 * commission being clawed back actually lives if it hasn't matured yet, and draining it keeps
 * this transaction's own pending ledger consistent with the price the client paid.
 *
 * D48/DQ-3: nothing outside this membership's own pending is ever drawn. If the commission already
 * matured to AVAILABLE (and may have been withdrawn), the part that cannot be reclaimed is NOT taken from the
 * PT's pooled AVAILABLE (earnings of other work), NOT fronted by the platform and NOT booked as a
 * PartnerReceivable: it is a durable, idempotent OPEN `OVER_RELEASED` incident (party PT) in
 * contract_unpaid_obligations for the admin, and `recovered`/`shortfall` report exactly what moved.
 * This is a financial invariant: no flag, env or API restores the old pooled AVAILABLE draw + receivable.
 *
 * History: this used to run AVAILABLE-first, pooled across every referral the PT has ever earned (the
 * same precedent compensateNoShow uses for a PT-contract no-show charge) — reasonable for a
 * no-show charge, which is a fresh debt with no transaction of its own to scope to, but wrong
 * here: when a PT holds AVAILABLE balance from an unrelated, already-settled referral (e.g. an
 * earlier membership a client self-cancelled, which never triggers a clawback), draining that
 * pool first left THIS transaction's own PENDING untouched while crediting the recovered money
 * back into THIS transaction's gym-pending bucket — inflating its total pending beyond the
 * original price and breaking `releaseMembershipPending`'s current-share rate invariant
 * (confirmed live: `platformRate must be >= 0.1` on an otherwise-correct 500k membership refund,
 * because gymPending+platformPending+ptPending summed to ~550k instead of 500k). Scoped-PENDING-
 * first avoids ever touching money the current transaction doesn't own.
 */
export async function clawbackMembershipReferral(params: {
  transactionId: string;
  gymId: string;
  ptUserId: string;
  amount: Prisma.Decimal;
  label: string;
  /** Business key `REFERRAL_CLAWBACK:<membershipId>` — a retry with the same key replays the
   * first call's result instead of reclaiming the commission a second time (plan 1.1). */
  idempotencyKey: string;
}): Promise<ClawbackResult> {
  const { transactionId, gymId, ptUserId, amount, label, idempotencyKey } = params;
  if (amount.lessThanOrEqualTo(0)) return { recovered: '0.00', shortfall: '0.00' };

  const [gymWallet, ptWallet] = await Promise.all([
    walletService.getOrCreateWallet('GYM', gymId),
    walletService.getOrCreateWallet('PT', ptUserId),
  ]);

  return walletService.withWallets([gymWallet.id, ptWallet.id], transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    let outstanding = amount;
    let recovered = ZERO;

    const pendingForTxn = await pendingRemainingForTxn(ops, ptWallet.id, transactionId);
    const fromPending = pendingForTxn.lessThan(outstanding) ? pendingForTxn : outstanding;
    if (fromPending.greaterThan(0)) {
      await ops.debit(ptWallet.id, fromPending, `${label} — referral clawback`, 'PENDING');
      recovered = recovered.plus(fromPending);
      outstanding = outstanding.minus(fromPending);
    }

    // D48 / DQ-3: nothing outside THIS membership's own pending is ever touched. A commission that
    // already matured and was withdrawn is not clawed back from the PT's other earnings.

    if (recovered.greaterThan(0)) {
      await ops.credit(gymWallet.id, recovered, `${label} — referral clawback returned`, 'PENDING');
    }

    const shortfall = outstanding;
    let obligationId: string | undefined;
    if (shortfall.greaterThan(0)) {
      // The PT's commission for this membership already matured (and may have been withdrawn), so
      // the part of it this refund should have reclaimed is no longer in this membership's pending.
      // That is an over-release, not a PT debt: an OPEN incident for the admin (same kind and party
      // convention as a contract termination that finds a party over-released). No
      // PartnerReceivable, no pooled draw, nothing fronted - the gym's refund source simply stays
      // short by this amount and the release step refunds from what the membership still holds.
      obligationId = await recordObligation(ops, {
        key: `${idempotencyKey}#OVER_RELEASED:PT`,
        transactionId,
        contractRef: label,
        kind: 'OVER_RELEASED',
        party: 'PT',
        owed: amount,
        paid: recovered,
        reason: `Referral clawback: the commission was already released to PT ${ptUserId}; this membership's own pending could not reclaim it`,
      });
    }

    return {
      recovered: recovered.toFixed(2),
      shortfall: shortfall.toFixed(2),
      owed: amount.toFixed(2),
      paid: recovered.toFixed(2),
      unpaid: shortfall.toFixed(2),
      ...(obligationId ? { obligationId } : {}),
    };
    }),
  );
}

export interface MembershipReleaseResult {
  released: { gym: string; platform: string; ptReferral: string };
  refundedToClient: string;
  forfeitedToRevenue: string;
  shortfall: string;
}

/**
 * ③/④ A membership has reached a terminal state — expired naturally, the client cancelled it
 * themselves (no refund, money-flow plan §2.4), or an admin approved an exceptional refund
 * (§2.4's three reasons). One function serves both HTTP endpoints the plan asks for
 * (`membership-release`, `membership-cancel-forfeit`): they differ only in the caller's own
 * status assertion and in `refundToClient`, which is ZERO for the first two triggers and the
 * admin's computed proration for the third. See routes for the explicit CANCELLED/EXPIRED
 * gate (F4) — this function itself has no way to independently verify gym-service's status,
 * so the gate lives at the boundary the caller cannot lie to without a code bug.
 *
 * The three parties' current pending — for GYM, PLATFORM(revenue), and the referring PT if
 * any — are read via `pendingRemainingForTxn` (F2) and, together, are guaranteed by
 * conservation to sum to the original price P: settlement puts the whole price into gym+
 * platform pending, and a referral move only ever shifts money between gym and PT, never
 * removes it. `refundToClient` is subtracted from that total, and the remainder is split back
 * to the three parties' AVAILABLE buckets in proportion to their CURRENT pending share (not
 * their originally-frozen rates — a referral move or clawback can have shifted gym vs PT's
 * share since settlement, and the party actually holding the money now is who release must
 * pay). Reusing `splitThreeWays` here — instead of hand-rolling a three-way proration — is
 * what keeps the đồng-exact reconciliation and rounding rules (PT/gym round down, platform
 * absorbs the remainder) identical to every other three-way split in this system.
 */
export async function releaseMembershipPending(params: {
  transactionId: string;
  gymId: string;
  clientId: string;
  ptUserId?: string | null;
  refundToClient: Prisma.Decimal;
  label: string;
  /** Business key `MEMBERSHIP_RELEASE:<membershipId>` — a retry with the same key replays
   * the first call's result instead of re-running the release (plan 1.1). This also closes
   * the pre-existing wrinkle where a retry with `refundToClient > 0` on an already-drained
   * membership used to THROW ("pending is already fully released") instead of replaying —
   * exactly the retry a caller does when this committed but it crashed before recording
   * that success locally. */
  idempotencyKey: string;
}): Promise<MembershipReleaseResult> {
  const { transactionId, gymId, clientId, ptUserId, refundToClient, label, idempotencyKey } = params;

  const [gymWallet, revenueWallet, clientWallet, ptWallet] = await Promise.all([
    walletService.getOrCreateWallet('GYM', gymId),
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('CLIENT', clientId),
    ptUserId ? walletService.getOrCreateWallet('PT', ptUserId) : Promise.resolve(null),
  ]);

  const walletIds = [gymWallet.id, revenueWallet.id, clientWallet.id, ...(ptWallet ? [ptWallet.id] : [])];

  return walletService.withWallets(walletIds, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const gymPending = await pendingRemainingForTxn(ops, gymWallet.id, transactionId);
    const platformPending = await pendingRemainingForTxn(ops, revenueWallet.id, transactionId);
    const ptPending = ptWallet ? await pendingRemainingForTxn(ops, ptWallet.id, transactionId) : ZERO;
    const totalPending = gymPending.plus(platformPending).plus(ptPending);

    // Idempotent: a second call (e.g. the expiry sweep retrying, or a duplicate webhook-style
    // delivery) finds nothing left tied to this transactionId and does nothing, matching the
    // plan's "gọi hai lần liên tiếp, lần hai không giải phóng gì thêm".
    if (totalPending.isZero()) {
      if (refundToClient.greaterThan(0)) {
        throw new Error(
          `[MembershipLedger] ${label}: asked to refund ${refundToClient.toString()} but this membership's pending is already fully released`,
        );
      }
      return {
        released: { gym: '0.00', platform: '0.00', ptReferral: '0.00' },
        refundedToClient: '0.00',
        forfeitedToRevenue: '0.00',
        shortfall: '0.00',
      };
    }
    if (refundToClient.greaterThan(totalPending)) {
      throw new Error(
        `[MembershipLedger] ${label}: refund ${refundToClient.toString()} exceeds this membership's remaining pending ${totalPending.toString()}`,
      );
    }

    const withheld = totalPending.minus(refundToClient);
    // Current-share rates, derived from the actual pending split rather than the frozen
    // settlement rates — Decimal division is precise well below a đồng (see contract-money.ts),
    // so this reconstructs the exact integers when nothing has shifted (no referral) and the
    // correct post-referral split when it has.
    const rates: RateTable = {
      gymRate: gymPending.div(totalPending),
      platformRate: platformPending.div(totalPending),
      ptRate: ptPending.div(totalPending),
    };
    const entitlement = splitThreeWays(withheld, rates);

    if (gymPending.greaterThan(0)) await ops.debit(gymWallet.id, gymPending, `${label} — pending drained`, 'PENDING');
    if (platformPending.greaterThan(0)) await ops.debit(revenueWallet.id, platformPending, `${label} — pending drained`, 'PENDING');
    if (ptWallet && ptPending.greaterThan(0)) await ops.debit(ptWallet.id, ptPending, `${label} — pending drained`, 'PENDING');

    if (entitlement.gym.greaterThan(0)) {
      await ops.credit(gymWallet.id, entitlement.gym, `${label} — released`, 'AVAILABLE');
      // Same rule as on the contract side (money-flow §3.9): a partner the platform has
      // fronted money for works it off out of the next thing they earn, before it becomes
      // withdrawable. A gym refund the pending bucket could not cover is exactly how a gym
      // ends up owing, so this is the flow most likely to find a debt outstanding.
      await recoverReceivables({
        ops,
        walletId: gymWallet.id,
        revenueWalletId: revenueWallet.id,
        partnerType: 'GYM',
        partnerId: gymId,
        justCredited: entitlement.gym,
        label,
      });
    }
    if (entitlement.platform.greaterThan(0)) {
      await ops.credit(revenueWallet.id, entitlement.platform, `${label} — released`, 'AVAILABLE');
    }
    if (ptWallet && entitlement.pt.greaterThan(0)) {
      await ops.credit(ptWallet.id, entitlement.pt, `${label} — released`, 'AVAILABLE');
      await recoverReceivables({
        ops,
        walletId: ptWallet.id,
        revenueWalletId: revenueWallet.id,
        partnerType: 'PT',
        partnerId: ptUserId!,
        justCredited: entitlement.pt,
        label,
      });
    }

    if (refundToClient.greaterThan(0)) {
      await ops.credit(clientWallet.id, refundToClient, `${label} — refund`);
    }

    // The gap between what was drained per party and what they were re-credited is exactly
    // what funded the refund — by splitThreeWays's own guarantee, entitlement sums to
    // `withheld`, so drained (totalPending) − entitlement-total (withheld) === refundToClient
    // precisely. Nothing here can go short (refundToClient was bounds-checked above), so
    // there is no shortfall path on this side, unlike settleMembershipReferral/clawback.
    return {
      released: {
        gym: entitlement.gym.toFixed(2),
        platform: entitlement.platform.toFixed(2),
        ptReferral: entitlement.pt.toFixed(2),
      },
      refundedToClient: refundToClient.toFixed(2),
      forfeitedToRevenue: '0.00',
      shortfall: '0.00',
    };
    }),
  );
}
