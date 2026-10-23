import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { postServiceJson } from '../clients/service-lambda.client';

/**
 * FH-5 — tells the client, in the app, that a LATE payment for an already-cancelled personalized order / gym membership
 * / PT contract was refunded to their wallet, with the exact amount that was refunded.
 *
 * Reuses the one notification path the other services already use — user-service's `POST /internal/notifications`
 * (the same call gym-service makes for listing decisions and fitness-service for reminders): it persists a listable
 * bell notification and pushes it in real time. payment-service had no notification code before this.
 *
 * Rules this file keeps:
 *  - AFTER the refund committed, never inside the money transaction: it is called by activateOrRefund once
 *    refundUnactivatedContractPayment has returned, and it can neither fail nor roll back the refund (it never throws).
 *  - Best-effort: a user-service outage, a timeout or an old user-service without the event type is logged and
 *    forgotten; the refund and the ledger are untouched.
 *  - Once per TRANSACTION. The refund marker (`metadata.unactivatedRefund`) is the one durable per-transaction record,
 *    so the notice is claimed on it atomically (`notificationClaimedAt`, one UPDATE that matches only an unclaimed
 *    marker) before it is sent and stamped (`notifiedAt`) once sent. A retried webhook, the sweep, an admin re-drive
 *    or two concurrent callers therefore send it once; a failed send releases the claim so the next retry may try
 *    again, and a claim whose sender died (never stamped) expires after 5 minutes.
 */

/** Longest the caller (a gateway webhook) waits for the notice before moving on. The send itself keeps running. */
const CALLER_WAIT_MS = 2500;
const SEND_TIMEOUT_MS = 3000;

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

export const PAYMENT_AUTO_REFUNDED = 'PAYMENT_AUTO_REFUNDED';

const WHAT_WAS_BOUGHT: Record<string, string> = {
  PERSONALIZED_SERVICE_PURCHASE: 'đơn dịch vụ cá nhân hóa',
  GYM_MEMBERSHIP: 'gói hội viên',
  PT_CONTRACT: 'hợp đồng PT',
};

function formatVnd(amount: string): string {
  const n = Number(amount);
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0)}đ`;
}

/** The notice's text: the exact refunded amount, what it was for and - when the refund was partial - what is still open. */
export function autoRefundNoticeText(params: { relatedEntityType: string | null; refunded: string; unpaid?: string | null }): string {
  const what = (params.relatedEntityType && WHAT_WAS_BOUGHT[params.relatedEntityType]) || 'đơn hàng';
  const base = `Thanh toán của bạn đến sau khi ${what} đã bị hủy nên hệ thống đã hoàn ${formatVnd(params.refunded)} vào ví của bạn.`;
  const unpaid = Number(params.unpaid ?? 0);
  return unpaid > 0 ? `${base} Phần còn lại ${formatVnd(params.unpaid!)} đang được bộ phận hỗ trợ xử lý.` : base;
}

type Outcome = 'SENT' | 'ALREADY_SENT' | 'NOTHING_TO_SEND' | 'FAILED';

const inFlight = new Set<Promise<unknown>>();

/** Test hook: resolves once every notice started so far has finished (sent or failed). */
export async function drainRefundNotifications(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

async function claim(transactionId: string): Promise<boolean> {
  const claimed = await prisma.$executeRaw`
    UPDATE payment_transactions
       SET metadata = jsonb_set(metadata, '{unactivatedRefund,notificationClaimedAt}', to_jsonb(now()::text), true)
     WHERE id = ${transactionId}
       AND metadata->'unactivatedRefund' IS NOT NULL
       AND metadata->'unactivatedRefund'->>'notifiedAt' IS NULL
       AND (
         metadata->'unactivatedRefund'->>'notificationClaimedAt' IS NULL
         OR (metadata->'unactivatedRefund'->>'notificationClaimedAt')::timestamptz < now() - interval '5 minutes'
       )`;
  return claimed === 1;
}

async function stampSent(transactionId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE payment_transactions
       SET metadata = jsonb_set(metadata, '{unactivatedRefund,notifiedAt}', to_jsonb(now()::text), true)
     WHERE id = ${transactionId} AND metadata->'unactivatedRefund' IS NOT NULL`;
}

async function releaseClaim(transactionId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE payment_transactions
       SET metadata = metadata #- '{unactivatedRefund,notificationClaimedAt}'
     WHERE id = ${transactionId}
       AND metadata->'unactivatedRefund' IS NOT NULL
       AND metadata->'unactivatedRefund'->>'notifiedAt' IS NULL`;
}

async function sendOnce(transactionId: string): Promise<Outcome> {
  const txn = await prisma.paymentTransaction.findUnique({ where: { id: transactionId } });
  const meta = (txn?.metadata ?? null) as Record<string, any> | null;
  const refund = meta?.unactivatedRefund as Record<string, any> | undefined;
  if (!txn || !refund) return 'NOTHING_TO_SEND';
  if (refund.notifiedAt) return 'ALREADY_SENT';

  const refunded = String(refund.amount ?? '0');
  const clientUserId: string | undefined = meta?.parties?.clientUserId;
  // Nothing was credited (the transaction's own money could not fund any of it) or nobody to tell: no notice.
  if (!clientUserId || !(Number(refunded) > 0)) return 'NOTHING_TO_SEND';

  if (!(await claim(transactionId))) return 'ALREADY_SENT';
  try {
    await postServiceJson({
      service: 'user',
      path: '/internal/notifications',
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeoutMs: SEND_TIMEOUT_MS,
      body: {
        userId: clientUserId,
        text: autoRefundNoticeText({ relatedEntityType: txn.relatedEntityType, refunded, unpaid: refund.unpaid }),
        eventType: PAYMENT_AUTO_REFUNDED,
        entityType: 'PAYMENT',
        entityId: txn.id,
        link: '/client/wallet',
      },
    });
  } catch (e) {
    await releaseClaim(transactionId).catch(() => undefined);
    logger.warn(
      { err: (e as Error).message, transactionId, eventType: PAYMENT_AUTO_REFUNDED },
      '[Refund] the client was refunded but the notification could not be sent (best-effort, will retry on the next pass)',
    );
    return 'FAILED';
  }
  await stampSent(transactionId).catch((e) =>
    logger.warn({ err: (e as Error).message, transactionId }, '[Refund] notification sent but could not be stamped'),
  );
  return 'SENT';
}

/**
 * Sends the client's "refunded" notice for an auto-refunded transaction, once. Never throws. Waits at most
 * CALLER_WAIT_MS for the send so a slow user-service cannot stall a gateway webhook; the send itself carries on.
 */
export async function notifyClientOfAutoRefund(transactionId: string): Promise<void> {
  const work = sendOnce(transactionId).catch((e) => {
    logger.warn({ err: (e as Error).message, transactionId }, '[Refund] auto-refund notification failed');
    return 'FAILED' as Outcome;
  });
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, CALLER_WAIT_MS); })]);
  if (timer) clearTimeout(timer);
}
