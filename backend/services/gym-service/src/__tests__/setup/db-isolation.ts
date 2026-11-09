/**
 * PRELOAD of every user-service test process (package.json: `tsx --import ./src/__tests__/setup/db-isolation.ts --test ...`).
 * It runs BEFORE any Prisma client or service module is imported, so by the time one exists, the databases AND the outbound targets are already decided:
 *
 *   DATABASE   TEST_DATABASE_URL valid (host in {localhost,127.0.0.1}, port 55433, role gymcoach_test, name ends _test, not a DB URL of .env)
 *                  -> EVERY DB variable of the service (DB_ENV_VARS) = it, DB_ISOLATION=accepted
 *              anything else (unset, invalid) -> EVERY DB variable = an unconnectable sentinel (127.0.0.1:1), DB_ISOLATION=refused
 *              A DB variable set by hand in the shell is overwritten: it is never read.
 *   OUTBOUND   outbound-guard.ts is installed (fetch, http/https, every TCP socket): only loopback services a test registered (or started itself in this
 *              process) can be reached; the dev ports and every other host are refused with OUTBOUND_BLOCKED_IN_TEST. Every service-URL variable that is not
 *              set gets the (blocked) sentinel, so the `|| "http://localhost:3007"` defaults of the product code are never used.
 *
 * One database per concurrent run, runs are serial: see ./README.md (there is no cross-process lock).
 * Why: Prisma reads <service>/.env (the DEV database) by itself whenever the variable named in schema.prisma is not set. With the sentinel in place Prisma
 * never reads .env, and an unguarded test that opens a connection fails instead of touching a database. Nothing secret is printed (only the refusal reason).
 */
import { REFUSED_SENTINEL_URL, validateTestDatabaseUrl } from "./db-isolation-validator";
import { installOutboundGuard, neutraliseOutboundEnv } from "./outbound-guard";

/** Every DB variable this service's prisma/schema.prisma names (src/__tests__/test-isolation.test.ts checks this list against the schema). */
export const DB_ENV_VARS: readonly string[] = ["DATABASE_URL"];

const verdict = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
if (verdict.ok) {
  for (const name of DB_ENV_VARS) process.env[name] = verdict.url;
  process.env.DB_ISOLATION = "accepted";
} else {
  for (const name of DB_ENV_VARS) process.env[name] = REFUSED_SENTINEL_URL;
  process.env.DB_ISOLATION = "refused";
  if (!process.env.DB_ISOLATION_QUIET) {
    console.warn(
      `[db-isolation] REFUSED: TEST_DATABASE_URL ${process.env.TEST_DATABASE_URL ? "was rejected (" + verdict.reason + ")" : "is not set"}. ` +
        `${DB_ENV_VARS.join(" / ")} is now an unconnectable sentinel: no test can reach any database; guarded DB suites will be SKIPPED.`,
    );
  }
}

neutraliseOutboundEnv();
installOutboundGuard();
process.env.GYMINI_TEST_ISOLATION = "1";
