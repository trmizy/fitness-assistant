/**
 * FH-3 helpers that decide what payment-service's ANSWER (or refusal) means for a settlement row. Pure: no database, no HTTP.
 *
 *  - {@link ledgerRefusalOf}: the two refusals payment-service raises BEFORE writing any ledger row (FH-2b) - the same idempotency
 *    key reused for a different request (409 IDEMPOTENCY_KEY_CONFLICT) and a request that disagrees with the payment transaction
 *    it names (422 REQUEST_DOES_NOT_MATCH_TRANSACTION). Retrying either can only produce the same refusal, so the row is parked
 *    CONFLICT (a human), never retried.
 *  - {@link invalidMoneyFigures}: the `owed` / `paid` / `unpaid` figures of a PT-fault step must be coherent
 *    (0 <= paid <= owed, unpaid = owed - paid). A malformed answer is never applied and never retried: the row is parked NEEDS_HUMAN.
 *  - {@link settlingD65bEnabled}: the SETTLING_D65B switch (default ON; "false" = the old behaviour, an unverified session row blocks the ending).
 */

/** SETTLING_D65B (default true). false / 0 / off / no = the ending is refused while a session row is unverified, as before FH-3c. */
export function settlingD65bEnabled(): boolean {
  const raw = (process.env.SETTLING_D65B ?? "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(raw);
}

export type LedgerRefusalCode = "IDEMPOTENCY_KEY_CONFLICT" | "REQUEST_DOES_NOT_MATCH_TRANSACTION";

export interface LedgerRefusal {
  code: LedgerRefusalCode;
  message: string;
}

const REFUSAL_STATUS: Record<LedgerRefusalCode, number> = {
  IDEMPOTENCY_KEY_CONFLICT: 409,
  REQUEST_DOES_NOT_MATCH_TRANSACTION: 422,
};

/** The refusal an axios-style error carries (or a client-wrapped error with `status` / `code`), or null for anything else. */
export function ledgerRefusalOf(e: unknown): LedgerRefusal | null {
  if (!e || typeof e !== "object") return null;
  const err = e as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } }; status?: number; code?: string; message?: string };
  const status = err.response?.status ?? err.status;
  const code = err.response?.data?.error?.code ?? err.code;
  if (code !== "IDEMPOTENCY_KEY_CONFLICT" && code !== "REQUEST_DOES_NOT_MATCH_TRANSACTION") return null;
  if (status !== REFUSAL_STATUS[code]) return null;
  return { code, message: err.response?.data?.error?.message ?? err.message ?? code };
}

const DECIMAL = /^\d+(\.\d+)?$/;
const TOLERANCE = 0.005; // half a đồng: amounts are whole đồng, decimals travel as strings

/** A non-negative decimal (number or numeric string) as a number, or null. */
function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && DECIMAL.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * The `owed` / `paid` / `unpaid` figures of a compensation / termination answer. No figure at all = an answer from before FH-1:
 * accepted as it always was. Once any figure is present they must be coherent:
 *   paid >= 0 is required, owed / unpaid >= 0 when present, paid <= owed, unpaid = owed - paid (when both are present).
 * Also checks the legacy fields that restate them (`compensation` = paid on a compensation, `refund` <= paid on a termination)
 * and the shape of `overReleased`. Returns the reason it is malformed, or null.
 */
export function invalidMoneyFigures(r: unknown): string | null {
  if (!r || typeof r !== "object") return "payment-service did not answer with a result";
  const a = r as Record<string, unknown>;
  const present = ["owed", "paid", "unpaid"].filter((k) => a[k] !== undefined && a[k] !== null);

  if (present.length > 0) {
    for (const k of present) if (money(a[k]) === null) return `payment-service reported an invalid ${k} figure (${JSON.stringify(a[k])})`;
    const paid = money(a.paid);
    const owed = money(a.owed);
    const unpaid = money(a.unpaid);
    if (paid === null) return "payment-service reported owed / unpaid without the paid figure";
    if (owed !== null && paid > owed + TOLERANCE) return `payment-service reported paid ${paid} greater than owed ${owed}`;
    if (owed !== null && unpaid !== null && Math.abs(owed - paid - unpaid) > TOLERANCE) {
      return `payment-service reported unpaid ${unpaid} but owed ${owed} - paid ${paid} = ${owed - paid}`;
    }
    if (a.compensation !== undefined && a.compensation !== null) {
      const comp = money(a.compensation);
      if (comp === null || Math.abs(comp - paid) > TOLERANCE) return `payment-service reported compensation ${JSON.stringify(a.compensation)} that is not the paid figure ${paid}`;
    }
    if (a.refund !== undefined && a.refund !== null) {
      const refund = money(a.refund);
      if (refund === null || refund > paid + TOLERANCE) return `payment-service reported refund ${JSON.stringify(a.refund)} greater than the paid figure ${paid}`;
    }
  }

  if (a.overReleased !== undefined && a.overReleased !== null) {
    if (!Array.isArray(a.overReleased)) return "payment-service reported overReleased that is not a list";
    for (const o of a.overReleased as Array<Record<string, unknown>>) {
      if (!o || typeof o !== "object" || money(o.amount) === null || typeof o.party !== "string") return "payment-service reported a malformed overReleased entry";
    }
  }
  return null;
}
