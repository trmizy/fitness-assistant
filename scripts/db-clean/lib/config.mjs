/**
 * db-clean - environment profiles and guards (plan 9, 12.13 item 6, 12.16).
 *
 * Two profiles only:
 *   dev  - the local dev Postgres container (gymcoach-postgres, localhost:5433), databases gymcoach_{auth,user,fitness,ai,chat,payment,gym}.
 *   test - the isolated test Postgres container (localhost:55433), databases gymcoach_<svc><suffix> where suffix looks like _dbclean_test.
 * Anything else is refused. NODE_ENV=production is refused. Database / container names containing prod, staging or live are refused.
 */
import { Refused } from './util.mjs';

export const SERVICES = ['auth', 'user', 'fitness', 'ai', 'chat', 'payment', 'gym'];
/** Plan 12.13 item 7: chat -> ai -> fitness -> payment -> gym -> user -> auth (auth last: kept accounts are never lost before their data). */
export const CLEAN_ORDER = ['chat', 'ai', 'fitness', 'payment', 'gym', 'user', 'auth'];
/** Owned by the partner (ai-service / fitness-service). Audited read-only; cleaned only when the manifest says so (--partner-dbs=include). */
export const PARTNER_OWNED = ['ai', 'fitness'];

export const MAINT_ROLE = 'gymini_maintenance';
export const MAINT_APP_NAME = 'gymini-db-clean';
export const MIN_MAINT_PASSWORD_LENGTH = 24;

const DENY_NAME = /(prod|staging|live)/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'gymcoach-postgres']);

const DEV_APP_CONTAINERS = [
  // everything that holds a connection to postgres, in the order they are stopped (web last is irrelevant). Started in reverse.
  'gymcoach-web-dev',
  'gymcoach-gateway-dev',
  'gymcoach-auth-dev',
  'gymcoach-user-dev',
  'gymcoach-fitness-dev',
  'gymcoach-ai-dev',
  'gymcoach-knowledge-worker-dev',
  'gymcoach-chat-dev',
  'gymcoach-payment-dev',
  'gymcoach-gym-dev',
  'gymcoach-db-seeder',
  'gymcoach-pg-exporter',
];

export function getProfile(envName, { suffix } = {}) {
  if (envName === 'dev') {
    const p = {
      name: 'dev',
      container: 'gymcoach-postgres',
      host: 'localhost',
      port: 5433,
      appUser: process.env.DBCLEAN_APP_USER || 'gymcoach',
      appPassword: process.env.DBCLEAN_APP_PASSWORD || 'gymcoach_password',
      suffix: '',
      appContainers: DEV_APP_CONTAINERS,
      dbName: (svc) => `gymcoach_${svc}`,
    };
    return p;
  }
  if (envName === 'test') {
    const sfx = suffix ?? '_dbclean_test';
    if (!/^_dbclean[a-z0-9]*_test$/.test(sfx)) throw new Refused(`test database suffix "${sfx}" must match ^_dbclean[a-z0-9]*_test$`, 'GUARD_DB_NAME');
    return {
      name: 'test',
      container: 'gymcoach-test-postgres-test-1',
      host: 'localhost',
      port: 55433,
      appUser: process.env.DBCLEAN_APP_USER || 'gymcoach_test',
      appPassword: process.env.DBCLEAN_APP_PASSWORD || 'gymcoach_test_password',
      suffix: sfx,
      appContainers: [],
      dbName: (svc) => `gymcoach_${svc}${sfx}`,
    };
  }
  throw new Refused(`--env must be "dev" or "test" (got ${envName === undefined ? 'nothing' : `"${envName}"`})`, 'GUARD_ENV');
}

/** Pure guard: throws Refused. Never connects. `mutating` commands on dev additionally need DBCLEAN_CONFIRM=dev. */
export function assertGuards(profile, { mutating = false, env = process.env } = {}) {
  if (env.NODE_ENV === 'production') throw new Refused('NODE_ENV=production - refusing to run', 'GUARD_PRODUCTION');
  if (!LOCAL_HOSTS.has(profile.host)) throw new Refused(`host "${profile.host}" is not a local host`, 'GUARD_HOST');
  if (DENY_NAME.test(profile.container)) throw new Refused(`container name "${profile.container}" contains prod/staging/live`, 'GUARD_DB_NAME');
  for (const svc of SERVICES) {
    const name = profile.dbName(svc);
    if (DENY_NAME.test(name)) throw new Refused(`database name "${name}" contains prod/staging/live`, 'GUARD_DB_NAME');
    if (profile.name === 'dev' && !new RegExp(`^gymcoach_${svc}$`).test(name)) throw new Refused(`database "${name}" is not in the dev allowlist`, 'GUARD_DB_NAME');
    if (profile.name === 'test' && !new RegExp(`^gymcoach_${svc}_dbclean[a-z0-9]*_test$`).test(name)) {
      throw new Refused(`database "${name}" is not a *_dbclean*_test database`, 'GUARD_DB_NAME');
    }
  }
  if (profile.name === 'dev' && mutating && env.DBCLEAN_CONFIRM !== 'dev') {
    throw new Refused('this command changes the dev stack: set DBCLEAN_CONFIRM=dev to confirm', 'GUARD_CONFIRM');
  }
  return true;
}

export function maintPasswordFromEnv(env = process.env) {
  const pw = env.DBCLEAN_MAINT_PASSWORD;
  if (!pw) throw new Refused('DBCLEAN_MAINT_PASSWORD is required (>= 24 chars, random, process environment only - never printed, never written to a file)', 'MAINT_PASSWORD');
  if (pw.length < MIN_MAINT_PASSWORD_LENGTH) throw new Refused(`DBCLEAN_MAINT_PASSWORD must be at least ${MIN_MAINT_PASSWORD_LENGTH} characters`, 'MAINT_PASSWORD');
  if (!/^[A-Za-z0-9_\-.]+$/.test(pw)) throw new Refused('DBCLEAN_MAINT_PASSWORD may only contain letters, digits, _ - .', 'MAINT_PASSWORD');
  return pw;
}
