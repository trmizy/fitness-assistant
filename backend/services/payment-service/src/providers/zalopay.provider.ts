import crypto from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  RefundResult,
  ProviderTxnStatus,
  GatewayQueryResult,
} from './payment-provider.interface';
import { parseGatewayAmountVnd } from './amount-util';
import { safeEqualHex } from './signature-util';

// ZaloPay Open API v2 — sandbox by default. Docs: https://docs.zalopay.vn/v2/
const ENDPOINT = process.env.ZALOPAY_ENDPOINT ?? 'https://sb-openapi.zalopay.vn';
const APP_ID = process.env.ZALOPAY_APP_ID ?? '';
const KEY1 = process.env.ZALOPAY_KEY1 ?? '';
const KEY2 = process.env.ZALOPAY_KEY2 ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const CALLBACK_URL = process.env.ZALOPAY_CALLBACK_URL ?? 'http://localhost:3007/payments/webhook/zalopay';

function hmac256(key: string, data: string): string {
  return crypto.createHmac('sha256', key).update(Buffer.from(data, 'utf-8')).digest('hex');
}

function yymmdd(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600 * 1000); // GMT+7
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(t.getUTCFullYear()).slice(2)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`;
}

export class ZaloPayProvider implements PaymentProvider {
  static configStatus(): { configured: boolean; missing: string[] } {
    const missing = ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'].filter((k) => !process.env[k]);
    return { configured: missing.length === 0, missing };
  }

  async createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, orderInfo } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`ZaloPay amount must be a positive integer VND, got ${amount}`);
    }

    // app_trans_id MUST be `yyMMdd_<unique>` and unique per day. Derive from our txn id
    // and persist it as providerTransactionId so callback/query always match.
    const appTransId = `${yymmdd(new Date())}_${transactionId.replace(/-/g, '').slice(0, 20)}`;
    const appTime = Date.now();
    // Unlike VNPay (which comes back through this service's own /vnpay/return first), ZaloPay
    // redirects straight to whatever URL is embedded here — has to be the right one already.
    // Same reasoning as vnpay.provider.ts's effectiveReturnUrl: whatever door the payer's own
    // request came in through (params.returnBaseUrl, from the gateway's x-public-base-url)
    // wins over the static `.env` FRONTEND_URL — a LAN IP baked into `.env` goes stale the
    // moment the dev machine's DHCP lease changes, same failure this fixed for VNPay already
    // (confirmed by reproducing it: ZaloPay redirected to a stale 192.168.2.103 while the
    // payer's browser was actually on 192.168.1.2, timing out).
    const returnBase =
      params.platform === 'mobile' ? 'fitnessassistant://client' : `${params.returnBaseUrl ?? FRONTEND_URL}/client`;
    const embedData = JSON.stringify({ redirecturl: `${returnBase}/payments/result?txnId=${transactionId}` });
    const item = '[]';
    const appUser = 'gymcoach';

    const macData = `${APP_ID}|${appTransId}|${appUser}|${amount}|${appTime}|${embedData}|${item}`;
    const body = new URLSearchParams({
      app_id: APP_ID,
      app_trans_id: appTransId,
      app_user: appUser,
      app_time: String(appTime),
      amount: String(amount),
      item,
      embed_data: embedData,
      description: orderInfo,
      bank_code: '',
      callback_url: CALLBACK_URL,
      mac: hmac256(KEY1, macData),
    });

    const { data } = await axios.post<{ return_code: number; return_message: string; sub_return_message?: string; order_url?: string; qr_code?: string }>(
      `${ENDPOINT}/v2/create`,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );

    if (data.return_code !== 1) {
      logger.error({ error: 'ZaloPay create failed', data });
      throw new Error(`ZaloPay error ${data.return_code}: ${data.sub_return_message ?? data.return_message}`);
    }

    return {
      providerTransactionId: appTransId,
      redirectUrl: data.order_url ?? null,
      qrCodeUrl: data.qr_code ?? null,
      metadata: { app_trans_id: appTransId, app_time: appTime },
    };
  }

  /**
   * Callback body is `{ data, mac }`; mac = HMAC-SHA256(KEY2, data), `data` a JSON string.
   *
   * "Valid" means: the MAC is ours (KEY2), the order belongs to OUR app (data.app_id === ZALOPAY_APP_ID) and it names an
   * app_trans_id. It does NOT mean "paid the right amount": data.amount is surfaced as `paidAmountVnd` (ZaloPay
   * amounts are plain VND, no scaling) and handleEvent compares it with the transaction's price.
   *
   * ZaloPay only calls back for a successful charge, so a signed callback is PAID. Its retry contract: the merchant
   * answers return_code 1 (success) or 2 (already processed) to stop the retries; anything else is retried - see
   * webhook.routes.ts for how each of our outcomes is answered.
   */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty KEY2 is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed."
    if (!KEY2) {
      logger.error('[ZaloPay] ZALOPAY_KEY2 is not configured — rejecting webhook');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    let parsed: { data?: unknown; mac?: unknown };
    try {
      parsed = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    if (typeof parsed.data !== 'string' || !parsed.data || typeof parsed.mac !== 'string' || !parsed.mac) {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    if (!safeEqualHex(hmac256(KEY2, parsed.data), parsed.mac)) {
      logger.warn('[ZaloPay] callback MAC mismatch');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    let inner: Record<string, unknown>;
    try {
      inner = JSON.parse(parsed.data);
    } catch {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    if (!inner || typeof inner !== 'object') return { valid: false, reason: 'BAD_SIGNATURE' };

    // Merchant: a callback signed with our key but carrying another app id is not for us.
    if (!APP_ID || String(inner.app_id ?? '') !== APP_ID) {
      logger.error({ error: '[ZaloPay] callback is for a different app_id than ours — refusing', receivedAppId: inner.app_id ?? null, appIdConfigured: Boolean(APP_ID) });
      return { valid: false, reason: 'MERCHANT_MISMATCH' };
    }

    const appTransId = typeof inner.app_trans_id === 'string' ? inner.app_trans_id : '';
    if (!appTransId) {
      logger.warn('[ZaloPay] signed callback without app_trans_id — rejecting');
      return { valid: false, reason: 'MISSING_REFERENCE' };
    }

    return {
      valid: true,
      normalized: {
        providerEventId: `zalopay_${appTransId}_${inner.zp_trans_id ?? 'na'}`,
        providerTransactionId: appTransId,
        status: 'PAID',
        paidAmountVnd: parseGatewayAmountVnd(inner.amount),
        raw: inner,
      },
    };
  }

  /**
   * Active poll via /v2/query - the local/dev confirmation path (no public callback needed). Returns 'PAID' only when
   * ZaloPay says the order was paid AND the amount it reports equals this transaction's price; a paid order for a
   * different amount is 'PENDING' here (never 'PAID', never silently dropped) - the settlement path
   * (pollAndSettle -> handleEvent) uses queryGatewayResult() instead and records the discrepancy.
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
   * /v2/query, returning the gateway-reported amount alongside the status. The query response is not signed by ZaloPay
   * (only our REQUEST carries a MAC), so the only trust anchor is TLS to ZALOPAY_ENDPOINT; the amount check below is
   * what stops a wrong figure from settling.
   */
  async queryGatewayResult(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<GatewayQueryResult> {
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    const appTransId = String(meta.app_trans_id ?? txn.providerTransactionId ?? '');
    if (!appTransId) return { status: 'PENDING' };

    const macData = `${APP_ID}|${appTransId}|${KEY1}`;
    const body = new URLSearchParams({ app_id: APP_ID, app_trans_id: appTransId, mac: hmac256(KEY1, macData) });

    const { data } = await axios.post<{ return_code: number; sub_return_message?: string; is_processing?: boolean; amount?: unknown; zp_trans_id?: unknown }>(
      `${ENDPOINT}/v2/query`,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );

    // return_code: 1 = success (paid), 2 = failed, 3 = processing/pending.
    const raw = data as unknown as Record<string, unknown>;
    if (data.return_code === 1) return { status: 'PAID', paidAmountVnd: parseGatewayAmountVnd(data.amount), raw };
    if (data.return_code === 2) return { status: 'FAILED', raw };
    return { status: 'PENDING', raw };
  }

  async refund(params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    const { providerTransactionId, amount, reason = 'refund' } = params;
    const timestamp = Date.now();
    const uid = `${timestamp}${Math.floor(111 + Math.random() * 888)}`;
    const mRefundId = `${yymmdd(new Date())}_${APP_ID}_${uid}`;
    // zp_trans_id is required by ZaloPay refund; here providerTransactionId is app_trans_id,
    // so a real refund needs the stored zp_trans_id from the callback/query payload.
    const macData = `${APP_ID}|${providerTransactionId}|${amount}|${reason}|${timestamp}`;
    const body = new URLSearchParams({
      m_refund_id: mRefundId,
      app_id: APP_ID,
      zp_trans_id: providerTransactionId,
      amount: String(amount),
      description: reason,
      timestamp: String(timestamp),
      mac: hmac256(KEY1, macData),
    });

    const { data } = await axios.post<{ return_code: number; return_message: string; refund_id?: string }>(
      `${ENDPOINT}/v2/refund`,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    if (data.return_code !== 1) {
      logger.error({ error: 'ZaloPay refund failed', data });
      throw new Error(`ZaloPay refund error ${data.return_code}: ${data.return_message}`);
    }
    return { success: true, providerRefundId: String(data.refund_id ?? mRefundId) };
  }
}
