import { spawnSync } from "child_process";
import path from "path";
import { logger } from "@gym-coach/shared";
import { ensureDatabaseUrlConfigured } from "./config/lambda-runtime";

/**
 * TEMPORARY migration Lambda — invoked manually, once, to run `prisma migrate deploy` against
 * Aurora from inside the VPC (Aurora is private; there is no other network path to it from a
 * local machine). This is NOT the auth-service request handler (see lambda.ts for that) and
 * does not import Express/serverless-http/routes — see TASK 8's header comment in the prompt
 * this was built from: a plain migration runner has no business booting the HTTP app.
 *
 * Deliberately reuses ensureDatabaseUrlConfigured() from ./config/lambda-runtime rather than
 * re-implementing Secrets Manager parsing here — that function is already unit-tested against
 * every failure mode (missing field, invalid JSON, invalid port, missing secret) by the auth
 * Lambda's own test suite, and this handler's correctness depends on it in exactly the same way.
 *
 * `prisma migrate deploy` is spawned as a CHILD PROCESS rather than invoked in-process. The
 * `prisma` CLI package calls process.exit() internally on completion — running it in-process
 * would kill this Lambda's own process before it could return a response. Spawning also gives a
 * clean way to capture exit code + stdout/stderr without the CLI's own console output leaking
 * into (or being confused with) this handler's structured logs.
 */

const DIST_DIR = __dirname; // dist/ at runtime
const ARTIFACT_ROOT = path.join(DIST_DIR, "..");
const SCHEMA_PATH = path.join(ARTIFACT_ROOT, "prisma", "schema.prisma");
const PRISMA_CLI_ENTRY = path.join(ARTIFACT_ROOT, "node_modules", "prisma", "build", "index.js");
const SCHEMA_ENGINE_BINARY = path.join(
  ARTIFACT_ROOT,
  "prisma-engines",
  process.platform === "win32" ? "schema-engine-windows.exe" : "schema-engine-rhel-openssl-3.0.x",
);

// Keep only the last N chars of each stream in both the log line and the response body — a
// failing `migrate deploy` can be verbose, and the response body in particular should stay well
// under Lambda's payload limits. Never include DATABASE_URL or the secret's password anywhere
// here; only pass-through of the CLI's own stdout/stderr, which Prisma itself already redacts
// (verified locally: `prisma migrate status`/`deploy` print host/port/database, never
// username/password — see the audit report).
const OUTPUT_TAIL_CHARS = 4000;
const tail = (s: string) => (s.length > OUTPUT_TAIL_CHARS ? s.slice(-OUTPUT_TAIL_CHARS) : s);

export async function handler(_event: unknown, _context: unknown) {
  try {
    await ensureDatabaseUrlConfigured();
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ message }, "migrate-lambda: failed to configure DATABASE_URL");
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "error",
        operation: "prisma migrate deploy",
        stage: "configure-database-url",
        error: message,
      }),
    };
  }

  logger.info(
    { schema: SCHEMA_PATH, cliEntry: PRISMA_CLI_ENTRY, schemaEngineBinary: SCHEMA_ENGINE_BINARY },
    "migrate-lambda: running prisma migrate deploy",
  );

  const result = spawnSync(
    process.execPath,
    [PRISMA_CLI_ENTRY, "migrate", "deploy", "--schema", SCHEMA_PATH],
    {
      cwd: ARTIFACT_ROOT,
      env: {
        ...process.env,
        PRISMA_SCHEMA_ENGINE_BINARY: SCHEMA_ENGINE_BINARY,
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 4 * 60 * 1000, // leave headroom under the function's own configured timeout
    },
  );

  const stdout = tail(result.stdout ?? "");
  const stderr = tail(result.stderr ?? "");
  const success = result.status === 0 && !result.error;

  logger[success ? "info" : "error"](
    { exitCode: result.status, spawnError: result.error?.message, stdoutTail: stdout, stderrTail: stderr },
    "migrate-lambda: prisma migrate deploy finished",
  );

  return {
    statusCode: success ? 200 : 500,
    body: JSON.stringify({
      status: success ? "ok" : "error",
      operation: "prisma migrate deploy",
      exitCode: result.status,
      spawnError: result.error?.message,
      stdout,
      stderr,
    }),
  };
}
