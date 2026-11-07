import { KNOWN_DB_ENV_VARS, identityOf, validateTestDatabaseUrl } from "./db-isolation-validator";

/** Pure planning of the Prisma CLI wrapper (scripts/test-db-cli.ts). No I/O: unit-testable, and the wrapper spawns prisma only when this says ok. */
export const EXIT_REFUSED = 2;

const ALLOWED: ReadonlyArray<readonly string[]> = [["migrate", "deploy"], ["migrate", "status"], ["migrate", "diff"], ["db", "push"], ["generate"]];
const URL_FLAGS = ["--from-url", "--to-url", "--shadow-database-url"];
const FORBIDDEN_FLAGS = ["--force-reset", "--schema-from-env", "--url"];

export function dbVarsOfSchema(schemaText: string): string[] {
  const names = new Set<string>();
  for (const m of schemaText.matchAll(/env\(\s*"([A-Za-z0-9_]+)"\s*\)/g)) names.add(m[1]);
  return [...names];
}

export type Plan = { ok: true; prismaArgs: string[]; childEnv: NodeJS.ProcessEnv; targets: string[] } | { ok: false; message: string };

export function plan(argv: readonly string[], env: NodeJS.ProcessEnv, schemaText: string, envFileUrls?: readonly string[]): Plan {
  const needsDb = !(argv.length === 1 && argv[0] === "generate");
  const sub = ALLOWED.find((a) => a.every((w, i) => argv[i] === w));
  if (!sub) return { ok: false, message: `subcommand not allowed (${ALLOWED.map((a) => a.join(" ")).join(" | ")}): ${argv.slice(0, 2).join(" ") || "<none>"}` };
  for (const a of argv) {
    if (FORBIDDEN_FLAGS.some((f) => a === f || a.startsWith(f + "="))) return { ok: false, message: `flag not allowed: ${a.split("=")[0]}` };
  }
  const schemaVars = dbVarsOfSchema(schemaText);
  // every DB variable of the repo (not only the ones this schema names): a dev URL in ANY of them is refused, and the child sees only validated values
  const vars = [...new Set([...schemaVars, ...KNOWN_DB_ENV_VARS])];
  if (schemaVars.length === 0) return { ok: false, message: "no env(...) variable found in prisma/schema.prisma" };
  const childEnv: NodeJS.ProcessEnv = { ...env, PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" };
  const targets: string[] = [];
  if (needsDb) {
    for (const name of vars) {
      const value = env[name] ?? env.TEST_DATABASE_URL;
      const v = envFileUrls ? validateTestDatabaseUrl(value, envFileUrls) : validateTestDatabaseUrl(value);
      if (!v.ok) return { ok: false, message: `${name}: ${v.reason}` };
      childEnv[name] = v.url;
      targets.push(`${name} -> ${identityOf(v.url)}`);
    }
  } else {
    // generate touches no database; still never let a dev URL ride along in the environment
    for (const name of vars) delete childEnv[name];
  }
  // URL-carrying arguments
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (URL_FLAGS.includes(flag)) {
      const value = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
      const v = envFileUrls ? validateTestDatabaseUrl(value, envFileUrls) : validateTestDatabaseUrl(value);
      if (!v.ok) return { ok: false, message: `${flag}: ${v.reason}` };
    } else if (/^postgres(ql)?:\/\//i.test(a) && !(i > 0 && URL_FLAGS.includes(argv[i - 1]))) {
      return { ok: false, message: "a database URL on the command line must be passed with --from-url / --to-url / --shadow-database-url" };
    }
  }
  return { ok: true, prismaArgs: [...argv], childEnv, targets };
}

