/**
 * db-clean - the pg_hba fence + temporary superuser (plan 12.15 item 1, 12.16 - the single definition for H0, H4 and recovery).
 *
 *   freeze    H0   nine ordered steps, each recorded in freeze-state.json
 *   unfreeze  H4   restore the approved pg_hba, check the app role reconnects, check ACL/roles unchanged, drop the maintenance role
 *   recover        the manual runbook as a command (docker exec -u postgres ... pg_ctl reload), then H4 step 5
 *   status         read only
 *
 * Every administrative statement after the fence goes in as gymini_maintenance over the Unix socket INSIDE the container
 * (PsqlDb). The root of recovery is always the OS user `postgres` in the container: it can edit pg_hba.conf and run pg_ctl reload
 * without logging in to the database, so the fence can never lock the recovery path out.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { Refused, sha256Hex, writeJsonAtomic, readJson, ensureDir, nowIso, sleep, fileSha256 } from './util.mjs';
import { SERVICES, MAINT_ROLE, MAINT_APP_NAME } from './config.mjs';
import { PsqlDb, TcpDb, docker, dockerExec, containerRunning, containerExists } from './db.mjs';
import { readHba, readAclAndRoles, diffAcl, normalizeHbaRules } from './schema.mjs';
import { pgStat, environmentSnapshot, environmentProblems, recheck } from './audit.mjs';
import { openMany, closeMany, tcpFactory } from './db.mjs';
import { staticChecks, confirmTokenOf, computeScriptVersion } from './manifest.mjs';

export const FENCE_LINES = [
  'local  all  gymini_maintenance  scram-sha-256',
  'local  all  all                 reject',
  'host   all  all  0.0.0.0/0      reject',
  'host   all  all  ::/0           reject',
];
export const FENCE_TEXT = `${FENCE_LINES.join('\n')}\n`;
const MAINT_LINE = 'local  all  gymini_maintenance  scram-sha-256';
const EXPECTED_FENCE_RULES = [
  { type: 'local', database: ['all'], user: [MAINT_ROLE], address: null, method: 'scram-sha-256' },
  { type: 'local', database: ['all'], user: ['all'], address: null, method: 'reject' },
  { type: 'host', database: ['all'], user: ['all'], address: '0.0.0.0', method: 'reject' },
  { type: 'host', database: ['all'], user: ['all'], address: '::', method: 'reject' },
];

export const stateFile = (runDir) => path.join(runDir, 'freeze-state.json');
export const readState = (runDir) => (fs.existsSync(stateFile(runDir)) ? readJson(stateFile(runDir)) : null);

// ------------------------------------------------------------------ container file helpers (always as the OS user postgres)
const asPg = (profile, cmd, opts = {}) => dockerExec(profile.container, cmd, { user: 'postgres', ...opts });
export function readContainerFile(profile, p) {
  const r = asPg(profile, ['cat', p]);
  if (r.status !== 0) throw new Error(`cannot read ${p} in ${profile.container}: ${r.stderr.trim()}`);
  return r.stdout;
}
export function writeContainerFileAtomic(profile, p, content) {
  const tmp = `${p}.dbclean-tmp`;
  const r = asPg(profile, ['sh', '-c', `cat > '${tmp}' && chmod 600 '${tmp}' && mv -f '${tmp}' '${p}'`], { input: content });
  if (r.status !== 0) throw new Error(`cannot write ${p}: ${r.stderr.trim()}`);
}
export function copyContainerFileAtomic(profile, src, dst) {
  const r = asPg(profile, ['sh', '-c', `cp '${src}' '${dst}.dbclean-tmp' && chmod 600 '${dst}.dbclean-tmp' && mv -f '${dst}.dbclean-tmp' '${dst}'`]);
  if (r.status !== 0) throw new Error(`cannot copy ${src} -> ${dst}: ${r.stderr.trim()}`);
}
export function sha256Container(profile, p) {
  const r = asPg(profile, ['sha256sum', p]);
  if (r.status !== 0) throw new Error(`cannot hash ${p}: ${r.stderr.trim()}`);
  return r.stdout.trim().split(/\s+/)[0];
}
export function reloadContainer(profile) {
  const r = asPg(profile, ['sh', '-c', 'pg_ctl reload -D "$PGDATA"']);
  if (r.status !== 0) throw new Error(`pg_ctl reload failed: ${r.stderr.trim()}`);
}
export function pgdataOf(profile) {
  const r = dockerExec(profile.container, ['sh', '-c', 'printf %s "$PGDATA"']);
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`cannot read PGDATA of ${profile.container}`);
  return r.stdout.trim();
}
export const hbaPathOf = (profile) => `${pgdataOf(profile)}/pg_hba.conf`;
const origCopyPath = (hba) => `${hba}.dbclean-orig`;
const fenceStagePath = (hba) => `${hba}.dbclean-fence`;

// ------------------------------------------------------------------ connection probes
function rejectedMessage(err) {
  return /pg_hba\.conf rejects connection/.test(String(err && err.message ? err.message : err));
}
/** TCP exactly like the application connects. Returns { ok, rejected, message }. */
export async function tcpProbe(profile, user, password, database) {
  const c = new pg.Client({ host: profile.host, port: profile.port, user, password, database, connectionTimeoutMillis: 6000, application_name: 'dbclean-probe' });
  try {
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return { ok: true, rejected: false, message: '' };
  } catch (e) {
    await c.end().catch(() => {});
    return { ok: false, rejected: rejectedMessage(e), message: String(e.message).slice(0, 200) };
  }
}
/** Unix socket inside the container (psql). */
export function socketProbe(profile, user, password, database) {
  const r = docker(['exec', '-e', 'PGPASSWORD', profile.container, 'psql', '-X', '-q', '-A', '-t', '-h', '/var/run/postgresql', '-U', user, '-d', database, '-c', 'SELECT 1'], { env: { PGPASSWORD: password || 'x' } });
  const ok = r.status === 0;
  return { ok, rejected: !ok && rejectedMessage(r.stderr), message: r.stderr.trim().slice(0, 200) };
}

export async function openMaint(profile, password, database) {
  return new PsqlDb({ container: profile.container, user: MAINT_ROLE, password, database }).connect();
}
async function openApp(profile, database) {
  // The app superuser through the socket (for steps before the fence is up / during recovery).
  return new PsqlDb({ container: profile.container, user: profile.appUser, password: profile.appPassword, database }).connect();
}

/** Plan 12.16 H0 step 8 (a)(b)(c)(d)(e) - real connections. Throws Refused when the fence does not hold. */
export async function verifyFence(ctx, state, maintPassword, { retries = 12 } = {}) {
  const profile = ctx.profile;
  const dbNames = SERVICES.map((s) => profile.dbName(s));
  const otherLogins = (state.aclSnapshot?.roles || []).filter((r) => r.rolcanlogin && r.rolname !== profile.appUser && r.rolname !== MAINT_ROLE).map((r) => r.rolname);
  let last = null;
  for (let i = 0; i < retries; i++) {
    last = { tcp: {}, socket: {}, others: {}, sessions: null, maintDbs: [] };
    let bad = null;
    for (const d of dbNames) {
      const t = await tcpProbe(profile, profile.appUser, profile.appPassword, d);
      last.tcp[d] = t.rejected ? 'rejected' : t.ok ? 'CONNECTED' : `other: ${t.message}`;
      if (!t.rejected) bad = `(a) app role ${profile.appUser} over TCP is not rejected for ${d}: ${t.message || 'connected'}`;
    }
    const s = socketProbe(profile, profile.appUser, profile.appPassword, dbNames[0]);
    last.socket[profile.appUser] = s.rejected ? 'rejected' : s.ok ? 'CONNECTED' : `other: ${s.message}`;
    if (!s.rejected) bad = bad || `(b) app role ${profile.appUser} over the socket is not rejected: ${s.message || 'connected'}`;
    for (const r of otherLogins) {
      const p = socketProbe(profile, r, 'x', dbNames[0]);
      last.others[r] = p.rejected ? 'rejected' : p.ok ? 'CONNECTED' : `other: ${p.message}`;
      if (!p.rejected) bad = bad || `(c) login role ${r} is not rejected: ${p.message || 'connected'}`;
    }
    if (!bad) {
      let m = null;
      try {
        m = await openMaint(profile, maintPassword, dbNames[0]);
        last.sessions = await m.json(
          `SELECT COALESCE(json_agg(json_build_object('user', usename, 'app', application_name, 'type', backend_type)), '[]'::json)
             FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid() AND datname IS NOT NULL`,
        );
        const strangers = last.sessions.filter((x) => x.user !== MAINT_ROLE);
        if (strangers.length) bad = `(d) foreign sessions are connected: ${JSON.stringify(strangers)}`;
      } catch (e) {
        bad = `(d) cannot inspect pg_stat_activity as ${MAINT_ROLE}: ${e.message}`;
      } finally {
        if (m) await m.close();
      }
    }
    if (!bad) {
      for (const d of dbNames) {
        let m;
        try {
          m = await openMaint(profile, maintPassword, d);
          const su = await m.json('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
          last.maintDbs.push({ db: d, superuser: su === true || su === 't' });
          if (!(su === true || su === 't')) bad = `(e) ${MAINT_ROLE} is not a superuser in ${d}`;
        } catch (e) {
          bad = `(e) ${MAINT_ROLE} cannot enter ${d}: ${e.message}`;
        } finally {
          if (m) await m.close();
        }
        if (bad) break;
      }
    }
    if (!bad) return { at: nowIso(), ...last };
    if (i === retries - 1) throw new Refused(`the fence does not hold: ${bad}`, 'FENCE_BROKEN');
    await sleep(700);
  }
  throw new Refused('unreachable', 'FENCE_BROKEN');
}

// ------------------------------------------------------------------ H0 - freeze
function stepRecorder(ctx, runDir, state) {
  return (n, label, extra = {}) => {
    state.steps[n] = { label, at: nowIso(), ok: true, ...extra };
    state.lastStep = n;
    writeJsonAtomic(stateFile(runDir), state);
    ctx.log(`  H0 step ${n}: ${label}`);
    if (ctx.profile.name === 'test' && String(process.env.DBCLEAN_TEST_DIE_AFTER_STEP || '') === String(n)) {
      ctx.log(`  (test hook) simulating a crash after step ${n}`);
      process.exit(137);
    }
  };
}

function dropMaintRoleViaApp(ctx) {
  /* best effort cleanup helper used by failure paths - returns a promise */
  return (async () => {
    let a;
    try {
      a = await openApp(ctx.profile, ctx.profile.dbName('auth'));
      await a.exec(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${MAINT_ROLE}' AND pid <> pg_backend_pid()`);
      await a.exec(`DROP ROLE IF EXISTS ${MAINT_ROLE}`);
    } catch (e) {
      ctx.log(`  (cleanup) could not drop ${MAINT_ROLE} via the app role: ${e.message}`);
    } finally {
      if (a) await a.close();
    }
  })();
}

export async function freeze(ctx, { manifest, token, runDir, maintPassword }) {
  const profile = ctx.profile;
  ensureDir(runDir);
  const prev = readState(runDir);
  if (prev && ['FREEZING', 'FROZEN'].includes(prev.state)) throw new Refused(`${runDir} already holds a ${prev.state} freeze - run \`status\`, then \`unfreeze\` / \`recover\``, 'ALREADY_FROZEN');
  if (!containerRunning(profile.container)) throw new Refused(`container ${profile.container} is not running`, 'CONTAINER');

  // ---- 1. checks before anything is changed
  const problems = [];
  if (confirmTokenOf(manifest) !== token) problems.push('manifest does not hash to the approved token');
  const sv = computeScriptVersion(ctx.extraScriptFiles || []);
  problems.push(...staticChecks(manifest, sv));
  const app = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName('auth'), readOnly: true }).connect();
  let snap;
  let maintExists;
  try {
    snap = await environmentSnapshot({ ...ctx, dbs: { auth: app } });
    maintExists = await app.json(`SELECT count(*)::int FROM pg_roles WHERE rolname = $1`, [MAINT_ROLE]);
  } finally {
    await app.close();
  }
  problems.push(...environmentProblems(manifest, snap));
  // 12.15 item 2 steps 4-7 against the live data, BEFORE anything is changed (the same check is repeated under the fence by `audit --recheck` and again inside every transaction)
  if (problems.length === 0) {
    const names = Object.fromEntries(SERVICES.map((x) => [x, profile.dbName(x)]));
    const dbs = await openMany(names, tcpFactory(profile, { readOnly: true }));
    try {
      const rc = await recheck({ ...ctx, dbs }, manifest, { checkSnapshots: false });
      problems.push(...rc.problems);
    } finally {
      await closeMany(dbs);
    }
  }
  if (maintExists > 0) problems.push(`role ${MAINT_ROLE} already exists - a previous run was abandoned half way. Do NOT continue: run \`status\` and \`recover\``);
  if (problems.length) throw new Refused(`freeze refused, nothing was changed:\n  - ${problems.join('\n  - ')}`, 'FREEZE_CHECKS');

  const hba = manifest.hbaSnapshot.path;
  const state = {
    version: 1,
    state: 'FREEZING',
    profile: profile.name,
    container: profile.container,
    runDir,
    manifestToken: token,
    hbaPath: hba,
    hbaOrigSha256: manifest.hbaSnapshot.sha256,
    hbaFenceSha256: sha256Hex(Buffer.from(FENCE_TEXT)),
    hbaSnapshotRules: manifest.hbaSnapshot.rules,
    aclSnapshot: manifest.aclSnapshot,
    cleanDbs: manifest.parameters.cleanDbs,
    steps: {},
    stoppedContainers: [],
    startedAt: nowIso(),
    verifyPassed: false,
    restoreDone: false,
  };
  writeJsonAtomic(stateFile(runDir), state);
  const record = stepRecorder(ctx, runDir, state);
  record(1, 'checks passed (token, consistency, environment, scriptVersion, pg_hba + ACL snapshots; no maintenance role)');

  const fail = async (why, { restoreHba = false } = {}) => {
    state.state = 'FAILED';
    state.failure = why;
    if (restoreHba) {
      try {
        copyContainerFileAtomic(profile, origCopyPath(hba), hba);
        reloadContainer(profile);
        ctx.log('  restored the original pg_hba.conf');
      } catch (e) {
        ctx.log(`  !! could not restore pg_hba.conf automatically: ${e.message} - run \`recover\``);
      }
    }
    await dropMaintRoleViaApp(ctx);
    writeJsonAtomic(stateFile(runDir), state);
  };

  // ---- 2. keep the original pg_hba.conf, verbatim
  const origText = readContainerFile(profile, hba);
  const origSha = sha256Hex(Buffer.from(origText, 'utf8'));
  if (origSha !== manifest.hbaSnapshot.sha256) {
    await fail('pg_hba.conf read from the container differs from the approved hbaSnapshot');
    throw new Refused('pg_hba.conf in the container differs from the approved hbaSnapshot', 'HBA_MISMATCH');
  }
  fs.writeFileSync(path.join(runDir, 'pg_hba.conf.orig'), origText);
  copyContainerFileAtomic(profile, hba, origCopyPath(hba));
  if (sha256Container(profile, origCopyPath(hba)) !== origSha) {
    await fail('the in-container copy of pg_hba.conf does not hash like the original');
    throw new Refused('in-container copy of pg_hba.conf does not match', 'HBA_COPY');
  }
  record(2, 'original pg_hba.conf saved (container + host)', { sha256: origSha });

  // ---- 3. create the maintenance role and prove it can be used, before anyone is locked out
  let adm;
  try {
    adm = await openApp(profile, profile.dbName('auth'));
    await adm.exec(`CREATE ROLE ${MAINT_ROLE} LOGIN SUPERUSER CONNECTION LIMIT 3 PASSWORD '${maintPassword}'`);
  } catch (e) {
    await fail(`cannot create ${MAINT_ROLE}: ${e.message}`);
    throw e;
  } finally {
    if (adm) await adm.close();
  }
  try {
    for (const svc of SERVICES) {
      const m = await openMaint(profile, maintPassword, profile.dbName(svc));
      const su = await m.json('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
      await m.close();
      if (!(su === true || su === 't')) throw new Error(`not a superuser in ${profile.dbName(svc)}`);
    }
  } catch (e) {
    await fail(`the maintenance role is not usable: ${e.message}`);
    throw new Refused(`maintenance role not usable: ${e.message}`, 'MAINT_UNUSABLE');
  }
  record(3, `${MAINT_ROLE} created (LOGIN SUPERUSER CONNECTION LIMIT 3) and entered all 7 databases`);

  // ---- 4. stage the fence file; put the maintenance rule at the top of the ORIGINAL file; reload; check it
  const fenceText = profile.name === 'test' && process.env.DBCLEAN_TEST_FENCE_TEXT_FILE ? fs.readFileSync(process.env.DBCLEAN_TEST_FENCE_TEXT_FILE, 'utf8') : FENCE_TEXT;
  writeContainerFileAtomic(profile, fenceStagePath(hba), fenceText);
  writeContainerFileAtomic(profile, hba, `${MAINT_LINE}\n${origText}`);
  reloadContainer(profile);
  let m4;
  try {
    await sleep(500);
    m4 = await openMaint(profile, maintPassword, profile.dbName('auth'));
    const h = await readHba(m4);
    const errs = h.rules.filter((r) => r.error);
    if (errs.length) throw new Error(`pg_hba_file_rules reports errors: ${JSON.stringify(errs)}`);
    if (!(h.rules[0] && h.rules[0].user.includes(MAINT_ROLE) && h.rules[0].method === 'scram-sha-256')) throw new Error('the maintenance rule is not the first rule');
  } catch (e) {
    if (m4) await m4.close();
    await fail(`step 4 failed: ${e.message}`, { restoreHba: true });
    throw new Refused(`freeze stopped at step 4: ${e.message}`, 'FREEZE_STEP4');
  }
  await m4.close();
  record(4, 'maintenance rule added at the top of the original pg_hba.conf, reloaded, and a fresh scram session works');

  // ---- 5. stop the application containers
  const stopped = [];
  for (const c of profile.appContainers) {
    if (containerExists(c) && containerRunning(c)) {
      const r = docker(['stop', '-t', '15', c], { timeout: 90_000 });
      if (r.status !== 0) {
        await fail(`could not stop ${c}: ${r.stderr.trim()}`, { restoreHba: true });
        throw new Refused(`could not stop ${c}`, 'STOP_CONTAINER');
      }
      stopped.push(c);
    }
  }
  state.stoppedContainers = stopped;
  record(5, `application containers stopped (${stopped.length}): ${stopped.join(', ') || 'none for this profile'}`);

  // ---- 6. apply the fence (atomic rename) and check the rules are exactly the four fence lines
  copyContainerFileAtomic(profile, fenceStagePath(hba), hba);
  reloadContainer(profile);
  let m6;
  try {
    await sleep(500);
    m6 = await openMaint(profile, maintPassword, profile.dbName('auth')); // the file may be bad: this still works only if the rule set is the staged one or the maintenance-first one
    const h = await readHba(m6);
    const errs = h.rules.filter((r) => r.error);
    if (errs.length) throw new Error(`the fence file has errors: ${JSON.stringify(errs)}`);
    const got = h.rules.map((r) => ({ type: r.type, database: r.database, user: r.user, address: r.address, method: r.method }));
    if (JSON.stringify(got) !== JSON.stringify(EXPECTED_FENCE_RULES)) throw new Error(`pg_hba_file_rules is not the four fence lines: ${JSON.stringify(got)}`);
  } catch (e) {
    if (m6) await m6.close();
    await fail(`step 6 failed: ${e.message}`, { restoreHba: true });
    throw new Refused(`freeze stopped at step 6 (original pg_hba.conf restored, maintenance role removed): ${e.message}`, 'FREEZE_STEP6');
  }
  record(6, 'fence applied and pg_hba_file_rules matches exactly the four fence lines');

  // ---- 7. kill every old session (pg_hba only stops NEW connections)
  let remaining = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    await m6.exec(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE backend_type = 'client backend' AND usename <> '${MAINT_ROLE}' AND pid <> pg_backend_pid()`);
    await sleep(500);
    remaining = await m6.json(`SELECT COALESCE(json_agg(json_build_object('user', usename, 'db', datname)), '[]'::json) FROM pg_stat_activity WHERE backend_type = 'client backend' AND usename <> '${MAINT_ROLE}' AND pid <> pg_backend_pid()`);
    if (remaining.length === 0) break;
  }
  await m6.close();
  if (remaining.length) {
    state.state = 'FREEZING';
    state.failure = `sessions survived: ${JSON.stringify(remaining)}`;
    writeJsonAtomic(stateFile(runDir), state);
    throw new Refused(`freeze stopped at step 7: ${remaining.length} foreign session(s) could not be terminated - state left as is (run status / recover)`, 'FREEZE_STEP7');
  }
  record(7, 'all foreign sessions terminated');

  // ---- 8. verification with real connections
  const evidence = await verifyFence(ctx, state, maintPassword);
  state.fenceEvidence = [{ when: 'freeze', ...evidence }];
  record(8, 'fence verified with real connections: (a) TCP rejected (b) socket rejected (c) other logins rejected (d) only maintenance sessions (e) maintenance enters all 7 DBs');

  // ---- 9. baseline write counters (the evidence that nothing writes between here and the backup)
  await sleep(1500);
  state.t0 = await collectStats(ctx, maintPassword);
  state.state = 'FROZEN';
  state.frozenAt = nowIso();
  record(9, 'FROZEN - baseline n_tup_ins+upd+del counters stored');
  return state;
}

export async function collectStats(ctx, maintPassword) {
  const out = {};
  for (const svc of SERVICES) {
    const m = await openMaint(ctx.profile, maintPassword, ctx.profile.dbName(svc));
    try {
      out[svc] = await pgStat(m);
    } finally {
      await m.close();
    }
  }
  return out;
}

// ------------------------------------------------------------------ H4 - unfreeze / recovery step 5
async function revokeMaintRole(ctx, state) {
  const profile = ctx.profile;
  const a = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName('auth') }).connect();
  try {
    const exists = await a.json(`SELECT count(*)::int FROM pg_roles WHERE rolname = $1`, [MAINT_ROLE]);
    if (exists > 0) {
      await a.exec(`ALTER ROLE ${MAINT_ROLE} NOSUPERUSER NOLOGIN`);
      await a.exec(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${MAINT_ROLE}' AND pid <> pg_backend_pid()`);
      await sleep(300);
      try {
        await a.exec(`DROP ROLE ${MAINT_ROLE}`);
      } catch (e) {
        if (!/own|depend|privileges/i.test(e.message)) throw e;
        for (const svc of SERVICES) {
          const d = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName(svc) }).connect();
          try {
            await d.exec(`REASSIGN OWNED BY ${MAINT_ROLE} TO ${profile.appUser}`);
            await d.exec(`DROP OWNED BY ${MAINT_ROLE}`);
          } finally {
            await d.close();
          }
        }
        await a.exec(`DROP ROLE ${MAINT_ROLE}`);
      }
    }
    const left = await a.json(`SELECT count(*)::int FROM pg_roles WHERE rolname = $1`, [MAINT_ROLE]);
    const supers = await a.json(`SELECT COALESCE(json_agg(rolname ORDER BY rolname), '[]'::json) FROM pg_roles WHERE rolsuper`);
    const allowed = new Set((state.aclSnapshot?.roles || []).filter((r) => r.rolsuper).map((r) => r.rolname));
    const strange = supers.filter((r) => !allowed.has(r));
    if (left !== 0) throw new Error(`role ${MAINT_ROLE} still exists`);
    if (strange.length) throw new Error(`unexpected superuser(s): ${strange.join(', ')}`);
    return { maintRoleCount: left, superusers: supers };
  } finally {
    await a.close();
  }
}

export async function checkAppReconnect(ctx) {
  const results = {};
  for (const svc of SERVICES) {
    const d = ctx.profile.dbName(svc);
    const r = await tcpProbe(ctx.profile, ctx.profile.appUser, ctx.profile.appPassword, d);
    results[d] = r.ok ? 'connected' : r.message;
    if (!r.ok) throw new Refused(`app role ${ctx.profile.appUser} cannot connect to ${d} over TCP: ${r.message} - state left as is, nothing marked done`, 'UNFREEZE_APP_LOGIN');
  }
  return results;
}

async function restoreHbaAndCheck(ctx, state) {
  const profile = ctx.profile;
  const hba = state.hbaPath;
  let source = origCopyPath(hba);
  try {
    sha256Container(profile, source);
  } catch {
    // the in-container copy is gone: write the host copy back
    writeContainerFileAtomic(profile, source, fs.readFileSync(path.join(state.runDir, 'pg_hba.conf.orig'), 'utf8'));
  }
  copyContainerFileAtomic(profile, source, hba);
  const sha = sha256Container(profile, hba);
  if (sha !== state.hbaOrigSha256) throw new Refused(`restored pg_hba.conf has sha256 ${sha}, expected ${state.hbaOrigSha256}`, 'HBA_SHA');
  reloadContainer(profile);
  await sleep(700);
  return sha;
}

export async function unfreeze(ctx, { runDir, maintPassword, startContainers = true, loginCheck }) {
  const state = readState(runDir);
  if (!state) throw new Refused(`no freeze-state.json in ${runDir}`, 'NO_STATE');
  if (state.state !== 'FROZEN') throw new Refused(`state is ${state.state}, unfreeze needs FROZEN (use \`recover\` for anything else)`, 'BAD_STATE');
  const pf = path.join(runDir, 'cleanup-progress.json');
  const anyDone = fs.existsSync(pf) && Object.values(readJson(pf).dbs).some((d) => d.state === 'DONE');
  const abandon = !anyDone; // 12.16 option 3: abandoning is valid only while no database is DONE (no verify-clean marker is written)
  if (!state.verifyPassed && !state.restoreDone && !abandon) throw new Refused('H4 only runs after H3 (verify) passed, after a restore finished, or when abandoning before any database is DONE. Otherwise choose restore / clean --resume.', 'H3_NOT_PASSED');
  const profile = ctx.profile;
  const evidence = {};
  // 1-2 restore + reload + rules == approved snapshot
  evidence.hbaSha256 = await restoreHbaAndCheck(ctx, state);
  const a = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName('auth'), readOnly: true }).connect().catch(() => null);
  if (!a) {
    // the original rules never let the app role in -> cannot verify; stop without marking
    throw new Refused('after restoring pg_hba.conf the app role still cannot connect - state left as is', 'UNFREEZE_APP_LOGIN');
  }
  try {
    const h = await readHba(a);
    if (JSON.stringify(h.rules) !== JSON.stringify(state.hbaSnapshotRules)) throw new Refused('pg_hba_file_rules after the restore differs from the approved snapshot', 'HBA_RULES');
    if (h.rules.some((r) => r.error)) throw new Refused('pg_hba_file_rules reports errors after the restore', 'HBA_RULES');
  } finally {
    await a.close();
  }
  // 3 the application role reconnects to all seven databases over TCP
  evidence.appReconnect = await checkAppReconnect(ctx);
  // 4 ACL + roles unchanged
  const a2 = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName('auth'), readOnly: true }).connect();
  try {
    const live = await readAclAndRoles(a2, SERVICES.map((s) => profile.dbName(s)));
    const diffs = diffAcl(state.aclSnapshot, live, { ignoreRole: MAINT_ROLE });
    if (diffs.length) throw new Refused(`ACL / roles differ from the approved snapshot:\n  - ${diffs.join('\n  - ')}`, 'ACL_DIFF');
    evidence.aclUnchanged = true;
  } finally {
    await a2.close();
  }
  // 5 revoke and drop the maintenance role
  Object.assign(evidence, await revokeMaintRole(ctx, state));
  state.unfreezeEvidence = evidence;
  state.state = 'RELEASING';
  writeJsonAtomic(stateFile(runDir), state);
  // 6 start the application containers (reverse order) and prove a real login works
  const started = [];
  if (startContainers) {
    for (const c of [...state.stoppedContainers].reverse()) {
      const r = docker(['start', c], { timeout: 60_000 });
      if (r.status !== 0) throw new Refused(`could not start ${c}: ${r.stderr.trim()} - database side is released, application side is not`, 'START_CONTAINER');
      started.push(c);
    }
  }
  evidence.startedContainers = started;
  if (loginCheck) evidence.loginCheck = await loginCheck(started);
  // 7 done
  state.state = 'RELEASED';
  state.releasedAt = nowIso();
  writeJsonAtomic(stateFile(runDir), state);
  return { state, evidence };
}

/** The runbook as a command. Does NOT start application containers and writes NO verify-clean marker. */
export async function recover(ctx, { runDir }) {
  const profile = ctx.profile;
  const state = readState(runDir);
  const hba = state?.hbaPath || hbaPathOf(profile);
  const origSha = state?.hbaOrigSha256;
  // 1-2: cp <hba>.orig -> hba (OS user postgres, no DB login needed), pg_ctl reload
  let source = origCopyPath(hba);
  const hasCopy = asPg(profile, ['test', '-f', source]).status === 0;
  if (!hasCopy) {
    const hostCopy = path.join(runDir, 'pg_hba.conf.orig');
    if (!fs.existsSync(hostCopy)) throw new Refused('no saved original pg_hba.conf (neither in the container nor in the run directory) - restore it by hand', 'NO_ORIG');
    writeContainerFileAtomic(profile, source, fs.readFileSync(hostCopy, 'utf8'));
  }
  copyContainerFileAtomic(profile, source, hba);
  reloadContainer(profile);
  await sleep(700);
  // 3: sha check
  const sha = sha256Container(profile, hba);
  if (origSha && sha !== origSha) throw new Refused(`restored pg_hba.conf sha256 ${sha} does not match the original ${origSha}`, 'HBA_SHA');
  // 4: H4 step 5
  const result = await revokeMaintRole(ctx, state || { aclSnapshot: { roles: [] } }).catch((e) => ({ error: e.message }));
  let appOk = true;
  try {
    await checkAppReconnect(ctx);
  } catch (e) {
    appOk = false;
    result.appReconnectError = e.message;
  }
  if (state) {
    state.state = result.error ? state.state : 'RECOVERED';
    state.recoveredAt = nowIso();
    state.recoverEvidence = { hbaSha256: sha, ...result, appReconnect: appOk };
    writeJsonAtomic(stateFile(runDir), state);
  }
  return { hbaSha256: sha, appReconnect: appOk, ...result };
}

// ------------------------------------------------------------------ status (read only)
export async function status(ctx, { runDir, maintPassword }) {
  const profile = ctx.profile;
  const state = runDir ? readState(runDir) : null;
  const out = { runDir, state: state ? state.state : 'NO_STATE_FILE', lastStep: state?.lastStep ?? null, steps: state?.steps ? Object.fromEntries(Object.entries(state.steps).map(([k, v]) => [k, v.label])) : null };
  out.container = { name: profile.container, running: containerRunning(profile.container) };
  if (!out.container.running) return out;
  const hba = state?.hbaPath || hbaPathOf(profile);
  let sha = null;
  try {
    sha = sha256Container(profile, hba);
  } catch (e) {
    out.hbaError = e.message;
  }
  out.hba = {
    path: hba,
    sha256: sha,
    is: !sha ? 'unreadable' : sha === state?.hbaOrigSha256 ? 'ORIGINAL (approved)' : sha === state?.hbaFenceSha256 ? 'FENCE' : 'OTHER (neither the approved original nor the fence)',
  };
  const orig = asPg(profile, ['test', '-f', origCopyPath(hba)]).status === 0;
  out.hba.origCopyInContainer = orig;
  // can we look inside the database?
  const probe = await tcpProbe(profile, profile.appUser, profile.appPassword, profile.dbName('auth'));
  let db = null;
  if (probe.ok) {
    db = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: profile.dbName('auth'), readOnly: true }).connect();
    out.access = 'app role over TCP (not fenced)';
  } else if (maintPassword) {
    try {
      db = await openMaint(profile, maintPassword, profile.dbName('auth'));
      out.access = 'maintenance role over the socket (fenced)';
    } catch (e) {
      out.access = `no database access: ${e.message.slice(0, 120)}`;
    }
  } else {
    out.access = `no database access (${probe.rejected ? 'fence is up' : probe.message}) - set DBCLEAN_MAINT_PASSWORD to look inside`;
  }
  if (db) {
    try {
      out.maintRoleExists = (await db.json(`SELECT count(*)::int FROM pg_roles WHERE rolname = '${MAINT_ROLE}'`)) > 0;
      out.sessions = await db.json(`SELECT COALESCE(json_agg(json_build_object('user', usename, 'app', application_name, 'db', datname)), '[]'::json) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()`);
      out.foreignSessions = out.sessions.filter((s) => s.user !== MAINT_ROLE && s.app !== MAINT_APP_NAME && s.app !== 'dbclean-probe');
    } finally {
      await db.close();
    }
  } else {
    out.maintRoleExists = 'unknown';
  }
  if (runDir) {
    const prog = path.join(runDir, 'cleanup-progress.json');
    out.databases = fs.existsSync(prog) ? Object.fromEntries(Object.entries(readJson(prog).dbs).map(([k, v]) => [k, { state: v.state, rowsBefore: v.rowsBefore, rowsAfter: v.rowsAfter }])) : null;
    const bm = path.join(runDir, 'backup-manifest.json');
    out.backup = fs.existsSync(bm) ? { present: true, files: readJson(bm).files?.length } : { present: false };
    out.verifyPassed = state?.verifyPassed ?? false;
  }
  return out;
}

export { fileSha256, normalizeHbaRules };
