#!/usr/bin/env node
/**
 * Remove the fixture users created by seed-test-users.mjs (testuser001-100 / testpt001-005) and their SEED-GENERATED data,
 * from a disposable dev / test database ONLY. Redesigned in D65 (owner rules) - it used to delete by e-mail pattern from
 * whatever database the environment pointed at, and it deleted contracts, which fails (and used to leave a half-done cleanup)
 * as soon as a contract carries audit history.
 *
 * DRY-RUN BY DEFAULT. It reads, prints exactly what it would delete and what it keeps, and writes nothing (every connection
 * runs in a READ ONLY transaction). `--apply` executes.
 *
 *   node scripts/cleanup-test-users.mjs                 dry run (same as --dry-run)
 *   node scripts/cleanup-test-users.mjs --apply         delete
 *   options: --db-suffix=<s>      databases are gymcoach_{auth,user,fitness,ai,chat}<s>  (default: none = the local dev databases)
 *            --allow-dev-db       REQUIRED to touch the local dev databases (names without a "_test" ending), dry-run included
 *            --max-users=<n>      refuse to --apply when more than n fixture users would be removed (default 105 = 100 + 5)
 *   env:     POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER / POSTGRES_PASSWORD (passwords are never printed),
 *            CLEANUP_EXTRA_HOSTS=host1,host2   extra host names to accept as "local" (e.g. a compose service name), explicit opt-in
 *
 * GUARDS (any failure = refuse, exit 1, nothing connected-to beyond the name checks):
 *   1. NODE_ENV=production                         -> refused.
 *   2. host must be localhost / 127.0.0.1 / ::1 (or listed in CLEANUP_EXTRA_HOSTS).
 *   3. EVERY one of the five database names must either end with "_test" (isolated test database), or be one of the known local
 *      dev names (gymcoach_auth / _user / _fitness / _ai / _chat) AND --allow-dev-db was passed. Names containing prod, staging
 *      or live are refused even if they end with _test. After connecting, current_database() must equal the expected name.
 *
 * HOW A FIXTURE USER IS IDENTIFIED (all three must hold, otherwise the account is reported as UNPROVEN and left alone):
 *   a. e-mail matches ^test(user|pt)[0-9]{3}@example.com$   (exactly 3 digits - what the seed writes)
 *   b. role matches the prefix (testuser -> CUSTOMER, testpt -> PT)
 *   c. it has the seed's own signature: a REGISTER audit log whose userAgent is "Mozilla/5.0 (Seed Script)"
 *
 * WHAT IS NEVER DELETED (the owner prefers a cleanup that skips over deleting audit records to get past a constraint):
 *   - pt_restrictions / pt_restriction_contract_extensions rows - ever.
 *   - session_settlements rows - ever. (Orphan rows of already-deleted contracts are not touched either.)
 *   - payment-service data (this script never connects to it).
 *   A CONTRACT is KEPT (not deleted) when ANY of: it has a payment_transaction_id; money was released (released_to_pt / gym /
 *   platform > 0); it belongs to a gym (gym_id / source <> INDEPENDENT); it has restriction history (pt_restrictions row for the
 *   contract, an extension row, or client_exit_restriction_id); it has any session_settlements row; its other party is NOT a
 *   proven fixture user (a real person's contract is never removed because a test account is on the other side).
 *   A fixture USER is KEPT ENTIRELY (auth account, profile, every row) when it is party to a kept contract, has a
 *   pt_restrictions row of its own, a submitted PT application, a pt_deactivation_calls row, or rows in the fitness / ai audit
 *   tables the seed never writes (roadmaps, cycles, nutrition goals/programs, recommendation / coach / plan audits, agent
 *   actions). This is computed to a fixed point: keeping a user keeps all of its contracts and so the other party too.
 *   Why keep rather than anonymise/detach: anonymising rewrites identities that audit rows still point at and needs a
 *   cross-database change in auth + user; keeping changes nothing, loses nothing and is trivially reversible. For a database
 *   that is full of kept history the right fix is to recreate the disposable test database, not to scrub it.
 *   Chat: a conversation is deleted only when EVERY participant is a deletable fixture user; one with a real participant is kept.
 *
 * Apply order: fitness, ai, chat, user, auth (auth last: the account is the identity, so an interrupted run is re-run safely - the
 * same users are found again). Each database is one transaction. The contract delete re-checks the keep-rules in SQL and the
 * transaction is rolled back if the number of rows differs from the plan.
 *
 * Exit: 0 ran, 1 refused (guard / expectation), 2 error.
 */

import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const dotenv = require('dotenv');

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

// ── constants ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const FIXTURE_EMAIL_SQL_REGEX = '^test(user|pt)[0-9]{3}@example\\.com$';
const SEED_USER_AGENT = 'Mozilla/5.0 (Seed Script)';
const SERVICES = ['auth', 'user', 'fitness', 'ai', 'chat'];
const KNOWN_DEV_DBS = new Set(SERVICES.map((s) => `gymcoach_${s}`));
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DENY_NAME = /(prod|staging|live)/i;

class Refused extends Error {}

// ── args / guard (pure, no connection) ───────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { apply: false, dryRun: false, allowDevDb: false, suffix: '', maxUsers: 105 };
  for (const a of argv) {
    if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--allow-dev-db') opts.allowDevDb = true;
    else if (a.startsWith('--db-suffix=')) opts.suffix = a.slice('--db-suffix='.length);
    else if (a.startsWith('--max-users=')) opts.maxUsers = Number(a.slice('--max-users='.length));
    else throw new Refused(`unknown argument "${a}"`);
  }
  if (opts.apply && opts.dryRun) throw new Refused('--apply and --dry-run are mutually exclusive');
  if (!Number.isInteger(opts.maxUsers) || opts.maxUsers < 0) throw new Refused('--max-users must be a non-negative integer');
  if (!/^[A-Za-z0-9_]*$/.test(opts.suffix)) throw new Refused('--db-suffix may contain only letters, digits and underscore');
  return opts;
}

export function checkGuards({ env, opts }) {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') throw new Refused('NODE_ENV=production - this script never runs in production');
  const host = (env.POSTGRES_HOST || 'localhost').trim().toLowerCase();
  const extra = (env.CLEANUP_EXTRA_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!LOCAL_HOSTS.has(host) && !extra.includes(host)) {
    throw new Refused(`host "${host}" is not local (allowed: localhost, 127.0.0.1, ::1${extra.length ? `, ${extra.join(', ')}` : ''}; add a name to CLEANUP_EXTRA_HOSTS only if you are sure it is a disposable database)`);
  }
  const names = Object.fromEntries(SERVICES.map((s) => [s, `gymcoach_${s}${opts.suffix}`]));
  for (const [svc, name] of Object.entries(names)) {
    if (DENY_NAME.test(name)) throw new Refused(`database name "${name}" contains prod / staging / live`);
    if (name.endsWith('_test')) continue;
    if (KNOWN_DEV_DBS.has(name)) {
      if (!opts.allowDevDb) throw new Refused(`database "${name}" is a local DEV database - pass --allow-dev-db to touch it (dry-run included)`);
      continue;
    }
    throw new Refused(`database name "${name}" (${svc}) is not allowed: it must end with "_test" or be a known local dev database`);
  }
  return { host, names };
}

// ── small db helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function open(env, host, database, readOnly) {
  const c = new Client({
    host,
    port: parseInt(env.POSTGRES_PORT || '5433', 10),
    user: env.POSTGRES_USER || 'gymcoach',
    password: env.POSTGRES_PASSWORD || 'gymcoach_password',
    database,
    ssl: false,
  });
  await c.connect();
  const cur = (await c.query('SELECT current_database() AS d')).rows[0].d;
  if (cur !== database) {
    await c.end();
    throw new Refused(`connected to "${cur}" but expected "${database}"`);
  }
  await c.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
  return c;
}
const finish = async (c, commit) => {
  await c.query(commit ? 'COMMIT' : 'ROLLBACK');
  await c.end();
};
const hasTable = async (c, t) => (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public."${t}"`])).rows[0].ok;
const short = (id) => String(id).slice(0, 8);

async function usersWithRows(c, table, cols, ids) {
  if (!ids.length || !(await hasTable(c, table))) return new Set();
  const out = new Set();
  for (const col of cols) {
    const r = await c.query(`SELECT DISTINCT "${col}" AS id FROM "${table}" WHERE "${col}" = ANY($1)`, [ids]);
    for (const row of r.rows) out.add(row.id);
  }
  return out;
}

// ── planning (all reads) ───────────────────────────────────────────────────────────────────────────────────────────────────
async function plan(env, host, names) {
  const report = { unproven: [], kept: new Map(), keptContracts: [], notes: [] };
  const keep = (id, why) => {
    if (!report.kept.has(id)) report.kept.set(id, new Set());
    report.kept.get(id).add(why);
  };

  // 1. identify (auth)
  const auth = await open(env, host, names.auth, true);
  let fixtures;
  try {
    const r = await auth.query(
      `SELECT u.id, u.email, u.role::text AS role,
              EXISTS (SELECT 1 FROM audit_logs a WHERE a."userId" = u.id AND a.action = 'REGISTER' AND a."userAgent" = $2) AS seeded
         FROM users u WHERE u.email ~ $1 ORDER BY u.email`,
      [FIXTURE_EMAIL_SQL_REGEX, SEED_USER_AGENT],
    );
    fixtures = [];
    for (const u of r.rows) {
      const wantRole = u.email.startsWith('testpt') ? 'PT' : 'CUSTOMER';
      if (u.role !== wantRole) report.unproven.push({ id: u.id, email: u.email, why: `role is ${u.role}, expected ${wantRole}` });
      else if (!u.seeded) report.unproven.push({ id: u.id, email: u.email, why: 'no seed-script REGISTER audit log - not proven to be a seed fixture' });
      else fixtures.push(u);
    }
    const ids0 = fixtures.map((u) => u.id);
    for (const id of await usersWithRows(auth, 'pt_deactivation_calls', ['pt_user_id'], ids0)) keep(id, 'has pt_deactivation_calls (audit relay)');
  } finally {
    await finish(auth, false);
  }
  const fixtureIds = fixtures.map((u) => u.id);
  const emailOf = new Map(fixtures.map((u) => [u.id, u.email]));
  if (!fixtureIds.length) return { ...report, fixtures, fixtureIds, deletable: [], contracts: [], deleteIds: [], chat: { delete: [], kept: 0 }, emailOf };

  // 2. user database: user-level protection + contracts
  const usr = await open(env, host, names.user, true);
  let contracts = [];
  try {
    for (const id of await usersWithRows(usr, 'pt_restrictions', ['pt_user_id'], fixtureIds)) keep(id, 'has pt_restrictions history (audit)');
    if ((await hasTable(usr, 'pt_applications')) && (await hasTable(usr, 'user_profiles'))) {
      const r = await usr.query(
        `SELECT DISTINCT p."userId" AS id FROM pt_applications a JOIN user_profiles p ON p.id = a.user_profile_id WHERE p."userId" = ANY($1)`,
        [fixtureIds],
      );
      for (const row of r.rows) keep(row.id, 'has a PT application');
    }
    const restr = (await hasTable(usr, 'pt_restrictions')) ? 'EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.contract_id = c.id)' : 'false';
    const ext = (await hasTable(usr, 'pt_restriction_contract_extensions')) ? 'EXISTS (SELECT 1 FROM pt_restriction_contract_extensions e WHERE e.contract_id = c.id)' : 'false';
    const sett = (await hasTable(usr, 'session_settlements')) ? 'EXISTS (SELECT 1 FROM session_settlements s WHERE s.contract_id = c.id)' : 'false';
    contracts = (
      await usr.query(
        `SELECT c.id, c.pt_user_id AS pt, c.client_user_id AS client, c.status::text AS status, c.payment_transaction_id AS txn, c.gym_id,
                c.source::text AS source, c.released_to_pt AS r_pt, c.released_to_gym AS r_gym, c.released_to_platform AS r_plat,
                c.client_exit_restriction_id AS exit_restriction,
                ${restr} AS has_restriction, ${ext} AS has_extension, ${sett} AS has_settlement
           FROM contracts c WHERE c.pt_user_id = ANY($1) OR c.client_user_id = ANY($1)`,
        [fixtureIds],
      )
    ).rows;
  } finally {
    await finish(usr, false);
  }

  // 3. fitness / ai: rows the seed never writes
  const fit = await open(env, host, names.fitness, true);
  try {
    const t = [
      ['coach_client_action_audits', ['client_user_id', 'pt_user_id']],
      ['plan_generation_audits', ['client_user_id', 'pt_user_id']],
      ['recommendation_audits', ['user_id']],
      ['cycle_feedback_analysis_audits', ['user_id']],
      ['fitness_roadmaps', ['user_id']],
      ['training_cycles', ['user_id']],
      ['nutrition_goals', ['user_id']],
      ['nutrition_programs', ['user_id']],
    ];
    for (const [table, cols] of t) for (const id of await usersWithRows(fit, table, cols, fixtureIds)) keep(id, `has ${table} rows (not seed data)`);
  } finally {
    await finish(fit, false);
  }
  const ai = await open(env, host, names.ai, true);
  try {
    for (const id of await usersWithRows(ai, 'fitness_agent_actions', ['user_id'], fixtureIds)) keep(id, 'has fitness_agent_actions rows (audit)');
  } finally {
    await finish(ai, false);
  }

  // 4. fixed point over the contract graph
  const fixtureSet = new Set(fixtureIds);
  const contractReasons = new Map();
  for (const c of contracts) {
    const why = [];
    if (!fixtureSet.has(c.pt) || !fixtureSet.has(c.client)) why.push('other party is not a proven fixture user');
    if (c.txn) why.push('has a payment transaction');
    if (Number(c.r_pt) > 0 || Number(c.r_gym) > 0 || Number(c.r_plat) > 0) why.push('money was released');
    if (c.gym_id || (c.source && c.source !== 'INDEPENDENT')) why.push('belongs to a gym');
    if (c.has_restriction) why.push('has restriction history');
    if (c.has_extension) why.push('has restriction extension history');
    if (c.exit_restriction) why.push('references a restriction (client exit)');
    if (c.has_settlement) why.push('has session_settlements rows');
    contractReasons.set(c.id, why);
  }
  const keptByParty = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of contracts) {
      const parties = [c.pt, c.client].filter((x) => fixtureSet.has(x));
      const isKept = contractReasons.get(c.id).length > 0 || parties.some((x) => report.kept.has(x));
      if (!isKept) continue;
      if (!contractReasons.get(c.id).length) keptByParty.add(c.id);
      for (const x of parties) {
        if (!report.kept.has(x) || ![...report.kept.get(x)].some((w) => w.startsWith('party to kept contract'))) {
          if (!report.kept.has(x)) changed = true;
          keep(x, `party to kept contract ${short(c.id)}${contractReasons.get(c.id).length ? `: ${contractReasons.get(c.id).join(', ')}` : ' (its other party is kept)'}`);
        }
      }
    }
  }
  for (const id of keptByParty) contractReasons.get(id).push('a party is kept entirely');
  const deletable = fixtureIds.filter((id) => !report.kept.has(id));
  const delSet = new Set(deletable);
  const deleteIds = contracts.filter((c) => !contractReasons.get(c.id).length && delSet.has(c.pt) && delSet.has(c.client)).map((c) => c.id);
  report.keptContracts = contracts.filter((c) => contractReasons.get(c.id).length).map((c) => ({ id: c.id, status: c.status, why: contractReasons.get(c.id) }));
  // sanity: every contract touching a deletable user must be in deleteIds
  const stray = contracts.filter((c) => (delSet.has(c.pt) || delSet.has(c.client)) && !deleteIds.includes(c.id));
  if (stray.length) throw new Error(`internal: ${stray.length} contract(s) of deletable users are not in the delete set`);

  // 5. chat: only conversations made of deletable fixtures alone
  const chat = { delete: [], kept: 0 };
  if (deletable.length) {
    const cc = await open(env, host, names.chat, true);
    try {
      const r = await cc.query(
        `SELECT "conversationId" AS id, bool_and("userId" = ANY($1)) AS only_fixtures, bool_or("userId" = ANY($1)) AS any_fixture
           FROM conversation_participants GROUP BY "conversationId" HAVING bool_or("userId" = ANY($1))`,
        [deletable],
      );
      chat.delete = r.rows.filter((x) => x.only_fixtures).map((x) => x.id);
      chat.kept = r.rows.length - chat.delete.length;
    } finally {
      await finish(cc, false);
    }
  }
  return { ...report, fixtures, fixtureIds, deletable, deleteIds, chat, emailOf, contractsTotal: contracts.length };
}

// ── deletion statements (table-driven so dry-run counts and apply use the very same SQL) ─────────────────────────────────────
function statements(p) {
  const D = p.deletable;
  const user = [
    { label: 'contracts', sql: (head) => `${head} FROM contracts c WHERE c.id = ANY($1) AND c.payment_transaction_id IS NULL AND c.gym_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.contract_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM pt_restriction_contract_extensions e WHERE e.contract_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM session_settlements s WHERE s.contract_id = c.id)`, arg: p.deleteIds, strict: true, table: 'contracts' },
    { label: 'user_profiles', col: '"userId"', table: 'user_profiles', arg: D },
    { label: 'inbody_entries', col: 'user_id', table: 'inbody_entries', arg: D },
    { label: 'notifications', col: 'user_id', table: 'notifications', arg: D },
    { label: 'notification_preferences', col: 'user_id', table: 'notification_preferences', arg: D },
    { label: 'push_devices', col: 'user_id', table: 'push_devices', arg: D },
    { label: 'pt_availability', col: 'pt_user_id', table: 'pt_availability', arg: D },
    { label: 'pt_schedule_exceptions', col: 'pt_user_id', table: 'pt_schedule_exceptions', arg: D },
  ];
  const fitness = ['workouts', 'nutrition_logs', 'body_metrics', 'workout_schedules', 'workout_programs'].map((t) => ({ label: t, col: 'user_id', table: t, arg: D }));
  const ai = ['conversations', 'workout_plans'].map((t) => ({ label: t, col: 'user_id', table: t, arg: D }));
  const chat = [{ label: 'conversations', col: 'id', table: 'conversations', arg: p.chat.delete }];
  const auth = [{ label: 'users', col: 'id', table: 'users', arg: D }];
  return { fitness, ai, chat, user, auth };
}

async function runGroup(env, host, dbName, list, apply, out) {
  const c = await open(env, host, dbName, !apply);
  let ok = false;
  try {
    for (const s of list) {
      if (!s.arg.length || !(await hasTable(c, s.table))) {
        out.push([dbName, s.label, 0]);
        continue;
      }
      const where = s.sql ? s.sql('SELECT count(*)::int AS n') : `SELECT count(*)::int AS n FROM "${s.table}" WHERE ${s.col} = ANY($1)`;
      const n = (await c.query(where, [s.arg])).rows[0].n;
      if (apply && n > 0) {
        const del = s.sql ? s.sql('DELETE') : `DELETE FROM "${s.table}" WHERE ${s.col} = ANY($1)`;
        const res = await c.query(del, [s.arg]);
        if (s.strict && res.rowCount !== s.arg.length) throw new Error(`${dbName}.${s.label}: deleted ${res.rowCount} rows, planned ${s.arg.length} - rolled back`);
        out.push([dbName, s.label, res.rowCount]);
      } else {
        out.push([dbName, s.label, n]);
      }
    }
    ok = true;
  } finally {
    await finish(c, apply && ok);
  }
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { host, names } = checkGuards({ env: process.env, opts });
  console.log(`cleanup-test-users - ${opts.apply ? 'APPLY' : 'DRY RUN (nothing is written)'} - host ${host}:${process.env.POSTGRES_PORT || '5433'} - databases ${Object.values(names).join(', ')}`);

  const p = await plan(process.env, host, names);
  console.log(`\nfixture accounts proven (email pattern + role + seed signature): ${p.fixtures.length}`);
  if (p.unproven.length) {
    console.log(`UNPROVEN accounts (match the e-mail pattern but are NOT proven seed fixtures) - left alone: ${p.unproven.length}`);
    for (const u of p.unproven) console.log(`  ${u.email} (${short(u.id)}): ${u.why}`);
  }
  console.log(`fixture accounts KEPT entirely (history that must not be deleted): ${[...p.kept.keys()].length}`);
  for (const [id, why] of p.kept) console.log(`  ${p.emailOf.get(id)} (${short(id)}): ${[...why].join('; ')}`);
  console.log(`contracts KEPT: ${p.keptContracts.length}`);
  for (const c of p.keptContracts) console.log(`  contract ${short(c.id)} [${c.status}]: ${c.why.join(', ')}`);
  console.log(`fixture accounts that WILL be removed: ${p.deletable.length}; contracts that will be removed: ${p.deleteIds.length}; chat conversations: ${p.chat.delete.length} (${p.chat.kept} kept: has a non-fixture participant)`);

  if (p.deletable.length === 0) {
    console.log('\nNothing to clean up.');
    return;
  }
  if (opts.apply && p.deletable.length > opts.maxUsers) throw new Refused(`${p.deletable.length} fixture users would be removed, more than --max-users=${opts.maxUsers}`);

  const st = statements(p);
  const out = [];
  const order = [['fitness', names.fitness], ['ai', names.ai], ['chat', names.chat], ['user', names.user], ['auth', names.auth]];
  for (const [key, db] of order) await runGroup(process.env, host, db, st[key], opts.apply, out);
  console.log(`\n${opts.apply ? 'deleted' : 'would delete'}:`);
  for (const [db, label, n] of out) if (n > 0 || label === 'contracts') console.log(`  ${db}.${label}: ${n}`);
  console.log(opts.apply ? '\nCleanup complete. pt_restrictions, pt_restriction_contract_extensions and session_settlements were not touched.' : '\nDry run only. Re-run with --apply to execute.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    if (err instanceof Refused) {
      console.error(`REFUSED: ${err.message}`);
      process.exit(1);
    }
    console.error(`Cleanup failed: ${err.message}`);
    process.exit(2);
  });
}
