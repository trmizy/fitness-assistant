import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import type { GymPhotoCategory, PartnerDocumentType } from '../generated/prisma';
import type { PartnerContext } from './partner.service';
import { partnerS3 } from './partner-s3.service';
import { partnerAuditService } from './partner-audit.service';
import { appError } from './partner-application.service';
import { deriveAccessState, isEditableState, REQUIRED_APPLICATION_DOCS } from './partner-application.state';
import {
  MAX_APPLICATION_PHOTOS,
  MAX_UPLOAD_BYTES,
  extensionFor,
  isAllowedContentType,
  validateStoredObject,
  type UploadKind,
} from './partner-upload.rules';

/**
 * Tải lên của hồ sơ đối tác tự đăng ký (ảnh cơ sở + giấy tờ pháp lý) — GYM_PARTNER_SECURITY_MODEL.md §6.
 *
 * Luồng: `presign` (server sinh khoá + tạo PartnerUploadIntent) → trình duyệt POST thẳng lên S3 →
 * `confirm(uploadId)`. Client KHÔNG BAO GIỜ gửi khoá đối tượng: nó chỉ có uploadId, và `confirm` chỉ
 * chấp nhận intent của CHÍNH partner đó — không có đường nào gắn một khoá tuỳ ý hay của partner khác
 * vào hồ sơ. Sau khi tải lên, server tự HEAD + đọc chữ ký đầu tệp để chắc tệp đúng loại/cỡ đã khai.
 */

const OPTIONAL_DOCS = ['TAX_CODE_CERTIFICATE', 'SITE_PHOTOS', 'FIRE_SAFETY_CERTIFICATE'] as const;
const ALL_DOC_TYPES: readonly string[] = [...REQUIRED_APPLICATION_DOCS, ...OPTIONAL_DOCS];
const INTENT_TTL_MS = 10 * 60 * 1000;

function requireOwnerIds(ctx: PartnerContext) {
  if (!ctx.partnerId || !ctx.accountId) {
    throw appError('Chưa có hồ sơ đối tác — hãy khởi tạo hồ sơ trước', 403, 'NO_PARTNER_ACCOUNT');
  }
  if (ctx.role !== 'OWNER') throw appError('Chỉ chủ sở hữu mới tải tệp lên được', 403, 'OWNER_ROLE_REQUIRED');
  return { partnerId: ctx.partnerId, ownerId: ctx.principalUserId };
}

function assertEditable(ctx: PartnerContext) {
  const state = deriveAccessState({
    isLegacy: ctx.isLegacy,
    hasAccount: Boolean(ctx.accountId),
    accountStatus: ctx.accountStatus,
    partnerStatus: ctx.partnerStatus,
    verificationStatus: ctx.verificationStatus,
    onboardingCompletedAt: ctx.onboardingCompletedAt,
  });
  if (!isEditableState(state)) {
    throw appError('Hồ sơ không ở trạng thái có thể chỉnh sửa', 409, 'APPLICATION_LOCKED', { accessState: state });
  }
}

async function draftGym(ownerId: string) {
  return prisma.gym.findFirst({ where: { ownerId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' } });
}

async function rejectAndCleanup(intentId: string, key: string, reason: string): Promise<never> {
  await partnerS3.deleteObject(key).catch((e) => logger.warn({ err: (e as Error).message }, 'Không xoá được tệp bị từ chối'));
  await prisma.partnerUploadIntent.delete({ where: { id: intentId } }).catch(() => undefined);
  throw appError(reason, 422, 'UPLOAD_REJECTED');
}

export const partnerUploadService = {
  /** Xin phép tải lên: trả URL + các trường POST đã ký (kích thước và Content-Type nằm trong policy). */
  async presign(
    ctx: PartnerContext,
    actorUserId: string,
    input: {
      kind: UploadKind;
      contentType: string;
      sizeBytes: number;
      docType?: PartnerDocumentType;
      photoCategory?: GymPhotoCategory;
    },
  ) {
    const { partnerId, ownerId } = requireOwnerIds(ctx);
    assertEditable(ctx);
    if (!partnerS3.isConfigured()) {
      throw appError('Tính năng tải tệp chưa được cấu hình trên môi trường này', 503, 'UPLOADS_UNAVAILABLE');
    }
    if (!isAllowedContentType(input.kind, input.contentType)) {
      throw appError(
        input.kind === 'PHOTO' ? 'Ảnh chỉ nhận JPEG, PNG hoặc WebP' : 'Giấy tờ chỉ nhận PDF, JPEG hoặc PNG',
        415,
        'UNSUPPORTED_TYPE',
      );
    }
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw appError('Kích thước tệp không hợp lệ', 400, 'INVALID_SIZE');
    }
    if (input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw appError(`Tệp tối đa ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`, 413, 'FILE_TOO_LARGE');
    }

    let gymId: string | null = null;
    let segment: string;
    if (input.kind === 'DOCUMENT') {
      if (!input.docType || !ALL_DOC_TYPES.includes(input.docType)) {
        throw appError('Loại giấy tờ không hợp lệ', 400, 'INVALID_DOC_TYPE');
      }
      segment = `docs/${input.docType}`;
    } else if (input.kind === 'LOGO') {
      const partner = await prisma.gymPartner.findUnique({ where: { id: partnerId }, select: { brandId: true } });
      if (!partner?.brandId) throw appError('Hãy đặt tên thương hiệu trước khi tải logo', 409, 'BRAND_REQUIRED');
      segment = 'brand';
    } else {
      const gym = await draftGym(ownerId);
      if (!gym) throw appError('Hãy tạo chi nhánh trước khi tải ảnh', 409, 'BRANCH_REQUIRED');
      const count = await prisma.gymPhoto.count({ where: { gymId: gym.id } });
      if (count >= MAX_APPLICATION_PHOTOS) {
        throw appError(`Tối đa ${MAX_APPLICATION_PHOTOS} ảnh cho mỗi chi nhánh`, 400, 'TOO_MANY_PHOTOS');
      }
      gymId = gym.id;
      segment = 'photos';
    }

    // Khoá do SERVER sinh, gắn với partner. Client không chọn được bất kỳ phần nào của nó.
    const objectKey = `partner-applications/${partnerId}/${segment}/${randomUUID()}.${extensionFor(input.contentType)}`;
    const intent = await prisma.partnerUploadIntent.create({
      data: {
        partnerId,
        kind: input.kind,
        docType: input.kind === 'DOCUMENT' ? input.docType : null,
        gymId,
        photoCategory: input.kind === 'PHOTO' ? (input.photoCategory ?? 'OTHER') : null,
        objectKey,
        contentType: input.contentType,
        maxBytes: MAX_UPLOAD_BYTES,
        createdBy: actorUserId,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });

    const { url, fields } = await partnerS3.presignUpload({
      key: objectKey,
      contentType: input.contentType,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    return { uploadId: intent.id, url, fields, expiresAt: intent.expiresAt, maxBytes: MAX_UPLOAD_BYTES };
  },

  /**
   * Xác nhận sau khi trình duyệt đã tải lên. Không tin những gì client nói: HEAD để lấy kích thước/loại
   * thật, đọc 16 byte đầu để nhận chữ ký, và chỉ khi tất cả khớp mới ghi vào hồ sơ. Sai thì XOÁ tệp.
   */
  async confirm(ctx: PartnerContext, actorUserId: string, uploadId: string, req?: Request) {
    const { partnerId, ownerId } = requireOwnerIds(ctx);
    assertEditable(ctx);

    const intent = await prisma.partnerUploadIntent.findUnique({ where: { id: uploadId } });
    // Cố ý cùng một thông báo cho "không có" và "của người khác" — không lộ sự tồn tại của intent.
    if (!intent || intent.partnerId !== partnerId) throw appError('Không tìm thấy lượt tải lên', 404, 'NOT_FOUND');
    if (intent.confirmedAt) return { alreadyConfirmed: true, kind: intent.kind };
    if (intent.expiresAt.getTime() < Date.now()) {
      throw appError('Lượt tải lên đã hết hạn — hãy thử lại', 410, 'UPLOAD_EXPIRED');
    }

    const head = await partnerS3.headObject(intent.objectKey);
    if (!head) throw appError('Chưa thấy tệp trên máy chủ — hãy tải lên rồi xác nhận lại', 409, 'UPLOAD_NOT_FOUND');

    if (process.env.PARTNER_S3_REQUIRE_SSE === 'true' && !head.serverSideEncryption) {
      return rejectAndCleanup(intent.id, intent.objectKey, 'Tệp chưa được mã hoá phía máy chủ');
    }

    const firstBytes = await partnerS3.readHead(intent.objectKey);
    const check = validateStoredObject({
      kind: intent.kind,
      declaredContentType: intent.contentType,
      declaredMaxBytes: intent.maxBytes,
      head,
      firstBytes,
    });
    if (!check.ok) return rejectAndCleanup(intent.id, intent.objectKey, check.reason);

    const basename = intent.objectKey.split('/').pop() as string;

    if (intent.kind === 'LOGO') {
      const partner = await prisma.gymPartner.findUnique({ where: { id: partnerId }, select: { brandId: true } });
      const brand = partner?.brandId ? await prisma.gymBrand.findUnique({ where: { id: partner.brandId } }) : null;
      if (!brand) {
        return rejectAndCleanup(intent.id, intent.objectKey, 'Thương hiệu không còn tồn tại');
      }
      const previousKey = brand.logoKey ?? null;
      await prisma.$transaction(async (tx) => {
        await tx.gymBrand.update({ where: { id: brand.id }, data: { logoKey: intent.objectKey } });
        await tx.partnerUploadIntent.update({ where: { id: intent.id }, data: { confirmedAt: new Date() } });
        await partnerAuditService.recordInTx(tx, {
          partnerId,
          actorUserId,
          action: 'PARTNER_UPDATED',
          req,
          metadata: { field: 'brandLogo', previousKey },
        });
      });
      return { kind: 'LOGO' as const, brandId: brand.id };
    }

    if (intent.kind === 'PHOTO') {
      const gym = await draftGym(ownerId);
      if (!gym || gym.id !== intent.gymId) {
        return rejectAndCleanup(intent.id, intent.objectKey, 'Chi nhánh không còn ở trạng thái nháp');
      }
      const photo = await prisma.$transaction(async (tx) => {
        const count = await tx.gymPhoto.count({ where: { gymId: gym.id } });
        if (count >= MAX_APPLICATION_PHOTOS) throw appError('Đã đủ số ảnh tối đa', 400, 'TOO_MANY_PHOTOS');
        const created = await tx.gymPhoto.create({
          data: {
            gymId: gym.id,
            fileName: basename,
            s3Key: intent.objectKey,
            category: intent.photoCategory,
            visibility: 'PRIVATE',
            sortOrder: count,
            isCover: count === 0,
          },
        });
        await tx.partnerUploadIntent.update({ where: { id: intent.id }, data: { confirmedAt: new Date() } });
        return created;
      });
      return { kind: 'PHOTO' as const, photoId: photo.id };
    }

    // DOCUMENT — thay tệp cũ thì tăng version và quay lại hàng chờ duyệt.
    const docType = intent.docType as PartnerDocumentType;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.gymPartnerDocument.findUnique({
        where: { partnerId_docType: { partnerId, docType } },
      });
      const replaced = Boolean(existing?.fileKey || existing?.fileUrl);
      const data = {
        fileKey: intent.objectKey,
        fileUrl: null,
        mimeType: intent.contentType,
        sizeBytes: head.contentLength ?? null,
        uploadedBy: actorUserId,
        status: 'RECEIVED' as const,
        reviewNote: null,
        verifiedBy: null,
        verifiedAt: null,
      };
      const doc = existing
        ? await tx.gymPartnerDocument.update({
            where: { id: existing.id },
            data: { ...data, version: replaced ? existing.version + 1 : existing.version },
          })
        : await tx.gymPartnerDocument.create({
            data: {
              partnerId,
              docType,
              required: (REQUIRED_APPLICATION_DOCS as readonly string[]).includes(docType),
              version: 1,
              ...data,
            },
          });
      await tx.partnerUploadIntent.update({ where: { id: intent.id }, data: { confirmedAt: new Date() } });
      await partnerAuditService.recordInTx(tx, {
        partnerId,
        actorUserId,
        action: replaced ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
        req,
        // Khoá cũ được giữ trong audit (bucket bật versioning) để truy vết khi cần.
        metadata: { docType, version: doc.version, previousKey: existing?.fileKey ?? null },
      });
      return { docType, version: doc.version, replaced };
    });
    return { kind: 'DOCUMENT' as const, ...result };
  },

  async deletePhoto(ctx: PartnerContext, photoId: string) {
    const { ownerId } = requireOwnerIds(ctx);
    assertEditable(ctx);
    const gym = await draftGym(ownerId);
    const photo = await prisma.gymPhoto.findUnique({ where: { id: photoId } });
    if (!gym || !photo || photo.gymId !== gym.id) throw appError('Không tìm thấy ảnh', 404, 'NOT_FOUND');

    await prisma.gymPhoto.delete({ where: { id: photoId } });
    if (photo.s3Key) {
      await partnerS3.deleteObject(photo.s3Key).catch((e) =>
        logger.warn({ err: (e as Error).message }, 'Không xoá được tệp ảnh trên S3 (bản ghi đã xoá)'),
      );
    }
    if (photo.isCover) {
      const next = await prisma.gymPhoto.findFirst({ where: { gymId: gym.id }, orderBy: { sortOrder: 'asc' } });
      if (next) await prisma.gymPhoto.update({ where: { id: next.id }, data: { isCover: true } });
    }
    return { ok: true };
  },

  async setCover(ctx: PartnerContext, photoId: string) {
    const { ownerId } = requireOwnerIds(ctx);
    assertEditable(ctx);
    const gym = await draftGym(ownerId);
    const photo = await prisma.gymPhoto.findUnique({ where: { id: photoId } });
    if (!gym || !photo || photo.gymId !== gym.id) throw appError('Không tìm thấy ảnh', 404, 'NOT_FOUND');
    await prisma.$transaction([
      prisma.gymPhoto.updateMany({ where: { gymId: gym.id }, data: { isCover: false } }),
      prisma.gymPhoto.update({ where: { id: photoId }, data: { isCover: true } }),
    ]);
    return { ok: true };
  },

  async reorderPhotos(ctx: PartnerContext, orderedIds: string[]) {
    const { ownerId } = requireOwnerIds(ctx);
    assertEditable(ctx);
    const gym = await draftGym(ownerId);
    if (!gym) throw appError('Không tìm thấy chi nhánh', 404, 'NOT_FOUND');
    const photos = await prisma.gymPhoto.findMany({ where: { gymId: gym.id } });
    const known = new Set(photos.map((p) => p.id));
    if (orderedIds.length !== photos.length || !orderedIds.every((id) => known.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
      throw appError('Danh sách sắp xếp không khớp với ảnh hiện có', 400, 'INVALID_ORDER');
    }
    await prisma.$transaction(
      orderedIds.map((id, index) => prisma.gymPhoto.update({ where: { id }, data: { sortOrder: index } })),
    );
    return { ok: true };
  },
};
