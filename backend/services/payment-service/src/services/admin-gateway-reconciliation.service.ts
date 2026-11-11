/**
 * B8 "Doi chieu cong <-> Gymini", level L2 - READ ONLY.
 *
 * SCOPE (L2): this compares Gymini's own transactions only against what the gateways SENT BACK and Gymini STORED
 * (payment_webhook_events: IPN / browser-return / active-poll records). There is no gateway settlement file or API
 * here, so this is NOT an independent reconciliation against the gateway's own books.
 *
 * Never returned: PaymentWebhookEvent.payload (only two scalars are DERIVED from it inside SQL - a success flag and a
 * whole-VND amount - and neither the payload nor any secret leaves the database), transaction metadata, ids of wallets.
 * Money is returned as a decimal STRING with two fraction digits (the stored amount via Decimal.toFixed(2); the
 * gateway-reported whole-VND integer with ".00" appended by string concatenation, never through a float).
 *
 * How each gateway's event is stored (read from webhook.routes.ts, vnpay-callback.service.ts, webhook.service.ts and the
 * four providers' verifyWebhookSignature):
 *   - the row is upserted by handleEvent() (and, for MoMo, once more before the 204 ack) with
 *     payload = normalized.raw, providerTransactionId = the reference WE gave the gateway;
 *   - VNPAY    payload = the vnp_* query params. Paid  <=> vnp_ResponseCode = '00' AND vnp_TransactionStatus = '00'.
 *              Amount = vnp_Amount, a figure x100 (vnpayMinorToVnd). providerEventId 'vnpay_ipn:...' / 'vnpay_return:...'.
 *              A callback refused for amount (RspCode 04) is NOT stored as an event - only as metadata.gatewayDiscrepancy.
 *   - ZALOPAY  payload = the decoded `data`. ZaloPay calls back only for a successful charge, so every stored callback
 *              is a success. Amount = `amount`, plain VND.
 *   - PAYOS    payload = the webhook `data` (the envelope's own code/success are NOT stored). Success is read from
 *              data.code = '00'; code says a paid notice needs envelope AND data to be '00', so a payload that disagrees
 *              with its own envelope would be misread - not a shape PayOS produces. Amount = `amount`, plain VND.
 *   - MOMO     payload = the full IPN. Paid <=> resultCode = 0. Amount = `amount`, plain VND.
 *   - the active poll (pollAndSettle) ALSO stores a row (providerEventId 'poll_<txn>_<ms>') whose payload is the gateway
 *     QUERY response, a different shape per provider: a poll row is never parsed (success/amount stay NULL) and it does
 *     not count as a gateway callback.
 *   - MOCK has no events (provider removed); STRIPE / MANUAL_BANK_TRANSFER have no verifier, so they are out of scope.
 * "Matching transaction" always means payment_transactions with the SAME provider AND providerTransactionId (the exact
 * rule handleEvent uses; it never matches across providers).
 *
 * Categories and their exact rules (window = [from, to); cap 100 rows each, `truncated` when more exist):
 *   WEBHOOK_UNPROCESSED       event.createdAt in window, processedAt IS NULL, createdAt older than 10 minutes before
 *                             generatedAt, and a matching transaction exists. (Events with no matching transaction are
 *                             shown ONLY under WEBHOOK_ORPHAN so one event is never counted twice for the same reason.)
 *   WEBHOOK_ORPHAN            event.createdAt in window and NO matching transaction (incl. a null reference).
 *   GATEWAY_SUCCESS_NOT_PAID  non-poll event.createdAt in window, success flag TRUE, older than 10 minutes, matching
 *                             transaction status NOT IN (PAID, REFUNDED), and the transaction carries NO
 *                             metadata.gatewayDiscrepancy (those are already listed by GET /admin/payments/gateway-discrepancies).
 *   REPORTED_AMOUNT_MISMATCH  non-poll event.createdAt in window, success flag TRUE, a reliably parsed whole-VND amount
 *                             that differs from transaction.amount, and the transaction carries NO
 *                             metadata.gatewayDiscrepancy (same reason). Transactions skipped for that reason are counted
 *                             in counts.coveredByGatewayDiscrepancies.
 *   PAID_WITHOUT_GATEWAY_EVENT transaction PAID, provider in (VNPAY, ZALOPAY, PAYOS, MOMO), purpose is one a gateway pays
 *                             for (the same set vnpay-callback.service.ts settles), COALESCE(paidAt, createdAt) in window,
 *                             and NO non-poll event with the same provider + providerTransactionId. Severity info: the
 *                             confirmation may legitimately have come from the active poll (pollAndSettle) - the item note
 *                             says whether a poll record exists.
 */
import { z } from 'zod';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

export const GATEWAY_RECONCILIATION_ITEM_CAP = 100;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 92;
const UNPROCESSED_GRACE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
export const gatewayIsoDate = z
  .string()
  .refine((s) => ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s)), 'ngày không hợp lệ')
  .transform((s) => new Date(s));

export const gatewayReconciliationQuerySchema = z
  .object({ from: gatewayIsoDate.optional(), to: gatewayIsoDate.optional() })
  .strict();

export type GatewayReconciliationQuery = z.output<typeof gatewayReconciliationQuerySchema>;

export type GatewayReconciliationSeverity = 'danger' | 'warning' | 'info';

export interface GatewayReconciliationItem {
  transactionId: string | null;
  webhookEventId: string | null;
  provider: string;
  providerTransactionId: string | null;
  transactionStatus: string | null;
  /** The transaction's stored amount, "123456.00"; null when the item has no transaction. */
  amount: string | null;
  /** What the gateway reported, whole VND with ".00"; null when absent or not reliably readable. */
  reportedAmount: string | null;
  /** createdAt of the subject row: the event for event-based categories, the transaction for PAID_WITHOUT_GATEWAY_EVENT. */
  createdAt: string;
  note: string;
}

export interface GatewayReconciliationCategory {
  code: GatewayReconciliationCategoryCode;
  label: string;
  severity: GatewayReconciliationSeverity;
  items: GatewayReconciliationItem[];
  truncated: boolean;
}

export type GatewayReconciliationCategoryCode =
  | 'WEBHOOK_UNPROCESSED'
  | 'WEBHOOK_ORPHAN'
  | 'GATEWAY_SUCCESS_NOT_PAID'
  | 'REPORTED_AMOUNT_MISMATCH'
  | 'PAID_WITHOUT_GATEWAY_EVENT';

export interface GatewayReconciliationReport {
  scope: 'L2';
  from: string;
  to: string;
  generatedAt: string;
  counts: {
    webhookEventsInRange: number;
    paidGatewayTransactionsInRange: number;
    webhookUnprocessed: number;
    webhookOrphan: number;
    gatewaySuccessNotPaid: number;
    reportedAmountMismatch: number;
    paidWithoutGatewayEvent: number;
    /** Transactions whose event disagrees with the price/status but are already listed by gateway-discrepancies. */
    coveredByGatewayDiscrepancies: number;
  };
  categories: GatewayReconciliationCategory[];
}

export class GatewayWindowError extends Error {}

/** Resolves the window: from inclusive, to exclusive, default last 30 days ending now, at most 92 days. */
export function resolveGatewayWindow(q: GatewayReconciliationQuery, now: Date): { from: Date; to: Date } {
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  if (!(from < to)) throw new GatewayWindowError('from phải trước to');
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) throw new GatewayWindowError(`khoảng thời gian tối đa ${MAX_WINDOW_DAYS} ngày`);
  return { from, to };
}

const PROVIDER_NAME: Record<string, string> = { VNPAY: 'VNPay', ZALOPAY: 'ZaloPay', PAYOS: 'PayOS', MOMO: 'MoMo' };
const STATUS_VI: Record<string, string> = {
  PENDING: 'đang chờ thanh toán',
  PROCESSING: 'đang xử lý',
  FAILED: 'thất bại',
  CANCELLED: 'đã hủy',
  PAID: 'đã thanh toán',
  REFUNDED: 'đã hoàn tiền',
};
const providerVi = (p: string) => PROVIDER_NAME[p] ?? 'cổng thanh toán';
const statusVi = (s: string | null) => (s ? STATUS_VI[s] ?? 'không rõ' : 'không rõ');
const money = (d: Prisma.Decimal | string | null): string | null => (d === null ? null : new Prisma.Decimal(d).toFixed(2));
const reported = (digits: string | null): string | null => (digits === null ? null : `${digits}.00`);

// The four gateways that have a verifier + a stored-event path (see the header comment).
const GATEWAYS_SQL = Prisma.sql`('VNPAY', 'ZALOPAY', 'PAYOS', 'MOMO')`;
// Purposes a gateway checkout pays for - the same set vnpay-callback.service.ts GATEWAY_PURPOSES settles.
const GATEWAY_PURPOSES_SQL = Prisma.sql`('WALLET_TOPUP', 'PT_CONTRACT', 'GYM_MEMBERSHIP', 'TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE')`;

interface EventRow {
  id: string;
  provider: string;
  provider_transaction_id: string | null;
  processed_at: Date | null;
  retry_count: number;
  created_at: Date;
  gw_success: boolean | null;
  gw_amount_vnd: string | null;
  txn_id: string | null;
  txn_status: string | null;
  txn_amount: Prisma.Decimal | null;
  total: bigint;
}

interface PaidRow {
  id: string;
  provider: string;
  provider_transaction_id: string | null;
  status: string;
  amount: Prisma.Decimal;
  created_at: Date;
  has_poll: boolean;
  total: bigint;
}

/**
 * The window's gateway events with the two DERIVED scalars (see the header comment for each provider's reading) and the
 * matching transaction. Nested CASEs on purpose: SQL does not promise left-to-right evaluation of AND, so a regex guard and
 * the numeric cast that depends on it must sit in different CASE levels.
 */
function eventsCte(from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`
    WITH evt AS (
      SELECT e.id, e.provider::text AS provider, e.provider_transaction_id, e.processed_at, e.retry_count, e.created_at,
        (left(e.provider_event_id, 5) = 'poll_') AS is_poll,
        CASE
          WHEN left(e.provider_event_id, 5) = 'poll_' THEN NULL
          WHEN e.provider::text = 'VNPAY' THEN
            CASE WHEN e.payload->>'vnp_ResponseCode' IS NULL THEN NULL
                 ELSE (e.payload->>'vnp_ResponseCode' = '00' AND COALESCE(e.payload->>'vnp_TransactionStatus', '') = '00') END
          WHEN e.provider::text = 'ZALOPAY' THEN CASE WHEN e.payload->>'app_trans_id' IS NULL THEN NULL ELSE TRUE END
          WHEN e.provider::text = 'PAYOS' THEN CASE WHEN e.payload->>'code' IS NULL THEN NULL ELSE (e.payload->>'code' = '00') END
          WHEN e.provider::text = 'MOMO' THEN CASE WHEN e.payload->>'resultCode' IS NULL THEN NULL ELSE (e.payload->>'resultCode' = '0') END
        END AS gw_success,
        CASE
          WHEN left(e.provider_event_id, 5) = 'poll_' THEN NULL
          WHEN e.provider::text = 'VNPAY' THEN
            CASE WHEN e.payload->>'vnp_Amount' ~ '^[0-9]{1,18}$' THEN
              CASE WHEN (e.payload->>'vnp_Amount')::numeric % 100 = 0 THEN ((e.payload->>'vnp_Amount')::numeric / 100)::bigint::text END
            END
          ELSE
            CASE WHEN e.payload->>'amount' ~ '^[0-9]{1,18}$' THEN ((e.payload->>'amount')::numeric)::bigint::text END
        END AS gw_amount_vnd
      FROM payment_webhook_events e
      WHERE e.provider::text IN ${GATEWAYS_SQL}
        AND e.created_at >= ${from} AND e.created_at < ${to}
    ), j AS (
      SELECT evt.*, t.id AS txn_id, t.status::text AS txn_status, t.amount AS txn_amount,
             COALESCE(t.has_discrepancy, FALSE) AS txn_flagged
      FROM evt
      LEFT JOIN LATERAL (
        SELECT pt.id, pt.status, pt.amount, (pt.metadata->'gatewayDiscrepancy' IS NOT NULL) AS has_discrepancy
        FROM payment_transactions pt
        WHERE pt.provider::text = evt.provider AND pt.provider_transaction_id = evt.provider_transaction_id
        ORDER BY pt.created_at ASC, pt.id ASC
        LIMIT 1
      ) t ON TRUE
    )`;
}

type EventCategoryDef = {
  code: GatewayReconciliationCategoryCode;
  label: string;
  severity: GatewayReconciliationSeverity;
  where: (cutoff: Date) => Prisma.Sql;
  note: (r: EventRow) => string;
};

const EVENT_CATEGORIES: EventCategoryDef[] = [
  {
    code: 'WEBHOOK_UNPROCESSED',
    label: 'Sự kiện cổng chưa được xử lý',
    severity: 'danger',
    where: (cutoff) => Prisma.sql`processed_at IS NULL AND created_at < ${cutoff} AND txn_id IS NOT NULL`,
    note: (r) =>
      `Gymini đã nhận sự kiện từ ${providerVi(r.provider)} nhưng chưa xử lý xong sau hơn 10 phút (đã thử lại ${r.retry_count} lần). Giao dịch đang ở trạng thái "${statusVi(r.txn_status)}".`,
  },
  {
    code: 'WEBHOOK_ORPHAN',
    label: 'Sự kiện cổng không khớp giao dịch nào',
    severity: 'warning',
    where: () => Prisma.sql`txn_id IS NULL`,
    note: (r) =>
      `Sự kiện từ ${providerVi(r.provider)} không khớp với giao dịch nào của Gymini${r.provider_transaction_id ? '' : ' (không có mã tham chiếu)'}${r.gw_success === true ? '; cổng báo đã thu tiền thành công' : ''}.`,
  },
  {
    code: 'GATEWAY_SUCCESS_NOT_PAID',
    label: 'Cổng báo thành công nhưng giao dịch chưa thanh toán',
    severity: 'danger',
    where: (cutoff) =>
      Prisma.sql`gw_success IS TRUE AND created_at < ${cutoff} AND txn_id IS NOT NULL AND txn_status NOT IN ('PAID', 'REFUNDED') AND NOT txn_flagged`,
    note: (r) =>
      `${providerVi(r.provider)} báo thanh toán thành công nhưng giao dịch của Gymini đang ở trạng thái "${statusVi(r.txn_status)}"${r.processed_at ? '' : ' và sự kiện chưa được xử lý'}.`,
  },
  {
    code: 'REPORTED_AMOUNT_MISMATCH',
    label: 'Số tiền cổng báo khác số tiền giao dịch',
    severity: 'danger',
    where: () =>
      Prisma.sql`gw_success IS TRUE AND txn_id IS NOT NULL AND gw_amount_vnd IS NOT NULL AND gw_amount_vnd::numeric <> txn_amount AND NOT txn_flagged`,
    note: (r) =>
      `Số tiền ${providerVi(r.provider)} báo về khác số tiền của giao dịch (trạng thái "${statusVi(r.txn_status)}"). Giao dịch này chưa nằm trong danh sách lệch số tiền của cổng.`,
  },
];

type Built = { category: GatewayReconciliationCategory; total: number };

async function eventCategory(def: EventCategoryDef, from: Date, to: Date, cutoff: Date): Promise<Built> {
  const rows = await prisma.$queryRaw<EventRow[]>(Prisma.sql`
    ${eventsCte(from, to)}
    SELECT j.id, j.provider, j.provider_transaction_id, j.processed_at, j.retry_count, j.created_at, j.gw_success, j.gw_amount_vnd,
           j.txn_id, j.txn_status, j.txn_amount, count(*) OVER() AS total
    FROM j
    WHERE ${def.where(cutoff)}
    ORDER BY j.created_at DESC, j.id ASC
    LIMIT ${GATEWAY_RECONCILIATION_ITEM_CAP + 1}`);
  const total = rows.length ? Number(rows[0].total) : 0;
  const category: GatewayReconciliationCategory = {
    code: def.code,
    label: def.label,
    severity: def.severity,
    truncated: total > GATEWAY_RECONCILIATION_ITEM_CAP,
    items: rows.slice(0, GATEWAY_RECONCILIATION_ITEM_CAP).map((r) => ({
      transactionId: r.txn_id,
      webhookEventId: r.id,
      provider: r.provider,
      providerTransactionId: r.provider_transaction_id,
      transactionStatus: r.txn_status,
      amount: money(r.txn_amount),
      reportedAmount: reported(r.gw_amount_vnd),
      createdAt: r.created_at.toISOString(),
      note: def.note(r),
    })),
  };
  return { category, total };
}

async function paidWithoutEventCategory(from: Date, to: Date): Promise<Built> {
  const rows = await prisma.$queryRaw<PaidRow[]>(Prisma.sql`
    SELECT t.id, t.provider::text AS provider, t.provider_transaction_id, t.status::text AS status, t.amount, t.created_at,
           EXISTS (
             SELECT 1 FROM payment_webhook_events p
             WHERE p.provider = t.provider AND p.provider_transaction_id = t.provider_transaction_id AND left(p.provider_event_id, 5) = 'poll_'
           ) AS has_poll,
           count(*) OVER() AS total
    FROM payment_transactions t
    WHERE t.status = 'PAID'
      AND t.provider::text IN ${GATEWAYS_SQL}
      AND t.purpose::text IN ${GATEWAY_PURPOSES_SQL}
      AND COALESCE(t.paid_at, t.created_at) >= ${from} AND COALESCE(t.paid_at, t.created_at) < ${to}
      AND NOT EXISTS (
        SELECT 1 FROM payment_webhook_events e
        WHERE e.provider = t.provider AND e.provider_transaction_id = t.provider_transaction_id AND left(e.provider_event_id, 5) <> 'poll_'
      )
    ORDER BY t.created_at DESC, t.id ASC
    LIMIT ${GATEWAY_RECONCILIATION_ITEM_CAP + 1}`);
  const total = rows.length ? Number(rows[0].total) : 0;
  const category: GatewayReconciliationCategory = {
    code: 'PAID_WITHOUT_GATEWAY_EVENT',
    label: 'Đã thanh toán nhưng chưa có sự kiện cổng gửi về',
    severity: 'info',
    truncated: total > GATEWAY_RECONCILIATION_ITEM_CAP,
    items: rows.slice(0, GATEWAY_RECONCILIATION_ITEM_CAP).map((r) => ({
      transactionId: r.id,
      webhookEventId: null,
      provider: r.provider,
      providerTransactionId: r.provider_transaction_id,
      transactionStatus: r.status,
      amount: money(r.amount),
      reportedAmount: null,
      createdAt: r.created_at.toISOString(),
      note: r.has_poll
        ? `Giao dịch được xác nhận qua truy vấn chủ động tới ${providerVi(r.provider)}, chưa có thông báo (IPN/chuyển hướng) do cổng gửi về. Có thể hợp lệ.`
        : `Chưa có bất kỳ sự kiện nào của ${providerVi(r.provider)} được lưu cho giao dịch này. Cần kiểm tra thủ công với cổng.`,
    })),
  };
  return { category, total };
}

export const adminGatewayReconciliationService = {
  async report(q: GatewayReconciliationQuery, now: Date = new Date()): Promise<GatewayReconciliationReport> {
    const { from, to } = resolveGatewayWindow(q, now);
    const cutoff = new Date(now.getTime() - UNPROCESSED_GRACE_MS);

    const [built, paidMissing, totals, covered] = await Promise.all([
      Promise.all(EVENT_CATEGORIES.map((def) => eventCategory(def, from, to, cutoff))),
      paidWithoutEventCategory(from, to),
      prisma.$queryRaw<Array<{ events: bigint; paid: bigint }>>(Prisma.sql`
        SELECT
          (SELECT count(*) FROM payment_webhook_events e
            WHERE e.provider::text IN ${GATEWAYS_SQL} AND e.created_at >= ${from} AND e.created_at < ${to}) AS events,
          (SELECT count(*) FROM payment_transactions t
            WHERE t.status = 'PAID' AND t.provider::text IN ${GATEWAYS_SQL} AND t.purpose::text IN ${GATEWAY_PURPOSES_SQL}
              AND COALESCE(t.paid_at, t.created_at) >= ${from} AND COALESCE(t.paid_at, t.created_at) < ${to}) AS paid`),
      // Distinct transactions that WOULD be GATEWAY_SUCCESS_NOT_PAID / REPORTED_AMOUNT_MISMATCH but already carry
      // metadata.gatewayDiscrepancy (listed by GET /admin/payments/gateway-discrepancies).
      prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        ${eventsCte(from, to)}
        SELECT count(DISTINCT txn_id) AS n FROM j
        WHERE gw_success IS TRUE AND txn_id IS NOT NULL AND txn_flagged
          AND ((created_at < ${cutoff} AND txn_status NOT IN ('PAID', 'REFUNDED'))
               OR (gw_amount_vnd IS NOT NULL AND gw_amount_vnd::numeric <> txn_amount))`),
    ]);

    const [unprocessed, orphan, successNotPaid, amountMismatch] = built;
    return {
      scope: 'L2',
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: now.toISOString(),
      counts: {
        webhookEventsInRange: Number(totals[0]?.events ?? 0),
        paidGatewayTransactionsInRange: Number(totals[0]?.paid ?? 0),
        webhookUnprocessed: unprocessed.total,
        webhookOrphan: orphan.total,
        gatewaySuccessNotPaid: successNotPaid.total,
        reportedAmountMismatch: amountMismatch.total,
        paidWithoutGatewayEvent: paidMissing.total,
        coveredByGatewayDiscrepancies: Number(covered[0]?.n ?? 0),
      },
      categories: [...built, paidMissing].map((b) => b.category),
    };
  },
};
