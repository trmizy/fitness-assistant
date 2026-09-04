import { logger } from "@gym-coach/shared";
import { SessionStatus } from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "./notification.service";
import { deductQuotaOnce } from "./booking.service";

const INTERVAL_MS = Number(
  process.env.SESSION_AUTO_CONFIRM_INTERVAL_MS ?? 10 * 60 * 1000,
);
const BATCH_SIZE = 100;

// A session left in PENDING_CLIENT_CONFIRMATION forever would mean the PT never gets
// credited for work they did, so silence past the deadline is read as agreement. The
// client had the full SESSION_AUTO_CONFIRM_DAYS window to dispute, and the auto-approval
// is recorded on the row (`autoConfirmed`) so it is never mistaken for an explicit "yes".
let running = false;

/** Collaborators of {@link runAutoConfirm}, injectable for testing (same pattern as
 * `QuotaDeps`/`CompleteContractDeps`). `deductQuotaOnce` is reused, not re-implemented —
 * money-flow plan 1.3 found this sweep had drifted from the manual-confirm path into its own
 * claimDeduction → incrementSession → checkAndCompleteContract sequence that skipped
 * releaseSessionMoney entirely. Routing both paths through the one function is what stops that
 * drift from happening again, not just what fixes it once. */
export interface AutoConfirmDeps {
  findExpiredPendingConfirmation: (
    before: Date,
    limit: number,
  ) => Promise<Array<{ id: string; contractId: string; clientUserId: string }>>;
  deductQuotaOnce: (sessionId: string, contractId: string) => Promise<boolean>;
  updateStatus: (id: string, status: SessionStatus, extra: Record<string, unknown>) => Promise<unknown>;
  notify: (params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link: string }) => Promise<unknown>;
}

const defaultAutoConfirmDeps: AutoConfirmDeps = {
  findExpiredPendingConfirmation: (before, limit) =>
    sessionRepository.findExpiredPendingConfirmation(before, limit),
  deductQuotaOnce: (sessionId, contractId) => deductQuotaOnce(sessionId, contractId),
  updateStatus: (id, status, extra) => sessionRepository.updateStatus(id, status, extra),
  notify: (params) => notificationService.create(params).catch(() => undefined),
};

export function startSessionAutoConfirmJob(): void {
  logger.info(
    `Session auto-confirm job started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`,
  );
  setInterval(() => {
    void runAutoConfirm();
  }, INTERVAL_MS);
}

export async function runAutoConfirm(
  deps: AutoConfirmDeps = defaultAutoConfirmDeps,
): Promise<{
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
    const due = await deps.findExpiredPendingConfirmation(new Date(), BATCH_SIZE);
    scanned = due.length;
    if (scanned === 0) return { scanned, confirmed };

    logger.info(`[SessionAutoConfirm] ${scanned} session(s) past their confirmation deadline`);

    for (const session of due) {
      try {
        // Same guarded deduction the manual confirm uses — charges the quota, releases the
        // PT's money, and checks contract completion, all in the one place that logic lives.
        // If the client confirmed a moment ago, this claims nothing and nothing is charged
        // or released twice.
        await deps.deductQuotaOnce(session.id, session.contractId);

        await deps.updateStatus(session.id, SessionStatus.COMPLETED, {
          completedAt: new Date(),
          autoConfirmed: true,
          resolutionNote: `Tự động xác nhận sau khi quá hạn phản hồi (${process.env.SESSION_AUTO_CONFIRM_DAYS ?? 3} ngày)`,
        });
        confirmed++;

        await deps.notify({
          userId: session.clientUserId,
          text: "Buổi tập đã được tự động xác nhận do quá hạn phản hồi.",
          eventType: "SESSION_AUTO_CONFIRMED",
          entityType: "SESSION",
          entityId: session.id,
          link: "/client/booking",
        });
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
