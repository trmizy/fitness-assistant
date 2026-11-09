/**
 * Test-database isolation (hardening of Slice 1). TEST FIXTURE + CODE AUDIT for the validator; REAL child processes (node + tsx + the real
 * preload + the real generated Prisma client) for the behaviour. No database is ever reached: the only connection attempt goes to the
 * unconnectable sentinel (127.0.0.1:1) and must FAIL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_ENV_FILE, REFUSED_SENTINEL_URL, identityOf, readDotenvDatabaseUrl, validateTestDatabaseUrl } from "./setup/db-isolation-validator";

const SERVICE_ROOT = join(__dirname, "..", "..");
const PRELOAD = pathToFileURL(join(__dirname, "setup", "db-isolation.ts")).href;
const GOOD = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_dispute_test?schema=public";
const DEV = "postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_user?schema=public";

// ── (a) the validator ──────────────────────────────────────────────────────────────────────────────────────────────

test("(a) the validator refuses: dev URL, :5433 even with a _test name, foreign host, wrong port, a URL equal to the .env one, junk", () => {
  const envUrl = "postgresql://gymcoach_test:y@localhost:55433/gymcoach_user_other_test";
  const refused: Array<[string, string | undefined]> = [
    ["dev URL", DEV],
    [":5433 with a _test name", "postgresql://gymcoach:p@localhost:5433/gymcoach_user_test"],
    ["foreign host", "postgresql://u:p@db.example.com:55433/gymcoach_user_test"],
    ["private-LAN host", "postgresql://u:p@192.168.1.20:55433/gymcoach_user_test"],
    ["docker service host", "postgresql://u:p@postgres-test:55433/gymcoach_user_test"],
    ["_test name, wrong port 5432", "postgresql://u:p@localhost:5432/gymcoach_user_test"],
    ["no port (defaults to 5432)", "postgresql://u:p@localhost/gymcoach_user_test"],
    ["right host+port, name without _test", "postgresql://u:p@localhost:55433/gymcoach_user"],
    ["_test only in the user name", "postgresql://gymcoach_test:p@localhost:55433/gymcoach_user"],
    ["_test only in the query", "postgresql://u:p@localhost:55433/gymcoach_user?schema=x_test"],
    ["not a postgres URL", "mysql://u:p@localhost:55433/x_test"],
    ["dev role on a 55433 _test database", "postgresql://gymcoach:gymcoach_password@localhost:55433/gymcoach_user_test"],
    ["dev database gym_coach_users on :5433", "postgresql://gymcoach:gymcoach_password@localhost:5433/gym_coach_users?schema=public"],
    ["production-style managed host", "postgresql://app:secret@gymini-prod.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/gymini_prod"],
    ["production host with _test name and 55433", "postgresql://gymcoach_test:p@prod-db.internal:55433/gymini_test"],
    ["malformed port", "postgresql://gymcoach_test:p@localhost:abc/x_test"],
    ["junk", "not a url"],
    ["empty", ""],
    ["unset", undefined],
  ];
  for (const [label, url] of refused) assert.equal(validateTestDatabaseUrl(url, envUrl).ok, false, label);
  // the same database as the one named in .env is refused even though it satisfies the other four rules
  assert.equal(validateTestDatabaseUrl(envUrl, envUrl).ok, false, "equal to .env");
  assert.equal(validateTestDatabaseUrl("postgresql://gymcoach_test:pw@LOCALHOST:55433/gymcoach_user_other_test?schema=public", envUrl).ok, false, "equal to .env after normalisation (case, credentials, query)");
  assert.equal(identityOf("postgresql://a:b@localhost:55433/d_test?x=1"), identityOf("postgresql://c:d@LOCALHOST:55433/d_test"));
});

test("(c) a valid test URL is accepted (localhost / 127.0.0.1, port 55433, name ends _test, not the .env URL)", () => {
  const envUrl = "postgresql://x:y@localhost:5433/gymcoach_user";
  assert.deepEqual(validateTestDatabaseUrl(GOOD, envUrl), { ok: true, url: GOOD });
  assert.equal(validateTestDatabaseUrl("postgresql://gymcoach_test:p@127.0.0.1:55433/anything_test", envUrl).ok, true);
  assert.equal(validateTestDatabaseUrl("postgres://gymcoach_test:p@localhost:55433/anything_test", envUrl).ok, true);
});

test("the real service .env is parsed (not echoed): its DATABASE_URL is never an acceptable test URL", () => {
  const fromEnv = readDotenvDatabaseUrl();
  if (existsSync(DEFAULT_ENV_FILE)) assert.ok(fromEnv, ".env has a DATABASE_URL");
  if (fromEnv) assert.equal(validateTestDatabaseUrl(fromEnv).ok, false);
});

// ── child processes ───────────────────────────────────────────────────────────────────────────────────────────────

function child(code: string, env: Record<string, string | undefined>, withPreload = true) {
  const base: Record<string, string | undefined> = { ...process.env, DB_ISOLATION_QUIET: "1" };
  delete base.DATABASE_URL;
  delete base.TEST_DATABASE_URL;
  delete base.DB_ISOLATION;
  const merged = { ...base, ...env };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const args = ["--import", "tsx", ...(withPreload ? ["--import", PRELOAD] : []), "--eval", code];
  const r = spawnSync(process.execPath, args, { cwd: SERVICE_ROOT, env: merged as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

const REPORT = `
const u = new URL(process.env.DATABASE_URL);
console.log(JSON.stringify({ iso: process.env.DB_ISOLATION, host: u.hostname, port: u.port, db: u.pathname.slice(1) }));
`;

test("(b) no TEST_DATABASE_URL + the real .env present: the child sees the sentinel, NOT the .env value, and a PrismaClient there fails to connect", () => {
  const envUrl = readDotenvDatabaseUrl();
  const r = child(
    `${REPORT}
const { PrismaClient } = require("./src/generated/prisma");
const p = new PrismaClient();
const timer = setTimeout(() => { console.log("CONNECT:HUNG"); process.exit(3); }, 20000);
p.$connect().then(() => { console.log("CONNECT:OK"); process.exit(2); }, (e) => { console.log("CONNECT:FAILED:" + (e.errorCode || e.code || e.name)); process.exit(0); });
`,
    {},
  );
  const lines = r.out.split(/\r?\n/);
  const info = JSON.parse(lines.find((l) => l.startsWith("{"))!);
  assert.equal(info.iso, "refused");
  assert.equal(info.host, "127.0.0.1");
  assert.equal(info.port, "1");
  assert.equal(info.db, "__db_isolation_refused__");
  if (envUrl) assert.notEqual(identityOf(`postgresql://${info.host}:${info.port}/${info.db}`), identityOf(envUrl), "the child does not see the .env database");
  assert.ok(lines.some((l) => l.startsWith("CONNECT:FAILED:")), `connect must fail, got: ${r.out} ${r.err.slice(0, 300)}`);
  assert.equal(r.status, 0);
});

test("(b) every refused TEST_DATABASE_URL (dev :5433, foreign host, wrong port, the .env URL itself) ends in the same sentinel", () => {
  const envUrl = readDotenvDatabaseUrl();
  const bad = [
    DEV,
    "postgresql://gymcoach:gymcoach_password@localhost:5433/gym_coach_users?schema=public",
    "postgresql://app:secret@gymini-prod.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/gymini_prod",
    "postgresql://u:p@db.example.com:55433/x_test",
    "postgresql://gymcoach_test:p@localhost:5432/x_test",
    "postgresql://gymcoach_test:p@localhost:abc/x_test",
    "not a url",
    ...(envUrl ? [envUrl] : []),
  ];
  for (const url of bad) {
    const r = child(REPORT, { TEST_DATABASE_URL: url });
    const info = JSON.parse(r.out.split(/\r?\n/).find((l) => l.startsWith("{"))!);
    assert.equal(info.iso, "refused", url.replace(/\/\/.*@/, "//***@"));
    assert.equal(info.port, "1");
  }
});

test("(c) a valid TEST_DATABASE_URL is accepted by the preload and becomes DATABASE_URL", () => {
  const r = child(REPORT, { TEST_DATABASE_URL: GOOD });
  const info = JSON.parse(r.out.split(/\r?\n/).find((l) => l.startsWith("{"))!);
  assert.deepEqual(info, { iso: "accepted", host: "localhost", port: "55433", db: "gymcoach_user_dispute_test" });
});

test("the DB guard is fail-closed: skipped without the preload (even with a good-looking DATABASE_URL) and when refused; usable only after acceptance", () => {
  const code = `const g = require("./src/__tests__/test-db-guard"); console.log("USABLE:" + g.usable);`;
  assert.match(child(code, { DATABASE_URL: GOOD }, false).out, /USABLE:false/, "no preload, no acceptance flag");
  assert.match(child(code, { DATABASE_URL: GOOD, DB_ISOLATION: "accepted" }, false).out, /USABLE:true/, "flag + a URL that passes the validator");
  assert.match(child(code, { DATABASE_URL: DEV, DB_ISOLATION: "accepted" }, false).out, /USABLE:false/, "a forged flag does not make a dev URL usable");
  assert.match(child(code, {}).out, /USABLE:false/, "preload, no TEST_DATABASE_URL");
  assert.match(child(code, { TEST_DATABASE_URL: DEV }).out, /USABLE:false/, "preload, dev URL");
  assert.match(child(code, { TEST_DATABASE_URL: GOOD }).out, /USABLE:true/, "preload, valid URL");
  assert.equal(REFUSED_SENTINEL_URL.includes("127.0.0.1:1/"), true);
});
