import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/auth.repository";
import {
  attemptPtDeactivationCall,
  type PtDeactivationAction,
  type PtDeactivationAttemptResult,
  type RelayDeps,
} from "./pt-deactivation-relay.service";

/**
 * Money-flow redesign plan 2.6 — retries whatever `relayPtActiveStateChange` left FAILED.
 * Same shape as user-service's session-settlement-sweep.service.ts and payment-service's
 * reconciliation.service.ts: a module-level `running` guard against overlapping ticks, one
 * failure per row isolated so it cannot stop the rest of the batch.
 *
 * PT-lock slice 1: a retry re-sends the SAME command row (same seq) instead of creating a fresh
 * row each time — so the old row is the one that gets closed — and a row for which a newer
 * lock/unlock exists is retired as SUPERSEDED rather than sent (see pt-deactivation-relay.service.ts).
 * Rows are taken oldest-seq first. A row stuck in PENDING (the process died between creating it and
 * recording the answer) is picked up once it has been quiet for PENDING_STALE_MS.
 */

const INTERVAL_MS = Number(process.env.PT_DEACTIVATION_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);
const PENDING_STALE_MS = Number(process.env.PT_DEACTIVATION_PENDING_STALE_MS ?? 2 * 60 * 1000);
const BATCH_SIZE = 50;

let running = false;

export function startPtDeactivationRelaySweepJob(): void {
  logger.info(`PT deactivation relay sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runPtDeactivationRelaySweep();
  }, INTERVAL_MS);
}

export async function runPtDeactivationRelaySweep(
  deps?: RelayDeps,
): Promise<{ scanned: number; retried: number; superseded: number }> {
  if (running) {
    logger.info("[PtDeactivationSweep] Previous run still in progress — skipping tick");
    return { scanned: 0, retried: 0, superseded: 0 };
  }
  running = true;

  let scanned = 0;
  let retried = 0;
  let superseded = 0;
  try {
    const rows = await prisma.ptDeactivationCall.findMany({
      where: {
        OR: [
          { status: "FAILED" },
          { status: "PENDING", updatedAt: { lt: new Date(Date.now() - PENDING_STALE_MS) } },
        ],
      },
      orderBy: { seq: "asc" },
      take: BATCH_SIZE,
    });
    scanned = rows.length;
    if (scanned === 0) return { scanned, retried, superseded };

    logger.info(`[PtDeactivationSweep] ${scanned} relay call(s) to retry`);

    for (const row of rows) {
      try {
        const result: PtDeactivationAttemptResult = await attemptPtDeactivationCall(
          {
            id: row.id,
            ptUserId: row.ptUserId,
            action: row.action as PtDeactivationAction,
            adminId: row.adminId,
            reason: row.reason,
            seq: row.seq,
          },
          deps,
        );
        if (result === "SUPERSEDED") superseded++;
        else retried++;
      } catch (err) {
        logger.error({
          error: "PT deactivation relay retry threw unexpectedly",
          callId: row.id,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[PtDeactivationSweep] Retried ${retried}/${scanned} row(s), retired ${superseded} superseded`);
    return { scanned, retried, superseded };
  } catch (err) {
    logger.error({ error: "PT deactivation relay sweep failed", message: (err as Error).message });
    return { scanned, retried, superseded };
  } finally {
    running = false;
  }
}
