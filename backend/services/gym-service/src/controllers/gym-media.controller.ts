import path from 'path';
import fs from 'fs';
import type { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import type { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { isGymPhotoVisible } from '../services/gym-public';
import { partnerS3 } from '../services/partner-s3.service';
import { partnerService } from '../services/partner.service';

/**
 * Listing Management B1 — the ONLY way a branch photo's bytes leave gym-service for an anonymous viewer.
 *
 * Replaces `express.static('/uploads/gym-photos')`: a static mount served every file in the directory regardless of what
 * the database said, so a photo that was withdrawn (RETIRED) or never approved (STAGED) stayed reachable by URL. Here
 * every request re-checks the row: the photo must be PUBLISHED and its branch publicly visible (`gymPublicWhere`) - or approved and only
 * temporarily closed (N15C-06, `gymDetailWhere`: the branch's direct-link page is reachable, so its photos are too).
 * Anything else is a plain 404 - the same answer for "no such photo", so nothing can be probed.
 */

/** Presigned GET lifetime for the redirect, and how long the viewer's cache may reuse the redirect itself. */
const PRESIGN_SECONDS = 10 * 60;
const CACHE_CONTROL = 'private, max-age=300';

const PHOTO_DIR = path.resolve(process.cwd(), 'uploads/gym-photos');

function notFound(res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy ảnh' } });
}

/**
 * N13E-05 / N11D2-01 (14/11/2026): the photos of a TEMPORARILY_CLOSED branch are not public (the strict rule above), but the people who RUN the branch must still see them -
 * the owner pages list these URLs. An authenticated ADMIN, the partner's OWNER, or a MANAGER scoped to that branch may fetch a PUBLISHED photo of a branch that is APPROVED
 * and only temporarily closed. Everyone else (anonymous, customers, other partners, receptionists / accountants, permanently closed or unapproved branches) keeps the 404.
 * Optional auth: no Authorization header = the unchanged public path.
 */
async function canViewTemporarilyClosedPhoto(req: Request, gymId: string): Promise<boolean> {
  const user = req.user;
  if (!user?.userId) return false;
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { id: true, ownerId: true, status: true, operationalStatus: true } });
  if (!gym || gym.status !== 'APPROVED' || gym.operationalStatus !== 'TEMPORARILY_CLOSED') return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'GYM_OWNER') return false;
  try {
    const ctx = await partnerService.resolveContextForUser(user.userId);
    if (ctx.principalUserId !== gym.ownerId) return false;
    if (ctx.role === 'OWNER') return true;
    return ctx.role === 'MANAGER' && ctx.scopedGymIds.includes(gymId);
  } catch {
    return false; // revoked / not activated / unresolved: no access
  }
}

async function findVisiblePublishedPhoto(where: Prisma.GymPhotoWhereInput, req?: Request) {
  const photo = await prisma.gymPhoto.findFirst({ where: { ...where, status: 'PUBLISHED' } });
  if (!photo) return null;
  // N15C-06: public for an open branch AND for an approved, temporarily closed one (its direct-link page is reachable).
  if (await isGymPhotoVisible(photo.gymId)) return photo;
  return req && (await canViewTemporarilyClosedPhoto(req, photo.gymId)) ? photo : null;
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
    const photo = await findVisiblePublishedPhoto({ id: req.params.photoId }, req);
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
    const photo = await findVisiblePublishedPhoto({ fileName: req.params.file, s3Key: null }, req);
    if (!photo) return notFound(res);
    return sendDiskPhoto(res, photo.fileName);
  },
};
