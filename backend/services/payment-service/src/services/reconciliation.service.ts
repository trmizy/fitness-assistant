import { logger } from '@gym-coach/shared';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import type { PaymentTransaction } from '../generated/prisma';
import { pollAndSettle } from './webhook.service';
import { postServiceJson } from '../clients/service-lambda.client';
import { refundUnactivatedContractPayment } from './contract-ledger.service';
import { notifyClientOfAutoRefund } from './refund-notification.service';

const INTERVAL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 10;
const NON_TOPUP_STALE_MINUTES = 10;
const TOPUP_STALE_MINUTES = Number(process.env.TOPUP_STALE_MINUTES ?? '60');

// Cụm C2/C3: personalized-service purchase now goes through the generic checkout+webhook
// pipeline, same as PT_CONTRACT/GYM_MEMBERSHIP — needs a way to tell ai-service to activate
// the order once payment is confirmed, which payment-service never previously called at all.
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

export function startReconciliationJob(): void {
  logger.info('Reconciliation job started (interval: 5 min)');
  setInterval(() => { void runReconciliation(); }, INTERVAL_MS);
}

export async function runReconciliation(): Promise<void> {
  await reconcileTopupWebhookBookkeeping();
  await pollGatewayConfirmations();
  await reconcilePendingActivations();
  await reconcilePendingRefundCancellations();
  await sweepStaleProcessing();
}

/**
 * Actively confirms every PROCESSING purchase at its own gateway before the stale sweep can
 * mark it FAILED. Must run before sweepStaleProcessing: without this, ZaloPay/MoMo/PayOS
 * purchases (no reachable IPN on this deployment) always time out at NON_TOPUP_STALE_MINUTES
 * even when the gateway genuinely captured the money — see webhook.service.pollAndSettle.
 */
async function pollGatewayConfirmations(): Promise<void> {
  try {
    const processing = await transactionRepository.findProcessingNonTopup();
    if (processing.length === 0) return;
    logger.info(`[Reconciliation] Polling ${processing.length} PROCESSING transaction(s) at their gateway`);
    for (const txn of processing) {
      try {
        const result = await pollAndSettle(txn);
        if (result === 'PAID') logger.info(`[Reconciliation] Gateway confirmed ${txn.id} (${txn.provider}) as PAID`);
      } catch (err) {
        logger.error({ error: 'Gateway poll failed', transactionId: txn.id, provider: txn.provider, message: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error({ error: 'Gateway confirmation polling failed', message: (err as Error).message });
  }
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
        await activateOrRefund(txn);
      } catch (err) {
        await transactionRepository.incrementActivationRetry(txn.id);
        logger.error({ error: 'Activation retry failed', transactionId: txn.id, message: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error({ error: 'Activation reconciliation failed', message: (err as Error).message });
  }
}

/**
 * user-service's DEFINITE answer that the contract cannot be activated by this payment: it was
 * cancelled / rejected / expired / completed while the client was at the bank, or it is already
 * active under a different payment. HTTP 409 with error.code CONTRACT_NOT_ACTIVATABLE (see
 * contract.service.ts activateAfterPayment). Distinct from every other failure on purpose: a
 * timeout, a 5xx, a 404 or any other 4xx means "we do not know" and is retried as before; only
 * this means "no, and never" and is turned into a refund.
 */
export class ContractNotActivatableError extends Error {
  constructor(
    public readonly currentStatus: string | null,
    message: string,
    /** The machine code the owning service answered with; recorded on the refund marker. */
    public readonly reason: string = CONTRACT_NOT_ACTIVATABLE,
  ) {
    super(message);
    this.name = 'ContractNotActivatableError';
  }
}

export const CONTRACT_NOT_ACTIVATABLE = 'CONTRACT_NOT_ACTIVATABLE';

/**
 * FH-5 / R2: the same "definite no" for the other two purchases that are paid at the gateway before the
 * owning service is told — a personalized-service order (ai-service) or a gym membership (gym-service)
 * the client cancelled while at the bank's page. HTTP 409 with error.code NOT_ACTIVATABLE. Like the
 * PT-contract answer it is the ONLY thing that turns into a refund: a timeout, a 5xx, a 404 or a 409
 * with any other code still means "we do not know" and is retried by the sweep.
 */
export const NOT_ACTIVATABLE = 'NOT_ACTIVATABLE';

/** Maps the owning service's 409 {error:{code}} answer to the typed error; rethrows anything else untouched. */
function rethrowAsNotActivatable(e: unknown, code: string, what: string): never {
  // axios and the Lambda client both expose the HTTP answer as err.response.{status,data}.
  const response = (e as { response?: { status?: number; data?: any } }).response;
  if (response?.status === 409 && response.data?.error?.code === code) {
    throw new ContractNotActivatableError(
      response.data.error.currentStatus ?? null,
      response.data.error.message ?? `${what} cannot be activated by this payment`,
      code,
    );
  }
  throw e;
}

/**
 * Tell the owning service its purchase is paid for. Exported so the webhook path calls the
 * same endpoints the retry sweep does — two copies of this routing would eventually disagree
 * about which service owns which entity type.
 *
 * Resolves for an activation (or an idempotent replay of one); throws ContractNotActivatableError
 * for the "definite no" of any of the three owning services (PT contract, gym membership,
 * personalized-service order); throws whatever the transport threw for everything else.
 * Callers must go through activateOrRefund, which handles that error.
 */
export async function callActivateEndpoint(txn: PaymentTransaction): Promise<void> {
  const body = { transactionId: txn.id };
  const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

  if (txn.relatedEntityType === 'GYM_MEMBERSHIP') {
    try {
      await postServiceJson({ service: 'gym', path: `/internal/gym-memberships/${txn.relatedEntityId}/activate`, body, headers });
    } catch (e) {
      rethrowAsNotActivatable(e, NOT_ACTIVATABLE, 'Membership');
    }
  } else if (txn.relatedEntityType === 'PT_CONTRACT') {
    try {
      await postServiceJson({ service: 'user', path: `/internal/contracts/${txn.relatedEntityId}/activate-after-payment`, body, headers });
    } catch (e) {
      rethrowAsNotActivatable(e, CONTRACT_NOT_ACTIVATABLE, 'Contract');
    }
  } else if (txn.relatedEntityType === 'PERSONALIZED_SERVICE_PURCHASE') {
    try {
      await postServiceJson({ service: 'ai', path: `/internal/personalized-service/orders/${txn.relatedEntityId}/activate-after-payment`, body, headers });
    } catch (e) {
      rethrowAsNotActivatable(e, NOT_ACTIVATABLE, 'Order');
    }
  } else {
    throw new Error(`Unknown relatedEntityType for activation: ${txn.relatedEntityType}`);
  }
}

/**
 * The one place that finishes a PAID purchase: activate it, or — when the owning service (user-service
 * for a PT contract, gym-service for a membership, ai-service for a personalized order) answers that it
 * can no longer be activated by this payment — give the client the money back.
 *
 * Used by every caller that used to do `callActivateEndpoint` + `markActivated` itself (the
 * webhook/poll settlement, the reconcile sweep, the admin "retry activation" route), so they all
 * treat the new answer identically.
 *
 *  · 'ACTIVATED' — user-service activated it (or confirmed an earlier identical activation);
 *    marked ACTIVATED.
 *  · 'REFUNDED'  — not activatable; the full amount of THIS transaction went back to the
 *    client's wallet and the transaction carries the refund marker (refundUnactivatedContractPayment).
 *    NOT marked ACTIVATED.
 *  · throws      — activation outcome unknown (transport/5xx) or the refund itself failed. The
 *    transaction is untouched (activationStatus stays PENDING) and the reconcile sweep retries:
 *    the activate call is idempotent and the refund is atomic + keyed per transaction, so a retry
 *    can neither double-activate nor double-refund.
 */
export async function activateOrRefund(txn: PaymentTransaction): Promise<'ACTIVATED' | 'REFUNDED'> {
  // Already refunded (an admin re-driving a closed row, a late duplicate): never ask user-service
  // and never activate afterwards — the client has the money, the contract must not also run.
  if ((txn.metadata as Record<string, unknown> | null)?.unactivatedRefund) {
    // The refund is already committed; a duplicate callback / admin re-drive is also the retry point for a notice that
    // could not be sent the first time (a no-op once it was sent - it is claimed per transaction).
    await notifyClientOfAutoRefund(txn.id);
    return 'REFUNDED';
  }

  try {
    await callActivateEndpoint(txn);
  } catch (e) {
    if (!(e instanceof ContractNotActivatableError)) throw e;
    const meta = (txn.metadata ?? {}) as Record<string, any>;
    if (!meta.parties?.clientUserId || !meta.parties?.ptUserId) {
      throw new Error(`transaction ${txn.id} has no frozen party snapshot — cannot refund`);
    }
    await refundUnactivatedContractPayment({
      transactionId: txn.id,
      parties: {
        ptUserId: meta.parties.ptUserId,
        gymId: meta.parties.gymId ?? null,
        clientUserId: meta.parties.clientUserId,
      },
      label: `${txn.purpose} ${txn.relatedEntityId ?? txn.id}`,
      reason: e.reason,
      contractStatus: e.currentStatus,
    });
    // FH-5: the refund has committed. Tell the client, best-effort and outside the money transaction (never throws).
    await notifyClientOfAutoRefund(txn.id);
    return 'REFUNDED';
  }
  await transactionRepository.markActivated(txn.id);
  return 'ACTIVATED';
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
    await postServiceJson({ service: 'gym', path: `/internal/gym-memberships/${refundTxn.relatedEntityId}/cancel-after-refund`, body, headers });
  } else if (refundTxn.relatedEntityType === 'PT_CONTRACT') {
    await postServiceJson({ service: 'user', path: `/internal/contracts/${refundTxn.relatedEntityId}/cancel-after-refund`, body, headers });
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
