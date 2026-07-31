import crypto from 'crypto';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  RefundResult,
  ProviderTxnStatus,
} from './payment-provider.interface';

// VNPay v2.1.0 — sandbox by default. Docs: https://sandbox.vnpayment.vn/apis/
const PAY_URL = process.env.VNPAY_URL ?? 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const API_URL = process.env.VNPAY_API_URL ?? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
const TMN_CODE = process.env.VNPAY_TMN_CODE ?? '';
const HASH_SECRET = process.env.VNPAY_HASH_SECRET ?? '';
const RETURN_URL = process.env.VNPAY_RETURN_URL ?? 'http://localhost:3007/payments/vnpay/return';
// Demo mode: skip VNPay's hosted checkout (which needs an activated merchant) and send the
// browser to a local simulated checkout instead. Every other step — signing, return-URL
// verification, credit, double-credit — runs the REAL code. Only needs some HASH_SECRET
// set for internal sign/verify consistency (no valid merchant required).
const SIMULATE = (process.env.VNPAY_SIMULATE ?? 'false').toLowerCase() === 'true';
const PUBLIC_BASE = process.env.PAYMENT_PUBLIC_URL ?? 'http://localhost:3007';

function hmac512(data: string): string {
  return crypto.createHmac('sha512', HASH_SECRET).update(Buffer.from(data, 'utf-8')).digest('hex');
}

/** yyyyMMddHHmmss in GMT+7 (VNPay requires Vietnam local time regardless of server TZ). */
function formatVnpDate(d: Date): string {
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/**
 * VNPay reference encoding: keys sorted alphabetically, each key/value passed through
 * encodeURIComponent with spaces as '+'. The SAME string is used both to sign and to
 * build the redirect query (per VNPay's official Node demo).
 */
function buildSignedQuery(params: Record<string, string>): { query: string; signature: string } {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  return { query, signature: hmac512(query) };
}

/**
 * DEMO ONLY. Builds a VNPay return-URL query string signed with OUR HASH_SECRET, exactly
 * as VNPay would send after checkout. The real /payments/vnpay/return handler then verifies
 * it against the same secret and credits — so the simulated checkout drives the genuine
 * verification + credit path without a live merchant.
 */
export function buildSimulatedReturnQuery(input: { txnRef: string; amount: number; success: boolean }): string {
  const vnpParams: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_TmnCode: TMN_CODE || 'DEMO',
    vnp_Amount: (BigInt(input.amount) * 100n).toString(),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: `SIM${Date.now()}`,
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'Wallet top-up',
    vnp_PayDate: formatVnpDate(new Date()),
    vnp_ResponseCode: input.success ? '00' : '24',
    vnp_TransactionNo: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
    vnp_TransactionStatus: input.success ? '00' : '02',
    vnp_TxnRef: input.txnRef,
  };
  const { query, signature } = buildSignedQuery(vnpParams);
  return `${query}&vnp_SecureHash=${signature}`;
}

export class VNPayProvider implements PaymentProvider {
  static configStatus(): { configured: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!TMN_CODE) missing.push('VNPAY_TMN_CODE');
    if (!HASH_SECRET) missing.push('VNPAY_HASH_SECRET');
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
      // VND has no minor unit; vnp_Amount must be an exact integer ×100 — never float math.
      throw new Error(`VNPay amount must be a positive integer VND, got ${amount}`);
    }

    const now = new Date();
    const vnpCreateDate = formatVnpDate(now);
    const vnpExpireDate = formatVnpDate(new Date(now.getTime() + 15 * 60 * 1000));

    const vnpParams: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: TMN_CODE,
      vnp_Amount: (BigInt(amount) * 100n).toString(),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: transactionId,
      vnp_OrderInfo: orderInfo,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: RETURN_URL,
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    const { query, signature } = buildSignedQuery(vnpParams);
    const realUrl = `${PAY_URL}?${query}&vnp_SecureHash=${signature}`;
    // In demo mode redirect to the local simulated checkout; otherwise the real VNPay page.
    const redirectUrl = SIMULATE ? `${PUBLIC_BASE}/payments/vnpay/sim?txnId=${transactionId}` : realUrl;

    return {
      // providerTransactionId === vnp_TxnRef === our txn id. Return/IPN/sync all key off
      // this exact value so findByProviderTransactionId always matches.
      providerTransactionId: transactionId,
      redirectUrl,
      qrCodeUrl: null,
      // querydr later needs the ORIGINAL vnp_CreateDate string (spec format, GMT+7) —
      // persisted on the transaction rather than re-derived from createdAt.
      metadata: { vnp_TxnRef: transactionId, vnp_CreateDate: vnpCreateDate },
    };
  }

  /**
   * Verifies a VNPay return-URL / IPN callback. Both are GETs whose query string is the
   * payload, so callers pass the raw query string as the body buffer.
   */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty HASH_SECRET is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed." A misconfigured
    // deployment must reject every webhook, not silently accept forged ones.
    if (!HASH_SECRET) {
      logger.error('[VNPay] VNPAY_HASH_SECRET is not configured — rejecting webhook');
      return { valid: false };
    }
    const search = new URLSearchParams(rawBody.toString('utf-8'));
    const params: Record<string, string> = {};
    for (const [k, v] of search.entries()) params[k] = v;

    const receivedHash = (params.vnp_SecureHash ?? '').toLowerCase();
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;
    if (!receivedHash) return { valid: false };

    const { signature } = buildSignedQuery(params);
    if (signature.toLowerCase() !== receivedHash) {
      logger.warn({ error: 'VNPay signature mismatch', txnRef: params.vnp_TxnRef });
      return { valid: false };
    }

    const paid = params.vnp_ResponseCode === '00';
    return {
      valid: true,
      normalized: {
        // vnp_TransactionNo (VNPay's own number) is reconciliation data only — the
        // matching key is always our vnp_TxnRef.
        providerEventId: `vnpay_${params.vnp_TxnRef}_${params.vnp_TransactionNo ?? params.vnp_ResponseCode ?? 'na'}`,
        providerTransactionId: params.vnp_TxnRef ?? '',
        status: paid ? 'PAID' : 'FAILED',
        raw: params,
      },
    };
  }

  /** Active status poll via querydr — lets local/dev confirm without a public IPN URL. */
  async queryTransactionStatus(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<ProviderTxnStatus> {
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    const txnRef = String(meta.vnp_TxnRef ?? txn.providerTransactionId ?? txn.id);
    // Spec requires the exact vnp_CreateDate sent at pay time; createdAt is only a fallback.
    const transactionDate = String(meta.vnp_CreateDate ?? formatVnpDate(txn.createdAt));

    const requestId = randomUUID().replace(/-/g, '').slice(0, 32);
    const createDate = formatVnpDate(new Date());
    const orderInfo = `querydr ${txnRef}`;
    const ipAddr = '127.0.0.1';

    // querydr hash: pipe-joined fields in spec order, HMAC-SHA512.
    const hashData = [
      requestId, '2.1.0', 'querydr', TMN_CODE, txnRef, transactionDate, createDate, ipAddr, orderInfo,
    ].join('|');

    const body = {
      vnp_RequestId: requestId,
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: TMN_CODE,
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: orderInfo,
      vnp_TransactionDate: transactionDate,
      vnp_CreateDate: createDate,
      vnp_IpAddr: ipAddr,
      vnp_SecureHash: hmac512(hashData),
    };

    const { data } = await axios.post<Record<string, string>>(API_URL, body, { timeout: 15_000 });

    if (data.vnp_ResponseCode !== '00') {
      // Request-level failure (not found / wrong checksum / ...) — indeterminate, stay PENDING.
      logger.warn({ error: 'VNPay querydr non-00 response', txnRef, code: data.vnp_ResponseCode, message: data.vnp_Message });
      return 'PENDING';
    }
    if (data.vnp_TransactionStatus === '00') return 'PAID';
    if (data.vnp_TransactionStatus === '01') return 'PENDING'; // not yet completed
    return 'FAILED';
  }

  /** Best-effort refund (command=refund). Sandbox support is limited. */
  async refund(params: {
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundResult> {
    const { transactionId, amount, reason = 'refund' } = params;
    const requestId = randomUUID().replace(/-/g, '').slice(0, 32);
    const createDate = formatVnpDate(new Date());
    const transactionType = '02'; // full refund
    const createBy = 'system';
    const transactionNo = '0'; // unknown → VNPay resolves via TxnRef + TransactionDate
    const transactionDate = createDate; // best effort without stored metadata at this call site
    const vnpAmount = (BigInt(amount) * 100n).toString();

    const hashData = [
      requestId, '2.1.0', 'refund', TMN_CODE, transactionType, transactionId,
      vnpAmount, transactionNo, transactionDate, createBy, createDate, '127.0.0.1', reason,
    ].join('|');

    const body = {
      vnp_RequestId: requestId,
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: TMN_CODE,
      vnp_TransactionType: transactionType,
      vnp_TxnRef: transactionId,
      vnp_Amount: vnpAmount,
      vnp_TransactionNo: transactionNo,
      vnp_TransactionDate: transactionDate,
      vnp_CreateBy: createBy,
      vnp_CreateDate: createDate,
      vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: reason,
      vnp_SecureHash: hmac512(hashData),
    };

    const { data } = await axios.post<Record<string, string>>(API_URL, body, { timeout: 15_000 });
    if (data.vnp_ResponseCode !== '00') {
      logger.error({ error: 'VNPay refund failed', txnRef: transactionId, code: data.vnp_ResponseCode, message: data.vnp_Message });
      throw new Error(`VNPay refund error ${data.vnp_ResponseCode}: ${data.vnp_Message ?? ''}`);
    }
    return { success: true, providerRefundId: String(data.vnp_TransactionNo ?? requestId) };
  }
}
