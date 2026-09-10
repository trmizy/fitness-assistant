import { diligenceRepository } from '../repositories/diligence.repository';
import { partnerRepository } from '../repositories/partner.repository';
import { gymRepository } from '../repositories/gym.repository';
import { brandRepository } from '../repositories/brand.repository';
import { prisma } from '../repositories/prisma';
import type { PartnerDocumentType, PartnerDocumentStatus, PartnerContactChannel, PartnerVerificationStatus } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** Phase 4 mục 4.1 — danh sách giấy tờ cần thu thập, 🔴 bắt buộc / 🟡 tuỳ chọn. */
const REQUIRED_DOC_TYPES: PartnerDocumentType[] = ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF'];
const OPTIONAL_DOC_TYPES: PartnerDocumentType[] = ['TAX_CODE_CERTIFICATE', 'SITE_PHOTOS', 'FIRE_SAFETY_CERTIFICATE'];
const ALL_DOC_TYPES = [...REQUIRED_DOC_TYPES, ...OPTIONAL_DOC_TYPES];

export const partnerDiligenceService = {
  /**
   * Luôn trả đủ 6 dòng (kể cả chưa từng đụng tới) — admin nhìn một lần biết còn thiếu gì,
   * không phải suy luận từ việc "dòng không tồn tại nghĩa là chưa nộp".
   */
  async listDocuments(partnerId: string) {
    const existing = await diligenceRepository.listDocuments(partnerId);
    const byType = new Map(existing.map((d) => [d.docType, d]));
    return ALL_DOC_TYPES.map(
      (docType) =>
        byType.get(docType) ?? {
          id: null,
          partnerId,
          docType,
          required: REQUIRED_DOC_TYPES.includes(docType),
          fileUrl: null,
          status: 'PENDING' as PartnerDocumentStatus,
          verifiedBy: null,
          verifiedAt: null,
          expiresAt: null,
        },
    );
  },

  async upsertDocument(partnerId: string, docType: PartnerDocumentType, fileUrl: string) {
    if (!ALL_DOC_TYPES.includes(docType)) throw err('Loại giấy tờ không hợp lệ', 400);
    if (!fileUrl?.trim()) throw err('fileUrl là bắt buộc', 400);
    return diligenceRepository.upsertDocument(partnerId, docType, {
      fileUrl: fileUrl.trim(),
      required: REQUIRED_DOC_TYPES.includes(docType),
      status: 'RECEIVED',
    });
  },

  async verifyDocument(
    partnerId: string,
    docType: PartnerDocumentType,
    verifiedBy: string,
    decision: 'VERIFIED' | 'REJECTED',
    expiresAt?: Date | null,
  ) {
    const doc = await diligenceRepository.findDocument(partnerId, docType);
    if (!doc || !doc.fileUrl) throw err('Chưa có tệp nào được nộp cho mục này', 409);
    return diligenceRepository.verifyDocument(partnerId, docType, { status: decision, verifiedBy, expiresAt });
  },

  listContactLog(partnerId: string) {
    return diligenceRepository.listContactLogs(partnerId);
  },

  async addContactLog(partnerId: string, data: { channel: PartnerContactChannel; note: string; occurredAt?: Date; createdBy: string }) {
    if (!data.note?.trim()) throw err('Nội dung trao đổi là bắt buộc', 400);
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    return diligenceRepository.addContactLog({ ...data, partnerId, note: data.note.trim() });
  },

  /** "Điều khoản đã chốt" trước khi cấp tài khoản — ghi trước, không phải giấy tờ. */
  async recordNegotiatedTerms(
    partnerId: string,
    data: { commissionRateOverride?: number | null; expectedBranchCount?: number | null; negotiationNotes?: string | null },
  ) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    return partnerRepository.updatePartner(partnerId, data as any);
  },

  /**
   * Từ chối — mở lại được sau, KHÔNG thêm status mới cho GymPartnerStatus (xem doc comment ở
   * schema.prisma). Đồng bộ luôn verificationStatus = REJECTED (GYM_MANAGEMENT master spec
   * §60) — hai cơ chế mô tả cùng một sự kiện, không được lệch nhau.
   */
  async reject(partnerId: string, reason: string, actorAdminId?: string) {
    if (!reason?.trim()) throw err('Lý do từ chối là bắt buộc', 400);
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status !== 'PROSPECT') throw err('Chỉ từ chối được hồ sơ đang ở dạng tiềm năng (PROSPECT)', 409);
    return partnerRepository.updatePartner(partnerId, {
      rejectedAt: new Date(),
      rejectionReason: reason.trim(),
      verificationStatus: 'REJECTED',
      verificationNotes: reason.trim(),
      verifiedAt: new Date(),
      verifiedBy: actorAdminId ?? null,
    });
  },

  async reopen(partnerId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (!partner.rejectedAt) throw err('Hồ sơ này chưa từng bị từ chối', 409);
    return partnerRepository.updatePartner(partnerId, {
      rejectedAt: null,
      rejectionReason: null,
      // Về lại vạch xuất phát của trục thẩm định — "mở lại" nghĩa là xem xét lại từ đầu,
      // không phải coi như chưa từng bị từ chối.
      verificationStatus: 'NOT_VERIFIED',
      verificationNotes: null,
      verifiedAt: null,
      verifiedBy: null,
    });
  },

  /**
   * GYM_MANAGEMENT master spec §60 — chuyển trục thẩm định độc lập với `reject`/`reopen` ở
   * trên (những hàm đó chỉ dùng khi TỪ CHỐI hẳn hồ sơ PROSPECT). Dùng hàm này cho ba bước còn
   * lại của quy trình: bắt đầu xem (IN_REVIEW), yêu cầu bổ sung (NEEDS_INFO, bắt buộc note),
   * và xác nhận đạt (VERIFIED) — bước bắt buộc phải xong TRƯỚC khi cấp tài khoản OWNER
   * (partnerService.provisionOwnerAccount kiểm tra đúng giá trị này).
   */
  async setVerificationStatus(
    partnerId: string,
    target: PartnerVerificationStatus,
    actorAdminId: string,
    notes?: string,
  ) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (target === 'REJECTED') {
      // Giữ đúng MỘT đường để từ chối — dùng reject() ở trên, để rejectedAt/rejectionReason
      // và verificationStatus không bao giờ lệch nhau.
      throw err('Dùng hành động "Từ chối" thay vì đặt trực tiếp REJECTED', 400);
    }
    if (target === 'NEEDS_INFO' && !notes?.trim()) {
      throw err('Cần ghi rõ cần bổ sung gì khi yêu cầu bổ sung hồ sơ', 400);
    }
    const isDecision = target === 'VERIFIED';
    return partnerRepository.updatePartner(partnerId, {
      verificationStatus: target,
      verificationNotes: notes?.trim() || null,
      verifiedAt: isDecision ? new Date() : null,
      verifiedBy: isDecision ? actorAdminId : null,
    });
  },

  /** Thuần hiển thị/lọc "việc của ai" — không phải quyền hạn (xem doc comment ở schema.prisma). */
  async assignAdmin(partnerId: string, assignedAdminId: string | null) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    return partnerRepository.updatePartner(partnerId, { assignedAdminId });
  },

  // ── PartnerInternalNote — chỉ admin đọc được, KHÔNG route nào của owner.routes.ts lộ ra. ──
  listInternalNotes(partnerId: string) {
    return diligenceRepository.listInternalNotes(partnerId);
  },

  async addInternalNote(partnerId: string, authorAdminId: string, text: string) {
    if (!text?.trim()) throw err('Nội dung ghi chú là bắt buộc', 400);
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    return diligenceRepository.addInternalNote({ partnerId, authorAdminId, text: text.trim() });
  },

  /**
   * Phase 4 mục 4.2 — hàng đợi việc cần làm. Màn hình đầu tiên admin thấy: không phải bảng
   * danh sách, mà là "còn bao nhiêu việc, mỗi việc mở ra là một hàng đợi".
   */
  async queue() {
    const [pendingProspects, pendingGyms, pendingBrandRenames, invitedTooLong, expiringDocs, pendingVerification, pendingBranchChanges] =
      await Promise.all([
        prisma.gymPartner.count({ where: { status: 'PROSPECT', rejectedAt: null } }),
        gymRepository.findAllForAdmin('PENDING_REVIEW').then((r) => r.length),
        brandRepository.findAllForAdmin().then((rows) => rows.filter((b) => b.pendingName).length),
        prisma.partnerInvitation.findMany({
          where: {
            status: 'PENDING',
            role: 'OWNER',
            createdAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            partner: { status: 'INVITED' },
          },
          select: { partnerId: true },
          distinct: ['partnerId'],
        }).then((r) => r.length),
        diligenceRepository.findExpiringSoon(30).then((r) => r.length),
        // GYM_MANAGEMENT master spec §60 — hồ sơ admin đang chủ động xử lý (đã bắt đầu xem
        // hoặc đang chờ đối tác bổ sung), khác pendingProspects (chưa ai đụng tới).
        prisma.gymPartner.count({ where: { verificationStatus: { in: ['IN_REVIEW', 'NEEDS_INFO'] } } }),
        // §62 — chi nhánh đã bị "Yêu cầu chỉnh sửa", đang chờ chủ gym sửa lại và nộp lại.
        prisma.gym.count({ where: { changesRequestedAt: { not: null } } }),
      ]);

    return {
      pendingProspects,
      pendingGyms,
      pendingBrandRenames,
      invitedTooLong,
      expiringDocs,
      pendingVerification,
      pendingBranchChanges,
      total:
        pendingProspects + pendingGyms + pendingBrandRenames + invitedTooLong + expiringDocs + pendingVerification + pendingBranchChanges,
    };
  },

  /**
   * GYM_MANAGEMENT master spec §61 — the Admin Gym Management overview dashboard's KPI row.
   * Deliberately scoped to gym/partner-domain counts only (not platform-wide revenue —
   * that already has its own Finance section elsewhere in the admin nav; mixing the two
   * would blur the IA boundary the spec is explicit about). `needsAttention` reuses `queue()`
   * rather than duplicating its counting logic.
   */
  async overviewStats() {
    const [
      totalPartners,
      activePartners,
      suspendedPartners,
      terminatedPartners,
      totalBranches,
      pendingBranches,
      temporarilyClosedBranches,
      needsAttention,
    ] = await Promise.all([
      prisma.gymPartner.count(),
      prisma.gymPartner.count({ where: { status: 'ACTIVE' } }),
      prisma.gymPartner.count({ where: { status: 'SUSPENDED' } }),
      prisma.gymPartner.count({ where: { status: 'TERMINATED' } }),
      prisma.gym.count({ where: { status: 'APPROVED' } }),
      prisma.gym.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.gym.count({ where: { operationalStatus: 'TEMPORARILY_CLOSED' } }),
      this.queue(),
    ]);

    return {
      totalPartners,
      activePartners,
      suspendedPartners,
      terminatedPartners,
      totalBranches,
      pendingBranches,
      temporarilyClosedBranches,
      needsAttention,
    };
  },
};
