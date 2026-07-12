export interface PaymentIntentResult {
  providerTransactionId: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
}

export interface WebhookVerifyResult {
  valid: boolean;
  payload?: MoMoIpnPayload;
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
}
