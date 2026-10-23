/**
 * FH-4 part 1 - the admin RECONCILIATION report (read-only). One call answers "what money steps need a person?" for the
 * user-service half of the picture:
 *
 *   needsAttention           session_settlements parked for a human (NEEDS_HUMAN / CONFLICT), at the attempt cap, or stuck PROCESSING
 *   endingsUnconfirmed       CONTRACT_TERMINATION rows recorded but not SETTLED for longer than N minutes
 *   endedWithoutSettledEnding paid contracts that ENDED with no SETTLED ending row (the old crash window, or a sweep still carrying it)
 *   disputes                 DISPUTED sessions by age, with the D61 SLA state
 *
 * STRICTLY READ-ONLY: nothing here writes, claims, retries or "fixes" a row - the repositories it calls are the same read
 * queries the sweep / scripts use. The DTOs carry ids, kinds, statuses, attempts, ages and amounts ONLY - no names, e-mails,
 * phones, free text (dispute reasons) or raw error strings (only a short upper-case code derived from last_error).
 */
import { prisma } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { settlementMaxAttempts, staleProcessingMs } from "./session-settlement.service";

const DAY_MS = 24 * 3600 * 1000;
const MINUTE_MS = 60 * 1000;

/** D61: a dispute is "DUE_SOON" from day 10 and "OVERDUE" from day 14 (the 14-day SLA post-deploy-state-check U-08 also uses). */
export const DISPUTE_SLA_WARN_DAYS = 10;
export const DISPUTE_SLA_BREACH_DAYS = 14;
export type DisputeSlaState = "WITHIN_SLA" | "DUE_SOON" | "OVERDUE";

export const RECONCILIATION_DEFAULT_LIMIT = 50;
export const RECONCILIATION_MAX_LIMIT = 200;
export const RECONCILIATION_DEFAULT_MIN_AGE_MINUTES = 15;
const RECONCILIATION_MAX_MIN_AGE_MINUTES = 60 * 24 * 365;

export function disputeSlaState(ageDays: number): DisputeSlaState {
  if (ageDays >= DISPUTE_SLA_BREACH_DAYS) return "OVERDUE";
  if (ageDays >= DISPUTE_SLA_WARN_DAYS) return "DUE_SOON";
  return "WITHIN_SLA";
}

/**
 * A short, safe code out of a row's last_error: the leading `UPPER_SNAKE:` tag the settlement code writes (NEEDS_RECONCILIATION,
 * CONFLICT, ENDED_UNSETTLED...). Any other text (a payment-service message, an exception) is reduced to "ERROR" - the raw string
 * never leaves the service.
 */
export function errorCodeOf(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  const m = /^([A-Z][A-Z0-9_]{2,39}):/.exec(lastError);
  return m ? m[1] : "ERROR";
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const ageMinutes = (from: Date, now: number) => Math.max(0, Math.floor((now - from.getTime()) / MINUTE_MS));

export type AttentionReason = "CONFLICT" | "NEEDS_HUMAN" | "UNCONFIRMED" | "ATTEMPTS_AT_CAP" | "STUCK_PROCESSING";

export interface SettlementAttentionItem {
  id: string;
  kind: string;
  status: string;
  reason: AttentionReason;
  contractId: string;
  sessionId: string | null;
  attempts: number;
  errorCode: string | null;
  amountAtStake: number;
  createdAt: Date;
  updatedAt: Date;
  ageMinutes: number;
}
export interface UnconfirmedEndingItem {
  id: string;
  status: string;
  contractId: string;
  endingReason: string | null;
  attempts: number;
  errorCode: string | null;
  amountAtStake: number | null;
  createdAt: Date;
  ageMinutes: number;
}
export interface EndedWithoutSettledEndingItem {
  contractId: string;
  contractStatus: string;
  terminationReason: string | null;
  endedAt: Date;
  ageMinutes: number;
  hasIntent: boolean;
  settlementStatus: string | null;
  attempts: number | null;
  errorCode: string | null;
  amountAtStake: number | null;
}
export interface DisputeItem {
  sessionId: string;
  contractId: string;
  disputeType: string | null;
  disputedAt: Date | null;
  ageDays: number;
  slaState: DisputeSlaState;
  sessionValue: number | null;
}
export interface ReconciliationGroup<T> {
  items: T[];
  /** True when more rows exist than `limit` returned (narrow with a larger limit, up to the cap). */
  truncated: boolean;
}
export interface ReconciliationReport {
  generatedAt: Date;
  params: { limit: number; endingMinAgeMinutes: number; endedMinAgeMinutes: number; maxAttempts: number; staleProcessingMinutes: number };
  needsAttention: ReconciliationGroup<SettlementAttentionItem>;
  endingsUnconfirmed: ReconciliationGroup<UnconfirmedEndingItem>;
  endedWithoutSettledEnding: ReconciliationGroup<EndedWithoutSettledEndingItem>;
  disputes: ReconciliationGroup<DisputeItem> & { sla: { warnDays: number; breachDays: number } };
}

export interface ReconciliationOptions {
  limit?: number;
  /** CONTRACT_TERMINATION rows younger than this are "in flight", not reported. */
  endingMinAgeMinutes?: number;
  /** Ended contracts whose ending was written less than this long ago are "in flight", not reported. */
  endedMinAgeMinutes?: number;
}

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v as number))) : fallback;
}
function page<T>(rows: T[], limit: number): ReconciliationGroup<T> {
  return { items: rows.slice(0, limit), truncated: rows.length > limit };
}

export const adminReconciliationService = {
  async report(options: ReconciliationOptions = {}, now: Date = new Date()): Promise<ReconciliationReport> {
    const limit = clampInt(options.limit, RECONCILIATION_DEFAULT_LIMIT, 1, RECONCILIATION_MAX_LIMIT);
    const endingMinAgeMinutes = clampInt(options.endingMinAgeMinutes, RECONCILIATION_DEFAULT_MIN_AGE_MINUTES, 0, RECONCILIATION_MAX_MIN_AGE_MINUTES);
    const endedMinAgeMinutes = clampInt(options.endedMinAgeMinutes, RECONCILIATION_DEFAULT_MIN_AGE_MINUTES, 0, RECONCILIATION_MAX_MIN_AGE_MINUTES);
    const nowMs = now.getTime();
    const maxAttempts = settlementMaxAttempts();
    const staleMs = staleProcessingMs();

    // limit + 1 everywhere: the extra row only tells us the group was cut.
    const [attention, endings, ended, disputed] = await Promise.all([
      sessionSettlementRepository.findNeedingAttention(maxAttempts, limit + 1, { stuckProcessingBefore: new Date(nowMs - staleMs) }),
      sessionSettlementRepository.findUnconfirmedTerminations({ minAgeMs: endingMinAgeMinutes * MINUTE_MS, limit: limit + 1 }),
      sessionSettlementRepository.findEndedPaidWithoutSettledTermination({ minAgeMs: endedMinAgeMinutes * MINUTE_MS, limit: limit + 1 }),
      sessionRepository.findDisputed({ take: limit + 1 }),
    ]);

    // Amounts of the ending-type groups: the contract's price (the ending settles the whole contract).
    const endingContractIds = [...new Set([...endings.map((e) => e.contractId), ...ended.map((e) => e.contractId)])];
    const contracts = endingContractIds.length
      ? await prisma.contract.findMany({ where: { id: { in: endingContractIds } }, select: { id: true, price: true } })
      : [];
    const priceOf = new Map(contracts.map((c) => [c.id, num(c.price)]));

    const needsAttention = page(
      attention.map((r): SettlementAttentionItem => {
        const reason: AttentionReason =
          r.status === "CONFLICT"
            ? "CONFLICT"
            : r.status === "NEEDS_HUMAN"
              ? "NEEDS_HUMAN"
              : r.status === "UNCONFIRMED"
                ? "UNCONFIRMED"
                : r.attempts >= maxAttempts
                  ? "ATTEMPTS_AT_CAP"
                  : r.status === "PROCESSING"
                    ? "STUCK_PROCESSING"
                    : "ATTEMPTS_AT_CAP";
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          reason,
          contractId: r.contractId,
          sessionId: r.sessionId,
          attempts: r.attempts,
          errorCode: errorCodeOf(r.lastError),
          amountAtStake: r.amountAtStake,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          ageMinutes: ageMinutes(r.createdAt, nowMs),
        };
      }),
      limit,
    );

    const endingsUnconfirmed = page(
      endings.map((r): UnconfirmedEndingItem => ({
        id: r.id,
        status: r.status,
        contractId: r.contractId,
        endingReason: r.reason,
        attempts: r.attempts,
        errorCode: errorCodeOf(r.lastError),
        amountAtStake: priceOf.get(r.contractId) ?? null,
        createdAt: r.createdAt,
        ageMinutes: ageMinutes(r.createdAt, nowMs),
      })),
      limit,
    );

    const endedWithoutSettledEnding = page(
      ended.map((r): EndedWithoutSettledEndingItem => ({
        contractId: r.contractId,
        contractStatus: r.contractStatus,
        terminationReason: r.terminationReason,
        endedAt: r.endedAt,
        ageMinutes: ageMinutes(r.endedAt, nowMs),
        hasIntent: r.hasIntent,
        settlementStatus: r.settlementStatus,
        attempts: r.attempts,
        errorCode: errorCodeOf(r.lastError),
        amountAtStake: priceOf.get(r.contractId) ?? null,
      })),
      limit,
    );

    const disputes = {
      ...page(
        disputed.map((s): DisputeItem => {
          // Same fallback post-deploy-state-check U-08 uses when a legacy row has no disputed_at.
          const since = s.disputedAt ?? s.updatedAt;
          const ageDays = Math.max(0, Math.floor((nowMs - since.getTime()) / DAY_MS));
          const price = num(s.contract?.price);
          const sessions = s.contract?.totalSessions ?? 0;
          return {
            sessionId: s.id,
            contractId: s.contractId,
            disputeType: s.disputeType ?? null,
            disputedAt: s.disputedAt,
            ageDays,
            slaState: disputeSlaState(ageDays),
            sessionValue: price != null && sessions > 0 ? Math.round(price / sessions) : null,
          };
        }),
        limit,
      ),
      sla: { warnDays: DISPUTE_SLA_WARN_DAYS, breachDays: DISPUTE_SLA_BREACH_DAYS },
    };

    return {
      generatedAt: now,
      params: { limit, endingMinAgeMinutes, endedMinAgeMinutes, maxAttempts, staleProcessingMinutes: Math.round(staleMs / MINUTE_MS) },
      needsAttention,
      endingsUnconfirmed,
      endedWithoutSettledEnding,
      disputes,
    };
  },
};

