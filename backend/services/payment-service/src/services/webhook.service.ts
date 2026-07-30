import { logger } from '@gym-coach/shared';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { PaymentProviderType, Prisma } from '../generated/prisma';
import { setWebhookHandler } from '../providers/mock.provider';
import { walletService } from './wallet.service';

interface IncomingWebhookEvent {
  provider: string;
  providerEventId: string;
  providerTransactionId: string;
  payload: Record<string, unknown>;
  status: 'PAID' | 'FAILED';
}

// Register mock provider handler to avoid circular import
setWebhookHandler((event) => handleEvent(event));

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

  if (txn.purpose !== 'WALLET_TOPUP') {
    logger.warn(`[WebhookService] Transaction ${txn.id} is not a WALLET_TOPUP (purpose=${txn.purpose}) — ignoring webhook`);
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
