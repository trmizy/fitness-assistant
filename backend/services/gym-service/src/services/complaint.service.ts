import { logger } from '@gym-coach/shared';
import { complaintRepository } from '../repositories/complaint.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { gymRepository } from '../repositories/gym.repository';
import { partnerRepository } from '../repositories/partner.repository';
import { userClient } from '../clients/user.client';
import type { ComplaintSource, ComplaintIssueType, ComplaintStatus } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** GYM_MANAGEMENT master spec, Phase 5 — "chỉ hội viên có gói còn hiệu lực hoặc vừa hết
 * hạn trong 30 ngày" (confirmed with the user). */
const ELIGIBILITY_WINDOW_DAYS = 30;
const MAX_PHOTOS = 5;

async function resolvePartnerId(ownerId: string): Promise<string | null> {
  const account = await partnerRepository.findAccountByUserId(ownerId);
  return account?.partnerId ?? null;
}

export const complaintService = {
  /**
   * The client's own "Báo cáo vấn đề" submission — always source MEMBER_REPORT, always
   * carries a reporterUserId (see schema.prisma's doc comment: "no anonymous complaints").
   */
  async submitAsMember(
    gymId: string,
    clientId: string,
    data: { issueType: ComplaintIssueType; description: string; photoTokens?: string[] },
  ) {
    if (!data.description?.trim()) throw err('Vui lòng mô tả vấn đề', 400);
    if (data.photoTokens && data.photoTokens.length > MAX_PHOTOS) {
      throw err(`Tối đa ${MAX_PHOTOS} ảnh`, 400);
    }

    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Không tìm thấy phòng gym', 404);

    const eligible = await membershipRepository.hasRecentOrActiveMembership(clientId, gymId, ELIGIBILITY_WINDOW_DAYS);
    if (!eligible) {
      throw err('Chỉ hội viên đang có gói hoặc vừa hết hạn trong 30 ngày mới báo cáo được vấn đề tại chi nhánh này', 403);
    }

    const partnerId = await resolvePartnerId(gym.ownerId);

    return complaintRepository.create({
      gymId,
      partnerId,
      source: 'MEMBER_REPORT',
      issueType: data.issueType,
      reporterUserId: clientId,
      description: data.description.trim(),
      photoTokens: data.photoTokens ?? [],
    });
  },

  /**
   * Admin's own manual entry — for anything they learned through another channel (phone
   * call, email, a partner disclosing it themselves). `source` is the admin's own
   * categorization of how they learned of it; never 'MEMBER_REPORT' here in practice (that
   * value is reserved for the client's own endpoint) but not technically blocked, since an
   * admin transcribing a member's phone call IS a member report by origin.
   */
  async createByAdmin(
    adminId: string,
    data: {
      gymId: string;
      source: ComplaintSource;
      issueType: ComplaintIssueType;
      description: string;
      photoTokens?: string[];
      reporterUserId?: string | null;
      assignedAdminId?: string | null;
    },
  ) {
    if (!data.description?.trim()) throw err('Vui lòng mô tả vấn đề', 400);
    if (data.photoTokens && data.photoTokens.length > MAX_PHOTOS) {
      throw err(`Tối đa ${MAX_PHOTOS} ảnh`, 400);
    }

    const gym = await gymRepository.findById(data.gymId);
    if (!gym) throw err('Không tìm thấy phòng gym', 404);

    const partnerId = await resolvePartnerId(gym.ownerId);

    logger.info(`[Complaint] ${adminId} ghi nhận khiếu nại thủ công (${data.source}) cho gym ${data.gymId}`);
    return complaintRepository.create({
      gymId: data.gymId,
      partnerId,
      source: data.source,
      issueType: data.issueType,
      reporterUserId: data.reporterUserId ?? null,
      description: data.description.trim(),
      photoTokens: data.photoTokens ?? [],
      assignedAdminId: data.assignedAdminId ?? null,
    });
  },

  queue(status?: ComplaintStatus) {
    return complaintRepository.listAll(status);
  },

  listForPartner(partnerId: string) {
    return complaintRepository.listForPartner(partnerId);
  },

  listMine(reporterUserId: string) {
    return complaintRepository.listForReporter(reporterUserId);
  },

  async getById(id: string) {
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw err('Không tìm thấy khiếu nại', 404);
    return complaint;
  },

  /**
   * The only status-changing action after creation, besides assignment. RESOLVED requires
   * an `adminResponse` — "khách... xem phản hồi của admin" only works if there's always one
   * to show once resolved. Notifies the reporter (if any) on RESOLVED — best-effort, never
   * blocks the resolution itself if the notification call fails (see userClient.notifyUser).
   */
  async updateStatus(id: string, actorAdminId: string, data: { status: ComplaintStatus; adminResponse?: string }) {
    const complaint = await this.getById(id);
    if (complaint.status === 'RESOLVED') throw err('Khiếu nại này đã được xử lý xong', 409);

    if (data.status === 'RESOLVED' && !data.adminResponse?.trim()) {
      throw err('Cần ghi phản hồi khi đánh dấu đã xử lý xong', 400);
    }

    const updated = await complaintRepository.update(id, {
      status: data.status,
      adminResponse: data.adminResponse?.trim() || complaint.adminResponse,
      ...(data.status === 'RESOLVED' ? { resolvedAt: new Date(), resolvedBy: actorAdminId } : {}),
    });

    if (data.status === 'RESOLVED' && complaint.reporterUserId) {
      await userClient.notifyUser({
        userId: complaint.reporterUserId,
        text: 'Báo cáo vấn đề của bạn đã được xử lý — xem phản hồi từ Gymini.',
        eventType: 'GYM_COMPLAINT_RESOLVED',
        entityType: 'GYM_COMPLAINT',
        entityId: complaint.id,
      });
    }

    return updated;
  },

  assignAdmin(id: string, assignedAdminId: string | null) {
    return complaintRepository.update(id, { assignedAdminId });
  },
};
