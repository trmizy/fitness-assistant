/**
 * PT physique photo upload (plan §12.2, §12.13 item 11, B5/B6).
 *
 *   presign   -> a PtMediaUploadIntent + a presigned POST (size range 1..8 MB and Content-Type signed into the policy,
 *                key chosen by the SERVER: pt-physique/<userId>/<uuid>)
 *   confirm   -> the intent is claimed with a conditional UPDATE PENDING -> CONFIRMING (a replay or a race is 409),
 *                the object is HEADed for metadata, read IN FULL (<= 8 MB) and judged on its REAL bytes:
 *                magic bytes, sha256 (never a client hash), then decoded by sharp (limitInputPixels 40 MP,
 *                failOn 'error'), auto-rotated, resized to <= 2048 px and RE-ENCODED to WebP. Re-encoding strips
 *                EXIF/GPS and kills polyglot files. The normalized object becomes the photo's file, the original
 *                is deleted. A failure at any step deletes the object(s) and turns the intent REJECTED.
 *   The photo row is written with INSERT ... ON CONFLICT DO NOTHING RETURNING on the (pt_user_id, content_hash)
 *   partial unique index, never by catching a unique violation: the same file uploaded twice (even concurrently)
 *   answers with the SAME photoId and the surplus object is deleted.
 *
 * Photos are created STAGED. Nothing here makes a photo public - only an approved revision does.
 */
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { ptMediaStorage } from "./pt-media-s3.service";
import { ListingError, MAX_STAGED_PHOTOS } from "./pt-listing.schemas";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_EDGE_PX = 2048;
export const INTENT_TTL_MS = 10 * 60 * 1000;
/** A PT may have this many unconfirmed, unexpired presigns lying around (spam guard). */
const MAX_OPEN_INTENTS = 20;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_PREFIX = "pt-physique";
/** Lifetime of a presigned GET handed out inside an authenticated preview/owner response. */
export const STAGED_URL_TTL_SEC = 15 * 60;

/** Magic bytes of the three formats allowed. Judges the real bytes, never the declared type or the file name. */
export function detectImageType(b: Uint8Array): (typeof ALLOWED)[number] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Decode -> orient -> shrink -> WebP. Throws on anything that is not a clean, small-enough image. */
export async function normalizeImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const invalid = (message: string, code = "IMAGE_INVALID") => new ListingError(422, code, message);

async function dropObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await ptMediaStorage().deleteObject(key);
  } catch (e) {
    logger.warn({ key, err: (e as Error).message }, "[PtPhysique] could not delete object (the sweep will retry)");
  }
}

export interface StagedPhotoView {
  id: string;
  status: string;
  url: string;
  expiresAt: string | null;
  isCover: boolean;
  sortOrder: number;
}

/** A photo as the OWNER/ADMIN sees it: STAGED gets a short presigned GET (with expiry), PUBLISHED the stable /media URL. */
export async function toOwnerPhotoView(p: { id: string; status: string; storageKey: string; isCover: boolean; sortOrder: number }): Promise<StagedPhotoView> {
  if (p.status === "PUBLISHED") {
    return { id: p.id, status: p.status, url: `/media/pt-physique/${p.id}`, expiresAt: null, isCover: p.isCover, sortOrder: p.sortOrder };
  }
  const url = await ptMediaStorage().presignGet({ key: p.storageKey, contentType: "image/webp", expiresSec: STAGED_URL_TTL_SEC });
  return {
    id: p.id,
    status: p.status,
    url,
    expiresAt: new Date(Date.now() + STAGED_URL_TTL_SEC * 1000).toISOString(),
    isCover: p.isCover,
    sortOrder: p.sortOrder,
  };
}

export const ptPhysiqueUploadService = {
  async presign(ptUserId: string, contentType: string) {
    const storage = ptMediaStorage();
    if (!storage.isConfigured()) {
      throw new ListingError(503, "UPLOADS_UNAVAILABLE", "Tính năng tải ảnh chưa được cấu hình trên môi trường này");
    }
    const [staged, openIntents] = await Promise.all([
      prisma.ptPhysiquePhoto.count({ where: { ptUserId, status: "STAGED" } }),
      prisma.ptMediaUploadIntent.count({ where: { ptUserId, status: "PENDING", expiresAt: { gt: new Date() } } }),
    ]);
    if (staged >= MAX_STAGED_PHOTOS) {
      throw new ListingError(422, "STAGED_LIMIT", `Bạn đang có ${MAX_STAGED_PHOTOS} ảnh chờ dùng. Hãy xóa bớt ảnh chưa dùng trước khi tải thêm.`);
    }
    if (openIntents >= MAX_OPEN_INTENTS) {
      throw new ListingError(429, "TOO_MANY_UPLOADS", "Bạn đang tải quá nhiều ảnh cùng lúc. Vui lòng thử lại sau ít phút.");
    }

    const intentId = randomUUID();
    const objectKey = `${PHOTO_PREFIX}/${ptUserId}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    const { url, fields } = await storage.presignUpload({ key: objectKey, contentType, maxBytes: MAX_PHOTO_BYTES, expiresSec: INTENT_TTL_MS / 1000 });
    await prisma.ptMediaUploadIntent.create({ data: { id: intentId, ptUserId, objectKey, expiresAt } });
    return { uploadId: intentId, url, fields, method: "POST", maxBytes: MAX_PHOTO_BYTES, contentType, expiresAt: expiresAt.toISOString() };
  },

  async confirm(ptUserId: string, uploadId: string) {
    const storage = ptMediaStorage();
    const intent = await prisma.ptMediaUploadIntent.findFirst({ where: { id: uploadId, ptUserId } });
    if (!intent) throw new ListingError(404, "UPLOAD_NOT_FOUND", "Không tìm thấy lượt tải ảnh này");

    // Claim it. Two confirms racing, or a replay, leave exactly one winner.
    const claimed = await prisma.ptMediaUploadIntent.updateMany({
      where: { id: uploadId, ptUserId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "CONFIRMING" },
    });
    if (claimed.count === 0) {
      const now = await prisma.ptMediaUploadIntent.findUnique({ where: { id: uploadId } });
      if (now && now.status === "PENDING") {
        throw new ListingError(409, "INTENT_EXPIRED", "Lượt tải ảnh đã hết hạn. Hãy tải ảnh lại.");
      }
      throw new ListingError(409, "INTENT_ALREADY_USED", "Lượt tải ảnh này đã được xử lý.");
    }

    const originalKey = intent.objectKey;
    const photoId = randomUUID();
    const finalKey = `${PHOTO_PREFIX}/${ptUserId}/${photoId}.webp`;
    let finalWritten = false;
    try {
      const staged = await prisma.ptPhysiquePhoto.count({ where: { ptUserId, status: "STAGED" } });
      if (staged >= MAX_STAGED_PHOTOS) {
        throw new ListingError(422, "STAGED_LIMIT", `Bạn đang có ${MAX_STAGED_PHOTOS} ảnh chờ dùng. Hãy xóa bớt ảnh chưa dùng trước.`);
      }

      const head = await storage.head(originalKey);
      if (!head) throw invalid("Chưa thấy tệp ảnh nào được tải lên cho lượt này.", "IMAGE_MISSING");
      if (!head.contentLength || head.contentLength <= 0) throw invalid("Tệp ảnh rỗng.");
      if (head.contentLength > MAX_PHOTO_BYTES) throw invalid("Ảnh vượt quá 8 MB.", "IMAGE_TOO_LARGE");

      let body: Buffer | null;
      try {
        body = await storage.getObject(originalKey, MAX_PHOTO_BYTES);
      } catch (e: any) {
        if (e?.tooLarge) throw invalid("Ảnh vượt quá 8 MB.", "IMAGE_TOO_LARGE");
        throw e;
      }
      if (!body || body.length === 0) throw invalid("Chưa thấy tệp ảnh nào được tải lên cho lượt này.", "IMAGE_MISSING");

      // 1. magic bytes on the real bytes; the declared type (what S3 stored) must agree with them
      const real = detectImageType(body);
      if (!real) throw invalid("Tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ.");
      if (head.contentType && head.contentType !== real) throw invalid("Loại tệp không khớp với nội dung ảnh.");

      // 2. hash of the real bytes - never a client-supplied value
      const contentHash = createHash("sha256").update(body).digest("hex");

      // 3. decode + normalize (strips EXIF/GPS, bounded size)
      let normalized: { data: Buffer; width: number; height: number };
      try {
        normalized = await normalizeImage(body);
      } catch (e) {
        logger.info({ err: (e as Error).message }, "[PtPhysique] image rejected by decoder");
        throw invalid("Ảnh bị hỏng, quá lớn hoặc không đọc được. Hãy chọn ảnh khác.");
      }

      await storage.putObject({ key: finalKey, body: normalized.data, contentType: "image/webp" });
      finalWritten = true;

      // 4. the row: INSERT ... ON CONFLICT DO NOTHING RETURNING (no error handling by catching P2002)
      const insertOnce = () =>
        prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO pt_physique_photos (id, pt_user_id, storage_key, status, sort_order, is_cover, mime, bytes, content_hash, uploaded_by, created_at)
          VALUES (${photoId}, ${ptUserId}, ${finalKey}, 'STAGED'::"PtPhysiquePhotoStatus", 0, false, 'image/webp', ${normalized.data.length}, ${contentHash}, ${ptUserId}, now())
          ON CONFLICT (pt_user_id, content_hash) WHERE status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL DO NOTHING
          RETURNING id`);
      let resultId: string | null = null;
      let deduplicated = false;
      for (let attempt = 0; attempt < 3 && !resultId; attempt++) {
        const inserted = await insertOnce();
        if (inserted.length > 0) {
          resultId = inserted[0].id;
          break;
        }
        const existing = await prisma.ptPhysiquePhoto.findFirst({
          where: { ptUserId, contentHash, status: { in: ["STAGED", "PUBLISHED"] } },
          select: { id: true },
        });
        if (existing) {
          resultId = existing.id;
          deduplicated = true;
        }
        // else: the winner vanished between our two statements (retired/discarded) - insert again
      }
      if (!resultId) throw new ListingError(409, "UPLOAD_CONFLICT", "Không lưu được ảnh. Vui lòng thử lại.");

      if (deduplicated) {
        await dropObject(finalKey); // our surplus copy
        finalWritten = false;
      }
      await prisma.ptMediaUploadIntent.updateMany({ where: { id: uploadId, status: "CONFIRMING" }, data: { status: "CONFIRMED" } });
      await dropObject(originalKey);

      const photo = await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: resultId } });
      return { photo: await toOwnerPhotoView(photo), deduplicated };
    } catch (error) {
      await dropObject(originalKey);
      if (finalWritten) await dropObject(finalKey);
      await prisma.ptMediaUploadIntent.updateMany({ where: { id: uploadId, status: "CONFIRMING" }, data: { status: "REJECTED" } }).catch(() => {});
      throw error;
    }
  },

  /**
   * Deletes a photo that is not public yet. A STAGED photo in an open DRAFT is taken out of that draft (draft
   * version +1); one in a PENDING revision cannot go (409) - withdraw first. PUBLISHED photos leave only through
   * an approved revision.
   */
  async deleteStaged(ptUserId: string, photoId: string) {
    const objectKey = await prisma.$transaction(async (tx) => {
      const photos = await tx.$queryRaw<{ id: string; status: string; storage_key: string }[]>(Prisma.sql`
        SELECT id, status::text AS status, storage_key FROM pt_physique_photos
         WHERE id = ${photoId} AND pt_user_id = ${ptUserId} FOR UPDATE`);
      const photo = photos[0];
      if (!photo || photo.status === "DISCARDED" || photo.status === "RETIRED") {
        throw new ListingError(404, "PHOTO_NOT_FOUND", "Không tìm thấy ảnh");
      }
      if (photo.status === "PUBLISHED") {
        throw new ListingError(409, "PHOTO_PUBLISHED", "Ảnh đang hiển thị công khai. Hãy bỏ ảnh khỏi bản sửa và gửi duyệt.");
      }
      const open = await tx.$queryRaw<{ id: string; status: string; payload: any; draft_version: number }[]>(Prisma.sql`
        SELECT id, status::text AS status, payload, draft_version FROM pt_listing_revisions
         WHERE pt_user_id = ${ptUserId} AND status IN ('DRAFT','PENDING') FOR UPDATE`);
      const rev = open[0];
      const inPayload = rev && Array.isArray(rev.payload?.photoIds) && rev.payload.photoIds.includes(photoId);
      if (rev && inPayload) {
        if (rev.status === "PENDING") {
          throw new ListingError(409, "PHOTO_IN_REVIEW", "Ảnh đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi xóa ảnh.");
        }
        const photoIds = (rev.payload.photoIds as string[]).filter((id) => id !== photoId);
        const cover = rev.payload.coverPhotoId === photoId ? (photoIds[0] ?? null) : rev.payload.coverPhotoId;
        await tx.ptListingRevision.updateMany({
          where: { id: rev.id, status: "DRAFT" },
          data: { payload: { ...rev.payload, photoIds, coverPhotoId: cover }, draftVersion: { increment: 1 } },
        });
      }
      await tx.ptPhysiquePhoto.update({ where: { id: photoId }, data: { status: "DISCARDED" } });
      return photo.storage_key;
    });
    await dropObject(objectKey);
    return { deleted: true };
  },
};
