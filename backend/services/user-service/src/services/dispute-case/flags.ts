/**
 * DISPUTE CASE slice 2 - feature flags, FAIL-CLOSED.
 *
 * A flag is EFFECTIVE only when ALL THREE hold:
 *   1. its value is exactly the string "true",
 *   2. NODE_ENV === "test",
 *   3. the database-isolation preload (src/__tests__/setup/db-isolation.ts) accepted an isolated *_test database: DB_ISOLATION === "accepted".
 * Anything else - unset, "TRUE", "1", "true " - is OFF, even when the variable says true outside a test: a flag copied into a dev / production
 * environment by mistake cannot turn the executor, the T0 gate or evidence storage on. The mistake is reported once (warning), never acted on.
 *
 * The functions read process.env on every call (a test flips them between cases); nothing is cached except the "already warned" marker.
 */

export const DISPUTE_CASE_FLAGS = {
  /** S2.1 - the CaseDecision executor (the only door through which a Case may change a session / quota / money). */
  EXECUTION: "DISPUTE_CASE_EXECUTION_ENABLED",
  /** S2.2 - T0: the old `POST /admin/sessions/:id/resolve` answers 409 CASE_REQUIRED and every entry point to the ruling core needs a verified CaseDecision. */
  T0: "DISPUTE_CASE_T0",
  /** S2.8 - server-side storage + hashing of evidence files (dev / test, synthetic data only). */
  EVIDENCE_STORAGE: "DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED",
  /**
   * Late-open (D77 OPEN) settlement: every mutating admin reconciliation route, the executor, and the settlement gate (contract-payout lateOpenGate), which gives NO
   * settleLateOpen to any session while this is off - not for a stored reconciliation approval and not for an approved ELIGIBLE_CURRENT_POLICY review either.
   * payment-service holds its own copy of the same rule (services/late-open-settlement-flag.ts) at the single point where OPEN L money moves, so a direct call to its
   * internal routes with settleLateOpen:true is refused too. OFF = the whole path is refused / ignored. A D77 that is already SETTLED in cash, WAIVED or PAID_VIA_LEDGER is not affected.
   */
  LATE_OPEN_RECONCILIATION: "DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED",
  /** D65-B: every MUTATING route of the four-eyes admin resolution of a held NO_SHOW session (POST propose / approve, retries and resumes included). Reads stay open. OFF = 409 D65B_RESOLUTION_DISABLED. */
  D65B_RESOLUTION: "DISPUTE_CASE_D65B_RESOLUTION_ENABLED",
} as const;

export type DisputeCaseFlag = (typeof DISPUTE_CASE_FLAGS)[keyof typeof DISPUTE_CASE_FLAGS];

const warned = new Set<string>();

export interface FlagVerdict {
  effective: boolean;
  /** why it is off although the variable asks for on (undefined when the variable does not ask for on) */
  refusedBecause?: "NOT_TEST_ENV" | "DB_ISOLATION_NOT_ACCEPTED";
}

export function flagVerdict(name: DisputeCaseFlag, env: NodeJS.ProcessEnv = process.env): FlagVerdict {
  if (env[name] !== "true") return { effective: false };
  if (env.NODE_ENV !== "test") return warn(name, "NOT_TEST_ENV");
  if (env.DB_ISOLATION !== "accepted") return warn(name, "DB_ISOLATION_NOT_ACCEPTED");
  return { effective: true };
}

function warn(name: string, why: "NOT_TEST_ENV" | "DB_ISOLATION_NOT_ACCEPTED"): FlagVerdict {
  const k = `${name}:${why}`;
  if (!warned.has(k)) {
    warned.add(k);
    // eslint-disable-next-line no-console
    console.warn(
      `[dispute-case] ${name}=true IGNORED (flag stays OFF): ${
        why === "NOT_TEST_ENV" ? "NODE_ENV is not 'test'" : "no isolated *_test database was accepted by the test preload (DB_ISOLATION !== 'accepted')"
      }. This flag only works inside the isolated test environment.`,
    );
  }
  return { effective: false, refusedBecause: why };
}

export const isDisputeCaseFlagOn = (name: DisputeCaseFlag, env: NodeJS.ProcessEnv = process.env): boolean => flagVerdict(name, env).effective;

export const executionEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.EXECUTION);
export const t0Enabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.T0);
export const evidenceStorageEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE);
export const lateOpenReconciliationEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION);
export const d65bResolutionEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.D65B_RESOLUTION);

/** For tests only: forget which warnings were already printed. */
export const __resetFlagWarnings = () => warned.clear();
