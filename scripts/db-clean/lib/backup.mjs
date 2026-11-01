/**
 * db-clean - H1 `backup` and `restore` (plan 12.14 item 3, 12.16 H1-H3).
 *
 * Both run under the fence, as gymini_maintenance over the socket inside the container:
 *   backup   pg_dump -Fc of all seven databases inside ONE frozen window -> docker cp out -> size > 0, sha256, `pg_restore --list`,
 *            a trial restore of one database into a *_restorecheck database (row counts compared, database dropped again),
 *            write counters compared before / after (nothing may have been written).
 *   restore  all seven databases from ONE backup set; refuses a set without fence evidence, with a missing / altered / foreign
 *            file, or with a different environment. Row counts afterwards must equal the counts taken at backup time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Refused, sha256Hex, writeJsonAtomic, readJson, ensureDir, nowIso, fileSha256 } from './util.mjs';
import { SERVICES, MAINT_ROLE, CLEAN_ORDER } from './config.mjs';
import { docker, dockerExec } from './db.mjs';
import { openMaint, verifyFence, readState, stateFile, collectStats } from './fence.mjs';
import { allTableCounts } from './engine.mjs';

const mx = (profile, cmd, password, opts = {}) =>
  dockerExec(profile.container, cmd, { env: { PGPASSWORD: password, PGAPPNAME: 'gymini-db-clean' }, ...opts });
const sameStats = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export async function backup(ctx, { runDir, manifest, token, maintPassword }) {
  const profile = ctx.profile;
  const state = readState(runDir);
  if (!state || state.state !== 'FROZEN') throw new Refused('backup only runs while the fence is up (state FROZEN) - run `freeze` first', 'NOT_FROZEN');
  if (state.manifestToken !== token) throw new Refused('the freeze was made for a different manifest token', 'TOKEN_MISMATCH');
  const backupFile = path.join(runDir, 'backup-manifest.json');
  if (fs.existsSync(backupFile)) throw new Refused(`${backupFile} already exists - a backup set is never overwritten`, 'BACKUP_EXISTS');

  const before = await verifyFence(ctx, state, maintPassword);
  // nothing may have been written since the baseline taken at the end of `freeze`
  const statBefore = await collectStats(ctx, maintPassword);
  if (!sameStats(statBefore, state.t0)) {
    throw new Refused(`write counters changed between the freeze and the backup (n_tup_ins+upd+del):\n  freeze ${JSON.stringify(state.t0)}\n  now    ${JSON.stringify(statBefore)}\nsomething wrote while the fence was up - stopping`, 'T0_CHANGED');
  }
  // disk space
  const sizes = {};
  const m0 = await openMaint(profile, maintPassword, profile.dbName('auth'));
  try {
    for (const svc of SERVICES) sizes[svc] = Number(await m0.json(`SELECT to_json(pg_database_size('${profile.dbName(svc)}'))`));
  } finally {
    await m0.close();
  }
  const need = Object.values(sizes).reduce((a, b) => a + b, 0);
  const free = freeBytes(runDir);
  if (free !== null && free < need * 1.2) throw new Refused(`not enough disk space in ${runDir}: ${free} free, ~${Math.ceil(need * 1.2)} needed`, 'DISK');

  const backupId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${sha256Hex(`${Date.now()}${Math.random()}`).slice(0, 8)}`;
  const hostDir = ensureDir(path.join(runDir, 'dumps'));
  const ctrDir = `/tmp/dbclean-${backupId}`;
  const r0 = mx(profile, ['mkdir', '-p', ctrDir], maintPassword);
  if (r0.status !== 0) throw new Error(`cannot create ${ctrDir}: ${r0.stderr}`);
  const files = [];
  const rowCounts = {};
  try {
    for (const svc of CLEAN_ORDER) {
      const db = profile.dbName(svc);
      const ctrFile = `${ctrDir}/${db}.dump`;
      ctx.log(`  pg_dump -Fc ${db}`);
      const d = mx(profile, ['pg_dump', '-Fc', '-h', '/var/run/postgresql', '-U', MAINT_ROLE, '-f', ctrFile, db], maintPassword, { timeout: 3_600_000 });
      if (d.status !== 0) throw new Error(`pg_dump ${db} failed: ${d.stderr.trim()}`);
      const sz = mx(profile, ['stat', '-c', '%s', ctrFile], maintPassword);
      const bytes = Number(sz.stdout.trim());
      if (!(bytes > 0)) throw new Error(`${db}: dump is empty`);
      const lst = mx(profile, ['pg_restore', '--list', ctrFile], maintPassword);
      if (lst.status !== 0 || lst.stdout.trim().length === 0) throw new Error(`${db}: pg_restore --list failed: ${lst.stderr.trim()}`);
      const hostFile = path.join(hostDir, `${db}.dump`);
      const cp = docker(['cp', `${profile.container}:${ctrFile}`, hostFile]);
      if (cp.status !== 0) throw new Error(`docker cp ${db} failed: ${cp.stderr.trim()}`);
      const hbytes = fs.statSync(hostFile).size;
      if (hbytes !== bytes) throw new Error(`${db}: host copy is ${hbytes} bytes, container file ${bytes}`);
      const header = lst.stdout.split('\n').filter((l) => l.startsWith(';')).slice(0, 12).join('\n');
      files.push({ svc, db, file: path.relative(runDir, hostFile).split(path.sep).join('/'), bytes, sha256: fileSha256(hostFile), restoreListEntries: lst.stdout.split('\n').filter((l) => l && !l.startsWith(';')).length, archiveHeader: header });
      const m = await openMaint(profile, maintPassword, db);
      try {
        rowCounts[svc] = await allTableCounts(m);
      } finally {
        await m.close();
      }
    }
    // trial restore of ONE database into a scratch database
    const svc = 'auth';
    const db = profile.dbName(svc);
    const tmp = `${db}_restorecheck`;
    const admin = await openMaint(profile, maintPassword, 'postgres');
    let restoreCheck;
    try {
      await admin.exec(`DROP DATABASE IF EXISTS "${tmp}"`);
      await admin.exec(`CREATE DATABASE "${tmp}"`);
      const rr = mx(profile, ['pg_restore', '-h', '/var/run/postgresql', '-U', MAINT_ROLE, '-d', tmp, '--no-owner', '--no-privileges', '--exit-on-error', `${ctrDir}/${db}.dump`], maintPassword, { timeout: 3_600_000 });
      if (rr.status !== 0) throw new Error(`trial restore of ${db} into ${tmp} failed: ${rr.stderr.trim().slice(0, 400)}`);
      const mt = await openMaint(profile, maintPassword, tmp);
      let counts;
      try {
        counts = await allTableCounts(mt);
      } finally {
        await mt.close();
      }
      const bad = Object.keys(rowCounts[svc]).filter((t) => counts[t] !== rowCounts[svc][t]);
      if (bad.length) throw new Error(`trial restore row counts differ for: ${bad.join(', ')}`);
      restoreCheck = { svc, db, into: tmp, ok: true, tables: Object.keys(counts).length };
    } finally {
      await admin.exec(`DROP DATABASE IF EXISTS "${tmp}"`).catch(() => {});
      await admin.close();
    }
    const after = await verifyFence(ctx, state, maintPassword);
    const statAfter = await collectStats(ctx, maintPassword);
    if (!sameStats(statAfter, state.t0)) throw new Error(`write counters changed during the backup: ${JSON.stringify(statAfter)}`);
    const doc = {
      version: 1,
      backupId,
      createdAt: nowIso(),
      frozenAt: state.frozenAt,
      environment: { envName: profile.name, container: profile.container, dbs: SERVICES.map((s) => profile.dbName(s)).sort() },
      manifestToken: token,
      fenceEvidence: { before, after },
      writeCounters: { t0: state.t0, before: statBefore, after: statAfter },
      files,
      rowCounts,
      restoreCheck,
    };
    writeJsonAtomic(backupFile, doc);
    state.backupId = backupId;
    writeJsonAtomic(stateFile(runDir), state);
    return doc;
  } finally {
    mx(profile, ['rm', '-rf', ctrDir], maintPassword);
  }
}

/** Validate a backup set. Returns the parsed backup-manifest or throws Refused. */
export function loadBackupSet(profile, backupDir) {
  const mf = path.join(backupDir, 'backup-manifest.json');
  if (!fs.existsSync(mf)) throw new Refused(`no backup-manifest.json in ${backupDir}`, 'NO_BACKUP');
  const b = readJson(mf);
  const problems = [];
  if (!b.frozenAt || !b.fenceEvidence?.before?.at || !b.fenceEvidence?.after?.at) problems.push('the backup carries no valid fence evidence (taken without a frozen window)');
  if (b.environment?.envName !== profile.name || b.environment?.container !== profile.container) problems.push(`the backup is for ${b.environment?.envName}/${b.environment?.container}, this run is ${profile.name}/${profile.container}`);
  const expect = SERVICES.map((s) => profile.dbName(s)).sort();
  if (JSON.stringify([...(b.environment?.dbs || [])].sort()) !== JSON.stringify(expect)) problems.push('the backup does not list exactly the seven expected databases');
  if (!Array.isArray(b.files) || b.files.length !== 7) problems.push(`the backup lists ${b.files?.length ?? 0} files, 7 are needed (all seven databases come from ONE set)`);
  for (const f of b.files || []) {
    const p = path.join(backupDir, f.file);
    if (!fs.existsSync(p)) {
      problems.push(`${f.db}: dump file missing`);
      continue;
    }
    if (fs.statSync(p).size !== f.bytes) problems.push(`${f.db}: size differs from the manifest`);
    else if (fileSha256(p) !== f.sha256) problems.push(`${f.db}: sha256 differs from the manifest (a file from another set, or damaged)`);
  }
  if (!b.backupId) problems.push('no backupId');
  if (problems.length) throw new Refused(`backup set refused:\n  - ${problems.join('\n  - ')}`, 'BACKUP_REFUSED');
  return b;
}

export async function restore(ctx, { runDir, backupDir, maintPassword }) {
  const profile = ctx.profile;
  const state = readState(runDir);
  if (!state || state.state !== 'FROZEN') throw new Refused('restore runs under the fence (state FROZEN) - run `freeze` first', 'NOT_FROZEN');
  const b = loadBackupSet(profile, backupDir || runDir);
  const bdir = backupDir || runDir;
  await verifyFence(ctx, state, maintPassword);
  const ctrDir = `/tmp/dbclean-restore-${b.backupId}`;
  const r0 = mx(profile, ['mkdir', '-p', ctrDir], maintPassword);
  if (r0.status !== 0) throw new Error(`cannot create ${ctrDir}: ${r0.stderr}`);
  const results = {};
  try {
    for (const svc of CLEAN_ORDER) {
      const f = b.files.find((x) => x.svc === svc);
      const ctrFile = `${ctrDir}/${f.db}.dump`;
      const cp = docker(['cp', path.join(bdir, f.file), `${profile.container}:${ctrFile}`]);
      if (cp.status !== 0) throw new Error(`docker cp into container failed for ${f.db}: ${cp.stderr.trim()}`);
      ctx.log(`  pg_restore ${f.db}`);
      const rr = mx(profile, ['pg_restore', '-h', '/var/run/postgresql', '-U', MAINT_ROLE, '-d', f.db, '--clean', '--if-exists', '--single-transaction', '--exit-on-error', ctrFile], maintPassword, { timeout: 3_600_000 });
      if (rr.status !== 0) throw new Error(`pg_restore ${f.db} failed: ${rr.stderr.trim().slice(0, 500)}`);
      const m = await openMaint(profile, maintPassword, f.db);
      try {
        const counts = await allTableCounts(m);
        const bad = Object.keys(b.rowCounts[svc]).filter((t) => counts[t] !== b.rowCounts[svc][t]);
        const extra = Object.keys(counts).filter((t) => !(t in b.rowCounts[svc]));
        if (bad.length || extra.length) throw new Error(`${f.db}: row counts after restore differ from the backup (${[...bad, ...extra].join(', ')})`);
        results[svc] = { db: f.db, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, c) => a + c, 0) };
      } finally {
        await m.close();
      }
    }
  } finally {
    mx(profile, ['rm', '-rf', ctrDir], maintPassword);
  }
  state.restoreDone = true;
  state.restoredFrom = b.backupId;
  state.restoredAt = nowIso();
  writeJsonAtomic(stateFile(runDir), state);
  return { backupId: b.backupId, results };
}
