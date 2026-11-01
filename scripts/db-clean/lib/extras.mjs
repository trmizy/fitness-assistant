/**
 * db-clean - read-only report extras that are not part of the manifest: the user-service duplicate live PT-client pairs (the
 * migration 20261021140000 blocker), failed migration rows, and other gymcoach_* databases on the same server.
 */
import { SERVICES } from './config.mjs';
import { TcpDb } from './db.mjs';
import { makeKeep, POLICY } from './policy.mjs';
import { paramList } from './engine.mjs';
import { allTableCounts } from './engine.mjs';

const LIVE = `('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')`;
const GUARD = '($1::text[] IS NOT NULL AND $2::text[] IS NOT NULL AND $3::text[] IS NOT NULL)';

/** How would the cleanup change the 'one live contract per (pt, client) pair' situation? (report only - never acts) */
export async function contractPairImpact(userDb, params, policy) {
  const rules = (policy || POLICY).user;
  if (!rules?.contracts) return null;
  const K = makeKeep(rules);
  const keep = K('contracts', 't');
  const P = paramList(params);
  try {
    return await userDb.json(
      `SELECT json_build_object(
         'liveContractsBefore', (SELECT count(*)::int FROM contracts WHERE status::text IN ${LIVE} AND source::text <> 'MARKETPLACE'),
         'duplicatePairsBefore', (SELECT count(*)::int FROM (SELECT 1 FROM contracts WHERE status::text IN ${LIVE} AND source::text <> 'MARKETPLACE' GROUP BY pt_user_id, client_user_id HAVING count(*) > 1) d),
         'liveContractsAfter', (SELECT count(*)::int FROM contracts t WHERE status::text IN ${LIVE} AND source::text <> 'MARKETPLACE' AND COALESCE(${keep}, FALSE) AND ${GUARD}),
         'duplicatePairsAfter', (SELECT count(*)::int FROM (SELECT 1 FROM contracts t WHERE status::text IN ${LIVE} AND source::text <> 'MARKETPLACE' AND COALESCE(${keep}, FALSE) AND ${GUARD} GROUP BY pt_user_id, client_user_id HAVING count(*) > 1) d),
         'duplicatePairsInvolvingPreserved', (SELECT count(*)::int FROM (SELECT 1 FROM contracts WHERE status::text IN ${LIVE} AND source::text <> 'MARKETPLACE' AND (pt_user_id = ANY($1::text[]) OR client_user_id = ANY($1::text[])) AND ($2::text[] IS NOT NULL AND $3::text[] IS NOT NULL) GROUP BY pt_user_id, client_user_id HAVING count(*) > 1) d),
         'indexInstalled', (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'))`,
      P,
    );
  } catch (e) {
    return { error: e.message };
  }
}

export async function migrationState(db) {
  try {
    return await db.json(
      `SELECT COALESCE(json_agg(json_build_object('migration', migration_name, 'startedAt', started_at, 'finishedAt', finished_at, 'rolledBackAt', rolled_back_at, 'appliedSteps', applied_steps_count) ORDER BY started_at), '[]'::json)
         FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
    );
  } catch (e) {
    return { error: e.message };
  }
}

/** gymcoach_* databases on the server that are not one of the seven (and not *_test): size + exact row counts of their tables. */
export async function otherDatabases(profile, authDb) {
  const seven = SERVICES.map((s) => profile.dbName(s));
  const rows = await authDb.json(
    `SELECT COALESCE(json_agg(json_build_object('datname', datname, 'mb', (pg_database_size(datname) / 1048576)::int) ORDER BY datname), '[]'::json)
       FROM pg_database WHERE datname LIKE 'gym%' AND datname <> ALL($1::text[]) AND datname NOT LIKE '%\\_test' AND NOT datistemplate`,
    [seven],
  );
  const out = [];
  for (const r of rows) {
    let counts = null;
    let error = null;
    try {
      const d = await new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database: r.datname, readOnly: true }).connect();
      try {
        counts = await allTableCounts(d);
      } finally {
        await d.close();
      }
    } catch (e) {
      error = e.message;
    }
    const nonEmpty = counts ? Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) : null;
    out.push({ datname: r.datname, mb: r.mb, tables: counts ? Object.keys(counts).length : null, nonEmptyTables: nonEmpty, error });
  }
  return out;
}
