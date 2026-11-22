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
 * transition only (a replayed approve/pay/reject that changes nothing sends nothing).
 *
 * GYM withdrawals (Gym Owner handoff item 3, owner decision 22/11/2026): ownerId is a BRANCH id, not a user, so the recipients are
 * resolved at notice time: gym-service (`POST /internal/gyms/:gymId/withdrawal-recipients`, the only service that knows who owns a
 * branch's partner) returns the ACTIVE OWNER account(s) of the branch's partner, and the person who made the request
 * (withdrawal_requests.requested_by_user_id, when known) is added. Resolved after the decision, not frozen at request time, so an
 * owner added or removed in between is handled. If gym-service cannot answer, the requester alone is told (best-effort, never throws).
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
  /** Who asked (null on rows created before the column existed and on PT / CLIENT rows). */
  requestedByUserId?: string | null;
}

export interface GymWithdrawalRecipients {
  userIds: string[];
  gymName: string | null;
}

const ADMIN_LINK = '/admin/finance/withdrawals';
const OWNER_LINK: Record<string, string> = { CLIENT: '/client/wallet', PT: '/pt/wallet' };
/** A GYM request's wallet lives on the branch page (the withdrawal panel + history), the same page the branch lifecycle notices open. */
export function gymWithdrawalLink(gymId: string): string {
  return `/gym-owner/gyms/${gymId}`;
}

export function withdrawalOwnerNoticeText(
  kind: 'APPROVED' | 'PAID' | 'REJECTED',
  amount: string,
  extra?: { reason?: string | null; bankReference?: string | null; ownerType?: string; gymName?: string | null },
): string {
  const amt = formatVnd(amount);
  const gym = extra?.ownerType === 'GYM';
  const name = extra?.gymName?.trim();
  const whose = gym ? `của chi nhánh${name ? ` ${name}` : ''}` : 'của bạn';
  if (kind === 'APPROVED') {
    return `Yêu cầu rút ${amt} ${whose} đã được duyệt. Khoản tiền đang được chuẩn bị chuyển vào ${gym ? 'tài khoản nhận đã đăng ký của đối tác' : 'tài khoản nhận của bạn'}.`;
  }
  if (kind === 'PAID') {
    const ref = extra?.bankReference?.trim();
    return `Yêu cầu rút ${amt} ${whose} đã được chuyển khoản${ref ? ` (mã tham chiếu ${ref})` : ''}.`;
  }
  const reason = extra?.reason?.trim();
  return `Yêu cầu rút ${amt} ${whose} đã bị từ chối${reason ? `. Lý do: ${reason.slice(0, 200)}` : ''}. Số tiền vẫn nằm trong ví ${gym ? 'chi nhánh' : 'của bạn'}.`;
}

/** The people to tell about a GYM withdrawal: the branch's partner owner(s) from gym-service plus the requester, once each. Pure, unit-tested. */
export function mergeGymRecipients(ownerUserIds: ReadonlyArray<unknown>, requestedByUserId?: string | null): string[] {
  const out = new Set<string>();
  for (const id of ownerUserIds) if (typeof id === 'string' && id.trim()) out.add(id.trim());
  if (typeof requestedByUserId === 'string' && requestedByUserId.trim()) out.add(requestedByUserId.trim());
  return [...out];
}

/** gym-service's answer (read-only POST, secret-gated) for who owns this branch's partner. Throws on any transport / shape failure. */
async function fetchGymRecipients(gymId: string): Promise<GymWithdrawalRecipients> {
  const res = await postServiceJson({
    service: 'gym',
    path: `/internal/gyms/${encodeURIComponent(gymId)}/withdrawal-recipients`,
    headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
    timeoutMs: SEND_TIMEOUT_MS,
    body: {},
  });
  const data = res?.data;
  return {
    userIds: Array.isArray(data?.userIds) ? data.userIds.filter((x: unknown): x is string => typeof x === 'string') : [],
    gymName: typeof data?.gymName === 'string' ? data.gymName : null,
  };
}

export type GymRecipientResolver = (gymId: string) => Promise<GymWithdrawalRecipients>;

/**
 * Recipients + branch name for a GYM request. A resolver failure is logged and degrades to the requester alone (never throws), so the
 * decision the admin just made is never affected and a known requester is still told.
 */
export async function resolveGymWithdrawalRecipients(
  request: Pick<WithdrawalNoticeRequest, 'id' | 'ownerId' | 'requestedByUserId'>,
  resolver: GymRecipientResolver = fetchGymRecipients,
): Promise<{ userIds: string[]; gymName: string | null }> {
  let owners: GymWithdrawalRecipients = { userIds: [], gymName: null };
  try {
    owners = await resolver(request.ownerId);
  } catch (e) {
    logger.warn({ err: (e as Error).message, withdrawalId: request.id }, '[Withdrawal] could not resolve the gym owners (the requester alone is told)');
  }
  return { userIds: mergeGymRecipients(owners.userIds, request.requestedByUserId), gymName: owners.gymName };
}

export function withdrawalAdminNoticeText(amount: string): string {
  return `Khoản rút ${formatVnd(amount)} đã được một quản trị viên duyệt và đang chờ một quản trị viên khác xác nhận đã chi.`;
}

const inFlight = new Set<Promise<unknown>>();

/** Test hook: replaces how the gym owners are looked up (default: gym-service). Pass null to restore. */
let gymRecipientResolver: GymRecipientResolver | undefined;
export function setGymRecipientResolverForTest(resolver: GymRecipientResolver | null): void {
  gymRecipientResolver = resolver ?? undefined;
}

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
  if (request.ownerType === 'GYM') {
    await bestEffort(`gym-owners:${kind}`, request.id, async () => {
      const { userIds, gymName } = await resolveGymWithdrawalRecipients(request, gymRecipientResolver);
      const text = withdrawalOwnerNoticeText(kind, request.amount.toString(), { ...extra, ownerType: 'GYM', gymName });
      const results = await Promise.allSettled(
        userIds.map((userId) => send({ userId, text, eventType: `WITHDRAWAL_${kind}`, entityId: request.id, link: gymWithdrawalLink(request.ownerId) })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) logger.warn({ withdrawalId: request.id, failed, total: userIds.length }, '[Withdrawal] some gym-owner notifications could not be sent');
    });
    return;
  }
  const link = OWNER_LINK[request.ownerType];
  if (!link) return;
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
