/**
 * This seed creates a fixed set of demo accounts sharing ONE well-known
 * plaintext password ("password123", hashed in seed.ts). That is fine for a
 * local/CI database nobody else can reach, and is intentionally idempotent
 * (`upsert` with `update: {}`) so re-running it never resets a password that
 * was since changed. It is NOT fine to run against any database a real
 * deployment's DATABASE_URL could point at — see
 * docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md for the
 * incident this guards against (the admin@example.com/password123 seed
 * account was reachable on public AWS DEV infrastructure).
 *
 * Design notes (each one closes a real gap the first version of this file had):
 *  - Uses the real `URL` parser (`node:url`), never a substring/regex check
 *    against the whole connection string. A regex like `url.includes("_test")`
 *    would happily call `...rds.amazonaws.com/some_test_db` "safe" — a
 *    database NAME can never make a remote host safe, so only the parsed
 *    HOSTNAME is ever checked.
 *  - The allowlist is an exact-match hostname set, not NODE_ENV. NODE_ENV is
 *    routinely "production" or unset even for local scripts in this repo, and
 *    is trivial to leave stale — hostname is the one property of the actual
 *    connection target that is meaningful here.
 *  - A missing or unparseable DATABASE_URL fails closed (refused), it does
 *    not fail open.
 *  - The error message never includes the URL or any credential — only the
 *    (non-secret) hostname that was rejected, which is enough to debug a
 *    misconfigured local setup without ever echoing a password back out.
 *
 * Kept dependency-free (no Prisma import) so it can be unit-tested without a
 * database connection.
 */

// Confirmed by grepping every committed .env and docker-compose*.yml in this
// repo: `localhost` (local dev, backend/services/auth-service/.env) and
// `postgres-test` (docker-compose.test.yml's dedicated, ephemeral CI database
// service — never anything else) are the only two hostnames actually used.
// `127.0.0.1` / `::1` / `host.docker.internal` are not currently used by any
// committed config here, but are standard same-machine-loopback spellings of
// the same thing as `localhost` — included so a developer's own manual local
// invocation isn't refused on a technicality, without widening this to
// accept anything that merely resembles a local name.
const ALLOWED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]", // Node's URL parser keeps the brackets in .hostname for IPv6 literals — verified directly, not assumed.
  "host.docker.internal",
  "postgres-test",
]);

export function assertSeedAllowed(
  databaseUrl: string | undefined,
  allowOverride: string | undefined,
): void {
  if (allowOverride === "true") {
    // Privileged, explicit, per-invocation override. Deliberately NOT a
    // config value that should ever live in a persisted environment (Lambda
    // config, ECS task definition, Secrets Manager, a committed .env) — it
    // must only ever be typed by hand, once, by someone who has just read
    // this comment and is certain the target is a real throwaway database.
    // (No deployed Lambda/ECS task runs this seed at all today — see the
    // remediation report — so today this override only ever reaches a
    // human's own shell, not a machine's persisted config.)
    return;
  }

  if (!databaseUrl) {
    throw new Error(
      "Refusing to run the auth-service demo seed: DATABASE_URL is not set. " +
        "Failing closed — an unset URL is never treated as safe.",
    );
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(
      "Refusing to run the auth-service demo seed: DATABASE_URL could not be parsed as a " +
        "URL. Failing closed — an unparseable URL is never treated as safe.",
    );
  }

  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Refusing to run the auth-service demo seed: host "${hostname}" is not one of this ` +
        `repo's known local/CI database hosts (${[...ALLOWED_HOSTNAMES].join(", ")}). This ` +
        'seed creates accounts (including an ADMIN account) sharing one well-known plaintext ' +
        'password ("password123") and must never run against a shared, staging, or cloud ' +
        "database — a database NAME (e.g. containing \"_test\") is never sufficient proof by " +
        "itself, only the host is checked. If this really is a throwaway database on a host " +
        "not yet in this list and you are certain, re-run with ALLOW_DEMO_SEED=true.",
    );
  }
}
