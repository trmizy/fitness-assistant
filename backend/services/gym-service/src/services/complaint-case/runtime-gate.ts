/**
 * DISPUTE RUNTIME GATE - the single rule that decides whether ANY Dispute V2.1 feature flag may be effective in this process.
 * The same file (an identical copy) lives in user-service, payment-service and gym-service, so the three services evaluate one rule.
 *
 * Two ways the gate opens, nothing else:
 *   1. TEST   NODE_ENV === "test" AND the service's own test-isolation check passed (user/gym: DB_ISOLATION === "accepted"; payment: DB name ends _test).
 *   2. E2E    the explicitly named isolated environment (infra/compose/docker-compose.e2e-dispute.yml). ALL of these must hold, each one alone is not enough:
 *               a. DISPUTE_RUNTIME_MODE === "e2e-isolated"
 *               b. NODE_ENV is set and is neither "production" nor "test"
 *               c. DISPUTE_E2E_COMPOSE_MARKER === MARKER_VALUE (a second marker only that compose file sets)
 *               d. the database in DATABASE_URL ends "_e2e" AND is listed in DISPUTE_E2E_DB_ALLOWLIST (comma separated, exact names)
 *         Which flags the e2e gate lets through is a fixed list (E2E_PERMITTED_FLAGS) in the caller: T0 and late-open OPEN-L settlement are NEVER permitted there.
 * Anything else - production, a missing marker, a DB name outside the allowlist, a typo in the mode - is LOCKED. Fail closed; read on every call (no cache).
 */

export const RUNTIME_MODE_VAR = "DISPUTE_RUNTIME_MODE";
export const E2E_MODE = "e2e-isolated";
export const MARKER_VAR = "DISPUTE_E2E_COMPOSE_MARKER";
export const MARKER_VALUE = "gymini-e2e-dispute-v1";
export const DB_ALLOWLIST_VAR = "DISPUTE_E2E_DB_ALLOWLIST";

export type GateMode = "test" | "e2e-isolated" | "locked";
export type GateRefusal =
  | "NOT_TEST_ENV"
  | "DB_ISOLATION_NOT_ACCEPTED"
  | "E2E_NODE_ENV_NOT_ALLOWED"
  | "E2E_MARKER_MISSING"
  | "E2E_DB_NOT_ALLOWLISTED";

export interface GateVerdict {
  mode: GateMode;
  open: boolean;
  /** why the gate is closed (undefined when open) */
  refusedBecause?: GateRefusal;
  /** database name the verdict was computed for ("" when unknown) - for the audit line only */
  database: string;
}

/** The database name of a Postgres URL, or "" when the URL is missing or unparsable. */
export function databaseNameOfUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

/** @param testIsolationAccepted the calling service's own test-database check (only consulted when NODE_ENV === "test") */
export function evaluateRuntimeGate(env: NodeJS.ProcessEnv, testIsolationAccepted: boolean): GateVerdict {
  const database = databaseNameOfUrl(env.DATABASE_URL);
  if (env.NODE_ENV === "test") {
    return testIsolationAccepted
      ? { mode: "test", open: true, database }
      : { mode: "test", open: false, refusedBecause: "DB_ISOLATION_NOT_ACCEPTED", database };
  }
  if (env[RUNTIME_MODE_VAR] !== E2E_MODE) return { mode: "locked", open: false, refusedBecause: "NOT_TEST_ENV", database };
  const nodeEnv = env.NODE_ENV;
  if (!nodeEnv || nodeEnv === "production") return { mode: "locked", open: false, refusedBecause: "E2E_NODE_ENV_NOT_ALLOWED", database };
  if (env[MARKER_VAR] !== MARKER_VALUE) return { mode: "locked", open: false, refusedBecause: "E2E_MARKER_MISSING", database };
  const allow = (env[DB_ALLOWLIST_VAR] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.endsWith("_e2e"));
  if (!database.endsWith("_e2e") || !allow.includes(database)) {
    return { mode: "locked", open: false, refusedBecause: "E2E_DB_NOT_ALLOWLISTED", database };
  }
  return { mode: "e2e-isolated", open: true, database };
}

/** The part of a verdict the services compare with each other (never the database name: each service has its own). */
export const verdictSignature = (v: Pick<GateVerdict, "mode" | "open">): string => `${v.mode}:${v.open ? "open" : "closed"}`;
