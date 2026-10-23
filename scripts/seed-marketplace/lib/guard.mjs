// Safety guards for the marketplace seed (plan 8.2 + 12.13 item 6). Pure functions - no I/O except reading the marker
// file - so every refusal is unit-tested (guard.test.mjs).
//
//   test DBs (name ends in _test, local host)  -> run, no marker needed
//   dev DBs  (gymcoach_<svc> on localhost:5433 or gymcoach-postgres:5432) -> need the verify-clean.ok marker written by the
//                                          DB clean-up step (H4) AND SEED_MARKETPLACE_CONFIRM=dev
//   dev DBs that already hold seed data    -> need --reseed (which only runs the "ensure" functions, never deletes)
//   always refused: NODE_ENV=production, a DB name containing prod / staging / live, a non-local host, anything else
import fs from "node:fs";
import path from "node:path";

export class SeedGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SeedGuardError";
    this.code = code;
  }
}

export const SERVICES = ["auth", "user", "gym", "payment"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "gymcoach-postgres"]);
const FORBIDDEN_NAME = /prod|staging|live/i;
const TEST_NAME = /^gymcoach_(auth|user|gym|payment)_[a-z0-9_]*test$/;
const SHARED_TEST_NAME = /^gymcoach_(auth|user|gym|payment)_test$/; // the DBs the repo's own suites use
const DEV_NAME = /^gymcoach_(auth|user|gym|payment)$/;

export const DEFAULT_MARKER_ROOT = process.env.SEED_MARKETPLACE_MARKER_ROOT || "D:\\FitnessAssistant-backups";

/** The marker is `verify-clean.ok`; H4 writes it with the confirmToken and a timestamp. We only accept a file that carries both. */
export function readMarker(markerPath) {
  if (!markerPath || !fs.existsSync(markerPath)) return null;
  const raw = fs.readFileSync(markerPath, "utf8");
  const token = raw.match(/\b[0-9a-f]{64}\b/i)?.[0];
  const at = raw.match(/\b20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}/)?.[0];
  if (!token || !at) return { valid: false, path: markerPath };
  return { valid: true, path: markerPath, confirmToken: token, at };
}

/** Explicit path (env / flag) wins; otherwise the newest <root>/<timestamp>/verify-clean.ok. */
export function locateMarker({ explicitPath = process.env.SEED_MARKETPLACE_MARKER, root = DEFAULT_MARKER_ROOT } = {}) {
  if (explicitPath) return explicitPath;
  try {
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(root, d.name, "verify-clean.ok"))
      .filter((p) => fs.existsSync(p))
      .sort();
    if (dirs.length) return dirs[dirs.length - 1];
    const direct = path.join(root, "verify-clean.ok");
    return fs.existsSync(direct) ? direct : null;
  } catch {
    return null;
  }
}

/**
 * @param {{host:string, port:number, dbs:Record<string,string>}} target
 * @param {{env?:object, markerPath?:string|null, reseed?:boolean, seedDataPresent?:boolean, allowSharedTestDb?:boolean}} opts
 * @returns {{kind:'test'|'dev'}}
 */
export function assertSeedAllowed(target, opts = {}) {
  const env = opts.env ?? process.env;
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new SeedGuardError("PRODUCTION_REFUSED", "Refusing to run: NODE_ENV=production. The marketplace seed is never run in production.");
  }
  if (!target || !target.host || !target.dbs) throw new SeedGuardError("NO_TARGET", "No target given.");
  if (!LOCAL_HOSTS.has(String(target.host).toLowerCase())) {
    throw new SeedGuardError("HOST_NOT_ALLOWED", `Host "${target.host}" is not local (allowed: ${[...LOCAL_HOSTS].join(", ")}).`);
  }
  const names = SERVICES.map((s) => target.dbs[s]);
  if (names.some((n) => !n)) throw new SeedGuardError("NO_TARGET", `Need a database for each of ${SERVICES.join(", ")}.`);
  for (const n of names) {
    if (FORBIDDEN_NAME.test(n)) throw new SeedGuardError("FORBIDDEN_DB_NAME", `Database name "${n}" contains prod/staging/live.`);
  }

  const allTest = names.every((n) => TEST_NAME.test(n));
  const allDev = names.every((n) => DEV_NAME.test(n));
  if (!allTest && !allDev) {
    const odd = names.find((n) => !TEST_NAME.test(n) && !DEV_NAME.test(n));
    throw new SeedGuardError("DB_NOT_ALLOWLISTED", `Database name "${odd}" is outside the allowlist (gymcoach_<svc>_..._test or gymcoach_<svc>).`);
  }
  if (allTest && allDev) throw new SeedGuardError("DB_NOT_ALLOWLISTED", "ambiguous target");
  // service <-> name coherence: gymcoach_user_x_test must be the *user* DB, etc.
  for (const s of SERVICES) {
    if (!target.dbs[s].startsWith(`gymcoach_${s}`)) {
      throw new SeedGuardError("DB_SERVICE_MISMATCH", `The ${s} database is called "${target.dbs[s]}" - it must start with gymcoach_${s}.`);
    }
  }

  if (allTest) {
    if (!opts.allowSharedTestDb && names.some((n) => SHARED_TEST_NAME.test(n))) {
      throw new SeedGuardError("SHARED_TEST_DB", "gymcoach_<svc>_test is used by the repo's own test suites; use a dedicated gymcoach_<svc>_seed_test (or pass --allow-shared-test-db).");
    }
    return { kind: "test" };
  }

  // dev
  const portOk = (target.host === "gymcoach-postgres" && Number(target.port) === 5432) || (target.host !== "gymcoach-postgres" && Number(target.port) === 5433);
  if (!portOk) throw new SeedGuardError("HOST_NOT_ALLOWED", `Dev databases live on localhost:5433 or gymcoach-postgres:5432, not ${target.host}:${target.port}.`);
  const marker = opts.markerPath === undefined ? readMarker(locateMarker()) : typeof opts.markerPath === "string" ? readMarker(opts.markerPath) : opts.markerPath;
  if (!marker || marker.valid === false) {
    throw new SeedGuardError("MARKER_MISSING", "Dev seed needs the verify-clean.ok marker (written by the DB clean-up step H4, with confirmToken + time). Not found / not valid.");
  }
  if (env.SEED_MARKETPLACE_CONFIRM !== "dev") {
    throw new SeedGuardError("CONFIRM_MISSING", "Dev seed needs SEED_MARKETPLACE_CONFIRM=dev.");
  }
  if (opts.seedDataPresent && !opts.reseed) {
    throw new SeedGuardError("RESEED_REQUIRED", "The dev databases already contain seed data; pass --reseed to run the ensure functions again (nothing is deleted).");
  }
  return { kind: "dev" };
}

/** Builds the target object from env / flags. Defaults: test container on localhost:55433. */
export function resolveTarget({ kind, suffix = "seed_test", env = process.env } = {}) {
  if (kind === "dev") {
    return {
      kind: "dev",
      host: env.SEED_PG_HOST || "localhost",
      port: Number(env.SEED_PG_PORT || 5433),
      user: env.SEED_PG_USER || env.POSTGRES_USER || "gymcoach",
      password: env.SEED_PG_PASSWORD || env.POSTGRES_PASSWORD || "gymcoach_password",
      dbs: Object.fromEntries(SERVICES.map((s) => [s, `gymcoach_${s}`])),
    };
  }
  return {
    kind: "test",
    host: env.SEED_PG_HOST || "localhost",
    port: Number(env.SEED_PG_PORT || 55433),
    user: env.SEED_PG_USER || "gymcoach_test",
    password: env.SEED_PG_PASSWORD || "gymcoach_test_password",
    dbs: Object.fromEntries(SERVICES.map((s) => [s, `gymcoach_${s}_${suffix}`])),
  };
}
