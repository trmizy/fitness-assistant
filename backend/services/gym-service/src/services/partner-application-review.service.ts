import type { Request } from 'express';
import { prisma } from '../repositories/prisma';
import type { Prisma, PartnerDocumentType, PartnerReviewCategory } from '../generated/prisma';
import { partnerAuditService } from './partner-audit.service';
import { partnerS3 } from './partner-s3.service';
import { brandLogoUrl, resolvePhotoUrl } from './gym-photo-url';
import { applyGymApprovalTx } from './gym-approval.tx';
import { appError } from './partner-application.service';
import { applicantEmails, sendApplicantMail } from './partner-application.emails';
import {
  computeApproveBlockers,
  computeMissing,
  deriveAccessState,
  REQUIRED_APPLICATION_DOCS,
  type ApproveInput,
  type CompletenessInput,
} from './partner-application.state';

/**
 * Duyệt hồ sơ đối tác tự đăng ký — phía ADMIN (GYM_PARTNER_STATE_MACHINE.md, GYM_PARTNER_SECURITY_MODEL.md §8).
 *
 * Nguyên tắc chung của mọi chuyển trạng thái ở đây:
 *   1. Điều kiện nằm TRONG câu UPDATE (`updateMany … WHERE`) — hai admin bấm cùng lúc chỉ một người
 *      thắng, người kia nhận 409;
 *   2. dòng PartnerAuditLog được ghi TRONG CÙNG transaction — rollback thì không có dòng;
 *   3. email / sao chép ảnh chạy SAU commit, lỗi thì log + thử lại, KHÔNG tuyên bố là atomic.
 *
 * Không có bước nào ở đây tự đặt VERIFIED cho giấy tờ: chấp nhận từng giấy tờ là một hành động riêng
 * của admin (`acceptDocument`) và để lại dấu vết.
 */

type Tx = Prisma.TransactionClient;

async function lockPartner(tx: Tx, partnerId: string) {
  await tx.$queryRaw`SELECT id FROM gym_partners WHERE id = ${partnerId} FOR UPDATE`;
}

async function loadSelfServicePartner(tx: Tx | typeof prisma, partnerId: string) {
  const partner = await tx.gymPartner.findUnique({ where: { id: partnerId } });
  if (!partner) throw appError('Không tìm thấy đối tác', 404, 'NOT_FOUND');
  if (partner.source !== 'SELF_SERVICE') {
    throw appError('Đây không phải hồ sơ đối tác tự đăng ký', 409, 'NOT_SELF_SERVICE');
  }
  return partner;
}

/** Đọc mọi thứ cần để quyết định APPROVE, bằng client truyền vào (toàn cục hoặc của transaction). */
async function gatherApproveInput(db: Tx | typeof prisma, partnerId: string, ownerUserId: string | null): Promise<ApproveInput> {
  const partner = await db.gymPartner.findUniqueOrThrow({ where: { id: partnerId } });
  const [issues, docs, draftCount, nonDraftCount] = await Promise.all([
    db.gymPartnerReviewIssue.count({ where: { partnerId, status: { in: ['OPEN', 'RESUBMITTED'] } } }),
    db.gymPartnerDocument.findMany({ where: { partnerId, docType: { in: [...REQUIRED_APPLICATION_DOCS] } } }),
    ownerUserId ? db.gym.count({ where: { ownerId: ownerUserId, status: 'DRAFT' } }) : Promise.resolve(0),
    ownerUserId ? db.gym.count({ where: { ownerId: ownerUserId, status: { not: 'DRAFT' } } }) : Promise.resolve(0),
  ]);
  const docStatuses: ApproveInput['docStatuses'] = {};
  for (const d of docs) {
    (docStatuses as Record<string, { status: string | null; hasFile: boolean }>)[d.docType] = {
      status: d.status,
      hasFile: Boolean(d.fileKey || d.fileUrl),
    };
  }
  return {
    partnerStatus: partner.status,
    verificationStatus: partner.verificationStatus,
    unresolvedIssueCount: issues,
    docStatuses,
    draftBranchCount: draftCount,
    nonDraftBranchCount: nonDraftCount,
  };
}

async function ownerUserIdOf(db: Tx | typeof prisma, partnerId: string): Promise<string | null> {
  const owner = await db.gymPartnerAccount.findFirst({ where: { partnerId, role: 'OWNER' } });
  return owner?.userId ?? null;
}

export const partnerApplicationReviewService = {
  /** Toàn bộ hồ sơ cho màn duyệt của admin: nội dung + trạng thái từng giấy tờ + issue + điều kiện APPROVE + lịch sử. */
  async getApplication(partnerId: string) {
    const partner = await loadSelfServicePartner(prisma, partnerId);
    const ownerAccount = await prisma.gymPartnerAccount.findFirst({ where: { partnerId, role: 'OWNER' } });
    const ownerUserId = ownerAccount?.userId ?? null;

    const [brand, gyms, docs, issues, audit, approveInput] = await Promise.all([
      partner.brandId ? prisma.gymBrand.findUnique({ where: { id: partner.brandId } }) : null,
      ownerUserId ? prisma.gym.findMany({ where: { ownerId: ownerUserId }, orderBy: { createdAt: 'asc' } }) : [],
      prisma.gymPartnerDocument.findMany({ where: { partnerId } }),
      prisma.gymPartnerReviewIssue.findMany({ where: { partnerId }, orderBy: { createdAt: 'asc' } }),
      partnerAuditService.listForPartner(partnerId, 300),
      gatherApproveInput(prisma, partnerId, ownerUserId),
    ]);

    const gym = gyms[0] ?? null;
    const photos = gym ? await prisma.gymPhoto.findMany({ where: { gymId: gym.id }, orderBy: { sortOrder: 'asc' } }) : [];

    const byType = new Map(docs.map((d) => [d.docType, d]));
    const allTypes = [...REQUIRED_APPLICATION_DOCS, 'TAX_CODE_CERTIFICATE', 'SITE_PHOTOS', 'FIRE_SAFETY_CERTIFICATE'] as const;
    const documents = allTypes.map((docType) => {
      const d = byType.get(docType);
      return {
        docType,
        required: (REQUIRED_APPLICATION_DOCS as readonly string[]).includes(docType),
        status: d?.status ?? 'PENDING',
        hasFile: Boolean(d?.fileKey || d?.fileUrl),
        mimeType: d?.mimeType ?? null,
        sizeBytes: d?.sizeBytes ?? null,
        version: d?.version ?? 1,
        reviewNote: d?.reviewNote ?? null,
        verifiedBy: d?.verifiedBy ?? null,
        verifiedAt: d?.verifiedAt ?? null,
        updatedAt: d?.updatedAt ?? null,
      };
    });

    const docStatuses: CompletenessInput['docStatuses'] = {};
    for (const d of documents) {
      if (d.required) (docStatuses as Record<string, string | null>)[d.docType] = d.status;
    }
    const missing = computeMissing({
      representative: { name: partner.representativeName, phone: ownerAccount?.contactPhone, role: partner.representativeRole },
      brandName: brand?.name,
      businessScale: partner.businessScale,
      branch: gym
        ? {
            name: gym.name,
            phone: gym.phone,
            address: gym.address,
            provinceCode: gym.provinceCode,
            wardCode: gym.wardCode,
            latitude: gym.latitude,
            longitude: gym.longitude,
          }
        : null,
      photoCount: photos.length,
      legalName: partner.legalName,
      contactEmail: partner.contactEmail,
      docStatuses,
      termsAcceptedAt: partner.termsAcceptedAt,
    });

    const blockers = computeApproveBlockers(approveInput);

    return {
      accessState: deriveAccessState({
        isLegacy: false,
        hasAccount: Boolean(ownerAccount),
        accountStatus: ownerAccount?.status ?? null,
        partnerStatus: partner.status,
        verificationStatus: partner.verificationStatus,
        onboardingCompletedAt: ownerAccount?.onboardingCompletedAt ?? null,
      }),
      partner: {
        id: partner.id,
        legalName: partner.legalName,
        contactEmail: partner.contactEmail,
        taxCode: partner.taxCode,
        businessLicenseNo: partner.businessLicenseNo,
        representativeName: partner.representativeName,
        representativeRole: partner.representativeRole,
        businessScale: partner.businessScale,
        status: partner.status,
        verificationStatus: partner.verificationStatus,
        verificationNotes: partner.verificationNotes,
        submittedAt: partner.submittedAt,
        createdAt: partner.createdAt,
        rejectedAt: partner.rejectedAt,
        rejectionReason: partner.rejectionReason,
        termsAcceptedAt: partner.termsAcceptedAt,
      },
      representativePhone: ownerAccount?.contactPhone ?? null,
      brand: brand ? { id: brand.id, name: brand.name, description: brand.description, logoUrl: await brandLogoUrl(brand.logoKey) } : null,
      branch: gym
        ? {
            id: gym.id,
            name: gym.name,
            phone: gym.phone,
            email: gym.email,
            description: gym.description,
            address: gym.address,
            city: gym.city,
            provinceCode: gym.provinceCode,
            wardCode: gym.wardCode,
            latitude: gym.latitude,
            longitude: gym.longitude,
            locationNote: gym.locationNote,
            status: gym.status,
          }
        : null,
      photos: await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          category: p.category,
          isCover: p.isCover,
          sortOrder: p.sortOrder,
          visibility: p.visibility,
          url: await resolvePhotoUrl(p),
        })),
      ),
      documents,
      issues,
      missing,
      approve: { canApprove: blockers.length === 0, blockers },
      history: audit.map((r) => ({
        id: r.id,
        action: r.action,
        at: r.createdAt,
        actorUserId: r.actorUserId,
        reason: r.reason,
        metadata: r.metadata,
      })),
    };
  },

  /** Link xem giấy tờ: presigned GET hạn ngắn, giấy tờ ép tải xuống; MỖI lần xem đều ghi nhật ký. */
  async getDocumentFile(partnerId: string, docType: PartnerDocumentType, adminId: string, req?: Request) {
    await loadSelfServicePartner(prisma, partnerId);
    const doc = await prisma.gymPartnerDocument.findUnique({ where: { partnerId_docType: { partnerId, docType } } });
    if (!doc || !(doc.fileKey || doc.fileUrl)) throw appError('Chưa có tệp nào cho mục này', 404, 'NOT_FOUND');

    await partnerAuditService.record({
      partnerId,
      actorUserId: adminId,
      action: 'DOCUMENT_VIEWED',
      req,
      metadata: { docType, version: doc.version },
    });

    if (!doc.fileKey) return { url: doc.fileUrl as string, expiresInSec: null, mimeType: doc.mimeType };
    const expiresSec = 120;
    // Ảnh mở tại chỗ được; PDF ép tải xuống để trình duyệt không render nội dung không tin cậy.
    const attachment = doc.mimeType === 'application/pdf';
    const url = await partnerS3.presignGet({
      key: doc.fileKey,
      contentType: doc.mimeType ?? undefined,
      attachment,
      expiresSec,
    });
    return { url, expiresInSec: expiresSec, mimeType: doc.mimeType };
  },

  /** Chấp nhận MỘT giấy tờ — hành động có dấu vết, không bao giờ xảy ra ngầm trong approve. */
  async acceptDocument(partnerId: string, docType: PartnerDocumentType, adminId: string, req?: Request) {
    await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const partner = await loadSelfServicePartner(tx, partnerId);
      if (!['IN_REVIEW', 'NEEDS_INFO'].includes(partner.verificationStatus)) {
        throw appError('Chỉ duyệt giấy tờ khi hồ sơ đang được xét duyệt', 409, 'NOT_UNDER_REVIEW');
      }
      const res = await tx.gymPartnerDocument.updateMany({
        where: { partnerId, docType, status: 'RECEIVED', OR: [{ fileKey: { not: null } }, { fileUrl: { not: null } }] },
        data: { status: 'VERIFIED', reviewNote: null, verifiedBy: adminId, verifiedAt: new Date() },
      });
      if (res.count !== 1) {
        throw appError('Giấy tờ này không ở trạng thái chờ duyệt', 409, 'DOCUMENT_NOT_PENDING_REVIEW');
      }
      const doc = await tx.gymPartnerDocument.findUniqueOrThrow({ where: { partnerId_docType: { partnerId, docType } } });
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'DOCUMENT_ACCEPTED',
        req,
        metadata: { docType, version: doc.version },
      });
    });
    return { ok: true };
  },

  /**
   * "Yêu cầu chỉnh sửa": nhiều vấn đề theo mục + các giấy tờ cần cập nhật, trong MỘT transaction →
   * hồ sơ về NEEDS_INFO. Giấy tờ bị yêu cầu chuyển REJECTED (= "Cần cập nhật"); khi ứng viên thay tệp
   * nó tự quay về RECEIVED và vào lại hàng chờ duyệt.
   */
  async requestChanges(
    partnerId: string,
    adminId: string,
    input: { issues: Array<{ category: PartnerReviewCategory; message: string }>; documents: Array<{ docType: PartnerDocumentType; note: string }> },
    req?: Request,
  ) {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const partner = await loadSelfServicePartner(tx, partnerId);
      if (!['IN_REVIEW', 'NEEDS_INFO'].includes(partner.verificationStatus) || partner.status !== 'PROSPECT') {
        throw appError('Chỉ yêu cầu chỉnh sửa khi hồ sơ đang được xét duyệt', 409, 'NOT_UNDER_REVIEW');
      }

      for (const doc of input.documents) {
        const res = await tx.gymPartnerDocument.updateMany({
          where: { partnerId, docType: doc.docType, OR: [{ fileKey: { not: null } }, { fileUrl: { not: null } }] },
          data: { status: 'REJECTED', reviewNote: doc.note, verifiedBy: adminId, verifiedAt: new Date() },
        });
        if (res.count !== 1) {
          throw appError(`Giấy tờ ${doc.docType} chưa có tệp để yêu cầu cập nhật`, 409, 'DOCUMENT_NOT_FOUND');
        }
        await partnerAuditService.recordInTx(tx, {
          partnerId,
          actorUserId: adminId,
          action: 'DOCUMENT_UPDATE_REQUESTED',
          req,
          reason: doc.note,
          metadata: { docType: doc.docType },
        });
      }

      if (input.issues.length > 0) {
        await tx.gymPartnerReviewIssue.createMany({
          data: input.issues.map((i) => ({ partnerId, category: i.category, message: i.message, createdBy: adminId })),
        });
      }

      const summary = [
        ...input.issues.map((i) => `[${i.category}] ${i.message}`),
        ...input.documents.map((d) => `[${d.docType}] ${d.note}`),
      ].join('\n');
      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: { in: ['IN_REVIEW', 'NEEDS_INFO'] } },
        data: { verificationStatus: 'NEEDS_INFO', verificationNotes: summary },
      });
      if (res.count !== 1) throw appError('Trạng thái hồ sơ vừa thay đổi — hãy tải lại', 409, 'STATE_CHANGED');

      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'CHANGES_REQUESTED',
        req,
        metadata: { count: input.issues.length + input.documents.length, issues: input.issues.length, documents: input.documents.length },
      });
      return { email: partner.contactEmail, issues: input.issues.length, documents: input.documents.length };
    });

    void sendApplicantMail(outcome.email, applicantEmails.changesRequested(outcome.issues, outcome.documents));
    return { ok: true, issues: outcome.issues, documents: outcome.documents };
  },

  /** Chỉ ADMIN đóng vấn đề. Nộp lại của ứng viên KHÔNG bao giờ tự đóng. */
  async resolveIssue(partnerId: string, issueId: string, adminId: string, req?: Request) {
    await prisma.$transaction(async (tx) => {
      await loadSelfServicePartner(tx, partnerId);
      const res = await tx.gymPartnerReviewIssue.updateMany({
        where: { id: issueId, partnerId, status: { in: ['OPEN', 'RESUBMITTED'] } },
        data: { status: 'RESOLVED', resolvedBy: adminId, resolvedAt: new Date() },
      });
      if (res.count !== 1) throw appError('Vấn đề này không mở hoặc không thuộc hồ sơ', 409, 'ISSUE_NOT_OPEN');
      const issue = await tx.gymPartnerReviewIssue.findUniqueOrThrow({ where: { id: issueId } });
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'ISSUE_RESOLVED',
        req,
        metadata: { issueId, category: issue.category },
      });
    });
    return { ok: true };
  },

  /** Ứng viên nói "đã sửa" nhưng admin thấy chưa đúng: mở lại kèm lời nhắn, hồ sơ quay về NEEDS_INFO. */
  async reopenIssue(partnerId: string, issueId: string, adminId: string, message: string, req?: Request) {
    const email = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const partner = await loadSelfServicePartner(tx, partnerId);
      const res = await tx.gymPartnerReviewIssue.updateMany({
        where: { id: issueId, partnerId, status: { in: ['RESUBMITTED', 'RESOLVED'] } },
        data: { status: 'OPEN', adminFollowUp: message, resolvedBy: null, resolvedAt: null },
      });
      if (res.count !== 1) throw appError('Không mở lại được vấn đề này', 409, 'ISSUE_NOT_REOPENABLE');
      const back = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: 'IN_REVIEW' },
        data: { verificationStatus: 'NEEDS_INFO' },
      });
      const issue = await tx.gymPartnerReviewIssue.findUniqueOrThrow({ where: { id: issueId } });
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'CHANGES_REQUESTED',
        req,
        reason: message,
        metadata: { issueId, category: issue.category, reopened: true, count: 1, movedToNeedsInfo: back.count === 1 },
      });
      return back.count === 1 ? partner.contactEmail : null;
    });
    if (email) void sendApplicantMail(email, applicantEmails.changesRequested(1, 0));
    return { ok: true };
  },

  /**
   * APPROVE — MỘT `prisma.$transaction` thật: mọi dữ liệu (partner, chi nhánh, thương hiệu, issue,
   * giấy tờ, audit) nằm cùng DB gym-service. Không có commit thứ hai và không gọi auth-service (role
   * của tài khoản đã là GYM_OWNER từ lúc đặt mật khẩu). Sau commit: sao chép ảnh sang vùng công khai
   * (idempotent, chạy lại được) và gửi email — hai việc đó KHÔNG thuộc phần atomic.
   */
  async approve(partnerId: string, adminId: string, req?: Request) {
    const result = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const partner = await loadSelfServicePartner(tx, partnerId);
      const ownerUserId = await ownerUserIdOf(tx, partnerId);

      // Đọc điều kiện TRONG transaction (sau khi khoá dòng) — cùng hàm với nút Approve của màn admin.
      const blockers = computeApproveBlockers(await gatherApproveInput(tx, partnerId, ownerUserId));
      if (blockers.length > 0) {
        throw appError('Chưa đủ điều kiện để phê duyệt', 409, 'APPROVE_BLOCKED', { blockers });
      }

      const gym = await tx.gym.findFirstOrThrow({ where: { ownerId: ownerUserId!, status: 'DRAFT' } });

      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: 'IN_REVIEW' },
        data: {
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          verifiedBy: adminId,
          verificationNotes: null,
        },
      });
      if (res.count !== 1) throw appError('Hồ sơ vừa được xử lý bởi người khác', 409, 'ALREADY_PROCESSED');

      await applyGymApprovalTx(tx, gym.id);

      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'APPLICATION_APPROVED',
        req,
        metadata: { gymId: gym.id },
      });
      return { gymId: gym.id, email: partner.contactEmail };
    });

    void sendApplicantMail(result.email, applicantEmails.approved());
    return { ok: true, gymId: result.gymId };
  },

  async reject(partnerId: string, adminId: string, reason: string, adminNote?: string, req?: Request) {
    const email = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const partner = await loadSelfServicePartner(tx, partnerId);
      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: { in: ['NOT_VERIFIED', 'IN_REVIEW', 'NEEDS_INFO'] } },
        data: {
          verificationStatus: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: reason,
          verificationNotes: adminNote?.trim() || null,
          verifiedAt: null,
          verifiedBy: null,
        },
      });
      if (res.count !== 1) throw appError('Hồ sơ không ở trạng thái có thể từ chối', 409, 'NOT_REJECTABLE');
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'APPLICATION_REJECTED',
        req,
        reason,
      });
      return partner.contactEmail;
    });
    void sendApplicantMail(email, applicantEmails.rejected(reason));
    return { ok: true };
  },

  /** REJECTED là cuối với ứng viên; chỉ admin mở lại được. Mở lại → NOT_VERIFIED, ứng viên sửa và nộp lại. */
  async reopen(partnerId: string, adminId: string, req?: Request) {
    await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      await loadSelfServicePartner(tx, partnerId);
      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: 'REJECTED' },
        data: {
          verificationStatus: 'NOT_VERIFIED',
          rejectedAt: null,
          rejectionReason: null,
          verificationNotes: null,
          verifiedAt: null,
          verifiedBy: null,
          submittedAt: null,
        },
      });
      if (res.count !== 1) throw appError('Chỉ mở lại được hồ sơ đã bị từ chối', 409, 'NOT_REOPENABLE');
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId: adminId,
        action: 'APPLICATION_REOPENED',
        req,
      });
    });
    return { ok: true };
  },

  /** Hàng đợi cho màn "Duyệt hồ sơ đối tác" + số đếm cho thẻ "N hồ sơ chờ duyệt". */
  async listApplications(filter: { verificationStatus?: 'NOT_VERIFIED' | 'IN_REVIEW' | 'NEEDS_INFO' | 'REJECTED' | 'VERIFIED' } = {}) {
    const where: Prisma.GymPartnerWhereInput = { source: 'SELF_SERVICE' };
    if (filter.verificationStatus) where.verificationStatus = filter.verificationStatus;
    const [rows, counts] = await Promise.all([
      prisma.gymPartner.findMany({
        where,
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        include: { accounts: { where: { role: 'OWNER' }, take: 1 } },
      }),
      prisma.gymPartner.groupBy({
        by: ['verificationStatus'],
        where: { source: 'SELF_SERVICE' },
        _count: { _all: true },
      }),
    ]);

    const brandIds = rows.map((r) => r.brandId).filter((v): v is string => Boolean(v));
    const ownerIds = rows.map((r) => r.accounts[0]?.userId).filter((v): v is string => Boolean(v));
    const [brands, gyms] = await Promise.all([
      brandIds.length ? prisma.gymBrand.findMany({ where: { id: { in: brandIds } } }) : [],
      ownerIds.length ? prisma.gym.findMany({ where: { ownerId: { in: ownerIds }, status: 'DRAFT' } }) : [],
    ]);
    const brandById = new Map(brands.map((b) => [b.id, b]));
    const gymByOwner = new Map(gyms.map((g) => [g.ownerId, g]));

    return {
      items: rows.map((p) => ({
        id: p.id,
        contactEmail: p.contactEmail,
        applicantName: p.representativeName,
        legalName: p.legalName === p.contactEmail ? null : p.legalName,
        brandName: p.brandId ? (brandById.get(p.brandId)?.name ?? null) : null,
        firstBranchName: (() => {
          const g = gymByOwner.get(p.accounts[0]?.userId ?? '');
          return g && g.name !== 'Chi nhánh mới' ? g.name : null;
        })(),
        businessScale: p.businessScale,
        submittedAt: p.submittedAt,
        createdAt: p.createdAt,
        status: p.status,
        verificationStatus: p.verificationStatus,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.verificationStatus, c._count._all])),
    };
  },
};
