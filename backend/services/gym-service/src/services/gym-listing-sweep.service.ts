/**
 * Housekeeping for branch listing photos (plan §1 B5 item 5, §12.2, §12.13 items 5 and 11). One tick does three things,
 * each bounded to a batch so a backlog drains over several ticks (same shape as user-service's pt-listing-sweep.service):
 *
 *  1. Upload intents nobody finished. A never-claimed intent whose presign expired more than an hour ago, or one that was
 *     CLAIMED (confirmed_at set) 5+ minutes ago but produced no photo (the process confirming it died), has its objects
 *     deleted and its row removed. (`partner_upload_intents` has no status column - see gym-listing-upload.service.ts.)
 *  2. Orphaned STAGED photos -> DISCARDED + file deleted, only when ALL hold:
 *       (a) no OPEN revision (DRAFT/PENDING) lists the photo, and the branch is not one that has never been public
 *           (DRAFT / PENDING_REVIEW / REJECTED branches own their STAGED photos: the first approval publishes them),
 *       (b) no revision CLOSED within the last 30 days lists it (that is how long a closed revision can still be
 *           copied into a new draft),
 *       (c) the photo was created more than 7 days ago.
 *     Each photo is handled in its own transaction with `FOR UPDATE SKIP LOCKED` (a draft being copied holds the row
 *     FOR SHARE and is simply skipped), and the conditions are re-checked inside that transaction.
 *     PUBLISHED photos are never touched.
 *  3. RETIRED photos older than 90 days: the file is deleted and the row moves to DISCARDED (history is kept; the
 *     status says "the file is gone", which is exactly what DISCARDED means).
 *
 * Object deletion happens BEFORE the row changes inside the transaction: if the delete fails, the transaction rolls
 * back and the next tick tries again. Deleting a key that is already gone is not an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { LISTING_PHOTO_PREFIX, listingPhotoKeys, listingPhotoStorage } from './listing-photo-storage';

const INTERVAL_MS = Number(process.env.GYM_LISTING_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);
const BATCH = 100;
const INTENT_GRACE_MS = 60 * 60 * 1000;
const CLAIMED_STUCK_MS = 5 * 60 * 1000;
const DONE_INTENT_KEEP_DAYS = 30;
const ORPHAN_AGE_DAYS = 7;
const CLOSED_KEEP_DAYS = 30;
const RETIRED_KEEP_DAYS = 90;
const DAY = 86_400_000;

let running = false;

export interface GymListingSweepResult {
  skipped: boolean;
  intentsCleaned: number;
  orphansDiscarded: number;
  retiredCleaned: number;
  failed: number;
}

async function deleteStored(s3Key: string | null, fileName: string): Promise<void> {
  if (s3Key) {
    await listingPhotoStorage().deleteObject(s3Key);
    return;
  }
  // A legacy disk photo: best effort, the row is the source of truth.
  try {
    fs.unlinkSync(path.join(process.cwd(), 'uploads/gym-photos', path.basename(fileName)));
  } catch {
    /* already gone */
  }
}

/**
 * `opts.gymIds` restricts the sweep to those branches. Production never passes it; the tests do, so a sweep over a shared
 * test database cannot touch rows another test file is working with.
 */
export async function runGymListingSweep(now: Date = new Date(), opts: { gymIds?: string[] } = {}): Promise<GymListingSweepResult> {
  if (running) {
    logger.info('[GymListingSweep] previous run still in progress - skipping tick');
    return { skipped: true, intentsCleaned: 0, orphansDiscarded: 0, retiredCleaned: 0, failed: 0 };
  }
  running = true;
  const result: GymListingSweepResult = { skipped: false, intentsCleaned: 0, orphansDiscarded: 0, retiredCleaned: 0, failed: 0 };
  try {
    if (!listingPhotoStorage().isConfigured()) {
      logger.info('[GymListingSweep] media storage not configured - nothing to do');
      return { ...result, skipped: true };
    }
    const listingKeys = { startsWith: `${LISTING_PHOTO_PREFIX}/` };
    const gymScope = opts.gymIds ? { gymId: { in: opts.gymIds } } : {};
    const photoScope = opts.gymIds ? Prisma.sql`AND p.gym_id IN (${Prisma.join(opts.gymIds.length ? opts.gymIds : [''])})` : Prisma.empty;

    // 1a. never-claimed intents that expired long ago
    const expiredBefore = new Date(now.getTime() - INTENT_GRACE_MS);
    const abandoned = await prisma.partnerUploadIntent.findMany({
      where: { kind: 'PHOTO', confirmedAt: null, expiresAt: { lt: expiredBefore }, objectKey: listingKeys, ...gymScope },
      orderBy: { expiresAt: 'asc' },
      take: BATCH,
    });
    for (const intent of abandoned) {
      try {
        await listingPhotoStorage().deleteObject(intent.objectKey);
        const res = await prisma.partnerUploadIntent.deleteMany({ where: { id: intent.id, confirmedAt: null } });
        result.intentsCleaned += res.count;
      } catch (e) {
        result.failed += 1;
        logger.warn({ intentId: intent.id, err: (e as Error).message }, '[GymListingSweep] could not clean an upload intent');
      }
    }

    // 1b. claimed a while ago: either a photo exists (done - keep the row for a while) or the claim never finished
    const claimedBefore = new Date(now.getTime() - CLAIMED_STUCK_MS);
    const claimed = await prisma.partnerUploadIntent.findMany({
      where: { kind: 'PHOTO', confirmedAt: { lt: claimedBefore }, objectKey: listingKeys, ...gymScope },
      orderBy: { confirmedAt: 'asc' },
      take: BATCH,
    });
    for (const intent of claimed) {
      try {
        const finalKey = listingPhotoKeys.finalOfIntent(intent.objectKey, intent.id);
        const photo = await prisma.gymPhoto.findFirst({ where: { s3Key: finalKey }, select: { id: true } });
        if (photo) {
          if (intent.confirmedAt && intent.confirmedAt.getTime() < now.getTime() - DONE_INTENT_KEEP_DAYS * DAY) {
            result.intentsCleaned += (await prisma.partnerUploadIntent.deleteMany({ where: { id: intent.id } })).count;
          }
          continue;
        }
        // no photo came out of this claim (crash, rejected image, or the same file already existed): remove both objects
        await listingPhotoStorage().deleteObject(intent.objectKey);
        await listingPhotoStorage().deleteObject(finalKey);
        result.intentsCleaned += (await prisma.partnerUploadIntent.deleteMany({ where: { id: intent.id } })).count;
      } catch (e) {
        result.failed += 1;
        logger.warn({ intentId: intent.id, err: (e as Error).message }, '[GymListingSweep] could not clean a claimed upload intent');
      }
    }

    // 2. orphaned STAGED photos
    const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM gym_photos p JOIN gyms g ON g.id = p.gym_id
       WHERE p.status = 'STAGED' AND p.created_at < ${new Date(now.getTime() - ORPHAN_AGE_DAYS * DAY)}
         AND g.status NOT IN ('DRAFT','PENDING_REVIEW','REJECTED') ${photoScope}
       ORDER BY p.created_at LIMIT ${BATCH}`);
    const closedSince = new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY);
    for (const { id } of candidates) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; s3_key: string | null; file_name: string }[]>(Prisma.sql`
            SELECT p.id, p.s3_key, p.file_name FROM gym_photos p JOIN gyms g ON g.id = p.gym_id
             WHERE p.id = ${id} AND p.status = 'STAGED' AND g.status NOT IN ('DRAFT','PENDING_REVIEW','REJECTED')
               AND NOT EXISTS (
                 SELECT 1 FROM gym_listing_revisions r
                  WHERE r.gym_id = p.gym_id
                    AND (r.status IN ('DRAFT','PENDING') OR COALESCE(r.reviewed_at, r.updated_at) > ${closedSince})
                    AND r.payload -> 'photoIds' @> to_jsonb(p.id::text))
               FOR UPDATE OF p SKIP LOCKED`);
          if (rows.length === 0) return false;
          await deleteStored(rows[0].s3_key, rows[0].file_name);
          await tx.gymPhoto.update({ where: { id }, data: { status: 'DISCARDED', isCover: false } });
          return true;
        });
        if (done) result.orphansDiscarded += 1;
      } catch (e) {
        result.failed += 1;
        logger.warn({ photoId: id, err: (e as Error).message }, '[GymListingSweep] could not discard an orphaned photo');
      }
    }

    // 3. long-retired photos
    const retired = await prisma.gymPhoto.findMany({
      where: { status: 'RETIRED', retiredAt: { lt: new Date(now.getTime() - RETIRED_KEEP_DAYS * DAY) }, ...(opts.gymIds ? { gymId: { in: opts.gymIds } } : {}) },
      orderBy: { retiredAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of retired) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; s3_key: string | null; file_name: string }[]>(Prisma.sql`
            SELECT id, s3_key, file_name FROM gym_photos WHERE id = ${id} AND status = 'RETIRED' FOR UPDATE SKIP LOCKED`);
          if (rows.length === 0) return false;
          await deleteStored(rows[0].s3_key, rows[0].file_name);
          await tx.gymPhoto.update({ where: { id }, data: { status: 'DISCARDED' } });
          return true;
        });
        if (done) result.retiredCleaned += 1;
      } catch (e) {
        result.failed += 1;
        logger.warn({ photoId: id, err: (e as Error).message }, '[GymListingSweep] could not clean a retired photo');
      }
    }

    if (result.intentsCleaned || result.orphansDiscarded || result.retiredCleaned || result.failed) {
      logger.info(result, '[GymListingSweep] tick done');
    }
    return result;
  } finally {
    running = false;
  }
}

/** Starts the periodic sweep; returns the function that stops it (graceful shutdown). */
export function startGymListingSweepJob(): () => void {
  logger.info(`Gym listing sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  const timer = setInterval(() => {
    void runGymListingSweep().catch((e) => logger.error(e, '[GymListingSweep] tick failed'));
  }, INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
