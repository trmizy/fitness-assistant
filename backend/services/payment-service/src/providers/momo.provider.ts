import crypto from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  MoMoIpnPayload,
  RefundResult,
} from './payment-provider.interface';

const ENDPOINT   = process.env.MOMO_ENDPOINT   ?? 'https://test-payment.momo.vn/v2/gateway/api/create';
const PARTNER    = process.env.MOMO_PARTNER_CODE ?? '';
const ACCESS_KEY = process.env.MOMO_ACCESS_KEY  ?? '';
const SECRET_KEY = process.env.MOMO_SECRET_KEY  ?? '';
const IPN_URL    = process.env.MOMO_IPN_URL     ?? '';
const REDIRECT   = process.env.MOMO_REDIRECT_URL ?? 'http://localhost:5173/client/payments/result';

function hmac(data: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
}

export class MoMoProvider implements PaymentProvider {
  async createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, orderInfo, extraData = '' } = params;
    const requestId = transactionId;
    const orderId   = transactionId;
    const requestType = 'payWithMethod';

    // Field order is alphabetical and MUST match MoMo docs exactly
    const rawSignature = [
      `accessKey=${ACCESS_KEY}`,
      `amount=${amount}`,
      `extraData=${extraData}`,
      `ipnUrl=${IPN_URL}`,
      `orderId=${orderId}`,
      `orderInfo=${orderInfo}`,
      `partnerCode=${PARTNER}`,
      `redirectUrl=${REDIRECT}`,
      `requestId=${requestId}`,
      `requestType=${requestType}`,
    ].join('&');

    const signature = hmac(rawSignature);

    const body = {
      partnerCode: PARTNER,
      accessKey:   ACCESS_KEY,
      requestId,
      amount:      String(amount),
      orderId,
      orderInfo,
      redirectUrl: REDIRECT,
      ipnUrl:      IPN_URL,
      extraData,
      requestType,
      signature,
      lang: 'vi',
    };

    const response = await axios.post<{ resultCode: number; message: string; payUrl: string }>(
      ENDPOINT, body, { timeout: 15_000 },
    );

    if (response.data.resultCode !== 0) {
      logger.error({ error: 'MoMo createPaymentIntent failed', data: response.data });
      throw new Error(`MoMo error ${response.data.resultCode}: ${response.data.message}`);
    }

    return {
      providerTransactionId: orderId,
      redirectUrl: response.data.payUrl,
      qrCodeUrl: null,
    };
  }

  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty SECRET_KEY is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed."
    if (!SECRET_KEY) {
      logger.error('[MoMo] MOMO_SECRET_KEY is not configured — rejecting webhook');
      return { valid: false };
    }
    let payload: MoMoIpnPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as MoMoIpnPayload;
    } catch {
      return { valid: false };
    }

    // IPN field order — alphabetical, matches MoMo IPN docs
    const rawSignature = [
      `accessKey=${ACCESS_KEY}`,
      `amount=${payload.amount}`,
      `extraData=${payload.extraData}`,
      `message=${payload.message}`,
      `orderId=${payload.orderId}`,
      `orderInfo=${payload.orderInfo}`,
      `orderType=${payload.orderType}`,
      `partnerCode=${payload.partnerCode}`,
      `payType=${payload.payType}`,
      `requestId=${payload.requestId}`,
      `responseTime=${payload.responseTime}`,
      `resultCode=${payload.resultCode}`,
      `transId=${payload.transId}`,
    ].join('&');

    const expected = hmac(rawSignature);
    const valid = expected === payload.signature;

    if (!valid) {
      logger.warn({ error: 'MoMo IPN signature mismatch', orderId: payload.orderId });
    }

    return { valid, payload: valid ? payload : undefined };
  }

  async refund(params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    const { transactionId, providerTransactionId, amount, reason = '' } = params;
    const requestId = `refund_${transactionId}`;
    const refundEndpoint = ENDPOINT.replace('/create', '/refund');

    const rawSignature = [
      `accessKey=${ACCESS_KEY}`,
      `amount=${amount}`,
      `description=${reason}`,
      `orderId=${transactionId}`,
      `partnerCode=${PARTNER}`,
      `requestId=${requestId}`,
      `transId=${providerTransactionId}`,
    ].join('&');

    const signature = hmac(rawSignature);

    const body = {
      partnerCode: PARTNER,
      accessKey:   ACCESS_KEY,
      requestId,
      orderId:     transactionId,
      transId:     providerTransactionId,
      amount:      String(amount),
      description: reason,
      lang: 'vi',
      signature,
    };

    const response = await axios.post<{ resultCode: number; message: string; transId?: string }>(
      refundEndpoint, body, { timeout: 15_000 },
    );

    if (response.data.resultCode !== 0) {
      logger.error({ error: 'MoMo refund failed', data: response.data });
      throw new Error(`MoMo refund error ${response.data.resultCode}: ${response.data.message}`);
    }

    return {
      success: true,
      providerRefundId: String(response.data.transId ?? requestId),
    };
  }
}
