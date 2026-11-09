import { paymentClient, type LedgerOperationRecord } from "../../clients/payment.client";
import type { Db } from "./collector";
import {
  caseF3Kind,
  classifyFinancialItem,
  f3KindOf,
  financialKeysFor,
  groupOf,
  worstGroup,
  GROUP_LABEL_VI,
  VERIFICATION_REQUIRED_LABEL_VI,
  type CaseFinancialGroup,
  type F3Kind,
  type FinancialGroup,
  type FinancialState,
  type LedgerLookup,
} from "./rules";

/**
 * DISPUTE CASE slice 1 - the FINANCIAL VIEW (§1.2.3, §1.7.1): DERIVED and READ-ONLY, never stored as a source of truth.
 * Reads session_settlements and asks payment-service's read-only lookup for each key; amounts are returned exactly as the ledger reports
 * them (strings), nothing here computes money, and a ledger that cannot be reached is UNAVAILABLE, never "0".
 */
export interface FinancialItem {
  key: string;
  settlementId: string;
  settlementKind: string;
  settlementStatus: string;
  state: FinancialState;
  group: FinancialGroup;
  /** Set for an F3 item only: OUTSTANDING (a real step / debt) or VERIFICATION_REQUIRED (a historical record a person must verify). */
  f3Kind?: F3Kind;
  /** Vietnamese label, only where the state needs its own wording (a historical record is not an open debt and not verified as paid). */
  label?: string;
  ledger:
    | { status: "UNAVAILABLE"; error: string }
    | { status: "ABSENT" }
    | {
        status: "FOUND";
        kind: string | null;
        transactionId: string | null;
        createdAt: string;
        result: Record<string, unknown>;
        obligation: LedgerOperationRecord["obligation"] | null;
      };
  /** RESOLVED_OTHER is F2 but must show WHY it was resolved elsewhere: the lookup does not carry the reason, so this says so instead of inventing one. */
  resolutionReason?: { available: false; note: string } | { available: true; note: string; resolvedAt?: string | null };
}

export interface FinancialView {
  derived: true;
  observedAt: string;
  group: CaseFinancialGroup;
  groupLabel: string;
  /** Set when group is F3: OUTSTANDING if any item is a real step / debt, VERIFICATION_REQUIRED if the queue holds only historical records. */
  f3Kind?: F3Kind;
  items: FinancialItem[];
}

/**
 * R-13: why an obligation was RESOLVED_OTHER. The reason is stored by payment-service (contract_unpaid_obligations.resolved_note) but its read-only internal lookup does not
 * project it yet, so today the answer is `available:false`. As soon as the lookup carries `obligation.resolvedNote` this passes it through unchanged (never invented, never edited).
 */
function resolutionReasonOf(ledger: FinancialItem["ledger"]): NonNullable<FinancialItem["resolutionReason"]> {
  const ob = ledger.status === "FOUND" ? (ledger.obligation as { resolvedNote?: unknown; resolvedAt?: unknown } | null | undefined) : null;
  if (ob && typeof ob.resolvedNote === "string" && ob.resolvedNote.trim()) {
    return { available: true, note: ob.resolvedNote, resolvedAt: typeof ob.resolvedAt === "string" ? ob.resolvedAt : null };
  }
  return { available: false, note: "Sổ cái chưa trả lý do xử lý khác qua đường tra cứu này (cần payment-service mở trường resolvedNote ở tra cứu nội bộ)" };
}

export async function buildFinancialView(db: Db, sessionId: string): Promise<FinancialView> {
  const keys = financialKeysFor(sessionId);
  const rows = await db.sessionSettlement.findMany({ where: { sessionId, idempotencyKey: { in: keys } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  const items = await Promise.all(
    rows.map(async (row): Promise<FinancialItem> => {
      let lookup: LedgerLookup;
      let ledger: FinancialItem["ledger"];
      try {
        const rec = await paymentClient.lookupLedgerOperation(row.idempotencyKey);
        if (!rec) {
          lookup = { status: "ABSENT" };
          ledger = { status: "ABSENT" };
        } else {
          lookup = { status: "FOUND", obligation: rec.obligation ?? null };
          ledger = {
            status: "FOUND",
            kind: rec.kind,
            transactionId: rec.transactionId,
            createdAt: rec.createdAt,
            result: rec.result,
            obligation: rec.obligation ?? null,
          };
        }
      } catch (e: any) {
        lookup = { status: "UNAVAILABLE" };
        ledger = { status: "UNAVAILABLE", error: String(e?.code ?? e?.message ?? "LEDGER_LOOKUP_FAILED").slice(0, 120) };
      }
      const state = classifyFinancialItem(row.status, lookup);
      return {
        key: row.idempotencyKey,
        settlementId: row.id,
        settlementKind: row.kind,
        settlementStatus: row.status,
        state,
        group: groupOf(state),
        ...(f3KindOf(state) ? { f3Kind: f3KindOf(state) } : {}),
        ...(state === "LEGACY_NEEDS_VERIFICATION" ? { label: VERIFICATION_REQUIRED_LABEL_VI } : {}),
        ledger,
        ...(state === "OBLIGATION_RESOLVED_OTHER" ? { resolutionReason: resolutionReasonOf(ledger) } : {}),
      };
    }),
  );

  const states = items.map((i) => i.state);
  const group = worstGroup(states);
  const f3Kind = group === "F3" ? caseF3Kind(states) : undefined;
  // An F3 queue made only of historical records is not "still owed": say what it is.
  const groupLabel = group === "F3" && f3Kind === "VERIFICATION_REQUIRED" ? VERIFICATION_REQUIRED_LABEL_VI : GROUP_LABEL_VI[group];
  return { derived: true, observedAt: new Date().toISOString(), group, groupLabel, ...(f3Kind ? { f3Kind } : {}), items };
}

/** What a party gets: the group label only (no keys, no amounts, no split). */
export function partyFinancialView(view: FinancialView): { group: CaseFinancialGroup; groupLabel: string } {
  return { group: view.group, groupLabel: view.groupLabel };
}

/**
 * B-1 (§1.3.3): is there ANY trace of the late-arrival compensation of this session - a settlement row of any status, or a ledger
 * operation under PT_LATE_ARRIVAL:<sessionId>? A ledger that cannot be read and no row to go by is NOT "no": the caller refuses.
 */
export async function hasLateArrivalStep(db: Db, sessionId: string): Promise<{ exists: boolean } | { unknown: true }> {
  const key = `PT_LATE_ARRIVAL:${sessionId}`;
  const row = await db.sessionSettlement.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  if (row) return { exists: true };
  try {
    const rec = await paymentClient.lookupLedgerOperation(key);
    return { exists: rec !== null };
  } catch {
    return { unknown: true };
  }
}
