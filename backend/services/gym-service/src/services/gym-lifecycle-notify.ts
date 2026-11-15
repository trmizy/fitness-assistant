import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { userClient } from '../clients/user.client';
import type { GymLifecycleAction } from './gym-admin-lifecycle.service';

/**
 * FIX3-NOTIFY (15/11/2026, Ngài approved): when an admin suspends / lifts the suspension of / temporarily closes / reopens a branch
 * (gymAdminLifecycleService.apply) the branch's OWNER and the MANAGERS scoped to that branch get one in-app notice each, through the same
 * path as the listing + complaint notices (gym-service -> user-service `/internal/notifications`, entity GYM_BRANCH).
 *
 * Best-effort, sent AFTER the status change and its audit row are written: nothing in here ever throws, so a notification failure can
 * never fail or undo the admin's action (userClient.notifyUser already swallows transport errors; the recipient lookup is guarded below).
 */
export type GymLifecycleEventType = 'GYM_BRANCH_SUSPENDED' | 'GYM_BRANCH_SUSPENSION_LIFTED' | 'GYM_BRANCH_TEMPORARILY_CLOSED' | 'GYM_BRANCH_REOPENED';

export const LIFECYCLE_EVENT_BY_ACTION: Record<GymLifecycleAction, GymLifecycleEventType> = {
  SUSPEND: 'GYM_BRANCH_SUSPENDED',
  LIFT_SUSPENSION: 'GYM_BRANCH_SUSPENSION_LIFTED',
  CLOSE_TEMPORARILY: 'GYM_BRANCH_TEMPORARILY_CLOSED',
  REOPEN: 'GYM_BRANCH_REOPENED',
};

/** dd/MM/yyyy on the Vietnam calendar (UTC+7, no DST), independent of the server's timezone / ICU data. */
export function formatVnDate(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** The notice body: the action, the branch name, the admin's reason and (for a temporary closure) the expected reopen date. */
export function lifecycleNoticeText(action: GymLifecycleAction, gymName: string, reason: string, expectedReopenAt?: Date | null): string {
  const note = reason ? ` Lý do: ${sentence(reason)}` : '';
  switch (action) {
    case 'SUSPEND':
      // Owner decision 15/11: a suspension is a platform measure only - members with a live membership still check in until it ends.
      return `Chi nhánh ${gymName} đã bị tạm khoá trên Gymini.${note} Hội viên đang có gói vẫn check-in bình thường tới hết hạn; chi nhánh tạm ẩn khỏi tìm kiếm và không bán gói mới.`;
    case 'LIFT_SUSPENSION':
      return `Chi nhánh ${gymName} đã được mở khoá trên Gymini và hoạt động trở lại.${note ? ` Ghi chú: ${sentence(reason)}` : ''}`;
    case 'CLOSE_TEMPORARILY':
      return `Chi nhánh ${gymName} đã được chuyển sang tạm đóng cửa${expectedReopenAt ? ` đến ${formatVnDate(expectedReopenAt)}` : ''}, tạm dừng check-in trong thời gian này.${note}`;
    case 'REOPEN':
      return `Chi nhánh ${gymName} đã được mở cửa lại, check-in hoạt động trở lại.${note ? ` Ghi chú: ${sentence(reason)}` : ''}`;
  }
}

/** The branch owner plus every ACTIVE manager scoped to this branch, once each. */
export async function lifecycleRecipients(gym: { id: string; ownerId: string }, partnerId: string | null): Promise<string[]> {
  const ids = new Set<string>([gym.ownerId]);
  if (partnerId) {
    const managers = await prisma.gymPartnerAccount.findMany({
      where: { partnerId, role: 'MANAGER', status: 'ACTIVE', scopedGymIds: { has: gym.id } },
      select: { userId: true },
    });
    for (const m of managers) ids.add(m.userId);
  }
  return [...ids];
}

export async function sendLifecycleNotices(params: {
  gym: { id: string; ownerId: string; name: string; approvedName: string | null };
  partnerId: string | null;
  action: GymLifecycleAction;
  reason: string;
  expectedReopenAt?: Date | null;
}): Promise<void> {
  try {
    const { gym, action } = params;
    const recipients = await lifecycleRecipients(gym, params.partnerId);
    const text = lifecycleNoticeText(action, gym.approvedName ?? gym.name, params.reason, params.expectedReopenAt);
    await Promise.allSettled(
      recipients.map((userId) =>
        userClient.notifyUser({ userId, text, eventType: LIFECYCLE_EVENT_BY_ACTION[action], entityType: 'GYM_BRANCH', entityId: gym.id, link: `/gym-owner/gyms/${gym.id}` }),
      ),
    );
  } catch (e) {
    logger.warn({ err: (e as Error).message, gymId: params.gym.id, action: params.action }, '[Gym] could not send the branch lifecycle notices');
  }
}
