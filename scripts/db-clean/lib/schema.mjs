/**
 * db-clean - catalog introspection (plan 12.14 item 5 / 12.15 item 2): primary keys are READ from pg_index (never guessed as "id"),
 * foreign keys from pg_constraint. Also the hba / ACL / role snapshots (12.15 item 1-2).
 */
import { Refused, sha256Hex } from './util.mjs';

/** Supported primary-key column types -> SQL that normalises a value to text (12.14 item 5: uuid lowercase, ints decimal, timestamptz ISO UTC). */
export function normExpr(col, type) {
  const c = `"${col}"`;
  const t = type.toLowerCase();
  if (t === 'text' || t.startsWith('character varying') || t.startsWith('character(') || t === 'name') return `${c}::text`;
  if (t === 'uuid') return `lower(${c}::text)`;
  if (t === 'smallint' || t === 'integer' || t === 'bigint') return `${c}::text`;
  if (t.startsWith('numeric')) return `${c}::text`;
  if (t === 'boolean') return `${c}::text`;
  if (t === 'date') return `to_char(${c}, 'YYYY-MM-DD')`;
  if (t.startsWith('timestamp with time zone')) return `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  if (t.startsWith('timestamp without time zone') || t.startsWith('timestamp(')) return `to_char(${c}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
  throw new Refused(`primary key column "${col}" has unsupported type "${type}"`, 'PK_TYPE_UNSUPPORTED');
}
export const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
export const qt = (schema, table) => `${q(schema)}.${q(table)}`;

/** Load tables / columns / pk / fk of every non-system schema. Result is plain data (JSON-safe). */
export async function loadSchema(db) {
  const cols = await db.json(`
    SELECT COALESCE(json_agg(json_build_object('schema', n.nspname, 'table', c.relname, 'column', a.attname,
             'type', format_type(a.atttypid, a.atttypmod)) ORDER BY n.nspname, c.relname, a.attnum), '[]'::json)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
       AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'`);
  const pks = await db.json(`
    SELECT COALESCE(json_agg(json_build_object('schema', n.nspname, 'table', c.relname, 'column', a.attname,
             'type', format_type(a.atttypid, a.atttypmod), 'ord', k.ord) ORDER BY n.nspname, c.relname, k.ord), '[]'::json)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indisprimary AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
  const fks = await db.json(`
    SELECT COALESCE(json_agg(json_build_object('name', con.conname, 'schema', n.nspname, 'table', c.relname,
             'refSchema', rn.nspname, 'refTable', rc.relname, 'onDelete', con.confdeltype::text,
             'cols', (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
             'refCols', (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum)
           ) ORDER BY n.nspname, c.relname, con.conname), '[]'::json)
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
     WHERE con.contype = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
  const tables = new Map();
  for (const c of cols) {
    const key = `${c.schema}.${c.table}`;
    if (!tables.has(key)) tables.set(key, { schema: c.schema, name: c.table, columns: [], pk: [], pkTypes: [] });
    tables.get(key).columns.push({ name: c.column, type: c.type });
  }
  for (const p of pks) {
    const t = tables.get(`${p.schema}.${p.table}`);
    if (t) {
      t.pk.push(p.column);
      t.pkTypes.push(p.type);
    }
  }
  return { tables, fks };
}

/** Delete order: children before parents. Edges only between the given tables. Returns { order, cycle }. Self references count as a cycle. */
export function deleteOrder(tableKeys, fks) {
  const set = new Set(tableKeys);
  const deps = new Map(tableKeys.map((k) => [k, new Set()])); // parent -> children that must go first
  for (const f of fks) {
    const child = `${f.schema}.${f.table}`;
    const parent = `${f.refSchema}.${f.refTable}`;
    if (!set.has(child) || !set.has(parent)) continue;
    if (child === parent) return { order: null, cycle: [child] };
    deps.get(parent).add(child);
  }
  const order = [];
  const state = new Map();
  let cycle = null;
  const visit = (k, stack) => {
    if (cycle) return;
    const s = state.get(k);
    if (s === 2) return;
    if (s === 1) {
      cycle = [...stack.slice(stack.indexOf(k)), k];
      return;
    }
    state.set(k, 1);
    for (const ch of [...deps.get(k)].sort()) visit(ch, [...stack, k]);
    state.set(k, 2);
    order.push(k);
  };
  for (const k of [...tableKeys].sort()) visit(k, []);
  if (cycle) return { order: null, cycle };
  // The DFS pushes a table AFTER all of its children (post-order over "parent -> children"): `order` is already children first.
  return { order, cycle: null };
}

// ------------------------------------------------------------------ cluster-level snapshots
export function normalizeHbaRules(rows) {
  return rows.map((r) => ({
    line: r.line_number,
    type: r.type,
    database: r.database,
    user: r.user_name,
    address: r.address ?? null,
    netmask: r.netmask ?? null,
    method: r.auth_method,
    options: r.options ?? null,
    error: r.error ?? null,
  }));
}

export async function readHba(db) {
  const path = await db.json(`SELECT to_json(current_setting('hba_file'))`);
  const text = await db.json(`SELECT to_json(pg_read_file(current_setting('hba_file')))`);
  const rules = await db.json(`SELECT COALESCE(json_agg(r ORDER BY line_number), '[]'::json) FROM pg_hba_file_rules r`);
  return { path, sha256: sha256Hex(Buffer.from(text, 'utf8')), text, rules: normalizeHbaRules(rules) };
}

/** Roles (non pg_*), the ACL of the given databases (raw datacl incl. NULL, plus aclexplode). */
export async function readAclAndRoles(db, datnames) {
  const databases = await db.json(
    `SELECT COALESCE(json_agg(json_build_object(
        'datname', d.datname, 'datacl_raw', d.datacl::text,
        'aclexplode', (SELECT COALESCE(json_agg(json_build_object('grantor', ga.rolname, 'grantee', COALESCE(ge.rolname, 'PUBLIC'), 'privilege', x.privilege_type, 'grantable', x.is_grantable)
                              ORDER BY COALESCE(ge.rolname, 'PUBLIC'), x.privilege_type, ga.rolname), '[]'::json)
                         FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) x
                         JOIN pg_roles ga ON ga.oid = x.grantor LEFT JOIN pg_roles ge ON ge.oid = x.grantee)
      ) ORDER BY d.datname), '[]'::json)
     FROM pg_database d WHERE d.datname = ANY($1::text[])`,
    [datnames],
  );
  const roles = await db.json(
    `SELECT COALESCE(json_agg(json_build_object('rolname', r.rolname, 'rolsuper', r.rolsuper, 'rolcanlogin', r.rolcanlogin,
        'rolinherit', r.rolinherit, 'rolbypassrls', r.rolbypassrls, 'rolcreaterole', r.rolcreaterole, 'rolcreatedb', r.rolcreatedb,
        'rolconnlimit', r.rolconnlimit,
        'memberOf', (SELECT COALESCE(json_agg(g.rolname ORDER BY g.rolname), '[]'::json) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid)
      ) ORDER BY r.rolname), '[]'::json)
     FROM pg_roles r WHERE r.rolname !~ '^pg_'`,
  );
  return { databases, roles };
}

/** Compare two ACL/role snapshots; maintenance role is ignored on `ignoreRole`. Returns a list of human-readable differences. */
export function diffAcl(expected, actual, { ignoreRole } = {}) {
  const diffs = [];
  const eRoles = new Map(expected.roles.filter((r) => r.rolname !== ignoreRole).map((r) => [r.rolname, r]));
  const aRoles = new Map(actual.roles.filter((r) => r.rolname !== ignoreRole).map((r) => [r.rolname, r]));
  for (const [n, r] of eRoles) {
    const a = aRoles.get(n);
    if (!a) diffs.push(`role ${n} missing`);
    else if (JSON.stringify(a) !== JSON.stringify(r)) diffs.push(`role ${n} changed: expected ${JSON.stringify(r)} got ${JSON.stringify(a)}`);
  }
  for (const n of aRoles.keys()) if (!eRoles.has(n)) diffs.push(`unexpected role ${n}`);
  const eDb = new Map(expected.databases.map((d) => [d.datname, d]));
  const aDb = new Map(actual.databases.map((d) => [d.datname, d]));
  for (const [n, d] of eDb) {
    const a = aDb.get(n);
    if (!a) diffs.push(`database ${n} missing`);
    else if (JSON.stringify(a) !== JSON.stringify(d)) diffs.push(`database ${n} ACL changed: expected ${JSON.stringify(d)} got ${JSON.stringify(a)}`);
  }
  for (const n of aDb.keys()) if (!eDb.has(n)) diffs.push(`unexpected database ${n}`);
  return diffs;
}
