/**
 * db-clean guard-trigger tests - evidence label: BACKEND INTEGRATION (+ TEST FIXTURE for the data) on the ISOLATED TEST container
 * gymcoach-test-postgres-test-1 (localhost:55433), databases gymcoach_<svc>_dbclean_test (schema cloned from dev with pg_dump --schema-only,
 * so the real gym_listing_revisions_immutable trigger is present). The CLI runs as a real child process; the pipeline tests edit the
 * pg_hba.conf of THAT container only and put it back.
 *
 *   node --test --test-concurrency=1 scripts/db-clean/__tests__/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';
import { classifyTriggers, guardTriggerStaticProblems, GUARD_TRIGGER_ALLOWLIST } from '../lib/triggers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'db-clean.mjs');
const LIB = path.join(HERE, '..', 'lib');
const PW = 'Zq8mK2vLp9xT4nRw7sYc3HbG';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbclean-guard-'));
const CONTAINER = F.TEST_CONTAINER;
const HBA = '/var/lib/postgresql/data/pg_hba.conf';
const ALLOW = ['admin@example.com', 'john.doe@example.com'];
const TRIGGER = 'gym_listing_revisions_immutable';

const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DBCLEAN_MAINT_PASSWORD: PW, DBCLEAN_QUIET: '0', ...env }, maxBuffer: 1 << 28 });
  return { code: r.status, text: `${r.stdout}\n${r.stderr}` };
};
const sh = (cmd, user) => spawnSync('docker', ['exec', ...(user ? ['-u', user] : []), CONTAINER, 'sh', '-c', cmd], { encoding: 'utf8' });
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = (n) => {
  const d = path.join(TMP, `${n}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
async function q(database, sql, params) {
  const c = await F.client(database);
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}
const ids = async (svc, table, col = 'id') => (await q(F.db(svc), `SELECT "${col}" FROM "${table}" ORDER BY 1`)).map((r) => r[col]);
// while the fence is up the test user is rejected over TCP: read through the maintenance role (socket), like the tool does
const mq = (database, sql) => {
  const r = spawnSync('docker', ['exec', '-e', 'PGPASSWORD', CONTAINER, 'psql', '-X', '-A', '-t', '-h', '/var/run/postgresql', '-U', 'gymini_maintenance', '-d', database, '-c', sql], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PW } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
};
const trigState = async () => (await q(F.db('gym'), `SELECT tgenabled::text AS s FROM pg_trigger WHERE tgname = '${TRIGGER}' AND NOT tgisinternal`)).map((r) => r.s);

async function restoreHba() {
  const orig = process.env.DBCLEAN_ORIG_HBA_B64 ? Buffer.from(process.env.DBCLEAN_ORIG_HBA_B64, 'base64').toString('utf8') : null;
  if (orig) {
    spawnSync('docker', ['exec', '-i', '-u', 'postgres', CONTAINER, 'sh', '-c', `cat > ${HBA}.tmp && chmod 600 ${HBA}.tmp && mv -f ${HBA}.tmp ${HBA} && pg_ctl reload -D "$PGDATA"`], { input: orig, encoding: 'utf8' });
    await new Promise((r) => setTimeout(r, 800));
  }
  const adm = await F.client('postgres').catch(() => null);
  if (adm) {
    await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gymini_maintenance'`).catch(() => {});
    await adm.query(`DROP ROLE IF EXISTS gymini_maintenance`).catch(() => {});
    await adm.end();
  }
}
let ORIG_HBA_SHA;
const hbaSha = () => sh(`sha256sum ${HBA}`, 'postgres').stdout.split(/\s+/)[0];
test.before(async () => {
  const r = sh(`cat ${HBA}`, 'postgres');
  assert.equal(r.status, 0, 'test container must be running');
  process.env.DBCLEAN_ORIG_HBA_B64 = Buffer.from(r.stdout).toString('base64');
  ORIG_HBA_SHA = hbaSha();
  await restoreHba();
});
test.after(async () => {
  await restoreHba();
  await F.dropDatabases();
  fs.rmSync(TMP, { recursive: true, force: true });
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'pg_hba.conf back to the original');
});

/** Standard seed + a denied gym (E2E name) of a preserved owner, with CLOSED revisions, and a closed revision of a KEPT gym. */
async function build(extra) {
  await restoreHba();
  await F.createDatabases();
  const c = await F.seedData();
  await F.ins(c.gym, 'gyms', { id: 'gy-e2e', owner_id: F.ID.keepA, name: 'E2E Branch 1', brand_id: 'br-keep' });
  await F.ins(c.gym, 'gym_photos', { id: 'ph-e2e', gym_id: 'gy-e2e', file_name: 'e.jpg' });
  const rev = (id, gym, status) => F.ins(c.gym, 'gym_listing_revisions', { id, gym_id: gym, status, base_version: 1, payload: JSON.stringify({ name: id }) });
  await rev('rv-e2e-approved', 'gy-e2e', 'APPROVED');
  await rev('rv-e2e-rejected', 'gy-e2e', 'REJECTED');
  await rev('rv-e2e-draft', 'gy-e2e', 'DRAFT');
  await rev('rv-del-approved', 'gy-del1', 'APPROVED'); // gym of a deleted account
  await rev('rv-keep-approved', 'gy-keep', 'APPROVED'); // closed revision of a KEPT gym: must stay undeletable
  await F.ins(c.payment, 'wallets', { id: 'w-gym-e2e', owner_type: 'GYM', owner_id: 'gy-e2e' });
  if (extra) await extra(c);
  await F.closeAll(c);
}
const DENY = { gymNameLike: ['E2E%'] };

function audited(name, { deny = DENY } = {}) {
  const d = dir(name);
  const al = path.join(d, 'allow.json');
  fs.writeFileSync(al, JSON.stringify({ emails: ALLOW }));
  const args = ['audit', '--env', 'test', '--out', d, '--allowlist', al, '--fixtures', 'scripts/partner-application-e2e'];
  if (deny) {
    const df = path.join(d, 'deny.json');
    fs.writeFileSync(df, JSON.stringify(deny));
    args.push('--deny-file', df);
  }
  const a = cli(args);
  return { d, a };
}
const finish = (s) => {
  assert.equal(s.a.code, 0, `audit failed: ${s.a.text}`);
  const T = fs.readFileSync(path.join(s.d, 'confirm-token.candidate.txt'), 'utf8').trim();
  const manifest = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  const metadata = readJ(path.join(s.d, 'cleanup-manifest.candidate.metadata.json'));
  const runDir = path.join(s.d, 'run');
  const ap = cli(['approve', '--env', 'test', '--manifest', path.join(s.d, 'cleanup-manifest.candidate.json'), '--confirm-token', T, '--out', runDir]);
  assert.equal(ap.code, 0, ap.text);
  const A = path.join(runDir, 'approved', 'cleanup-manifest.approved.json');
  return { ...s, T, manifest, metadata, runDir, A, R: ['--env', 'test', '--run-dir', runDir], M: ['--manifest', A, '--confirm-token', T] };
};
const keysOf = (m, db, table) => m.tables.find((t) => t.db === F.db(db) && t.table === table)?.keys.map((k) => k[0]).sort() ?? [];

// =====================================================================================================================
test('T1 full H0-H4 pipeline: a denied gym with CLOSED revisions is really deleted with them; trigger enabled afterwards; a kept gym revision still refuses DELETE', async () => {
  await build();
  assert.deepEqual(await trigState(), ['O']);
  const s = finish(audited('t1'));
  const m = s.manifest;
  assert.equal(Object.keys(m.blockers).length, 0, JSON.stringify(m.blockers));
  // the manifest records the allowlisted pair and the table that uses it
  assert.equal(m.guardTriggers.length, 1);
  assert.deepEqual(m.guardTriggers[0], { db: F.db('gym'), schema: 'public', table: 'gym_listing_revisions', trigger: TRIGGER, function: 'gym_listing_revisions_guard_closed', timing: 'BEFORE', events: 'DELETE OR UPDATE', row: true, enabledAtAudit: 'O', rowsDeleted: 4 });
  assert.deepEqual(keysOf(m, 'gym', 'gym_listing_revisions'), ['rv-del-approved', 'rv-e2e-approved', 'rv-e2e-draft', 'rv-e2e-rejected']);
  assert.ok(!keysOf(m, 'gym', 'gym_listing_revisions').includes('rv-keep-approved'));
  const row = s.metadata.triggerPreflight.listing.gym.find((t) => t.trigger === TRIGGER);
  assert.equal(row.status, 'ALLOWLISTED');
  assert.ok(s.metadata.triggerPreflight.listing.gym.some((t) => t.trigger === 'gyms_compat_writer_guard' && t.status === 'NOT_ARMED'), 'the UPDATE-only compat guard is reported and not armed (children first)');
  // the audit report lists the preflight
  assert.equal(cli(['audit', '--env', 'test', '--out', dir('t1r'), '--allowlist', path.join(s.d, 'allow.json'), '--fixtures', 'scripts/partner-application-e2e', '--deny-file', path.join(s.d, 'deny.json'), '--report', path.join(s.d, 'report.md')]).code, 0);
  assert.match(fs.readFileSync(path.join(s.d, 'report.md'), 'utf8'), /6c\. Trigger preflight[\s\S]*gym_listing_revisions_immutable[\s\S]*ALLOWLISTED/);

  const run = (name, extra = []) => cli([name, ...s.R, ...s.M, ...extra]);
  for (const [name, extra] of [['freeze', []], ['backup', []], ['clean', ['--apply']], ['verify', []]]) {
    const r = run(name, extra);
    assert.equal(r.code, 0, `${name}: ${r.text}`);
  }
  // progress records what was switched off and that it was enabled before COMMIT
  const progress = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.deepEqual(progress.dbs.gym.guardTriggers, [{ table: 'gym_listing_revisions', trigger: TRIGGER, rowsDeleted: 4, enabledBeforeCommit: true }]);
  const u = cli(['unfreeze', ...s.R]);
  assert.equal(u.code, 0, u.text);
  assert.equal(hbaSha(), ORIG_HBA_SHA);

  assert.deepEqual(await ids('gym', 'gym_listing_revisions'), ['rv-keep-approved'], 'the closed revisions of the denied gym and of the deleted account went with their gyms');
  assert.deepEqual(await ids('gym', 'gyms'), ['gy-keep']);
  assert.deepEqual(await trigState(), ['O'], 'trigger enabled again after the cleanup (read from pg_trigger)');
  // the guard still works for a kept gym: DELETE and UPDATE of a closed revision are refused
  await assert.rejects(q(F.db('gym'), `DELETE FROM gym_listing_revisions WHERE id = 'rv-keep-approved'`), /closed revision rv-keep-approved \(status APPROVED\) cannot be deleted/);
  await assert.rejects(q(F.db('gym'), `UPDATE gym_listing_revisions SET review_note = 'x' WHERE id = 'rv-keep-approved'`), /is immutable/);
  assert.deepEqual(await ids('gym', 'gym_listing_revisions'), ['rv-keep-approved']);
});

test('T2 a failure INSIDE the guard window rolls back and leaves the trigger enabled; the closed revisions are still there; --resume then completes', async () => {
  await build();
  const s = finish(audited('t2'));
  const run = (name, extra = [], env = {}) => cli([name, ...s.R, ...s.M, ...extra], env);
  const revisionsBefore = await ids('gym', 'gym_listing_revisions');
  for (const n of ['freeze', 'backup']) assert.equal(run(n).code, 0);
  const hook = JSON.stringify({ svc: 'gym', when: 'guard-disabled', throw: true });
  const bad = run('clean', ['--apply'], { DBCLEAN_TEST_HOOK: hook });
  assert.equal(bad.code, 1, bad.text);
  assert.match(bad.text, /forced failure/);
  const progress = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.equal(progress.dbs.gym.state, 'FAILED');
  assert.equal(progress.dbs.chat.state, 'DONE');
  assert.deepEqual(mq(F.db('gym'), `SELECT tgenabled::text FROM pg_trigger WHERE tgname = '${TRIGGER}' AND NOT tgisinternal`), ['O'], 'ROLLBACK restored the trigger (it had been disabled when the failure happened)');
  assert.deepEqual(mq(F.db('gym'), `SELECT id FROM gym_listing_revisions ORDER BY 1`), revisionsBefore, 'nothing was deleted from gym_listing_revisions');
  assert.deepEqual(mq(F.db('gym'), `SELECT id FROM gyms ORDER BY 1`), ['gy-del1', 'gy-del2', 'gy-e2e', 'gy-keep']);
  assert.deepEqual(mq(F.db('gym'), `SELECT count(*) FROM pg_trigger WHERE tgenabled <> 'O' AND NOT tgisinternal`), ['0'], 'no user trigger of the database is in any other state');
  // --resume (explicit): chat/payment are DONE and skipped, gym runs again and completes
  const ok = run('clean', ['--apply', '--resume']);
  assert.equal(ok.code, 0, ok.text);
  assert.equal(run('verify').code, 0);
  assert.equal(cli(['unfreeze', ...s.R]).code, 0);
  assert.deepEqual(await ids('gym', 'gym_listing_revisions'), ['rv-keep-approved']);
  assert.deepEqual(await trigState(), ['O']);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('T3 an UNLISTED raising trigger on a table of the delete set is a blocker at AUDIT (named), freeze refuses; an empty / unarmed one is not', async () => {
  await build(async (c) => {
    await c.gym.query(`CREATE FUNCTION t_raise() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope %', TG_TABLE_NAME; END $$`);
    await c.gym.query(`CREATE TRIGGER t_photos_guard BEFORE DELETE ON gym_photos FOR EACH ROW EXECUTE FUNCTION t_raise()`);
    // unarmed: the table is empty and not in the delete set
    await c.gym.query(`CREATE TRIGGER t_checkins_guard BEFORE DELETE ON gym_pt_check_ins FOR EACH ROW EXECUTE FUNCTION t_raise()`);
  });
  const s = audited('t3');
  assert.equal(s.a.code, 0, s.a.text);
  const m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  const md = readJ(path.join(s.d, 'cleanup-manifest.candidate.metadata.json'));
  const bl = m.blockers.triggerGuards;
  assert.deepEqual(bl.map((b) => `${b.table}.${b.trigger}`), ['gym_photos.t_photos_guard']);
  assert.match(bl[0].reason, /not in the db-clean guard-trigger allowlist/);
  assert.equal(md.triggerPreflight.listing.gym.find((t) => t.trigger === 't_checkins_guard').status, 'NOT_ARMED');
  const T = fs.readFileSync(path.join(s.d, 'confirm-token.candidate.txt'), 'utf8').trim();
  const runDir = path.join(s.d, 'run');
  assert.equal(cli(['approve', '--env', 'test', '--manifest', path.join(s.d, 'cleanup-manifest.candidate.json'), '--confirm-token', T, '--out', runDir]).code, 0);
  const fr = cli(['freeze', '--env', 'test', '--run-dir', runDir, '--manifest', path.join(runDir, 'approved', 'cleanup-manifest.approved.json'), '--confirm-token', T]);
  assert.equal(fr.code, 1, fr.text);
  assert.match(fr.text, /blockers/);
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'nothing was fenced');
});

test('T4 the allowlisted NAME in a different shape is a blocker; an unlisted guard on a delete-set child table (gym_amenities) is a blocker', async () => {
  // (a) same trigger name, but recreated AFTER DELETE
  await build(async (c) => {
    await c.gym.query(`DROP TRIGGER ${TRIGGER} ON gym_listing_revisions`);
    await c.gym.query(`CREATE TRIGGER ${TRIGGER} AFTER DELETE ON gym_listing_revisions FOR EACH ROW EXECUTE FUNCTION gym_listing_revisions_guard_closed()`);
  });
  let m = readJ(path.join(audited('t4a').d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.triggerGuards?.some((b) => b.trigger === TRIGGER && /timing is AFTER/.test(b.reason)), JSON.stringify(m.blockers));
  assert.equal(m.guardTriggers.length, 0);
  // (b) a raising trigger on a child table whose rows are deleted with the denied gym (cascade reachability itself is covered by the pure test T6)
  await build(async (c) => {
    await c.gym.query(`CREATE FUNCTION t_raise() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope'; END $$`);
    await c.gym.query(`CREATE TRIGGER t_amen_guard BEFORE DELETE ON gym_amenities FOR EACH ROW EXECUTE FUNCTION t_raise()`);
  });
  m = readJ(path.join(audited('t4b', { deny: null }).d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.triggerGuards?.some((b) => b.table === 'gym_amenities' && b.trigger === 't_amen_guard'), JSON.stringify(m.blockers));
});

test('T5 recheck: a guard trigger dropped, or an unlisted raising trigger added, after the audit stops the run; nothing else changed', async () => {
  await build();
  const s = finish(audited('t5'));
  assert.equal(cli(['audit', '--recheck', '--env', 'test', ...s.M]).code, 0);
  const c = await F.client(F.db('gym'));
  await c.query(`CREATE FUNCTION t_raise() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope'; END $$`);
  await c.query(`CREATE TRIGGER t_photos_guard BEFORE DELETE ON gym_photos FOR EACH ROW EXECUTE FUNCTION t_raise()`);
  const r1 = cli(['audit', '--recheck', '--env', 'test', ...s.M]);
  assert.equal(r1.code, 1, r1.text);
  assert.match(r1.text, /trigger "t_photos_guard" on public\.gym_photos/);
  await c.query(`DROP TRIGGER t_photos_guard ON gym_photos`);
  await c.query(`ALTER TABLE gym_listing_revisions DISABLE TRIGGER ${TRIGGER}`);
  const r2 = cli(['audit', '--recheck', '--env', 'test', ...s.M]);
  assert.equal(r2.code, 1, r2.text);
  assert.match(r2.text, /guard triggers differ from the manifest|DISABLED/);
  await c.end();
});

test('T6 pure: the manifest section must be exactly an allowlisted pair of a delete-list table; classification of cascade / SET NULL / disabled / TRUNCATE', async () => {
  const base = { environment: { dbs: [{ datname: 'gymcoach_gym_x', svc: 'gym' }] }, tables: [{ db: 'gymcoach_gym_x', schema: 'public', table: 'gym_listing_revisions', count: 3 }] };
  const good = { db: 'gymcoach_gym_x', schema: 'public', table: 'gym_listing_revisions', trigger: TRIGGER, function: 'gym_listing_revisions_guard_closed', timing: 'BEFORE', events: 'DELETE OR UPDATE', row: true, enabledAtAudit: 'O', rowsDeleted: 3 };
  assert.deepEqual(guardTriggerStaticProblems({ ...base, guardTriggers: [good] }), []);
  assert.match(guardTriggerStaticProblems({ ...base })[0], /no "guardTriggers" section/);
  assert.match(guardTriggerStaticProblems({ ...base, guardTriggers: [{ ...good, trigger: 'other' }] })[0], /not in the allowlist/);
  assert.match(guardTriggerStaticProblems({ ...base, guardTriggers: [{ ...good, table: 'gym_photos' }] })[0], /not in the allowlist/);
  assert.match(guardTriggerStaticProblems({ ...base, guardTriggers: [{ ...good, rowsDeleted: 2 }] }).join(), /rowsDeleted 2 != manifest table count 3/);
  assert.match(guardTriggerStaticProblems({ ...base, guardTriggers: [good, good] }).join(), /twice/);
  assert.match(guardTriggerStaticProblems({ ...base, tables: [], guardTriggers: [good] }).join(), /not in the delete list/);
  assert.equal(GUARD_TRIGGER_ALLOWLIST.length, 1, 'exactly one pair is allowlisted');

  const trig = (over) => ({ schema: 'public', table: 't', trigger: 'x', enabled: 'O', function: 'f', timing: 'BEFORE', row: true, onInsert: false, onDelete: true, onUpdate: false, onTruncate: false, constraintTrigger: false, ...over });
  const fk = (child, parent, onDelete, name = `${child}_fk`) => ({ name, schema: 'public', table: child, refSchema: 'public', refTable: parent, onDelete, cols: ['p'], refCols: ['id'] });
  const run = (triggers, deleteSet, fks, rows = {}) => classifyTriggers({ svc: 'gym', datname: 'd', triggers, deleteSet: new Map(deleteSet), fks, rowCounts: new Map(Object.entries(rows)) });
  const st = (r) => r.listing.map((l) => `${l.table}.${l.trigger}:${l.status}`);
  // direct DELETE of a delete-set table, unlisted -> blocker
  assert.deepEqual(st(run([trig({ table: 'a' })], [['public.a', 2]], [])), ['a.x:BLOCKER']);
  // not in the delete set, no cascade -> not armed
  assert.deepEqual(st(run([trig({ table: 'b' })], [['public.a', 2]], [])), ['b.x:NOT_ARMED']);
  // cascade-reached: non-empty -> blocker; empty -> not armed; transitive
  const chain = [fk('b', 'a', 'c'), fk('c', 'b', 'c')];
  assert.deepEqual(st(run([trig({ table: 'c' })], [['public.a', 2]], chain, { 'public.c': 4 })), ['c.x:BLOCKER']);
  assert.deepEqual(st(run([trig({ table: 'c' })], [['public.a', 2]], chain, { 'public.c': 0 })), ['c.x:NOT_ARMED']);
  // RESTRICT / NO ACTION edges do not cascade
  assert.deepEqual(st(run([trig({ table: 'b' })], [['public.a', 2]], [fk('b', 'a', 'r')], { 'public.b': 5 })), ['b.x:NOT_ARMED']);
  // UPDATE trigger on a SET NULL child: child deleted first -> not armed; child NOT in the delete set with rows -> blocker
  const upd = trig({ table: 'g', onDelete: false, onUpdate: true });
  assert.deepEqual(st(run([upd], [['public.g', 1], ['public.p', 1]], [fk('g', 'p', 'n')], { 'public.g': 1 })), ['g.x:NOT_ARMED']);
  assert.deepEqual(st(run([upd], [['public.p', 1]], [fk('g', 'p', 'n')], { 'public.g': 1 })), ['g.x:BLOCKER']);
  assert.deepEqual(st(run([upd], [['public.p', 1]], [fk('g', 'p', 'n')], { 'public.g': 0 })), ['g.x:NOT_ARMED']);
  // disabled / replica-only / TRUNCATE-only triggers are never armed
  assert.deepEqual(st(run([trig({ table: 'a', enabled: 'D' })], [['public.a', 2]], [])), ['a.x:NOT_ARMED']);
  assert.deepEqual(st(run([trig({ table: 'a', enabled: 'R' })], [['public.a', 2]], [])), ['a.x:NOT_ARMED']);
  assert.deepEqual(st(run([trig({ table: 'a', onDelete: false, onTruncate: true })], [['public.a', 2]], [])), ['a.x:NOT_ARMED']);
  // the allowlisted pair: ok in the pinned shape; disabled / other shape / also armed by UPDATE-SET-NULL -> blocker
  const g = trig({ table: 'gym_listing_revisions', trigger: TRIGGER, function: 'gym_listing_revisions_guard_closed', onUpdate: true });
  const ds = [['public.gym_listing_revisions', 3]];
  assert.deepEqual(st(run([g], ds, [])), [`gym_listing_revisions.${TRIGGER}:ALLOWLISTED`]);
  assert.equal(run([g], ds, []).guardTriggers[0].rowsDeleted, 3);
  assert.deepEqual(st(run([{ ...g, function: 'other_fn' }], ds, [])), [`gym_listing_revisions.${TRIGGER}:BLOCKER`]);
  assert.deepEqual(st(run([{ ...g, timing: 'AFTER' }], ds, [])), [`gym_listing_revisions.${TRIGGER}:BLOCKER`]);
  assert.deepEqual(st(run([{ ...g, onUpdate: false }], ds, [])), [`gym_listing_revisions.${TRIGGER}:BLOCKER`]);
  // the same table name in another service is NOT allowlisted
  assert.deepEqual(st(classifyTriggers({ svc: 'user', datname: 'd', triggers: [g], deleteSet: new Map(ds), fks: [], rowCounts: new Map() })), [`gym_listing_revisions.${TRIGGER}:BLOCKER`]);
  // pt_listing_revisions has the same kind of guard but is NOT allowlisted: if its table ever enters a delete set it blocks at audit
  const pt = trig({ table: 'pt_listing_revisions', trigger: 'pt_listing_revisions_immutable', function: 'pt_listing_revisions_guard_closed', onUpdate: true });
  assert.deepEqual(st(classifyTriggers({ svc: 'user', datname: 'd', triggers: [pt], deleteSet: new Map([['public.pt_listing_revisions', 1]]), fks: [], rowCounts: new Map() })), ['pt_listing_revisions.pt_listing_revisions_immutable:BLOCKER']);
});

test('T7 CODE AUDIT: the tool never uses session_replication_role and never disables ALL / USER triggers; only the allowlist builds DISABLE statements', async () => {
  for (const f of fs.readdirSync(LIB).filter((n) => n.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/session_replication_role/i.test(text), `${f} must not touch session_replication_role`);
    assert.ok(!/DISABLE\s+TRIGGER\s+(ALL|USER)/i.test(text), `${f} must not disable ALL / USER triggers`);
    if (f !== 'triggers.mjs') assert.ok(!/DISABLE\s+TRIGGER/i.test(text), `${f}: DISABLE TRIGGER is only built in triggers.mjs`);
  }
});
