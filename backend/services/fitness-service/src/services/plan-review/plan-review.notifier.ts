import { logger } from "@gym-coach/shared";
import { planReviewService } from "./index";

/**
 * Delivery of the Plan Review outbox (PlanReviewEvent.notifyUserId set + notifiedAt null).
 *  - kick(): best-effort, non-blocking, called right after a state change so the other party hears about it promptly.
 *  - start(): a periodic sweep that retries whatever a failed/skipped kick left pending (user-service down, restart, …).
 * Both are safe to overlap: the dispatcher marks events delivered conditionally and user-service dedupes on the event's key.
 * Like the workout-reminder jobs this is started from server.ts only (never app.ts), so a Lambda deployment does not run it.
 */
const SWEEP_INTERVAL_MS = Number(process.env.PLAN_REVIEW_NOTIFY_INTERVAL_MS) || 60_000;
let running = false;

export async function runPlanReviewNotificationSweep(): Promise<{ delivered: number; skipped: number; wired: boolean }> {
  if (running) return { delivered: 0, skipped: 0, wired: true };
  running = true;
  try {
    return await planReviewService.dispatchPendingNotifications();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[plan-review] notification sweep failed — will retry on the next tick");
    return { delivered: 0, skipped: 0, wired: true };
  } finally {
    running = false;
  }
}

/** Fire-and-forget; never throws, never delays the HTTP response. */
export function kickPlanReviewNotifications(): void {
  void runPlanReviewNotificationSweep();
}

export function startPlanReviewNotificationJob(): void {
  logger.info(`Plan-review notification sweep started (interval: ${Math.round(SWEEP_INTERVAL_MS / 1000)} s)`);
  const timer = setInterval(() => void runPlanReviewNotificationSweep(), SWEEP_INTERVAL_MS);
  timer.unref?.();
}
