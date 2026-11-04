/**
 * B-1 release gate (Ngai, direction A, 03/11/2026) - the key of a D77 x ruling combination.
 *
 * The guard used to be keyed by the OUTCOME alone, so opening "COMPLETED" would have opened it for every state of the late-arrival compensation (L) and for a running AND an ended contract.
 * The key is now   <outcome> | L:<state of L> | C:<ACTIVE|ENDED>   and the state is READ from the real facts (the session's PT_LATE_ARRIVAL settlement row and the ledger operation / LIVE obligation
 * stored under the same key), never taken from a request:
 *   SETTLED_CASH          the row is SETTLED and the ledger paid L in full (no obligation, or nothing unpaid)
 *   SETTLED_PARTIAL_OPEN  the row is SETTLED but the ledger could only pay part of L: an obligation is still owed with paid > 0   (NOT plain SETTLED)
 *   OPEN                  the row is SETTLED (record-only) and an obligation is still owed with nothing paid
 *   PENDING               the row exists and is not SETTLED (waiting / failed / parked)
 *   CLOSED_OTHER          the obligation was closed another way (paid via the ledger later, waived, resolved outside)
 *   UNKNOWN               the ledger cannot be read or answers something inconsistent
 * OPENED_D77_COMBINATIONS (execution-guard.ts) stays EMPTY in production code; only the executor's test seam can name a key.
 */
import { paymentClient, type LedgerOperationRecord } from "../../clients/payment.client";
import type { Db } from "./collector";

export type LateState = "SETTLED_CASH" | "SETTLED_PARTIAL_OPEN" | "OPEN" | "PENDING" | "CLOSED_OTHER" | "UNKNOWN";
export type ContractPhase = "ACTIVE" | "ENDED";
export interface D77Read {
  lState: LateState;
  phase: ContractPhase;
}

/** States in which the client has NOT been verifiably paid (same list as payment-service OBLIGATION_STILL_OWED). */
const STILL_OWED = ["OPEN", "UNDER_REVIEW", "APPROVED_FOR_PAYMENT", "AWAITING_EVIDENCE", "PAID_EXTERNALLY"];

export const d77Key = (outcome: string, lState: LateState, phase: ContractPhase) => `${outcome}|L:${lState}|C:${phase}`;

/** PURE: the state of L from the settlement row's status and the ledger record (null = the ledger has none, "unreadable" = the lookup failed). */
export function classifyLate(row: { status: string } | null, rec: LedgerOperationRecord | null | "unreadable"): LateState | "NONE" {
  if (!row && rec === null) return "NONE";
  if (rec === "unreadable") return "UNKNOWN";
  if (row && row.status !== "SETTLED") return "PENDING";
  if (!rec) return "UNKNOWN"; // a SETTLED row whose ledger operation cannot be found: inconsistent
  const ob = rec.obligation;
  const res = (rec.result ?? {}) as { unpaid?: unknown; recordedOnly?: unknown };
  if (ob) {
    const unpaid = Number(ob.unpaid);
    const paid = Number(ob.paid);
    if (!Number.isFinite(unpaid) || !Number.isFinite(paid)) return "UNKNOWN";
    if (STILL_OWED.includes(ob.status) && unpaid > 0) return paid > 0 ? "SETTLED_PARTIAL_OPEN" : "OPEN";
    return "CLOSED_OTHER";
  }
  // no obligation: L is plain cash only if the ledger says nothing was left unpaid and it was not a record-only entry
  if (res.recordedOnly === true) return "UNKNOWN";
  if (res.unpaid !== undefined && Number(res.unpaid) > 0) return "UNKNOWN";
  return "SETTLED_CASH";
}

/** Reads the real state of L (settlement row + ledger) and the contract's phase. {unknown} when something cannot be read. */
export async function readLateState(db: Db, sessionId: string, contractId: string): Promise<D77Read | { none: true } | { unknown: true }> {
  const key = `PT_LATE_ARRIVAL:${sessionId}`;
  const row = await db.sessionSettlement.findUnique({ where: { idempotencyKey: key }, select: { status: true } });
  let rec: LedgerOperationRecord | null | "unreadable";
  try {
    rec = await paymentClient.lookupLedgerOperation(key);
  } catch {
    rec = "unreadable";
  }
  const lState = classifyLate(row, rec);
  if (lState === "NONE") return { none: true };
  const phase = await phaseOf(db, contractId);
  if (!phase) return { unknown: true };
  return { lState, phase };
}

export async function phaseOf(db: Db, contractId: string): Promise<ContractPhase | null> {
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { status: true } });
  if (!c) return null;
  const { isContractEnded } = await import("../contract-payout.service"); // dynamic: contract-payout imports execution-guard
  return isContractEnded(c) ? "ENDED" : "ACTIVE";
}
