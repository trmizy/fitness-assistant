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

// PayOS (VietQR) — https://payos.vn/docs. Auth via x-client-id / x-api-key headers,
// request/webhook integrity via HMAC-SHA256 over sorted key=value data with checksum_key.
const BASE = process.env.PAYOS_BASE_URL ?? 'https://api-merchant.payos.vn';
const CLIENT_ID = process.env.PAYOS_CLIENT_ID ?? '';
const API_KEY = process.env.PAYOS_API_KEY ?? '';
const CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

function hmac256(data: string): string {
  return crypto.createHmac('sha256', CHECKSUM_KEY).update(Buffer.from(data, 'utf-8')).digest('hex');
}

/** PayOS webhook/signature convention: keys sorted A→Z, joined `k=v&k=v` (empty/null → ''). */
function sortedSignString(obj: Record<string, unknown>): string {
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${obj[k] === null || obj[k] === undefined ? '' : obj[k]}`)
    .join('&');
}

function headers() {
  return { 'x-client-id': CLIENT_ID, 'x-api-key': API_KEY, 'Content-Type': 'application/json' };
}

export class PayOSProvider implements PaymentProvider {
  static configStatus(): { configured: boolean; missing: string[] } {
    const missing = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'].filter((k) => !process.env[k]);
    return { configured: missing.length === 0, missing };
  }

  async createPaymentIntent(params: {
    transactionId: string;
    amount: number;
    orderInfo: string;
    extraData?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, orderInfo } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`PayOS amount must be a positive integer VND, got ${amount}`);
    }

    // orderCode must be a unique positive integer; store its string form as providerTransactionId.
    const orderCode = Date.now();
    const description = orderInfo.slice(0, 25); // PayOS caps description at 25 chars
    const returnUrl = `${FRONTEND_URL}/client/payments/result?txnId=${transactionId}`;
    const cancelUrl = `${FRONTEND_URL}/client/payments/result?txnId=${transactionId}`;

    // Signature over the 5 fields in fixed alphabetical order (per PayOS docs).
    const signature = hmac256(
      `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`,
    );

    const { data: resp } = await axios.post<{ code: string; desc: string; data?: { checkoutUrl: string; qrCode?: string; paymentLinkId?: string } }>(
      `${BASE}/v2/payment-requests`,
      { orderCode, amount, description, cancelUrl, returnUrl, signature },
      { headers: headers(), timeout: 15_000 },
    );

    if (resp.code !== '00' || !resp.data) {
      logger.error({ error: 'PayOS create failed', data: resp });
      throw new Error(`PayOS error ${resp.code}: ${resp.desc}`);
    }

    return {
      providerTransactionId: String(orderCode),
      redirectUrl: resp.data.checkoutUrl,
      qrCodeUrl: resp.data.qrCode ?? null,
      metadata: { orderCode, paymentLinkId: resp.data.paymentLinkId ?? null },
    };
  }

  /** Webhook body: `{ code, desc, success, data, signature }`; signature = HMAC over sorted `data`. */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    let body: { code?: string; success?: boolean; data?: Record<string, unknown>; signature?: string };
    try {
      body = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return { valid: false };
    }
    if (!body.data || !body.signature) return { valid: false };

    const expected = hmac256(sortedSignString(body.data));
    if (expected !== body.signature) {
      logger.warn('[PayOS] webhook signature mismatch');
      return { valid: false };
    }

    const paid = body.code === '00' || String(body.data.code) === '00';
    return {
      valid: true,
      normalized: {
        providerEventId: `payos_${body.data.orderCode}_${body.data.reference ?? 'na'}`,
        providerTransactionId: String(body.data.orderCode ?? ''),
        status: paid ? 'PAID' : 'FAILED',
        raw: body.data,
      },
    };
  }

  /** Active poll via GET payment-requests/:orderCode — local/dev confirmation path. */
  async queryTransactionStatus(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<ProviderTxnStatus> {
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    const orderCode = String(meta.orderCode ?? txn.providerTransactionId ?? '');
    if (!orderCode) return 'PENDING';

    const { data: resp } = await axios.get<{ code: string; data?: { status: string } }>(
      `${BASE}/v2/payment-requests/${orderCode}`,
      { headers: headers(), timeout: 15_000 },
    );

    const status = resp.data?.status;
    if (status === 'PAID') return 'PAID';
    if (status === 'CANCELLED' || status === 'EXPIRED') return 'FAILED';
    return 'PENDING';
  }

  async refund(_params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    // PayOS has no public refund API.
    logger.warn('[PayOSProvider] refund unsupported by PayOS');
    return { success: false };
  }
}
