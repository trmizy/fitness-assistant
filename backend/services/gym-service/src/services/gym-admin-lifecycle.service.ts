import { prisma } from '../repositories/prisma';
import { gymRepository } from '../repositories/gym.repository';
import { logger } from '@gym-coach/shared';
import { resolvePartnerId } from './gym-listing.helpers';
import { partnerAuditService } from './partner-audit.service';
import { MIN_ADMIN_REASON_LENGTH } from './gym-listing.schemas';

/**
 * FIX2-ADMIN Q5 (15/11/2026, Ngài approved): the admin's own "tạm khoá / mở khoá / tạm đóng cửa / mở cửa lại" of ONE branch.
 *
 * Two independent switches (see the Gym model): `status` (moderation: is the branch allowed on the platform) and
 * `operationalStatus` (is it physically open). The admin gets one action on each, every one with a reason that lands on the
 * PartnerAuditLog row (action GYM_ADMIN_STATUS_CHANGED, metadata.axis says which switch):
 *
 *   SUSPEND            APPROVED  -> SUSPENDED   reason required. Hidden from search, no new purchase, no check-in. Existing memberships are
 *                                              NOT cancelled or refunded here (refund stays the separate, deliberate admin action).
 *   LIFT_SUSPENSION    SUSPENDED -> APPROVED    reason optional.
 *   CLOSE_TEMPORARILY  OPEN      -> TEMPORARILY_CLOSED  reason required (shown to the public + owner), optional expected reopen date.
 *   REOPEN             TEMPORARILY_CLOSED -> OPEN       reason optional.
 *
 * PERMANENTLY_CLOSED stays an OWNER-only, one-way decision (gymService.setOperationalStatus) and is not offered here.
 * No owner notification: user-service's NotificationEventType has no value for it yet (needs a user-service enum migration).
 */
export const GYM_LIFECYCLE_ACTIONS = ['SUSPEND', 'LIFT_SUSPENSION', 'CLOSE_TEMPORARILY', 'REOPEN'] as const;
export type GymLifecycleAction = (typeof GYM_LIFECYCLE_ACTIONS)[number];

function fail(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export interface GymLifecycleInput {
  action: GymLifecycleAction;
  reason?: string;
  expectedReopenAt?: Date | null;
}

export const gymAdminLifecycleService = {
  async apply(gymId: string, adminId: string, input: GymLifecycleInput) {
    const reason = (input.reason ?? '').trim();
    const needsReason = input.action === 'SUSPEND' || input.action === 'CLOSE_TEMPORARILY';
    if (needsReason && reason.length < MIN_ADMIN_REASON_LENGTH) {
      throw fail(400, 'REASON_REQUIRED', `Cần nhập lý do (tối thiểu ${MIN_ADMIN_REASON_LENGTH} ký tự)`);
    }
    if (reason.length > 500) throw fail(400, 'REASON_TOO_LONG', 'Lý do không được vượt quá 500 ký tự');

    const gym = await gymRepository.findById(gymId);
    if (!gym) throw fail(404, 'GYM_NOT_FOUND', 'Không tìm thấy chi nhánh');
    if (gym.operationalStatus === 'PERMANENTLY_CLOSED') {
      throw fail(409, 'GYM_PERMANENTLY_CLOSED', 'Chi nhánh đã đóng cửa vĩnh viễn, không thể đổi trạng thái');
    }

    let updated;
    let metadata: Record<string, unknown>;
    switch (input.action) {
      case 'SUSPEND': {
        if (gym.status !== 'APPROVED') throw fail(409, 'INVALID_TRANSITION', 'Chỉ tạm khoá được chi nhánh đang hoạt động (đã duyệt)');
        updated = await gymRepository.updateStatus(gymId, 'SUSPENDED');
        metadata = { axis: 'MODERATION', from: gym.status, to: 'SUSPENDED' };
        break;
      }
      case 'LIFT_SUSPENSION': {
        if (gym.status !== 'SUSPENDED') throw fail(409, 'INVALID_TRANSITION', 'Chi nhánh này không đang bị tạm khoá');
        updated = await gymRepository.updateStatus(gymId, 'APPROVED');
        metadata = { axis: 'MODERATION', from: 'SUSPENDED', to: 'APPROVED' };
        break;
      }
      case 'CLOSE_TEMPORARILY': {
        if (gym.status !== 'APPROVED' && gym.status !== 'SUSPENDED') {
          throw fail(409, 'INVALID_TRANSITION', 'Chỉ tạm đóng cửa được chi nhánh đã từng được duyệt');
        }
        if (gym.operationalStatus !== 'OPEN') throw fail(409, 'INVALID_TRANSITION', 'Chi nhánh đã đang tạm đóng cửa');
        const reopenAt = input.expectedReopenAt ?? null;
        if (reopenAt && reopenAt.getTime() <= Date.now()) {
          throw fail(400, 'REOPEN_DATE_IN_PAST', 'Ngày dự kiến mở cửa lại phải ở tương lai');
        }
        updated = await gymRepository.setOperationalStatus(gymId, 'TEMPORARILY_CLOSED', {
          closureReason: reason,
          closedAt: new Date(),
          closedBy: adminId,
          expectedReopenAt: reopenAt,
        });
        metadata = { axis: 'OPERATIONAL', from: 'OPEN', to: 'TEMPORARILY_CLOSED', expectedReopenAt: reopenAt };
        break;
      }
      case 'REOPEN': {
        if (gym.operationalStatus !== 'TEMPORARILY_CLOSED') throw fail(409, 'INVALID_TRANSITION', 'Chỉ mở lại được chi nhánh đang tạm đóng cửa');
        updated = await gymRepository.setOperationalStatus(gymId, 'OPEN', { closureReason: null, closedBy: null, expectedReopenAt: null, reopenedAt: new Date() });
        metadata = { axis: 'OPERATIONAL', from: 'TEMPORARILY_CLOSED', to: 'OPEN' };
        break;
      }
      default:
        throw fail(400, 'INVALID_ACTION', 'Thao tác không hợp lệ');
    }

    // Best effort like every other admin audit row (partnerAuditService.record never throws).
    const partnerId = await resolvePartnerId(prisma, gym);
    if (partnerId) {
      await partnerAuditService.record({
        partnerId,
        actorUserId: adminId,
        action: 'GYM_ADMIN_STATUS_CHANGED',
        reason: reason || null,
        metadata: { gymId, lifecycleAction: input.action, ...metadata },
      });
    } else {
      logger.warn({ gymId, action: input.action }, '[Gym] owner has no partner record - PartnerAuditLog row skipped');
    }
    return updated;
  },
};
