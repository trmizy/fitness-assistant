/**
 * db-clean - `audit` and `audit --recheck` (plan 9, 12.9 G, 12.15 item 2).
 * computePlan() is the one function that turns (allowlist e-mails + policy + live data) into key tuples and kept-row hashes; the
 * audit writes it into the manifest, the recheck / clean / verify run it again and compare element by element.
 * READ ONLY: every statement is a SELECT (the TCP connections are opened with default_transaction_read_only = on).
 */
import os from 'node:os';
import { CLEAN_ORDER, PARTNER_OWNED, SERVICES, MAINT_ROLE } from './config.mjs';
import { analyzeDb, compareWithManifest, rulesFor, paramList } from './engine.mjs';
import { makeKeep } from './policy.mjs';
import { readHba, readAclAndRoles } from './schema.mjs';
import { computeScriptVersion } from './manifest.mjs';
import { nowIso } from './util.mjs';

export function cleanDbsFor(partnerDbs) {
  return CLEAN_ORDER.filter((s) => partnerDbs === 'include' || !PARTNER_OWNED.includes(s));
}

export async function resolveUsers(authDb, emails) {
  const lower = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort();
  const rows = await authDb.json(
    `SELECT COALESCE(json_agg(json_build_object('email', lower(email), 'userId', id, 'role', role::text) ORDER BY lower(email)), '[]'::json) FROM users WHERE lower(email) = ANY($1::text[])`,
    [lower],
  );
  const found = new Set(rows.map((r) => r.email));
  return { users: rows, missing: lower.filter((e) => !found.has(e)), emails: lower };
}

export async function computeKeptGymIds(gymDb, policy, params, cleanGym) {
  const rules = rulesFor('gym', policy);
  if (!rules.gyms) return [];
  if (!cleanGym) return gymDb.json(`SELECT COALESCE(json_agg(id ORDER BY id), '[]'::json) FROM gyms`);
  const K = makeKeep(rules);
  return gymDb.json(
    `SELECT COALESCE(json_agg(t."id" ORDER BY t."id"), '[]'::json) FROM "gyms" t WHERE COALESCE(${K('gyms', 't')}, FALSE) AND ($1::text[] IS NOT NULL AND $2::text[] IS NOT NULL AND $3::text[] IS NOT NULL)`,
    paramList({ ...params, keptGymIds: [] }),
  );
}

/** Evaluate the whole plan. dbs: { svc: Db } for every service. */
export async function computePlan(ctx, { emails, cleanDbs, stats = false }) {
  const { users, missing, emails: lower } = await resolveUsers(ctx.dbs.auth, emails);
  const userIds = users.map((u) => u.userId).sort();
  const params = { userIds, emails: lower, keptGymIds: [] };
  params.keptGymIds = await computeKeptGymIds(ctx.dbs.gym, ctx.policy, params, cleanDbs.includes('gym'));
  const analyses = {};
  for (const svc of SERVICES) {
    analyses[svc] = await analyzeDb(ctx.dbs[svc], svc, params, { policy: ctx.policy, mode: cleanDbs.includes(svc) ? 'full' : 'count', stats });
  }
  return { users, missing, params, analyses };
}

export async function environmentSnapshot(ctx) {
  const auth = ctx.dbs.auth;
  const serverVersion = await auth.json(`SELECT to_json(current_setting('server_version'))`);
  const names = SERVICES.map((s) => ctx.profile.dbName(s));
  const oids = await auth.json(`SELECT COALESCE(json_agg(json_build_object('datname', datname, 'oid', oid::int) ORDER BY datname), '[]'::json) FROM pg_database WHERE datname = ANY($1::text[])`, [names]);
  const dbs = SERVICES.map((svc) => {
    const datname = ctx.profile.dbName(svc);
    const o = oids.find((x) => x.datname === datname);
    return { datname, oid: o ? o.oid : null, svc };
  }).sort((a, b) => (a.datname < b.datname ? -1 : 1));
  const hba = await readHba(auth);
  const acl = await readAclAndRoles(auth, names);
  return {
    environment: { envName: ctx.profile.name, host: ctx.profile.host, port: ctx.profile.port, dbs, serverVersion },
    hbaSnapshot: { path: hba.path, sha256: hba.sha256, rules: hba.rules },
    aclSnapshot: acl,
    hbaText: hba.text,
  };
}

export async function preflightWarnings(authDb, { expectedHbaSha256 } = {}) {
  const warns = [];
  const role = await authDb.json(`SELECT count(*)::int FROM pg_roles WHERE rolname = $1`, [MAINT_ROLE]);
  if (role > 0) warns.push(`role ${MAINT_ROLE} exists - a previous freeze was abandoned half way (see \`status\` / \`recover\`)`);
  const hba = await readHba(authDb);
  if (hba.rules.some((r) => r.user === MAINT_ROLE)) warns.push('pg_hba.conf already contains a gymini_maintenance rule - a fence (or part of one) is in place');
  if (expectedHbaSha256 && hba.sha256 !== expectedHbaSha256) warns.push(`pg_hba.conf sha256 ${hba.sha256} differs from the approved snapshot ${expectedHbaSha256}`);
  return warns;
}

export async function pgStat(db) {
  return db.json(
    `SELECT json_build_object('tupChanges', COALESCE(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text, 'ins', COALESCE(sum(n_tup_ins), 0)::text, 'upd', COALESCE(sum(n_tup_upd), 0)::text, 'del', COALESCE(sum(n_tup_del), 0)::text) FROM pg_stat_user_tables`,
  );
}

export function buildManifest({ snap, scriptVersion, cleanDbs, partnerDbs, plan }) {
  const dbName = (svc) => snap.environment.dbs.find((d) => d.svc === svc).datname;
  const tables = [];
  const preservedRows = [];
  const excludedVolatileColumns = {};
  const blockers = { unclassified: {}, noPrimaryKey: {}, unsupportedPrimaryKey: {}, foreignKeyConflicts: [], deleteOrderCycles: {} };
  for (const svc of cleanDbs) {
    const a = plan.analyses[svc];
    const db = dbName(svc);
    for (const t of a.tables) {
      if (t.volatile.length) excludedVolatileColumns[`${db}.${t.schema}.${t.table}`] = t.volatile;
      if (t.count > 0) tables.push({ db, schema: t.schema, table: t.table, pk: t.pk, pkTypes: t.pkTypes, keys: t.keys, count: t.count, fingerprint: t.fingerprint });
    }
    for (const p of a.preserved) preservedRows.push({ db, schema: p.schema, table: p.table, pk: p.pk, entries: p.entries });
    if (a.unclassified.length) blockers.unclassified[db] = a.unclassified;
    if (a.noPk.length) blockers.noPrimaryKey[db] = a.noPk;
    if (a.badPk.length) blockers.unsupportedPrimaryKey[db] = a.badPk;
    for (const c of a.conflicts) blockers.foreignKeyConflicts.push({ db, ...c });
    if (a.cycle) blockers.deleteOrderCycles[db] = a.cycle;
  }
  tables.sort((x, y) => (`${x.db}.${x.table}` < `${y.db}.${y.table}` ? -1 : 1));
  preservedRows.sort((x, y) => (`${x.db}.${x.table}` < `${y.db}.${y.table}` ? -1 : 1));
  const compact = Object.fromEntries(Object.entries(blockers).filter(([, v]) => (Array.isArray(v) ? v.length : Object.keys(v).length)));
  return {
    environment: snap.environment,
    scriptVersion,
    hbaSnapshot: snap.hbaSnapshot,
    aclSnapshot: snap.aclSnapshot,
    parameters: { cleanDbs, partnerDbs, mixedRows: 'drop' },
    allowlist: {
      emails: plan.params.emails,
      users: plan.users.map((u) => ({ email: u.email, userId: u.userId, role: u.role })),
      missingEmails: plan.missing,
      keptGymIds: plan.params.keptGymIds,
      preservedRows,
      excludedVolatileColumns,
    },
    blockers: compact,
    tables,
  };
}

/**
 * Plan 12.15 item 2 steps 4-7 against the live data (the `--recheck` mode). Returns { problems[], plan }.
 * Steps 1-3 (token, internal consistency, scriptVersion) are done by the caller with staticChecks().
 */
export async function recheck(ctx, manifest, { checkSnapshots = true } = {}) {
  const problems = [];
  const cleanDbs = manifest.parameters.cleanDbs;
  const plan = await computePlan(ctx, { emails: manifest.allowlist.emails, cleanDbs });
  // users / cross references
  const mu = JSON.stringify(manifest.allowlist.users.map((u) => [u.email, u.userId]));
  const au = JSON.stringify(plan.users.map((u) => [u.email, u.userId]));
  if (mu !== au) problems.push(`allowlist accounts differ from the database: manifest ${mu} vs database ${au}`);
  if (JSON.stringify(manifest.allowlist.keptGymIds) !== JSON.stringify(plan.params.keptGymIds)) problems.push('the set of surviving gyms (keptGymIds) differs from the manifest');
  if (checkSnapshots) {
    const snap = await environmentSnapshot(ctx);
    problems.push(...environmentProblems(manifest, snap));
  }
  for (const svc of cleanDbs) {
    const datname = ctx.profile.dbName(svc);
    const a = plan.analyses[svc];
    const mTables = manifest.tables.filter((t) => t.db === datname);
    const mPres = (manifest.allowlist.preservedRows || []).filter((t) => t.db === datname);
    for (const p of compareWithManifest(a, mTables, mPres)) problems.push(`[${datname}] ${p}`);
    if (a.unclassified.length) problems.push(`[${datname}] unclassified tables: ${a.unclassified.join(', ')}`);
    if (a.noPk.length) problems.push(`[${datname}] tables without a primary key: ${a.noPk.join(', ')}`);
    if (a.conflicts.length) problems.push(`[${datname}] foreign-key conflicts: ${JSON.stringify(a.conflicts)}`);
    if (a.cycle) problems.push(`[${datname}] foreign-key cycle: ${a.cycle.join(' -> ')}`);
  }
  return { problems, plan };
}

/** environment + hba + acl against a fresh snapshot (the part of step 7 that can be checked before the fence is written). */
export function environmentProblems(manifest, snap, { ignoreHba = false, ignoreAclRole } = {}) {
  const problems = [];
  const m = manifest.environment;
  const e = snap.environment;
  if (m.envName !== e.envName || m.host !== e.host || m.port !== e.port) problems.push(`environment differs: manifest ${m.envName}@${m.host}:${m.port}, connection ${e.envName}@${e.host}:${e.port}`);
  if (m.serverVersion !== e.serverVersion) problems.push(`server_version differs: ${m.serverVersion} vs ${e.serverVersion}`);
  if (JSON.stringify(m.dbs) !== JSON.stringify(e.dbs)) problems.push(`database names / oids differ: manifest ${JSON.stringify(m.dbs)} vs live ${JSON.stringify(e.dbs)}`);
  if (!ignoreHba && JSON.stringify(manifest.hbaSnapshot) !== JSON.stringify(snap.hbaSnapshot)) {
    problems.push(`pg_hba.conf differs from the approved hbaSnapshot (manifest sha ${manifest.hbaSnapshot.sha256}, live sha ${snap.hbaSnapshot.sha256})`);
  }
  if (JSON.stringify(manifest.aclSnapshot) !== JSON.stringify(snap.aclSnapshot)) {
    problems.push('database ACLs / roles differ from the approved aclSnapshot');
  }
  return problems;
}

export function auditMetadata(ctx, extra = {}) {
  return {
    auditedAt: nowIso(),
    operator: `${os.userInfo().username}@${os.hostname()}`,
    node: process.version,
    ...extra,
  };
}

export { computeScriptVersion };
