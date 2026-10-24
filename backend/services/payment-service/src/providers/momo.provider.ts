import crypto from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  MoMoIpnPayload,
  RefundResult,
  ProviderTxnStatus,
  GatewayQueryResult,
} from './payment-provider.interface';
import { parseGatewayAmountVnd } from './amount-util';
import { safeEqualHex } from './signature-util';
import { buildMomoOrderInfo, buildMomoRedirectUrl } from './momo-request-fields';

const ENDPOINT   = process.env.MOMO_ENDPOINT   ?? 'https://test-payment.momo.vn/v2/gateway/api/create';
const PARTNER    = process.env.MOMO_PARTNER_CODE ?? '';
const ACCESS_KEY = process.env.MOMO_ACCESS_KEY  ?? '';
const SECRET_KEY = process.env.MOMO_SECRET_KEY  ?? '';
const IPN_URL    = process.env.MOMO_IPN_URL     ?? '';
const REDIRECT   = process.env.MOMO_REDIRECT_URL ?? 'http://localhost:5173/client/payments/result';

function hmac(data: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
}

interface MoMoQueryResponse {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: unknown;
  transId?: unknown;
  resultCode: number;
  message?: string;
  extraData?: string;
  orderInfo?: string;
  orderType?: string;
  payType?: string;
  responseTime?: unknown;
  signature?: string;
}

export class MoMoProvider implements PaymentProvider {
  async createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, extraData = '' } = params;
    // What MoMo's page shows the payer: short Vietnamese description, never an internal id (B25).
    const orderInfo = buildMomoOrderInfo(params.orderInfo);
    const requestId = transactionId;
    const orderId   = transactionId;
    const requestType = 'payWithMethod';
    // "Quay ve" target (B25): the mobile app's deep link for platform 'mobile' (it used to be ignored,
    // so the button led to a web page the phone could not open), else the payer's actual request
    // origin over the static `.env` MOMO_REDIRECT_URL, which goes stale when the LAN IP/tunnel changes.
    const effectiveRedirect = buildMomoRedirectUrl({
      transactionId,
      platform: params.platform,
      returnBaseUrl: params.returnBaseUrl,
      staticFallback: REDIRECT,
    });

    // Field order is alphabetical and MUST match MoMo docs exactly
    const rawSignature = [
      `accessKey=${ACCESS_KEY}`,
      `amount=${amount}`,
      `extraData=${extraData}`,
      `ipnUrl=${IPN_URL}`,
      `orderId=${orderId}`,
      `orderInfo=${orderInfo}`,
      `partnerCode=${PARTNER}`,
      `redirectUrl=${effectiveRedirect}`,
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
      redirectUrl: effectiveRedirect,
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

  /**
   * MoMo IPN: HMAC-SHA256 (secret key) over the alphabetically ordered fields below, with OUR accessKey.
   *
   * "Valid" means: the signature is ours, the IPN is addressed to OUR partnerCode, and it names an orderId. amount
   * (plain VND, a JSON number) is surfaced as `paidAmountVnd`; handleEvent compares it with the transaction's price.
   * resultCode 0 = captured (PAID); 9000 = authorised but not captured (a progress notice: `pending`, nothing to
   * book yet); anything else is a failure.
   *
   * The event id is built from orderId + transId + resultCode: MoMo reports a failed attempt with transId 0, so
   * transId alone would make every failed IPN of every order the same event.
   */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty SECRET_KEY is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed."
    if (!SECRET_KEY) {
      logger.error('[MoMo] MOMO_SECRET_KEY is not configured — rejecting webhook');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    let payload: MoMoIpnPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as MoMoIpnPayload;
    } catch {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    if (!payload || typeof payload !== 'object') return { valid: false, reason: 'BAD_SIGNATURE' };

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

    if (!safeEqualHex(hmac(rawSignature), payload.signature)) {
      logger.warn({ error: 'MoMo IPN signature mismatch', orderId: payload.orderId });
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    // Merchant: signed with our key but addressed to another partner code is not for us.
    if (!PARTNER || payload.partnerCode !== PARTNER) {
      logger.error({ error: '[MoMo] IPN is for a different partnerCode than ours — refusing', orderId: payload.orderId, partnerConfigured: Boolean(PARTNER) });
      return { valid: false, reason: 'MERCHANT_MISMATCH' };
    }
    if (typeof payload.orderId !== 'string' || !payload.orderId) {
      logger.warn('[MoMo] signed IPN without orderId — rejecting');
      return { valid: false, reason: 'MISSING_REFERENCE' };
    }

    // Authorised, not yet captured: acknowledge, wait for the capture IPN.
    if (payload.resultCode === 9000) {
      return { valid: true, payload, pending: true };
    }

    // providerTransactionId was stored at checkout time as the orderId we generated (createPaymentIntent returns
    // providerTransactionId: orderId). transId is MoMo's own number, minted only once the payment settles, and is
    // never written to our row — matching on it would never find the transaction.
    return {
      valid: true,
      payload,
      normalized: {
        providerEventId: `momo_${payload.orderId}_${payload.transId ?? 0}_${payload.resultCode}`,
        providerTransactionId: payload.orderId,
        status: payload.resultCode === 0 ? 'PAID' : 'FAILED',
        paidAmountVnd: parseGatewayAmountVnd(payload.amount),
        raw: payload as unknown as Record<string, unknown>,
      },
    };
  }

  /**
   * Active status poll via MoMo's /query API.
   *
   * Without this, MoMo was the one gateway with no way to confirm a payment on a local
   * deployment: its IPN cannot reach a machine behind NAT, and unlike VNPay there was no
   * signed return-URL handler either — so a client could pay and the contract would sit
   * PENDING_PAYMENT forever. VNPay and ZaloPay both already answer this way.
   *
   * 'PAID' only when MoMo captured the payment AND the amount it reports equals this transaction's price; a capture
   * for a different amount is 'PENDING' here (pollAndSettle uses queryGatewayResult instead and records the
   * discrepancy).
   */
  async queryTransactionStatus(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<ProviderTxnStatus> {
    const result = await this.queryGatewayResult(txn);
    if (result.status !== 'PAID') return result.status;
    return Number.isInteger(txn.amount) && result.paidAmountVnd === String(txn.amount) ? 'PAID' : 'PENDING';
  }

  /**
   * /query with the gateway-reported amount. 'PAID' only when MoMo answers for OUR partnerCode and OUR orderId with
   * resultCode 0; the amount it reports goes to handleEvent's price check. MoMo's query response is not documented to
   * carry a signature - if one is present it must verify (same field order as the IPN), otherwise trust rests on TLS
   * to MOMO_ENDPOINT plus the identity and amount checks.
   */
  async queryGatewayResult(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<GatewayQueryResult> {
    const orderId = txn.providerTransactionId ?? txn.id;
    const requestId = `query_${txn.id}`;
    const rawSignature = [
      `accessKey=${ACCESS_KEY}`,
      `orderId=${orderId}`,
      `partnerCode=${PARTNER}`,
      `requestId=${requestId}`,
    ].join('&');

    const { data } = await axios.post<MoMoQueryResponse>(
      ENDPOINT.replace('/create', '/query'),
      { partnerCode: PARTNER, requestId, orderId, lang: 'vi', signature: hmac(rawSignature) },
      { timeout: 15_000 },
    );

    const raw = data as unknown as Record<string, unknown>;
    // Pending states: 1000 initiated / awaiting the payer, 7000 in progress, 7002 being processed by the provider,
    // 9000 authorised but not captured.
    if ([1000, 7000, 7002, 9000].includes(data.resultCode)) return { status: 'PENDING', raw };
    if (data.resultCode !== 0) return { status: 'FAILED', raw };

    // resultCode 0: a capture - for our partner and our order, or it is not a confirmation of this transaction.
    if (data.partnerCode !== PARTNER || data.orderId !== orderId) {
      logger.error({
        error: '[MoMo] query answered for a different partner/order — not treating as paid',
        asked: orderId,
        answeredOrderId: data.orderId ?? null,
        answeredPartner: data.partnerCode ?? null,
      });
      return { status: 'PENDING', raw };
    }
    if (data.signature !== undefined && !safeEqualHex(hmac(queryResponseSignatureBase(data)), data.signature)) {
      logger.error({ error: '[MoMo] query response carries a signature that does not verify — not treating as paid', orderId });
      return { status: 'PENDING', raw };
    }
    return { status: 'PAID', paidAmountVnd: parseGatewayAmountVnd(data.amount), raw };
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

function queryResponseSignatureBase(d: MoMoQueryResponse): string {
  return [
    `accessKey=${ACCESS_KEY}`,
    `amount=${d.amount}`,
    `extraData=${d.extraData}`,
    `message=${d.message}`,
    `orderId=${d.orderId}`,
    `orderInfo=${d.orderInfo}`,
    `orderType=${d.orderType}`,
    `partnerCode=${d.partnerCode}`,
    `payType=${d.payType}`,
    `requestId=${d.requestId}`,
    `responseTime=${d.responseTime}`,
    `resultCode=${d.resultCode}`,
    `transId=${d.transId}`,
  ].join('&');
}
