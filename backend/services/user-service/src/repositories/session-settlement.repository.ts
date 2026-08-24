import { SessionSettlementKind, SessionSettlementStatus } from "../generated/prisma";
import { prisma } from "./profile.repository";

export const sessionSettlementRepository = {
  /**
   * Finds the row for this idempotency key, creating a fresh PENDING one if none exists.
   * Deliberately does NOT reset an existing FAILED/PROCESSING row's status here — the caller
   * (session-settlement.service.ts#settleTracked) always calls markProcessing right after,
   * which does that. Returning the existing row as-is lets the caller check
   * `row.status === "SETTLED"` and skip re-running an already-completed operation.
   */
  upsertPending: (input: {
    kind: SessionSettlementKind;
    idempotencyKey: string;
    sessionId: string | null;
    contractId: string;
    reason: string | null;
  }) =>
    prisma.sessionSettlement.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: { ...input, status: SessionSettlementStatus.PENDING },
      update: {}, // no-op write — just fetch the existing row
    }),

  markProcessing: (id: string) =>
    prisma.sessionSettlement.update({
      where: { id },
      data: { status: SessionSettlementStatus.PROCESSING, attempts: { increment: 1 } },
    }),

  markSettled: (id: string) =>
    prisma.sessionSettlement.update({
      where: { id },
      data: { status: SessionSettlementStatus.SETTLED, settledAt: new Date(), lastError: null },
    }),

  markFailed: (id: string, error: string) =>
    prisma.sessionSettlement.update({
      where: { id },
      data: { status: SessionSettlementStatus.FAILED, lastError: error.slice(0, 2000) },
    }),

  /**
   * Rows the sweep should retry, oldest first:
   *   - PENDING  — a process crashed between creating the row and marking it PROCESSING.
   *   - FAILED   — the underlying payment-service call threw.
   *   - PROCESSING, but stuck past `staleAfterMs` — the process that claimed it crashed
   *     mid-call, so it never reached markSettled/markFailed. Without this branch such a row
   *     would sit PROCESSING forever, invisible to both this query and a human, and its money
   *     would never move (same failure mode 1.6 exists to close, just one step removed).
   */
  findRetryable: (limit: number, staleAfterMs: number) =>
    prisma.sessionSettlement.findMany({
      where: {
        OR: [
          { status: { in: [SessionSettlementStatus.PENDING, SessionSettlementStatus.FAILED] } },
          { status: SessionSettlementStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - staleAfterMs) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    }),
};
