export interface PaymentIntentResult {
  providerTransactionId: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
  /**
   * Provider-specific values the caller must persist on PaymentTransaction.metadata
   * (e.g. VNPay's vnp_CreateDate — required later by querydr, which cannot be derived
   * from createdAt because the spec demands the exact original GMT+7 string).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Provider-agnostic webhook result. Newer providers fill `normalized` so the webhook
 * route needs no per-provider branching. `providerTransactionId` MUST equal the value
 * stored on the transaction at create time (see wallet.routes) or the event will not
 * match any transaction.
 */
export interface NormalizedWebhookEvent {
  providerEventId: string;
  providerTransactionId: string;
  status: 'PAID' | 'FAILED';
  /** Parsed raw payload — persisted to WebhookEvent.payload for reconciliation. */
  raw?: Record<string, unknown>;
}

export interface WebhookVerifyResult {
  valid: boolean;
  payload?: MoMoIpnPayload;
  normalized?: NormalizedWebhookEvent;
}

export interface MoMoIpnPayload {
  partnerCode: string;
  requestId: string;
  orderId: string;
  amount: number;
  orderInfo: string;
  orderType: string;
  transId: number;
  resultCode: number;
  message: string;
  payType: string;
  responseTime: number;
  extraData: string;
  signature: string;
}

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
}

export type ProviderTxnStatus = 'PAID' | 'FAILED' | 'PENDING';

export interface PaymentProvider {
  createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
  }): Promise<PaymentIntentResult>;

  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult;

  refund(params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult>;

  /**
   * Optional active status query against the provider (VNPay querydr, ZaloPay /v2/query,
   * PayOS payment-requests/:orderCode). Lets a local/dev deployment confirm payments by
   * polling instead of relying on a publicly reachable IPN endpoint.
   */
  queryTransactionStatus?(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<ProviderTxnStatus>;
}
