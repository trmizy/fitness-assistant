import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import type { PaymentTransaction } from '../generated/prisma';

const INTERVAL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 10;
const NON_TOPUP_STALE_MINUTES = 10;
const TOPUP_STALE_MINUTES = Number(process.env.TOPUP_STALE_MINUTES ?? '60');

const GYM_SERVICE_URL = process.env.GYM_SERVICE_URL || 'http://localhost:3006';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

export function startReconciliationJob(): void {
  logger.info('Reconciliation job started (interval: 5 min)');
  setInterval(() => { void runReconciliation(); }, INTERVAL_MS);
}

async function runReconciliation(): Promise<void> {
  await reconcileTopupWebhookBookkeeping();
  await reconcilePendingActivations();
  await reconcilePendingRefundCancellations();
  await sweepStaleProcessing();
}

/**
 * Topup credit + PAID flip happen atomically in wallet.service.creditWalletAndMarkPaid,
 * so a webhook event left unprocessed here means only the bookkeeping flag wasn't set —
 * the money already moved. This just catches up the flag, it never re-credits.
 */
async function reconcileTopupWebhookBookkeeping(): Promise<void> {
  try {
    const unprocessed = await webhookRepository.findUnprocessedPaid();
    if (unprocessed.length === 0) return;
    logger.info(`[Reconciliation] Marking ${unprocessed.length} already-PAID webhook events as processed`);
    for (const row of unprocessed) {
      await webhookRepository.markProcessed(row.id).catch((err) => {
        logger.error({ error: 'Failed to mark webhook event processed', id: row.id, message: (err as Error).message });
      });
    }
  } catch (err) {
    logger.error({ error: 'Topup webhook bookkeeping reconciliation failed', message: (err as Error).message });
  }
}

/** GYM_MEMBERSHIP / PT_CONTRACT wallet-transfers that are PAID but not yet activated downstream. */
async function reconcilePendingActivations(): Promise<void> {
  try {
    const pending = await transactionRepository.findPendingActivation(MAX_RETRIES);
    if (pending.length === 0) return;
    logger.info(`[Reconciliation] Retrying activation for ${pending.length} transactions`);

    for (const txn of pending) {
      try {
        await callActivateEndpoint(txn);
        await transactionRepository.markActivated(txn.id);
      } catch (err) {
        await transactionRepository.incrementActivationRetry(txn.id);
        logger.error({ error: 'Activation retry failed', transactionId: txn.id, message: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error({ error: 'Activation reconciliation failed', message: (err as Error).message });
  }
}

async function callActivateEndpoint(txn: PaymentTransaction): Promise<void> {
  const body = { transactionId: txn.id };
  const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

  if (txn.relatedEntityType === 'GYM_MEMBERSHIP') {
    await axios.post(`${GYM_SERVICE_URL}/internal/gym-memberships/${txn.relatedEntityId}/activate`, body, { headers, timeout: 10_000 });
  } else if (txn.relatedEntityType === 'PT_CONTRACT') {
    await axios.post(`${USER_SERVICE_URL}/internal/contracts/${txn.relatedEntityId}/activate-after-payment`, body, { headers, timeout: 10_000 });
  } else {
    throw new Error(`Unknown relatedEntityType for activation: ${txn.relatedEntityType}`);
  }
}

/**
 * REFUND transactions that are PAID but the cancel-after-refund call to the owning
 * service failed. Each row already carries its own relatedEntityType/relatedEntityId
 * (copied from the original at creation) — no lookup of the original is needed.
 */
async function reconcilePendingRefundCancellations(): Promise<void> {
  try {
    const pending = await transactionRepository.findPendingRefundCancellation(MAX_RETRIES);
    if (pending.length === 0) return;
    logger.info(`[Reconciliation] Retrying cancel-after-refund for ${pending.length} transactions`);

    for (const txn of pending) {
      try {
        await callCancelAfterRefundEndpoint(txn);
        await transactionRepository.markActivated(txn.id);
      } catch (err) {
        await transactionRepository.incrementActivationRetry(txn.id);
        logger.error({ error: 'Refund-cancellation retry failed', transactionId: txn.id, message: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error({ error: 'Refund-cancellation reconciliation failed', message: (err as Error).message });
  }
}

async function callCancelAfterRefundEndpoint(refundTxn: PaymentTransaction): Promise<void> {
  const body = { originalTransactionId: refundTxn.refundOfTransactionId, refundTransactionId: refundTxn.id };
  const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

  if (refundTxn.relatedEntityType === 'GYM_MEMBERSHIP') {
    await axios.post(`${GYM_SERVICE_URL}/internal/gym-memberships/${refundTxn.relatedEntityId}/cancel-after-refund`, body, { headers, timeout: 10_000 });
  } else if (refundTxn.relatedEntityType === 'PT_CONTRACT') {
    await axios.post(`${USER_SERVICE_URL}/internal/contracts/${refundTxn.relatedEntityId}/cancel-after-refund`, body, { headers, timeout: 10_000 });
  } else {
    throw new Error(`Unknown relatedEntityType for refund cancellation: ${refundTxn.relatedEntityType}`);
  }
}

/**
 * Split timeout sweep: wallet-transfer/refund resolve synchronously (10 min really means
 * stuck), while WALLET_TOPUP waits on an external provider (60 min default, configurable).
 * A topup marked FAILED here is NOT terminal — a late webhook can still flip it to PAID
 * (see webhook.service.ts's idempotent credit guard).
 */
async function sweepStaleProcessing(): Promise<void> {
  try {
    const [staleNonTopup, staleTopup] = await Promise.all([
      transactionRepository.findStaleProcessing('non-topup', NON_TOPUP_STALE_MINUTES),
      transactionRepository.findStaleProcessing('topup', TOPUP_STALE_MINUTES),
    ]);
    const stale = [...staleNonTopup, ...staleTopup];
    if (stale.length === 0) return;
    logger.info(`[Reconciliation] Sweeping ${stale.length} stale PROCESSING transactions to FAILED`);
    for (const row of stale) {
      await transactionRepository.markFailed(row.id).catch((err) => {
        logger.error({ error: 'Failed to mark stale transaction FAILED', id: row.id, message: (err as Error).message });
      });
    }
  } catch (err) {
    logger.error({ error: 'Stale-PROCESSING sweep failed', message: (err as Error).message });
  }
}
