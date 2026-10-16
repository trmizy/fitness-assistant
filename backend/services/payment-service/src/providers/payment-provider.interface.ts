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
  /**
   * What the gateway SAYS it collected, converted to whole VND as a decimal-digit string
   * (VNPay: vnp_Amount / 100, exact integer arithmetic; ZaloPay/PayOS/MoMo report plain VND, so the digits are taken
   * as they are - see parseGatewayAmountVnd). null = the callback carried no usable amount (absent, non-numeric,
   * fractional, negative) - a PAID event with a null amount must never settle. EVERY provider fills this; the
   * settlement path (handleEvent) compares it with the transaction's own price (see gateway-amount.ts).
   */
  paidAmountVnd?: string | null;
}

export interface WebhookVerifyResult {
  valid: boolean;
  /**
   * valid === true, but the callback is a progress notice with nothing to book or to fail yet (MoMo resultCode 9000:
   * authorised, not captured). The route acknowledges it and does nothing else.
   */
  pending?: boolean;
  /**
   * Why a callback was refused when valid is false, for providers that distinguish. Lets the
   * route answer with the gateway's own response code (VNPay IPN: 97 bad signature, 01 unknown
   * order/merchant, 04 invalid amount; ZaloPay: -1 with a message) instead of calling every refusal a signature
   * problem. MERCHANT_MISMATCH = correctly signed (or, for VNPay, signed) but addressed to another merchant/app id.
   */
  reason?: 'BAD_SIGNATURE' | 'MISSING_REFERENCE' | 'MERCHANT_MISMATCH' | 'CURRENCY_MISMATCH';
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

/**
 * A status poll that also reports what the gateway says it collected. pollAndSettle prefers this
 * over queryTransactionStatus when a provider implements it, because a bare 'PAID' carries no
 * amount and an amount-less PAID must not be allowed to settle money.
 */
export interface GatewayQueryResult {
  status: ProviderTxnStatus;
  /** Whole VND the gateway says it collected; null/undefined = not reported or unusable. */
  paidAmountVnd?: string | null;
  /** The gateway's own payload, kept for the audit trail. */
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
    /** 'mobile' → the app's own `fitnessassistant://` deep link (only ZaloPay/PayOS read
     *  this directly — they embed their own return URL into the gateway request itself,
     *  unlike VNPay, which goes back through this service's own /vnpay/return first and
     *  picks its final redirect from the transaction's stored metadata instead). */
    platform?: 'web' | 'mobile';
    /** Only VNPay reads this — see internal.routes.ts's checkoutSchema for what it is. */
    returnBaseUrl?: string;
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

  /** Same poll, but returning the gateway-reported amount too. See GatewayQueryResult. */
  queryGatewayResult?(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<GatewayQueryResult>;
}
