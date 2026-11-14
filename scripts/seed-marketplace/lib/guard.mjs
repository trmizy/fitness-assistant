// Safety guards for the marketplace seed (plan 8.2 + 12.13 item 6). Pure functions - no I/O except reading the marker
// file - so every refusal is unit-tested (guard.test.mjs).
//
//   test DBs (name ends in _test, local host)  -> run, no marker needed
//   dev DBs  (gymcoach_<svc> on localhost:5433 or gymcoach-postgres:5432) -> need the verify-clean.ok marker written by the
//                                          DB clean-up step (H4) AND SEED_MARKETPLACE_CONFIRM=dev
//   dev DBs that already hold seed data    -> need --reseed (which only runs the "ensure" functions, never deletes)
//   official DBs (gymcoach_<svc>_official, 4 services, loopback host unless --allow-remote-host) -> the database prepared for
//                                          the thesis defense: scale-tier SYNTHETIC history + the REAL business seed on top.
//                                          Needs SEED_MARKETPLACE_CONFIRM=official and EMPTY tables for the scale tier.
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
export const ALL_SERVICES = ["auth", "user", "fitness", "ai", "chat", "payment", "gym"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "gymcoach-postgres"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const FORBIDDEN_NAME = /prod|staging|live/i;
const TEST_NAME = /^gymcoach_(auth|user|gym|payment)_[a-z0-9_]*test$/;
const SHARED_TEST_NAME = /^gymcoach_(auth|user|gym|payment)_test$/; // the DBs the repo's own suites use
const DEV_NAME = /^gymcoach_(auth|user|gym|payment)$/;
const SCALE_NAME_ANY = /^gymcoach_(auth|user|fitness|ai|chat|payment|gym)_scale$/;
const OFFICIAL_NAME_ANY = /_official$/i;

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

function assertScaleAllowed(target, env) {
  const host = String(target.host).toLowerCase();
  const port = Number(target.port);
  const hostPortOk =
    (host === "gymcoach-postgres-scale" && port === 5432) ||
    (LOOPBACK_HOSTS.has(host) && port === 55440);
  if (!hostPortOk) {
    throw new SeedGuardError(
      "HOST_NOT_ALLOWED",
      `Scale databases live on localhost:55440 or gymcoach-postgres-scale:5432, not ${target.host}:${target.port}.`,
    );
  }
  for (const service of ALL_SERVICES) {
    const name = target.dbs[service];
    if (!name) throw new SeedGuardError("NO_TARGET", `Need a database for each of ${ALL_SERVICES.join(", ")}.`);
    if (FORBIDDEN_NAME.test(name)) {
      throw new SeedGuardError("FORBIDDEN_DB_NAME", `Database name "${name}" contains prod/staging/live.`);
    }
    if (name !== `gymcoach_${service}_scale`) {
      if (SCALE_NAME_ANY.test(name)) {
        throw new SeedGuardError(
          "DB_SERVICE_MISMATCH",
          `The ${service} database is called "${name}" - it must be gymcoach_${service}_scale.`,
        );
      }
      throw new SeedGuardError(
        "DB_NOT_ALLOWLISTED",
        `Database "${name}" is not allowed for ${service}/scale (expected gymcoach_${service}_scale).`,
      );
    }
  }
  if (env.SEED_MARKETPLACE_CONFIRM !== "scale") {
    throw new SeedGuardError("CONFIRM_MISSING", "Scale seed needs SEED_MARKETPLACE_CONFIRM=scale.");
  }
  return { kind: "scale" };
}

/**
 * `--target official`: the database set shown at the thesis defense. Only the four seeded services (auth/user/gym/payment),
 * only names gymcoach_<svc>_official, loopback host by default (remote needs the explicit allowRemoteHost option / --allow-remote-host),
 * never a name or host containing prod/staging/live, never the reserved scale endpoint, and SEED_MARKETPLACE_CONFIRM=official.
 */
function assertOfficialAllowed(target, env, opts) {
  const host = String(target.host).toLowerCase();
  const port = Number(target.port);
  if (FORBIDDEN_NAME.test(host)) {
    throw new SeedGuardError("FORBIDDEN_DB_NAME", `Host "${target.host}" contains prod/staging/live.`);
  }
  if (host === "gymcoach-postgres-scale" || port === 55440) {
    throw new SeedGuardError("HOST_NOT_ALLOWED", `Scale Postgres endpoint ${target.host}:${target.port} is reserved for --target scale.`);
  }
  if (!LOOPBACK_HOSTS.has(host) && opts.allowRemoteHost !== true) {
    throw new SeedGuardError(
      "HOST_NOT_ALLOWED",
      `Host "${target.host}" is not loopback (allowed by default: ${[...LOOPBACK_HOSTS].join(", ")}). A non-local Postgres needs the explicit --allow-remote-host flag.`,
    );
  }
  const extra = Object.keys(target.dbs).find((k) => !SERVICES.includes(k));
  if (extra) throw new SeedGuardError("DB_NOT_ALLOWLISTED", `The official target seeds only ${SERVICES.join(", ")}; unexpected database key "${extra}".`);
  for (const service of SERVICES) {
    const name = target.dbs[service];
    if (!name) throw new SeedGuardError("NO_TARGET", `Need a database for each of ${SERVICES.join(", ")}.`);
    if (FORBIDDEN_NAME.test(name)) throw new SeedGuardError("FORBIDDEN_DB_NAME", `Database name "${name}" contains prod/staging/live.`);
    if (name !== `gymcoach_${service}_official`) {
      if (/^gymcoach_(auth|user|fitness|ai|chat|payment|gym)_official$/.test(name)) {
        throw new SeedGuardError("DB_SERVICE_MISMATCH", `The ${service} database is called "${name}" - it must be gymcoach_${service}_official.`);
      }
      throw new SeedGuardError("DB_NOT_ALLOWLISTED", `Database "${name}" is not allowed for ${service}/official (expected gymcoach_${service}_official).`);
    }
  }
  if (env.SEED_MARKETPLACE_CONFIRM !== "official") {
    throw new SeedGuardError("CONFIRM_MISSING", "The official seed needs SEED_MARKETPLACE_CONFIRM=official.");
  }
  return { kind: "official", requiresEmptyCheck: true };
}

/** Rejects any non-scale target that touches *_scale databases or the scale Postgres host/port. */
function assertNonScaleRejectsScale(target) {
  for (const name of Object.values(target.dbs)) {
    if (typeof name === "string" && OFFICIAL_NAME_ANY.test(name)) {
      throw new SeedGuardError(
        "DB_NOT_ALLOWLISTED",
        `Database "${name}" is an official (defense) database; only --target official may touch *_official DBs.`,
      );
    }
  }
  for (const name of Object.values(target.dbs)) {
    if (typeof name === "string" && (SCALE_NAME_ANY.test(name) || /_scale$/i.test(name))) {
      throw new SeedGuardError(
        "DB_NOT_ALLOWLISTED",
        `Database "${name}" is a scale database; only --target scale may touch *_scale DBs.`,
      );
    }
  }
  const host = String(target.host).toLowerCase();
  const port = Number(target.port);
  if (host === "gymcoach-postgres-scale" || port === 55440) {
    throw new SeedGuardError(
      "HOST_NOT_ALLOWED",
      `Scale Postgres endpoint ${target.host}:${target.port} is reserved for --target scale.`,
    );
  }
}

/**
 * @param {{host:string, port:number, dbs:Record<string,string>}} target
 * @param {{env?:object, markerPath?:string|null, reseed?:boolean, seedDataPresent?:boolean, allowSharedTestDb?:boolean}} opts
 * @returns {{kind:'test'|'dev'|'fresh'|'partner'|'scale'}}
 */
export function assertSeedAllowed(target, opts = {}) {
  const env = opts.env ?? process.env;
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new SeedGuardError("PRODUCTION_REFUSED", "Refusing to run: NODE_ENV=production. The marketplace seed is never run in production.");
  }
  if (!target || !target.host || !target.dbs) throw new SeedGuardError("NO_TARGET", "No target given.");
  if (target.kind === "scale") {
    return assertScaleAllowed(target, env);
  }
  if (target.kind === "official") {
    return assertOfficialAllowed(target, env, opts);
  }
  assertNonScaleRejectsScale(target);
  if (!LOCAL_HOSTS.has(String(target.host).toLowerCase())) {
    throw new SeedGuardError("HOST_NOT_ALLOWED", `Host "${target.host}" is not local (allowed: ${[...LOCAL_HOSTS].join(", ")}).`);
  }
  if (target.kind === "fresh" || target.kind === "partner") {
    for (const service of ALL_SERVICES) {
      const name = target.dbs[service];
      if (!name || FORBIDDEN_NAME.test(name)) throw new SeedGuardError("FORBIDDEN_DB_NAME", `Invalid ${service} database name.`);
      const allowed = target.kind === "fresh" ? name === `gymcoach_${service}_seedrun` : new RegExp(`^gymcoach_${service}(?:_[a-z0-9_]+)?$`).test(name);
      if (!allowed) throw new SeedGuardError("DB_NOT_ALLOWLISTED", `Database ${name} is not allowed for ${service}/${target.kind}.`);
    }
    if (target.kind === "partner" && env.SEED_MARKETPLACE_CONFIRM !== "partner") {
      throw new SeedGuardError("CONFIRM_MISSING", "Partner seed needs SEED_MARKETPLACE_CONFIRM=partner.");
    }
    return { kind: target.kind, requiresEmptyCheck: target.kind === "fresh" };
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
  if (kind === "scale") {
    return {
      kind: "scale",
      host: env.SEED_PG_HOST || "localhost",
      port: Number(env.SEED_PG_PORT || 55440),
      user: env.SEED_PG_USER || "gymcoach_scale",
      password: env.SEED_PG_PASSWORD || "scale_pg_password_isolated",
      dbs: Object.fromEntries(ALL_SERVICES.map((s) => [s, `gymcoach_${s}_scale`])),
    };
  }
  if (kind === "official") {
    return {
      kind: "official",
      host: env.SEED_PG_HOST || "localhost",
      port: Number(env.SEED_PG_PORT || 5433),
      user: env.SEED_PG_USER || "gymcoach",
      password: env.SEED_PG_PASSWORD || "gymcoach_password",
      dbs: Object.fromEntries(SERVICES.map((s) => [s, `gymcoach_${s}_official`])),
    };
  }
  if (kind === "fresh" || kind === "partner") {
    const tail = kind === "fresh" ? "_seedrun" : env.SEED_DB_SUFFIX ? `_${env.SEED_DB_SUFFIX}` : "";
    return {
      kind, host: env.SEED_PG_HOST || "localhost", port: Number(env.SEED_PG_PORT || 5433),
      user: env.SEED_PG_USER || "gymcoach", password: env.SEED_PG_PASSWORD || "gymcoach_password",
      dbs: Object.fromEntries(ALL_SERVICES.map(s => [s, `gymcoach_${s}${tail}`])),
    };
  }
  if (kind !== undefined && kind !== "test" && kind !== "dev") throw new SeedGuardError("NO_TARGET", `Unknown target: ${kind}`);
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
