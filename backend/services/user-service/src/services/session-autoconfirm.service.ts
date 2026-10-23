import { logger } from "@gym-coach/shared";
import { SessionStatus } from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "./notification.service";
import { deductQuotaOnce, type DeliveryTransition } from "./booking.service";
import { CONTRACT_ENDING } from "./contract-lock";
import { trackJob } from "../lifecycle";
import {
  activeRestrictedContractIds,
  activeRestrictedPtUserIds,
  getActiveContractRestriction,
  isPtRestricted,
} from "./pt-restriction.service";

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
  ) => Promise<Array<{ id: string; contractId: string; clientUserId: string; ptUserId?: string }>>;
  /** Re-checked right before each session is confirmed (a suspension may have begun since the list was read). */
  isPtRestricted?: (ptUserId: string) => Promise<boolean>;
  /** Same re-check for a contract paused on its own (CONTRACT-scope restriction): only that contract's sessions wait. */
  isContractRestricted?: (contractId: string) => Promise<boolean>;
  /** F3: the confirmation is ONE compare-and-set (PENDING_CLIENT_CONFIRMATION -> COMPLETED + quota claim); true only if this call won it. */
  deductQuotaOnce: (sessionId: string, contractId: string, transition: DeliveryTransition) => Promise<boolean>;
  notify: (params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link: string }) => Promise<unknown>;
}

const defaultAutoConfirmDeps: AutoConfirmDeps = {
  findExpiredPendingConfirmation: async (before, limit) =>
    sessionRepository.findExpiredPendingConfirmation(before, limit, await activeRestrictedPtUserIds(), await activeRestrictedContractIds()),
  isPtRestricted: (ptUserId) => isPtRestricted(ptUserId),
  isContractRestricted: async (contractId) => (await getActiveContractRestriction(contractId)) !== null,
  deductQuotaOnce: (sessionId, contractId, transition) => deductQuotaOnce(sessionId, contractId, undefined, transition),
  notify: (params) => notificationService.create(params).catch(() => undefined),
};

/** Starts the periodic job; returns the function that stops it (graceful shutdown). */
export function startSessionAutoConfirmJob(): () => void {
  logger.info(
    `Session auto-confirm job started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`,
  );
  const timer = setInterval(() => {
    void trackJob(runAutoConfirm());
  }, INTERVAL_MS);
  return () => clearInterval(timer);
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
        // Nothing is auto-decided against (or for) a PT who is restricted right now.
        if (session.ptUserId && deps.isPtRestricted && (await deps.isPtRestricted(session.ptUserId))) continue;
        if (deps.isContractRestricted && (await deps.isContractRestricted(session.contractId))) continue;
        // Same guarded deduction the manual confirm uses — charges the quota, releases the
        // PT's money, and checks contract completion, all in the one place that logic lives.
        // If the client confirmed a moment ago, this claims nothing and nothing is charged
        // or released twice.
        // F3: the status change is part of the claim - a session the client disputed, an admin ruled or a cancel
        // closed in the meantime matches zero rows and is NOT overwritten, charged or paid (it used to be forced to
        // COMPLETED whether or not the claim won).
        const won = await deps.deductQuotaOnce(session.id, session.contractId, {
          from: [SessionStatus.PENDING_CLIENT_CONFIRMATION],
          extra: {
            completedAt: new Date(),
            autoConfirmed: true,
            resolutionNote: `Tự động xác nhận sau khi quá hạn phản hồi (${process.env.SESSION_AUTO_CONFIRM_DAYS ?? 3} ngày)`,
          },
        });
        if (!won) continue;
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
        // D59: the contract's ending is recorded but unconfirmed - nothing is confirmed on it now; the sweep reaches the
        // session again once the ending is confirmed (its value is then settled against the hold).
        if ((err as { code?: string })?.code === CONTRACT_ENDING) {
          logger.info(`[SessionAutoConfirm] session ${session.id} left for later: contract ${session.contractId} is being ended`);
          continue;
        }
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
