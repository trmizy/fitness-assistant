import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { splitThreeWays, ZERO, ONE, type RateTable } from './contract-money';
import { walletService } from './wallet.service';
import { coverShortfall, recoverReceivables } from './contract-ledger.service';
import { pendingRemainingForTxn } from './membership-ledger.service';

/**
 * Escrow + milestone release for Personalized PT Service purchases (P1-FIN-001/002).
 *
 * Two parties only — PT and platform, no gym — so every split here is `splitThreeWays` with
 * `gymRate: ZERO`, reusing the exact same tested rounding/reconciliation rules the three-way
 * contract/membership splits already rely on, rather than a bespoke two-way formula.
 *
 * DELIBERATE: the seller's wallet stays `(CLIENT, sellerId)` — the SAME identity the pre-escrow
 * `wallet-transfer` path already used for Personalized Service, not `(PT, sellerId)`. The dev DB
 * already carries 1300+ personalized_service_orders paid through that CLIENT wallet; switching
 * identity now would strand every one of those payouts in a wallet this new refund/release code
 * never looks at. `recoverReceivables`'s `walletId` and `partnerType`/`partnerId` are independent
 * params — `partnerType: 'PT'` is used purely as the receivables-bookkeeping label here, decoupled
 * from which wallet row actually holds the balance.
 *
 * Direction of travel (same principle as contract-ledger.service.ts's header):
 *   hold    → ESCROW gains P; seller + platform PENDING gain their split of P
 *   release → PENDING falls, AVAILABLE rises for whichever party (ESCROW untouched — still held)
 *   refund  → PENDING falls first, then pooled AVAILABLE if PENDING is insufficient; buyer's
 *             AVAILABLE rises (ESCROW untouched — the claim on the held cash simply moves)
 */

export type PersonalizedServiceMilestone =
  | 'INTAKE_REVIEWED'
  | 'DRAFT_DELIVERED'
  | 'ACCEPTED'
  | 'COMPLETED';

// Confirmed release schedule (not a placeholder — product signed off on these exact numbers,
// matching QA_REMAINING_ISSUES_PERSONALIZED_PT.md's illustrative table verbatim). COMPLETED has
// no fixed fraction here on purpose: it drains whatever remains in PENDING instead of computing
// its own 20% slice, so any rounding residue from the first three (independently-rounded) slices
// cannot survive forever in PENDING — see releasePersonalizedServiceMilestone below.
const MILESTONE_RELEASE_PCT: Record<Exclude<PersonalizedServiceMilestone, 'COMPLETED'>, Prisma.Decimal> = {
  INTAKE_REVIEWED: new Prisma.Decimal('0.10'),
  DRAFT_DELIVERED: new Prisma.Decimal('0.30'),
  ACCEPTED: new Prisma.Decimal('0.40'),
};

interface ResolvedWallets {
  escrowId: string;
  revenueId: string;
  sellerId: string; // (CLIENT, sellerId) wallet — see header comment
  buyerId?: string; // (CLIENT, buyerId) wallet — only resolved when a buyer is actually involved
  all: string[];
}

/** `buyerId` is optional: release/refund-summary paths never touch the buyer's wallet, and
 * resolving it anyway would create a stray wallet row for callers that pass no real buyer. */
async function resolveWallets(params: { buyerId?: string; sellerId: string }): Promise<ResolvedWallets> {
  const [escrow, revenue, seller, buyer] = await Promise.all([
    walletService.getEscrowWallet(),
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('CLIENT', params.sellerId),
    params.buyerId ? walletService.getOrCreateWallet('CLIENT', params.buyerId) : Promise.resolve(null),
  ]);
  const all = [escrow.id, revenue.id, seller.id];
  if (buyer) all.push(buyer.id);
  return {
    escrowId: escrow.id,
    revenueId: revenue.id,
    sellerId: seller.id,
    buyerId: buyer?.id,
    all,
  };
}

function ratesFor(commissionRate: Prisma.Decimal): RateTable {
  return { ptRate: ONE.minus(commissionRate), platformRate: commissionRate, gymRate: ZERO };
}

export interface HoldResult {
  escrowAfter: string;
  pending: { seller: string; platform: string };
}

/**
 * The buyer paid: debit their existing wallet balance, move the whole price into custodial
 * ESCROW, and simultaneously attribute the PT/platform split to their PENDING buckets — nobody
 * can spend any of it yet. Mirrors contract-ledger.service.ts's settleContractPayment, except
 * the price comes from an existing wallet balance (debited here) rather than a fresh gateway
 * payment, so this function ALSO does the payer debit `transferInternal` would have done.
 *
 * Also writes a PlatformCommission row — not just bookkeeping. It is what lets
 * refundPersonalizedServiceHeld later read back the ACTUAL rate this specific order settled at
 * (via transactionRepository.findCommissionByTransactionId, the same lookup the existing generic
 * refund endpoint already relies on), instead of trusting whatever the commission-rate env var
 * happens to say by the time a refund is requested, possibly much later.
 */
export async function holdPersonalizedServicePayment(params: {
  transactionId: string;
  price: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  buyerId: string;
  sellerId: string;
  label: string;
}): Promise<HoldResult> {
  const { transactionId, price, commissionRate, buyerId, sellerId, label } = params;
  if (price.lessThanOrEqualTo(0)) throw new Error('price must be > 0');

  const wallets = await resolveWallets({ buyerId, sellerId });
  if (!wallets.buyerId) throw new Error('buyer wallet did not resolve'); // narrows for the closure below
  const buyerWalletId = wallets.buyerId;
  const rates = ratesFor(commissionRate);
  const split = splitThreeWays(price, rates);

  return walletService.withWallets(wallets.all, transactionId, async (ops) => {
    // Same compare-and-swap discipline as settleContractPayment/transferInternal: only the
    // caller that actually flips the transaction to PAID may move money. A retried request
    // (same transactionId) sees status already PAID and does nothing further.
    const flipped = await ops.tx.paymentTransaction.updateMany({
      where: { id: transactionId, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (flipped.count === 0) {
      logger.info(`[PersonalizedServiceLedger] Transaction ${transactionId} already settled — skipping`);
      return {
        escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
        pending: {
          seller: ops.balance(wallets.sellerId, 'PENDING').toFixed(2),
          platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
        },
      };
    }

    await ops.debit(buyerWalletId, price, `${label} — payment`);
    await ops.credit(wallets.escrowId, price, `${label} — received`);
    if (split.pt.greaterThan(0)) await ops.credit(wallets.sellerId, split.pt, `${label} — PT share held`, 'PENDING');
    if (split.platform.greaterThan(0)) {
      await ops.credit(wallets.revenueId, split.platform, `${label} — platform share held`, 'PENDING');
    }

    await ops.tx.platformCommission.create({
      data: {
        paymentTransactionId: transactionId,
        partnerType: 'PT',
        partnerId: sellerId,
        grossAmount: price,
        platformFeeAmount: split.platform,
        partnerPayoutAmount: split.pt,
        commissionRate,
        status: 'PENDING',
      },
    });

    return {
      escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
      pending: {
        seller: ops.balance(wallets.sellerId, 'PENDING').toFixed(2),
        platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
      },
    };
  });
}

export interface ReleaseResult {
  released: { seller: string; platform: string };
  milestone: PersonalizedServiceMilestone;
}

/**
 * A milestone was reached: move that slice from PENDING to AVAILABLE for the seller and the
 * platform. Idempotency for which milestones have already fired lives in ai-service (the
 * milestone*ReleasedAt guard fields on PersonalizedServiceOrder — this function itself has no
 * way to know "has INTAKE_REVIEWED already paid out for this order" beyond what's left in
 * PENDING). As a second line of defense, `move()`'s clamp-to-available means a duplicate call
 * simply finds nothing left to move rather than ever overpaying.
 *
 * COMPLETED does not compute its own 20% — it drains whatever remains in PENDING for this
 * transactionId, so the three earlier (independently rounded-down) slices' residue always lands
 * with the final release rather than surviving in PENDING forever. Also the correct behavior for
 * legacy pre-escrow orders (zero PENDING throughout): every release, including COMPLETED, is a
 * harmless no-op — that PT was already paid in full immediately under the old wallet-transfer path.
 */
export async function releasePersonalizedServiceMilestone(params: {
  transactionId: string;
  sellerId: string;
  price: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  milestone: PersonalizedServiceMilestone;
  label: string;
}): Promise<ReleaseResult> {
  const { transactionId, sellerId, price, commissionRate, milestone, label } = params;
  const wallets = await resolveWallets({ sellerId }); // no buyer wallet involved in a release
  const rates = ratesFor(commissionRate);

  return walletService.withWallets([wallets.escrowId, wallets.revenueId, wallets.sellerId], transactionId, async (ops) => {
    let slice: { pt: Prisma.Decimal; platform: Prisma.Decimal };
    if (milestone === 'COMPLETED') {
      const sellerPending = await pendingRemainingForTxn(ops, wallets.sellerId, transactionId);
      const platformPending = await pendingRemainingForTxn(ops, wallets.revenueId, transactionId);
      slice = { pt: sellerPending, platform: platformPending };
    } else {
      const pct = MILESTONE_RELEASE_PCT[milestone];
      slice = splitThreeWays(price.mul(pct).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN), rates);
    }

    const move = async (walletId: string, amount: Prisma.Decimal, who: 'PT' | 'PLATFORM') => {
      if (amount.lessThanOrEqualTo(0)) return ZERO;
      const available = ops.balance(walletId, 'PENDING');
      const moving = available.lessThan(amount) ? available : amount;
      if (moving.lessThanOrEqualTo(0)) {
        logger.warn(`[PersonalizedServiceLedger] ${who} pending bucket empty for ${label} (${milestone}) — nothing to release`);
        return ZERO;
      }
      await ops.debit(walletId, moving, `${label} — ${milestone} release`, 'PENDING');
      await ops.credit(walletId, moving, `${label} — ${milestone} earned`, 'AVAILABLE');
      if (who === 'PT') {
        await recoverReceivables({
          ops,
          walletId,
          revenueWalletId: wallets.revenueId,
          partnerType: 'PT',
          partnerId: sellerId,
          justCredited: moving,
          label,
        });
      }
      return moving;
    };

    const releasedPt = await move(wallets.sellerId, slice.pt, 'PT');
    const releasedPlatform = await move(wallets.revenueId, slice.platform, 'PLATFORM');

    return {
      milestone,
      released: { seller: releasedPt.toFixed(2), platform: releasedPlatform.toFixed(2) },
    };
  });
}

export interface RefundResult {
  refunded: string;
  drawnFrom: { sellerPending: string; sellerAvailable: string; platformPending: string; platformAvailable: string };
  shortfall: string;
}

/**
 * An admin approved a refund. Charges the seller and the platform in proportion to the ACTUAL
 * commission rate this order settled at (read off the PlatformCommission row written at hold
 * time — never today's env-var default, which may have changed since), drawing PENDING first
 * (money not yet earned) and then pooled AVAILABLE (already-released money — see
 * contract-ledger.service.ts's compensateNoShow for the same two-bucket precedent; there is no
 * withdrawal feature yet, so pooled AVAILABLE is always still reachable within this ledger). Any
 * true gap is fronted by the platform and booked as a PT receivable via coverShortfall, same as
 * every other shortfall path in this system.
 *
 * The refundable CEILING (priceAtPurchase − cumulativeRefundedAmount) is enforced by the caller
 * (ai-service's adminResolveRefund) before this is ever called — this function's job is only to
 * move the money correctly, not to re-derive that business ceiling.
 */
export async function refundPersonalizedServiceHeld(params: {
  transactionId: string;
  sellerId: string;
  buyerId: string;
  refundAmount: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  label: string;
}): Promise<RefundResult> {
  const { transactionId, sellerId, buyerId, refundAmount, commissionRate, label } = params;
  if (refundAmount.lessThanOrEqualTo(0)) throw new Error('refundAmount must be > 0');

  const wallets = await resolveWallets({ buyerId, sellerId });
  if (!wallets.buyerId) throw new Error('buyer wallet did not resolve'); // narrows for the closure below
  const buyerWalletId = wallets.buyerId;
  const rates = ratesFor(commissionRate);
  const owed = splitThreeWays(refundAmount, rates);

  return walletService.withWallets(wallets.all, transactionId, async (ops) => {
    const drawn = { sellerPending: ZERO, sellerAvailable: ZERO, platformPending: ZERO, platformAvailable: ZERO };
    let shortfall = ZERO;

    const charge = async (
      walletId: string,
      amount: Prisma.Decimal,
      pendingKey: 'sellerPending' | 'platformPending',
      availableKey: 'sellerAvailable' | 'platformAvailable',
    ) => {
      if (amount.lessThanOrEqualTo(0)) return;
      let outstanding = amount;
      const pendingForTxn = await pendingRemainingForTxn(ops, walletId, transactionId);
      const fromPending = pendingForTxn.lessThan(outstanding) ? pendingForTxn : outstanding;
      if (fromPending.greaterThan(0)) {
        await ops.debit(walletId, fromPending, `${label} — refund drawn from held funds`, 'PENDING');
        drawn[pendingKey] = fromPending;
        outstanding = outstanding.minus(fromPending);
      }
      if (outstanding.greaterThan(0)) {
        const availHeld = ops.balance(walletId, 'AVAILABLE');
        const fromAvail = availHeld.lessThan(outstanding) ? availHeld : outstanding;
        if (fromAvail.greaterThan(0)) {
          await ops.debit(walletId, fromAvail, `${label} — refund clawed back from released funds`, 'AVAILABLE');
          drawn[availableKey] = fromAvail;
          outstanding = outstanding.minus(fromAvail);
        }
      }
      shortfall = shortfall.plus(outstanding);
    };

    await charge(wallets.sellerId, owed.pt, 'sellerPending', 'sellerAvailable');
    await charge(wallets.revenueId, owed.platform, 'platformPending', 'platformAvailable');

    await ops.credit(buyerWalletId, refundAmount, `${label} — refund`);

    if (shortfall.greaterThan(0)) {
      await coverShortfall(ops, wallets.revenueId, shortfall, {
        partnerType: 'PT',
        partnerId: sellerId,
        reason: `Personalized Service refund shortfall (${label})`,
        transactionId,
      });
    }

    return {
      refunded: refundAmount.toFixed(2),
      drawnFrom: {
        sellerPending: drawn.sellerPending.toFixed(2),
        sellerAvailable: drawn.sellerAvailable.toFixed(2),
        platformPending: drawn.platformPending.toFixed(2),
        platformAvailable: drawn.platformAvailable.toFixed(2),
      },
      shortfall: shortfall.toFixed(2),
    };
  });
}

/** Read-only summary for admin UI / getRefundCalculation — no side effects. */
export async function getPersonalizedServiceLedgerSummary(params: {
  transactionId: string;
  sellerId: string;
}): Promise<{ held: { seller: string; platform: string } }> {
  const wallets = await resolveWallets({ sellerId: params.sellerId });
  return walletService.withWallets([wallets.sellerId, wallets.revenueId], `read:${params.transactionId}`, async (ops) => {
    const seller = await pendingRemainingForTxn(ops, wallets.sellerId, params.transactionId);
    const platform = await pendingRemainingForTxn(ops, wallets.revenueId, params.transactionId);
    return { held: { seller: seller.toFixed(2), platform: platform.toFixed(2) } };
  });
}
