import type { PaymentProvider, PaymentIntentResult, WebhookVerifyResult, RefundResult } from './payment-provider.interface';

export class VNPayProvider implements PaymentProvider {
  async createPaymentIntent(_params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
  }): Promise<PaymentIntentResult> {
    throw new Error('VNPay provider not implemented');
  }

  verifyWebhookSignature(_rawBody: Buffer): WebhookVerifyResult {
    throw new Error('VNPay provider not implemented');
  }

  async refund(_params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    throw new Error('VNPay provider not implemented');
  }
}
