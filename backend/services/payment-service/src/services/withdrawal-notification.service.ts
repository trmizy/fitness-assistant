import { logger } from '@gym-coach/shared';
import { postServiceJson } from '../clients/service-lambda.client';
import { listActiveAdminIdsInternal } from '../clients/auth-service.client';
import { formatVnd } from './refund-notification.service';

/**
 * Q9 (owner decision 14/11/2026) - in-app notices for the manual withdrawal flow, through the one notification path
 * payment-service already uses (refund-notification.service.ts): user-service's `POST /internal/notifications`, which stores a
 * listable bell notification and pushes it in real time.
 *
 *   - the WITHDRAWING USER is told when their request is approved, paid or rejected;
 *   - every other active ADMIN is told when a large request (>= the four-eyes threshold) was approved by one admin and now waits
 *     for a second admin to confirm the payout (the approver is left out: they cannot take that step).
 *
 * Rules (same as the refund notice): sent AFTER the money transaction committed, never inside it; best-effort and never throws, so a
 * user-service / auth-service outage cannot fail or roll back an approve / pay / reject; the caller sends one notice per REAL state
 * transition only (a replayed approve/pay/reject that changes nothing sends nothing). A GYM owner's request has no user id here
 * (ownerId is the gym id) so it gets no user notice.
 */
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';
const SEND_TIMEOUT_MS = 3000;
const CALLER_WAIT_MS = 2500;

export const WITHDRAWAL_AWAITING_SECOND_ADMIN = 'WITHDRAWAL_AWAITING_SECOND_ADMIN';
export const WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED';
export const WITHDRAWAL_PAID = 'WITHDRAWAL_PAID';
export const WITHDRAWAL_REJECTED = 'WITHDRAWAL_REJECTED';

export interface WithdrawalNoticeRequest {
  id: string;
  ownerType: string;
  ownerId: string;
  amount: { toString(): string };
}

const ADMIN_LINK = '/admin/finance/withdrawals';
const OWNER_LINK: Record<string, string> = { CLIENT: '/client/wallet', PT: '/pt/wallet' };

export function withdrawalOwnerNoticeText(kind: 'APPROVED' | 'PAID' | 'REJECTED', amount: string, extra?: { reason?: string | null; bankReference?: string | null }): string {
  const amt = formatVnd(amount);
  if (kind === 'APPROVED') return `Yêu cầu rút ${amt} của bạn đã được duyệt. Khoản tiền đang được chuẩn bị chuyển vào tài khoản nhận của bạn.`;
  if (kind === 'PAID') {
    const ref = extra?.bankReference?.trim();
    return `Yêu cầu rút ${amt} của bạn đã được chuyển khoản${ref ? ` (mã tham chiếu ${ref})` : ''}.`;
  }
  const reason = extra?.reason?.trim();
  return `Yêu cầu rút ${amt} của bạn đã bị từ chối${reason ? `. Lý do: ${reason.slice(0, 200)}` : ''}. Số tiền vẫn nằm trong ví của bạn.`;
}

export function withdrawalAdminNoticeText(amount: string): string {
  return `Khoản rút ${formatVnd(amount)} đã được một quản trị viên duyệt và đang chờ một quản trị viên khác xác nhận đã chi.`;
}

const inFlight = new Set<Promise<unknown>>();

/** Test hook: resolves once every notice started so far has finished (sent or failed). */
export async function drainWithdrawalNotifications(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

async function send(body: { userId: string; text: string; eventType: string; entityId: string; link: string }): Promise<void> {
  await postServiceJson({
    service: 'user',
    path: '/internal/notifications',
    headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
    timeoutMs: SEND_TIMEOUT_MS,
    body: { ...body, entityType: 'WITHDRAWAL_REQUEST' },
  });
}

/** Runs `work` best-effort: never throws, waits at most CALLER_WAIT_MS so a slow user-service cannot stall the admin's click. */
async function bestEffort(label: string, withdrawalId: string, work: () => Promise<void>): Promise<void> {
  const p = work().catch((e) => {
    logger.warn({ err: (e as Error).message, withdrawalId, notice: label }, '[Withdrawal] notification could not be sent (best-effort, the withdrawal itself is unaffected)');
  });
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([p, new Promise<void>((resolve) => { timer = setTimeout(resolve, CALLER_WAIT_MS); })]);
  if (timer) clearTimeout(timer);
}

export async function notifyWithdrawalOwner(
  kind: 'APPROVED' | 'PAID' | 'REJECTED',
  request: WithdrawalNoticeRequest,
  extra?: { reason?: string | null; bankReference?: string | null },
): Promise<void> {
  const link = OWNER_LINK[request.ownerType];
  if (!link) return; // GYM: ownerId is a gym id, not a user
  await bestEffort(`owner:${kind}`, request.id, () =>
    send({
      userId: request.ownerId,
      text: withdrawalOwnerNoticeText(kind, request.amount.toString(), extra),
      eventType: `WITHDRAWAL_${kind}`,
      entityId: request.id,
      link,
    }),
  );
}

/** Tells every active admin except the approver that this (large) approved withdrawal waits for a second admin. */
export async function notifyAdminsAwaitingSecondApproval(request: WithdrawalNoticeRequest, approverId: string): Promise<void> {
  await bestEffort('admins:awaiting-second', request.id, async () => {
    const adminIds = (await listActiveAdminIdsInternal()).filter((id) => id !== approverId);
    const text = withdrawalAdminNoticeText(request.amount.toString());
    const results = await Promise.allSettled(
      adminIds.map((userId) => send({ userId, text, eventType: WITHDRAWAL_AWAITING_SECOND_ADMIN, entityId: request.id, link: ADMIN_LINK })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) logger.warn({ withdrawalId: request.id, failed, total: adminIds.length }, '[Withdrawal] some admin notifications could not be sent');
  });
}
