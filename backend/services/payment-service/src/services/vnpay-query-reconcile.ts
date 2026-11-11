/**
 * B8 "Doi chieu cong <-> Gymini", level L3 for VNPAY ONLY - READ ONLY.
 *
 * L3 asks VNPay ITSELF, one transaction at a time, through its transaction query API (command=querydr), and compares the
 * answer with what Gymini stored. This is independent of the stored webhooks used by L2. Other gateways are NOT covered.
 *
 * HARD RULES of this file:
 *   - It never writes: the only database call is `paymentTransaction.findMany`. It does NOT use the poll/settle path
 *     (VNPayProvider.queryGatewayResult / pollAndSettle) - those settle or fail checkouts; L3 only reads and reports.
 *   - querydr is a POST to VNPay, but it is a pure lookup (it changes nothing on either side).
 *   - Calls are strictly sequential with a pause between them, a per-call timeout, a cap of 50 transactions per run
 *     (oldest first, `truncated` says there were more) and a total time budget; after 5 failed lookups in a row the run stops
 *     asking and marks the rest QUERY_FAILED (VNPay rate limit / outage) instead of hammering the gateway.
 *   - A VNPay answer is trusted only when its vnp_SecureHash verifies (the provider's own `isQuerydrResponseSigned`), it names
 *     OUR merchant code and OUR reference. Anything else, and any network / timeout / unexpected response code, is
 *     QUERY_FAILED - a failed lookup is NEVER counted as a mismatch.
 *   - Credentials: VNPAY_TMN_CODE / VNPAY_HASH_SECRET / VNPAY_API_URL, read exactly as providers/vnpay.provider.ts reads them.
 *     Without TMN code + secret nothing is called (`configured: false`).
 *
 * Classification (per transaction, in this order):
 *   NOT_FOUND_AT_VNPAY  VNPay answers "transaction not found" (vnp_ResponseCode 91). Normal for a Gymini checkout that was never
 *                       paid; a problem when Gymini says PAID / REFUNDED.
 *   STATUS_MISMATCH     Gymini PAID but VNPay's vnp_TransactionStatus is not success ('00'); Gymini REFUNDED but VNPay never
 *                       took the money (not '00' / '04' reversed / '05' / '06' refund states); or VNPay success ('00') while
 *                       Gymini is not PAID / REFUNDED (PENDING, PROCESSING, FAILED).
 *   AMOUNT_MISMATCH     VNPay amount (vnp_Amount / 100, integer arithmetic) differs from transaction.amount.
 *   MATCHED             everything agrees. A not-successful VNPay status against a Gymini PENDING / PROCESSING / FAILED is a match.
 *   QUERY_FAILED        could not ask, could not verify, or the answer is unusable.
 */
import axios from 'axios';
import crypto, { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { VNPayProvider, isQuerydrResponseSigned, vnpayMinorToVnd } from '../providers/vnpay.provider';
import { GatewayWindowError, gatewayIsoDate } from './admin-gateway-reconciliation.service';

export const L3_ITEM_CAP = 50;
export const L3_DEFAULT_WINDOW_DAYS = 7;
export const L3_MAX_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
const CALL_TIMEOUT_MS = 8_000;
const CALL_DELAY_MS = 300;
const TOTAL_BUDGET_MS = 100_000;
const CONSECUTIVE_FAILURE_LIMIT = 5;

// Same environment and defaults as providers/vnpay.provider.ts (read once, at load, like the provider does).
const API_URL = process.env.VNPAY_API_URL ?? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
const TMN_CODE = process.env.VNPAY_TMN_CODE ?? '';
const HASH_SECRET = process.env.VNPAY_HASH_SECRET ?? '';

export const vnpayL3QuerySchema = z.object({ from: gatewayIsoDate.optional(), to: gatewayIsoDate.optional() }).strict();
export type VnpayL3Query = z.output<typeof vnpayL3QuerySchema>;

/** Window: from inclusive, to exclusive, default last 7 days ending now, at most 31 days. */
export function resolveL3Window(q: VnpayL3Query, now: Date): { from: Date; to: Date } {
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - L3_DEFAULT_WINDOW_DAYS * DAY_MS);
  if (!(from < to)) throw new GatewayWindowError('from phải trước to');
  if (to.getTime() - from.getTime() > L3_MAX_WINDOW_DAYS * DAY_MS) throw new GatewayWindowError(`khoảng thời gian tối đa ${L3_MAX_WINDOW_DAYS} ngày`);
  return { from, to };
}

export type VnpayL3Result = 'MATCHED' | 'NOT_FOUND_AT_VNPAY' | 'STATUS_MISMATCH' | 'AMOUNT_MISMATCH' | 'QUERY_FAILED';

export interface VnpayL3Item {
  transactionId: string;
  providerTransactionId: string | null;
  gyminiStatus: string;
  /** Stored amount, "123456.00". */
  gyminiAmount: string;
  /** VNPay's vnp_TransactionStatus ('00' = success); null when VNPay gave no usable answer. */
  vnpayStatusCode: string | null;
  /** VNPay's amount in whole VND with ".00" (vnp_Amount / 100); null when absent or unusable. */
  vnpayAmount: string | null;
  result: VnpayL3Result;
  note: string;
}

export interface VnpayL3Report {
  scope: 'L3';
  provider: 'VNPAY';
  from: string;
  to: string;
  generatedAt: string;
  counts: {
    checked: number;
    matched: number;
    notFoundAtVnpay: number;
    statusMismatch: number;
    amountMismatch: number;
    queryFailed: number;
  };
  items: VnpayL3Item[];
  truncated: boolean;
  configured: boolean;
}

/** The raw answer of one querydr call. `data` is whatever JSON VNPay returned (never trusted before verification). */
export type QuerydrAnswer = Record<string, unknown>;
export interface QuerydrClient {
  query(input: { txnRef: string; transactionDate: string }, timeoutMs: number): Promise<QuerydrAnswer>;
}

export interface L3Txn {
  id: string;
  providerTransactionId: string | null;
  status: string;
  amount: Prisma.Decimal;
  createdAt: Date;
  metadata: unknown;
}
/** The ONLY database surface L3 touches: one read. A test passes a recorder that fails on anything else. */
export interface L3Db {
  paymentTransaction: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      take: number;
      select: Record<string, true>;
    }): Promise<L3Txn[]>;
  };
}

export interface L3Deps {
  db?: L3Db;
  client?: QuerydrClient;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides for tests. */
  delayMs?: number;
  timeoutMs?: number;
  budgetMs?: number;
  nowMs?: () => number;
  /** Test override of the credentials check; production uses VNPayProvider.configStatus(). */
  configured?: boolean;
}

/** yyyyMMddHHmmss in GMT+7 (same as the provider's private formatter). */
function formatVnpDate(d: Date): string {
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/** The querydr request body, signed exactly like providers/vnpay.provider.ts (pipe-joined fields, HMAC-SHA512). */
export function buildQuerydrBody(input: { txnRef: string; transactionDate: string }, now: Date = new Date()): Record<string, string> {
  const requestId = randomUUID().replace(/-/g, '').slice(0, 32);
  const createDate = formatVnpDate(now);
  const orderInfo = `querydr ${input.txnRef}`;
  const ipAddr = '127.0.0.1';
  const hashData = [requestId, '2.1.0', 'querydr', TMN_CODE, input.txnRef, input.transactionDate, createDate, ipAddr, orderInfo].join('|');
  return {
    vnp_RequestId: requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: TMN_CODE,
    vnp_TxnRef: input.txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionDate: input.transactionDate,
    vnp_CreateDate: createDate,
    vnp_IpAddr: ipAddr,
    vnp_SecureHash: crypto.createHmac('sha512', HASH_SECRET).update(Buffer.from(hashData, 'utf-8')).digest('hex'),
  };
}

/** The real client: one POST to VNPay's transaction API. Lookup only. */
export const httpQuerydrClient: QuerydrClient = {
  async query(input, timeoutMs) {
    const { data } = await axios.post<QuerydrAnswer>(API_URL, buildQuerydrBody(input), { timeout: timeoutMs });
    return data;
  },
};

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const money2 = (d: Prisma.Decimal): string => new Prisma.Decimal(d).toFixed(2);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

// Gymini statuses L3 looks at; statuses that never reached the gateway (CANCELLED) are out of scope.
const L3_STATUSES = ['PAID', 'REFUNDED', 'PENDING', 'PROCESSING', 'FAILED'] as const;
const STATUS_VI: Record<string, string> = {
  PENDING: 'đang chờ thanh toán',
  PROCESSING: 'đang xử lý',
  FAILED: 'thất bại',
  PAID: 'đã thanh toán',
  REFUNDED: 'đã hoàn tiền',
};
const statusVi = (s: string) => STATUS_VI[s] ?? 'không rõ';
// vnp_TransactionStatus in a querydr answer: 00 success, 01 not completed, 02 error, 04 reversed, 05/06 refund processing/sent, 07 suspected, 09 refund rejected.
const VNPAY_STATUS_VI: Record<string, string> = {
  '00': 'giao dịch thành công',
  '01': 'giao dịch chưa hoàn tất',
  '02': 'giao dịch bị lỗi',
  '04': 'giao dịch đã đảo (hoàn)',
  '05': 'đang xử lý hoàn tiền',
  '06': 'đã gửi yêu cầu hoàn tiền',
  '07': 'nghi ngờ gian lận',
  '09': 'hoàn tiền bị từ chối',
};
const vnpayStatusVi = (code: string) => VNPAY_STATUS_VI[code] ?? `mã trạng thái ${code}`;
const REFUND_CONSISTENT_CODES = new Set(['00', '04', '05', '06']);

function failed(t: L3Txn, note: string): VnpayL3Item {
  return base(t, { result: 'QUERY_FAILED', vnpayStatusCode: null, vnpayAmount: null, note });
}
function base(t: L3Txn, o: Pick<VnpayL3Item, 'result' | 'vnpayStatusCode' | 'vnpayAmount' | 'note'>): VnpayL3Item {
  return {
    transactionId: t.id,
    providerTransactionId: t.providerTransactionId,
    gyminiStatus: t.status,
    gyminiAmount: money2(t.amount),
    ...o,
  };
}

/** Maps one VNPay answer (possibly forged / odd) to a result for the transaction. Pure; exported for tests. */
export function classifyQuerydrAnswer(t: L3Txn, txnRef: string, data: QuerydrAnswer): VnpayL3Item {
  // Nothing in an answer is read before its signature verifies - not "not found", not a status, not an amount.
  if (!isQuerydrResponseSigned(data as Record<string, unknown>)) {
    return failed(t, 'Phản hồi của VNPay không có chữ ký hợp lệ nên không dùng để đối chiếu.');
  }
  const code = asStr(data.vnp_ResponseCode);
  if (code === '91') {
    const paidLike = t.status === 'PAID' || t.status === 'REFUNDED';
    return base(t, {
      result: 'NOT_FOUND_AT_VNPAY',
      vnpayStatusCode: null,
      vnpayAmount: null,
      note: paidLike
        ? `Gymini ghi giao dịch "${statusVi(t.status)}" nhưng VNPay báo không tìm thấy giao dịch này. Cần kiểm tra thủ công với VNPay.`
        : `VNPay không có giao dịch này; Gymini ghi "${statusVi(t.status)}". Thường gặp khi khách chưa vào trang thanh toán của VNPay.`,
    });
  }
  if (code !== '00') {
    return failed(t, `VNPay trả về mã lỗi ${code ?? 'không rõ'} nên chưa đối chiếu được.`);
  }
  if (asStr(data.vnp_TmnCode) !== TMN_CODE || asStr(data.vnp_TxnRef) !== txnRef) {
    return failed(t, 'VNPay trả lời cho một mã merchant hoặc mã tham chiếu khác nên không dùng để đối chiếu.');
  }
  const statusCode = asStr(data.vnp_TransactionStatus);
  if (!statusCode) return failed(t, 'Phản hồi của VNPay thiếu trạng thái giao dịch.');
  const vnd = vnpayMinorToVnd(data.vnp_Amount);
  const vnpayAmount = vnd === null ? null : `${vnd}.00`;
  const success = statusCode === '00';

  let statusMismatch: string | null = null;
  if (t.status === 'PAID' && !success) {
    statusMismatch = `Gymini ghi "${statusVi(t.status)}" nhưng VNPay báo ${vnpayStatusVi(statusCode)}.`;
  } else if (t.status === 'REFUNDED' && !REFUND_CONSISTENT_CODES.has(statusCode)) {
    statusMismatch = `Gymini ghi "${statusVi(t.status)}" nhưng VNPay báo ${vnpayStatusVi(statusCode)}, không thấy khoản tiền đã thu.`;
  } else if (success && t.status !== 'PAID' && t.status !== 'REFUNDED') {
    statusMismatch = `VNPay báo ${vnpayStatusVi(statusCode)} nhưng Gymini đang ghi "${statusVi(t.status)}".`;
  }
  if (statusMismatch) return base(t, { result: 'STATUS_MISMATCH', vnpayStatusCode: statusCode, vnpayAmount, note: statusMismatch });

  if (success && vnd === null) {
    // VNPay says "paid" but the amount cannot be read reliably: we cannot say the amounts agree, and we must not call it a mismatch.
    return failed(t, 'VNPay báo thành công nhưng không đọc được số tiền trong phản hồi nên chưa đối chiếu được.');
  }
  if (vnd !== null && !new Prisma.Decimal(t.amount).equals(new Prisma.Decimal(vnd))) {
    return base(t, {
      result: 'AMOUNT_MISMATCH',
      vnpayStatusCode: statusCode,
      vnpayAmount,
      note: `Số tiền VNPay ghi nhận (${vnd} đ) khác số tiền giao dịch của Gymini (${money2(t.amount)}).`,
    });
  }
  return base(t, {
    result: 'MATCHED',
    vnpayStatusCode: statusCode,
    vnpayAmount,
    note: `Khớp: Gymini "${statusVi(t.status)}", VNPay ${vnpayStatusVi(statusCode)}.`,
  });
}

function emptyReport(from: Date, to: Date, now: Date, configured: boolean): VnpayL3Report {
  return {
    scope: 'L3',
    provider: 'VNPAY',
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    counts: { checked: 0, matched: 0, notFoundAtVnpay: 0, statusMismatch: 0, amountMismatch: 0, queryFailed: 0 },
    items: [],
    truncated: false,
    configured,
  };
}

const COUNT_KEY: Record<VnpayL3Result, keyof VnpayL3Report['counts']> = {
  MATCHED: 'matched',
  NOT_FOUND_AT_VNPAY: 'notFoundAtVnpay',
  STATUS_MISMATCH: 'statusMismatch',
  AMOUNT_MISMATCH: 'amountMismatch',
  QUERY_FAILED: 'queryFailed',
};

export const vnpayQueryReconcileService = {
  async run(q: VnpayL3Query, now: Date = new Date(), deps: L3Deps = {}): Promise<VnpayL3Report> {
    const { from, to } = resolveL3Window(q, now);
    const configured = deps.configured ?? VNPayProvider.configStatus().configured;
    const report = emptyReport(from, to, now, configured);
    if (!configured) return report; // no credentials: no database read, no call to VNPay

    const db = deps.db ?? (prisma as unknown as L3Db);
    const client = deps.client ?? httpQuerydrClient;
    const sleep = deps.sleep ?? sleepReal;
    const delayMs = deps.delayMs ?? CALL_DELAY_MS;
    const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
    const budgetMs = deps.budgetMs ?? TOTAL_BUDGET_MS;
    const clock = deps.nowMs ?? Date.now;

    const rows = await db.paymentTransaction.findMany({
      where: { provider: 'VNPAY', status: { in: [...L3_STATUSES] }, createdAt: { gte: from, lt: to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: L3_ITEM_CAP + 1,
      select: { id: true, providerTransactionId: true, status: true, amount: true, createdAt: true, metadata: true },
    });
    report.truncated = rows.length > L3_ITEM_CAP;
    const txns = rows.slice(0, L3_ITEM_CAP);

    const startedAt = clock();
    let consecutiveFailures = 0;
    let stopped: string | null = null;
    for (let i = 0; i < txns.length; i++) {
      const t = txns[i];
      let item: VnpayL3Item;
      if (stopped === null && clock() - startedAt > budgetMs) stopped = 'Đã hết thời gian cho lần chạy này, chưa hỏi VNPay giao dịch này.';
      if (stopped !== null) {
        item = failed(t, stopped);
      } else {
        if (i > 0) await sleep(delayMs);
        // Same reference / date rules as the provider: the vnp_TxnRef and vnp_CreateDate sent at pay time, createdAt only as a fallback.
        const meta = (t.metadata ?? {}) as Record<string, unknown>;
        const txnRef = String(meta.vnp_TxnRef ?? t.providerTransactionId ?? t.id);
        const transactionDate = String(meta.vnp_CreateDate ?? formatVnpDate(t.createdAt));
        try {
          item = classifyQuerydrAnswer(t, txnRef, await client.query({ txnRef, transactionDate }, timeoutMs));
        } catch {
          item = failed(t, 'Không hỏi được VNPay (lỗi mạng, quá thời gian chờ hoặc VNPay từ chối).');
        }
        consecutiveFailures = item.result === 'QUERY_FAILED' ? consecutiveFailures + 1 : 0;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT && stopped === null) {
          stopped = `Đã dừng hỏi VNPay sau ${CONSECUTIVE_FAILURE_LIMIT} lần lỗi liên tiếp để tránh quá tải (có thể bị giới hạn tốc độ).`;
        }
      }
      report.items.push(item);
      report.counts.checked += 1;
      report.counts[COUNT_KEY[item.result]] += 1;
    }
    return report;
  },
};
