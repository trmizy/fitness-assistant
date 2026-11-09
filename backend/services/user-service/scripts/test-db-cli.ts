/**
 * Prisma CLI wrapper for TEST databases (Slice 2 safety round). The ONLY supported way to run `prisma migrate deploy / migrate status / migrate diff /
 * db push / generate` against a test database. Do NOT call the Prisma CLI directly for a test database: Prisma reads <service>/.env (the DEV database)
 * and the variable its schema names (user/gym: DATABASE_URL, chat: CHAT_DATABASE_URL) is easy to set wrongly - that is how a chat `db push` once reached the
 * dev chat database.
 *
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:...@localhost:55433/<name>_test?schema=public" npm run test:db:migrate
 *   (also: test:db:status, test:db:push, test:db:diff -- <args>, test:db:generate)
 *
 * Before prisma is started this wrapper reads EVERY DB variable named in prisma/schema.prisma (env("...")), takes the value from the shell variable of that
 * name if it is set, else from TEST_DATABASE_URL, and validates each one with the same validator the test preload uses (localhost / 127.0.0.1, port 55433,
 * role gymcoach_test, database name ending _test, never a DB URL of .env, never 5432 / 5433). Anything missing or invalid -> exit code 2, a one-line reason
 * (no credentials printed), and prisma is NOT started: no process, no connection. Arguments that carry a URL (--from-url / --to-url / --shadow-database-url)
 * are validated the same way. Subcommands outside the allowlist (migrate dev, migrate reset, db execute, studio, ...) are refused.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { plan, EXIT_REFUSED } from "../src/__tests__/setup/db-cli-plan";

export const SERVICE_ROOT = path.resolve(__dirname, "..");

export function main(argv: readonly string[]): number {
  const schemaFile = path.join(SERVICE_ROOT, "prisma", "schema.prisma");
  const schemaText = readFileSync(schemaFile, "utf8");
  const p = plan(argv, process.env, schemaText);
  if (!p.ok) {
    console.error(`[test-db-cli] REFUSED (prisma not started): ${p.message}`);
    return EXIT_REFUSED;
  }
  const cli = path.join(SERVICE_ROOT, "node_modules", "prisma", "build", "index.js");
  if (!existsSync(cli)) {
    console.error("[test-db-cli] REFUSED (prisma not started): prisma CLI not found in node_modules");
    return EXIT_REFUSED;
  }
  console.error(`[test-db-cli] prisma ${p.prismaArgs.join(" ").replace(/postgres(ql)?:\/\/\S+/gi, "<url>")}  [${p.targets.join("; ") || "no database"}]`);
  const r = spawnSync(process.execPath, [cli, ...p.prismaArgs], { cwd: SERVICE_ROOT, env: p.childEnv, stdio: "inherit", timeout: 5 * 60_000, windowsHide: true });
  return r.status ?? 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
