import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/auth.repository";
import { relayPtActiveStateChange, type PtDeactivationAction } from "./pt-deactivation-relay.service";

/**
 * Money-flow redesign plan 2.6 — retries whatever `relayPtActiveStateChange` left FAILED.
 * Same shape as user-service's session-settlement-sweep.service.ts and payment-service's
 * reconciliation.service.ts: a module-level `running` guard against overlapping ticks, one
 * failure per row isolated so it cannot stop the rest of the batch.
 */

const INTERVAL_MS = Number(process.env.PT_DEACTIVATION_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);
const BATCH_SIZE = 50;

let running = false;

export function startPtDeactivationRelaySweepJob(): void {
  logger.info(`PT deactivation relay sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runPtDeactivationRelaySweep();
  }, INTERVAL_MS);
}

export async function runPtDeactivationRelaySweep(): Promise<{ scanned: number; retried: number }> {
  if (running) {
    logger.info("[PtDeactivationSweep] Previous run still in progress — skipping tick");
    return { scanned: 0, retried: 0 };
  }
  running = true;

  let scanned = 0;
  let retried = 0;
  try {
    const rows = await prisma.ptDeactivationCall.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });
    scanned = rows.length;
    if (scanned === 0) return { scanned, retried };

    logger.info(`[PtDeactivationSweep] ${scanned} relay call(s) to retry`);

    for (const row of rows) {
      try {
        // Re-enters relayPtActiveStateChange, which creates a FRESH tracking row and retries
        // the underlying call — deactivatePT/reactivate on the user-service side are safe to
        // run again (see pt-deactivation-relay.service.ts's header comment).
        await relayPtActiveStateChange(row.ptUserId, row.action as PtDeactivationAction, row.adminId, row.reason ?? undefined);
        retried++;
      } catch (err) {
        logger.error({
          error: "PT deactivation relay retry threw unexpectedly",
          callId: row.id,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[PtDeactivationSweep] Retried ${retried}/${scanned} row(s)`);
    return { scanned, retried };
  } catch (err) {
    logger.error({ error: "PT deactivation relay sweep failed", message: (err as Error).message });
    return { scanned, retried };
  } finally {
    running = false;
  }
}
