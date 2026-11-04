/**
 * D77 OPEN late-arrival obligation (L) - the payment-side HARD BOUNDARY flag, FAIL-CLOSED.
 *
 * `settleLateOpen` in contract-ledger.service.ts is the ONLY place past which an OPEN L obligation moves money (parties' pending -> the client's wallet,
 * obligation.paid / unpaid, status closed by the ledger). It cannot trust `settleLateOpen: true` in a request body: any caller of the internal routes can send it.
 * So the ledger itself asks this module whether settling OPEN L is switched on at all.
 *
 * Same variable name as user-service's flag: DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED. It is EFFECTIVE only when ALL THREE hold:
 *   1. the value is exactly the string "true"  ("TRUE", "1", "true ", "yes" ... are OFF),
 *   2. NODE_ENV === "test",
 *   3. the database named in DATABASE_URL has a name ending "_test".
 * Anything else is OFF - also when the variable asks for on in a dev / production environment: the mistake is reported once (warning) and never acted on.
 *
 * It does NOT affect: a late arrival paid in cash (SETTLED, no obligation row), WAIVED, already paid by a ledger entry, an obligation with unpaid <= 0 - all of those return
 * before the check - and it changes no amount, formula or money source. env is read on every call (a test flips it between cases).
 */

import { databaseNameOfUrl as gateDatabaseNameOfUrl, evaluateRuntimeGate, type GateVerdict } from './dispute-runtime-gate';

/** payment-service's gate: test mode needs a DB named *_test (it has no DB_ISOLATION preload). */
export const paymentGateVerdict = (env: NodeJS.ProcessEnv = process.env): GateVerdict =>
  evaluateRuntimeGate(env, /_test$/.test(gateDatabaseNameOfUrl(env.DATABASE_URL)));

export const LATE_OPEN_SETTLEMENT_FLAG = 'DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED';

export type LateOpenFlagRefusal = 'NOT_TEST_ENV' | 'DATABASE_NOT_TEST' | 'E2E_FLAG_NOT_PERMITTED';

export interface LateOpenFlagVerdict {
  effective: boolean;
  /** why it is off although the variable asks for on (undefined when the variable does not ask for on) */
  refusedBecause?: LateOpenFlagRefusal;
}

/** The database name of a Postgres URL, or "" when the URL is missing or unparsable. */
export const databaseNameOfUrl = gateDatabaseNameOfUrl;

const warned = new Set<string>();

export function lateOpenSettlementVerdict(env: NodeJS.ProcessEnv = process.env): LateOpenFlagVerdict {
  if (env[LATE_OPEN_SETTLEMENT_FLAG] !== 'true') return { effective: false };
  // The shared runtime gate: NODE_ENV=test AND a DB name ending _test, OR the isolated e2e environment. OPEN-L settlement is NEVER permitted in the e2e environment (owner decision).
  const gate = paymentGateVerdict(env);
  if (!gate.open) return warn(gate.mode === 'test' ? 'DATABASE_NOT_TEST' : gate.refusedBecause === 'NOT_TEST_ENV' ? 'NOT_TEST_ENV' : 'E2E_FLAG_NOT_PERMITTED');
  if (gate.mode !== 'test') return warn('E2E_FLAG_NOT_PERMITTED');
  return { effective: true };
}

function warn(why: LateOpenFlagRefusal): LateOpenFlagVerdict {
  if (!warned.has(why)) {
    warned.add(why);
    // eslint-disable-next-line no-console
    console.warn(
      `[payment-service] ${LATE_OPEN_SETTLEMENT_FLAG}=true IGNORED (settlement of an OPEN late-arrival obligation stays OFF): ${
        why === 'NOT_TEST_ENV' ? "NODE_ENV is not 'test'" : why === 'E2E_FLAG_NOT_PERMITTED' ? 'settling OPEN L is never permitted in the isolated e2e environment (or the e2e gate is closed)' : 'DATABASE_URL does not name a database ending _test'
      }. This flag only works inside the isolated test environment.`,
    );
  }
  return { effective: false, refusedBecause: why };
}

export const lateOpenSettlementEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => lateOpenSettlementVerdict(env).effective;

/** For tests only: forget which warnings were already printed. */
export const __resetLateOpenFlagWarnings = () => warned.clear();
