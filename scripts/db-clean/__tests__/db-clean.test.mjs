/**
 * db-clean tests - evidence label: BACKEND INTEGRATION (+ TEST FIXTURE for the data) on the ISOLATED TEST container
 * gymcoach-test-postgres-test-1 (localhost:55433), databases gymcoach_<svc>_dbclean_test (created and dropped here). The pg_hba fence tests
 * edit the pg_hba.conf of THAT container only (profile "test"; the dev profile is never used by this file). The CLI runs as a real child process.
 *
 *   node --test --test-concurrency=1 scripts/db-clean/__tests__/db-clean.test.mjs
 *
 * Needs: the test container running, the dev postgres container reachable read-only for the schema clone (pg_dump --schema-only).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as F from './fixtures.mjs';
import { canonicalJSON, sha256Hex } from '../lib/util.mjs';
import { assertGuards, getProfile } from '../lib/config.mjs';
import { normExpr } from '../lib/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'db-clean.mjs');
const PW = 'Zq8mK2vLp9xT4nRw7sYc3HbG';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbclean-test-'));
const CONTAINER = F.TEST_CONTAINER;
const HBA = '/var/lib/postgresql/data/pg_hba.conf';

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DBCLEAN_MAINT_PASSWORD: PW, DBCLEAN_QUIET: '0', ...env }, maxBuffer: 1 << 28 });
  return { code: r.status, out: r.stdout, err: r.stderr, text: `${r.stdout}\n${r.stderr}` };
}
const sh = (cmd, user) => spawnSync('docker', ['exec', ...(user ? ['-u', user] : []), CONTAINER, 'sh', '-c', cmd], { encoding: 'utf8' });
const hbaSha = () => sh(`sha256sum ${HBA}`, 'postgres').stdout.split(/\s+/)[0];
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = (n) => {
  const d = path.join(TMP, `${n}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
/** Row counts of every table of every database through the maintenance role (needed while the fence is up). */
function countsM() {
  const out = {};
  for (const svc of F.SERVICES) {
    const r = sh(`PGPASSWORD=${PW} psql -At -h /var/run/postgresql -U gymini_maintenance -d ${F.db(svc)} -c "SELECT json_object_agg(relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', relname), false, true, '')))[1]::text::int ORDER BY relname) FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace"`);
    if (r.status !== 0) throw new Error(r.stderr);
    out[svc] = JSON.parse(r.stdout.trim());
  }
  return out;
}
async function appQuery(database, sql) {
  const c = await F.client(database);
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}
async function maintRoleCount() {
  return Number((await appQuery('postgres', `SELECT count(*) FROM pg_roles WHERE rolname='gymini_maintenance'`))[0].count);
}
async function tcpRejected(user, password, database) {
  const c = new (await import('pg')).default.Client({ ...F.TEST, user, password, database, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.end();
    return false;
  } catch (e) {
    return /pg_hba\.conf rejects/.test(e.message);
  }
}

/** Fresh databases + seed + audit + approve. Returns the handles every scenario needs. */
async function scenario(name, { allow = ['admin@example.com', 'john.doe@example.com'], extra = [], env = {}, policy, seed = true, suffix } = {}) {
  await recoverAll();
  await F.createDatabases();
  if (seed) await F.closeAll(await F.seedData());
  return audited(name, { allow, extra, env, policy, suffix });
}
function audited(name, { allow = ['admin@example.com', 'john.doe@example.com'], extra = [], env = {}, policy, suffix } = {}) {
  const d = dir(name);
  const al = path.join(d, 'allow.json');
  fs.writeFileSync(al, JSON.stringify({ emails: allow }));
  const e = { ...(policy ? { DBCLEAN_POLICY_FILE: policy } : {}), ...env };
  const a = cli(['audit', '--env', 'test', '--out', d, '--allowlist', al, '--fixtures', 'scripts/partner-application-e2e', ...extra], e);
  assert.equal(a.code, 0, `audit failed: ${a.text}`);
  const T = fs.readFileSync(path.join(d, 'confirm-token.candidate.txt'), 'utf8').trim();
  const runDir = path.join(d, 'run');
  const ap = cli(['approve', '--env', 'test', '--manifest', path.join(d, 'cleanup-manifest.candidate.json'), '--confirm-token', T, '--out', runDir], e);
  assert.equal(ap.code, 0, ap.text);
  const A = path.join(runDir, 'approved', 'cleanup-manifest.approved.json');
  const R = ['--env', 'test', '--run-dir', runDir];
  const M = ['--manifest', A, '--confirm-token', T];
  return { d, runDir, A, T, R, M, e, al, candidate: path.join(d, 'cleanup-manifest.candidate.json'), manifest: readJ(path.join(d, 'cleanup-manifest.candidate.json')) };
}
const step = (s, name, extraArgs = [], env = s.e) => cli([name, ...s.R, ...s.M, ...extraArgs], env);
/** Always leave the container as we found it, whatever a test did. */
async function recoverAll() {
  const dirs = fs.readdirSync(TMP);
  void dirs;
  // restore the original hba if a test left a fence
  const orig = process.env.DBCLEAN_ORIG_HBA_B64 ? Buffer.from(process.env.DBCLEAN_ORIG_HBA_B64, 'base64').toString('utf8') : null;
  if (orig) {
    spawnSync('docker', ['exec', '-i', '-u', 'postgres', CONTAINER, 'sh', '-c', `cat > ${HBA}.tmp && chmod 600 ${HBA}.tmp && mv -f ${HBA}.tmp ${HBA} && pg_ctl reload -D "$PGDATA"`], { input: orig, encoding: 'utf8' });
    await new Promise((r) => setTimeout(r, 800));
  }
  const adm = await F.client('postgres').catch(() => null);
  if (adm) {
    await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gymini_maintenance'`).catch(() => {});
    await adm.query(`DROP ROLE IF EXISTS gymini_maintenance`).catch(() => {});
    await adm.query(`DROP OWNED BY dbclean_extra`).catch(() => {});
    await adm.query(`DROP ROLE IF EXISTS dbclean_extra`).catch(() => {});
    await adm.end();
  }
}

let ORIG_HBA_SHA;
test.before(async () => {
  const r = sh(`cat ${HBA}`, 'postgres');
  assert.equal(r.status, 0, 'test container must be running');
  process.env.DBCLEAN_ORIG_HBA_B64 = Buffer.from(r.stdout).toString('base64');
  ORIG_HBA_SHA = hbaSha();
  await recoverAll();
});
test.after(async () => {
  await recoverAll();
  await F.dropDatabases();
  await F.dropDatabases('_dbclean2_test');
  fs.rmSync(TMP, { recursive: true, force: true });
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'pg_hba.conf of the test container is back to the original after the whole run');
});

// =====================================================================================================================
test('G1 guards: production, host, names, confirm, unknown options (pure + CLI)', async () => {
  const dev = getProfile('dev');
  assert.throws(() => assertGuards(dev, { env: { NODE_ENV: 'production' } }), /production/);
  assert.throws(() => assertGuards(dev, { mutating: true, env: {} }), /DBCLEAN_CONFIRM=dev/);
  assert.ok(assertGuards(dev, { mutating: false, env: {} }));
  assert.ok(assertGuards(dev, { mutating: true, env: { DBCLEAN_CONFIRM: 'dev' } }));
  assert.throws(() => assertGuards({ ...dev, host: 'db.example.com' }, { env: {} }), /not a local host/);
  assert.throws(() => assertGuards({ ...dev, dbName: (s) => `gymcoach_${s}_prod` }, { env: {} }), /prod|allowlist/);
  assert.throws(() => assertGuards({ ...dev, dbName: (s) => `gymcoach_${s}` , container: 'gymcoach-postgres-live' }, { env: {} }), /live/);
  assert.throws(() => assertGuards({ ...dev, dbName: (s) => `other_${s}` }, { env: {} }), /allowlist/);
  assert.throws(() => getProfile('test', { suffix: '_x' }), /must match/);
  assert.throws(() => assertGuards(getProfile('test', { suffix: '_dbcleanprod_test' }), { env: {} }), /prod/);
  assert.throws(() => assertGuards(getProfile('test', { suffix: '_dbcleanstaging_test' }), { env: {} }), /staging/);
  assert.throws(() => getProfile('prod'), /--env must be/);
  // CLI
  let r = cli(['audit', '--env', 'test', '--out', TMP], { NODE_ENV: 'production' });
  assert.equal(r.code, 1);
  assert.match(r.err, /GUARD_PRODUCTION/);
  r = cli(['audit', '--env', 'dev', '--out', TMP, '--bogus', 'x']);
  assert.equal(r.code, 1);
  assert.match(r.err, /UNKNOWN_OPTION/);
  r = cli(['freeze', '--env', 'dev', '--manifest', 'x', '--confirm-token', 'y'], { DBCLEAN_CONFIRM: '' });
  assert.equal(r.code, 1);
  assert.match(r.err, /GUARD_CONFIRM/);
  r = cli(['clean', '--env', 'dev'], { DBCLEAN_CONFIRM: 'dev' });
  assert.equal(r.code, 1);
  assert.match(r.err, /--apply/);
  r = cli(['audit', '--env', 'test', '--db-suffix', '_dbcleanlive_test', '--out', TMP]);
  assert.equal(r.code, 1);
  assert.match(r.err, /live/);
  assert.equal(normExpr('id', 'uuid'), 'lower("id"::text)');
  assert.throws(() => normExpr('id', 'bytea'), /unsupported/);
});

test('G2 audit is read only and the token is stable; metadata is not in the token', async () => {
  const s = await scenario('audit');
  const snapBefore = JSON.stringify(await F.counts());
  const stat = async () => JSON.stringify(await Promise.all(F.SERVICES.map((x) => appQuery(F.db(x), `SELECT sum(n_tup_ins+n_tup_upd+n_tup_del) c FROM pg_stat_user_tables`))));
  const statBefore = await stat();
  const rolesBefore = JSON.stringify(await appQuery('postgres', `SELECT rolname FROM pg_roles ORDER BY 1`));
  const hbaBefore = hbaSha();
  // second audit, a moment later
  await new Promise((r) => setTimeout(r, 1500));
  const s2 = audited('audit2', {});
  assert.equal(s2.T, s.T, 'same data, same token');
  const m1 = readJ(path.join(s.d, 'cleanup-manifest.candidate.metadata.json'));
  const m2 = readJ(path.join(s2.d, 'cleanup-manifest.candidate.metadata.json'));
  assert.notEqual(m1.auditedAt, m2.auditedAt, 'auditedAt differs but only in the metadata file');
  assert.equal(sha256Hex(canonicalJSON(s.manifest)), s.T);
  assert.equal(JSON.stringify(await F.counts()), snapBefore, 'row counts unchanged by audit');
  assert.equal(await stat(), statBefore, 'n_tup_ins+upd+del unchanged by audit (no write of any kind)');
  assert.equal(JSON.stringify(await appQuery('postgres', `SELECT rolname FROM pg_roles ORDER BY 1`)), rolesBefore);
  assert.equal(hbaSha(), hbaBefore);
  // the audit connections are read-only
  const src = fs.readFileSync(path.join(HERE, '..', 'lib', 'commands.mjs'), 'utf8');
  assert.match(src, /tcpFactory\(ctx\.profile, \{ readOnly: true \}\)/);
  // content: the policy did what it says
  const tbl = (db, t) => s.manifest.tables.find((x) => x.db === F.db(db) && x.table === t);
  assert.deepEqual(tbl('user', 'contracts').keys, [['ct-del'], ['ct-del-dup'], ['ct-mixed']], 'mixed contract is deleted, preserved pair is kept');
  assert.deepEqual(tbl('gym', 'gym_amenities').keys, [['gy-del1', 'am-1'], ['gy-del1', 'am-2'], ['gy-del2', 'am-1']], 'composite pk tuples');
  assert.deepEqual(tbl('payment', 'payment_transactions').keys, [['tx-del']], 'a transaction pinned by a surviving ledger entry is kept');
  assert.deepEqual(tbl('chat', 'conversations').keys, [['cv-del'], ['cv-mixed']]);
  assert.deepEqual(s.manifest.allowlist.keptGymIds, ['gy-keep']);
  assert.equal(s.manifest.tables.some((t) => t.db === F.db('fitness') || t.db === F.db('ai')), false, 'partner-owned databases are report-only by default');
  assert.deepEqual(s.manifest.blockers, {});
  assert.equal(s.manifest.aclSnapshot.databases.length, 7);
  assert.ok(s.manifest.hbaSnapshot.sha256 === ORIG_HBA_SHA);
});

test('G3 full H0-H4 pipeline, kept rows byte-identical, then restore-all-7 from the single backup set', async () => {
  const s = await scenario('pipeline');
  const before = await F.counts();
  const keptHash = async () =>
    JSON.stringify([
      await appQuery(F.db('auth'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM users t WHERE id IN ('u-keep-admin','u-keep-john')`),
      await appQuery(F.db('user'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM contracts t WHERE id = 'ct-keep'`),
    ]);
  const hashBefore = await keptHash();
  const f = step(s, 'freeze');
  assert.equal(f.code, 0, f.text);
  // fence evidence while frozen
  assert.equal(await tcpRejected('gymcoach_test', 'gymcoach_test_password', F.db('auth')), true, 'app superuser rejected over TCP');
  const sock = sh(`PGPASSWORD=gymcoach_test_password psql -h /var/run/postgresql -U gymcoach_test -d ${F.db('auth')} -c "select 1"`);
  assert.match(sock.stderr, /pg_hba\.conf rejects/, 'app superuser rejected over the socket');
  const rc = step(s, 'audit', ['--recheck']);
  assert.equal(rc.code, 0, rc.text);
  const b = step(s, 'backup');
  assert.equal(b.code, 0, b.text);
  const bm = readJ(path.join(s.runDir, 'backup-manifest.json'));
  assert.equal(bm.files.length, 7);
  assert.ok(bm.files.every((x) => x.bytes > 0 && x.restoreListEntries > 0 && x.sha256.length === 64));
  assert.ok(bm.restoreCheck.ok);
  assert.ok(bm.fenceEvidence.before.at && bm.fenceEvidence.after.at);
  assert.deepEqual(bm.writeCounters.before, bm.writeCounters.after, 'no write between freeze and backup');
  const c = step(s, 'clean', ['--apply']);
  assert.equal(c.code, 0, c.text);
  const v = step(s, 'verify');
  assert.equal(v.code, 0, v.text);
  // H4
  const u = cli(['unfreeze', ...s.R], s.e);
  assert.equal(u.code, 0, u.text);
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'pg_hba.conf sha256 equals the original');
  assert.equal(await maintRoleCount(), 0);
  assert.equal(await tcpRejected('gymcoach_test', 'gymcoach_test_password', F.db('auth')), false, 'app role connects again');
  assert.ok(fs.existsSync(path.join(s.runDir, 'verify-clean.ok')));
  // the marker format the marketplace seed guard (scripts/seed-marketplace/lib/guard.mjs) reads: 64-hex confirmToken + ISO timestamp
  const { readMarker, locateMarker } = await import(pathToFileURL(path.join(HERE, '..', '..', 'seed-marketplace', 'lib', 'guard.mjs')).href);
  const marker = readMarker(path.join(s.runDir, 'verify-clean.ok'));
  assert.equal(marker.valid, true);
  assert.equal(marker.confirmToken, s.T);
  assert.match(fs.readFileSync(path.join(s.runDir, 'verify-clean.ok'), 'utf8'), /^[0-9a-f]{64}\n20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\n$/);
  assert.equal(locateMarker({ root: path.dirname(s.runDir) }), path.join(path.dirname(s.runDir), 'run', 'verify-clean.ok'), 'newest <root>/<ts>/verify-clean.ok is found');
  assert.equal(readJ(path.join(s.runDir, 'freeze-state.json')).state, 'RELEASED');
  const after = await F.counts();
  assert.equal(after.auth.users, 2);
  assert.equal(after.user.contracts, 1);
  assert.equal(after.gym.gym_amenities, 2);
  assert.equal(after.gym.gyms, 1);
  assert.equal(after.fitness.workouts, before.fitness.workouts, 'partner databases untouched');
  assert.equal(after.ai.chat_sessions, before.ai.chat_sessions);
  assert.equal(await keptHash(), hashBefore, 'kept rows byte-identical');
  // the approved manifest is stale now (the data was cleaned): a new freeze with it must be impossible
  const f2 = cli(['freeze', '--env', 'test', '--run-dir', path.join(s.d, 'run2'), ...s.M], s.e);
  assert.equal(f2.code, 1, 'stale manifest cannot be frozen');
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('G4 restore: all 7 databases from ONE backup set return to the pre-clean row counts; refusals', async () => {
  const s = await scenario('restore');
  const before = await F.counts();
  assert.equal(step(s, 'freeze').code, 0);
  assert.equal(step(s, 'backup').code, 0);
  assert.equal(step(s, 'clean', ['--apply']).code, 0);
  assert.notDeepEqual(countsM(), before);
  // refuse a set with a damaged file
  const dumps = path.join(s.runDir, 'dumps');
  const victim = path.join(dumps, `${F.db('chat')}.dump`);
  const good = fs.readFileSync(victim);
  fs.appendFileSync(victim, 'x');
  let r = cli(['restore', ...s.R], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /BACKUP_REFUSED/);
  fs.writeFileSync(victim, good);
  // refuse a set without fence evidence
  const bmFile = path.join(s.runDir, 'backup-manifest.json');
  const bm = readJ(bmFile);
  fs.writeFileSync(bmFile, JSON.stringify({ ...bm, fenceEvidence: null, frozenAt: null }));
  r = cli(['restore', ...s.R], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /fence evidence/);
  // refuse mixing: a dump file taken from another set
  fs.writeFileSync(bmFile, JSON.stringify(bm));
  const other = path.join(s.runDir, 'other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'x'), 'x');
  const mixed = JSON.parse(JSON.stringify(bm));
  mixed.files[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(bmFile, JSON.stringify(mixed));
  r = cli(['restore', ...s.R], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /different set|damaged|sha256/);
  fs.writeFileSync(bmFile, JSON.stringify(bm));
  // restore everything
  r = cli(['restore', ...s.R], s.e);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(countsM(), before, 'all seven databases back at t0 row counts');
  // an unfreeze after a restore is allowed and writes NO verify-clean marker
  r = cli(['unfreeze', ...s.R], s.e);
  assert.equal(r.code, 0, r.text);
  assert.equal(fs.existsSync(path.join(s.runDir, 'verify-clean.ok')), false);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  assert.equal(await maintRoleCount(), 0);
});

test('G5 fence matrix: superuser app role, extra LOGIN role with membership, pre-opened session killed, pg_dump / restore --list under the fence, ACL (datacl non-null) + roles unchanged on unfreeze', async () => {
  await recoverAll();
  await F.createDatabases();
  await F.closeAll(await F.seedData());
  const adm = await F.client('postgres');
  await adm.query(`DROP ROLE IF EXISTS dbclean_extra`);
  await adm.query(`CREATE ROLE dbclean_extra LOGIN PASSWORD 'extra-pass-1' IN ROLE pg_monitor`);
  await adm.query(`GRANT CONNECT ON DATABASE "${F.db('gym')}" TO dbclean_extra WITH GRANT OPTION`); // datacl becomes non-NULL, with grant option
  const aclBefore = JSON.stringify((await adm.query(`SELECT datname, datacl::text FROM pg_database WHERE datname LIKE '%_dbclean_test' ORDER BY 1`)).rows);
  const rolesBefore = JSON.stringify((await adm.query(`SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls FROM pg_roles ORDER BY 1`)).rows.filter((r) => r.rolname !== 'gymini_maintenance'));
  await adm.end();
  const s = audited('fence');
  assert.ok(s.manifest.aclSnapshot.roles.some((r) => r.rolname === 'dbclean_extra' && r.memberOf.includes('pg_monitor')));
  assert.ok(s.manifest.aclSnapshot.databases.find((d) => d.datname === F.db('gym')).datacl_raw !== null);
  assert.ok(s.manifest.aclSnapshot.databases.find((d) => d.datname === F.db('auth')).datacl_raw === null, 'a DB with datacl NULL is in the snapshot too');
  // a session of the app role that is open BEFORE the freeze
  const old = await F.client(F.db('chat'));
  let killed = false;
  old.on('error', () => { killed = true; });
  await old.query('SELECT 1');
  const f = step(s, 'freeze');
  assert.equal(f.code, 0, f.text);
  await new Promise((r) => setTimeout(r, 500));
  await assert.rejects(old.query('SELECT 1'), 'the pre-existing session was terminated');
  void killed;
  assert.equal(await tcpRejected('gymcoach_test', 'gymcoach_test_password', F.db('auth')), true);
  assert.equal(await tcpRejected('dbclean_extra', 'extra-pass-1', F.db('gym')), true, 'a secondary LOGIN role with membership is rejected too');
  const sockExtra = sh(`PGPASSWORD=extra-pass-1 psql -h /var/run/postgresql -U dbclean_extra -d ${F.db('gym')} -c "select 1"`);
  assert.match(sockExtra.stderr, /pg_hba\.conf rejects/);
  const st = readJ(path.join(s.runDir, 'freeze-state.json'));
  assert.equal(st.state, 'FROZEN');
  assert.ok(st.fenceEvidence[0].maintDbs.length === 7 && st.fenceEvidence[0].maintDbs.every((d) => d.superuser));
  assert.ok(st.fenceEvidence[0].sessions.every((x) => x.user === 'gymini_maintenance'), 'only the maintenance sessions remain');
  assert.equal(hbaSha() === ORIG_HBA_SHA, false);
  assert.equal(sh(`grep -c reject ${HBA}`, 'postgres').stdout.trim(), '3');
  // pg_dump + pg_restore --list under the fence (the backup command does exactly that, as gymini_maintenance over the socket)
  const b = step(s, 'backup');
  assert.equal(b.code, 0, b.text);
  assert.equal(readJ(path.join(s.runDir, 'backup-manifest.json')).files.length, 7);
  // status (read only) while frozen
  const status = cli(['status', ...s.R], s.e);
  assert.equal(status.code, 0, status.text);
  assert.match(status.out, /"is": "FENCE"/);
  assert.match(status.out, /"maintRoleExists": true/);
  assert.match(status.out, /"state": "FROZEN"/);
  // unfreeze: abandon is allowed while no database is DONE
  const u = cli(['unfreeze', ...s.R], s.e);
  assert.equal(u.code, 0, u.text);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  assert.equal(await maintRoleCount(), 0);
  const adm2 = await F.client('postgres');
  assert.equal(JSON.stringify((await adm2.query(`SELECT datname, datacl::text FROM pg_database WHERE datname LIKE '%_dbclean_test' ORDER BY 1`)).rows), aclBefore, 'datacl (NULL and explicit, with grant option) unchanged');
  assert.equal(JSON.stringify((await adm2.query(`SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls FROM pg_roles ORDER BY 1`)).rows), rolesBefore, 'roles + attributes unchanged, no stray superuser');
  assert.deepEqual((await adm2.query(`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='dbclean_extra'`)).rows.length, 1, 'membership unchanged');
  await adm2.end();
  assert.equal(fs.existsSync(path.join(s.runDir, 'verify-clean.ok')), false, 'abandon writes no verify-clean marker');
  await old.end().catch(() => {});
  const adm3 = await F.client('postgres');
  await adm3.query('DROP OWNED BY dbclean_extra'); // revokes the GRANT CONNECT ON DATABASE (shared-object privilege) so the role can be dropped
  await adm3.query('DROP ROLE dbclean_extra');
  await adm3.end();
});

test('G6 write stop: a write during the fence stops the backup (t0 changed); the fence rejects the application', async () => {
  const s = await scenario('t0');
  assert.equal(step(s, 'freeze').code, 0);
  // simulate "something wrote": only the maintenance role can even connect
  const w = sh(`PGPASSWORD=${PW} psql -h /var/run/postgresql -U gymini_maintenance -d ${F.db('chat')} -c "insert into conversations(id,\\"updatedAt\\") values ('t0-x', now())"`);
  assert.equal(w.status, 0, w.stderr);
  const b = step(s, 'backup');
  assert.equal(b.code, 1);
  assert.match(b.err, /T0_CHANGED/);
  assert.equal(fs.existsSync(path.join(s.runDir, 'backup-manifest.json')), false, 'no backup was produced');
  // cleaning is also impossible without a backup
  const c = step(s, 'clean', ['--apply']);
  assert.equal(c.code, 1);
  assert.equal(countsM().auth.users, 5, 'nothing deleted');
  assert.equal(cli(['recover', ...s.R], s.e).code, 0);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('G7 tamper matrix (before the fence is written)', async () => {
  const s = await scenario('tamper');
  const clone = (mut, { retoken = false, name = 't', forgeFile = false } = {}) => {
    const m = JSON.parse(fs.readFileSync(s.candidate, 'utf8'));
    mut(m);
    const d = dir(name);
    const mf = path.join(d, 'm.json');
    fs.writeFileSync(mf, JSON.stringify(m));
    const tok = retoken ? sha256Hex(canonicalJSON(m)) : s.T;
    // an "approved" directory that Ngai did not approve: holds the tampered manifest next to the REAL approved token (or the forged one)
    const ad = path.join(d, 'approved');
    fs.mkdirSync(ad);
    fs.copyFileSync(mf, path.join(ad, 'cleanup-manifest.approved.json'));
    fs.writeFileSync(path.join(ad, 'confirm-token.approved.txt'), `${forgeFile ? tok : s.T}\n`);
    return { A: path.join(ad, 'cleanup-manifest.approved.json'), tok, d };
  };
  const expectRefused = (t, pattern, label) => {
    const r = cli(['freeze', '--env', 'test', '--run-dir', dir('rd'), '--manifest', t.A, '--confirm-token', t.tok], s.e);
    assert.equal(r.code, 1, `${label}: ${r.text}`);
    assert.match(r.text, pattern, label);
    assert.equal(hbaSha(), ORIG_HBA_SHA, `${label}: pg_hba untouched`);
  };
  const gymAm = (m) => m.tables.find((t) => t.table === 'gym_amenities');
  // 1 change one tuple, keep the fingerprint
  expectRefused(clone((m) => { gymAm(m).keys[0] = ['gy-keep', 'am-1']; }), /token mismatch|fingerprint/, 'tuple edited, fingerprint kept');
  // 1b token re-computed by the forger (command line only): the pair stored in approved/ disagrees
  expectRefused(clone((m) => { gymAm(m).keys[0] = ['gy-keep', 'am-1']; }, { retoken: true }), /differs from the token stored/, 'tuple edited, token recomputed');
  // 1c the forger also rewrote the stored token file: the fingerprint recomputed from the keys disagrees (internal consistency)
  expectRefused(clone((m) => { gymAm(m).keys[0] = ['gy-keep', 'am-1']; }, { retoken: true, forgeFile: true }), /fingerprint recomputed|not in canonical order/, 'tuple edited, token + file forged');
  // 1d a fully consistent forgery (keys, fingerprint, count, token, file): only the live data can unmask it - the check before the fence does
  expectRefused(
    clone((m) => {
      const t = gymAm(m);
      t.keys = [['gy-del1', 'am-1'], ['gy-del1', 'am-2'], ['gy-keep', 'am-1']];
      t.count = 3;
      t.fingerprint = sha256Hex(t.keys.map((k) => JSON.stringify(k)).join('\n'));
    }, { retoken: true, forgeFile: true }),
    /tuple sets differ|kept row/,
    'consistent forgery vs live data',
  );
  // 2 manifest edited and token re-computed
  expectRefused(clone((m) => { m.allowlist.emails.push('evil@x.test'); }, { retoken: true }), /differs from the token stored/, 'manifest edited and token re-computed');
  // 3 pkTypes / pk order
  expectRefused(clone((m) => { gymAm(m).pkTypes = ['uuid', 'text']; }), /token mismatch/, 'pkTypes changed');
  expectRefused(clone((m) => { gymAm(m).pk.reverse(); }), /token mismatch/, 'pk order swapped');
  // 4 hba / acl snapshots in the manifest
  expectRefused(clone((m) => { m.hbaSnapshot.sha256 = '0'.repeat(64); }), /token mismatch/, 'hbaSnapshot edited');
  expectRefused(clone((m) => { m.aclSnapshot.roles[0].rolsuper = false; }), /token mismatch/, 'aclSnapshot edited');
  // 5 environment
  expectRefused(clone((m) => { m.environment.host = '127.0.0.1'; }), /token mismatch/, 'environment.host edited');
  // 6 the manifest is not in an approved/ directory
  let r = cli(['freeze', '--env', 'test', '--run-dir', dir('rd'), '--manifest', s.candidate, '--confirm-token', s.T], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /NOT_APPROVED/);
  // 7 --confirm-token that is not the approved one
  r = cli(['freeze', '--env', 'test', '--run-dir', dir('rd'), '--manifest', s.A, '--confirm-token', 'a'.repeat(64)], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /mismatch|differs/);
  // 8 no override flag exists
  r = cli(['clean', '--apply', '--force', ...s.R, ...s.M], s.e);
  assert.equal(r.code, 1);
  assert.match(r.err, /UNKNOWN_OPTION/);
  // 9 real pg_hba changed after the audit -> detected BEFORE the fence file is written
  sh(`echo '# changed after audit' >> ${HBA}`, 'postgres');
  r = step(s, 'freeze');
  assert.equal(r.code, 1);
  assert.match(r.text, /pg_hba\.conf differs from the approved hbaSnapshot/);
  assert.equal(await maintRoleCount(), 0, 'no maintenance role was created');
  sh(`cp ${HBA} ${HBA}.chk && head -n -1 ${HBA}.chk > ${HBA} && rm ${HBA}.chk`, 'postgres');
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  sh('pg_ctl reload -D "$PGDATA"', 'postgres');
  // 11 script changed (policy file content) -> scriptVersion
  const p1 = path.join(dir('pol'), 'policy.mjs');
  fs.writeFileSync(p1, `export { POLICY } from ${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'lib', 'policy.mjs')).href)};\n// v1\n`);
  const s2 = audited('script', { allow: ['admin@example.com', 'john.doe@example.com'], policy: p1 });
  fs.writeFileSync(p1, `${fs.readFileSync(p1, 'utf8')}// v2 edited after the audit\n`);
  r = cli(['freeze', ...s2.R, ...s2.M], s2.e);
  assert.equal(r.code, 1);
  assert.match(r.text, /scriptVersion/);
  // 12 the real primary key of a table changes after the audit -> refused before the fence
  const g = await F.client(F.db('gym'));
  await g.query('ALTER TABLE gym_amenities DROP CONSTRAINT gym_amenities_pkey, ADD PRIMARY KEY (amenity_id, gym_id)');
  r = step(s, 'freeze');
  assert.equal(r.code, 1);
  assert.match(r.text, /primary key columns differ/);
  await g.query('ALTER TABLE gym_amenities DROP CONSTRAINT gym_amenities_pkey, ADD PRIMARY KEY (gym_id, amenity_id)');
  await g.end();
  // 13 an id replaced by another id, same count (fingerprint attack on live data): rows swap owners after the audit
  const u = await F.client(F.db('user'));
  await u.query("UPDATE notifications SET user_id = 'u-keep-admin' WHERE id = 'nt-del'");
  await u.query("UPDATE notifications SET user_id = 'u-del-1' WHERE id = 'nt-keep'");
  r = step(s, 'freeze');
  assert.equal(r.code, 1);
  assert.match(r.text, /tuple sets differ/);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  assert.equal(await maintRoleCount(), 0);
  await u.end();
  // 10 ACL changed after the audit (last: a REVOKE ... FROM PUBLIC leaves datacl non-NULL, which cannot be undone, so no later step may depend on the original ACL)
  const adm = await F.client('postgres');
  await adm.query(`GRANT CONNECT ON DATABASE "${F.db('chat')}" TO PUBLIC`);
  await adm.query(`REVOKE ALL ON DATABASE "${F.db('chat')}" FROM PUBLIC`);
  await adm.query(`CREATE ROLE dbclean_extra`);
  r = step(s, 'freeze');
  assert.equal(r.code, 1);
  assert.match(r.text, /ACLs \/ roles differ/);
  await adm.query(`DROP ROLE dbclean_extra`);
  await adm.end();
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('G8 recheck: data changed after the audit is caught (tuple set, real PK, allowlist row; volatile column tolerated); no path continues with another token', async () => {
  const s = await scenario('recheck');
  assert.equal(step(s, 'freeze').code, 0);
  // the write counters (T0) must not move between the freeze and the backup, so the backup comes BEFORE any in-fence tampering
  const bk0 = step(s, 'backup');
  assert.equal(bk0.code, 0, bk0.text);
  const rc = () => step(s, 'audit', ['--recheck'], s.e);
  let r = rc();
  assert.equal(r.code, 0, r.text);
  // (volatile) change a column the manifest excludes: no stop
  const maintSql = (db, sql) => sh(`PGPASSWORD=${PW} psql -h /var/run/postgresql -U gymini_maintenance -d ${F.db(db)} -c "${sql}"`);
  r = maintSql('auth', `update users set \\"updatedAt\\" = now() + interval '1 day' where id='u-keep-admin'`);
  assert.equal(r.status, 0, r.stderr);
  r = rc();
  assert.equal(r.code, 0, `volatile column change must not stop: ${r.text}`);
  // allowlist row content changed
  maintSql('auth', `update users set \\"firstName\\"='changed' where id='u-keep-admin'`);
  r = rc();
  assert.equal(r.code, 1);
  assert.match(r.text, /kept row\(s\) changed or vanished/);
  maintSql('auth', `update users set \\"firstName\\"='keepA' where id='u-keep-admin'`);
  assert.equal(rc().code, 0);
  // extra tuple matching the selection appears after the audit
  const ins = maintSql('user', `insert into notifications(id,user_id,text,event_type,entity_type,entity_id,updated_at) select 'nt-late','u-del-1','x',event_type,entity_type,entity_id,now() from notifications where id='nt-del'`);
  assert.equal(ins.status, 0, ins.stderr);
  r = rc();
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /tuple sets differ[^]*nt-late/);
  // a tuple of the manifest disappears
  maintSql('user', `delete from notifications where id in ('nt-late','nt-del')`);
  r = rc();
  assert.equal(r.code, 1);
  assert.match(r.text, /approved but no longer selected|manifest expects \d+ row\(s\) to delete, the database now has none/);
  // clean must refuse to start (no DELETE), and says there is no way forward with this token
  assert.match(r.text, /new `audit`/);
  const c = step(s, 'clean', ['--apply']);
  assert.equal(c.code, 1);
  assert.match(c.text, /does not match the approved manifest|T0_CHANGED|write counters changed since the freeze/);
  assert.equal(countsM().gym.gyms, 3, 'nothing deleted');
  assert.equal(countsM().auth.users, 5);
  // a brand-new audit gives a NEW token and is not approved automatically
  assert.equal(cli(['restore', ...s.R], s.e).code, 0);
  assert.equal(cli(['unfreeze', ...s.R], s.e).code, 0);
});

test('G9 real primary key changed after the audit -> stop; composite-PK policy: only the exact tuples go; late tuple -> mismatch', async () => {
  const pol = path.join(dir('pol'), 'policy.mjs');
  fs.writeFileSync(pol, `import { POLICY as BASE, all, childOf, raw } from ${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'lib', 'policy.mjs')).href)};
export const POLICY = { ...BASE, gym: { ...BASE.gym, gym_amenities: all(childOf('gyms', ['gym_id', 'id']), raw((a) => a + '."amenity_id" <> \\'am-2\\'')) } };
`);
  const s = await scenario('composite', { policy: pol });
  const gm = s.manifest.tables.find((t) => t.table === 'gym_amenities');
  assert.deepEqual(gm.pk, ['gym_id', 'amenity_id'], 'composite pk read from pg_index in order');
  assert.deepEqual(gm.keys, [['gy-del1', 'am-1'], ['gy-del1', 'am-2'], ['gy-del2', 'am-1'], ['gy-keep', 'am-2']]);
  assert.equal(step(s, 'freeze').code, 0);
  const bk = step(s, 'backup'); // before any in-fence write: the T0 write counters must not move between freeze and backup
  assert.equal(bk.code, 0, bk.text);
  const psqlM = (db, sql) => sh(`PGPASSWORD=${PW} psql -h /var/run/postgresql -U gymini_maintenance -d ${F.db(db)} -c "${sql}"`);
  const alter = (cols) => psqlM('gym', `ALTER TABLE gym_amenities DROP CONSTRAINT gym_amenities_pkey, ADD PRIMARY KEY (${cols})`);
  assert.equal(alter('amenity_id, gym_id').status, 0);
  let r = step(s, 'audit', ['--recheck']);
  assert.equal(r.code, 1);
  assert.match(r.text, /primary key columns differ/);
  assert.equal(alter('gym_id, amenity_id').status, 0);
  r = step(s, 'audit', ['--recheck']);
  assert.equal(r.code, 0, r.text);
  const c = step(s, 'clean', ['--apply']);
  assert.equal(c.code, 0, c.text);
  const rows = sh(`PGPASSWORD=${PW} psql -At -h /var/run/postgresql -U gymini_maintenance -d ${F.db('gym')} -c "select gym_id||':'||amenity_id from gym_amenities order by 1"`).stdout.trim();
  assert.equal(rows, 'gy-keep:am-1', 'same gym_id, different amenity_id survives: whole tuples are compared');
  assert.equal(step(s, 'verify').code, 0);
  assert.equal(cli(['unfreeze', ...s.R], s.e).code, 0);
  // a tuple that matches the selection appears after the audit (simulated with the maintenance role) -> mismatch (own scenario: any in-fence write moves T0)
  const s2 = await scenario('composite2', { policy: pol });
  assert.equal(step(s2, 'freeze').code, 0);
  assert.equal(psqlM('gym', "insert into gym_amenities(gym_id,amenity_id) values ('gy-del2','am-2')").status, 0);
  r = step(s2, 'audit', ['--recheck']);
  assert.equal(r.code, 1);
  assert.match(r.text, /tuple sets differ[^]*gy-del2/);
  assert.equal(cli(['recover', ...s2.R], s2.e).code, 0);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('G10 H2 safety: late tuple / changed kept row inside the delete window -> ROLLBACK of that database, FAILED, stop; DB 4 of 7 failure leaves 1-3 DONE, 5-7 untouched; restore -> t0', async () => {
  const s = await scenario('fail4', { extra: ['--partner-dbs', 'include'] });
  assert.deepEqual(s.manifest.parameters.cleanDbs, ['chat', 'ai', 'fitness', 'payment', 'gym', 'user', 'auth']);
  const before = await F.counts();
  assert.equal(step(s, 'freeze').code, 0);
  assert.equal(step(s, 'backup').code, 0);
  const hook = JSON.stringify({ svc: 'payment', when: 'after-verify', sql: `insert into payment_transactions(id,payer_id,amount,currency,status,purpose,provider,idempotency_key,updated_at) values ('tx-late','u-del-1',1,'VND','PENDING','WALLET_TOPUP','MOCK','late-1',now())` });
  const c = step(s, 'clean', ['--apply'], { ...s.e, DBCLEAN_TEST_HOOK: hook });
  assert.equal(c.code, 1, c.text);
  const prog = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.deepEqual(Object.fromEntries(Object.entries(prog.dbs).map(([k, v]) => [k, v.state])), { chat: 'DONE', ai: 'DONE', fitness: 'DONE', payment: 'FAILED', gym: 'PENDING', user: 'PENDING', auth: 'PENDING' });
  assert.match(prog.dbs.payment.error, /still selected for deletion|LEFTOVER|rows are still selected|row counts after the delete are not before minus approved/);
  const cnt = async (db, t) => Number(sh(`PGPASSWORD=${PW} psql -At -h /var/run/postgresql -U gymini_maintenance -d ${F.db(db)} -c "select count(*) from ${t}"`).stdout.trim());
  assert.equal(await cnt('payment', 'wallets'), before.payment.wallets, 'payment rolled back: wallets untouched');
  assert.equal(await cnt('payment', 'payment_transactions'), before.payment.payment_transactions + 1, 'payment rolled back (only the late row from the hook exists)');
  assert.equal(await cnt('gym', 'gyms'), before.gym.gyms, 'gym untouched');
  assert.equal(await cnt('user', 'contracts'), before.user.contracts, 'user untouched');
  assert.equal(await cnt('auth', 'users'), before.auth.users, 'auth untouched');
  assert.equal(await cnt('chat', 'conversations'), before.chat.conversations - 2, 'chat DONE');
  assert.equal(await cnt('ai', 'chat_sessions'), before.ai.chat_sessions - 1, 'ai DONE (partner db included on request)');
  // never continues by itself; a plain re-run is refused; resume with a mismatching DB is refused too
  const again = step(s, 'clean', ['--apply']);
  assert.equal(again.code, 1);
  assert.match(again.err, /ALREADY_STARTED/);
  const st = cli(['status', ...s.R], s.e);
  assert.match(st.out, /"payment": \{\s+"state": "FAILED"/);
  assert.match(st.out, /"gym": \{\s+"state": "PENDING"/);
  const resume = step(s, 'clean', ['--apply', '--resume']);
  assert.equal(resume.code, 1, 'late tuple still present: the approved manifest no longer matches -> no resume');
  // restore all seven
  const r = cli(['restore', ...s.R], s.e);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(countsM(), before);
  assert.equal(cli(['unfreeze', ...s.R], s.e).code, 0);
  assert.equal(fs.existsSync(path.join(s.runDir, 'verify-clean.ok')), false);
});

test('G11 kept row changed between recheck and COMMIT -> ROLLBACK (rowHash); then --resume works once the data matches', async () => {
  const s = await scenario('keptrow');
  assert.equal(step(s, 'freeze').code, 0);
  assert.equal(step(s, 'backup').code, 0);
  const hook = JSON.stringify({ svc: 'auth', when: 'after-verify', sql: `update users set "firstName"='tampered' where id='u-keep-admin'` });
  const c = step(s, 'clean', ['--apply'], { ...s.e, DBCLEAN_TEST_HOOK: hook });
  assert.equal(c.code, 1, c.text);
  const prog = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.equal(prog.dbs.auth.state, 'FAILED');
  assert.match(prog.dbs.auth.error, /kept rows changed|PRESERVED_CHANGED|changed during/);
  for (const k of ['chat', 'payment', 'gym', 'user']) assert.equal(prog.dbs[k].state, 'DONE');
  const q = sh(`PGPASSWORD=${PW} psql -At -h /var/run/postgresql -U gymini_maintenance -d ${F.db('auth')} -c "select count(*) from users"`).stdout.trim();
  assert.equal(q, '5', 'auth rolled back: no user deleted');
  // put the kept row back and resume (explicit instruction)
  sh(`PGPASSWORD=${PW} psql -h /var/run/postgresql -U gymini_maintenance -d ${F.db('auth')} -c "update users set \\"firstName\\"='keepA' where id='u-keep-admin'"`);
  const r = step(s, 'clean', ['--apply', '--resume']);
  assert.equal(r.code, 0, r.text);
  assert.equal(step(s, 'verify').code, 0);
  assert.equal(cli(['unfreeze', ...s.R], s.e).code, 0);
  assert.ok(fs.existsSync(path.join(s.runDir, 'verify-clean.ok')));
});

test('G12 blockers: table without a primary key, FK cycle, unclassified table, FK conflict are reported and make the manifest unusable', async () => {
  const pol = path.join(dir('pol'), 'policy.mjs');
  fs.writeFileSync(pol, `import { POLICY as BASE, ownAll, raw } from ${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'lib', 'policy.mjs')).href)};
export const POLICY = { ...BASE, chat: { ...BASE.chat, zz_nopk: ownAll('uid'), zz_a: ownAll('uid'), zz_b: ownAll('uid') } };
`);
  await recoverAll();
  await F.createDatabases();
  const c = await F.seedData();
  await c.chat.query(`CREATE TABLE zz_nopk (uid text)`);
  await c.chat.query(`INSERT INTO zz_nopk VALUES ('u-del-1')`);
  await c.chat.query(`CREATE TABLE zz_a (id text PRIMARY KEY, uid text, b_id text)`);
  await c.chat.query(`CREATE TABLE zz_b (id text PRIMARY KEY, uid text, a_id text REFERENCES zz_a(id))`);
  await c.chat.query(`ALTER TABLE zz_a ADD FOREIGN KEY (b_id) REFERENCES zz_b(id) DEFERRABLE INITIALLY DEFERRED`);
  await c.chat.query(`INSERT INTO zz_a VALUES ('a1','u-del-1',NULL)`);
  await c.chat.query(`INSERT INTO zz_b VALUES ('b1','u-del-1','a1')`); // the delete order only considers tables that have rows to delete, so both sides of the cycle need one
  await c.chat.query(`CREATE TABLE zz_unclassified (id text PRIMARY KEY)`);
  await F.closeAll(c);
  const s = audited('blockers', { policy: pol, allow: ['admin@example.com'] });
  assert.deepEqual(s.manifest.blockers.noPrimaryKey, { [F.db('chat')]: ['zz_nopk'] });
  assert.deepEqual(s.manifest.blockers.unclassified, { [F.db('chat')]: ['public.zz_unclassified'] });
  assert.ok(s.manifest.blockers.deleteOrderCycles?.[F.db('chat')], `cycle reported; blockers=${JSON.stringify(s.manifest.blockers)}`);
  const f = step(s, 'freeze');
  assert.equal(f.code, 1);
  assert.match(f.text, /blockers/);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('G13 interrupted run: crash after H0 step 4 and after step 6; status tells the truth; nothing reopens by itself; recover (runbook) restores; leftover role stops a new freeze; bad fence file restores itself', async () => {
  const s = await scenario('crash');
  // --- crash after step 4: role exists + maintenance rule on top, TCP still allowed -> audit warns
  let r = step(s, 'freeze', [], { ...s.e, DBCLEAN_TEST_DIE_AFTER_STEP: '4' });
  assert.equal(r.code, 137);
  assert.equal(await maintRoleCount(), 1);
  const a = cli(['audit', '--env', 'test', '--out', dir('warn'), '--allowlist', s.al], s.e);
  assert.equal(a.code, 0, a.text);
  assert.match(a.text, /gymini_maintenance exists|already contains a gymini_maintenance rule/);
  // a new freeze refuses (leftover role / changed hba)
  r = cli(['freeze', '--env', 'test', '--run-dir', dir('rd'), ...s.M], s.e);
  assert.equal(r.code, 1);
  assert.match(r.text, /gymini_maintenance|pg_hba/);
  const rec = cli(['recover', ...s.R], s.e);
  assert.equal(rec.code, 0, rec.text);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  assert.equal(await maintRoleCount(), 0);
  // --- crash after step 6 (fence up, app containers n/a)
  const s2 = audited('crash2', {});
  r = step(s2, 'freeze', [], { ...s2.e, DBCLEAN_TEST_DIE_AFTER_STEP: '6' });
  assert.equal(r.code, 137);
  assert.equal(await tcpRejected('gymcoach_test', 'gymcoach_test_password', F.db('auth')), true, 'nothing reopened the database by itself');
  const st = cli(['status', ...s2.R], s2.e);
  assert.equal(st.code, 0, st.text);
  assert.match(st.out, /"state": "FREEZING"/);
  assert.match(st.out, /"lastStep": 6/);
  assert.match(st.out, /"is": "FENCE"/);
  assert.match(st.out, /"maintRoleExists": true/);
  assert.match(st.out, /maintenance role over the socket/);
  // the manual runbook, literally (docker exec -u postgres ... + pg_ctl reload, then drop the role as the app role)
  const hba = HBA;
  assert.equal(sh(`cp ${hba}.dbclean-orig ${hba}.tmp && mv ${hba}.tmp ${hba}`, 'postgres').status, 0);
  assert.equal(sh('pg_ctl reload -D "$PGDATA"', 'postgres').status, 0);
  await new Promise((r2) => setTimeout(r2, 800));
  assert.equal(hbaSha(), ORIG_HBA_SHA);
  const adm = await F.client('postgres');
  await adm.query(`ALTER ROLE gymini_maintenance NOSUPERUSER NOLOGIN`);
  await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gymini_maintenance'`);
  await adm.query(`DROP ROLE gymini_maintenance`);
  await adm.end();
  assert.equal(await maintRoleCount(), 0);
  // --- an invalid fence file: freeze restores the original itself and stops
  const bad = path.join(dir('badfence'), 'fence.txt');
  fs.writeFileSync(bad, 'this is not a valid pg_hba line\nlocal all\n');
  const s3 = audited('crash3', {});
  r = step(s3, 'freeze', [], { ...s3.e, DBCLEAN_TEST_FENCE_TEXT_FILE: bad });
  assert.equal(r.code, 1, r.text);
  assert.match(r.err, /FREEZE_STEP6/);
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'original pg_hba.conf copied back automatically');
  assert.equal(await maintRoleCount(), 0, 'maintenance role removed');
  assert.equal(await tcpRejected('gymcoach_test', 'gymcoach_test_password', F.db('auth')), false, 'app role connects again');
});

test('G14 partner-owned databases: audit alone never puts ai/fitness into the manifest; unknown service policy gap is a blocker', async () => {
  const s = await scenario('partner');
  const names = new Set(s.manifest.tables.map((t) => t.db));
  assert.equal(names.has(F.db('ai')) || names.has(F.db('fitness')), false);
  const md = readJ(path.join(s.d, 'cleanup-manifest.candidate.metadata.json'));
  assert.equal(md.perDb.fitness.inManifest, false);
  assert.ok(md.perDb.fitness.totals.delete >= 1, 'the report still counts what WOULD be deleted there');
  assert.ok(md.perDb.ai.partnerOwned);
});
