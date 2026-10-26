/**
 * db-clean - command implementations (the CLI in ../db-clean.mjs only parses arguments and maps errors to exit codes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Refused, readJson, writeJsonAtomic, ensureDir, nowIso, sha256Hex } from './util.mjs';
import { SERVICES, CLEAN_ORDER, PARTNER_OWNED, getProfile, assertGuards, maintPasswordFromEnv } from './config.mjs';
import { POLICY } from './policy.mjs';
import { TcpDb, openMany, closeMany, tcpFactory, maintFactory } from './db.mjs';
import { computePlan, cleanDbsFor, environmentSnapshot, buildManifest, recheck, preflightWarnings, pgStat, auditMetadata, environmentProblems } from './audit.mjs';
import { computeScriptVersion, confirmTokenOf, saveCandidate, approvePair, loadApproved, staticChecks, TOOL_DIR } from './manifest.mjs';
import { ALWAYS_CANDIDATES, DEFAULT_FIXTURE_SOURCES, scanFixtures, accountFacts, verdict } from './accounts.mjs';
import { contractPairImpact, migrationState, otherDatabases } from './extras.mjs';
import { freeze, unfreeze, recover, status, readState, stateFile } from './fence.mjs';
import { backup, restore } from './backup.mjs';
import { clean, verifyClean, progressFile } from './clean.mjs';
import { renderReport } from './report.mjs';

const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
export const DEFAULT_BACKUP_ROOT = 'D:\\FitnessAssistant-backups';

export async function makeContext(args, { mutating = false } = {}) {
  const profile = getProfile(args.env, { suffix: args['db-suffix'] });
  assertGuards(profile, { mutating });
  let policy = POLICY;
  const extraScriptFiles = [];
  if (process.env.DBCLEAN_POLICY_FILE) {
    if (profile.name !== 'test') throw new Refused('DBCLEAN_POLICY_FILE is only honoured with --env test', 'GUARD_POLICY');
    const mod = await import(pathToFileURL(path.resolve(process.env.DBCLEAN_POLICY_FILE)).href);
    policy = mod.POLICY;
    extraScriptFiles.push(path.resolve(process.env.DBCLEAN_POLICY_FILE));
  }
  const quiet = process.env.DBCLEAN_QUIET === '1';
  return { profile, policy, extraScriptFiles, log: (m) => !quiet && console.log(m) };
}

const names = (profile) => Object.fromEntries(SERVICES.map((s) => [s, profile.dbName(s)]));

async function openApp(ctx) {
  return openMany(names(ctx.profile), tcpFactory(ctx.profile, { readOnly: true }));
}
async function openFenced(ctx, maintPassword) {
  return openMany(names(ctx.profile), maintFactory(ctx.profile, maintPassword));
}

// ====================================================================================================== audit
export async function cmdAudit(args) {
  const ctx = await makeContext(args);
  const out = args.out || (ctx.profile.name === 'dev' ? path.join(DEFAULT_BACKUP_ROOT, 'phase-G') : null);
  if (!args.recheck && !out) throw new Refused('--out <dir> is required', 'BAD_ARGS');
  const partnerDbs = args['partner-dbs'] || 'report';
  if (!['report', 'include'].includes(partnerDbs)) throw new Refused('--partner-dbs must be report or include', 'BAD_ARGS');

  if (args.recheck) return cmdRecheck(ctx, args);

  const started = Date.now();
  ctx.log(`audit (READ ONLY) of ${ctx.profile.name}: ${SERVICES.map((s) => ctx.profile.dbName(s)).join(', ')}`);
  const dbs = await openApp(ctx);
  ctx.dbs = dbs;
  try {
    const warnings = await preflightWarnings(dbs.auth);
    if (warnings.length) ctx.log(`WARNINGS:\n  - ${warnings.join('\n  - ')}`);

    // ---- candidate accounts: the always-list, plus every e-mail a real E2E fixture uses
    const fixtureSources = (args.fixtures ? args.fixtures.split(';') : DEFAULT_FIXTURE_SOURCES);
    const fx = scanFixtures(fixtureSources, REPO_ROOT);
    let allowlist;
    let allowlistSource;
    if (args.allowlist) {
      allowlist = readJson(args.allowlist).emails;
      allowlistSource = `file ${args.allowlist}`;
      if (!Array.isArray(allowlist)) throw new Refused('--allowlist file must be {"emails": [...]}', 'BAD_ARGS');
    } else {
      allowlist = [...new Set([...ALWAYS_CANDIDATES, ...fx.emails.keys()])];
      allowlistSource = 'CANDIDATES (always-list + every e-mail found in the E2E fixtures); not an approved list';
    }
    const allowLower = [...new Set(allowlist.map((e) => e.toLowerCase()))].sort();
    const cleanDbs = cleanDbsFor(partnerDbs);

    const plan = await computePlan(ctx, { emails: allowLower, cleanDbs, stats: true });
    const snap = await environmentSnapshot(ctx);
    const scriptVersion = computeScriptVersion(ctx.extraScriptFiles);
    const manifest = buildManifest({ snap, scriptVersion, cleanDbs, partnerDbs, plan });
    const token = confirmTokenOf(manifest);

    // ---- facts for the report (not part of the token)
    const candidateEmails = [...new Set([...ALWAYS_CANDIDATES, ...fx.emails.keys(), ...allowLower])].sort();
    const facts = await accountFacts(dbs, candidateEmails);
    const accounts = facts.map((f) => ({ ...f, fixtureHits: fx.emails.get(f.email) || [], verdict: verdict(f.exists, fx.emails.get(f.email)), inManifestAllowlist: allowLower.includes(f.email), alwaysCandidate: ALWAYS_CANDIDATES.includes(f.email) }));
    const pgStatAtAudit = {};
    for (const svc of SERVICES) pgStatAtAudit[svc] = await pgStat(dbs[svc]);
    const extras = {
      contractPairs: await contractPairImpact(dbs.user, plan.params, ctx.policy),
      failedMigrations: Object.fromEntries(await Promise.all(SERVICES.map(async (s) => [s, await migrationState(dbs[s])]))),
      otherDatabases: await otherDatabases(ctx.profile, dbs.auth),
      roles: snap.aclSnapshot.roles,
      hba: { path: snap.hbaSnapshot.path, sha256: snap.hbaSnapshot.sha256, text: snap.hbaText },
    };
    const metadata = auditMetadata(ctx, {
      pgStatAtAudit,
      allowlistSource,
      partnerDbs,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      preflightWarnings: warnings,
      fixtures: { sources: fx.sources, emails: [...fx.emails.entries()].map(([email, hits]) => ({ email, hits })) },
      accounts,
      perDb: summariseAnalyses(ctx, plan, cleanDbs),
      extras,
      userDeps: groupDeps(plan),
    });
    ensureDir(out);
    const files = saveCandidate(out, manifest, token, metadata, 'candidate');
    writeJsonAtomic(path.join(out, 'allowlist.candidates.json'), { note: 'CANDIDATES only. Edit this file (keep the "emails" key) and re-run `audit --allowlist <file>`; nothing is kept by default.', emails: allowLower, universe: accounts.map((a) => ({ email: a.email, exists: a.exists, verdict: a.verdict, fixtureFiles: a.fixtureHits.map((h) => `${h.file}:${h.line}`) })) });
    ctx.log(`manifest: ${files.manifest}`);
    ctx.log(`confirmToken: ${token}`);
    ctx.log(`blockers: ${Object.keys(manifest.blockers).length ? JSON.stringify(Object.keys(manifest.blockers)) : 'none'}`);
    if (args.report) {
      ensureDir(path.dirname(args.report));
      fs.writeFileSync(args.report, renderReport({ ctx, manifest, token, metadata, plan, files, partnerDbs }));
      ctx.log(`report: ${args.report}`);
    }
    return { manifest, token, metadata, files, plan };
  } finally {
    await closeMany(dbs);
  }
}

function groupDeps(plan) {
  const byUser = {};
  for (const [svc, a] of Object.entries(plan.analyses)) {
    for (const d of a.stats.deps) {
      (byUser[d.userId] ||= []).push({ db: svc, table: d.table, column: d.column, rows: d.rows });
    }
  }
  return byUser;
}

export function summariseAnalyses(ctx, plan, cleanDbs) {
  const out = {};
  for (const svc of SERVICES) {
    const a = plan.analyses[svc];
    const tables = a.tables.map((t) => ({ table: t.table, total: t.total, delete: t.count, keep: t.keepCount, pk: t.pk, volatile: t.volatile, note: t.note }));
    out[svc] = {
      datname: ctx.profile.dbName(svc),
      inManifest: cleanDbs.includes(svc),
      partnerOwned: PARTNER_OWNED.includes(svc),
      totals: {
        rows: tables.reduce((n, t) => n + t.total, 0) + Object.values(a.preserveCounts).reduce((n, c) => n + c, 0),
        delete: tables.reduce((n, t) => n + t.delete, 0),
        keep: tables.reduce((n, t) => n + t.keep, 0),
        preservedTablesRows: Object.values(a.preserveCounts).reduce((n, c) => n + c, 0),
      },
      tables,
      preserveTables: a.preserveCounts,
      unclassified: a.unclassified,
      missingFromDb: a.missingFromDb,
      noPk: a.noPk,
      badPk: a.badPk,
      conflicts: a.conflicts,
      cycle: a.cycle,
      droppedDespitePreservedParty: a.stats.dropped,
    };
  }
  return out;
}

// ====================================================================================================== recheck
async function cmdRecheck(ctx, args) {
  const { manifest, token, problems: tokenProblems } = loadApproved(args.manifest, args['confirm-token']);
  const problems = [...tokenProblems, ...staticChecks(manifest, computeScriptVersion(ctx.extraScriptFiles))];
  const runDir = args['run-dir'];
  const st = runDir ? readState(runDir) : null;
  const fenced = st && st.state === 'FROZEN';
  const dbs = fenced ? await openFenced(ctx, maintPasswordFromEnv()) : await openApp(ctx);
  try {
    ctx.dbs = dbs;
    const rc = await recheck(ctx, manifest, { checkSnapshots: !fenced });
    problems.push(...rc.problems);
  } finally {
    await closeMany(dbs);
  }
  if (problems.length) {
    ctx.log(`RECHECK FAILED (${problems.length}):\n  - ${problems.slice(0, 200).join('\n  - ')}`);
    ctx.log('There is no way to continue with this manifest. Run a new `audit` and have Ngai approve the new (manifest, token) pair.');
    const e = new Refused('recheck failed', 'RECHECK_FAILED');
    e.problems = problems;
    throw e;
  }
  ctx.log(`RECHECK OK: manifest ${token.slice(0, 16)}... matches the live data (${fenced ? 'under the fence' : 'not fenced'})`);
  return { ok: true, token };
}

// ====================================================================================================== approve
export async function cmdApprove(args) {
  const ctx = await makeContext(args);
  if (!args.manifest || !args['confirm-token'] || !args.out) throw new Refused('approve needs --manifest --confirm-token --out', 'BAD_ARGS');
  const r = approvePair(args.manifest, args['confirm-token'], args.out);
  ctx.log(`approved pair stored read-only:\n  ${r.manifest}\n  ${r.token}`);
  return r;
}

function loadForCommand(args, { requireApproved = true } = {}) {
  const { manifest, token, problems } = loadApproved(args.manifest, args['confirm-token'], { requireApprovedDir: requireApproved });
  if (problems.length) throw new Refused(`refused:\n  - ${problems.join('\n  - ')}`, 'TOKEN_MISMATCH');
  return { manifest, token };
}
function runDirOf(args) {
  if (!args['run-dir']) throw new Refused('--run-dir <dir> is required', 'BAD_ARGS');
  return path.resolve(args['run-dir']);
}

// ====================================================================================================== freeze / backup / clean / verify / unfreeze / restore / recover / status
export async function cmdFreeze(args) {
  const ctx = await makeContext(args, { mutating: true });
  const { manifest, token } = loadForCommand(args);
  const runDir = path.resolve(args['run-dir'] || path.join(DEFAULT_BACKUP_ROOT, new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)));
  const pw = maintPasswordFromEnv();
  ctx.log(`freeze (H0) ${ctx.profile.name} -> run directory ${runDir}`);
  const state = await freeze(ctx, { manifest, token, runDir, maintPassword: pw });
  ctx.log(`FROZEN at ${state.frozenAt}. Next: audit --recheck, backup, clean --apply, verify, unfreeze.`);
  return state;
}

export async function cmdBackup(args) {
  const ctx = await makeContext(args, { mutating: true });
  const { manifest, token } = loadForCommand(args);
  const doc = await backup(ctx, { runDir: runDirOf(args), manifest, token, maintPassword: maintPasswordFromEnv() });
  ctx.log(`backup ${doc.backupId}: ${doc.files.map((f) => `${f.db} ${f.bytes}B`).join(', ')}; trial restore ${doc.restoreCheck.into} ok`);
  return doc;
}

export async function cmdClean(args) {
  const ctx = await makeContext(args, { mutating: true });
  if (!args.apply) throw new Refused('clean needs --apply (there is no dry-run here: `audit` is the dry run)', 'BAD_ARGS');
  const { manifest, token } = loadForCommand(args);
  const r = await clean(ctx, { runDir: runDirOf(args), manifest, token, maintPassword: maintPasswordFromEnv(), resume: !!args.resume });
  ctx.log(`cleanup state: ${JSON.stringify(r.summary)}`);
  if (r.failed) {
    ctx.log(`FAILED at ${r.failed.svc}: ${r.failed.error.message}`);
    ctx.log('Nothing continues on its own. Choose: `restore` (all seven from the backup) or `clean --resume` (only if the approved manifest still matches).');
    const e = new Refused(`cleanup failed at ${r.failed.svc}`, 'CLEAN_FAILED');
    e.progress = r.progress;
    throw e;
  }
  return r;
}

export async function cmdVerify(args) {
  const ctx = await makeContext(args, { mutating: true });
  const { manifest, token } = loadForCommand(args);
  const r = await verifyClean(ctx, { runDir: runDirOf(args), manifest, token, maintPassword: maintPasswordFromEnv() });
  if (!r.ok) {
    ctx.log(`VERIFY FAILED:\n  - ${r.problems.join('\n  - ')}`);
    const e = new Refused('verify failed', 'VERIFY_FAILED');
    e.report = r;
    throw e;
  }
  ctx.log('VERIFY OK (H3 passed)');
  return r;
}

export async function cmdUnfreeze(args) {
  const ctx = await makeContext(args, { mutating: true });
  const runDir = runDirOf(args);
  const loginCheck =
    ctx.profile.name === 'dev'
      ? async () => {
          const url = args['login-url'] || 'http://localhost:3000/api/auth/login';
          const email = process.env.DBCLEAN_LOGIN_EMAIL;
          const password = process.env.DBCLEAN_LOGIN_PASSWORD;
          if (!email || !password) return { skipped: true, reason: 'DBCLEAN_LOGIN_EMAIL / DBCLEAN_LOGIN_PASSWORD not set - REAL HTTP login not proven; verify-clean.ok is NOT written' };
          let res;
          for (let i = 0; i < 30; i++) {
            try {
              res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
              // gateway answers 502/503 while the services behind it are still starting - keep waiting
              if (res.status < 500) break;
              await new Promise((r) => setTimeout(r, 2000));
            } catch {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
          return { url, status: res ? res.status : 'no response', ok: !!res && res.ok };
        }
      : undefined;
  const r = await unfreeze(ctx, { runDir, maintPassword: process.env.DBCLEAN_MAINT_PASSWORD, startContainers: !args['no-start-containers'], loginCheck });
  const lc = r.evidence.loginCheck;
  const mayMark = r.state.verifyPassed && (ctx.profile.name !== 'dev' || (lc && lc.ok));
  if (mayMark) {
    // The format scripts/seed-marketplace/lib/guard.mjs (readMarker) expects: the 64-hex confirmToken and an ISO timestamp.
    // Two lines, nothing else; the seed finds it in the newest D:FitnessAssistant-backups<ts> folder (this run directory).
    writeMarker(runDir, r.state.manifestToken, nowIso());
    writeJsonAtomic(path.join(runDir, 'verify-clean.evidence.json'), { confirmToken: r.state.manifestToken, at: nowIso(), profile: ctx.profile.name, loginCheck: lc || 'n/a (test profile)' });
    ctx.log('verify-clean.ok written');
  } else {
    ctx.log('verify-clean.ok NOT written (H3 not passed, or the real login check did not succeed)');
  }
  ctx.log(`RELEASED. maintenance role gone: ${r.evidence.maintRoleCount === 0}; app role reconnects to all 7 databases.`);
  return r;
}

export function writeMarker(runDir, token, at) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Refused('marker needs a 64-hex confirmToken', 'MARKER');
  fs.writeFileSync(path.join(runDir, 'verify-clean.ok'), `${token}
${at}
`);
}

export async function cmdRestore(args) {
  const ctx = await makeContext(args, { mutating: true });
  const runDir = runDirOf(args);
  const r = await restore(ctx, { runDir, backupDir: args.backup ? path.resolve(args.backup) : undefined, maintPassword: maintPasswordFromEnv() });
  ctx.log(`restored all seven databases from backup ${r.backupId}: ${JSON.stringify(r.results)}`);
  return r;
}

export async function cmdRecover(args) {
  const ctx = await makeContext(args, { mutating: true });
  const r = await recover(ctx, { runDir: runDirOf(args) });
  ctx.log(`recover: ${JSON.stringify(r)}`);
  ctx.log('Application containers were NOT started and no verify-clean marker was written. Start them only when the database state is clear and Ngai chose a direction.');
  return r;
}

export async function cmdStatus(args) {
  const ctx = await makeContext(args);
  const s = await status(ctx, { runDir: args['run-dir'] ? path.resolve(args['run-dir']) : undefined, maintPassword: process.env.DBCLEAN_MAINT_PASSWORD });
  ctx.log(JSON.stringify(s, null, 2));
  return s;
}

export { environmentProblems, progressFile, stateFile, sha256Hex, CLEAN_ORDER };
