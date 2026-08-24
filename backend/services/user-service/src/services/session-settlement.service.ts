import { logger } from "@gym-coach/shared";
import { SessionSettlementKind } from "../generated/prisma";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";

/**
 * Money-flow redesign plan 1.6 — "trạng thái buổi tập và trạng thái tiền phải tách nhau".
 *
 * A session's business status (NO_SHOW, CANCELLED, COMPLETED, ...) commits independently of
 * whether the money for it has actually moved. Before this, a no-show compensation or session
 * release that failed left the caller's status change already committed with NO way back to
 * retry it — every retry path is gated by a status guard ("Cannot mark no-show for session in
 * NO_SHOW status") that now refuses to touch the very session whose money never arrived.
 *
 * `settleTracked` is the one place that gap closes: it records the attempt, runs the actual
 * payment-service call, and on failure records FAILED instead of throwing — the caller's
 * business-status transition is never blocked or rolled back by a money-side failure.
 * `session-settlement-sweep.service.ts` retries PENDING/FAILED/stale-PROCESSING rows later,
 * using the exact same idempotency key money-flow plan 1.1 already guards on the
 * payment-service side, so a retry — from the sweep, or from a live caller retrying the same
 * high-level operation — can never double-book.
 */

export interface SettlementRow {
  id: string;
  status: string;
}

export interface SettlementDeps {
  upsertPending: (input: {
    kind: SessionSettlementKind;
    idempotencyKey: string;
    sessionId: string | null;
    contractId: string;
    reason: string | null;
  }) => Promise<SettlementRow>;
  markProcessing: (id: string) => Promise<unknown>;
  markSettled: (id: string) => Promise<unknown>;
  markFailed: (id: string, error: string) => Promise<unknown>;
}

const defaultSettlementDeps: SettlementDeps = {
  upsertPending: (input) => sessionSettlementRepository.upsertPending(input),
  markProcessing: (id) => sessionSettlementRepository.markProcessing(id),
  markSettled: (id) => sessionSettlementRepository.markSettled(id),
  markFailed: (id, error) => sessionSettlementRepository.markFailed(id, error),
};

export interface SettleTrackedParams {
  kind: SessionSettlementKind;
  idempotencyKey: string;
  contractId: string;
  sessionId?: string | null;
  reason?: string | null;
}

/**
 * Runs `run` under retry tracking. Never throws — a failure is recorded on the row (visible to
 * the sweep and to anyone querying `session_settlements`) rather than propagated, because by
 * the time most callers reach this point their own business-status change has already
 * committed and cannot be meaningfully rolled back by surfacing an error here.
 */
export async function settleTracked(
  params: SettleTrackedParams,
  run: () => Promise<void>,
  deps: SettlementDeps = defaultSettlementDeps,
): Promise<void> {
  const row = await deps.upsertPending({
    kind: params.kind,
    idempotencyKey: params.idempotencyKey,
    sessionId: params.sessionId ?? null,
    contractId: params.contractId,
    reason: params.reason ?? null,
  });

  // Already done — a caller re-entering the same high-level operation (a retried HTTP
  // request, or the sweep picking up a row a live caller just finished) must not run it again.
  if (row.status === "SETTLED") return;

  await deps.markProcessing(row.id);
  try {
    await run();
    await deps.markSettled(row.id);
  } catch (e) {
    await deps.markFailed(row.id, (e as Error).message);
    logger.error({
      error: "Financial settlement failed — recorded for retry",
      kind: params.kind,
      idempotencyKey: params.idempotencyKey,
      contractId: params.contractId,
      sessionId: params.sessionId,
      message: (e as Error).message,
    });
  }
}
