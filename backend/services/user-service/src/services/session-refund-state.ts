import { logger } from "@gym-coach/shared";
import { SessionSettlementKind, SessionSettlementStatus, SessionStatus } from "../generated/prisma";
import { paymentClient, type LedgerOperationRecord } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { readPtFaultMoney, type PtFaultMoney } from "./pt-fault-session-wording";

/**
 * DQ-2(a) / FH-6 follow-up - "was the client really refunded?" for a PT-fault session (status NO_SHOW), derived from data that
 * already exists; no new status, no new table, no second source of truth.
 *
 *   FULL     the refund is done: paid = owed (nothing unpaid), or an authorised person has since marked the obligation RESOLVED.
 *   PARTIAL  0 < paid < owed and the remainder is an OPEN obligation under reconciliation.
 *   PENDING  nothing refunded yet: paid = 0 (an OPEN obligation), or the money step is not SETTLED yet (queued, failed, parked,
 *            UNCONFIRMED) - or the owner waived the obligation without paying (then `refundPendingAmount` is 0, see below).
 *
 * Where the facts live (the first one that exists wins):
 *   1. session_settlements.result of `PT_NO_SHOW:<sessionId>` - payment-service's confirmed answer {owed, paid, unpaid, obligationId},
 *      stored in the transaction that flips the row to SETTLED (session-settlement.service.ts);
 *   2. payment-service's stored ledger operation under the same key (read-only lookup) - for rows settled before step 1 existed,
 *      and for a session of an ended contract (key `UNRESOLVED_SESSION:<id>`, outcome NOT_DELIVERED);
 *   3. the LIVE status of the unpaid obligation (the same lookup carries it): OPEN keeps the remainder pending, RESOLVED (handled
 *      outside the ledger with a reference) makes the refund FULL, WAIVED closes it without paying (pending 0, never FULL).
 * A session whose money step does not exist (a contract with no payment behind it) or cannot be established (payment-service
 * unreachable and nothing stored) gets NO state: callers show a neutral "không diễn ra" and make no refund claim. OPEN is never
 * reported as paid.
 */

export type RefundState = "FULL" | "PARTIAL" | "PENDING";

export interface SessionRefundInfo {
  refundState: RefundState | null;
  /** What the ledger really credited to the client (decimal string, VND); null when unknown. */
  refundedAmount: string | null;
  /** What is still owed to the client and open (decimal string); "0.00" once the obligation was waived; null when unknown. */
  refundPendingAmount: string | null;
}

const NO_INFO: SessionRefundInfo = { refundState: null, refundedAmount: null, refundPendingAmount: null };
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const LOOKUP_CHUNK = 100;

/** Pure: the three figures (and the live obligation status, if known) -> the state. */
export function deriveRefundInfo(money: PtFaultMoney, obligationStatus?: string | null): SessionRefundInfo {
  const paid = Number(money.paid);
  const unpaid = Number(money.unpaid);
  if (obligationStatus === "RESOLVED" || unpaid <= 0) {
    return { refundState: "FULL", refundedAmount: fmt(paid), refundPendingAmount: "0.00" };
  }
  if (obligationStatus === "WAIVED") {
    return { refundState: paid > 0 ? "PARTIAL" : "PENDING", refundedAmount: fmt(paid), refundPendingAmount: "0.00" };
  }
  return { refundState: paid > 0 ? "PARTIAL" : "PENDING", refundedAmount: fmt(paid), refundPendingAmount: fmt(unpaid) };
}

/** The figures of a stored result: the FH-1 shape {paid, owed, unpaid}, an older {compensation} (paid = owed), or a NOT_DELIVERED resolution {moved.client, shortfall}. */
function figuresOf(result: unknown): PtFaultMoney | null {
  const direct = readPtFaultMoney(result);
  if (direct) return direct;
  if (!result || typeof result !== "object") return null;
  const r = result as { compensation?: unknown; moved?: { client?: unknown }; shortfall?: unknown; outcome?: unknown };
  if (r.moved && r.outcome === "NOT_DELIVERED" && r.moved.client != null) {
    const paid = Number(r.moved.client);
    const unpaid = Math.max(Number(r.shortfall ?? 0), 0);
    if (Number.isFinite(paid) && Number.isFinite(unpaid)) return { paid: fmt(paid), owed: fmt(paid + unpaid), unpaid: fmt(unpaid) };
  }
  if (r.compensation != null && Number.isFinite(Number(r.compensation))) {
    const c = Number(r.compensation);
    return { paid: fmt(c), owed: fmt(c), unpaid: "0.00" };
  }
  return null;
}

type SessionLike = { id: string; status: SessionStatus | string; contractId?: string };

/**
 * Adds `refundState` / `refundedAmount` / `refundPendingAmount` to every NO_SHOW session of the list (other sessions are returned
 * untouched). One database query for all of them; payment-service is asked (batched, read-only) only for rows whose answer was not
 * stored or whose remainder is still unpaid - so a list of fully refunded sessions costs no network call.
 */
export async function attachRefundStates<T extends SessionLike>(sessions: T[]): Promise<Array<T | (T & SessionRefundInfo)>> {
  const targets = sessions.filter((s) => s.status === SessionStatus.NO_SHOW);
  if (targets.length === 0) return sessions;
  const infos = await refundInfoFor(targets.map((s) => s.id));
  return sessions.map((s) => (s.status === SessionStatus.NO_SHOW ? { ...s, ...(infos.get(s.id) ?? NO_INFO) } : s));
}

export async function refundInfoFor(sessionIds: string[]): Promise<Map<string, SessionRefundInfo>> {
  const out = new Map<string, SessionRefundInfo>();
  if (sessionIds.length === 0) return out;
  const rows = await prisma.sessionSettlement.findMany({
    where: {
      OR: [
        { idempotencyKey: { in: sessionIds.map((id) => `PT_NO_SHOW:${id}`) } },
        { idempotencyKey: { in: sessionIds.map((id) => `UNRESOLVED_SESSION:${id}`) }, reason: "NOT_DELIVERED" },
      ],
    },
  });
  const byKey = new Map(rows.map((r) => [r.idempotencyKey, r]));

  // Which sessions need the ledger: no stored answer, or an unpaid remainder whose live status matters.
  const need = new Set<string>();
  type Pick = { row: (typeof rows)[number]; key: string };
  const picked = new Map<string, Pick>();
  for (const id of sessionIds) {
    const noShow = byKey.get(`PT_NO_SHOW:${id}`);
    const resolved = byKey.get(`UNRESOLVED_SESSION:${id}`);
    const row = noShow ?? resolved;
    if (!row) continue; // no money step exists for this session
    picked.set(id, { row, key: row.idempotencyKey });
    if (row.status !== SessionSettlementStatus.SETTLED) continue; // PENDING: no ledger call can make it settled
    const stored = row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION ? figuresOf(row.result) : null;
    if (!stored || Number(stored.unpaid) > 0) need.add(row.idempotencyKey);
  }

  const records = new Map<string, LedgerOperationRecord>();
  let lookupFailed = false;
  const keys = [...need];
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    try {
      const answer = await paymentClient.lookupLedgerOperations(keys.slice(i, i + LOOKUP_CHUNK));
      for (const op of answer.operations) records.set(op.key, op);
    } catch (e) {
      lookupFailed = true;
      logger.warn(`[RefundState] ledger lookup failed (${(e as Error).message}) - states that need it are left unknown`);
    }
  }

  for (const id of sessionIds) {
    const p = picked.get(id);
    if (!p) {
      out.set(id, NO_INFO);
      continue;
    }
    if (p.row.status !== SessionSettlementStatus.SETTLED) {
      // Queued, failed, parked or UNCONFIRMED: the refund is not confirmed. Honest, and the amount is unknown here.
      out.set(id, { refundState: "PENDING", refundedAmount: null, refundPendingAmount: null });
      continue;
    }
    const storedFigures = p.row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION ? figuresOf(p.row.result) : null;
    const record = records.get(p.key);
    const figures = storedFigures ?? (record ? figuresOf(record.result) : null);
    if (!figures) {
      out.set(id, NO_INFO); // settled, but the answer is neither stored nor reachable: no claim either way
      continue;
    }
    // The live status of the obligation (only meaningful while something is unpaid). Unreachable -> the stored remainder stays pending.
    const obligationStatus = Number(figures.unpaid) > 0 ? (record?.obligation?.status ?? null) : null;
    out.set(id, deriveRefundInfo(figures, obligationStatus));
  }
  if (lookupFailed) logger.warn("[RefundState] some sessions were answered from stored data only");
  return out;
}
