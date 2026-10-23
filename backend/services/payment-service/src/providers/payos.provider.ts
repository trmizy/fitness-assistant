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

// PayOS (VietQR) — https://payos.vn/docs. Auth via x-client-id / x-api-key headers,
// request/webhook integrity via HMAC-SHA256 over sorted key=value data with checksum_key.
const BASE = process.env.PAYOS_BASE_URL ?? 'https://api-merchant.payos.vn';
const CLIENT_ID = process.env.PAYOS_CLIENT_ID ?? '';
const API_KEY = process.env.PAYOS_API_KEY ?? '';
const CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

let orderSeq = crypto.randomInt(0, 1000);

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
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, orderInfo } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`PayOS amount must be a positive integer VND, got ${amount}`);
    }

    // orderCode must be a unique positive integer (PayOS: up to 2^53-1); store its string form as providerTransactionId.
    // It is the ONLY key a webhook carries back to us, so two checkouts must never share one: milliseconds alone
    // collide when two purchases start in the same ms, and the webhook of one would then resolve to the other.
    // ms * 1000 + a per-process counter (0-999) is still < 2^53 until the year 2255, and is unique within this process
    // for up to 1000 checkouts per millisecond. A random suffix instead would collide by the birthday paradox as soon as
    // a few checkouts share a millisecond; across processes the counter starts at a random offset and
    // transactionRepository.findByProviderTransactionId refuses to guess if two rows ever do share a code.
    const orderCode = Date.now() * 1000 + (orderSeq++ % 1000);
    const description = orderInfo.slice(0, 25); // PayOS caps description at 25 chars
    // Same reasoning as ZaloPay above: PayOS redirects straight here, no intermediate hop —
    // and same fix as vnpay.provider.ts's effectiveReturnUrl: prefer the payer's actual
    // request origin (params.returnBaseUrl) over the static `.env` FRONTEND_URL, which goes
    // stale the moment the dev machine's LAN IP/tunnel changes.
    const returnBase =
      params.platform === 'mobile' ? 'fitnessassistant://client' : `${params.returnBaseUrl ?? FRONTEND_URL}/client`;
    const returnUrl = `${returnBase}/payments/result?txnId=${transactionId}`;
    const cancelUrl = `${returnBase}/payments/result?txnId=${transactionId}`;

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

  /**
   * Webhook body: `{ code, desc, success, data, signature }`; signature = HMAC-SHA256(checksum key) over the sorted
   * `data`. PayOS sends one webhook per BANK TRANSFER that lands on the payment link, with that transfer's own
   * `amount` - so an underpayment, an overpayment and a transfer split in two all arrive as amounts that differ from
   * the price, and the settlement path (handleEvent) refuses every one that is not exactly the price.
   *
   * There is no merchant id in the payload: the signature itself (our checksum key) is what ties it to our merchant,
   * and handleEvent additionally ties data.paymentLinkId to the one PayOS returned when we created the link.
   * A paid notice needs the envelope AND the transfer to say "00"; either saying anything else is not a payment.
   */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty CHECKSUM_KEY is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed."
    if (!CHECKSUM_KEY) {
      logger.error('[PayOS] PAYOS_CHECKSUM_KEY is not configured — rejecting webhook');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    let body: { code?: string; success?: boolean; data?: Record<string, unknown>; signature?: string };
    try {
      body = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object' || !body.signature) {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    if (!safeEqualHex(hmac256(sortedSignString(body.data)), body.signature)) {
      logger.warn('[PayOS] webhook signature mismatch');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    const orderCode = body.data.orderCode;
    if (orderCode === undefined || orderCode === null || String(orderCode) === '') {
      logger.warn('[PayOS] signed webhook without orderCode — rejecting');
      return { valid: false, reason: 'MISSING_REFERENCE' };
    }
    // Our links are created in VND; a signed notice in any other currency is not a payment of our price.
    if (body.data.currency !== undefined && body.data.currency !== null && body.data.currency !== 'VND') {
      logger.error({ error: '[PayOS] webhook currency is not VND — refusing', orderCode, currency: body.data.currency });
      return { valid: false, reason: 'CURRENCY_MISMATCH' };
    }

    const paid = body.success !== false && body.code === '00' && String(body.data.code) === '00';
    return {
      valid: true,
      normalized: {
        providerEventId: `payos_${orderCode}_${body.data.reference ?? 'na'}`,
        providerTransactionId: String(orderCode),
        status: paid ? 'PAID' : 'FAILED',
        paidAmountVnd: parseGatewayAmountVnd(body.data.amount),
        raw: body.data,
      },
    };
  }

  /**
   * Active poll via GET payment-requests/:orderCode - local/dev confirmation path. 'PAID' only when PayOS says the link
   * is PAID, answers for OUR orderCode, and amountPaid equals this transaction's price; otherwise 'PENDING' here, and
   * pollAndSettle (which uses queryGatewayResult) records the discrepancy.
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
   * The same poll with the amount PayOS says it collected (data.amountPaid - what actually arrived, not the amount
   * requested). The response body carries its own signature over `data`, but that data embeds the transactions array
   * whose canonical form is not something we can verify here; trust therefore rests on TLS plus the identity
   * (orderCode) and amount checks.
   */
  async queryGatewayResult(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<GatewayQueryResult> {
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    const orderCode = String(meta.orderCode ?? txn.providerTransactionId ?? '');
    if (!orderCode) return { status: 'PENDING' };

    const { data: resp } = await axios.get<{ code: string; data?: { status?: string; orderCode?: unknown; amountPaid?: unknown } }>(
      `${BASE}/v2/payment-requests/${orderCode}`,
      { headers: headers(), timeout: 15_000 },
    );

    const d = resp.data;
    if (!d) return { status: 'PENDING' };
    const raw = d as unknown as Record<string, unknown>;
    // The answer must be about OUR link; anything else is not a confirmation of this transaction.
    if (String(d.orderCode ?? '') !== orderCode) {
      logger.error({ error: '[PayOS] payment-request answered for a different orderCode — not treating as paid', asked: orderCode, answered: d.orderCode === undefined ? null : String(d.orderCode) });
      return { status: 'PENDING', raw };
    }
    if (d.status === 'PAID') return { status: 'PAID', paidAmountVnd: parseGatewayAmountVnd(d.amountPaid), raw };
    if (d.status === 'CANCELLED' || d.status === 'EXPIRED') return { status: 'FAILED', raw };
    return { status: 'PENDING', raw };
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
