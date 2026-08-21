import { logger } from "@gym-coach/shared";
import { SessionStatus } from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { notificationService } from "./notification.service";
import { contractService } from "./contract.service";

const INTERVAL_MS = Number(
  process.env.SESSION_AUTO_CONFIRM_INTERVAL_MS ?? 10 * 60 * 1000,
);
const BATCH_SIZE = 100;

// A session left in PENDING_CLIENT_CONFIRMATION forever would mean the PT never gets
// credited for work they did, so silence past the deadline is read as agreement. The
// client had the full SESSION_AUTO_CONFIRM_DAYS window to dispute, and the auto-approval
// is recorded on the row (`autoConfirmed`) so it is never mistaken for an explicit "yes".
let running = false;

export function startSessionAutoConfirmJob(): void {
  logger.info(
    `Session auto-confirm job started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`,
  );
  setInterval(() => {
    void runAutoConfirm();
  }, INTERVAL_MS);
}

export async function runAutoConfirm(): Promise<{
  scanned: number;
  confirmed: number;
}> {
  // Overlap guard: a slow batch must not be re-entered by the next tick, or two runs
  // would race on the same rows.
  if (running) {
    logger.info("[SessionAutoConfirm] Previous run still in progress — skipping tick");
    return { scanned: 0, confirmed: 0 };
  }
  running = true;

  let scanned = 0;
  let confirmed = 0;
  try {
    const due = await sessionRepository.findExpiredPendingConfirmation(
      new Date(),
      BATCH_SIZE,
    );
    scanned = due.length;
    if (scanned === 0) return { scanned, confirmed };

    logger.info(`[SessionAutoConfirm] ${scanned} session(s) past their confirmation deadline`);

    for (const session of due) {
      try {
        // Same guarded deduction the manual confirm uses: if the client confirmed a
        // moment ago, this claims nothing and the quota is not charged twice.
        const claimed = await sessionRepository.claimDeduction(session.id);
        if (claimed) {
          await contractRepository.incrementSession(session.contractId);
          await contractService.checkAndCompleteContract(session.contractId);
        }

        await sessionRepository.updateStatus(
          session.id,
          SessionStatus.COMPLETED,
          {
            completedAt: new Date(),
            autoConfirmed: true,
            resolutionNote: `Tự động xác nhận sau khi quá hạn phản hồi (${process.env.SESSION_AUTO_CONFIRM_DAYS ?? 3} ngày)`,
          },
        );
        confirmed++;

        await notificationService
          .create({
            userId: session.clientUserId,
            text: "Buổi tập đã được tự động xác nhận do quá hạn phản hồi.",
            eventType: "SESSION_AUTO_CONFIRMED",
            entityType: "SESSION",
            entityId: session.id,
            link: "/client/booking",
          })
          .catch(() => {});
      } catch (err) {
        // One bad row must not stop the sweep — the rest still settle.
        logger.error({
          error: "Auto-confirm failed for session",
          sessionId: session.id,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[SessionAutoConfirm] Auto-confirmed ${confirmed}/${scanned} session(s)`);
    return { scanned, confirmed };
  } catch (err) {
    logger.error({
      error: "Session auto-confirm sweep failed",
      message: (err as Error).message,
    });
    return { scanned, confirmed };
  } finally {
    running = false;
  }
}
