/**
 * db-clean - the selection engine shared by `audit`, `audit --recheck`, `clean` (per-DB transaction) and `verify`.
 *
 * analyzeDb(db, svc, params, opts) evaluates the policy against ONE database and returns plain data:
 *   - which tables exist / are classified / have a usable primary key,
 *   - for every non-PRESERVE table: the normalised primary-key tuples of the rows to delete (sorted) + fingerprint,
 *   - the tuples + row hashes of the rows that are KEPT (the preserved accounts' rows and their dependencies),
 *   - foreign-key conflicts (a kept row whose parent would be deleted) and a delete order (cycle -> blocker).
 * It only ever runs SELECTs.
 */
import { fingerprintOf, sortTuples, hasDuplicateTuples, sha256Hex } from './util.mjs';
import { loadSchema, normExpr, q, qt, deleteOrder } from './schema.mjs';
import { POLICY, makeKeep, volatileColumns } from './policy.mjs';

const GUARD = '($1::text[] IS NOT NULL AND $2::text[] IS NOT NULL AND $3::text[] IS NOT NULL)';
export const paramList = (p) => [p.userIds, p.emails, p.keptGymIds];

export function rulesFor(svc, policyOverride) {
  const src = policyOverride || POLICY;
  if (!src[svc]) throw new Error(`no policy for service ${svc}`);
  return src[svc];
}

const pkExprs = (t) => t.pk.map((c, i) => normExpr(c, t.pkTypes[i])).join(', ');

/**
 * @param opts.mode 'full' (keys + kept hashes) | 'count' (counts only: partner databases that are report-only)
 * @param opts.stats true -> also the report extras (dropped-despite-preserved-party, per-account dependencies)
 */
export async function analyzeDb(db, svc, params, opts = {}) {
  const mode = opts.mode || 'full';
  const rules = rulesFor(svc, opts.policy);
  const K = makeKeep(rules);
  const { tables: schemaTables, fks } = await loadSchema(db);
  const out = {
    svc,
    unclassified: [],
    missingFromDb: [],
    noPk: [],
    badPk: [],
    tables: [],
    preserved: [],
    preserveCounts: {},
    conflicts: [],
    cycle: null,
    order: null,
    stats: { dropped: [], deps: [] },
  };
  const present = new Map();
  for (const [key, t] of schemaTables) {
    if (t.schema !== 'public') {
      out.unclassified.push(key);
      continue;
    }
    present.set(t.name, t);
  }
  for (const name of [...present.keys()].sort()) if (!rules[name]) out.unclassified.push(`public.${name}`);
  for (const name of Object.keys(rules).sort()) if (!present.has(name)) out.missingFromDb.push(name);

  const P = paramList(params);
  const names = [...present.keys()].filter((n) => rules[n]).sort();

  for (const name of names) {
    const rule = rules[name];
    const t = present.get(name);
    if (rule.kind === 'PRESERVE') {
      out.preserveCounts[name] = await db.json(`SELECT count(*)::int FROM ${qt('public', name)}`);
      continue;
    }
    if (t.pk.length === 0) {
      out.noPk.push(name);
      continue;
    }
    try {
      pkExprs(t);
    } catch (e) {
      out.badPk.push({ table: name, reason: e.message });
      continue;
    }
    const keep = K(name, 't');
    const total = await db.json(`SELECT count(*)::int FROM ${qt('public', name)}`);
    const entry = {
      table: name,
      schema: 'public',
      pk: t.pk,
      pkTypes: t.pkTypes,
      total,
      count: 0,
      keepCount: 0,
      keys: [],
      fingerprint: sha256Hex(''),
      volatile: volatileColumns(t.columns),
      note: rule.note,
    };
    if (mode === 'count') {
      entry.count = await db.json(`SELECT count(*)::int FROM ${qt('public', name)} t WHERE NOT COALESCE(${keep}, FALSE) AND ${GUARD}`, P);
      entry.keepCount = total - entry.count;
      out.tables.push(entry);
      continue;
    }
    const keys = await db.json(
      `SELECT COALESCE(json_agg(json_build_array(${pkExprs(t)})), '[]'::json) FROM ${qt('public', name)} t WHERE NOT COALESCE(${keep}, FALSE) AND ${GUARD}`,
      P,
    );
    entry.keys = sortTuples(keys);
    entry.count = entry.keys.length;
    entry.fingerprint = fingerprintOf(entry.keys);
    entry.keepCount = total - entry.count;
    out.tables.push(entry);
    if (entry.keepCount > 0) {
      const rows = await db.json(
        `SELECT COALESCE(json_agg(json_build_array(${pkExprs(t)}, encode(sha256(convert_to((to_jsonb(t) - $4::text[])::text, 'UTF8')), 'hex'))), '[]'::json)
           FROM ${qt('public', name)} t WHERE COALESCE(${keep}, FALSE) AND ${GUARD}`,
        [...P, entry.volatile],
      );
      const n = t.pk.length;
      const entries = rows.map((r) => ({ pkTuple: r.slice(0, n), rowHash: r[n] }));
      entries.sort((a, b) => {
        const x = JSON.stringify(a.pkTuple);
        const y = JSON.stringify(b.pkTuple);
        return x < y ? -1 : x > y ? 1 : 0;
      });
      out.preserved.push({ table: name, schema: 'public', pk: t.pk, entries });
    }
  }

  // ---- foreign keys: a kept row must never lose its parent (RESTRICT would abort, CASCADE / SET NULL would silently change data)
  const modeFull = mode === 'full';
  for (const f of fks) {
    if (f.schema !== 'public' || f.refSchema !== 'public') continue;
    const child = f.table;
    const parent = f.refTable;
    const cr = rules[child];
    const pr = rules[parent];
    if (!cr || !pr || !present.has(child) || !present.has(parent)) continue;
    if (pr.kind === 'PRESERVE') continue;
    if (child === parent) continue;
    const covered = (cr.covers || []).some((c) => c.parent === parent && c.pairs.length === f.cols.length && c.pairs.every(([fk, ref], i) => fk === f.cols[i] && ref === f.refCols[i]));
    if (covered || !modeFull) continue;
    const childKeep = cr.kind === 'PRESERVE' ? 'TRUE' : K(child, 'c');
    const cnt = await db.json(
      `SELECT count(*)::int FROM ${qt('public', child)} c
        WHERE COALESCE(${childKeep}, FALSE) AND ${f.cols.map((c) => `c.${q(c)} IS NOT NULL`).join(' AND ')}
          AND NOT EXISTS (SELECT 1 FROM ${qt('public', parent)} p WHERE ${f.refCols.map((rc, i) => `p.${q(rc)} = c.${q(f.cols[i])}`).join(' AND ')} AND COALESCE(${K(parent, 'p')}, FALSE))
          AND ${GUARD}`,
      P,
    );
    if (cnt > 0) out.conflicts.push({ child, parent, cols: f.cols, refCols: f.refCols, onDelete: f.onDelete, rows: cnt, childIsPreserved: cr.kind === 'PRESERVE' });
  }

  const delTables = out.tables.filter((t) => t.count > 0).map((t) => `public.${t.table}`);
  const ord = deleteOrder(delTables, fks);
  out.order = ord.order;
  out.cycle = ord.cycle;

  if (opts.stats) await collectStats(db, svc, rules, K, present, params, out);
  return out;
}

async function collectStats(db, svc, rules, K, present, params, out) {
  const P = paramList(params);
  for (const name of Object.keys(rules).sort()) {
    const rule = rules[name];
    if (!present.has(name) || rule.kind === 'PRESERVE' || !rule.owners || rule.owners.length === 0) continue;
    const anyOwner = rule.owners.map((c) => `t.${q(c)} = ANY($1::text[])`).join(' OR ');
    const keep = K(name, 't');
    // rows that name a preserved account but are NOT kept (the other party / a parent is deleted)
    const dropped = await db.json(
      `SELECT count(*)::int FROM ${qt('public', name)} t WHERE (${anyOwner}) AND NOT COALESCE(${keep}, FALSE) AND ${GUARD}`,
      P,
    );
    if (dropped > 0) out.stats.dropped.push({ table: name, rows: dropped });
    for (const c of rule.owners) {
      const rows = await db.json(
        `SELECT COALESCE(json_agg(json_build_object('userId', x.u, 'rows', x.n)), '[]'::json) FROM
           (SELECT t.${q(c)} AS u, count(*)::int AS n FROM ${qt('public', name)} t WHERE t.${q(c)} = ANY($1::text[]) GROUP BY 1) x`,
        [params.userIds],
      );
      for (const r of rows) out.stats.deps.push({ table: name, column: c, userId: r.userId, rows: r.rows });
    }
  }
}

// ------------------------------------------------------------------ comparing an analysis with an approved manifest
/** Plan 12.15 item 2, steps 4-6 for one database. Returns an array of problems (empty = identical). */
export function compareWithManifest(analysis, mTables, mPreserved, { checkPreserved = true } = {}) {
  const problems = [];
  const mBy = new Map(mTables.map((t) => [t.table, t]));
  const aBy = new Map(analysis.tables.filter((t) => t.count > 0).map((t) => [t.table, t]));
  for (const [name, m] of mBy) {
    const a = analysis.tables.find((t) => t.table === name);
    if (!a) {
      problems.push(`${name}: table does not exist (or has no usable key) any more`);
      continue;
    }
    // step 4: the REAL primary key: same column names in the same order, same types
    if (JSON.stringify(a.pk) !== JSON.stringify(m.pk)) problems.push(`${name}: primary key columns differ (manifest ${JSON.stringify(m.pk)}, database ${JSON.stringify(a.pk)})`);
    if (JSON.stringify(a.pkTypes) !== JSON.stringify(m.pkTypes)) problems.push(`${name}: primary key types differ (manifest ${JSON.stringify(m.pkTypes)}, database ${JSON.stringify(a.pkTypes)})`);
  }
  for (const name of aBy.keys()) if (!mBy.has(name)) problems.push(`${name}: ${aBy.get(name).count} row(s) would now be deleted but the table is not in the approved manifest`);
  if (problems.length) return problems;
  // step 5: the real tuple sets, element by element, both directions
  for (const [name, m] of mBy) {
    const a = aBy.get(name);
    if (!a) {
      problems.push(`${name}: manifest expects ${m.count} row(s) to delete, the database now has none`);
      continue;
    }
    const sa = new Set(a.keys.map((t) => JSON.stringify(t)));
    const sm = new Set(m.keys.map((t) => JSON.stringify(t)));
    const extra = a.keys.filter((t) => !sm.has(JSON.stringify(t)));
    const missing = m.keys.filter((t) => !sa.has(JSON.stringify(t)));
    if (extra.length || missing.length) {
      problems.push(`${name}: tuple sets differ - ${extra.length} extra in database (would be deleted but not approved): ${JSON.stringify(extra.slice(0, 50))}; ${missing.length} approved but no longer selected: ${JSON.stringify(missing.slice(0, 50))}`);
    }
  }
  // step 6: the kept rows (allowlist + dependencies) - hash of every row against the hash stored in the manifest
  if (checkPreserved) {
    const mp = new Map(mPreserved.map((t) => [t.table, t]));
    const ap = new Map(analysis.preserved.map((t) => [t.table, t]));
    for (const [name, m] of mp) {
      const a = ap.get(name);
      if (!a) {
        problems.push(`${name}: kept rows listed in the manifest are gone`);
        continue;
      }
      const ah = new Map(a.entries.map((e) => [JSON.stringify(e.pkTuple), e.rowHash]));
      const mh = new Map(m.entries.map((e) => [JSON.stringify(e.pkTuple), e.rowHash]));
      const bad = [];
      for (const [k, h] of mh) if (!ah.has(k) || ah.get(k) !== h) bad.push(k);
      const added = [...ah.keys()].filter((k) => !mh.has(k));
      if (bad.length) problems.push(`${name}: ${bad.length} kept row(s) changed or vanished since the audit (rowHash): ${bad.slice(0, 50).join(' ')}`);
      if (added.length) problems.push(`${name}: ${added.length} kept row(s) appeared since the audit: ${added.slice(0, 50).join(' ')}`);
    }
    for (const name of ap.keys()) if (!mp.has(name)) problems.push(`${name}: kept rows appeared that are not in the manifest`);
  }
  return problems;
}

/** Internal consistency of a manifest table entry (12.15 item 2, step 2). */
export function checkManifestTableConsistency(t) {
  const problems = [];
  if (!Array.isArray(t.keys)) return [`${t.db}.${t.table}: keys missing`];
  if (t.count !== t.keys.length) problems.push(`${t.db}.${t.table}: count ${t.count} != keys.length ${t.keys.length}`);
  for (const k of t.keys) {
    if (!Array.isArray(k) || k.length !== t.pk.length || k.some((x) => typeof x !== 'string')) {
      problems.push(`${t.db}.${t.table}: malformed tuple ${JSON.stringify(k).slice(0, 80)}`);
      break;
    }
  }
  const sorted = sortTuples(t.keys);
  if (JSON.stringify(sorted) !== JSON.stringify(t.keys)) problems.push(`${t.db}.${t.table}: keys are not in canonical order`);
  if (hasDuplicateTuples(sorted)) problems.push(`${t.db}.${t.table}: keys contain a duplicate tuple`);
  if (fingerprintOf(sorted) !== t.fingerprint) problems.push(`${t.db}.${t.table}: fingerprint recomputed from keys does not match the stored fingerprint`);
  if (t.pk.length !== t.pkTypes.length) problems.push(`${t.db}.${t.table}: pk / pkTypes length differ`);
  return problems;
}

// ------------------------------------------------------------------ deletion by the REAL primary key (12.14 item 5)
export function deleteStatement(t) {
  const typed = t.pk.map((_, i) => `$${i + 1}::text[]::${t.pkTypes[i]}[]`);
  const where =
    t.pk.length === 1
      ? `${q(t.pk[0])} = ANY(${typed[0]})`
      : `(${t.pk.map(q).join(', ')}) IN (SELECT * FROM unnest(${typed.join(', ')}))`;
  const ret = t.pk.map((c, i) => `${normExpr(c, t.pkTypes[i])} AS c${i}`).join(', ');
  const cols = t.pk.map((_, i) => `d.c${i}`).join(', ');
  return `WITH d AS (DELETE FROM ${qt(t.schema || 'public', t.table)} WHERE ${where} RETURNING ${ret}) SELECT COALESCE(json_agg(json_build_array(${cols})), '[]'::json) FROM d`;
}

/** Delete the given tuples in batches; returns the tuples that were actually removed (RETURNING), normalised and sorted. */
export async function deleteKeys(db, t, keys, batch = 5000) {
  const sql = deleteStatement(t);
  const removed = [];
  for (let i = 0; i < keys.length; i += batch) {
    const slice = keys.slice(i, i + batch);
    const arrays = t.pk.map((_, c) => slice.map((tuple) => tuple[c]));
    const rows = await db.json(sql, arrays);
    for (const r of rows) removed.push(r);
  }
  return sortTuples(removed);
}

export async function tableCounts(db, tableNames) {
  const out = {};
  for (const n of tableNames) out[n] = await db.json(`SELECT count(*)::int FROM ${qt('public', n)}`);
  return out;
}
export async function allTableCounts(db) {
  const { tables } = await loadSchema(db);
  return tableCounts(db, [...tables.values()].filter((t) => t.schema === 'public').map((t) => t.name).sort());
}
