/**
 * db-clean --deny-file tests - evidence label: BACKEND INTEGRATION (+ TEST FIXTURE for the data) on the ISOLATED TEST container
 * gymcoach-test-postgres-test-1 (localhost:55433), databases gymcoach_<svc>_dbclean_test (the same ones db-clean.test.mjs uses: run the
 * two files one after the other, `--test-concurrency=1`). The CLI runs as a real child process; the full pipeline test edits the
 * pg_hba.conf of THAT container only and puts it back.
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
import { validatePatterns } from '../lib/deny.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'db-clean.mjs');
const PW = 'Zq8mK2vLp9xT4nRw7sYc3HbG';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbclean-deny-'));
const CONTAINER = F.TEST_CONTAINER;
const HBA = '/var/lib/postgresql/data/pg_hba.conf';
const ALLOW = ['admin@example.com', 'john.doe@example.com'];

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

/** Standard seed + the E2E rows under a PRESERVED owner (keepA / keepB). Returns nothing; extra(c) may add scenario rows. */
async function build(extra) {
  await restoreHba();
  await F.createDatabases();
  const c = await F.seedData();
  const ST = (c.gym ? 'EXPIRED' : '');
  // gym-service: a denied gym of a preserved owner with children; E2E catalogue amenity + proposal + audit rows
  await F.ins(c.gym, 'gyms', { id: 'gy-e2e', owner_id: F.ID.keepA, name: 'E2E Branch 1', brand_id: 'br-keep' });
  await F.ins(c.gym, 'gyms', { id: 'gy-lower', owner_id: F.ID.keepA, name: 'e2e lowercase is not denied', brand_id: 'br-keep' });
  await F.ins(c.gym, 'gym_photos', { id: 'ph-e2e', gym_id: 'gy-e2e', file_name: 'e.jpg' });
  await F.ins(c.gym, 'gym_membership_contracts', { id: 'mc-e2e', gym_id: 'gy-e2e', plan_id: 'mp-keep', client_id: F.ID.keepB, status: ST });
  await F.ins(c.gym, 'amenities', { id: 'am-e2e', slug: 'e2e-sauna', name: 'E2E_Sauna', name_normalized: 'e2e_sauna' });
  await F.ins(c.gym, 'amenities', { id: 'am-lower', slug: 'e2e-lower', name: 'e2e lower', name_normalized: 'e2e lower' });
  await F.ins(c.gym, 'amenity_proposals', { id: 'pr-e2e', owner_user_id: F.ID.keepA, gym_id: 'gy-keep', name: 'E2E_Sauna', name_normalized: 'e2e_sauna', suggested_category: (await c.gym.query(`SELECT (enum_range(NULL::"AmenityCategory"))[1] AS v`)).rows[0].v, status: 'APPROVED', resulting_amenity_id: 'am-e2e' });
  await c.gym.query(`UPDATE amenities SET created_from_proposal_id = 'pr-e2e' WHERE id = 'am-e2e'`);
  await F.ins(c.gym, 'amenity_proposals', { id: 'pr-real', owner_user_id: F.ID.keepA, gym_id: 'gy-keep', name: 'Real request', name_normalized: 'real request', suggested_category: (await c.gym.query(`SELECT (enum_range(NULL::"AmenityCategory"))[1] AS v`)).rows[0].v, status: 'PENDING' });
  for (const [g, a] of [['gy-keep', 'am-e2e'], ['gy-e2e', 'am-1'], ['gy-e2e', 'am-e2e'], ['gy-del1', 'am-e2e']]) await F.ins(c.gym, 'gym_amenities', { gym_id: g, amenity_id: a });
  await F.ins(c.gym, 'amenity_audit_logs', { id: 'aal-e2e', actor_user_id: F.ID.keepA, action: 'APPROVE', amenity_id: 'am-e2e', proposal_id: 'pr-e2e' });
  await F.ins(c.gym, 'amenity_audit_logs', { id: 'aal-keep', actor_user_id: F.ID.keepA, action: 'CREATE', amenity_id: 'am-1' });
  await F.ins(c.payment, 'wallets', { id: 'w-gym-e2e', owner_type: 'GYM', owner_id: 'gy-e2e' });
  // user-service: E2E packages, one of them still referenced by a contract
  await F.ins(c.user, 'pt_service_packages', { id: 'pk-e2e', pt_user_id: F.ID.keepB, name: 'E2E package' });
  await F.ins(c.user, 'pt_service_packages', { id: 'pk-e2e-used', pt_user_id: F.ID.keepB, name: 'E2E used package' });
  await c.user.query(`UPDATE contracts SET package_id = 'pk-e2e-used' WHERE id = 'ct-keep'`);
  if (extra) await extra(c);
  await F.closeAll(c);
}
const DENY = { gymNameLike: ['E2E%'], amenityNameLike: ['E2E\\_%'], proposalNameLike: ['E2E\\_%'], packageNameLike: ['E2E%'] };

function audited(name, { deny = DENY, rawDeny, env = {} } = {}) {
  const d = dir(name);
  const al = path.join(d, 'allow.json');
  fs.writeFileSync(al, JSON.stringify({ emails: ALLOW }));
  const args = ['audit', '--env', 'test', '--out', d, '--allowlist', al, '--fixtures', 'scripts/partner-application-e2e'];
  if (deny || rawDeny) {
    const df = path.join(d, 'deny.json');
    fs.writeFileSync(df, rawDeny ?? JSON.stringify(deny));
    args.push('--deny-file', df);
  }
  const a = cli(args, env);
  return { d, a, deny: path.join(d, 'deny.json'), allow: al };
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
test('D1 patterns: anything that does not start with "E2E" (case-sensitive) is refused; unknown keys refused; pure + CLI', async () => {
  for (const bad of ['%', 'e2e%', 'Real%', ' E2E%', '%E2E', 'E2', '']) {
    assert.throws(() => validatePatterns({ gymNameLike: [bad] }), /does not start with "E2E"/, `pattern ${JSON.stringify(bad)}`);
  }
  assert.throws(() => validatePatterns({ gymNameLike: ['E2E%', 'Khu Thu Giant Maestro'] }), /does not start with "E2E"/);
  assert.throws(() => validatePatterns({ packageNameLike: 'Mine' }), /does not start with "E2E"/);
  assert.throws(() => validatePatterns({ userEmailLike: ['E2E%'] }), /unknown key/);
  assert.throws(() => validatePatterns([]), /JSON object/);
  assert.deepEqual(validatePatterns({ gymNameLike: 'E2E%' }).gymNameLike, ['E2E%']);
  // the CLI refuses before touching any database (no databases needed: createDatabases is not called)
  const bad = audited('bad', { deny: null, rawDeny: JSON.stringify({ amenityNameLike: ['Sauna%'] }) });
  assert.equal(bad.a.code, 1, bad.a.text);
  assert.match(bad.a.text, /does not start with "E2E"/);
  assert.ok(!fs.existsSync(path.join(bad.d, 'cleanup-manifest.candidate.json')), 'no manifest was written');
  const junk = audited('junk', { deny: null, rawDeny: '{not json' });
  assert.equal(junk.a.code, 1);
  assert.match(junk.a.text, /not valid JSON/);
});

test('D2 manifest: denied ids of a PRESERVED owner are expanded, children cascade, owner + other gyms + dispute tables kept; token covers the ids', async () => {
  await build(async (c) => {
    const caseId = crypto.randomUUID();
    await c.user.query(
      `INSERT INTO dispute_cases (id, session_id, contract_id, client_user_id, pt_user_id, type, created_by, updated_at) VALUES ($1, 'se-ct-keep', 'ct-keep', $2, $3, (enum_range(NULL::"DisputeCaseType"))[1], $2, now())`,
      [caseId, F.ID.keepA, F.ID.keepB],
    );
    await c.user.query(`INSERT INTO dispute_case_events (id, case_id, actor_user_id, actor_role, action) VALUES ($1, $2, $3, 'CLIENT', 'OPENED')`, [crypto.randomUUID(), caseId, F.ID.keepA]);
  });
  const s = finish(audited('d2'));
  const m = s.manifest;
  assert.equal(m.blockers && Object.keys(m.blockers).length, 0, JSON.stringify(m.blockers));
  assert.deepEqual(m.deny.patterns, validatePatterns(DENY));
  assert.deepEqual(m.deny.gymIds, ['gy-e2e']);
  assert.deepEqual(m.deny.amenityIds, ['am-e2e'], 'lower-case e2e is not matched; case-sensitive');
  assert.deepEqual(m.deny.proposalIds, ['pr-e2e']);
  assert.deepEqual(m.deny.packageIds, ['pk-e2e'], 'the package a contract still refers to is not denied');
  assert.deepEqual(m.deny.keptDespiteDeny.map((k) => [k.id, k.contracts]), [['pk-e2e-used', 1]]);
  // gym-service
  assert.deepEqual(keysOf(m, 'gym', 'gyms'), ['gy-del1', 'gy-del2', 'gy-e2e'], 'the denied gym of the PRESERVED owner goes with the deleted-account gyms; gy-keep + gy-lower stay');
  assert.deepEqual(keysOf(m, 'gym', 'gym_photos'), ['ph-del', 'ph-e2e']);
  assert.deepEqual(keysOf(m, 'gym', 'gym_membership_contracts'), ['mc-del', 'mc-e2e', 'mc-mixed']);
  assert.deepEqual(keysOf(m, 'gym', 'amenities'), ['am-e2e']);
  assert.deepEqual(keysOf(m, 'gym', 'amenity_proposals'), ['pr-e2e']);
  assert.deepEqual(keysOf(m, 'gym', 'amenity_audit_logs'), ['aal-e2e']);
  const ga = m.tables.find((t) => t.db === F.db('gym') && t.table === 'gym_amenities').keys.map((k) => k.join('/')).sort();
  assert.deepEqual(ga, ['gy-del1/am-1', 'gy-del1/am-2', 'gy-del1/am-e2e', 'gy-del2/am-1', 'gy-e2e/am-1', 'gy-e2e/am-e2e', 'gy-keep/am-e2e'], 'amenity rows that point at the denied amenity follow it');
  assert.ok(!keysOf(m, 'gym', 'gym_brands').includes('br-keep'), 'the preserved owner brand is kept');
  assert.ok(keysOf(m, 'payment', 'wallets').includes('w-gym-e2e'), 'the wallet of the denied gym goes (zero balance)');
  assert.deepEqual(keysOf(m, 'user', 'pt_service_packages'), ['pk-del', 'pk-e2e']);
  // preserved owners and the dispute tables are untouched
  assert.deepEqual(m.tables.filter((t) => /dispute/.test(t.table)), [], 'dispute tables never in the delete list');
  assert.ok(m.allowlist.users.length === 2);
  // token: covers the deny ids - a different id list gives a different token, the same input gives the same token
  const s2 = finish(audited('d2b'));
  assert.equal(s2.T, s.T, 'same data + same deny file -> same token');
  const edited = JSON.parse(JSON.stringify(m));
  edited.deny.gymIds.push('gy-lower');
  const tamper = cli(['approve', '--env', 'test', '--manifest', (() => { const f = path.join(s.d, 'edited.json'); fs.writeFileSync(f, JSON.stringify(edited)); return f; })(), '--confirm-token', s.T, '--out', dir('t')]);
  assert.equal(tamper.code, 1, 'a manifest whose deny ids changed does not match the approved token');
  // another deny file -> another manifest -> another token
  const s3 = finish(audited('d2c', { deny: { gymNameLike: ['E2E%'] } }));
  assert.notEqual(s3.T, s.T, 'dropping the amenity / proposal / package patterns changes the token');
  // no deny file -> nothing extra is selected (the old behaviour) and the amenity catalogue is untouched
  const s4 = finish(audited('d2d', { deny: null }));
  assert.deepEqual(s4.manifest.deny.gymIds, []);
  assert.deepEqual(keysOf(s4.manifest, 'gym', 'amenities'), []);
  assert.ok(!keysOf(s4.manifest, 'gym', 'gyms').includes('gy-e2e'));
  assert.notEqual(s4.T, s.T);
  // the dispute rows the fixture inserted point at preserved things only: no blocker
  assert.equal(Object.keys(s4.manifest.blockers).length, 0);
});

test('D3 blockers: a denied gym with a live contract / live membership / money in its wallet; a dispute row that depends on something deleted', async () => {
  // (a) live membership on the denied gym
  await build(async (c) => {
    await c.gym.query(`UPDATE gym_membership_contracts SET status = 'ACTIVE' WHERE id = 'mc-e2e'`);
  });
  let s = audited('d3a');
  assert.equal(s.a.code, 0, s.a.text);
  let m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.deniedGymLiveRefs?.some((b) => b.table === 'gym_membership_contracts' && b.gyms[0].gymId === 'gy-e2e'), JSON.stringify(m.blockers));
  const T = fs.readFileSync(path.join(s.d, 'confirm-token.candidate.txt'), 'utf8').trim();
  const runDir = path.join(s.d, 'run');
  assert.equal(cli(['approve', '--env', 'test', '--manifest', path.join(s.d, 'cleanup-manifest.candidate.json'), '--confirm-token', T, '--out', runDir]).code, 0);
  const apErr = cli(['freeze', '--env', 'test', '--run-dir', runDir, '--manifest', path.join(runDir, 'approved', 'cleanup-manifest.approved.json'), '--confirm-token', T]);
  assert.equal(apErr.code, 1, 'a manifest with blockers cannot be frozen / applied');
  assert.match(apErr.text, /blockers/);
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'nothing was fenced');

  // (b) live PT contract (user-service) that names the denied gym
  await build(async (c) => {
    await c.user.query(`UPDATE contracts SET gym_id = 'gy-e2e' WHERE id = 'ct-keep'`);
  });
  s = audited('d3b');
  m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.deniedGymLiveRefs?.some((b) => b.table === 'contracts'), JSON.stringify(m.blockers));

  // (c) money in the denied gym's wallet
  await build(async (c) => {
    await c.payment.query(`UPDATE wallets SET available_balance = 5000 WHERE id = 'w-gym-e2e'`);
  });
  s = audited('d3c');
  m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.deniedGymLiveRefs?.some((b) => b.table === 'wallets'), JSON.stringify(m.blockers));

  // (d) a dispute row that points at a contract of the denied gym
  await build(async (c) => {
    await c.user.query(`UPDATE contracts SET gym_id = 'gy-e2e', status = 'COMPLETED' WHERE id = 'ct-keep'`);
    await c.user.query(
      `INSERT INTO dispute_cases (id, session_id, contract_id, client_user_id, pt_user_id, type, created_by, updated_at) VALUES ($1, 'se-ct-keep', 'ct-keep', $2, $3, (enum_range(NULL::"DisputeCaseType"))[1], $2, now())`,
      [crypto.randomUUID(), F.ID.keepA, F.ID.keepB],
    );
  });
  s = audited('d3d');
  m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  assert.ok(m.blockers.disputeDependencies?.some((b) => b.table === 'dispute_cases' && /DENIED gym/.test(b.reason)), JSON.stringify(m.blockers));

  // (e) a dispute row that depends on a contract / account that would be deleted (no deny file needed)
  await build(async (c) => {
    await c.user.query(
      `INSERT INTO dispute_cases (id, session_id, contract_id, client_user_id, pt_user_id, type, created_by, updated_at) VALUES ($1, 'se-ct-mixed', 'ct-mixed', $2, $3, (enum_range(NULL::"DisputeCaseType"))[1], $2, now())`,
      [crypto.randomUUID(), F.ID.keepB, F.ID.del1],
    );
  });
  s = audited('d3e', { deny: null });
  m = readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
  const kinds = (m.blockers.disputeDependencies || []).map((b) => `${b.table}.${b.column}`);
  assert.ok(kinds.includes('dispute_cases.pt_user_id'), `account that would be deleted: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('dispute_cases.contract_id'), `contract that would be deleted: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('dispute_cases.session_id'), `session that would be deleted: ${JSON.stringify(kinds)}`);
});

test('D4 full pipeline: the denied gym of a preserved owner is really deleted with its children; owner, other gyms, kept packages, dispute rows survive; recheck catches a new match', async () => {
  await build(async (c) => {
    const caseId = crypto.randomUUID();
    await c.user.query(
      `INSERT INTO dispute_cases (id, session_id, contract_id, client_user_id, pt_user_id, type, created_by, updated_at) VALUES ($1, 'se-ct-keep', 'ct-keep', $2, $3, (enum_range(NULL::"DisputeCaseType"))[1], $2, now())`,
      [caseId, F.ID.keepA, F.ID.keepB],
    );
    await c.user.query(`INSERT INTO dispute_case_events (id, case_id, actor_user_id, actor_role, action) VALUES ($1, $2, $3, 'CLIENT', 'OPENED')`, [crypto.randomUUID(), caseId, F.ID.keepA]);
  });
  const s = finish(audited('d4'));
  const disputeBefore = JSON.stringify([await q(F.db('user'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM dispute_cases t`), await q(F.db('user'), `SELECT count(*) FROM dispute_case_events`)]);
  const gymKeepBefore = JSON.stringify(await q(F.db('gym'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM gyms t WHERE id IN ('gy-keep','gy-lower')`));
  // a NEW row that matches a deny pattern after the audit -> recheck must stop
  const gc = await F.client(F.db('gym'));
  await F.ins(gc, 'gyms', { id: 'gy-late', owner_id: F.ID.keepA, name: 'E2E late branch', brand_id: 'br-keep' });
  await gc.end();
  const rc = cli(['audit', '--recheck', '--env', 'test', ...s.M]);
  assert.equal(rc.code, 1, rc.text);
  assert.match(rc.text, /deny gymIds differ/);
  const gc2 = await F.client(F.db('gym'));
  await gc2.query(`DELETE FROM gyms WHERE id = 'gy-late'`);
  await gc2.end();
  const rc2 = cli(['audit', '--recheck', '--env', 'test', ...s.M]);
  assert.equal(rc2.code, 0, rc2.text);

  const run = (name, extra = []) => cli([name, ...s.R, ...s.M, ...extra]);
  for (const [name, extra] of [['freeze', []], ['backup', []], ['clean', ['--apply']], ['verify', []]]) {
    const r = run(name, extra);
    assert.equal(r.code, 0, `${name}: ${r.text}`);
  }
  const u = cli(['unfreeze', ...s.R]);
  assert.equal(u.code, 0, u.text);
  assert.equal(hbaSha(), ORIG_HBA_SHA);

  assert.deepEqual(await ids('gym', 'gyms'), ['gy-keep', 'gy-lower'], 'only the denied gym and the deleted accounts gyms are gone');
  assert.deepEqual(await ids('gym', 'gym_brands'), ['br-keep']);
  assert.deepEqual(await ids('gym', 'gym_photos'), ['ph-keep']);
  assert.deepEqual(await ids('gym', 'gym_membership_contracts'), ['mc-keep']);
  assert.deepEqual(await ids('gym', 'amenities'), ['am-1', 'am-2', 'am-lower']);
  assert.deepEqual(await ids('gym', 'amenity_proposals'), ['pr-real']);
  assert.deepEqual(await ids('gym', 'amenity_audit_logs'), ['aal-keep']);
  assert.deepEqual((await q(F.db('gym'), `SELECT gym_id || '/' || amenity_id AS k FROM gym_amenities ORDER BY 1`)).map((r) => r.k), ['gy-keep/am-1', 'gy-keep/am-2']);
  assert.deepEqual(await ids('user', 'pt_service_packages'), ['pk-e2e-used', 'pk-keep']);
  assert.deepEqual((await q(F.db('auth'), `SELECT email FROM users ORDER BY 1`)).map((r) => r.email), ALLOW.slice().sort());
  assert.equal(JSON.stringify(await q(F.db('gym'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM gyms t WHERE id IN ('gy-keep','gy-lower')`)), gymKeepBefore, 'kept gyms byte-identical');
  assert.equal(JSON.stringify([await q(F.db('user'), `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM dispute_cases t`), await q(F.db('user'), `SELECT count(*) FROM dispute_case_events`)]), disputeBefore, 'dispute tables untouched');
  assert.equal((await q(F.db('gym'), `SELECT count(*)::int AS n FROM gym_brands`))[0].n, 1);
});

test('D5 deny report + wallet proof are in the audit metadata', async () => {
  await build();
  const s = finish(audited('d5'));
  const md = s.metadata;
  assert.equal(md.deny.counts.gyms, 1);
  assert.equal(md.deny.names.gyms[0].name, 'E2E Branch 1');
  assert.equal(md.deny.keptDespiteDeny[0].id, 'pk-e2e-used');
  assert.ok(Array.isArray(md.walletImpact.involvedKeptWallets));
  assert.ok(md.walletImpact.involvedKeptWallets.every((w) => w.ledgerEntriesDeleted === 0 && JSON.stringify(w.before) === JSON.stringify(w.after)));
  // mixed transaction of the standard fixture: tx-pinned is kept by a surviving ledger entry, tx-del goes with its deleted payer
  assert.equal(md.walletImpact.deletedTransactions, 1);
});

// =====================================================================================================================
// D6+ : wallet acknowledgement and explicit (non-E2E-named) ids
const CAT = async (c) => (await c.gym.query(`SELECT (enum_range(NULL::"AmenityCategory"))[1] AS v`)).rows[0].v;
const manifestOf = (s) => readJ(path.join(s.d, 'cleanup-manifest.candidate.json'));
const ACK = (over = {}) => ({ walletId: 'w-gym-e2e', gymId: 'gy-e2e', availableVnd: 5000, ...over });
const withMoney = async (c) => {
  await c.payment.query(`UPDATE wallets SET available_balance = 5000 WHERE id = 'w-gym-e2e'`);
};

test('D6 wallet acknowledgement: waived ONLY with exact wallet id + gym id + amount; anything else still blocks; token covers the list', async () => {
  await build(withMoney);
  const blockedBy = (m) => m.blockers.deniedGymLiveRefs?.some((b) => b.table === 'wallets');
  // no acknowledgement -> blocked
  assert.ok(blockedBy(manifestOf(audited('d6a'))));
  // exact -> waived, no blockers, the waiver is recorded in the metadata
  const ok = audited('d6b', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK()] } });
  assert.equal(ok.a.code, 0, ok.a.text);
  const mOk = manifestOf(ok);
  assert.equal(Object.keys(mOk.blockers).length, 0, JSON.stringify(mOk.blockers));
  assert.deepEqual(mOk.deny.patterns.acknowledgedWalletsWithMoney, [ACK()], 'the acknowledgement is stored in the manifest');
  const meta = readJ(path.join(ok.d, 'cleanup-manifest.candidate.metadata.json'));
  assert.equal(meta.deny.guardInfo.waivedWalletsWithMoney[0].walletId, 'w-gym-e2e');
  // a different amount / wallet id / gym id -> still blocked
  for (const bad of [{ availableVnd: 4999 }, { availableVnd: 5001 }, { walletId: 'w-other' }, { gymId: 'gy-lower' }]) {
    const s = audited('d6c', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK(bad)] } });
    assert.equal(s.a.code, 0, s.a.text);
    assert.ok(blockedBy(manifestOf(s)), `still blocked with ${JSON.stringify(bad)}`);
  }
  // pending money on top of the acknowledged available amount -> blocked
  await build(async (c) => {
    await c.payment.query(`UPDATE wallets SET available_balance = 5000, pending_balance = 1 WHERE id = 'w-gym-e2e'`);
  });
  assert.ok(blockedBy(manifestOf(audited('d6d', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK()] } }))));
  // another wallet with money is not covered by an acknowledgement of a different wallet
  await build(async (c) => {
    await withMoney(c);
    await F.ins(c.gym, 'gyms', { id: 'gy-e2e2', owner_id: F.ID.keepA, name: 'E2E Branch 2', brand_id: 'br-keep' });
    await F.ins(c.payment, 'wallets', { id: 'w-gym-e2e2', owner_type: 'GYM', owner_id: 'gy-e2e2', available_balance: 7 });
  });
  const two = manifestOf(audited('d6e', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK()] } }));
  const blockedWallets = two.blockers.deniedGymLiveRefs.flatMap((b) => b.wallets || []).map((w) => w.walletId);
  assert.deepEqual(blockedWallets, ['w-gym-e2e2']);
  // malformed acknowledgements are refused outright
  for (const bad of [[{ walletId: 'w', gymId: 'g' }], [{ walletId: 'w', gymId: 'g', availableVnd: 0 }], [{ walletId: 'w', gymId: 'g', availableVnd: 5, extra: 1 }], 'x']) {
    assert.throws(() => validatePatterns({ acknowledgedWalletsWithMoney: bad }), /acknowledgedWalletsWithMoney/);
  }
  // token covers the list: with / without the acknowledgement -> different tokens; same content -> same token
  await build(withMoney);
  const withAck = finish(audited('d6f', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK()] } })).T;
  assert.equal(finish(audited('d6g', { deny: { ...DENY, acknowledgedWalletsWithMoney: [ACK()], explicitAmenities: [] } })).T, withAck, 'same content -> same token');
});

async function buildExplicit(extra) {
  await build(async (c) => {
    const cat = await CAT(c);
    await F.ins(c.gym, 'amenities', { id: 'am-x', slug: 'legacy-x', name: 'Legacy sauna', name_normalized: 'legacy sauna' });
    await F.ins(c.gym, 'amenity_proposals', { id: 'pr-x', owner_user_id: F.ID.keepA, gym_id: 'gy-e2e', name: 'Legacy sauna', name_normalized: 'legacy sauna', suggested_category: cat, status: 'APPROVED', resulting_amenity_id: 'am-x' });
    await c.gym.query(`UPDATE amenities SET created_from_proposal_id = 'pr-x' WHERE id = 'am-x'`);
    await F.ins(c.gym, 'gym_amenities', { gym_id: 'gy-e2e', amenity_id: 'am-x' });
    if (extra) await extra(c);
  });
}
const EXPL = { explicitProposals: [{ id: 'pr-x', expectedName: 'Legacy sauna' }], explicitAmenities: [{ id: 'am-x', expectedName: 'Legacy sauna' }] };

test('D7 explicit ids: validated (exist + expected name), deleted with their dependents; wrong name / unknown id refused; token covers the lists', async () => {
  await buildExplicit();
  // without the explicit lists the non-E2E proposal is a foreign-key conflict (kept proposal of a deleted gym) - the situation they solve
  const without = manifestOf(audited('d7a'));
  assert.ok(without.blockers.foreignKeyConflicts?.some((c) => c.child === 'amenity_proposals' && c.parent === 'gyms'), JSON.stringify(without.blockers));
  // with them: no blockers, ids expanded, rows selected
  const s = finish(audited('d7b', { deny: { ...DENY, ...EXPL } }));
  assert.equal(Object.keys(s.manifest.blockers).length, 0, JSON.stringify(s.manifest.blockers));
  assert.ok(s.manifest.deny.amenityIds.includes('am-x') && s.manifest.deny.proposalIds.includes('pr-x'));
  assert.deepEqual(s.manifest.deny.patterns.explicitAmenities, EXPL.explicitAmenities);
  assert.ok(keysOf(s.manifest, 'gym', 'amenities').includes('am-x'));
  assert.ok(keysOf(s.manifest, 'gym', 'amenity_proposals').includes('pr-x'));
  assert.ok(!keysOf(s.manifest, 'gym', 'amenities').includes('am-1'), 'nothing else leaks in');
  // wrong expected name / unknown id / bad shape -> the audit is refused, no manifest written
  for (const [bad, re] of [
    [{ explicitAmenities: [{ id: 'am-x', expectedName: 'Something else' }] }, /expected "Something else"/],
    [{ explicitProposals: [{ id: 'pr-nope', expectedName: 'Legacy sauna' }] }, /does not exist/],
    [{ explicitAmenities: [{ id: 'am-1' }] }, /exactly \{id, expectedName\}/],
  ]) {
    const r = audited('d7c', { deny: { ...DENY, ...bad } });
    assert.equal(r.a.code, 1, r.a.text);
    assert.match(r.a.text, re);
    assert.ok(!fs.existsSync(path.join(r.d, 'cleanup-manifest.candidate.json')));
  }
  // token changes when the explicit lists change
  const only = finish(audited('d7d', { deny: { ...DENY, explicitAmenities: EXPL.explicitAmenities } }));
  assert.notEqual(only.T, s.T);
  assert.equal(finish(audited('d7e', { deny: { ...DENY, ...EXPL } })).T, s.T, 'same input -> same token');
});

test('D8 explicit amenity used by a SURVIVING gym (gym_amenities, or an open revision payload) blocks and names it', async () => {
  await buildExplicit(async (c) => {
    await F.ins(c.gym, 'gym_amenities', { gym_id: 'gy-keep', amenity_id: 'am-x' });
  });
  let m = manifestOf(audited('d8a', { deny: { ...DENY, ...EXPL } }));
  assert.ok(m.blockers.explicitAmenityInUse?.some((x) => x.amenityId === 'am-x' && x.gymId === 'gy-keep' && x.via === 'gym_amenities'), JSON.stringify(m.blockers));
  // an open DRAFT revision of a surviving gym that lists the amenity
  await buildExplicit(async (c) => {
    await F.ins(c.gym, 'gym_listing_revisions', { id: 'rv-keep', gym_id: 'gy-keep', status: 'DRAFT', base_version: 1, payload: JSON.stringify({ amenityIds: ['am-x'] }) });
  });
  m = manifestOf(audited('d8b', { deny: { ...DENY, ...EXPL } }));
  assert.ok(m.blockers.explicitAmenityInUse?.some((x) => x.revisionId === 'rv-keep' && x.via === 'revision payload'), JSON.stringify(m.blockers));
  // used only by the denied gym itself -> fine
  await buildExplicit();
  assert.equal(Object.keys(manifestOf(audited('d8c', { deny: { ...DENY, ...EXPL } })).blockers).length, 0);
});

test('D9 user-service audit_logs: SYSTEM rows about a KEPT contract are kept, about a deleted contract are deleted; actor rows unchanged', async () => {
  await build(async (c) => {
    const log = (id, actor, entity) => F.ins(c.user, 'audit_logs', { id, actor_user_id: actor, action: 'CONTRACT_CANCELLED', entity_type: 'CONTRACT', entity_id: entity });
    await log('al-sys-keep', 'SYSTEM', 'ct-keep');
    await log('al-sys-del', 'SYSTEM', 'ct-del');
    await log('al-sys-mixed', 'SYSTEM', 'ct-mixed');
    await log('al-actor-keep', F.ID.keepA, 'ct-keep');
    await log('al-actor-del', F.ID.del1, 'ct-keep');
    await F.ins(c.user, 'audit_logs', { id: 'al-sys-other', actor_user_id: 'SYSTEM', action: 'X', entity_type: 'SESSION', entity_id: 'se-ct-keep' });
  });
  const m = manifestOf(audited('d9', { deny: null }));
  assert.deepEqual(keysOf(m, 'user', 'audit_logs'), ['al-actor-del', 'al-sys-del', 'al-sys-mixed', 'al-sys-other']);
});
