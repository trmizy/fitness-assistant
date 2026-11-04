/**
 * DISPUTE CASE slice 2 - feature flags, FAIL-CLOSED.
 *
 * (Isolated E2E environment: runtime-gate.ts also opens the gate for DISPUTE_RUNTIME_MODE=e2e-isolated + compose marker + allowlisted *_e2e DB, for a fixed
 *  subset of flags only (E2E_PERMITTED_FLAGS) and, for money flags, only while payment-service reports the same gate verdict - see payment-peer.ts.)
 *
 * In the test environment a flag is EFFECTIVE only when ALL THREE hold:
 *   1. its value is exactly the string "true",
 *   2. NODE_ENV === "test",
 *   3. the database-isolation preload (src/__tests__/setup/db-isolation.ts) accepted an isolated *_test database: DB_ISOLATION === "accepted".
 * Anything else - unset, "TRUE", "1", "true " - is OFF, even when the variable says true outside a test: a flag copied into a dev / production
 * environment by mistake cannot turn the executor, the T0 gate or evidence storage on. The mistake is reported once (warning), never acted on.
 *
 * The functions read process.env on every call (a test flips them between cases); nothing is cached except the "already warned" marker.
 */

import { evaluateRuntimeGate, type GateRefusal, type GateVerdict } from "./runtime-gate";
import { peerAgrees } from "./payment-peer";

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
  /** V2.1 (Ngai 05/11): the response clocks and everything a timer does (48h / 72h deadlines, S2.4 PT silent -> DISPUTED, SLA day 10/14, held-money review sweep). Moves no money. OFF = the sweep does nothing and no clock starts. */
  TIMERS: "DISPUTE_CASE_TIMERS_ENABLED",
  /** V2.1 (Ngai 05/11): mutating routes of mutual agreement, appeal (review request), its consequences and the quota correction. OFF = 409 DISPUTE_PROCESS_DISABLED. Reads stay open. */
  APPEALS: "DISPUTE_CASE_APPEALS_ENABLED",
} as const;

export type DisputeCaseFlag = (typeof DISPUTE_CASE_FLAGS)[keyof typeof DISPUTE_CASE_FLAGS];

const warned = new Set<string>();

export type FlagRefusal =
  | GateRefusal
  | "E2E_FLAG_NOT_PERMITTED"
  | "PEER_UNCONFIRMED"
  | "PEER_UNREACHABLE"
  | "PEER_STALE"
  | "PEER_MISMATCH";

export interface FlagVerdict {
  effective: boolean;
  /** why it is off although the variable asks for on (undefined when the variable does not ask for on) */
  refusedBecause?: FlagRefusal;
}

/**
 * The only flags the isolated E2E environment may switch on. T0 and late-open OPEN-L settlement are NOT here: they stay test-only (owner decision).
 */
export const E2E_PERMITTED_FLAGS: ReadonlySet<DisputeCaseFlag> = new Set<DisputeCaseFlag>([
  DISPUTE_CASE_FLAGS.EXECUTION,
  DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE,
  DISPUTE_CASE_FLAGS.D65B_RESOLUTION,
  DISPUTE_CASE_FLAGS.TIMERS,
]);

/** Flags that move money / settle sessions: in e2e mode they additionally need payment-service to agree on the gate verdict. */
const NEEDS_PAYMENT_PEER: ReadonlySet<DisputeCaseFlag> = new Set<DisputeCaseFlag>([
  DISPUTE_CASE_FLAGS.EXECUTION,
  DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION,
  DISPUTE_CASE_FLAGS.D65B_RESOLUTION,
]);

export function gateVerdict(env: NodeJS.ProcessEnv = process.env): GateVerdict {
  return evaluateRuntimeGate(env, env.DB_ISOLATION === "accepted");
}

export function flagVerdict(name: DisputeCaseFlag, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): FlagVerdict {
  if (env[name] !== "true") return { effective: false };
  const gate = gateVerdict(env);
  if (!gate.open) return warn(name, gate.refusedBecause!);
  if (gate.mode === "test") return { effective: true };
  // e2e-isolated
  if (!E2E_PERMITTED_FLAGS.has(name)) return warn(name, "E2E_FLAG_NOT_PERMITTED");
  if (NEEDS_PAYMENT_PEER.has(name)) {
    const peer = peerAgrees(gate, now);
    if (!peer.agrees) return warn(name, peer.why!);
  }
  return { effective: true };
}

function warn(name: string, why: FlagRefusal): FlagVerdict {
  const k = `${name}:${why}`;
  if (!warned.has(k)) {
    warned.add(k);
    // eslint-disable-next-line no-console
    console.warn(
      `[dispute-case] ${name}=true IGNORED (flag stays OFF): ${
        why === "NOT_TEST_ENV"
          ? "NODE_ENV is not 'test' and the e2e-isolated runtime mode is not requested"
          : why === "DB_ISOLATION_NOT_ACCEPTED"
            ? "no isolated *_test database was accepted by the test preload (DB_ISOLATION !== 'accepted')"
            : why
      }. This flag only works inside the isolated test / e2e environment.`,
    );
  }
  return { effective: false, refusedBecause: why };
}

/** One audit line at startup: the gate verdict and the verdict of every flag (payment's agreement is logged separately by payment-peer.ts once it has answered). */
export function auditDisputeRuntimeGate(env: NodeJS.ProcessEnv = process.env): void {
  const g = gateVerdict(env);
  const flags = Object.values(DISPUTE_CASE_FLAGS).map((n) => `${n}=${env[n] === "true" ? (flagVerdict(n, env).refusedBecause ?? "ON") : "off"}`);
  // eslint-disable-next-line no-console
  console.log(`[dispute-runtime-gate] user-service mode=${g.mode} open=${g.open} db=${g.database || "?"}${g.refusedBecause ? ` refused=${g.refusedBecause}` : ""} ${flags.join(" ")}`);
}

export const isDisputeCaseFlagOn = (name: DisputeCaseFlag, env: NodeJS.ProcessEnv = process.env): boolean => flagVerdict(name, env).effective;

export const executionEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.EXECUTION);
export const t0Enabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.T0);
export const evidenceStorageEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE);
export const lateOpenReconciliationEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION);
export const d65bResolutionEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.D65B_RESOLUTION);
export const timersEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.TIMERS);
export const appealsEnabled = () => isDisputeCaseFlagOn(DISPUTE_CASE_FLAGS.APPEALS);

/** For tests only: forget which warnings were already printed. */
export const __resetFlagWarnings = () => warned.clear();
