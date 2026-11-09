import { logger } from "@gym-coach/shared";
import { isShuttingDown, trackJob } from "../../lifecycle";
import { executionService } from "./execution.service";
import { executionEnabled } from "./flags";

/**
 * Backend completion (item 9): the caller `reconcileStale` never had. A case left in EXECUTING (a process died between the start and BUSINESS_DONE) is picked
 * up by a periodic sweep, the same pattern as session-settlement-sweep.service.ts: a module-level `running` guard against overlapping ticks, one failure per
 * case isolated, no new claim once the process is shutting down.
 *
 * Nothing new is decided here. reconcileExecution reads the REAL state first and either re-enters the ruling core (its compare-and-set from DISPUTED blocks a
 * double write), records BUSINESS_DONE, or hands the case to a person (NEEDS_HUMAN); it is never a blind retry. The whole path is behind the fail-closed
 * execution flag (reconcileStale returns [] when it is not effective), so outside the isolated test environment the sweep is a no-op.
 */
export const SWEEP_ACTOR = { id: "system:dispute-execution-sweep", role: "ADMIN" } as const;

const INTERVAL_MS = Number(process.env.DISPUTE_EXECUTION_SWEEP_INTERVAL_MS ?? 60 * 1000);
/** A case counts as stale after being EXECUTING for this long (the default of executionService.reconcileStale). */
const STALE_MS = Number(process.env.DISPUTE_EXECUTION_STALE_MS ?? 60 * 1000);

let running = false;

export async function runDisputeExecutionSweep(opts: { staleMs?: number } = {}): Promise<{ scanned: number; results: Array<{ caseId: string; result: unknown }> }> {
  if (running || isShuttingDown()) return { scanned: 0, results: [] };
  if (!executionEnabled()) return { scanned: 0, results: [] };
  running = true;
  try {
    const results = await executionService.reconcileStale({ ...SWEEP_ACTOR }, opts.staleMs ?? STALE_MS);
    if (results.length) logger.info({ cases: results.length }, "[DisputeExecutionSweep] reconciled stale EXECUTING cases");
    return { scanned: results.length, results };
  } catch (e) {
    logger.error({ message: (e as Error)?.message?.slice(0, 300) }, "[DisputeExecutionSweep] sweep failed");
    return { scanned: 0, results: [] };
  } finally {
    running = false;
  }
}

/** Starts the periodic job; returns the function that stops it (graceful shutdown). */
export function startDisputeExecutionSweepJob(): () => void {
  logger.info(`Dispute execution sweep job started (interval: ${Math.round(INTERVAL_MS / 1000)} s)`);
  const timer = setInterval(() => {
    void trackJob(runDisputeExecutionSweep());
  }, INTERVAL_MS);
  return () => clearInterval(timer);
}
