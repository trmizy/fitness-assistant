import { logger } from '@gym-coach/shared';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { PaymentProviderType, Prisma } from '../generated/prisma';
import type { PaymentTransaction } from '../generated/prisma';
import { walletService } from './wallet.service';
import { settleContractPayment } from './contract-ledger.service';
import { getProvider } from './payment.service';

interface IncomingWebhookEvent {
  provider: string;
  providerEventId: string;
  providerTransactionId: string;
  payload: Record<string, unknown>;
  status: 'PAID' | 'FAILED';
}

/**
 * Handles provider webhooks for WALLET_TOPUP transactions only — gym-membership and
 * PT-contract purchases no longer go through an external redirect, so this is now the
 * only purpose this handler ever needs to resolve.
 */
export async function handleEvent(event: IncomingWebhookEvent): Promise<void> {
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
    return;
  }

  if (event.status !== 'PAID') {
    await webhookRepository.markProcessed(webhookRecord.id);
    return;
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
    await webhookRepository.markProcessed(webhookRecord.id);
    return;
  }

  // Provider match: the webhook's provider MUST equal the transaction's own provider. Without this,
  // a webhook accepted under the weakest gateway's verification could complete a real VNPay/ZaloPay
  // transaction if the attacker learns its providerTransactionId — crediting a wallet with no real
  // money. Never credit across providers.
  if (String(event.provider).toUpperCase() !== String(txn.provider).toUpperCase()) {
    logger.warn(`[WebhookService] Provider mismatch for txn ${txn.id}: event=${event.provider} txn=${txn.provider} — rejecting`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return;
  }

  // Purchases pay the gateway directly now, so a webhook can be settling a contract rather
  // than a top-up. Both funnel through this one idempotent handler; only the allocation
  // differs. (WALLET_TOPUP survives for historical rows — the top-up flow itself is gone.)
  if (txn.purpose !== 'WALLET_TOPUP') {
    if (txn.status === 'PAID') {
      logger.info(`[WebhookService] Transaction ${txn.id} already settled — skipping`);
      await webhookRepository.markProcessed(webhookRecord.id);
      return;
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
    return;
  }

  // Idempotent credit guard: a duplicate webhook delivery (or a late delivery after this
  // transaction was already swept to FAILED by the stale-PROCESSING sweep — see
  // reconciliation.service.ts) must never credit the wallet twice. Only skip if already
  // PAID; a FAILED row is NOT skipped, since a late "actually succeeded" webhook must
  // still be able to flip it to PAID and credit exactly once.
  if (txn.status === 'PAID') {
    logger.info(`[WebhookService] Transaction ${txn.id} already PAID — skipping duplicate credit`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return;
  }

  if (!txn.receiverWalletId) {
    logger.error(`[WebhookService] WALLET_TOPUP transaction ${txn.id} has no receiverWalletId`);
    await webhookRepository.markProcessed(webhookRecord.id);
    return;
  }

  try {
    await walletService.creditWalletAndMarkPaid(txn.receiverWalletId, new Prisma.Decimal(txn.amount), txn.id, 'Wallet top-up');
    await webhookRepository.markProcessed(webhookRecord.id);
    logger.info(`[WebhookService] Wallet ${txn.receiverWalletId} credited for top-up ${txn.id}`);
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
    const { callActivateEndpoint } = await import('./reconciliation.service');
    const fresh = await transactionRepository.findById(txn.id);
    if (fresh) await callActivateEndpoint(fresh);
    await transactionRepository.markActivated(txn.id);
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
export async function pollAndSettle(txn: PaymentTransaction): Promise<'PAID' | 'FAILED' | 'PENDING' | 'UNSUPPORTED'> {
  // A direct-to-gateway checkout (membership/contract purchase) is created with status
  // PENDING and never moves to PROCESSING anywhere in this codebase — only the old
  // wallet-topup path used PROCESSING. Gating on PROCESSING alone made this a no-op for
  // every real purchase: it would report a brand-new, still-unpaid PENDING transaction as
  // FAILED without ever asking the gateway. Anything not already terminal is worth polling.
  const TERMINAL = new Set(['PAID', 'FAILED', 'CANCELLED', 'REFUNDED']);
  if (TERMINAL.has(txn.status)) return txn.status === 'PAID' ? 'PAID' : 'FAILED';

  const provider = getProvider(txn.provider);
  if (!provider.queryTransactionStatus) return 'UNSUPPORTED';

  const result = await provider.queryTransactionStatus({
    id: txn.id,
    providerTransactionId: txn.providerTransactionId,
    amount: Number(txn.amount),
    createdAt: txn.createdAt,
    metadata: txn.metadata,
  });

  if (result === 'PAID') {
    await handleEvent({
      provider: txn.provider,
      providerEventId: `poll_${txn.id}_${Date.now()}`,
      providerTransactionId: txn.providerTransactionId ?? txn.id,
      payload: {},
      status: 'PAID',
    });
  }
  return result;
}
