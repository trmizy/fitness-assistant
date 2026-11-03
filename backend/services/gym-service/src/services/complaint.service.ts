import { logger } from '@gym-coach/shared';
import { complaintRepository } from '../repositories/complaint.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { gymRepository } from '../repositories/gym.repository';
import { partnerRepository } from '../repositories/partner.repository';
import { userClient } from '../clients/user.client';
import { prisma } from '../repositories/prisma';
import { assertRealAdmin } from './complaint-case/case.service';
import { COMPLAINT_ISSUE_TYPES, COMPLAINT_SOURCES, COMPLAINT_STATUSES } from './complaint-case/schemas';
import type { ComplaintSource, ComplaintIssueType, ComplaintStatus } from '../generated/prisma';

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** F7 (Dispute V2.1 contract): enum values are checked here and answer 400, never a Prisma 500. */
function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw err(`${what} không hợp lệ (chấp nhận: ${allowed.join(', ')})`, 400, 'INVALID_INPUT');
  }
  return value as T;
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
    assertOneOf(data.issueType, COMPLAINT_ISSUE_TYPES, 'Nhóm vấn đề');
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
    assertOneOf(data.source, COMPLAINT_SOURCES, 'Nguồn khiếu nại');
    assertOneOf(data.issueType, COMPLAINT_ISSUE_TYPES, 'Nhóm vấn đề');
    if (!data.description?.trim()) throw err('Vui lòng mô tả vấn đề', 400);
    if (data.photoTokens && data.photoTokens.length > MAX_PHOTOS) {
      throw err(`Tối đa ${MAX_PHOTOS} ảnh`, 400);
    }
    if (data.assignedAdminId) await assertRealAdmin(data.assignedAdminId);

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
    if (status !== undefined) assertOneOf(status, COMPLAINT_STATUSES, 'Trạng thái');
    return complaintRepository.listAll(status);
  },

  /**
   * R-18: the H1 queue with OPTIONAL paging. No limit / offset = the old behaviour (everything, same array). `limit` 1..200 and `offset` >= 0 are validated
   * (400 INVALID_INPUT). The array stays in `data`; the total comes beside it, so an old client that ignores `meta` keeps working.
   */
  async queuePaged(status: ComplaintStatus | undefined, rawLimit: unknown, rawOffset: unknown) {
    if (status !== undefined) assertOneOf(status, COMPLAINT_STATUSES, 'Trạng thái');
    const num = (v: unknown, name: string, min: number, max: number): number | undefined => {
      if (v === undefined) return undefined;
      const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
      if (!Number.isInteger(n) || n < min || n > max) throw err(`${name} phải là số nguyên từ ${min} đến ${max}`, 400, 'INVALID_INPUT');
      return n;
    };
    const limit = num(rawLimit, 'limit', 1, 200);
    const offset = num(rawOffset, 'offset', 0, 1_000_000);
    const [items, total] = await Promise.all([complaintRepository.listAll(status, { limit, offset }), complaintRepository.count(status)]);
    return { items, meta: { total, limit: limit ?? null, offset: offset ?? 0 } };
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
    assertOneOf(data.status, COMPLAINT_STATUSES, 'Trạng thái');
    const complaint = await this.getById(id);
    if (complaint.status === 'RESOLVED') throw err('Khiếu nại này đã được xử lý xong', 409);
    // Dispute V2.1 Slice 3: once a complaint has a Case, it can only be RESOLVED through the Case (four eyes + executor), never by this direct route.
    // A case that was REJECTED at intake (not accepted) hands the complaint back to this old flow.
    if (data.status === 'RESOLVED' && (await prisma.gymComplaintCase.findFirst({ where: { complaintId: id, status: { not: 'REJECTED_INTAKE' } }, select: { id: true } }))) {
      throw err('Khiếu nại này đang có hồ sơ xử lý nên chỉ được kết thúc qua hồ sơ', 409, 'CASE_REQUIRED');
    }

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

  async assignAdmin(id: string, assignedAdminId: string | null) {
    if (assignedAdminId !== null && (typeof assignedAdminId !== 'string' || !assignedAdminId.trim())) throw err('assignedAdminId không hợp lệ', 400, 'INVALID_INPUT');
    await this.getById(id);
    if (assignedAdminId !== null) await assertRealAdmin(assignedAdminId);
    return complaintRepository.update(id, { assignedAdminId });
  },
};
