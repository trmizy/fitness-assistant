import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { walletService } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';
import { splitThreeWays, ZERO } from './contract-money';
import { ownPending, recordObligation, recoverReceivables } from './contract-ledger.service';

/**
 * P0 cluster C3 — escrow for Personalized PT Service orders (ai-service).
 *
 * A deliberately small sibling of contract-ledger.service.ts, not a reuse of its PT-contract
 * shaped functions: a personalized-service order has no totalSessions/usedSessions concept —
 * it is one lump-sum price, held until the buyer accepts the delivered work (or the
 * auto-accept sweep does, on their behalf, after the review window lapses) or refunded. Same
 * underlying primitives (walletService.withWallets, withIdempotentLedgerOp,
 * recordObligation/recoverReceivables) — a different shape of formula.
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
        // This order's pending, not the wallet's pooled bucket: the PT's and the platform's
        // pending also holds their contracts', memberships' and other orders' unearned money.
        const held = await ownPending(ops, walletId, transactionId);
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
  /** What the client was actually credited (== `paid`). */
  refund: string;
  clawedBack: { pt: string; platform: string };
  /** Same number as `unpaid` (kept for callers that read the older field). */
  shortfall: string;
  /** D48 / DQ-3: what the refund asked for, what this order's own money could fund, and the rest. */
  owed: string;
  paid: string;
  unpaid: string;
  /** Present only when `unpaid > 0`: the OPEN REFUND_SHORT row in contract_unpaid_obligations. */
  obligationId?: string;
}

/**
 * Hands the client back `refundAmount`, funded ONLY by this order's own money (D48 / DQ-1 S, DQ-3).
 *
 * The PT's and the platform's share of the refund is taken from what each still holds in PENDING
 * for this order (ownPending). Nothing else is ever touched: not the PT's or the platform's pooled
 * AVAILABLE balance (which holds their other work), and the platform does not front the gap or book
 * a PartnerReceivable. The client is credited exactly what was drawn (`paid`). When the order's own
 * money is not enough - typically it was already accepted and released, so its pending is gone - the
 * difference (`unpaid`) becomes a durable, idempotent OPEN REFUND_SHORT obligation to the client in
 * contract_unpaid_obligations, written in the same DB transaction as the ledger rows, for the admin
 * to settle through the audited obligation tooling.
 *
 * Escrow does not move: the cash never left the platform, only whose claim on it changed.
 *
 * This is a financial invariant (D48): no flag, env or API restores the old pooled draw / platform
 * fronting / PartnerReceivable behaviour.
 */
export async function refundOrder(params: {
  transactionId: string;
  refundAmount: Prisma.Decimal;
  rates: OrderRates;
  parties: OrderParties;
  label: string;
  /** Business key `PERSONALIZED_REFUND:<orderId>:<refundAmount>` - amount-scoped (not just
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

      const clawback = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'platform') => {
        if (amount.lessThanOrEqualTo(0)) return;
        // Only this order's own pending: a refund taken from the pool would be paid out of the
        // PT's other contracts and orders. The rest is the client's unpaid obligation, recorded below.
        const pending = await ownPending(ops, walletId, transactionId);
        const fromPending = pending.lessThan(amount) ? pending : amount;
        if (fromPending.greaterThan(0)) {
          await ops.debit(walletId, fromPending, `${label} — refund funded from pending`, 'PENDING');
          clawedBack[key] = clawedBack[key].plus(fromPending);
        }
      };

      await clawback(wallets.ptId, shares.pt, 'pt');
      await clawback(wallets.revenueId, shares.platform, 'platform');

      // The client gets exactly what the order's own money funded.
      const paid = clawedBack.pt.plus(clawedBack.platform);
      if (paid.greaterThan(0)) {
        await ops.credit(wallets.clientId, paid, `${label} — refund`);
      }
      const unpaid = refundAmount.minus(paid);

      let obligationId: string | undefined;
      if (unpaid.greaterThan(0)) {
        obligationId = await recordObligation(ops, {
          key: idempotencyKey,
          transactionId,
          contractRef: label,
          kind: 'REFUND_SHORT',
          party: 'CLIENT',
          owed: refundAmount,
          paid,
          reason: "Personalized-service refund: the order's own pending money could not fund the full amount",
        });
      }
      return {
        refund: paid.toFixed(2),
        clawedBack: { pt: clawedBack.pt.toFixed(2), platform: clawedBack.platform.toFixed(2) },
        shortfall: unpaid.toFixed(2),
        owed: refundAmount.toFixed(2),
        paid: paid.toFixed(2),
        unpaid: unpaid.toFixed(2),
        ...(obligationId ? { obligationId } : {}),
      };
    }),
  );
}
