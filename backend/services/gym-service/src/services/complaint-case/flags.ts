/**
 * GYM COMPLAINT CASE (Dispute V2.1 Slice 3) - feature flag, FAIL-CLOSED, same rule as user-service's dispute-case/flags.ts.
 *
 * GYM_COMPLAINT_CASE_ENABLED is EFFECTIVE only when ALL THREE hold:
 *   1. its value is exactly the string "true",
 *   2. NODE_ENV === "test",
 *   3. the database-isolation preload (src/__tests__/setup/db-isolation.ts) accepted an isolated *_test database: DB_ISOLATION === "accepted".
 * Anything else - unset, "TRUE", "1", "true " - is OFF, even when the variable says true outside a test: a flag copied into a dev / production
 * environment by mistake cannot turn the new layer or its money execution on. The mistake is reported once (warning), never acted on.
 *
 * What the flag gates: EVERY write of the case layer (open, assign, claims, assessments, finding, proposal, decision, statements, evidence, share,
 * execute, reconcile) and, above all, the money execution. Reads stay available (they write nothing but the access log) so an operator can see why
 * the layer is off. The OLD GymComplaint routes do not look at this flag.
 *
 * The function reads process.env on every call (a test flips it between cases); nothing is cached except the "already warned" marker.
 */
export const GYM_COMPLAINT_CASE_FLAG = 'GYM_COMPLAINT_CASE_ENABLED';

const warned = new Set<string>();

export interface FlagVerdict {
  effective: boolean;
  refusedBecause?: 'NOT_TEST_ENV' | 'DB_ISOLATION_NOT_ACCEPTED';
}

export function flagVerdict(env: NodeJS.ProcessEnv = process.env): FlagVerdict {
  if (env[GYM_COMPLAINT_CASE_FLAG] !== 'true') return { effective: false };
  if (env.NODE_ENV !== 'test') return warn('NOT_TEST_ENV');
  if (env.DB_ISOLATION !== 'accepted') return warn('DB_ISOLATION_NOT_ACCEPTED');
  return { effective: true };
}

function warn(why: 'NOT_TEST_ENV' | 'DB_ISOLATION_NOT_ACCEPTED'): FlagVerdict {
  if (!warned.has(why)) {
    warned.add(why);
    // eslint-disable-next-line no-console
    console.warn(
      `[gym-complaint-case] ${GYM_COMPLAINT_CASE_FLAG}=true IGNORED (flag stays OFF): ${
        why === 'NOT_TEST_ENV' ? "NODE_ENV is not 'test'" : "no isolated *_test database was accepted by the test preload (DB_ISOLATION !== 'accepted')"
      }. This flag only works inside the isolated test environment.`,
    );
  }
  return { effective: false, refusedBecause: why };
}

export const gymCaseEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => flagVerdict(env).effective;

/** For tests only: forget which warnings were already printed. */
export const __resetFlagWarnings = () => warned.clear();
