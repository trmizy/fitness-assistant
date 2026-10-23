import type { Request } from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { partnerRepository } from '../repositories/partner.repository';
import { withCompatWriter } from '../repositories/compat-writer';
import type { Prisma, PartnerRepresentativeRole, PartnerBusinessScale } from '../generated/prisma';
import type { PartnerContext } from './partner.service';
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
import { amenityDto, proposalDto } from './gym-amenity-catalog.service';
import { applyAmenitySelectionTx, selectionCountsTx, type AmenitySelectionInput } from './gym-amenity-selection.service';
import {
  LEGACY_NO_HEADER,
  amenitiesRequired,
  amenitiesRequiredError,
  clearLegacyNoAmenitiesTx,
  createdFlowVersionData,
  markApplicationFlowTx,
  recordLegacyCompatTx,
  recordLegacyRejectedEvent,
  type LegacyCompatAction,
  type ListingCompat,
} from './legacy-compat.service';

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
  // Every transaction in this file (and partner-upload) that writes gym_partners / gyms starts here, so this is also
  // where it declares itself an event-aware writer (see repositories/compat-writer.ts).
  await withCompatWriter(tx);
  await tx.$queryRaw`SELECT id FROM gym_partners WHERE id = ${partnerId} FOR UPDATE`;
}

/**
 * Listing Management B3 - closes a transaction of an application request: a new client (`X-Gymini-Listing-Flow: 2`) marks the
 * application flow version 2 (never downgraded); an old client (no header) leaves its legacy-compat evidence - the ACCEPTED event
 * AND `legacy_client_at` = the same now(), in this very transaction (plan 12.15 item 4). `legacyNoAmenities` is the application's
 * "arrived without amenities" state when this action decided it.
 */
export async function finishApplicationTx(
  tx: Tx,
  partnerId: string,
  actorUserId: string,
  compat: ListingCompat,
  action: LegacyCompatAction,
  legacyNoAmenities?: boolean,
) {
  await markApplicationFlowTx(tx, partnerId, compat);
  await recordLegacyCompatTx(tx, {
    action,
    entityType: 'GYM_PARTNER',
    entityId: partnerId,
    actorUserId,
    flowHeader: compat.flowHeader,
    clientHeader: compat.clientHeader,
    outcome: 'ACCEPTED',
    legacyNoAmenities,
  });
  if (legacyNoAmenities === false) await clearLegacyNoAmenitiesTx(tx, 'GYM_PARTNER', partnerId);
}

/** One save step of the wizard (PUT /owner/application/*): lock the application, do the write, then finishApplicationTx - one transaction. */
function saveStep<T>(
  partnerId: string,
  actorUserId: string,
  compat: ListingCompat,
  work: (tx: Tx) => Promise<T>,
  action: LegacyCompatAction = 'APPLICATION_SAVE_STEP',
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockPartner(tx, partnerId);
    const out = await work(tx);
    await finishApplicationTx(tx, partnerId, actorUserId, compat, action);
    return out;
  });
}

/** A request that changed nothing (an already-submitted application, a bootstrap that found the account) still leaves its evidence. */
async function recordNoop(partnerId: string, actorUserId: string, compat: ListingCompat, action: LegacyCompatAction) {
  await prisma.$transaction(async (tx) => {
    await lockPartner(tx, partnerId);
    await finishApplicationTx(tx, partnerId, actorUserId, compat, action);
  });
}

/**
 * Submit / resubmit gate (plan 4, 12.8): a new client, a flow-2 application, or an old client once LISTING_LEGACY_CLIENT_COMPAT is
 * off needs >= 1 amenity on the DRAFT branch (ACTIVE catalogue rows + the owner's PENDING proposals) - otherwise 422 AMENITIES_REQUIRED.
 * An old client with the flag on is accepted with 0 (the caller marks legacy_no_amenities). Runs under the partner lock, after the
 * flow version of a new client was recorded. Returns the amenity total.
 */
async function requireAmenitiesForSubmitTx(tx: Tx, partnerId: string, ownerId: string, compat: ListingCompat): Promise<number> {
  await markApplicationFlowTx(tx, partnerId, compat);
  const partner = await tx.gymPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { applicationFlowVersion: true } });
  const gym = await tx.gym.findFirst({ where: { ownerId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' }, select: { id: true, ownerId: true } });
  const counts = gym ? await selectionCountsTx(tx, gym) : { amenityCount: 0, pendingProposalCount: 0 };
  const total = counts.amenityCount + counts.pendingProposalCount;
  if (total === 0 && amenitiesRequired(compat, partner.applicationFlowVersion)) throw amenitiesRequiredError(compat);
  return total;
}

/** The business transaction rolled back with AMENITIES_REQUIRED: an old client's refusal still leaves its REJECTED_422 event (own transaction). */
async function recordRejectedAmenities(e: unknown, partnerId: string, actorUserId: string, compat: ListingCompat, action: LegacyCompatAction) {
  if ((e as { code?: string })?.code !== 'AMENITIES_REQUIRED' || compat.newClient) return;
  await recordLegacyRejectedEvent({
    action,
    entityType: 'GYM_PARTNER',
    entityId: partnerId,
    actorUserId,
    flowHeader: compat.flowHeader,
    clientHeader: compat.clientHeader,
  });
}

/** The branch's amenity selection as the applicant sees it: the chosen catalogue rows and the own proposals bound to the branch. */
async function loadAmenityState(db: Tx | typeof prisma, gym: { id: string; ownerId: string } | null) {
  if (!gym) return { amenities: [] as ReturnType<typeof amenityDto>[], amenityProposals: [] as ReturnType<typeof proposalDto>[], amenityCount: 0, pendingCount: 0 };
  const [rows, proposals] = await Promise.all([
    db.gymAmenity.findMany({ where: { gymId: gym.id }, include: { amenity: true } }),
    db.amenityProposal.findMany({
      where: { gymId: gym.id, ownerUserId: gym.ownerId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const active = rows
    .filter((r) => r.amenity.status === 'ACTIVE')
    .sort((a, b) => a.amenity.sortOrder - b.amenity.sortOrder || a.amenity.name.localeCompare(b.amenity.name));
  return {
    amenities: active.map((r) => amenityDto(r.amenity)),
    amenityProposals: proposals.map(proposalDto),
    amenityCount: active.length,
    pendingCount: proposals.filter((p) => p.status === 'PENDING').length,
  };
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
  async bootstrap(userId: string, email: string, compat: ListingCompat = LEGACY_NO_HEADER): Promise<{ created: boolean; partnerId: string }> {
    const existing = await partnerRepository.findAccountByUserId(userId);
    if (existing) {
      await recordNoop(existing.partnerId, userId, compat, 'APPLICATION_BOOTSTRAP');
      return { created: false, partnerId: existing.partnerId };
    }

    if (await partnerRepository.userHasLegacyOwnership(userId)) {
      throw appError(
        'Tài khoản này đã đứng tên phòng gym hiện có — không cần đăng ký đối tác mới',
        409,
        'LEGACY_OWNER',
      );
    }

    try {
      const partner = await prisma.$transaction(async (tx) => {
        await withCompatWriter(tx);
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
        await finishApplicationTx(tx, created.id, userId, compat, 'APPLICATION_BOOTSTRAP');
        return created;
      });
      logger.info({ userId, partnerId: partner.id }, 'Partner application bootstrapped');
      return { created: true, partnerId: partner.id };
    } catch (e: any) {
      // Hai request cùng lúc: bên thua va vào UNIQUE(user_id) — toàn bộ transaction của nó rollback,
      // nên chỉ cần đọc lại hồ sơ mà bên thắng đã tạo.
      if (e?.code === 'P2002') {
        const again = await partnerRepository.findAccountByUserId(userId);
        if (again) {
          await recordNoop(again.partnerId, userId, compat, 'APPLICATION_BOOTSTRAP');
          return { created: false, partnerId: again.partnerId };
        }
      }
      throw e;
    }
  },

  // ── Đọc ────────────────────────────────────────────────────────────────────────────────────

  /** Toàn bộ hồ sơ + phần còn thiếu, cho wizard và trang xem lại. */
  async getApplication(ctx: PartnerContext, compat: ListingCompat = LEGACY_NO_HEADER) {
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
    const amenityState = await loadAmenityState(prisma, gym);

    const docStatuses: CompletenessInput['docStatuses'] = {};
    for (const d of docs) {
      if ((REQUIRED_APPLICATION_DOCS as readonly string[]).includes(d.docType)) {
        (docStatuses as Record<string, string | null>)[d.docType] = d.status;
      }
    }

    const missing = computeMissing({
      amenityCount: amenityState.amenityCount + amenityState.pendingCount,
      requireAmenities: amenitiesRequired(compat, partner.applicationFlowVersion),
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
      // Listing Management B3: the selection of the DRAFT branch (catalogue rows + own proposals) and how the application got here.
      amenities: amenityState.amenities,
      amenityProposals: amenityState.amenityProposals,
      applicationFlowVersion: partner.applicationFlowVersion,
      legacyNoAmenities: partner.legacyNoAmenities,
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
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const { partnerId, accountId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await saveStep(partnerId, ownerId, compat, async (tx) => {
      await tx.gymPartner.update({
        where: { id: partnerId },
        data: { representativeName: data.name.trim(), representativeRole: data.role },
      });
      await tx.gymPartnerAccount.update({ where: { id: accountId }, data: { contactPhone: data.phone.trim() } });
    });
    return { ok: true };
  },

  async updateBusinessScale(ctx: PartnerContext, scale: PartnerBusinessScale, compat: ListingCompat = LEGACY_NO_HEADER) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await saveStep(partnerId, ownerId, compat, (tx) => tx.gymPartner.update({ where: { id: partnerId }, data: { businessScale: scale } }));
    return { ok: true };
  },

  /** Tạo (lần đầu) hoặc đổi tên/mô tả THƯƠNG HIỆU DUY NHẤT. Không bao giờ có "brand thứ hai". */
  async upsertBrand(ctx: PartnerContext, data: { name: string; description?: string }, compat: ListingCompat = LEGACY_NO_HEADER) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    const name = data.name?.trim();
    if (!name) throw appError('Hãy đặt tên thương hiệu', 400, 'BRAND_NAME_REQUIRED');

    // One transaction with the partner locked (saveStep): two tabs creating the brand at once run one after the other, and the
    // legacy-compat evidence is written together with the brand. UNIQUE(gym_brands.owner_id) still holds: the partner's brand, else
    // the owner's existing one, else a new one.
    return saveStep(partnerId, ownerId, compat, async (tx) => {
      const partner = await tx.gymPartner.findUnique({ where: { id: partnerId } });
      if (!partner) throw appError('Không tìm thấy hồ sơ', 404, 'NOT_FOUND');

      let brand = partner.brandId
        ? await tx.gymBrand.findUnique({ where: { id: partner.brandId } })
        : await tx.gymBrand.findFirst({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
      if (brand && brand.ownerId !== ownerId) throw appError('Not authorized — you do not own this brand', 403);
      if (brand) {
        brand = await tx.gymBrand.update({
          where: { id: brand.id },
          data: { name, pendingName: name, ...(data.description !== undefined ? { description: data.description } : {}) },
        });
      } else {
        brand = await tx.gymBrand.create({ data: { ownerId, name, pendingName: name, description: data.description } });
      }
      if (partner.brandId !== brand.id) {
        const taken = await tx.gymPartner.findFirst({ where: { brandId: brand.id, id: { not: partnerId } }, select: { id: true } });
        if (taken) throw appError('Thương hiệu này đã thuộc về một đối tác khác', 409);
        await tx.gymPartner.update({ where: { id: partnerId }, data: { brandId: brand.id } });
      }
      return { id: brand.id, name: brand.name, description: brand.description };
    });
  },

  /** Link mạng xã hội của thương hiệu — bước tuỳ chọn, không chặn nộp hồ sơ. Cần có thương hiệu trước. */
  async updateSocialLinks(
    ctx: PartnerContext,
    data: { facebookUrl?: string | null; instagramUrl?: string | null; tiktokUrl?: string | null; youtubeUrl?: string | null },
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    return saveStep(partnerId, ownerId, compat, async (tx) => {
      const partner = await tx.gymPartner.findUnique({ where: { id: partnerId } });
      if (!partner?.brandId) throw appError('Hãy đặt tên thương hiệu trước', 409, 'BRAND_REQUIRED');
      const brand = await tx.gymBrand.update({
        where: { id: partner.brandId },
        data: {
          facebookUrl: data.facebookUrl ?? null,
          instagramUrl: data.instagramUrl ?? null,
          tiktokUrl: data.tiktokUrl ?? null,
          youtubeUrl: data.youtubeUrl ?? null,
        },
      });
      return socialOf(brand);
    });
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
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);

    return saveStep(partnerId, ownerId, compat, async (tx) => {
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
            // Listing Management B3: the branch of an application started by a new client is a flow-2 branch.
            ...createdFlowVersionData(compat),
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
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    await saveStep(partnerId, ownerId, compat, (tx) =>
      tx.gymPartner.update({
        where: { id: partnerId },
        data: {
          legalName: data.legalName.trim(),
          ...(data.taxCode !== undefined ? { taxCode: data.taxCode?.trim() || null } : {}),
          ...(data.businessLicenseNo !== undefined ? { businessLicenseNo: data.businessLicenseNo?.trim() || null } : {}),
        },
      }),
    );
    return { ok: true };
  },

  /**
   * Bước Tiện ích (Listing Management B3, plan 6.4): PUT /owner/application/amenities. The selection of the application's single DRAFT
   * branch - `amenityIds` (catalogue, authoritative when present), `proposals` (new custom ones, bound to that DRAFT branch by the
   * plan 12.3 owner algorithm) and/or `proposalIds` (own PENDING ones to keep). Saving it empty is allowed (it is a draft step); the
   * requirement is enforced at submit / resubmit and by the admin approve blockers. One transaction with the compat evidence.
   */
  async saveAmenities(ctx: PartnerContext, input: AmenitySelectionInput, compat: ListingCompat = LEGACY_NO_HEADER) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    assertEditable(ctx);
    return saveStep(partnerId, ownerId, compat, async (tx) => {
      const gym = await tx.gym.findFirst({ where: { ownerId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' } });
      if (!gym) throw appError('Hãy tạo chi nhánh đầu tiên trước khi chọn tiện ích', 409, 'BRANCH_REQUIRED');
      const counts = await applyAmenitySelectionTx(tx, gym, ownerId, input);
      if (counts.amenityCount + counts.pendingProposalCount > 0) await clearLegacyNoAmenitiesTx(tx, 'GYM_PARTNER', partnerId);
      const state = await loadAmenityState(tx, gym);
      return { amenities: state.amenities, amenityProposals: state.amenityProposals, amenityCount: state.amenityCount + state.pendingCount };
    });
  },

  // ── Nộp / nộp lại ──────────────────────────────────────────────────────────────────────────

  /** Danh sách còn thiếu — dùng chung cho submit, resubmit và trang xem lại. */
  async missingFor(ctx: PartnerContext, compat: ListingCompat = LEGACY_NO_HEADER) {
    const app = await this.getApplication(ctx, compat);
    return app.missing;
  },

  async submit(ctx: PartnerContext, actorUserId: string, opts: { acceptTerms?: boolean }, req?: Request, compat: ListingCompat = LEGACY_NO_HEADER) {
    const { partnerId, accountId, ownerId } = requireApplicantOwner(ctx);
    const state = stateOf(ctx);
    if (state === 'UNDER_REVIEW') {
      await recordNoop(partnerId, actorUserId, compat, 'APPLICATION_SUBMIT');
      return { alreadySubmitted: true, accessState: state };
    }
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

    // Anything else missing is a 400 listing everything (AMENITIES included when it is required of this client); when ONLY the amenities
    // are missing the answer is the dedicated 422 AMENITIES_REQUIRED, decided under the lock inside the transaction below.
    const missing = await this.missingFor(ctx, compat);
    if (missing.some((m) => m.section !== 'AMENITIES')) {
      throw appError('Hồ sơ chưa đầy đủ', 400, 'APPLICATION_INCOMPLETE', {
        issues: missing.map((m) => ({ field: m.section, message: m.message })),
      });
    }

    let submitted: boolean;
    try {
      submitted = await prisma.$transaction(async (tx) => {
        await lockPartner(tx, partnerId);
        const amenityTotal = await requireAmenitiesForSubmitTx(tx, partnerId, ownerId, compat);
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
        await finishApplicationTx(tx, partnerId, actorUserId, compat, 'APPLICATION_SUBMIT', amenityTotal === 0);
        return true;
      });
    } catch (e) {
      await recordRejectedAmenities(e, partnerId, actorUserId, compat, 'APPLICATION_SUBMIT');
      throw e;
    }

    if (!submitted) {
      await recordNoop(partnerId, actorUserId, compat, 'APPLICATION_SUBMIT');
      return { alreadySubmitted: true, accessState: 'UNDER_REVIEW' as AccessState };
    }

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
  async resubmit(ctx: PartnerContext, actorUserId: string, req?: Request, compat: ListingCompat = LEGACY_NO_HEADER) {
    const { partnerId, ownerId } = requireApplicantOwner(ctx);
    const state = stateOf(ctx);
    if (state === 'UNDER_REVIEW') {
      await recordNoop(partnerId, actorUserId, compat, 'APPLICATION_RESUBMIT');
      return { alreadySubmitted: true, accessState: state };
    }
    if (state !== 'CHANGES_REQUESTED') {
      throw appError('Hồ sơ không ở trạng thái có thể gửi lại', 409, 'APPLICATION_LOCKED');
    }

    const missing = await this.missingFor(ctx, compat);
    if (missing.some((m) => m.section !== 'AMENITIES')) {
      throw appError('Hồ sơ chưa đầy đủ', 400, 'APPLICATION_INCOMPLETE', {
        issues: missing.map((m) => ({ field: m.section, message: m.message })),
      });
    }

    let resubmitted: boolean;
    try {
    resubmitted = await prisma.$transaction(async (tx) => {
      await lockPartner(tx, partnerId);
      const amenityTotal = await requireAmenitiesForSubmitTx(tx, partnerId, ownerId, compat);
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
      await finishApplicationTx(tx, partnerId, actorUserId, compat, 'APPLICATION_RESUBMIT', amenityTotal === 0);
      return true;
    });
    } catch (e) {
      await recordRejectedAmenities(e, partnerId, actorUserId, compat, 'APPLICATION_RESUBMIT');
      throw e;
    }

    if (!resubmitted) {
      await recordNoop(partnerId, actorUserId, compat, 'APPLICATION_RESUBMIT');
      return { alreadySubmitted: true, accessState: 'UNDER_REVIEW' as AccessState };
    }
    const partner = await partnerRepository.findPartnerById(partnerId);
    void sendApplicantMail(partner?.contactEmail, applicantEmails.resubmitted());
    return { alreadySubmitted: false, accessState: 'UNDER_REVIEW' as AccessState };
  },
};
