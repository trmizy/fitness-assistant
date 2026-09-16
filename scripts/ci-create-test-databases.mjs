import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

/**
 * Creates the per-service isolated test databases against a plain GitHub
 * Actions `postgres` service container (used by the "db-integration" CI job
 * — see .github/workflows/docker-test.yml). Local Docker-based testing
 * (docker-compose.test.yml's `postgres-test` service) gets the same
 * databases for free via Postgres's own `docker-entrypoint-initdb.d`
 * mechanism, mounting `docker/test/postgres-init-test.sql` directly — a
 * GitHub Actions `services:` container can't mount custom init scripts as
 * easily, so this script reads and replays THE SAME SQL FILE instead of
 * hand-duplicating the database list, so the two paths can never drift.
 *
 * Idempotent: safe to re-run against a database that already has some/all
 * of these databases (e.g. a warm CI runner or repeated local use).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(here, "..", "docker", "test", "postgres-init-test.sql");
const statements = readFileSync(sqlPath, "utf8")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const client = new pg.Client({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || "gymcoach_test",
  password: process.env.POSTGRES_PASSWORD || "gymcoach_test_password",
  database: "postgres", // connect to the default admin DB to run CREATE DATABASE
});

async function main() {
  await client.connect();
  for (const statement of statements) {
    try {
      await client.query(statement);
      console.log(`[ci-create-test-databases] applied: ${statement}`);
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        console.log(`[ci-create-test-databases] already exists, skipping: ${statement}`);
      } else {
        throw err;
      }
    }
  }
  await client.end();
}

main().catch((err) => {
  console.error("[ci-create-test-databases] failed:", err);
  process.exitCode = 1;
});
