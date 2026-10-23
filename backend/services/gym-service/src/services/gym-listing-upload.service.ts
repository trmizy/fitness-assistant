/**
 * Branch photo upload (plan §12.2, §12.13 item 11, B5/B6) - the same pipeline as user-service's PT physique upload,
 * built on the partner S3 pipeline (bucket `gymini-partner-private`, prefix `listing-photos/<gymId>/`).
 *
 *   presign   -> a PartnerUploadIntent + a presigned POST (size range 1..8 MB and Content-Type signed into the policy,
 *                key chosen by the SERVER: listing-photos/<gymId>/<uuid>)
 *   confirm   -> the intent is claimed with a conditional UPDATE (confirmed_at IS NULL AND not expired); a replay or a
 *                race is 409. The object is HEADed for metadata, read IN FULL (<= 8 MB) and judged on its REAL bytes:
 *                magic bytes, sha256 (never a client hash), then decoded by sharp (limitInputPixels 40 MP,
 *                failOn 'error'), auto-rotated, resized to <= 2048 px and RE-ENCODED to WebP. Re-encoding strips
 *                EXIF/GPS and kills polyglot files. The normalized object becomes the photo's file, the original
 *                is deleted. A failure at any step deletes the object(s); the claimed intent can never be used again.
 *   The photo row is written with INSERT ... ON CONFLICT DO NOTHING RETURNING on the (gym_id, content_hash) partial
 *   unique index, never by catching a unique violation: the same file uploaded twice (even concurrently) answers with
 *   the SAME photoId and the surplus object is deleted.
 *
 * Photos are created STAGED. Nothing here makes a photo public - an approved revision does (or, for a branch that has
 * never been public, its first approval: publishStagedGymPhotosTx).
 *
 * The same presign / confirm serve a DRAFT branch (the add-branch wizard's Photos step, whose disk route is retired),
 * and an ADMIN (who uploads, then puts the photo in the listing with a direct edit).
 *
 * `partner_upload_intents` has no status column (the user-service twin has PENDING/CONFIRMING/CONFIRMED/REJECTED), so
 * "PENDING -> CONFIRMING" is the atomic claim of `confirmed_at`; a claim that never finished is cleaned by the sweep.
 */
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { detectContentType } from './partner-upload.rules';
import { listingPhotoKeys, listingPhotoStorage } from './listing-photo-storage';
import { ListingError, MAX_GYM_PHOTOS, MAX_STAGED_PHOTOS } from './gym-listing.schemas';
import { requireGymExists, requireOwnedListingGym, resolvePartnerId, toPhotoView } from './gym-listing.helpers';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_EDGE_PX = 2048;
export const INTENT_TTL_MS = 10 * 60 * 1000;
/** A caller may have this many unconfirmed, unexpired presigns lying around per branch (spam guard). */
const MAX_OPEN_INTENTS = 20;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Magic bytes of the three formats allowed. Judges the real bytes, never the declared type or the file name. */
export function detectImageType(b: Uint8Array): (typeof ALLOWED)[number] | null {
  const t = detectContentType(b);
  return t && (ALLOWED as readonly string[]).includes(t) ? (t as (typeof ALLOWED)[number]) : null;
}

/** Decode -> orient -> shrink -> WebP. Throws on anything that is not a clean, small-enough image. */
export async function normalizeImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const invalid = (message: string, code = 'IMAGE_INVALID') => new ListingError(422, code, message);

async function dropObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await listingPhotoStorage().deleteObject(key);
  } catch (e) {
    logger.warn({ key, err: (e as Error).message }, '[GymListingUpload] could not delete object (the sweep will retry)');
  }
}

/** Who is uploading: the owner of the branch (any status, DRAFT included) or an admin (any branch). */
export type UploadActor = { kind: 'OWNER'; userId: string; ownerId: string } | { kind: 'ADMIN'; userId: string };

async function resolveGym(gymId: string, actor: UploadActor) {
  return actor.kind === 'OWNER'
    ? requireOwnedListingGym(prisma, gymId, actor.ownerId, { allowDraft: true })
    : requireGymExists(prisma, gymId, { allowDraft: true });
}

/** Photos that count against the branch right now: STAGED + PUBLISHED. */
const livePhotos = (gymId: string) => prisma.gymPhoto.count({ where: { gymId, status: { in: ['STAGED', 'PUBLISHED'] } } });

/** The caps of §B5/B6: a DRAFT branch (the wizard) holds at most 20 photos; any other branch at most 40 STAGED ones. */
async function assertRoom(gym: { id: string; status: string }) {
  if (gym.status === 'DRAFT') {
    if ((await livePhotos(gym.id)) >= MAX_GYM_PHOTOS) {
      throw new ListingError(422, 'PHOTO_LIMIT', `Mỗi chi nhánh có tối đa ${MAX_GYM_PHOTOS} ảnh.`);
    }
    return;
  }
  const staged = await prisma.gymPhoto.count({ where: { gymId: gym.id, status: 'STAGED' } });
  if (staged >= MAX_STAGED_PHOTOS) {
    throw new ListingError(422, 'STAGED_LIMIT', `Chi nhánh đang có ${MAX_STAGED_PHOTOS} ảnh chờ dùng. Hãy xóa bớt ảnh chưa dùng trước khi tải thêm.`);
  }
}

/** The wizard's reorder / cover endpoints exist for a DRAFT branch only; every other branch edits photos through its revision payload. */
function assertDraft(gym: { status: string }) {
  if (gym.status !== 'DRAFT') {
    throw new ListingError(409, 'GYM_NOT_DRAFT', 'Chi nhánh đã gửi duyệt nên ảnh được sắp xếp trong bản sửa tin đăng, không dùng thao tác này.');
  }
}

export const gymListingUploadService = {
  async presign(gymId: string, actor: UploadActor, contentType: string) {
    const storage = listingPhotoStorage();
    if (!storage.isConfigured()) {
      throw new ListingError(503, 'UPLOADS_UNAVAILABLE', 'Tính năng tải ảnh chưa được cấu hình trên môi trường này');
    }
    const gym = await resolveGym(gymId, actor);
    const partnerId = await resolvePartnerId(prisma, gym);
    if (!partnerId) {
      throw new ListingError(409, 'PARTNER_REQUIRED', 'Chi nhánh này chưa gắn với hồ sơ đối tác nên chưa tải ảnh lên được.');
    }
    await assertRoom(gym);
    const openIntents = await prisma.partnerUploadIntent.count({
      where: {
        gymId,
        kind: 'PHOTO',
        createdBy: actor.userId,
        confirmedAt: null,
        expiresAt: { gt: new Date() },
        objectKey: { startsWith: listingPhotoKeys.prefixOf(gymId) },
      },
    });
    if (openIntents >= MAX_OPEN_INTENTS) {
      throw new ListingError(429, 'TOO_MANY_UPLOADS', 'Bạn đang tải quá nhiều ảnh cùng lúc. Vui lòng thử lại sau ít phút.');
    }

    const objectKey = listingPhotoKeys.original(gymId, randomUUID());
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    const { url, fields } = await storage.presignUpload({ key: objectKey, contentType, maxBytes: MAX_PHOTO_BYTES, expiresSec: INTENT_TTL_MS / 1000 });
    const intent = await prisma.partnerUploadIntent.create({
      data: {
        partnerId,
        kind: 'PHOTO',
        gymId,
        photoCategory: 'OTHER',
        objectKey,
        contentType,
        maxBytes: MAX_PHOTO_BYTES,
        createdBy: actor.userId,
        expiresAt,
      },
    });
    return { uploadId: intent.id, url, fields, method: 'POST', maxBytes: MAX_PHOTO_BYTES, contentType, expiresAt: expiresAt.toISOString() };
  },

  async confirm(gymId: string, actor: UploadActor, uploadId: string) {
    const storage = listingPhotoStorage();
    const gym = await resolveGym(gymId, actor);
    // The same answer for "no such intent", "somebody else's intent" and "another branch's intent".
    const intent = await prisma.partnerUploadIntent.findFirst({
      where: { id: uploadId, gymId, kind: 'PHOTO', createdBy: actor.userId, objectKey: { startsWith: listingPhotoKeys.prefixOf(gymId) } },
    });
    if (!intent) throw new ListingError(404, 'UPLOAD_NOT_FOUND', 'Không tìm thấy lượt tải ảnh này');

    // Claim it. Two confirms racing, or a replay, leave exactly one winner.
    const claimed = await prisma.partnerUploadIntent.updateMany({
      where: { id: uploadId, confirmedAt: null, expiresAt: { gt: new Date() } },
      data: { confirmedAt: new Date() },
    });
    if (claimed.count === 0) {
      const now = await prisma.partnerUploadIntent.findUnique({ where: { id: uploadId } });
      if (now && now.confirmedAt === null) {
        throw new ListingError(409, 'INTENT_EXPIRED', 'Lượt tải ảnh đã hết hạn. Hãy tải ảnh lại.');
      }
      throw new ListingError(409, 'INTENT_ALREADY_USED', 'Lượt tải ảnh này đã được xử lý.');
    }

    const originalKey = intent.objectKey;
    const photoId = randomUUID();
    const finalKey = listingPhotoKeys.final(gymId, intent.id);
    let finalWritten = false;
    try {
      await assertRoom(gym);

      const head = await storage.head(originalKey);
      if (!head) throw invalid('Chưa thấy tệp ảnh nào được tải lên cho lượt này.', 'IMAGE_MISSING');
      if (!head.contentLength || head.contentLength <= 0) throw invalid('Tệp ảnh rỗng.');
      if (head.contentLength > MAX_PHOTO_BYTES) throw invalid('Ảnh vượt quá 8 MB.', 'IMAGE_TOO_LARGE');

      let body: Buffer | null;
      try {
        body = await storage.getObject(originalKey, MAX_PHOTO_BYTES);
      } catch (e: any) {
        if (e?.tooLarge) throw invalid('Ảnh vượt quá 8 MB.', 'IMAGE_TOO_LARGE');
        throw e;
      }
      if (!body || body.length === 0) throw invalid('Chưa thấy tệp ảnh nào được tải lên cho lượt này.', 'IMAGE_MISSING');

      // 1. magic bytes on the real bytes; the declared type (what S3 stored) must agree with them
      const real = detectImageType(body);
      if (!real) throw invalid('Tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ.');
      if (head.contentType && head.contentType !== real) throw invalid('Loại tệp không khớp với nội dung ảnh.');

      // 2. hash of the real bytes - never a client-supplied value
      const contentHash = createHash('sha256').update(body).digest('hex');

      // 3. decode + normalize (strips EXIF/GPS, bounded size)
      let normalized: { data: Buffer; width: number; height: number };
      try {
        normalized = await normalizeImage(body);
      } catch (e) {
        logger.info({ err: (e as Error).message }, '[GymListingUpload] image rejected by decoder');
        throw invalid('Ảnh bị hỏng, quá lớn hoặc không đọc được. Hãy chọn ảnh khác.');
      }

      await storage.putObject({ key: finalKey, body: normalized.data, contentType: 'image/webp' });
      finalWritten = true;

      // 4. the row: INSERT ... ON CONFLICT DO NOTHING RETURNING (no error handling by catching P2002).
      // A DRAFT branch's photos are an ordered gallery from the start (first = cover, flags normalised again at the
      // first approval); on any other branch a STAGED photo has no position until a revision puts it in the listing.
      const position = gym.status === 'DRAFT' ? await livePhotos(gymId) : 0;
      const insertOnce = () =>
        prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO gym_photos (id, gym_id, file_name, sort_order, is_cover, s3_key, category, visibility, created_at, status, content_hash, uploaded_by)
          VALUES (${photoId}, ${gymId}, ${`${intent.id}.webp`}, ${position}, ${gym.status === 'DRAFT' && position === 0},
                  ${finalKey}, 'OTHER'::"GymPhotoCategory", 'PRIVATE'::"GymPhotoVisibility", now(), 'STAGED'::"GymPhotoStatus", ${contentHash}, ${actor.userId})
          ON CONFLICT (gym_id, content_hash) WHERE status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL DO NOTHING
          RETURNING id`);
      let resultId: string | null = null;
      let deduplicated = false;
      for (let attempt = 0; attempt < 3 && !resultId; attempt++) {
        const inserted = await insertOnce();
        if (inserted.length > 0) {
          resultId = inserted[0].id;
          break;
        }
        const existing = await prisma.gymPhoto.findFirst({
          where: { gymId, contentHash, status: { in: ['STAGED', 'PUBLISHED'] } },
          select: { id: true },
        });
        if (existing) {
          resultId = existing.id;
          deduplicated = true;
        }
        // else: the winner vanished between our two statements (retired / discarded) - insert again
      }
      if (!resultId) throw new ListingError(409, 'UPLOAD_CONFLICT', 'Không lưu được ảnh. Vui lòng thử lại.');

      if (deduplicated) {
        await dropObject(finalKey); // our surplus copy, after the existing row is known to be committed
        finalWritten = false;
      }
      await dropObject(originalKey);

      const photo = await prisma.gymPhoto.findUniqueOrThrow({ where: { id: resultId } });
      return { photo: await toPhotoView(photo), deduplicated };
    } catch (error) {
      await dropObject(originalKey);
      if (finalWritten) await dropObject(finalKey);
      throw error;
    }
  },

  /**
   * PUT /owner/gyms/:id/listing/photos/reorder {photoIds} - the add-branch wizard's order of its STAGED photos. Only a DRAFT
   * branch (any other uses the revision payload): 409 GYM_NOT_DRAFT. `photoIds` must be EXACTLY the branch's STAGED photos
   * (422 PHOTO_SET_MISMATCH otherwise); sort_order becomes 0..n-1 in that order, the current cover stays the cover (the first
   * photo when there is none).
   */
  async reorderDraftPhotos(gymId: string, ownerId: string, photoIds: string[]) {
    const rows = await prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId, { anyStatus: true });
      assertDraft(gym);
      const live = await tx.$queryRaw<{ id: string; is_cover: boolean }[]>(Prisma.sql`
        SELECT id, is_cover FROM gym_photos WHERE gym_id = ${gymId} AND status = 'STAGED' ORDER BY id FOR UPDATE`);
      const have = new Set(live.map((r) => r.id));
      if (new Set(photoIds).size !== photoIds.length || photoIds.length !== have.size || photoIds.some((id) => !have.has(id))) {
        throw new ListingError(422, 'PHOTO_SET_MISMATCH', 'Danh sách sắp xếp phải gồm đúng các ảnh hiện có của chi nhánh, mỗi ảnh một lần.');
      }
      const cover = live.find((r) => r.is_cover)?.id ?? photoIds[0];
      for (let i = 0; i < photoIds.length; i++) {
        await tx.gymPhoto.update({ where: { id: photoIds[i] }, data: { sortOrder: i, isCover: photoIds[i] === cover } });
      }
      return tx.gymPhoto.findMany({ where: { gymId, status: 'STAGED' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    });
    return { photos: await Promise.all(rows.map(toPhotoView)) };
  },

  /** PATCH /owner/gyms/:id/listing/photos/:photoId/cover - exactly one STAGED photo of a DRAFT branch is the cover. */
  async setDraftCover(gymId: string, ownerId: string, photoId: string) {
    const rows = await prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId, { anyStatus: true });
      assertDraft(gym);
      const live = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM gym_photos WHERE gym_id = ${gymId} AND status = 'STAGED' ORDER BY id FOR UPDATE`);
      if (!live.some((r) => r.id === photoId)) throw new ListingError(404, 'PHOTO_NOT_FOUND', 'Không tìm thấy ảnh');
      await tx.gymPhoto.updateMany({ where: { gymId, status: 'STAGED', isCover: true, id: { not: photoId } }, data: { isCover: false } });
      await tx.gymPhoto.update({ where: { id: photoId }, data: { isCover: true } });
      return tx.gymPhoto.findMany({ where: { gymId, status: 'STAGED' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    });
    return { photos: await Promise.all(rows.map(toPhotoView)) };
  },

  /**
   * Deletes a photo that is not public yet. A STAGED photo in an open DRAFT is taken out of that draft (draft
   * version +1); one in a PENDING revision cannot go (409) - withdraw first. PUBLISHED photos leave only through
   * an approved revision. On a DRAFT branch (the wizard) the remaining photos are renumbered and a cover is kept.
   * Lock order: open revision -> photo (the same order the apply transaction uses).
   */
  async deleteStaged(gymId: string, ownerId: string, photoId: string) {
    const s3Key = await prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId, { allowDraft: true });
      const open = await tx.$queryRaw<{ id: string; status: string; payload: any }[]>(Prisma.sql`
        SELECT id, status::text AS status, payload FROM gym_listing_revisions
         WHERE gym_id = ${gymId} AND status IN ('DRAFT','PENDING') FOR UPDATE`);
      const photos = await tx.$queryRaw<{ id: string; status: string; s3_key: string | null; is_cover: boolean }[]>(Prisma.sql`
        SELECT id, status::text AS status, s3_key, is_cover FROM gym_photos WHERE id = ${photoId} AND gym_id = ${gymId} FOR UPDATE`);
      const photo = photos[0];
      if (!photo || photo.status === 'DISCARDED' || photo.status === 'RETIRED') {
        throw new ListingError(404, 'PHOTO_NOT_FOUND', 'Không tìm thấy ảnh');
      }
      if (photo.status === 'PUBLISHED') {
        throw new ListingError(409, 'PHOTO_PUBLISHED', 'Ảnh đang hiển thị công khai. Hãy bỏ ảnh khỏi bản sửa và gửi duyệt.');
      }
      const rev = open[0];
      if (rev && Array.isArray(rev.payload?.photoIds) && rev.payload.photoIds.includes(photoId)) {
        if (rev.status === 'PENDING') {
          throw new ListingError(409, 'PHOTO_IN_REVIEW', 'Ảnh đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi xóa ảnh.');
        }
        const photoIds = (rev.payload.photoIds as string[]).filter((id) => id !== photoId);
        const cover = rev.payload.coverPhotoId === photoId ? (photoIds[0] ?? null) : rev.payload.coverPhotoId;
        await tx.gymListingRevision.updateMany({
          where: { id: rev.id, status: 'DRAFT' },
          data: { payload: { ...rev.payload, photoIds, coverPhotoId: cover }, draftVersion: { increment: 1 } },
        });
      }
      await tx.gymPhoto.update({ where: { id: photoId }, data: { status: 'DISCARDED', isCover: false } });
      if (gym.status === 'DRAFT') {
        const rest = await tx.gymPhoto.findMany({
          where: { gymId, status: { in: ['STAGED', 'PUBLISHED'] } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const coverId = (rest.find((r) => r.isCover) ?? rest[0])?.id;
        for (let i = 0; i < rest.length; i++) {
          const wantCover = rest[i].id === coverId;
          if (rest[i].sortOrder !== i || rest[i].isCover !== wantCover) {
            await tx.gymPhoto.update({ where: { id: rest[i].id }, data: { sortOrder: i, isCover: wantCover } });
          }
        }
      }
      return photo.s3_key;
    });
    await dropObject(s3Key);
    return { deleted: true };
  },
};
