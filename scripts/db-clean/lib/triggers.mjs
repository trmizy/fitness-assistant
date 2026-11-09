/**
 * db-clean - trigger preflight and the guard-trigger allowlist.
 *
 * WHY: some tables carry an immutability guard (BEFORE DELETE trigger that raises). gym_listing_revisions refuses to delete a closed
 * (APPROVED / REJECTED / WITHDRAWN / CHANGES_REQUESTED / STALE) revision (gym-service migration 20261018155636), so a denied gym that
 * has a closed revision could not be removed at H2 (the 2026-11-01 run failed there, rolled back). That class of failure must be found at
 * AUDIT time, and the one known guard must be handled in a controlled, narrow way.
 *
 * WHAT (preflight, read only - audit, audit --recheck, freeze, and again inside every H2 transaction):
 *   1. every user (non internal) trigger of every table of the database is listed with its timing / events / enabled state / function;
 *   2. a trigger is ARMED when something the cleanup does would fire it:
 *        DELETE   a DELETE trigger on a table that is in the delete set (rows > 0), or on a table that an ON DELETE CASCADE chain from the
 *                 delete set reaches and that is not empty (the table is not in the delete set, so every cascaded row would be a count
 *                 mismatch anyway: the trigger just makes it fail earlier and louder);
 *        UPDATE   an UPDATE trigger on a table that is the child of an ON DELETE SET NULL / SET DEFAULT edge whose parent is deleted,
 *                 unless the child rows are deleted first (delete order is children first, so they normally are);
 *      TRUNCATE triggers are never armed (the tool never truncates). A trigger that is DISABLED (tgenabled 'D') or replica-only ('R') does not fire
 *      in an ordinary session and is not armed.
 *   3. an armed trigger is a BLOCKER (blockers.triggerGuards, the manifest cannot be frozen / applied) unless it is exactly one of the
 *      GUARD_TRIGGER_ALLOWLIST pairs below, armed only by the DELETE of its own manifest table, in the pinned shape.
 *   4. the allowlisted pairs that are armed are written into the manifest (`guardTriggers`, covered by the confirmToken) together with the
 *      number of manifest rows that rely on them.
 *
 * HOW (clean.mjs): inside the per-database transaction, for exactly those tables: ALTER TABLE ... DISABLE TRIGGER <that name>; delete the
 * manifest keys; ENABLE TRIGGER again; before COMMIT every trigger of the database must be in the state it had at BEGIN (tgenabled read from
 * pg_trigger) and the allowlisted ones must be 'O'. A failure rolls the transaction back, which restores tgenabled (ALTER TABLE is transactional).
 * NEVER session_replication_role, NEVER DISABLE TRIGGER ALL / USER: FK actions and every other trigger stay active.
 */
import { q, qt, loadSchema, deleteOrder } from './schema.mjs';

/** The exact (service, table, trigger) pairs the tool may disable, with the shape each is pinned to. Adding a pair is a code change that changes the scriptVersion. */
export const GUARD_TRIGGER_ALLOWLIST = Object.freeze([
  Object.freeze({
    svc: 'gym',
    schema: 'public',
    table: 'gym_listing_revisions',
    trigger: 'gym_listing_revisions_immutable',
    function: 'gym_listing_revisions_guard_closed',
    timing: 'BEFORE',
    events: 'DELETE OR UPDATE',
    row: true,
    why: 'refuses DELETE of a closed revision (APPROVED/REJECTED/WITHDRAWN/CHANGES_REQUESTED/STALE); the revisions of a DENIED gym must go with the gym (gym-service migration 20261018155636)',
  }),
]);

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`;

/** All user triggers of the database, plain data. */
export async function listUserTriggers(db) {
  return db.json(`
    SELECT COALESCE(json_agg(json_build_object(
             'schema', n.nspname, 'table', c.relname, 'trigger', t.tgname, 'enabled', t.tgenabled::text, 'function', p.proname,
             'timing', CASE WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF' WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END,
             'row', (t.tgtype & 1) = 1, 'onInsert', (t.tgtype & 4) = 4, 'onDelete', (t.tgtype & 8) = 8, 'onUpdate', (t.tgtype & 16) = 16, 'onTruncate', (t.tgtype & 32) = 32,
             'constraintTrigger', t.tgconstraint <> 0, 'definition', pg_get_triggerdef(t.oid)
           ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::json)
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname NOT IN ${SYSTEM_SCHEMAS} AND c.relkind IN ('r', 'p')`);
}

/** tgenabled of every user trigger: [{table, trigger, enabled}] sorted. Used to prove the state is unchanged before COMMIT. */
export async function triggerStates(db) {
  return db.json(`
    SELECT COALESCE(json_agg(json_build_object('table', c.relname, 'trigger', t.tgname, 'enabled', t.tgenabled::text) ORDER BY n.nspname, c.relname, t.tgname), '[]'::json)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname NOT IN ${SYSTEM_SCHEMAS} AND c.relkind IN ('r', 'p')`);
}

const eventsOf = (t) => [t.onInsert && 'INSERT', t.onDelete && 'DELETE', t.onUpdate && 'UPDATE', t.onTruncate && 'TRUNCATE'].filter(Boolean).join(' OR ');

/** The allowlist entry for a trigger of service `svc`, or undefined. Matches on names only; the shape is checked separately. */
export const allowlistEntry = (svc, schema, table, trigger) => GUARD_TRIGGER_ALLOWLIST.find((a) => a.svc === svc && a.schema === schema && a.table === table && a.trigger === trigger);

/** Is the live trigger exactly the pinned shape? Returns a list of differences (empty = pinned shape). */
export function shapeProblems(a, t) {
  const p = [];
  if (t.function !== a.function) p.push(`function is ${t.function}, pinned ${a.function}`);
  if (t.timing !== a.timing) p.push(`timing is ${t.timing}, pinned ${a.timing}`);
  if (eventsOf(t) !== a.events) p.push(`events are ${eventsOf(t)}, pinned ${a.events}`);
  if (t.row !== a.row) p.push(`row-level is ${t.row}, pinned ${a.row}`);
  if (t.constraintTrigger) p.push('it is a constraint trigger');
  return p;
}

/**
 * Pure classification. Inputs are plain data so it can be unit-tested.
 *   triggers   listUserTriggers()
 *   deleteSet  Map "schema.table" -> manifest rows to delete (> 0)
 *   fks        loadSchema().fks
 *   rowCounts  Map "schema.table" -> current row count (only needed for tables that carry a trigger)
 * Returns { listing[], guardTriggers[], blockers[] } (all sorted).
 */
export function classifyTriggers({ svc, datname, triggers, deleteSet, fks, rowCounts }) {
  // tables reached by an ON DELETE CASCADE chain from the delete set (not in the delete set themselves)
  const reached = new Map(); // key -> via ("parent")
  const queue = [...deleteSet.keys()];
  while (queue.length) {
    const parent = queue.shift();
    for (const f of fks) {
      if (f.onDelete !== 'c' || `${f.refSchema}.${f.refTable}` !== parent) continue;
      const child = `${f.schema}.${f.table}`;
      if (deleteSet.has(child) || reached.has(child) || child === parent) continue;
      reached.set(child, `${parent} (${f.name})`);
      queue.push(child);
    }
  }
  const armedParents = new Set([...deleteSet.keys(), ...reached.keys()]);
  // ON DELETE SET NULL / SET DEFAULT edges whose parent is deleted: child key -> [edge descriptions]
  const order = deleteOrder([...deleteSet.keys()], fks);
  const idx = order.order ? new Map(order.order.map((k, i) => [k, i])) : null;
  const updatedBy = new Map();
  for (const f of fks) {
    if (f.onDelete !== 'n' && f.onDelete !== 'd') continue;
    const parent = `${f.refSchema}.${f.refTable}`;
    const child = `${f.schema}.${f.table}`;
    if (!armedParents.has(parent) || parent === child) continue;
    const childGoneFirst = deleteSet.has(child) && idx && idx.has(child) && idx.has(parent) && idx.get(child) < idx.get(parent);
    if (childGoneFirst) continue; // its rows are deleted before the parent, nothing is left to UPDATE
    (updatedBy.get(child) || updatedBy.set(child, []).get(child)).push(`${f.name} -> ${parent}`);
  }

  const listing = [];
  const guardTriggers = [];
  const blockers = [];
  for (const t of triggers) {
    const key = `${t.schema}.${t.table}`;
    const base = { db: datname, schema: t.schema, table: t.table, trigger: t.trigger, function: t.function, timing: t.timing, events: eventsOf(t), row: t.row, enabled: t.enabled };
    const rows = rowCounts.get(key) ?? 0;
    const armedBy = [];
    let notArmed = null;
    if (t.enabled === 'D') notArmed = 'trigger is DISABLED (tgenabled D)';
    else if (t.enabled === 'R') notArmed = 'trigger is replica-only (tgenabled R): does not fire in an ordinary session';
    else {
      if (t.onDelete && deleteSet.has(key)) armedBy.push(`DELETE of ${deleteSet.get(key)} manifest row(s) of this table`);
      else if (t.onDelete && reached.has(key) && rows > 0) armedBy.push(`ON DELETE CASCADE from ${reached.get(key)}; the table holds ${rows} row(s), so a cascade could delete them`);
      if (t.onUpdate && updatedBy.has(key) && rows > 0) armedBy.push(`UPDATE by ON DELETE SET NULL/DEFAULT (${updatedBy.get(key).join('; ')}); the table holds ${rows} row(s) that are not deleted first`);
      if (!armedBy.length) {
        const parts = [];
        if (t.onDelete && reached.has(key) && rows === 0) parts.push('reached by cascade but the table is empty');
        else if (t.onDelete) parts.push('its table is not in the delete set and no cascade reaches it');
        if (t.onUpdate && !updatedBy.has(key)) parts.push('no ON DELETE SET NULL edge updates its rows (rows of a SET NULL child are deleted before the parent: children first)');
        if (t.onUpdate && updatedBy.has(key) && rows === 0) parts.push('SET NULL child, but the table is empty');
        if (!t.onDelete && !t.onUpdate) parts.push(`fires only on ${eventsOf(t)}; the tool never runs those`);
        notArmed = parts.join('; ');
      }
    }
    if (!armedBy.length) {
      listing.push({ ...base, status: 'NOT_ARMED', reason: notArmed });
      continue;
    }
    const a = allowlistEntry(svc, t.schema, t.table, t.trigger);
    const onlyDirectDelete = armedBy.length === 1 && deleteSet.has(key) && armedBy[0].startsWith('DELETE of');
    if (a && onlyDirectDelete && t.enabled === 'O' && shapeProblems(a, t).length === 0) {
      const entry = { db: datname, schema: t.schema, table: t.table, trigger: t.trigger, function: t.function, timing: a.timing, events: a.events, row: a.row, enabledAtAudit: 'O', rowsDeleted: deleteSet.get(key) };
      guardTriggers.push(entry);
      listing.push({ ...base, status: 'ALLOWLISTED', armedBy, reason: `allowlisted guard: ${a.why}` });
      continue;
    }
    const why = a
      ? `allowlisted name, but ${[!onlyDirectDelete && 'it is armed by more than the direct DELETE of its manifest table', t.enabled !== 'O' && `its state is ${t.enabled}, expected O`, ...shapeProblems(a, t)].filter(Boolean).join('; ')}`
      : 'not in the db-clean guard-trigger allowlist (it may raise and abort the DELETE)';
    const b = { ...base, armedBy, reason: `trigger "${t.trigger}" on ${key} would fire (${armedBy.join(' | ')}); ${why}` };
    listing.push({ ...b, status: 'BLOCKER' });
    blockers.push(b);
  }
  const byKey = (x, y) => (`${x.db}.${x.table}.${x.trigger}` < `${y.db}.${y.table}.${y.trigger}` ? -1 : 1);
  return { listing: listing.sort(byKey), guardTriggers: guardTriggers.sort(byKey), blockers: blockers.sort(byKey), cascadeReached: [...reached.keys()].sort() };
}

/** Preflight of ONE database. `tables` = analysis.tables (entries with count > 0 form the delete set). Read only. */
export async function triggerPreflight(db, { svc, datname, tables }) {
  const triggers = await listUserTriggers(db);
  const deleteSet = new Map(tables.filter((t) => t.count > 0).map((t) => [`${t.schema || 'public'}.${t.table}`, t.count]));
  const { fks } = await loadSchema(db);
  const rowCounts = new Map();
  for (const key of new Set(triggers.map((t) => `${t.schema}.${t.table}`))) {
    const [schema, table] = key.split('.');
    rowCounts.set(key, await db.json(`SELECT count(*)::int FROM ${qt(schema, table)}`));
  }
  return classifyTriggers({ svc, datname, triggers, deleteSet, fks, rowCounts });
}

/** Preflight of every clean database of a plan. Returns { guardTriggers[], blockers[], listing:{svc:[]}, byDb }. */
export async function computeTriggerPreflight(ctx, plan, cleanDbs) {
  const out = { guardTriggers: [], blockers: [], listing: {}, cascadeReached: {} };
  for (const svc of cleanDbs) {
    const datname = ctx.profile.dbName(svc);
    const r = await triggerPreflight(ctx.dbs[svc], { svc, datname, tables: plan.analyses[svc].tables });
    out.guardTriggers.push(...r.guardTriggers);
    out.blockers.push(...r.blockers);
    out.listing[svc] = r.listing;
    out.cascadeReached[svc] = r.cascadeReached;
  }
  return out;
}

/** Pure check of the manifest section (no database). */
export function guardTriggerStaticProblems(manifest) {
  const gt = manifest.guardTriggers;
  if (!Array.isArray(gt)) return ['the manifest has no "guardTriggers" section (it was made by an older tool version)'];
  const problems = [];
  const seen = new Set();
  for (const e of gt) {
    const svc = manifest.environment?.dbs?.find((d) => d.datname === e.db)?.svc;
    const a = svc && allowlistEntry(svc, e.schema, e.table, e.trigger);
    const id = `${e.db}.${e.schema}.${e.table}.${e.trigger}`;
    if (!a) {
      problems.push(`manifest guardTriggers lists ${id}, which is not in the allowlist of this tool`);
      continue;
    }
    if (seen.has(id)) problems.push(`manifest guardTriggers lists ${id} twice`);
    seen.add(id);
    if (e.function !== a.function || e.timing !== a.timing || e.events !== a.events || e.row !== a.row || e.enabledAtAudit !== 'O') problems.push(`manifest guardTriggers entry ${id} differs from the pinned shape`);
    const mt = (manifest.tables || []).find((t) => t.db === e.db && t.schema === e.schema && t.table === e.table);
    if (!mt) problems.push(`manifest guardTriggers entry ${id}: its table is not in the delete list`);
    else if (mt.count !== e.rowsDeleted) problems.push(`manifest guardTriggers entry ${id}: rowsDeleted ${e.rowsDeleted} != manifest table count ${mt.count}`);
  }
  return problems;
}

/** Compare the manifest section of one database with the preflight re-derived now. Problems carry the "[datname]" prefix (see progressTouched in clean.mjs). */
export function guardTriggerLiveProblems(datname, manifestEntries, fresh) {
  const key = (e) => `${e.table}.${e.trigger}.${e.rowsDeleted}.${e.enabledAtAudit}.${e.function}`;
  const a = manifestEntries.filter((e) => e.db === datname).map(key).sort();
  const b = fresh.guardTriggers.filter((e) => e.db === datname).map(key).sort();
  const problems = [];
  if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`[${datname}] guard triggers differ from the manifest: manifest ${JSON.stringify(a)}, live ${JSON.stringify(b)}`);
  for (const bl of fresh.blockers.filter((x) => x.db === datname)) problems.push(`[${datname}] blocker triggerGuards: ${bl.reason}`);
  return problems;
}

// ------------------------------------------------------------------------------------------------- the statements H2 runs
/** Only ever called with an allowlist entry, never with names taken from the manifest. */
export const disableTriggerSql = (a) => `ALTER TABLE ${qt(a.schema, a.table)} DISABLE TRIGGER ${q(a.trigger)}`;
export const enableTriggerSql = (a) => `ALTER TABLE ${qt(a.schema, a.table)} ENABLE TRIGGER ${q(a.trigger)}`;
export const triggerStateSql = (a) => `SELECT COALESCE(json_agg(t.tgenabled::text), '[]'::json) FROM pg_trigger t WHERE t.tgrelid = '${qt(a.schema, a.table)}'::regclass AND t.tgname = '${String(a.trigger).replace(/'/g, "''")}' AND NOT t.tgisinternal`;
