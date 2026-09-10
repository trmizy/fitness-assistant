/**
 * Test-only catalog seed entrypoint for the isolated docker-compose Postgres.
 *
 * It reuses the real fitness-service seed/import pipeline. No dev DB dump, no
 * internet, no developer-specific data.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

function redactUrl(url: string) {
  return url.replace(/:[^:@/]+@/, ":***@");
}

function assertTestDatabase(url: string) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Refusing to seed test catalog unless NODE_ENV=test");
  }
  if (!/(_test|postgres-test|localhost:55433)/i.test(url)) {
    throw new Error(`Refusing to seed non-test database: ${redactUrl(url)}`);
  }
  if (/gymcoach_fitness(\?|$)/i.test(url) && !/_test/i.test(url)) {
    throw new Error(`Refusing to seed developer/production fitness DB: ${redactUrl(url)}`);
  }
}

async function main() {
  const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
  assertTestDatabase(url);
  process.env.DATABASE_URL = url;

  const serviceRoot = path.resolve(__dirname, "../..");
  const tsxBin = path.join(
    serviceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.CMD" : "tsx",
  );

  console.log(`[catalog-test-seed] target=${redactUrl(url)}`);
  execFileSync(tsxBin, [path.join("prisma", "seed_all.ts")], {
    cwd: serviceRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
