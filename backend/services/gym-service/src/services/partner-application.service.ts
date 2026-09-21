import type { Request } from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { partnerRepository } from '../repositories/partner.repository';
import type { Prisma, PartnerRepresentativeRole, PartnerBusinessScale } from '../generated/prisma';
import type { PartnerContext } from './partner.service';
import { partnerService } from './partner.service';
import { brandService } from './brand.service';
import { onboardingService } from './onboarding.service';
import { partnerAuditService } from './partner-audit.service';
import { partnerS3 } from './partner-s3.service';
import { brandLogoUrl } from './gym-photo-url';
import {
  APPLICATION_MIN_PHOTOS,
  computeMissing,
  deriveAccessState,
  isEditableState,
  REQUIRED_APPLICATION_DOCS,
  APPLICATION_DOC_TYPES,
  type AccessState,
  type CompletenessInput,
} from './partner-application.state';
import { applicantEmails, sendApplicantMail } from './partner-application.emails';

/**
 * Hồ sơ đối tác tự đăng ký, phía ỨNG VIÊN — GYM_PARTNER_SELF_ONBOARDING_SPEC.md.
 *
 * Mọi hàm suy `partnerId`/`ownerId` từ danh tính đã xác thực (PartnerContext), KHÔNG nhận từ
 * body/URL. Ứng viên luôn có một GymPartnerAccount ACTIVE (do bootstrap tạo) — nhưng điều đó
 * KHÔNG cho họ quyền vận hành: quyền vận hành do `evaluateOperationalAccess` quyết định.
 *
 * Chuyển trạng thái nào cũng: (1) điều kiện nằm TRONG câu UPDATE (updateMany … WHERE) nên bấm đúp /
 * hai tab không tạo hai lần chuyển; (2) ghi PartnerAuditLog trong CÙNG transaction; (3) email chạy
 * SAU commit, lỗi gửi thì log chứ không rollback.
 */

export function appError(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

type Tx = Prisma.TransactionClient;

/** Chỉ các hành động này (và chỉ vài trường an toàn) được hiện cho ứng viên trên timeline. */
const TIMELINE_ACTIONS = [
  'APPLICATION_SUBMITTED',
  'CHANGES_REQUESTED',
  'ISSUE_MARKED_UPDATED',
  'APPLICATION_RESUBMITTED',
  'ISSUE_RESOLVED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REPLACED',
  'DOCUMENT_ACCEPTED',
  'DOCUMENT_UPDATE_REQUESTED',
  'APPLICATION_APPROVED',
  'APPLICATION_REJECTED',
  'APPLICATION_REOPENED',
] as const;

function stateOf(ctx: PartnerContext): AccessState {
  return deriveAccessState({
    isLegacy: ctx.isLegacy,
    hasAccount: Boolean(ctx.accountId),
    accountStatus: ctx.accountStatus,
    partnerStatus: ctx.partnerStatus,
    verificationStatus: ctx.verificationStatus,
    onboardingCompletedAt: ctx.onboardingCompletedAt,
  });
}

/** Chỉ OWNER của một hồ sơ tự đăng ký thật mới dùng được phần còn lại của API này. */
function requireApplicantOwner(ctx: PartnerContext): { partnerId: string; accountId: string; ownerId: string } {
  if (!ctx.partnerId || !ctx.accountId) {
    throw appError('Chưa có hồ sơ đối tác — hãy khởi tạo hồ sơ trước', 403, 'NO_PARTNER_ACCOUNT');
  }
  if (ctx.role !== 'OWNER') {
    throw appError('Chỉ chủ sở hữu mới thao tác được trên hồ sơ đối tác', 403, 'OWNER_ROLE_REQUIRED');
  }
  return { partnerId: ctx.partnerId, accountId: ctx.accountId, ownerId: ctx.principalUserId };
}

/** Ứng viên chỉ sửa được khi đang điền hồ sơ hoặc khi admin yêu cầu sửa. */
function assertEditable(ctx: PartnerContext) {
  const state = stateOf(ctx);
  if (!isEditableState(state)) {
    throw appError(
      state === 'UNDER_REVIEW'
        ? 'Hồ sơ đang được Gymini xem xét — không sửa được lúc này'
        : state === 'REJECTED'
          ? 'Hồ sơ chưa được chấp thuận — liên hệ Gymini để được hỗ trợ'
          : 'Hồ sơ không ở trạng thái có thể chỉnh sửa',
      409,
      'APPLICATION_LOCKED',
      { accessState: state },
    );
  }
}

/** Khoá dòng partner để tuần tự hoá các thao tác cùng hồ sơ (2 tab, bấm đúp). */
/** Bốn link mạng xã hội của thương hiệu, cùng một hình dạng cho mọi nơi trả ra. */
export function socialOf(brand: { facebookUrl: string | null; instagramUrl: string | null; tiktokUrl: string | null; youtubeUrl: string | null }) {
  return {
    facebookUrl: brand.facebookUrl,
    instagramUrl: brand.instagramUrl,
    tiktokUrl: brand.tiktokUrl,
    youtubeUrl: brand.youtubeUrl,
  };
}

export async function lockPartner(tx: Tx, partnerId: string) {
  await tx.$queryRaw`SELECT id FROM gym_partners WHERE id = ${partnerId} FOR UPDATE`;
}

/**
 * Luôn đủ các loại giấy tờ của hồ sơ tự đăng ký (APPLICATION_DOC_TYPES, kể cả chưa từng đụng tới), kèm các cột mới của hồ sơ tự đăng ký.
 * `partnerDiligenceService.listDocuments` cố ý không dùng ở đây: nó trả dòng "ảo" không có các cột
 * files/version/reviewNote nên không cho ta kiểu chung.
 */
async function listApplicationDocuments(partnerId: string) {
  const rows = await prisma.gymPartnerDocument.findMany({
    where: { partnerId },
    include: { files: { orderBy: { createdAt: 'asc' } } },
  });
  const byType = new Map(rows.map((r) => [r.docType, r]));
  const required = REQUIRED_APPLICATION_DOCS as readonly string[];
  return APPLICATION_DOC_TYPES.map((docType) => {
    const row = byType.get(docType);
    return {
      docType,
      required: required.includes(docType),
      status: row?.status ?? ('PENDING' as const),
      reviewNote: row?.reviewNote ?? null,
      fileUrl: row?.fileUrl ?? null,
      files: row?.files ?? [],
      version: row?.version ?? 1,
    };
  });
}

function isPlaceholderLegalName(partner: { legalName: string; contactEmail: string | null }) {
  return !partner.legalName?.trim() || partner.legalName === partner.contactEmail;
}

export const partnerApplicationService = {
  /** Cho điều hướng gốc/đăng nhập của frontend — dùng được cả với tài khoản mồ côi. */
  getStatus(ctx: PartnerContext) {
    const accessState = stateOf(ctx);
    return {
      accessState,
      editable: isEditableState(accessState),
      partnerId: ctx.partnerId,
      role: ctx.role,
    };
  },

  /**
   * Tạo hồ sơ đối tác (PROSPECT, source SELF_SERVICE) + tài khoản OWNER cho chính người đang đăng
   * nhập. Idempotent, khoá theo `userId` (gym_partner_accounts.user_id UNIQUE): gọi lại, hay hai tab
   * cùng lúc, đều trả về hồ sơ đã có chứ không tạo thêm.
   *
   * Từ chối chủ gym đã chứng minh được sở hữu từ trước (không cần đăng ký đối tác mới). `set-password`
   * bên auth-service chỉ ghi MỘT datastore rồi cấp JWT; bước này do chính ứng viên gọi ngay sau đó, nên
   * không có saga hai datastore — một User chưa bootstrap chỉ là trạng thái SETUP_INCOMPLETE, không có
   * quyền vận hành nào.
   */
  async bootstrap(userId: string, email: string): Promise<{ created: boolean; partnerId: string }> {
    const existing = await partnerRepository.findAccountByUserId(userId);
    if (existing) return { created: false, partnerId: existing.partnerId };

    if (await partnerRepository.userHasLegacyOwnership(userId)) {
      throw appError(
        'Tài khoản này đã đứng tên phòng gym hiện có — không cần đăng ký đối tác mới',
        409,
        'LEGACY_OWNER',
      );
    }

    try {
      const partner = await prisma.$transaction(async (tx) => {
        const created = await tx.gymPartner.create({
          data: {
            // legalName là cột NOT NULL; email là chỗ giữ tạm cho tới khi ứng viên nhập tên pháp lý
            // ở bước Xác minh (computeMissing coi "legalName == contactEmail" là chưa nhập).
            legalName: email,
            contactEmail: email,
            status: 'PROSPECT',
            verificationStatus: 'NOT_VERIFIED',
            source: 'SELF_SERVICE',
            createdBy: userId,
          },
        });
        await tx.gymPartnerAccount.create({
          data: {
            partnerId: created.id,
            userId,
            role: 'OWNER',
            scopedGymIds: [],
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        });
        return created;
      });
      logger.info({ userId, partnerId: partner.id }, 'Partner application bootstrapped');
      return { created: true, partnerId: partner.id };
    } catch (e: any) {
      // Hai request cùng lúc: bên thua va vào UNIQUE(user_id) — toàn bộ transaction của nó rollback,
      // nên chỉ cần đọc lại hồ sơ mà bên thắng đã tạo.
      if (e?.code === 'P2002') {
        const again = await partnerRepository.findAccountByUserId(userId);
        if (again) return { created: false, partnerId: again.partnerId };
      }
      throw e;
    }
  },

  // ── Đọc ────────────────────────────────────────────────────────────────────────────────────

  /** Toàn bộ hồ sơ + phần còn thiếu, cho wizard và trang xem lại. */
  async getApplication(ctx: PartnerContext) {
    const { partnerId, accountId, ownerId } = requireApplicantOwner(ctx);
    const state = stateOf(ctx);

    const partner = await partnerRepository.findPartnerById(partnerId);
    const [account, brand, gym, docs, issues] = await Promise.all([
      partnerRepository.findAccountById(accountId),
      partner?.brandId ? prisma.gymBrand.findUnique({ where: { id: partner.brandId } }) : null,
      prisma.gym.findFirst({ where: { ownerId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' } }),
      listApplicationDocuments(partnerId),
      prisma.gymPartnerReviewIssue.findMany({ where: { partnerId }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!partner || !account) throw appError('Không tìm thấy hồ sơ', 404, 'NOT_FOUND');

    const photos = gym
      ? await prisma.gymPhoto.findMany({ where: { gymId: gym.id }, orderBy: { sortOrder: 'asc' } })
      : [];

    const docStatuses: CompletenessInput['docStatuses'] = {};
    for (const d of docs) {
      if ((REQUIRED_APPLICATION_DOCS as readonly string[]).includes(d.docType)) {
        (docStatuses as Record<string, string | null>)[d.docType] = d.status;
      }
    }

    const missing = computeMissing({
      representative: { name: partner.representativeName, phone: account.contactPhone, role: partner.representativeRole },
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

    return {
      accessState: state,
      editable: isEditableState(state),
      minPhotos: APPLICATION_MIN_PHOTOS,
      partner: {
        id: partner.id,
        legalName: isPlaceholderLegalName(partner) ? null : partner.legalName,
        contactEmail: partner.contactEmail,
        taxCode: partner.taxCode,
        businessLicenseNo: partner.businessLicenseNo,
        representativeName: partner.representativeName,
        representativeRole: partner.representativeRole,
        businessScale: partner.businessScale,
        submittedAt: partner.submittedAt,
        termsAcceptedAt: partner.termsAcceptedAt,
        createdAt: partner.createdAt,
        // Lý do/ghi chú của admin chỉ hiện khi có nghĩa với ứng viên.
        rejectedAt: state === 'REJECTED' ? partner.rejectedAt : null,
        rejectionReason: state === 'REJECTED' ? partner.rejectionReason : null,
        adminNote: state === 'REJECTED' || state === 'CHANGES_REQUESTED' ? partner.verificationNotes : null,
      },
      representativePhone: account.contactPhone,
      brand: brand
        ? { id: brand.id, name: brand.name, description: brand.description, logoUrl: await brandLogoUrl(brand.logoKey), ...socialOf(brand) }
        : null,
      branch: gym
        ? {
            id: gym.id,
            name: gym.name === 'Chi nhánh mới' ? '' : gym.name,
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
          }
        : null,
      photos: await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          category: p.category,
          sortOrder: p.sortOrder,
          isCover: p.isCover,
          url: p.s3Key ? await partnerS3.presignGet({ key: p.s3Key, contentType: undefined, attachment: false, expiresSec: 300 }).catch(() => null) : null,
        })),
      ),
      documents: await Promise.all(
        docs.map(async (d) => ({
          docType: d.docType,
          required: d.required,
          status: d.status,
          reviewNote: d.status === 'REJECTED' ? d.reviewNote : null,
          hasFile: d.files.length > 0 || Boolean(d.fileUrl),
          version: d.version,
          files: await Promise.all(
            d.files.map(async (f) => ({
              id: f.id,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              // Thumbnail chỉ cho ảnh, link ký tạm ngắn như mọi link giấy tờ; bấm xem thì xin link mới.
              previewUrl: f.mimeType.startsWith('image/')
                ? await partnerS3
                    .presignGet({ key: f.fileKey, contentType: f.mimeType, attachment: false, expiresSec: 120 })
                    .catch(() => null)
                : null,
            })),
          ),
        })),
      ),
      issues: issues.map((i) => ({
        id: i.id,
        category: i.category,
        message: i.message,
        status: i.status,
        resubmitNote: i.resubmitNote,
        adminFollowUp: i.adminFollowUp,
        createdAt: i.createdAt,
      })),
      missing,
    };
  },

  /** Timeline lấy từ sự kiện ĐÃ LƯU (PartnerAuditLog), không phải mốc thời gian tự tính ở frontend. */
  async getTimeline(ctx: PartnerContext, userId: string) {
    const { partnerId } = requireApplicantOwner(ctx);
    const partner = await partnerRepository.findPartnerById(partnerId);
    const rows = await prisma.partnerAuditLog.findMany({
      where: { partnerId, action: { in: [...TIMELINE_ACTIONS] } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      accountCreatedAt: partner?.createdAt ?? null,
      events: rows.map((r) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          action: r.action,
          at: r.createdAt,
          byYou: r.actorUserId === userId,
          // Chỉ vài trường an toàn — không bao giờ ghi chú nội bộ của admin.
          category: typeof m.category === 'string' ? m.category : undefined,
          docType: typeof m.docType === 'string' ? m.docType : undefined,
          count: typeof m.count === 'number' ? m.count : undefined,
        };
      }),
    };
  },

  // ── Sửa hồ sơ ──────────────────────────────────────────────────────────────────────────────

  async updateRepresentative(
    ctx: PartnerContext,
    data: { name: string; phone: string; role: PartnerRepresentativeRole },
  ) {
    const { partnerId, accountId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await prisma.$transaction([
      prisma.gymPartner.update({
        where: { id: partnerId },
        data: { representativeName: data.name.trim(), representativeRole: data.role },
      }),
      prisma.gymPartnerAccount.update({ where: { id: accountId }, data: { contactPhone: data.phone.trim() } }),
    ]);
    return { ok: true };
  },

  async updateBusinessScale(ctx: PartnerContext, scale: PartnerBusinessScale) {
    const { partnerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await partnerRepository.updatePartner(partnerId, { businessScale: scale });
    return { ok: true };
  },

  /** Tạo (lần đầu) hoặc đổi tên/mô tả THƯƠNG HIỆU DUY NHẤT. Không bao giờ có "brand thứ hai". */
  async upsertBrand(ctx: PartnerContext, data: { name: string; description?: string }) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);

    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw appError('Không tìm thấy hồ sơ', 404, 'NOT_FOUND');

    if (partner.brandId) {
      const brand = await brandService.updateBrand(partner.brandId, ownerId, {
        name: data.name.trim(),
        description: data.description,
      });
      return { id: brand.id, name: brand.name, description: brand.description };
    }
    try {
      const brand = await brandService.createBrand(ownerId, { name: data.name, description: data.description });
      await partnerService.attachBrand(partnerId, brand.id);
      return { id: brand.id, name: brand.name, description: brand.description };
    } catch (e: any) {
      // Hai tab cùng tạo: UNIQUE(gym_brands.owner_id) chặn brand thứ hai ở cấp DB — coi như đã có rồi.
      if (e?.code === 'P2002' || e?.status === 409) {
        const existing = (await brandService.listOwned(ownerId))[0];
        if (existing) {
          await partnerService.attachBrand(partnerId, existing.id).catch(() => undefined);
          const brand = await brandService.updateBrand(existing.id, ownerId, {
            name: data.name.trim(),
            description: data.description,
          });
          return { id: brand.id, name: brand.name, description: brand.description };
        }
      }
      throw e;
    }
  },

  /** Link mạng xã hội của thương hiệu — bước tuỳ chọn, không chặn nộp hồ sơ. Cần có thương hiệu trước. */
  async updateSocialLinks(
    ctx: PartnerContext,
    data: { facebookUrl?: string | null; instagramUrl?: string | null; tiktokUrl?: string | null; youtubeUrl?: string | null },
  ) {
    const { partnerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner?.brandId) throw appError('Hãy đặt tên thương hiệu trước', 409, 'BRAND_REQUIRED');
    const brand = await prisma.gymBrand.update({
      where: { id: partner.brandId },
      data: {
        facebookUrl: data.facebookUrl ?? null,
        instagramUrl: data.instagramUrl ?? null,
        tiktokUrl: data.tiktokUrl ?? null,
        youtubeUrl: data.youtubeUrl ?? null,
      },
    });
    return socialOf(brand);
  },

  /**
   * Chi nhánh ĐẦU TIÊN — đúng MỘT nháp cho mỗi hồ sơ. `brandId` do server suy ra từ thương hiệu của
   * chính ứng viên, không bao giờ nhận từ client. Chi nhánh ở DRAFT nên vô hình với mọi truy vấn
   * công khai; nó KHÔNG vào hàng duyệt chi nhánh riêng — mọi góp ý đi qua issue cấp hồ sơ.
   */
  async upsertBranch(
    ctx: PartnerContext,
    data: Partial<{
      name: string;
      description: string;
      address: string;
      city: string;
      phone: string;
      email: string;
      provinceCode: number | null;
      wardCode: number | null;
      latitude: number | null;
      longitude: number | null;
      locationNote: string;
    }>,
  ) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);

    return prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);

      const others = await tx.gym.count({ where: { ownerId, status: { not: 'DRAFT' } } });
      if (others > 0) {
        throw appError('Hồ sơ này chỉ có một chi nhánh đầu tiên', 409, 'APPLICATION_SINGLE_BRANCH');
      }

      let gym = await tx.gym.findFirst({ where: { ownerId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' } });
      if (!gym) {
        const partner = await tx.gymPartner.findUnique({ where: { id: partnerId } });
        if (!partner?.brandId) {
          throw appError('Hãy đặt tên thương hiệu trước khi tạo chi nhánh', 409, 'BRAND_REQUIRED');
        }
        gym = await tx.gym.create({
          data: {
            ownerId,
            name: 'Chi nhánh mới',
            address: '',
            status: 'DRAFT',
            wizardStep: 1,
            brand: { connect: { id: partner.brandId } },
          },
        });
      }

      const patch: Record<string, unknown> = {};
      for (const key of [
        'name', 'description', 'address', 'city', 'phone', 'email',
        'provinceCode', 'wardCode', 'latitude', 'longitude', 'locationNote',
      ] as const) {
        if (data[key] !== undefined) patch[key] = data[key];
      }
      if (Object.keys(patch).length === 0) return gym;
      return tx.gym.update({ where: { id: gym.id }, data: patch });
    });
  },

  async updateLegal(
    ctx: PartnerContext,
    data: { legalName: string; taxCode?: string | null; businessLicenseNo?: string | null },
  ) {
    const { partnerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await partnerRepository.updatePartner(partnerId, {
      legalName: data.legalName.trim(),
      ...(data.taxCode !== undefined ? { taxCode: data.taxCode?.trim() || null } : {}),
      ...(data.businessLicenseNo !== undefined ? { businessLicenseNo: data.businessLicenseNo?.trim() || null } : {}),
    });
    return { ok: true };
  },

  // ── Nộp / nộp lại ──────────────────────────────────────────────────────────────────────────

  /** Danh sách còn thiếu — dùng chung cho submit, resubmit và trang xem lại. */
  async missingFor(ctx: PartnerContext) {
    const app = await this.getApplication(ctx);
    return app.missing;
  },

  async submit(ctx: PartnerContext, actorUserId: string, opts: { acceptTerms?: boolean }, req?: Request) {
    const { partnerId, accountId } = requireApplicantOwner(ctx);
    const state = stateOf(ctx);
    if (state === 'UNDER_REVIEW') return { alreadySubmitted: true, accessState: state };
    if (state === 'CHANGES_REQUESTED') {
      throw appError('Hồ sơ đang cần chỉnh sửa — hãy dùng "Gửi lại hồ sơ"', 409, 'USE_RESUBMIT');
    }
    if (state !== 'ONBOARDING') assertEditable(ctx);

    // Điều khoản: chấp nhận ngay tại bước Xem lại (D2), lưu phiên bản đã ký.
    let partner = await partnerRepository.findPartnerById(partnerId);
    if (opts.acceptTerms && !partner?.termsAcceptedAt) {
      await partnerRepository.updatePartner(partnerId, {
        termsAcceptedVersion: onboardingService.currentTermsVersion(),
        termsAcceptedAt: new Date(),
      });
    }

    const missing = await this.missingFor(ctx);
    if (missing.length > 0) {
      throw appError('Hồ sơ chưa đầy đủ', 400, 'APPLICATION_INCOMPLETE', {
        issues: missing.map((m) => ({ field: m.section, message: m.message })),
      });
    }

    const submitted = await prisma.$transaction(async (tx) => {
      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED', source: 'SELF_SERVICE' },
        data: { verificationStatus: 'IN_REVIEW', submittedAt: new Date(), verificationNotes: null },
      });
      if (res.count !== 1) return false;
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId,
        action: 'APPLICATION_SUBMITTED',
        req,
        metadata: { accountId },
      });
      return true;
    });

    if (!submitted) return { alreadySubmitted: true, accessState: 'UNDER_REVIEW' as AccessState };

    partner = await partnerRepository.findPartnerById(partnerId);
    void sendApplicantMail(partner?.contactEmail, applicantEmails.submitted());
    return { alreadySubmitted: false, accessState: 'UNDER_REVIEW' as AccessState };
  },

  /**
   * Ứng viên "đánh dấu đã cập nhật" một vấn đề admin nêu. Việc này KHÔNG đóng vấn đề: nó chỉ chuyển
   * OPEN → RESUBMITTED để admin biết cần xem lại; chỉ ADMIN mới đóng (RESOLVED).
   */
  async markIssueUpdated(ctx: PartnerContext, actorUserId: string, issueId: string, note?: string, req?: Request) {
    const { partnerId } = requireApplicantOwner(ctx);
    if (stateOf(ctx) !== 'CHANGES_REQUESTED') {
      throw appError('Hồ sơ không đang ở trạng thái cần chỉnh sửa', 409, 'APPLICATION_LOCKED');
    }
    await prisma.$transaction(async (tx) => {
      const issue = await tx.gymPartnerReviewIssue.findUnique({ where: { id: issueId } });
      if (!issue || issue.partnerId !== partnerId) throw appError('Không tìm thấy mục cần chỉnh sửa', 404, 'NOT_FOUND');
      const res = await tx.gymPartnerReviewIssue.updateMany({
        where: { id: issueId, partnerId, status: 'OPEN' },
        data: { status: 'RESUBMITTED', resubmitNote: note?.trim() || null, resubmittedAt: new Date() },
      });
      if (res.count !== 1) throw appError('Mục này đã được đánh dấu rồi', 409, 'ISSUE_NOT_OPEN');
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId,
        action: 'ISSUE_MARKED_UPDATED',
        req,
        metadata: { issueId, category: issue.category },
      });
    });
    return { ok: true };
  },

  /**
   * Gửi lại sau khi admin yêu cầu sửa. Chỉ được khi MỌI vấn đề đã được ứng viên đánh dấu và MỌI
   * giấy tờ bị yêu cầu cập nhật đã được thay tệp. Nộp lại KHÔNG đóng vấn đề nào — chỉ admin đóng.
   */
  async resubmit(ctx: PartnerContext, actorUserId: string, req?: Request) {
    const { partnerId } = requireApplicantOwner(ctx);
    const state = stateOf(ctx);
    if (state === 'UNDER_REVIEW') return { alreadySubmitted: true, accessState: state };
    if (state !== 'CHANGES_REQUESTED') {
      throw appError('Hồ sơ không ở trạng thái có thể gửi lại', 409, 'APPLICATION_LOCKED');
    }

    const missing = await this.missingFor(ctx);
    if (missing.length > 0) {
      throw appError('Hồ sơ chưa đầy đủ', 400, 'APPLICATION_INCOMPLETE', {
        issues: missing.map((m) => ({ field: m.section, message: m.message })),
      });
    }

    const resubmitted = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const open = await tx.gymPartnerReviewIssue.count({ where: { partnerId, status: 'OPEN' } });
      if (open > 0) {
        throw appError(
          `Còn ${open} mục chưa được đánh dấu "đã cập nhật"`,
          409,
          'ISSUES_NOT_ACKNOWLEDGED',
          { openCount: open },
        );
      }
      const stale = await tx.gymPartnerDocument.count({ where: { partnerId, status: 'REJECTED' } });
      if (stale > 0) {
        throw appError(
          `Còn ${stale} giấy tờ chưa được thay tệp theo yêu cầu`,
          409,
          'DOCUMENTS_NOT_REPLACED',
          { staleCount: stale },
        );
      }
      const res = await tx.gymPartner.updateMany({
        where: { id: partnerId, status: 'PROSPECT', verificationStatus: 'NEEDS_INFO' },
        data: { verificationStatus: 'IN_REVIEW', submittedAt: new Date() },
      });
      if (res.count !== 1) return false;
      const resubmittedIssues = await tx.gymPartnerReviewIssue.count({ where: { partnerId, status: 'RESUBMITTED' } });
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId,
        action: 'APPLICATION_RESUBMITTED',
        req,
        metadata: { count: resubmittedIssues },
      });
      return true;
    });

    if (!resubmitted) return { alreadySubmitted: true, accessState: 'UNDER_REVIEW' as AccessState };
    const partner = await partnerRepository.findPartnerById(partnerId);
    void sendApplicantMail(partner?.contactEmail, applicantEmails.resubmitted());
    return { alreadySubmitted: false, accessState: 'UNDER_REVIEW' as AccessState };
  },
};
