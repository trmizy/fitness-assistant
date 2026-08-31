import { logger } from "@gym-coach/shared";
import { contractService } from "./contract.service";

const INTERVAL_MS = Number(process.env.CONTRACT_EXPIRY_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);

/**
 * P0 cluster A3 — periodically settles contracts that have drifted past their endDate while
 * still ACTIVE.
 *
 * Before this job existed, nothing ever called contractService.expireContracts() at all — a
 * contract just sat ACTIVE forever once its endDate passed, and any money still in the three
 * parties' pending buckets for never-booked sessions stayed stuck there permanently (the
 * reconciliation invariant kept holding, since the money was still validly claimed by
 * someone — but nobody could withdraw it, because nothing had released it out of pending).
 *
 * Mirrors reschedule-expiry.service.ts: same interval shape, same overlap guard. The actual
 * per-contract work (and its own error isolation, so one bad contract does not block the
 * rest of the batch) lives in contractService.expireContracts() — this file is only the
 * timer.
 */
let running = false;

export function startContractExpirySweepJob(): void {
  logger.info(`Contract expiry sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runContractExpirySweep();
  }, INTERVAL_MS);
}

export async function runContractExpirySweep(): Promise<{ expired: number }> {
  if (running) {
    logger.info("[ContractExpirySweep] Previous run still in progress — skipping tick");
    return { expired: 0 };
  }
  running = true;

  try {
    const expired = await contractService.expireContracts();
    if (expired > 0) {
      logger.info(`[ContractExpirySweep] Settled ${expired} expired contract(s)`);
    }
    return { expired };
  } catch (err) {
    logger.error({ error: "[ContractExpirySweep] sweep failed", message: (err as Error).message });
    return { expired: 0 };
  } finally {
    running = false;
  }
}
