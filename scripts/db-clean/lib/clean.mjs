/**
 * db-clean - H2 `clean --apply` / `clean --resume` and H3 `verify` (plan 12.13 item 7, 12.14 item 5, 12.15 item 2).
 *
 * One transaction per database, in the order chat -> ai -> fitness -> payment -> gym -> user -> auth. Inside the transaction:
 *   1. rebuild everything from the live database and compare with the APPROVED manifest (real primary keys, tuple sets element by
 *      element, rowHash of every kept row) - any difference: ROLLBACK, FAILED, stop;
 *   2. DELETE by the real primary key (single column: = ANY; composite: the whole tuple via unnest), 5,000 tuples per batch, RETURNING;
 *   3. before COMMIT: the tuples actually removed == the manifest keys (element by element), every table lost exactly what was
 *      planned (a cascade would show up here), a second evaluation finds nothing left to delete and every kept row hashes as approved.
 * A failure stops the run. It is never retried and never continues on its own; `--resume` is an explicit instruction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Refused, writeJsonAtomic, readJson, nowIso, fingerprintOf, diffTuples, sha256Hex } from './util.mjs';
import { SERVICES, CLEAN_ORDER } from './config.mjs';
import { PsqlDb } from './db.mjs';
import { openMaint, verifyFence, readState, stateFile, collectStats } from './fence.mjs';
import { analyzeDb, compareWithManifest, deleteKeys, allTableCounts } from './engine.mjs';
import { deleteOrder, loadSchema } from './schema.mjs';
import { computeScriptVersion, staticChecks, confirmTokenOf } from './manifest.mjs';
import { recheck } from './audit.mjs';
import { loadBackupSet } from './backup.mjs';

export const progressFile = (runDir) => path.join(runDir, 'cleanup-progress.json');
export const paramsOfManifest = (m) => ({ userIds: m.allowlist.users.map((u) => u.userId).sort(), emails: m.allowlist.emails, keptGymIds: m.allowlist.keptGymIds });

function sumCounts(c) {
  return Object.values(c).reduce((a, b) => a + b, 0);
}

async function runHook(ctx, svc, when) {
  if (ctx.profile.name !== 'test' || !process.env.DBCLEAN_TEST_HOOK) return;
  const h = JSON.parse(process.env.DBCLEAN_TEST_HOOK);
  if (h.svc !== svc || h.when !== when) return;
  const m = await new PsqlDb({ container: ctx.profile.container, user: 'gymini_maintenance', password: process.env.DBCLEAN_MAINT_PASSWORD, database: ctx.profile.dbName(svc) }).connect();
  try {
    await m.exec(h.sql);
  } finally {
    await m.close();
  }
}

/** Run one database inside ONE transaction. Throws on any difference (the caller rolls back). */
async function cleanOneDb(ctx, svc, manifest, maintPassword, progressEntry) {
  const datname = ctx.profile.dbName(svc);
  const params = paramsOfManifest(manifest);
  const mTables = manifest.tables.filter((t) => t.db === datname);
  const mPres = (manifest.allowlist.preservedRows || []).filter((t) => t.db === datname);
  const db = await openMaint(ctx.profile, maintPassword, datname);
  try {
    await db.exec('BEGIN');
    await db.exec("SET LOCAL lock_timeout = '20s'");
    await db.exec('SET LOCAL statement_timeout = 0');
    try {
      // 1. rebuild + compare (steps 4, 5, 6)
      const a1 = await analyzeDb(db, svc, params, { policy: ctx.policy, mode: 'full' });
      const problems = compareWithManifest(a1, mTables, mPres);
      if (a1.unclassified.length) problems.push(`unclassified tables: ${a1.unclassified.join(', ')}`);
      if (a1.noPk.length) problems.push(`tables without a primary key: ${a1.noPk.join(', ')}`);
      if (a1.conflicts.length) problems.push(`foreign-key conflicts: ${JSON.stringify(a1.conflicts)}`);
      if (a1.cycle) problems.push(`foreign-key cycle: ${a1.cycle.join(' -> ')}`);
      if (problems.length) throw new Refused(`${datname}: the live data no longer matches the approved manifest:\n  - ${problems.join('\n  - ')}`, 'MANIFEST_MISMATCH');
      const before = await allTableCounts(db);
      progressEntry.rowsBefore = before;
      await runHook(ctx, svc, 'after-verify');
      // 2. delete, children first
      const keysByTable = new Map(mTables.map((t) => [`${t.schema}.${t.table}`, t]));
      const ord = deleteOrder([...keysByTable.keys()], (await loadSchema(db)).fks);
      if (!ord.order) throw new Refused(`${datname}: foreign-key cycle ${ord.cycle.join(' -> ')}`, 'FK_CYCLE');
      const deleted = {};
      for (const key of ord.order) {
        const t = keysByTable.get(key);
        const removed = await deleteKeys(db, t, t.keys);
        // 3a. what was removed must be exactly what was approved
        const diff = diffTuples(removed, t.keys);
        if (removed.length !== t.count || fingerprintOf(removed) !== t.fingerprint || diff.extra.length || diff.missing.length) {
          throw new Refused(`${datname}.${t.table}: removed ${removed.length} row(s) but the manifest approved ${t.count} (fingerprint ${fingerprintOf(removed)} vs ${t.fingerprint}); extra ${JSON.stringify(diff.extra.slice(0, 20))}, missing ${JSON.stringify(diff.missing.slice(0, 20))}`, 'DELETE_MISMATCH');
        }
        deleted[t.table] = removed.length;
      }
      // 3b. no table lost anything it was not supposed to lose (cascade / trigger would show here)
      const after = await allTableCounts(db);
      const wrong = Object.keys(before).filter((t) => after[t] !== before[t] - (deleted[t] || 0));
      if (wrong.length) throw new Refused(`${datname}: row counts after the delete are not before minus approved for: ${wrong.map((t) => `${t} ${before[t]}->${after[t]} (planned -${deleted[t] || 0})`).join(', ')}`, 'COUNT_MISMATCH');
      // 3c. a second evaluation: nothing left to delete, every kept row still hashes as approved
      const a2 = await analyzeDb(db, svc, params, { policy: ctx.policy, mode: 'full' });
      const left = a2.tables.filter((t) => t.count > 0).map((t) => `${t.table}:${t.count}`);
      if (left.length) throw new Refused(`${datname}: rows are still selected for deletion after the delete: ${left.join(', ')}`, 'LEFTOVER');
      const hp = compareWithManifest({ tables: [], preserved: a2.preserved }, [], mPres);
      if (hp.length) throw new Refused(`${datname}: kept rows changed during the cleanup:\n  - ${hp.join('\n  - ')}`, 'PRESERVED_CHANGED');
      await db.exec('COMMIT');
      progressEntry.rowsAfter = after;
      progressEntry.deleted = deleted;
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    await db.close();
  }
}

export async function clean(ctx, { runDir, manifest, token, maintPassword, resume = false }) {
  const profile = ctx.profile;
  const state = readState(runDir);
  if (!state || state.state !== 'FROZEN') throw new Refused('clean only runs while the fence is up (state FROZEN)', 'NOT_FROZEN');
  if (state.manifestToken !== token) throw new Refused('the freeze was made for a different manifest token - there is no way to run with another token', 'TOKEN_MISMATCH');
  // static checks again (token, consistency, scriptVersion)
  const problems = [];
  if (confirmTokenOf(manifest) !== token) problems.push('manifest does not hash to the approved token');
  problems.push(...staticChecks(manifest, computeScriptVersion(ctx.extraScriptFiles || [])));
  if (problems.length) throw new Refused(`clean refused, nothing was changed:\n  - ${problems.join('\n  - ')}`, 'CLEAN_CHECKS');
  const b = loadBackupSet(profile, runDir);
  if (b.manifestToken !== token) throw new Refused('the backup was taken for a different manifest token', 'TOKEN_MISMATCH');
  if (!b.restoreCheck?.ok) throw new Refused('the backup has no successful trial restore', 'NO_RESTORECHECK');

  let progress;
  if (fs.existsSync(progressFile(runDir))) {
    if (!resume) throw new Refused(`${progressFile(runDir)} exists: a cleanup was already started here. After a failure you choose: \`restore\`, or \`clean --resume\` (explicitly), never an implicit re-run`, 'ALREADY_STARTED');
    progress = readJson(progressFile(runDir));
    if (progress.token !== token) throw new Refused('the progress file belongs to a different token', 'TOKEN_MISMATCH');
  } else {
    if (resume) throw new Refused('nothing to resume: no cleanup-progress.json', 'NOTHING_TO_RESUME');
    progress = { token, backupId: b.backupId, startedAt: nowIso(), dbs: Object.fromEntries(manifest.parameters.cleanDbs.map((s) => [s, { state: 'PENDING', datname: profile.dbName(s) }])) };
  }
  const save = () => writeJsonAtomic(progressFile(runDir), progress);
  save();

  // preflight: fence still up; nothing written since the backup unless a run is being resumed
  await verifyFence(ctx, state, maintPassword);
  if (!Object.values(progress.dbs).some((d) => d.state === 'DONE')) {
    const now = await collectStats(ctx, maintPassword);
    if (JSON.stringify(now) !== JSON.stringify(state.t0)) throw new Refused(`write counters changed since the freeze: ${JSON.stringify(now)} vs ${JSON.stringify(state.t0)}`, 'T0_CHANGED');
  }
  // full recheck of the manifest against the live data, before the first DELETE (12.15 item 2 steps 4-7)
  const adminDbs = {};
  try {
    for (const svc of SERVICES) adminDbs[svc] = await openMaint(profile, maintPassword, profile.dbName(svc));
    const rc = await recheck({ ...ctx, dbs: adminDbs }, manifest, { checkSnapshots: false });
    const live = rc.problems.filter((p) => !progressTouched(progress, p));
    if (live.length) throw new Refused(`the live data does not match the approved manifest, nothing was deleted:\n  - ${live.join('\n  - ')}`, 'MANIFEST_MISMATCH');
  } finally {
    await Promise.all(Object.values(adminDbs).map((d) => d.close().catch(() => {})));
  }

  const order = CLEAN_ORDER.filter((s) => manifest.parameters.cleanDbs.includes(s));
  let failed = null;
  for (const svc of order) {
    const e = progress.dbs[svc];
    if (e.state === 'DONE') continue;
    e.state = 'RUNNING';
    e.startedAt = nowIso();
    delete e.error;
    save();
    ctx.log(`  cleaning ${profile.dbName(svc)} ...`);
    try {
      await cleanOneDb(ctx, svc, manifest, maintPassword, e);
      e.state = 'DONE';
      e.finishedAt = nowIso();
      save();
      ctx.log(`  ${profile.dbName(svc)} DONE (-${sumCounts(e.rowsBefore) - sumCounts(e.rowsAfter)} rows)`);
    } catch (err) {
      e.state = 'FAILED';
      e.error = String(err.message).slice(0, 4000);
      e.finishedAt = nowIso();
      save();
      failed = { svc, error: err };
      break; // stop immediately: never the next database, never a retry
    }
  }
  const summary = Object.fromEntries(Object.entries(progress.dbs).map(([k, v]) => [k, v.state]));
  progress.summary = summary;
  if (!failed && Object.values(summary).every((s) => s === 'DONE')) progress.completedAt = nowIso();
  save();
  return { progress, failed, summary };
}

/** On --resume a database that already ran cleanly differs from the manifest by design; we only recheck what is still pending. */
function progressTouched(progress, problem) {
  const m = /^\[([^\]]+)\]/.exec(problem);
  if (!m) return false;
  return Object.values(progress.dbs).some((d) => d.datname === m[1] && d.state === 'DONE');
}

/** H3. Still under the fence. */
export async function verifyClean(ctx, { runDir, manifest, token, maintPassword }) {
  const profile = ctx.profile;
  const state = readState(runDir);
  if (!state || state.state !== 'FROZEN') throw new Refused('verify runs while the fence is up', 'NOT_FROZEN');
  if (state.manifestToken !== token) throw new Refused('different token', 'TOKEN_MISMATCH');
  if (!fs.existsSync(progressFile(runDir))) throw new Refused('no cleanup-progress.json: nothing to verify', 'NO_PROGRESS');
  const progress = readJson(progressFile(runDir));
  const notDone = Object.entries(progress.dbs).filter(([, v]) => v.state !== 'DONE').map(([k, v]) => `${k}=${v.state}`);
  if (notDone.length) throw new Refused(`not every database is DONE (${notDone.join(', ')})`, 'NOT_DONE');
  await verifyFence(ctx, state, maintPassword);
  const b = loadBackupSet(profile, runDir);
  const report = {};
  const problems = [];
  for (const svc of CLEAN_ORDER) {
    const datname = profile.dbName(svc);
    const inScope = manifest.parameters.cleanDbs.includes(svc);
    const db = await openMaint(profile, maintPassword, datname);
    try {
      const counts = await allTableCounts(db);
      const entry = { datname, inScope, tables: Object.keys(counts).length, rowsNow: sumCounts(counts), rowsBackup: sumCounts(b.rowCounts[svc]) };
      if (!inScope) {
        const changed = Object.keys(b.rowCounts[svc]).filter((t) => counts[t] !== b.rowCounts[svc][t]);
        if (changed.length) problems.push(`${datname}: a database outside the cleanup changed (${changed.join(', ')})`);
        entry.unchanged = changed.length === 0;
        report[svc] = entry;
        continue;
      }
      const params = paramsOfManifest(manifest);
      const a = await analyzeDb(db, svc, params, { policy: ctx.policy, mode: 'full' });
      const left = a.tables.filter((t) => t.count > 0).map((t) => `${t.table}:${t.count}`);
      if (left.length) problems.push(`${datname}: rows still selected for deletion: ${left.join(', ')}`);
      const mPres = (manifest.allowlist.preservedRows || []).filter((t) => t.db === datname);
      for (const p of compareWithManifest({ tables: [], preserved: a.preserved }, [], mPres)) problems.push(`${datname}: ${p}`);
      // counts: now == after (progress), and PRESERVE tables untouched
      const e = progress.dbs[svc];
      const drift = Object.keys(e.rowsAfter).filter((t) => counts[t] !== e.rowsAfter[t]);
      if (drift.length) problems.push(`${datname}: row counts moved since the cleanup committed (${drift.join(', ')})`);
      const planned = new Map(manifest.tables.filter((t) => t.db === datname).map((t) => [t.table, t]));
      const tableReport = {};
      for (const t of Object.keys(counts)) {
        const wasN = b.rowCounts[svc][t];
        const del = planned.get(t)?.count || 0;
        tableReport[t] = { before: wasN, deleted: del, after: counts[t] };
        if (counts[t] !== wasN - del) problems.push(`${datname}.${t}: ${wasN} - ${del} != ${counts[t]}`);
      }
      entry.tableReport = tableReport;
      entry.preservedRowsChecked = a.preserved.reduce((n, p) => n + p.entries.length, 0);
      report[svc] = entry;
    } finally {
      await db.close();
    }
  }
  if (problems.length) {
    return { ok: false, problems, report };
  }
  state.verifyPassed = true;
  state.verifiedAt = nowIso();
  writeJsonAtomic(stateFile(runDir), state);
  return { ok: true, problems: [], report };
}
