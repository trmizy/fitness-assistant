import path from 'path';
import fs from 'fs';
import type { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import type { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { isGymPubliclyVisible } from '../services/gym-public';
import { partnerS3 } from '../services/partner-s3.service';

/**
 * Listing Management B1 — the ONLY way a branch photo's bytes leave gym-service for an anonymous viewer.
 *
 * Replaces `express.static('/uploads/gym-photos')`: a static mount served every file in the directory regardless of what
 * the database said, so a photo that was withdrawn (RETIRED) or never approved (STAGED) stayed reachable by URL. Here
 * every request re-checks the row: the photo must be PUBLISHED and its branch publicly visible (`gymPublicWhere`).
 * Anything else is a plain 404 - the same answer for "no such photo", so nothing can be probed.
 */

/** Presigned GET lifetime for the redirect, and how long the viewer's cache may reuse the redirect itself. */
const PRESIGN_SECONDS = 10 * 60;
const CACHE_CONTROL = 'private, max-age=300';

const PHOTO_DIR = path.resolve(process.cwd(), 'uploads/gym-photos');

function notFound(res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy ảnh' } });
}

async function findVisiblePublishedPhoto(where: Prisma.GymPhotoWhereInput) {
  const photo = await prisma.gymPhoto.findFirst({ where: { ...where, status: 'PUBLISHED' } });
  if (!photo) return null;
  return (await isGymPubliclyVisible(photo.gymId)) ? photo : null;
}

/** Streams a disk photo, refusing anything that would resolve outside the photo directory. */
function sendDiskPhoto(res: Response, fileName: string) {
  const abs = path.resolve(PHOTO_DIR, path.basename(fileName));
  if (path.dirname(abs) !== PHOTO_DIR || !fs.existsSync(abs)) return notFound(res);
  res.set('Cache-Control', CACHE_CONTROL);
  return res.sendFile(abs, (err) => {
    if (err && !res.headersSent) notFound(res);
  });
}

export const gymMediaController = {
  /** GET /media/gym-photos/:photoId - S3 photo: 302 to a 10-minute presigned GET; disk photo: streamed. */
  async servePhoto(req: Request, res: Response) {
    const photo = await findVisiblePublishedPhoto({ id: req.params.photoId });
    if (!photo) return notFound(res);

    if (!photo.s3Key) return sendDiskPhoto(res, photo.fileName);

    try {
      const url = await partnerS3.presignGet({ key: photo.s3Key, attachment: false, expiresSec: PRESIGN_SECONDS });
      res.set('Cache-Control', CACHE_CONTROL);
      return res.redirect(302, url);
    } catch (e) {
      logger.warn({ photoId: photo.id, message: (e as Error)?.message }, '[GymMedia] could not presign a photo');
      return res.status(503).json({ success: false, error: { code: 'MEDIA_UNAVAILABLE', message: 'Chưa tải được ảnh, vui lòng thử lại' } });
    }
  },

  /** GET /uploads/gym-photos/:file - the old static URL (`fileName` of a disk photo), now a checked route. */
  async serveLegacyFile(req: Request, res: Response) {
    const photo = await findVisiblePublishedPhoto({ fileName: req.params.file, s3Key: null });
    if (!photo) return notFound(res);
    return sendDiskPhoto(res, photo.fileName);
  },
};
