/**
 * Test-database isolation (owner decision, hardening of Slice 1; generalised in the Slice 2 safety round): the ONE validator that decides whether a
 * Postgres URL may be touched by a test. No side effects here (the preload `db-isolation.ts` applies it; `test-db-guard.ts` and `scripts/test-db-cli.ts`
 * re-check with it).
 *
 * A URL is accepted only when ALL hold:
 *   1. it parses;
 *   2. its host is in ALLOWED_HOSTS (this machine only);
 *   3. its port is in ALLOWED_PORTS (the docker-compose.test.yml postgres-test port) and in no FORBIDDEN port (5432 / 5433 = the dev stack);
 *   4. its database name ends with `_test`;
 *   5. its user is the docker-compose.test.yml role (not the dev role);
 * and, on top, it is NOT a DB URL written in the service's `.env` (DATABASE_URL, CHAT_DATABASE_URL: the dev databases, which Prisma reads by itself
 * whenever the variable named in schema.prisma is not set).
 *
 * This file is identical in user-service, chat-service and gym-service (src/__tests__/setup/db-isolation-validator.ts). The list of DB variables a
 * service really uses is NOT here: the preload (DB_ENV_VARS) and scripts/test-db-cli.ts (parsed from prisma/schema.prisma) own it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];
export const ALLOWED_PORTS: readonly string[] = ["55433"];
/** The dev stack publishes Postgres on 5433 (and 5432 inside docker); any URL naming those is refused outright (also guards against a future allowlist edit). */
export const FORBIDDEN_PORTS: readonly string[] = ["5432", "5433"];
/** The docker-compose.test.yml role. A URL whose user is anything else (e.g. the dev role) is refused. */
export const ALLOWED_USERS: readonly string[] = ["gymcoach_test"];
/** Cannot connect to anything: port 1 on loopback refuses. Set instead of every DB variable when no valid test URL was given. */
export const REFUSED_SENTINEL_URL = "postgresql://refused:refused@127.0.0.1:1/__db_isolation_refused__";

/** Every DB variable name any service of this repo reads from its schema.prisma (user/gym: DATABASE_URL, chat: CHAT_DATABASE_URL). */
export const KNOWN_DB_ENV_VARS: readonly string[] = ["DATABASE_URL", "CHAT_DATABASE_URL"];

export type UrlVerdict = { ok: true; url: string } | { ok: false; reason: string };

/** `<service>/.env` (this file lives in src/__tests__/setup). */
export const DEFAULT_ENV_FILE = join(__dirname, "..", "..", "..", ".env");

/** Value of `name` in a dotenv file, or undefined. Parsed, never echoed anywhere. */
export function readDotenvVar(name: string, file: string = DEFAULT_ENV_FILE): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const re = new RegExp("^(?:export\\s+)?" + name + "\\s*=\\s*(.*)$");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = re.exec(line);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}

/** Value of DATABASE_URL in a dotenv file, or undefined. */
export function readDotenvDatabaseUrl(file: string = DEFAULT_ENV_FILE): string | undefined {
  return readDotenvVar("DATABASE_URL", file);
}

/** Every DB URL the service's .env names, under any known DB variable (these are the dev databases). */
export function readDotenvDbUrls(file: string = DEFAULT_ENV_FILE): string[] {
  return KNOWN_DB_ENV_VARS.map((n) => readDotenvVar(n, file)).filter((v): v is string => !!v);
}

/** host:port/db with credentials and query stripped, lower-cased: two URLs naming the same database compare equal. */
export function identityOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.port || "5432"}/${decodeURIComponent(u.pathname.replace(/^\/+/, ""))}`;
  } catch {
    return null;
  }
}

export function validateTestDatabaseUrl(url: string | undefined, envFileDatabaseUrl: string | readonly (string | undefined)[] | undefined = readDotenvDbUrls()): UrlVerdict {
  if (!url) return { ok: false, reason: "no URL" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL does not parse" };
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return { ok: false, reason: "not a postgres URL" };
  if (!ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) return { ok: false, reason: `host is not in the allowlist (${ALLOWED_HOSTS.join(", ")})` };
  if (FORBIDDEN_PORTS.includes(u.port) || !ALLOWED_PORTS.includes(u.port)) return { ok: false, reason: `port is not in the allowlist (${ALLOWED_PORTS.join(", ")})` };
  if (!ALLOWED_USERS.includes(decodeURIComponent(u.username))) return { ok: false, reason: `user is not in the allowlist (${ALLOWED_USERS.join(", ")})` };
  const name = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  if (!/_test$/.test(name)) return { ok: false, reason: "database name does not end with _test" };
  const envUrls = (Array.isArray(envFileDatabaseUrl) ? envFileDatabaseUrl : [envFileDatabaseUrl]).filter((v): v is string => !!v);
  if (envUrls.some((e) => identityOf(e) === identityOf(url))) return { ok: false, reason: "URL is a DB URL of the service .env (the dev database)" };
  return { ok: true, url };
}
