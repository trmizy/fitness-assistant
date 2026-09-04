import crypto from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  RefundResult,
  ProviderTxnStatus,
} from './payment-provider.interface';

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

  /** Callback body is `{ data, mac }`; mac = HMAC-SHA256(KEY2, data). */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty KEY2 is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed."
    if (!KEY2) {
      logger.error('[ZaloPay] ZALOPAY_KEY2 is not configured — rejecting webhook');
      return { valid: false };
    }
    let parsed: { data?: string; mac?: string };
    try {
      parsed = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return { valid: false };
    }
    if (!parsed.data || !parsed.mac) return { valid: false };

    const expected = hmac256(KEY2, parsed.data);
    if (expected !== parsed.mac) {
      logger.warn('[ZaloPay] callback MAC mismatch');
      return { valid: false };
    }

    let inner: Record<string, unknown>;
    try {
      inner = JSON.parse(parsed.data);
    } catch {
      return { valid: false };
    }

    const appTransId = String(inner.app_trans_id ?? '');
    // A signed ZaloPay callback is only delivered for a successful charge.
    return {
      valid: true,
      normalized: {
        providerEventId: `zalopay_${appTransId}_${inner.zp_trans_id ?? 'na'}`,
        providerTransactionId: appTransId,
        status: 'PAID',
        raw: inner,
      },
    };
  }

  /** Active poll via /v2/query — the local/dev confirmation path (no public callback needed). */
  async queryTransactionStatus(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<ProviderTxnStatus> {
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    const appTransId = String(meta.app_trans_id ?? txn.providerTransactionId ?? '');
    if (!appTransId) return 'PENDING';

    const macData = `${APP_ID}|${appTransId}|${KEY1}`;
    const body = new URLSearchParams({ app_id: APP_ID, app_trans_id: appTransId, mac: hmac256(KEY1, macData) });

    const { data } = await axios.post<{ return_code: number; sub_return_message?: string }>(
      `${ENDPOINT}/v2/query`,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );

    // return_code: 1 = success (paid), 2 = failed, 3 = processing/pending.
    if (data.return_code === 1) return 'PAID';
    if (data.return_code === 2) return 'FAILED';
    return 'PENDING';
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
