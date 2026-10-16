/**
 * D64-A - what exactly makes a settlement row an ORPHAN (pure, no database: the settlement sweep and the dry-run script
 * `scripts/orphan-settlement-rows.ts` both call this one function, so the dry-run lists exactly what the sweep would park).
 *
 * A row is an ORPHAN - it can never be settled by retrying AND there is nothing to settle - only when:
 *   CONTRACT_MISSING  the contract row no longer exists. Nothing can be run for it any more (every payment-service call needs
 *                     the contract's transaction id and terms), so retrying is pointless.
 *   NO_PAYMENT        the contract exists but has NO payment transaction id. Every payment-service call of a settlement row
 *                     carries `contract.paymentTransactionId`, and no code path ever clears it once set, so no ledger operation
 *                     can exist under this row's key: provably nothing was ever paid for it, nothing is owed.
 * Both are marked terminal, with the reason, under the ENDED_UNSETTLED: prefix the queries already exclude; the row and its
 * history are kept, it is never SETTLED/"paid", and no ledger call is made for it.
 *
 * A row whose contract EXISTS with a payment transaction is never an orphan, even if it cannot be priced:
 *   UNPAYABLE_TERMS   the contract has a payment transaction but no price / no sessions. Money may sit in the ledger for it,
 *                     so the row is NEEDS_RECONCILIATION (still visible, still keeps an ending refused) - never dropped.
 *   LIVE              everything else: the sweep retries it (and the attempt cap parks it for a human if it keeps failing).
 */

export type OrphanCode = "CONTRACT_MISSING" | "NO_PAYMENT";
export type ReconciliationCode = "UNPAYABLE_TERMS";

export interface SettlementContractFacts {
  paymentTransactionId: string | null;
  price: unknown | null;
  totalSessions: number;
  /** ContractStatus as text; only PENDING_PAYMENT matters here. */
  status?: string;
}

export type SettlementContractVerdict =
  | { kind: "ORPHAN"; code: OrphanCode; detail: string }
  | { kind: "NEEDS_RECONCILIATION"; code: ReconciliationCode; detail: string }
  /** Not provably unpaid (the contract is still awaiting its payment): leave the row exactly as it is. */
  | { kind: "WAIT" }
  | { kind: "LIVE" };

export function classifySettlementContract(contractId: string, contract: SettlementContractFacts | null): SettlementContractVerdict {
  if (!contract) {
    return { kind: "ORPHAN", code: "CONTRACT_MISSING", detail: `contract ${contractId} no longer exists - nothing can be settled for it; row and history kept` };
  }
  if (!contract.paymentTransactionId && contract.status === "PENDING_PAYMENT") return { kind: "WAIT" };
  if (!contract.paymentTransactionId) {
    return {
      kind: "ORPHAN",
      code: "NO_PAYMENT",
      detail: `contract ${contractId} has no payment transaction - no money was ever paid for it, nothing is owed; row and history kept`,
    };
  }
  if (contract.price == null || contract.totalSessions <= 0) {
    return {
      kind: "NEEDS_RECONCILIATION",
      code: "UNPAYABLE_TERMS",
      detail: `UNPAYABLE_TERMS: contract ${contractId} has a payment transaction but no price / no sessions to price the step with - the ledger may hold money for it; a human must reconcile`,
    };
  }
  return { kind: "LIVE" };
}

/** `ENDED_UNSETTLED:<CODE>` - starts with the terminal prefix the retry queries already exclude, followed by the explicit reason code. */
export const orphanMarker = (code: OrphanCode) => `ENDED_UNSETTLED:${code}`;

/**
 * Whether the sweep parks orphans. OFF by default (owner decision, D65): ONLY an explicit SETTLEMENT_SWEEP_PARK_ORPHANS=true
 * (case and surrounding spaces ignored) turns it on; unset, empty or any other value is off. When off, an orphan row is only
 * SKIPPED: it is left exactly as it is (no write at all). Enabling it in production is a separate owner approval (dry-run,
 * classification, audit / restore plan) and is deliberately not set in any compose / infra file.
 */
export function parkOrphansEnabled(): boolean {
  return (process.env.SETTLEMENT_SWEEP_PARK_ORPHANS ?? "").trim().toLowerCase() === "true";
}

/** The reason text with the error the row had before it was parked (history is kept, never overwritten). One function for the sweep and the script. */
export function withPreviousError(detail: string, previous: string | null | undefined): string {
  return previous ? `${detail}; previous error: ${previous}` : detail;
}
