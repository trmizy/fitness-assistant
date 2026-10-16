import crypto from 'crypto';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { safeEqualHex } from './signature-util';
import type {
  PaymentProvider,
  PaymentIntentResult,
  WebhookVerifyResult,
  RefundResult,
  ProviderTxnStatus,
  GatewayQueryResult,
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
//
// SECURITY: the simulated checkout signs a "payment succeeded" return with OUR OWN hash secret for
// whoever opens the page, so it is a free-money button by design. It must therefore never be live in
// a production deployment — the Dockerfile sets NODE_ENV=production — whatever VNPAY_SIMULATE says.
// A deployment that asks for it in production gets a loud error at start-up and the real VNPay page.
const SIMULATE_REQUESTED = (process.env.VNPAY_SIMULATE ?? 'false').toLowerCase() === 'true';
const IS_PRODUCTION = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
const SIMULATE = SIMULATE_REQUESTED && !IS_PRODUCTION;
if (SIMULATE_REQUESTED && IS_PRODUCTION) {
  logger.error('[VNPay] VNPAY_SIMULATE=true is IGNORED because NODE_ENV=production — the simulated checkout would let anyone mark a payment as paid');
}

/** True only when the demo checkout is allowed to exist (never in production). Shared with the /vnpay/sim route. */
export function isVnpaySimulateEnabled(): boolean {
  return SIMULATE;
}

/**
 * The merchant code a genuine callback must carry. The simulated checkout stamps 'DEMO' when no
 * merchant is configured (see buildSimulatedReturnQuery), so that is accepted in simulate mode only.
 * Empty = no merchant is known, and a PAID callback is then refused (fail closed).
 */
function expectedTmnCode(): string {
  return TMN_CODE || (SIMULATE ? 'DEMO' : '');
}

/**
 * VNPay's vnp_Amount is the price in VND multiplied by 100 (its "minor unit"; our checkout sends
 * `BigInt(amount) * 100n`). This is the exact inverse, in integer arithmetic only: returns the whole-VND
 * amount as a digit string, or null when the value is absent, not purely digits, or not a whole number
 * of VND (a remainder after dividing by 100 can never be something our checkout produced).
 */
export function vnpayMinorToVnd(vnpAmount: unknown): string | null {
  if (typeof vnpAmount !== 'string' || !/^\d{1,18}$/.test(vnpAmount)) return null;
  const minor = BigInt(vnpAmount);
  if (minor % 100n !== 0n) return null;
  return (minor / 100n).toString();
}

/**
 * The fields VNPay signs in a querydr RESPONSE, in the order its integration guide gives them (pipe-joined, a missing
 * field is the empty string, HMAC-SHA512 with the merchant hash secret, sent back as vnp_SecureHash). Note this is a
 * different recipe from the IPN/return query string above.
 */
const QUERYDR_RESPONSE_SIGNED_FIELDS = [
  'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount',
  'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo',
  'vnp_PromotionCode', 'vnp_PromotionAmount',
] as const;

/** True only when the querydr answer carries a vnp_SecureHash that is ours (HMAC-SHA512 over the fields above). */
export function isQuerydrResponseSigned(data: Record<string, unknown>): boolean {
  if (!HASH_SECRET) return false;
  const hashData = QUERYDR_RESPONSE_SIGNED_FIELDS.map((f) => (data[f] === undefined || data[f] === null ? '' : String(data[f]))).join('|');
  return safeEqualHex(hmac512(hashData), data.vnp_SecureHash);
}

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
export function buildSignedQuery(params: Record<string, string>): { query: string; signature: string } {
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
/**
 * vnp_ResponseCode values that mean "this payment attempt did not go through and never will":
 * 24 = payer cancelled, 11 = payment window expired, 09/10/12/13/79 = card/account/OTP/password
 * problems, 51 = insufficient balance, 65 = daily limit, 75 = bank under maintenance. Deliberately
 * NOT included: 07 (money taken but flagged as suspicious — not a failure) and 99 (unknown) — those
 * stay open for querydr/reconciliation to settle.
 */
const VNPAY_DEFINITIVE_FAILURE_CODES = new Set(['09', '10', '11', '12', '13', '24', '51', '65', '75', '79']);

export function isDefinitiveVnpayFailure(responseCode: unknown): boolean {
  return typeof responseCode === 'string' && VNPAY_DEFINITIVE_FAILURE_CODES.has(responseCode);
}

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
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<PaymentIntentResult> {
    const { transactionId, amount, orderInfo } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      // VND has no minor unit; vnp_Amount must be an exact integer ×100 — never float math.
      throw new Error(`VNPay amount must be a positive integer VND, got ${amount}`);
    }

    // Whatever door the payer's own request came in through, right now, wins over the
    // static `.env` default — that door is the only one guaranteed reachable by whichever
    // browser ends up completing checkout (see app.ts's x-public-base-url for the full
    // reasoning: a LAN IP baked into `.env` is unreachable from a phone on a cloudflared
    // tunnel, off-LAN, same as a bare "localhost" default is unreachable from an emulator).
    const effectiveReturnUrl = params.returnBaseUrl
      ? `${params.returnBaseUrl}/payments/vnpay/return`
      : RETURN_URL;

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
      vnp_ReturnUrl: effectiveReturnUrl,
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
   *
   * "Valid" means: signed by us-and-VNPay (HMAC-SHA512 over the sorted params), names a transaction
   * reference, was issued for OUR merchant code (vnp_TmnCode), and — when present — is in VND.
   * It does NOT mean "the payment is correct": the paid amount is surfaced as `paidAmountVnd` and
   * must be compared with the transaction's price by the settlement path (gateway-amount.ts).
   *
   * status is PAID only when BOTH vnp_ResponseCode and vnp_TransactionStatus are "00", as VNPay's
   * integration guide requires. Checking the response code alone is not enough: a callback with
   * ResponseCode 00 and TransactionStatus 01/02 describes a payment that did not complete.
   */
  verifyWebhookSignature(rawBody: Buffer): WebhookVerifyResult {
    // Fail closed: an empty HASH_SECRET is a known, publicly-computable HMAC key —
    // never treat "not configured" as "verification not needed." A misconfigured
    // deployment must reject every webhook, not silently accept forged ones.
    if (!HASH_SECRET) {
      logger.error('[VNPay] VNPAY_HASH_SECRET is not configured — rejecting webhook');
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    const search = new URLSearchParams(rawBody.toString('utf-8'));
    const params: Record<string, string> = {};
    for (const [k, v] of search.entries()) params[k] = v;

    const receivedHash = (params.vnp_SecureHash ?? '').toLowerCase();
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;
    if (!receivedHash) return { valid: false, reason: 'BAD_SIGNATURE' };

    const { signature } = buildSignedQuery(params);
    // Constant-time comparison of two hex digests of equal length (a length mismatch is simply unequal).
    const sigBuf = Buffer.from(signature.toLowerCase(), 'utf-8');
    const recvBuf = Buffer.from(receivedHash, 'utf-8');
    if (sigBuf.length !== recvBuf.length || !crypto.timingSafeEqual(sigBuf, recvBuf)) {
      logger.warn({ error: 'VNPay signature mismatch', txnRef: params.vnp_TxnRef });
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    if (!params.vnp_TxnRef) {
      logger.warn('[VNPay] signed callback without vnp_TxnRef — rejecting');
      return { valid: false, reason: 'MISSING_REFERENCE' };
    }

    const paid = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';

    // Merchant check. With a configured TMN_CODE every callback must carry it; with none configured
    // (only possible in local/test setups — checkout refuses to start without it) a callback that
    // would SETTLE money is refused, while a failure notice is still allowed to close its checkout.
    const expectedTmn = expectedTmnCode();
    if (expectedTmn ? params.vnp_TmnCode !== expectedTmn : paid) {
      logger.error({
        error: '[VNPay] callback is for a different merchant code than ours — refusing',
        txnRef: params.vnp_TxnRef,
        receivedTmnCode: params.vnp_TmnCode ?? null,
        merchantConfigured: Boolean(expectedTmn),
      });
      return { valid: false, reason: 'MERCHANT_MISMATCH' };
    }

    // Our checkout always sends vnp_CurrCode=VND. IPN/return normally omit it, so only a present,
    // different value is a problem.
    if (params.vnp_CurrCode !== undefined && params.vnp_CurrCode !== 'VND') {
      logger.error({ error: '[VNPay] callback currency is not VND — refusing', txnRef: params.vnp_TxnRef, currency: params.vnp_CurrCode });
      return { valid: false, reason: 'CURRENCY_MISMATCH' };
    }

    return {
      valid: true,
      normalized: {
        // vnp_TransactionNo (VNPay's own number) is reconciliation data only — the
        // matching key is always our vnp_TxnRef.
        providerEventId: `vnpay_${params.vnp_TxnRef}_${params.vnp_TransactionNo ?? params.vnp_ResponseCode ?? 'na'}`,
        providerTransactionId: params.vnp_TxnRef,
        status: paid ? 'PAID' : 'FAILED',
        paidAmountVnd: vnpayMinorToVnd(params.vnp_Amount),
        raw: params,
      },
    };
  }

  /**
   * Active status poll via querydr — lets local/dev confirm without a public IPN URL.
   *
   * Returns 'PAID' only when the gateway says the payment completed AND it names OUR merchant AND
   * the amount it reports equals this transaction's price. A completed payment for a different
   * amount comes back as 'PENDING' here (never 'PAID', never silently dropped): the settlement path
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

  /** querydr, returning the gateway-reported amount alongside the status (see GatewayQueryResult). */
  async queryGatewayResult(txn: {
    id: string;
    providerTransactionId: string | null;
    amount: number;
    createdAt: Date;
    metadata?: unknown;
  }): Promise<GatewayQueryResult> {
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
      return { status: 'PENDING' };
    }
    // The answer is only as good as its signature. Nothing in it - not "paid", not "failed", not the amount - is
    // acted on unless vnp_SecureHash verifies: a response forged or altered on the way (a poisoned API_URL, a
    // man-in-the-middle on a misconfigured endpoint) must not be able to settle money or close a checkout.
    if (!isQuerydrResponseSigned(data)) {
      logger.error({ error: '[VNPay] querydr response is unsigned or its vnp_SecureHash does not verify — ignoring it', txnRef });
      return { status: 'PENDING' };
    }
    if (data.vnp_TransactionStatus === '01') return { status: 'PENDING', raw: data }; // not yet completed
    if (data.vnp_TransactionStatus !== '00') return { status: 'FAILED', raw: data };

    // A completed payment: it must be OUR merchant's, for OUR reference. Anything else is not a
    // confirmation of this transaction, however the status field reads.
    if (data.vnp_TmnCode !== TMN_CODE || (data.vnp_TxnRef !== undefined && data.vnp_TxnRef !== txnRef)) {
      logger.error({
        error: '[VNPay] querydr answered for a different merchant/reference — not treating as paid',
        txnRef,
        answeredTmnCode: data.vnp_TmnCode ?? null,
        answeredTxnRef: data.vnp_TxnRef ?? null,
      });
      return { status: 'PENDING', raw: data };
    }
    return { status: 'PAID', paidAmountVnd: vnpayMinorToVnd(data.vnp_Amount), raw: data };
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
