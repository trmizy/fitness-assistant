import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { walletService } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';
import { splitThreeWays, ZERO } from './contract-money';
import { coverShortfall, recoverReceivables } from './contract-ledger.service';

/**
 * P0 cluster C3 — escrow for Personalized PT Service orders (ai-service).
 *
 * A deliberately small sibling of contract-ledger.service.ts, not a reuse of its PT-contract
 * shaped functions: a personalized-service order has no totalSessions/usedSessions concept —
 * it is one lump-sum price, held until the buyer accepts the delivered work (or the
 * auto-accept sweep does, on their behalf, after the review window lapses) or refunded. Same
 * underlying primitives (walletService.withWallets, withIdempotentLedgerOp,
 * coverShortfall/recoverReceivables) — a different shape of formula.
 *
 * There is no `holdOrder` here: the "hold" step (price → escrow, PT/platform shares →
 * PENDING) is exactly what the existing generic checkout + webhook pipeline already does for
 * every gateway purchase (settleContractPayment, called from webhook.service.ts's
 * settlePurchase) — personalized-service just needed to start using that pipeline instead of
 * the old direct wallet-transfer (C2). Writing a second "hold" primitive here would duplicate
 * that, not add anything.
 *
 * No gym share: PersonalizedService has no gymId — every split here is PT vs platform only.
 */

export interface OrderParties {
  ptUserId: string;
  clientUserId: string;
}

export interface OrderRates {
  ptRate: Prisma.Decimal;
  platformRate: Prisma.Decimal;
}

interface ResolvedWallets {
  revenueId: string;
  ptId: string;
  clientId: string;
  all: string[];
}

async function resolveWallets(parties: OrderParties): Promise<ResolvedWallets> {
  const [revenue, pt, client] = await Promise.all([
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('PT', parties.ptUserId),
    walletService.getOrCreateWallet('CLIENT', parties.clientUserId),
  ]);
  return { revenueId: revenue.id, ptId: pt.id, clientId: client.id, all: [revenue.id, pt.id, client.id] };
}

function split(amount: Prisma.Decimal, rates: OrderRates) {
  return splitThreeWays(amount, { ptRate: rates.ptRate, gymRate: ZERO, platformRate: rates.platformRate });
}

export interface ReleaseResult {
  released: { pt: string; platform: string };
}

/**
 * Step 2 of the lifecycle: the buyer accepted (or auto-accept did). The PT and platform's
 * full pending share for this order becomes withdrawable. There is no partial-release
 * concept — one order, one delivery, accepted or refunded as a whole — so this always moves
 * everything still sitting in pending for the order's two parties.
 */
export async function releaseOrder(params: {
  transactionId: string;
  price: Prisma.Decimal;
  rates: OrderRates;
  parties: OrderParties;
  label: string;
  /** Business key `PERSONALIZED_RELEASE:<orderId>` — an order is only ever accepted once, so
   * this key is stable across retries of the SAME acceptance (manual or auto-accept). */
  idempotencyKey: string;
}): Promise<ReleaseResult> {
  const { transactionId, price, rates, parties, label, idempotencyKey } = params;
  const wallets = await resolveWallets(parties);
  const shares = split(price, rates);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      const move = async (
        walletId: string,
        amount: Prisma.Decimal,
        who: string,
        debtor?: { partnerType: 'PT'; partnerId: string },
      ): Promise<Prisma.Decimal> => {
        if (amount.lessThanOrEqualTo(0)) return ZERO;
        const held = ops.balance(walletId, 'PENDING');
        const moving = held.lessThan(amount) ? held : amount;
        if (moving.lessThanOrEqualTo(0)) {
          logger.warn(`[PersonalizedServiceLedger] ${who} pending bucket empty for ${label} — nothing to release`);
          return ZERO;
        }
        await ops.debit(walletId, moving, `${label} — release to available`, 'PENDING');
        await ops.credit(walletId, moving, `${label} — order accepted`, 'AVAILABLE');
        if (debtor) {
          await recoverReceivables({ ops, walletId, revenueWalletId: wallets.revenueId, ...debtor, justCredited: moving, label });
        }
        return moving;
      };

      const pt = await move(wallets.ptId, shares.pt, 'PT', { partnerType: 'PT', partnerId: parties.ptUserId });
      const platform = await move(wallets.revenueId, shares.platform, 'platform');

      return { released: { pt: pt.toFixed(2), platform: platform.toFixed(2) } };
    }),
  );
}

export interface RefundResult {
  refund: string;
  clawedBack: { pt: string; platform: string };
  shortfall: string;
}

/**
 * Hands the client back `refundAmount`.
 *
 * Pulls first from whatever the PT and platform still hold in PENDING for this order — the
 * common case: cancelled or refunded before acceptance, when nothing has been released yet
 * (P0 cluster C4). If that is not enough — the order was already accepted and its money
 * released to AVAILABLE, or an earlier partial refund already drained pending (C5) — claws
 * back the rest from AVAILABLE. If even that falls short (the PT has already withdrawn),
 * the platform fronts it and books a PartnerReceivable against the PT via coverShortfall,
 * exactly like a PT-contract termination shortfall — the client is always made whole; the
 * PT's debt is recovered out of their future earnings via recoverReceivables (releaseOrder,
 * above). A shortfall on the PLATFORM's own share has nowhere further to go (the platform
 * cannot owe itself) and is reported back as `shortfall` — an operational alarm, not
 * something this function can resolve on its own.
 *
 * Escrow does not move: the cash never left the platform, only whose claim on it changed.
 */
export async function refundOrder(params: {
  transactionId: string;
  refundAmount: Prisma.Decimal;
  rates: OrderRates;
  parties: OrderParties;
  label: string;
  /** Business key `PERSONALIZED_REFUND:<orderId>:<refundAmount>` — amount-scoped (not just
   * `<orderId>`) because, like the pre-existing generic-refund path this replaces, an order
   * can be partially refunded more than once (adminResolveRefund's ceiling-tracked partial
   * approvals). A stable per-order key would make every refund after the first a no-op
   * replay of the first amount instead of a real second movement. */
  idempotencyKey: string;
}): Promise<RefundResult> {
  const { transactionId, refundAmount, rates, parties, label, idempotencyKey } = params;
  if (refundAmount.lessThanOrEqualTo(0)) throw new Error('refundAmount must be > 0');
  const wallets = await resolveWallets(parties);
  const shares = split(refundAmount, rates);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      const clawedBack = { pt: ZERO, platform: ZERO };
      let shortfall = ZERO;

      const clawback = async (
        walletId: string,
        amount: Prisma.Decimal,
        key: 'pt' | 'platform',
        debtor?: { partnerType: 'PT'; partnerId: string },
      ) => {
        if (amount.lessThanOrEqualTo(0)) return;
        let remaining = amount;

        const pending = ops.balance(walletId, 'PENDING');
        const fromPending = pending.lessThan(remaining) ? pending : remaining;
        if (fromPending.greaterThan(0)) {
          await ops.debit(walletId, fromPending, `${label} — refund funded from pending`, 'PENDING');
          clawedBack[key] = clawedBack[key].plus(fromPending);
          remaining = remaining.minus(fromPending);
        }
        if (remaining.lessThanOrEqualTo(0)) return;

        const available = ops.balance(walletId, 'AVAILABLE');
        const fromAvailable = available.lessThan(remaining) ? available : remaining;
        if (fromAvailable.greaterThan(0)) {
          await ops.debit(walletId, fromAvailable, `${label} — refund clawed back from available`, 'AVAILABLE');
          clawedBack[key] = clawedBack[key].plus(fromAvailable);
          remaining = remaining.minus(fromAvailable);
        }
        if (remaining.lessThanOrEqualTo(0)) return;

        if (debtor) {
          await coverShortfall(ops, wallets.revenueId, remaining, {
            partnerType: debtor.partnerType,
            partnerId: debtor.partnerId,
            reason: `${label} — refund shortfall`,
            transactionId,
          });
          clawedBack[key] = clawedBack[key].plus(remaining);
        } else {
          shortfall = shortfall.plus(remaining);
        }
      };

      await clawback(wallets.ptId, shares.pt, 'pt', { partnerType: 'PT', partnerId: parties.ptUserId });
      await clawback(wallets.revenueId, shares.platform, 'platform');

      await ops.credit(wallets.clientId, refundAmount, `${label} — refund`);

      if (shortfall.greaterThan(0)) {
        logger.error(`[PersonalizedServiceLedger] ${label}: platform revenue itself came up ${shortfall.toString()} short covering a refund — needs manual attention`);
      }

      return {
        refund: refundAmount.toFixed(2),
        clawedBack: { pt: clawedBack.pt.toFixed(2), platform: clawedBack.platform.toFixed(2) },
        shortfall: shortfall.toFixed(2),
      };
    }),
  );
}
