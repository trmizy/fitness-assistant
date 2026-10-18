/**
 * Housekeeping for PT listing photos (plan §1 B5 item 5, §12.2, §12.13 items 5 and 11). One tick does three things,
 * each bounded to a batch so a backlog drains over several ticks:
 *
 *  1. Upload intents nobody finished. A PENDING intent whose presign expired more than an hour ago, or a CONFIRMING
 *     one stuck for 5+ minutes (the process confirming it died), becomes REJECTED and its object is deleted.
 *  2. Orphaned STAGED photos -> DISCARDED + file deleted, only when ALL hold:
 *       (a) no OPEN revision (DRAFT/PENDING) lists the photo,
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
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { ptMediaStorage } from "./pt-media-s3.service";
import { trackJob } from "../lifecycle";

const INTERVAL_MS = Number(process.env.PT_LISTING_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);
const BATCH = 100;
const INTENT_GRACE_MS = 60 * 60 * 1000;
const CONFIRMING_STUCK_MS = 5 * 60 * 1000;
const ORPHAN_AGE_DAYS = 7;
const CLOSED_KEEP_DAYS = 30;
const RETIRED_KEEP_DAYS = 90;

let running = false;

export interface PtListingSweepResult {
  skipped: boolean;
  intentsRejected: number;
  orphansDiscarded: number;
  retiredCleaned: number;
  failed: number;
}

async function safeDelete(key: string): Promise<void> {
  await ptMediaStorage().deleteObject(key);
}

export async function runPtListingSweep(now: Date = new Date()): Promise<PtListingSweepResult> {
  if (running) {
    logger.info("[PtListingSweep] previous run still in progress - skipping tick");
    return { skipped: true, intentsRejected: 0, orphansDiscarded: 0, retiredCleaned: 0, failed: 0 };
  }
  running = true;
  const result: PtListingSweepResult = { skipped: false, intentsRejected: 0, orphansDiscarded: 0, retiredCleaned: 0, failed: 0 };
  try {
    if (!ptMediaStorage().isConfigured()) {
      logger.info("[PtListingSweep] media storage not configured - nothing to do");
      return { ...result, skipped: true };
    }

    // 1. dead upload intents
    const expiredBefore = new Date(now.getTime() - INTENT_GRACE_MS);
    const stuckBefore = new Date(now.getTime() - CONFIRMING_STUCK_MS);
    const intents = await prisma.ptMediaUploadIntent.findMany({
      where: { OR: [{ status: "PENDING", expiresAt: { lt: expiredBefore } }, { status: "CONFIRMING", updatedAt: { lt: stuckBefore } }] },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    for (const intent of intents) {
      try {
        await safeDelete(intent.objectKey);
        const res = await prisma.ptMediaUploadIntent.updateMany({
          where: {
            id: intent.id,
            OR: [{ status: "PENDING", expiresAt: { lt: expiredBefore } }, { status: "CONFIRMING", updatedAt: { lt: stuckBefore } }],
          },
          data: { status: "REJECTED" },
        });
        result.intentsRejected += res.count;
      } catch (e) {
        result.failed += 1;
        logger.warn({ intentId: intent.id, err: (e as Error).message }, "[PtListingSweep] could not clean an upload intent");
      }
    }

    // 2. orphaned STAGED photos
    const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM pt_physique_photos p
       WHERE p.status = 'STAGED' AND p.created_at < ${new Date(now.getTime() - ORPHAN_AGE_DAYS * 86_400_000)}
       ORDER BY p.created_at LIMIT ${BATCH}`);
    const closedSince = new Date(now.getTime() - CLOSED_KEEP_DAYS * 86_400_000);
    for (const { id } of candidates) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; storage_key: string }[]>(Prisma.sql`
            SELECT p.id, p.storage_key FROM pt_physique_photos p
             WHERE p.id = ${id} AND p.status = 'STAGED'
               AND NOT EXISTS (
                 SELECT 1 FROM pt_listing_revisions r
                  WHERE r.pt_user_id = p.pt_user_id
                    AND (r.status IN ('DRAFT','PENDING') OR COALESCE(r.reviewed_at, r.updated_at) > ${closedSince})
                    AND r.payload -> 'photoIds' @> to_jsonb(p.id::text))
             FOR UPDATE OF p SKIP LOCKED`);
          if (rows.length === 0) return false;
          await safeDelete(rows[0].storage_key);
          await tx.ptPhysiquePhoto.update({ where: { id }, data: { status: "DISCARDED" } });
          return true;
        });
        if (done) result.orphansDiscarded += 1;
      } catch (e) {
        result.failed += 1;
        logger.warn({ photoId: id, err: (e as Error).message }, "[PtListingSweep] could not discard an orphaned photo");
      }
    }

    // 3. long-retired photos
    const retired = await prisma.ptPhysiquePhoto.findMany({
      where: { status: "RETIRED", retiredAt: { lt: new Date(now.getTime() - RETIRED_KEEP_DAYS * 86_400_000) } },
      orderBy: { retiredAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of retired) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; storage_key: string }[]>(Prisma.sql`
            SELECT id, storage_key FROM pt_physique_photos WHERE id = ${id} AND status = 'RETIRED' FOR UPDATE SKIP LOCKED`);
          if (rows.length === 0) return false;
          await safeDelete(rows[0].storage_key);
          await tx.ptPhysiquePhoto.update({ where: { id }, data: { status: "DISCARDED" } });
          return true;
        });
        if (done) result.retiredCleaned += 1;
      } catch (e) {
        result.failed += 1;
        logger.warn({ photoId: id, err: (e as Error).message }, "[PtListingSweep] could not clean a retired photo");
      }
    }

    if (result.intentsRejected || result.orphansDiscarded || result.retiredCleaned || result.failed) {
      logger.info(result, "[PtListingSweep] tick done");
    }
    return result;
  } finally {
    running = false;
  }
}

/** Starts the periodic sweep; returns the function that stops it (graceful shutdown). */
export function startPtListingSweepJob(): () => void {
  logger.info(`PT listing sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  const timer = setInterval(() => {
    void trackJob(runPtListingSweep().catch((e) => logger.error(e, "[PtListingSweep] tick failed")));
  }, INTERVAL_MS);
  return () => clearInterval(timer);
}
