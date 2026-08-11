import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";

const INTERVAL_MS = Number(
  process.env.RESCHEDULE_EXPIRY_INTERVAL_MS ?? 10 * 60 * 1000,
);
const BATCH_SIZE = 100;

/**
 * Retires reschedule proposals nobody answered in time (VĐ4).
 *
 * The deadline is the session's ORIGINAL start. Past that moment the proposal is moot —
 * accepting it would move a session that has already begun — but an untouched PENDING row
 * would keep blocking the "only one open request" rule forever, so the pair could never
 * negotiate again. Expiring it leaves the session exactly as it was: the original booking,
 * still CONFIRMED, still at the original time.
 *
 * Mirrors session-autoconfirm.service: same interval shape, same overlap guard, same
 * per-batch error isolation.
 */
let running = false;

export function startRescheduleExpiryJob(): void {
  logger.info(
    `Reschedule expiry job started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`,
  );
  setInterval(() => {
    void runRescheduleExpiry();
  }, INTERVAL_MS);
}

export async function runRescheduleExpiry(): Promise<{ expired: number }> {
  // Overlap guard: a slow batch must not be re-entered by the next tick.
  if (running) {
    logger.info("[RescheduleExpiry] Previous run still in progress — skipping tick");
    return { expired: 0 };
  }
  running = true;

  try {
    const now = new Date();
    const stale = await prisma.sessionRescheduleRequest.findMany({
      where: {
        status: "PENDING",
        // originalStartAt is the snapshot taken when the proposal was made, so this stays
        // correct even if the session itself was moved by an earlier accepted request.
        originalStartAt: { lte: now },
      },
      take: BATCH_SIZE,
      select: { id: true, sessionId: true },
    });

    if (stale.length === 0) return { expired: 0 };

    const { count } = await prisma.sessionRescheduleRequest.updateMany({
      // Re-check the status in the write: someone may have answered between the read and
      // here, and an answered request must not be overwritten with EXPIRED.
      where: { id: { in: stale.map((r) => r.id) }, status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    if (count > 0) {
      logger.info(`[RescheduleExpiry] Expired ${count} unanswered reschedule request(s)`);
    }
    return { expired: count };
  } catch (err) {
    logger.error({
      error: "[RescheduleExpiry] sweep failed",
      message: (err as Error).message,
    });
    return { expired: 0 };
  } finally {
    running = false;
  }
}
