import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { userClient } from '../clients/user.client';
import { resolvePartnerId } from './gym-listing.helpers';
import { lifecycleRecipients } from './gym-lifecycle-notify';

/**
 * SECURITY_BUSINESS_HANDOFF item 6 (Ngài approved): when front-desk staff request a check-in EXCEPTION
 * (assistedCheckinService.requestException) the branch's OWNER and the MANAGERS scoped to that branch get one in-app (bell) notice each,
 * so the request is decided before it expires at the end of the day. The requester is never notified about their own request.
 *
 * Same path as the lifecycle / listing notices (gym-service -> user-service `/internal/notifications`, entity GYM_BRANCH). Best-effort, called
 * AFTER the exception row and its audit event are written: nothing in here ever throws, so a failed notification can never fail or undo the request.
 * The text is generic on purpose (no member name / reason): the bell is a pointer to the front-desk page, where the approver sees the details.
 */
export const CHECKIN_EXCEPTION_REQUESTED_EVENT = 'GYM_CHECKIN_EXCEPTION_REQUESTED';

export function checkinExceptionNoticeText(gymName: string): string {
  return `Chi nhánh ${gymName} có một yêu cầu ngoại lệ check-in đang chờ duyệt. Hãy duyệt hoặc từ chối trong ngày — yêu cầu tự hết hạn khi hết ngày.`;
}

/** Owner + scoped managers of the branch, minus the requester (four-eyes: someone else decides). */
export function exceptionApprovers(recipients: readonly string[], requesterUserId: string): string[] {
  return recipients.filter((id) => id !== requesterUserId);
}

export interface ExceptionNoticeDeps {
  recipients: (gym: { id: string; ownerId: string; brandId: string | null }) => Promise<string[]>;
  notify: (params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link?: string }) => Promise<unknown>;
}

const defaultDeps: ExceptionNoticeDeps = {
  recipients: async (gym) => lifecycleRecipients(gym, await resolvePartnerId(prisma, gym)),
  notify: (p) => userClient.notifyUser(p),
};

export async function sendCheckinExceptionRequestedNotices(
  params: { gym: { id: string; ownerId: string; brandId: string | null; name: string; approvedName?: string | null }; requesterUserId: string },
  deps: ExceptionNoticeDeps = defaultDeps,
): Promise<void> {
  try {
    const { gym } = params;
    const to = exceptionApprovers(await deps.recipients(gym), params.requesterUserId);
    if (to.length === 0) return;
    const text = checkinExceptionNoticeText(gym.approvedName ?? gym.name);
    await Promise.allSettled(
      to.map((userId) =>
        deps.notify({ userId, text, eventType: CHECKIN_EXCEPTION_REQUESTED_EVENT, entityType: 'GYM_BRANCH', entityId: gym.id, link: `/gym-owner/front-desk?gymId=${gym.id}` }),
      ),
    );
  } catch (e) {
    logger.warn({ err: (e as Error).message, gymId: params.gym.id }, '[Gym] could not send the check-in exception notices');
  }
}
