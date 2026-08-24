import { logger } from "@gym-coach/shared";
import { SessionSettlementKind } from "../generated/prisma";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { compensateNoShowMoney, releaseSessionMoney, terminateContractMoney, type TerminationReason } from "./contract-payout.service";
import { settleTracked } from "./session-settlement.service";

/**
 * Money-flow redesign plan 1.6 — retries whatever `settleTracked` (session-settlement.service.ts)
 * left PENDING, FAILED, or stuck PROCESSING. Mirrors payment-service's
 * reconciliation.service.ts: a module-level `running` guard against overlapping ticks, one
 * failure per row isolated so it cannot stop the rest of the batch, plain interval polling — no
 * message queue needed for this volume.
 *
 * Retrying calls the SAME public functions the original call sites use
 * (compensateNoShowMoney / releaseSessionMoney / terminateContractMoney), not some separate
 * "raw" version — each of those already re-enters `settleTracked` with the row's own
 * idempotencyKey, finds the SAME row, and either skips (if something else just settled it) or
 * tries again. There is exactly one implementation of what each kind of settlement does; the
 * sweep is just another caller of it.
 */

const INTERVAL_MS = Number(process.env.SESSION_SETTLEMENT_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);
const BATCH_SIZE = 50;
// A row stuck PROCESSING longer than this almost certainly means the process that claimed it
// crashed mid-call rather than genuinely still being in flight.
const STALE_PROCESSING_MS = Number(process.env.SESSION_SETTLEMENT_STALE_PROCESSING_MS ?? 10 * 60 * 1000);

let running = false;

export function startSessionSettlementSweepJob(): void {
  logger.info(`Session settlement sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runSettlementSweep();
  }, INTERVAL_MS);
}

export async function runSettlementSweep(): Promise<{ scanned: number; retried: number }> {
  if (running) {
    logger.info("[SettlementSweep] Previous run still in progress — skipping tick");
    return { scanned: 0, retried: 0 };
  }
  running = true;

  let scanned = 0;
  let retried = 0;
  try {
    const rows = await sessionSettlementRepository.findRetryable(BATCH_SIZE, STALE_PROCESSING_MS);
    scanned = rows.length;
    if (scanned === 0) return { scanned, retried };

    logger.info(`[SettlementSweep] ${scanned} settlement row(s) to retry`);

    for (const row of rows) {
      try {
        await dispatch(row.kind, row.contractId, row.sessionId, row.reason as TerminationReason | null);
        retried++;
      } catch (err) {
        // Each of the three functions below is itself best-effort (settleTracked swallows),
        // so reaching here means something OUTSIDE the tracked operation broke — still must
        // not stop the rest of the batch.
        logger.error({
          error: "Settlement retry threw unexpectedly",
          settlementId: row.id,
          kind: row.kind,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[SettlementSweep] Retried ${retried}/${scanned} row(s)`);
    return { scanned, retried };
  } catch (err) {
    logger.error({ error: "Settlement sweep failed", message: (err as Error).message });
    return { scanned, retried };
  } finally {
    running = false;
  }
}

async function dispatch(
  kind: SessionSettlementKind,
  contractId: string,
  sessionId: string | null,
  reason: TerminationReason | null,
): Promise<void> {
  switch (kind) {
    case SessionSettlementKind.PT_NO_SHOW_COMPENSATION:
      return compensateNoShowMoney(contractId, sessionId!);
    case SessionSettlementKind.SESSION_RELEASE:
      return releaseSessionMoney(contractId, sessionId!);
    case SessionSettlementKind.CONTRACT_TERMINATION: {
      // terminateContractMoney itself is NOT wrapped in settleTracked internally — its
      // manual/admin caller needs a synchronous throw (contract.service.ts's
      // defaultCompleteContractDeps wraps it there instead, for the natural-completion path
      // only). The sweep must reconstruct that SAME wrapping here, with the SAME
      // idempotencyKey the original row was created under, or a successful retry would never
      // get marked SETTLED and would be retried forever even after it truly succeeded.
      const terminationReason = (reason ?? "COMPLETED") as TerminationReason;
      await settleTracked(
        {
          kind: SessionSettlementKind.CONTRACT_TERMINATION,
          idempotencyKey: `CONTRACT_TERMINATE:${contractId}`,
          contractId,
          reason: terminationReason,
        },
        () => terminateContractMoney(contractId, terminationReason),
      );
      return;
    }
  }
}
