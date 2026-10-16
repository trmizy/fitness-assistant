import { logger } from '@gym-coach/shared';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { PaymentProviderType, Prisma } from '../generated/prisma';
import type { PaymentTransaction } from '../generated/prisma';
import type { ProviderTxnStatus } from '../providers/payment-provider.interface';
import { walletService } from './wallet.service';
import { settleContractPayment } from './contract-ledger.service';
import { getProvider } from './payment.service';
import { compareGatewayAmount, recordGatewayDiscrepancy } from './gateway-amount';
import { isGatewayEnabledForRealMoney, isLegacyWalletTopupSettlementAllowed, productionVerificationEnvName } from './gateway-policy';

interface IncomingWebhookEvent {
  provider: string;
  providerEventId: string;
  providerTransactionId: string;
  payload: Record<string, unknown>;
  status: 'PAID' | 'FAILED';
  /**
   * What the gateway says it collected, in whole VND (see NormalizedWebhookEvent.paidAmountVnd).
   * REQUIRED for a PAID event from EVERY provider: handleEvent refuses to settle it unless this equals the
   * transaction's price. An event that omits it (undefined/null) is refused as AMOUNT_MISSING.
   */
  paidAmountVnd?: string | null;
  /** Which door the event came through ('IPN' | 'RETURN' | 'POLL'), kept in the discrepancy record. */
  source?: string;
}

/**
 * What handleEvent did, for callers that must answer the gateway precisely (VNPay's IPN contract
 * distinguishes "confirmed", "already confirmed", "order not found" and "invalid amount").
 * Existing callers that ignore the return value are unaffected.
 */
export type HandleEventOutcome =
  | 'SETTLED'            // money moved (or, for a concurrent duplicate, had just moved) for this PAID event
  | 'ALREADY_PAID'       // the transaction was already PAID — nothing moved
  | 'DUPLICATE_EVENT'    // this exact provider event was already processed — nothing moved
  | 'NOT_PAID_EVENT'     // the event reported a failure — nothing moved
  | 'NOT_FOUND'          // no transaction of this provider with that reference
  | 'PROVIDER_MISMATCH'  // (unreachable via the scoped lookup; kept as defence in depth)
  | 'AMOUNT_MISMATCH'    // the gateway-reported amount differs from the price — recorded, nothing moved
  | 'REFERENCE_MISMATCH' // the callback names a different gateway payment link than the one created for this transaction
  | 'GATEWAY_DISABLED'   // this provider may not settle real money in this deployment (gateway-policy.ts) — nothing moved, retryable
  | 'NOT_PAYABLE';       // the transaction is in a terminal state a payment must not revive (REFUNDED), or a retired flow

/** The gateway's own transaction number, for the discrepancy record - provider-specific field names. */
function gatewayTransactionNoOf(provider: PaymentProviderType, payload: Record<string, unknown> | undefined): string | null {
  const p = payload ?? {};
  const pick = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]) : null);
  switch (provider) {
    case 'VNPAY': return pick('vnp_TransactionNo');
    case 'ZALOPAY': return pick('zp_trans_id');
    case 'PAYOS': return pick('reference');
    case 'MOMO': return pick('transId');
    default: return null;
  }
}

/** The amount figure exactly as the gateway sent it (VNPay's is x100), for the discrepancy record. */
function rawReportedAmountOf(provider: PaymentProviderType, payload: Record<string, unknown> | undefined): string | null {
  const v = (payload ?? {})[provider === 'VNPAY' ? 'vnp_Amount' : 'amount'];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

/** True when the callback names a gateway payment link other than the one stored on the transaction at checkout. */
function referenceBindingMismatch(provider: PaymentProviderType, txnMetadata: unknown, payload: Record<string, unknown> | undefined): boolean {
  if (provider !== 'PAYOS') return false;
  const stored = ((txnMetadata ?? {}) as Record<string, unknown>).paymentLinkId;
  const received = (payload ?? {}).paymentLinkId;
  return typeof stored === 'string' && stored !== '' && typeof received === 'string' && received !== '' && stored !== received;
}

/**
 * Handles provider webhooks for WALLET_TOPUP transactions only — gym-membership and
 * PT-contract purchases no longer go through an external redirect, so this is now the
 * only purpose this handler ever needs to resolve.
 */
export async function handleEvent(event: IncomingWebhookEvent): Promise<HandleEventOutcome> {
  const providerEnum = event.provider as PaymentProviderType;

  // Idempotency: upsert event record; if already exists, skip
  const webhookRecord = await webhookRepository.upsert({
    provider: providerEnum,
    providerEventId: event.providerEventId,
    providerTransactionId: event.providerTransactionId,
    payload: event.payload as Prisma.InputJsonValue,
  });

  if (webhookRecord.processedAt) {
    logger.info(`[WebhookService] Event ${event.providerEventId} already processed — skipping`);
    return 'DUPLICATE_EVENT';
  }

  if (event.status !== 'PAID') {
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'NOT_PAID_EVENT';
  }

  const txn = await transactionRepository.findByProviderTransactionId(event.providerTransactionId, providerEnum);
  if (!txn) {
    // Deliberately do NOT fall back to an unscoped (any-provider) lookup here:
    // that fallback is exactly the bug this fixes — a webhook event for one
    // provider must never be able to resolve to a transaction created under a
    // different provider, even if the id happens to match. If a transaction
    // exists under a different provider with this id, this is either a
    // misconfigured provider name or a forged/mismatched event — both must
    // be rejected, not silently matched.
    logger.warn(`[WebhookService] No ${providerEnum} transaction found for providerTxnId=${event.providerTransactionId}`);
    // NOT marked processed: an authentic paid callback for a reference we cannot find yet (the gateway order exists but
    // our row does not - e.g. the insert after the gateway call failed and was repaired by hand) must not be answered
    // "already processed" when the gateway retries. The row stays unprocessed so the retry is evaluated afresh.
    return 'NOT_FOUND';
  }

  // Provider match: the webhook's provider MUST equal the transaction's own provider. Without this,
  // a webhook accepted under the weakest gateway's verification could complete a real VNPay/ZaloPay
  // transaction if the attacker learns its providerTransactionId — crediting a wallet with no real
  // money. Never credit across providers.
  if (String(event.provider).toUpperCase() !== String(txn.provider).toUpperCase()) {
    logger.warn(`[WebhookService] Provider mismatch for txn ${txn.id}: event=${event.provider} txn=${txn.provider} — rejecting`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'PROVIDER_MISMATCH';
  }

  // Amount check — BEFORE anything is settled, activated or even looked at for "already PAID", in the
  // order VNPay's own integration guide prescribes (order exists -> amount -> status). A signed
  // "paid" callback only proves the gateway said something about this reference; the amount it
  // reports must equal the price of the order, exactly, or no money may move (see gateway-amount.ts).
  // A missing amount is a refusal too: "the gateway did not say how much" cannot settle a price.
  // Enforced here, not only in the HTTP routes, so every route into settlement (IPN, browser
  // return, querydr poll, /sync) is covered by the same rule and a future caller cannot forget it.
  //
  // This applies to EVERY provider (VNPay, ZaloPay, PayOS, MoMo): each provider converts its own wire format and
  // unit to whole VND before calling here (VNPay x100, the rest plain VND).
  {
    const verdict = compareGatewayAmount(txn.amount, event.paidAmountVnd);
    if (!verdict.ok) {
      await recordGatewayDiscrepancy({
        transactionId: txn.id,
        verdict,
        source: event.source ?? 'UNKNOWN',
        gatewayTransactionNo: gatewayTransactionNoOf(providerEnum, event.payload),
        reportedMinorUnits: rawReportedAmountOf(providerEnum, event.payload),
      });
      await webhookRepository.markProcessed(webhookRecord.id);
      return 'AMOUNT_MISMATCH';
    }
  }

  // The callback must be about the payment link created for THIS transaction (PayOS has no merchant id in its webhook;
  // the paymentLinkId PayOS returned at checkout is the binding). Only checked where both sides state one.
  if (referenceBindingMismatch(providerEnum, txn.metadata, event.payload)) {
    logger.error({ error: '[WebhookService] callback names a different gateway payment link than the one created for this transaction — refusing', transactionId: txn.id, provider: providerEnum });
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'REFERENCE_MISMATCH';
  }

  // A gateway nobody has verified against its production system may not book real money (see gateway-policy.ts).
  // The event is NOT marked processed and the transaction is left alone: once the operator has verified the gateway
  // and flipped the switch, the gateway's own retry (or the poll) settles it normally.
  if (!isGatewayEnabledForRealMoney(providerEnum)) {
    logger.error({
      error: `[WebhookService] ${providerEnum} is not enabled for production payments (${productionVerificationEnvName(providerEnum)}) — NOT settling transaction`,
      transactionId: txn.id,
      providerEventId: event.providerEventId,
    });
    return 'GATEWAY_DISABLED';
  }

  // A REFUNDED transaction was settled and then given back; a payment arriving for it now must not
  // flip it to PAID and credit escrow a second time. (CANCELLED/FAILED are different: the money for
  // them was never booked, so a genuine exact-amount payment still settles and, if the order is no
  // longer activatable, goes through activateOrRefund -> full refund to the client.)
  if (txn.status === 'REFUNDED') {
    logger.warn(`[WebhookService] Transaction ${txn.id} is REFUNDED — ignoring payment event ${event.providerEventId}`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'NOT_PAYABLE';
  }

  // Purchases pay the gateway directly now, so a webhook can be settling a contract rather
  // than a top-up. Both funnel through this one idempotent handler; only the allocation
  // differs. (WALLET_TOPUP survives for historical rows — the top-up flow itself is gone.)
  if (txn.purpose !== 'WALLET_TOPUP') {
    if (txn.status === 'PAID') {
      logger.info(`[WebhookService] Transaction ${txn.id} already settled — skipping`);
      await webhookRepository.markProcessed(webhookRecord.id);
      return 'ALREADY_PAID';
    }
    try {
      await settlePurchase(txn);
    } catch (err) {
      logger.error({ error: '[WebhookService] purchase settlement failed', transactionId: txn.id, message: (err as Error).message });
      // Leave the webhook unprocessed so the reconciliation sweep retries it: a purchase the
      // client actually paid for must not be dropped because one allocation attempt failed.
      throw err;
    }
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'SETTLED';
  }

  // Idempotent credit guard: a duplicate webhook delivery (or a late delivery after this
  // transaction was already swept to FAILED by the stale-PROCESSING sweep — see
  // reconciliation.service.ts) must never credit the wallet twice. Only skip if already
  // PAID; a FAILED row is NOT skipped, since a late "actually succeeded" webhook must
  // still be able to flip it to PAID and credit exactly once.
  if (txn.status === 'PAID') {
    logger.info(`[WebhookService] Transaction ${txn.id} already PAID — skipping duplicate credit`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'ALREADY_PAID';
  }

  // The top-up flow is retired and its credit has no escrow leg (it breaks escrow == sum of claims). A stray late
  // callback for an old top-up row must not mint a wallet balance in production; it is recorded for an admin to
  // give back at the gateway instead.
  if (!isLegacyWalletTopupSettlementAllowed()) {
    await recordGatewayDiscrepancy({
      transactionId: txn.id,
      verdict: { ok: false, kind: 'PURPOSE_NOT_SETTLEABLE', expectedAmountVnd: new Prisma.Decimal(txn.amount).toFixed(0), reportedAmountVnd: event.paidAmountVnd ?? null },
      source: event.source ?? 'UNKNOWN',
      gatewayTransactionNo: gatewayTransactionNoOf(providerEnum, event.payload),
      reportedMinorUnits: rawReportedAmountOf(providerEnum, event.payload),
    });
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'NOT_PAYABLE';
  }

  if (!txn.receiverWalletId) {
    logger.error(`[WebhookService] WALLET_TOPUP transaction ${txn.id} has no receiverWalletId`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return 'NOT_PAYABLE';
  }

  try {
    await walletService.creditWalletAndMarkPaid(txn.receiverWalletId, new Prisma.Decimal(txn.amount), txn.id, 'Wallet top-up');
    await webhookRepository.markProcessed(webhookRecord.id);
    logger.info(`[WebhookService] Wallet ${txn.receiverWalletId} credited for top-up ${txn.id}`);
    return 'SETTLED';
  } catch (err) {
    await webhookRepository.incrementRetry(webhookRecord.id);
    logger.error({ error: '[WebhookService] Failed to credit wallet for top-up', txnId: txn.id, message: (err as Error).message });
    throw err;
  }
}

/**
 * A purchase the client paid for at the gateway: put the price into escrow and attribute it
 * to the three parties' pending buckets, then tell the owning service to activate.
 *
 * The rate table and the parties are read back from the transaction's own metadata, frozen
 * there when checkout started. Re-deriving them now would apply whatever terms happen to be
 * current, which is wrong on two counts: the client agreed to the old ones, and a webhook
 * replayed during reconciliation days later would allocate differently from the original.
 */
async function settlePurchase(txn: {
  id: string;
  amount: Prisma.Decimal;
  purpose: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: unknown;
}): Promise<void> {
  const meta = (txn.metadata ?? {}) as Record<string, any>;
  if (!meta.rates || !meta.parties) {
    throw new Error(`transaction ${txn.id} has no frozen rate/party snapshot — cannot allocate`);
  }
  const rates = {
    platformRate: new Prisma.Decimal(meta.rates.platformRate),
    ptRate: new Prisma.Decimal(meta.rates.ptRate),
    gymRate: new Prisma.Decimal(meta.rates.gymRate),
  };

  const result = await settleContractPayment({
    transactionId: txn.id,
    price: new Prisma.Decimal(txn.amount),
    rates,
    parties: {
      ptUserId: meta.parties.ptUserId,
      gymId: meta.parties.gymId ?? null,
      clientUserId: meta.parties.clientUserId,
    },
    label: `${txn.purpose} ${txn.relatedEntityId ?? txn.id}`,
  });

  logger.info(
    `[WebhookService] Settled ${txn.purpose} ${txn.id}: escrow=${result.escrowAfter} pending pt=${result.pending.pt} gym=${result.pending.gym} platform=${result.pending.platform}`,
  );

  // Activation is the owning service's job (activate the contract, the membership, …) and is
  // retried by the reconciliation sweep if it fails, so a hiccup there never unwinds money
  // that has genuinely been received.
  try {
    const { activateOrRefund } = await import('./reconciliation.service');
    const fresh = await transactionRepository.findById(txn.id);
    if (fresh) {
      // Activates, or — when user-service answers that the contract can no longer be activated
      // by this payment — refunds the client in full. Anything else (transport, 5xx, a failed
      // refund) lands in the catch below and is retried by the sweep.
      await activateOrRefund(fresh);
    } else {
      await transactionRepository.markActivated(txn.id);
    }
  } catch (e) {
    logger.warn({ error: 'activation callback failed; reconciliation will retry', transactionId: txn.id, message: (e as Error).message });
  }
}

/**
 * Actively confirms one PROCESSING transaction at its own gateway instead of waiting on a
 * webhook.
 *
 * Every provider (VNPay querydr, ZaloPay /v2/query, MoMo /query, PayOS payment-requests)
 * implements queryTransactionStatus() for exactly this "local/dev confirmation path" — see
 * each provider file — but until now nothing ever called it. VNPay alone had a working
 * confirmation route (the signed vnpay/return redirect); every other gateway's PROCESSING
 * purchase just sat until sweepStaleProcessing marked it FAILED after
 * NON_TOPUP_STALE_MINUTES, even when the gateway had genuinely captured the money. This is
 * the function that closes that gap — called from the reconciliation sweep for every
 * PROCESSING purchase, and from POST /me/payments/:id/sync for an immediate check.
 *
 * Reuses handleEvent for the actual settlement so a poll-confirmed payment goes through the
 * exact same idempotent path a real webhook would (provider-match guard, already-PAID guard,
 * frozen rate/party allocation) — this function only ever supplies the "PAID" signal.
 */
/**
 * GAP-22: a gateway that SIGNS a definitive failure for a checkout (VNPay's return redirect with
 * vnp_ResponseCode 24 when the payer cancels, …) used to leave the transaction PENDING until the
 * stale sweep, so the result page said "Đang chờ xác nhận" for a payment that was already over.
 * Close it now — same provider-scoped lookup and provider-match rule as handleEvent, and only from
 * PENDING/PROCESSING (markFailedIfOpen). A later genuine PAID still settles a FAILED purchase
 * (handleEvent only skips PAID rows), so this can never lose a real payment.
 * The caller is responsible for having verified the provider's signature first.
 */
export async function failFromSignedGatewayResult(event: {
  provider: string;
  providerTransactionId: string;
}): Promise<boolean> {
  const providerEnum = event.provider as PaymentProviderType;
  const txn = await transactionRepository.findByProviderTransactionId(event.providerTransactionId, providerEnum);
  if (!txn) return false;
  if (String(event.provider).toUpperCase() !== String(txn.provider).toUpperCase()) return false;
  const moved = await transactionRepository.markFailedIfOpen(txn.id);
  if (moved) logger.info(`[WebhookService] ${event.provider} reported a definitive failure — transaction ${txn.id} → FAILED`);
  return moved;
}

export async function pollAndSettle(txn: PaymentTransaction): Promise<'PAID' | 'FAILED' | 'PENDING' | 'UNSUPPORTED'> {
  // A direct-to-gateway checkout (membership/contract purchase) is created with status
  // PENDING and never moves to PROCESSING anywhere in this codebase — only the old
  // wallet-topup path used PROCESSING. Gating on PROCESSING alone made this a no-op for
  // every real purchase: it would report a brand-new, still-unpaid PENDING transaction as
  // FAILED without ever asking the gateway. Anything not already terminal is worth polling.
  const TERMINAL = new Set(['PAID', 'FAILED', 'CANCELLED', 'REFUNDED']);
  if (TERMINAL.has(txn.status)) return txn.status === 'PAID' ? 'PAID' : 'FAILED';

  // Do not even ask a gateway that may not settle real money here (gateway-policy.ts).
  if (!isGatewayEnabledForRealMoney(txn.provider)) return 'UNSUPPORTED';

  const provider = getProvider(txn.provider);
  if (!provider.queryTransactionStatus) return 'UNSUPPORTED';

  const query = {
    id: txn.id,
    providerTransactionId: txn.providerTransactionId,
    amount: Number(txn.amount),
    createdAt: txn.createdAt,
    metadata: txn.metadata,
  };

  // A provider that reports what it collected (VNPay querydr) is asked through queryGatewayResult
  // so the amount reaches handleEvent's check; a bare 'PAID' from it would be refused anyway.
  let result: ProviderTxnStatus;
  let paidAmountVnd: string | null | undefined;
  let raw: Record<string, unknown> = {};
  if (provider.queryGatewayResult) {
    const gw = await provider.queryGatewayResult(query);
    result = gw.status;
    paidAmountVnd = gw.paidAmountVnd;
    raw = gw.raw ?? {};
  } else {
    result = await provider.queryTransactionStatus(query);
  }

  if (result === 'PAID') {
    const outcome = await handleEvent({
      provider: txn.provider,
      providerEventId: `poll_${txn.id}_${Date.now()}`,
      providerTransactionId: txn.providerTransactionId ?? txn.id,
      payload: raw,
      status: 'PAID',
      paidAmountVnd,
      source: 'POLL',
    });
    // The gateway said "paid" but for a different amount: the transaction was NOT settled, so do not
    // tell the caller (reconciliation log, /sync response) that it was.
    if (outcome === 'AMOUNT_MISMATCH') return 'FAILED';
    if (outcome === 'REFERENCE_MISMATCH' || outcome === 'GATEWAY_DISABLED') return 'PENDING';
  }
  return result;
}
