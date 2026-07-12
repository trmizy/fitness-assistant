import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  RefundResult,
} from './payment-provider.interface';

// Forward reference — resolved at import time via lazy require to avoid circular dep
// (webhook.service imports payment.service which imports mock.provider)
let _handleEvent: ((event: MockWebhookEvent) => Promise<void>) | null = null;

interface MockWebhookEvent {
  provider: 'MOCK';
  providerEventId: string;
  providerTransactionId: string;
  payload: Record<string, unknown>;
  status: 'PAID';
}

export function setWebhookHandler(fn: (event: MockWebhookEvent) => Promise<void>): void {
  _handleEvent = fn;
}

export class MockProvider implements PaymentProvider {
  async createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
  }): Promise<PaymentIntentResult> {
    const providerTransactionId = `mock_${randomUUID()}`;
    logger.info(`[MockProvider] Creating payment intent for txn ${params.transactionId}`);

    // Simulate async payment after 500ms
    setTimeout(() => {
      void this.simulatePaid(params.transactionId, providerTransactionId, params.extraData ?? '');
    }, 500);

    return {
      providerTransactionId,
      redirectUrl: null,
      qrCodeUrl: null,
    };
  }

  private async simulatePaid(
    transactionId: string,
    providerTransactionId: string,
    extraData: string,
  ): Promise<void> {
    if (!_handleEvent) {
      logger.warn('[MockProvider] No webhook handler registered — skipping simulatePaid');
      return;
    }
    try {
      await _handleEvent({
        provider: 'MOCK',
        providerEventId: `mock_evt_${randomUUID()}`,
        providerTransactionId,
        payload: { transactionId, providerTransactionId, extraData, status: 'PAID' },
        status: 'PAID',
      });
    } catch (err) {
      logger.error({ error: '[MockProvider] simulatePaid failed', message: (err as Error).message });
    }
  }

  verifyWebhookSignature(_rawBody: Buffer): WebhookVerifyResult {
    return { valid: true };
  }

  async refund(_params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    logger.info(`[MockProvider] Refund no-op for ${_params.transactionId}`);
    return { success: true, providerRefundId: `mock_refund_${randomUUID()}` };
  }
}
