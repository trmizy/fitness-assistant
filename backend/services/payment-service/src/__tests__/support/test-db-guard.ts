/**
 * Test-database guard (owner decision D58/D63, audit defect D57-6-5).
 *
 * A test that writes to Postgres must run ONLY against a database whose NAME ends with `_test`
 * (gymcoach_user_test, gymcoach_user_crash_test, ...). The check looks at the database name alone: the old
 * `/_test/i.test(<whole url>)` also matched the USER name `gymcoach_test` and any `?schema=..._test` query,
 * so a URL pointing at a real database with the test credentials passed it.
 *
 * Behaviour when the URL is missing or points anywhere else: nothing is run and nothing is written. Every test is
 * reported as SKIPPED with the reason below (same "usable / skip" convention as the other integration suites; payment-service copy of the user-service guard),
 * so `npm test` on a developer machine stays green and a wrong DATABASE_URL can never create or delete a row.
 *
 * Usage - in a test file that touches the real database, replace `import test from "node:test"` with
 *   import { guardedTest as test } from "./support/test-db-guard";
 * (the rest of the file is unchanged: `test(...)`, `test.before/after/beforeEach/afterEach(...)`), or take `skip`
 * and pass `{ skip }` to each test.
 */
import nodeTest from "node:test";

/** The database name of a Postgres URL, or "" when the URL is missing or unparsable. */
export function databaseNameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

/** True only when the URL parses and its database name ends with `_test`. */
export function isTestDatabaseUrl(url: string | undefined): boolean {
  return /_test$/.test(databaseNameOf(url));
}

export const usable = isTestDatabaseUrl(process.env.DATABASE_URL);

export const skip: string | false = usable
  ? false
  : `Refusing to touch a database: DATABASE_URL must point at a database whose name ends with "_test" (got "${databaseNameOf(process.env.DATABASE_URL) || "<unset>"}").`;

type AnyFn = (...args: any[]) => any;

function withSkip(args: any[]): any[] {
  if (!skip) return args;
  // Forms accepted by node:test: (fn) (name, fn) (name, options, fn) (options, fn)
  const out = [...args];
  const optIdx = out.findIndex((a) => a !== null && typeof a === "object");
  if (optIdx >= 0) {
    out[optIdx] = { ...out[optIdx], skip: out[optIdx].skip || skip };
    return out;
  }
  const fnIdx = out.findIndex((a) => typeof a === "function");
  out.splice(fnIdx >= 0 ? fnIdx : out.length, 0, { skip });
  return out;
}

const guarded: any = (...args: any[]) => (nodeTest as AnyFn)(...withSkip(args));
guarded.skip = nodeTest.skip;
guarded.todo = nodeTest.todo;
guarded.only = nodeTest.only;
// Setup / teardown hooks are not registered at all when the guard refuses: a hook must not touch the database either.
for (const hook of ["before", "after", "beforeEach", "afterEach"] as const) {
  guarded[hook] = (...args: any[]) => (usable ? (nodeTest as any)[hook](...args) : undefined);
}

export const guardedTest = guarded as typeof nodeTest;
