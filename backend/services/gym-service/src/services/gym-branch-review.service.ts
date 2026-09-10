import { gymBranchReviewRepository } from '../repositories/gym-branch-review.repository';
import { gymRepository } from '../repositories/gym.repository';
import { gymService } from './gym.service';
import { userClient } from '../clients/user.client';
import type { BranchReviewCategory } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const ALL_CATEGORIES: BranchReviewCategory[] = ['BASIC_INFO', 'LOCATION', 'OPENING_HOURS', 'FACILITIES', 'PHOTOS', 'VERIFICATION', 'OTHER'];

const CATEGORY_LABEL: Record<BranchReviewCategory, string> = {
  BASIC_INFO: 'Thông tin cơ bản',
  LOCATION: 'Địa điểm',
  OPENING_HOURS: 'Giờ hoạt động',
  FACILITIES: 'Tiện ích & Dịch vụ',
  PHOTOS: 'Hình ảnh',
  VERIFICATION: 'Xác minh',
  OTHER: 'Khác',
};

const TOTAL_STEPS = 7;

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's first-time
 * wizard submission. Distinct from gymService.requestChanges (name/address only, for an
 * ALREADY-APPROVED branch's later rename) — see GymBranchReviewIssue's own schema doc
 * comment for the full reasoning.
 */
export const gymBranchReviewService = {
  /**
   * Admin action: only valid while the branch sits in PENDING_REVIEW (a first-time
   * submission awaiting a decision — the same three-way choice as before, Approve/Reject/
   * Request Changes, just richer than the old blunt setStatus('REJECTED') for the middle
   * option). Sends the branch back to DRAFT so the owner can use the SAME wizard that
   * collected all 7 steps' data to fix whatever was flagged — GymManagePage.tsx has no
   * equivalent editors for opening hours/facilities/photos/verification yet (that's Phase
   * 5's post-approval workspace), so the wizard is the only place this can actually be
   * fixed today. wizardStep is set to the max (7) rather than reset to 1 — every step was
   * already reachable once (the owner already submitted), re-locking them would force
   * re-clicking through unrelated steps just to reach a flagged one.
   */
  async requestChanges(gymId: string, adminId: string, issues: { category: BranchReviewCategory; message: string }[]) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.status !== 'PENDING_REVIEW') {
      throw err('Chỉ có thể yêu cầu chỉnh sửa khi hồ sơ đang chờ duyệt lần đầu', 409);
    }
    if (!Array.isArray(issues) || issues.length === 0) {
      throw err('Cần ít nhất một vấn đề cần chỉnh sửa', 400);
    }
    for (const issue of issues) {
      if (!ALL_CATEGORIES.includes(issue.category)) throw err(`Hạng mục không hợp lệ: ${issue.category}`, 400);
      if (!issue.message?.trim()) throw err('Mỗi vấn đề cần có nội dung mô tả', 400);
    }

    await gymBranchReviewRepository.createMany(
      gymId,
      adminId,
      issues.map((i) => ({ category: i.category, message: i.message.trim() })),
    );
    const updated = await gymRepository.update(gymId, { status: 'DRAFT', wizardStep: TOTAL_STEPS });

    const summary = issues.map((i) => `${CATEGORY_LABEL[i.category]}: ${i.message.trim()}`).join('; ');
    await userClient.notifyUser({
      userId: gym.ownerId,
      text: `Chi nhánh "${gym.name}" cần chỉnh sửa trước khi được duyệt — ${summary}`,
      eventType: 'GYM_BRANCH_CHANGES_REQUESTED',
      entityType: 'GYM_BRANCH',
      entityId: gymId,
    });

    return updated;
  },

  async listOpenForOwner(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return gymBranchReviewRepository.listOpen(gymId);
  },

  listAllForAdmin(gymId: string) {
    return gymBranchReviewRepository.listAll(gymId);
  },
};
