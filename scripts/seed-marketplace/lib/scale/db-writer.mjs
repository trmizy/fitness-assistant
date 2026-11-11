// Fast parameterized UNNEST batch writer (batch=1,000) with per-batch count reconciliation,
// backfill retry on mismatch, fail-fast diagnostics, and gymini.compat_writer support.

export class BatchReconciliationError extends Error {
  constructor(details) {
    super(
      `[db-writer] reconciliation failed on ${details.table} batch ${details.batchIndex}: expected=${details.expected}, actual=${details.actual}`
    );
    this.name = "BatchReconciliationError";
    this.details = details;
  }
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function serializeValue(val, col) {
  if (val === undefined || val === null) return null;
  if (col.kind === "text[]" || col.kind === "int4[]" || col.kind === "enum[]") {
    return JSON.stringify(val);
  }
  if (col.cast === "jsonb") {
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  if (val instanceof Date) {
    return col.cast === "date" ? val.toISOString().slice(0, 10) : val.toISOString();
  }
  return val;
}

function unnestTypeFor(col) {
  if (col.kind === "text[]" || col.kind === "int4[]" || col.kind === "enum[]") return "jsonb[]";
  return `${col.cast}[]`;
}

function selectExprFor(col, alias) {
  const qAlias = quoteIdent(alias);
  if (col.kind === "text[]") {
    return `CASE WHEN ${qAlias} IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(${qAlias})) END`;
  }
  if (col.kind === "int4[]") {
    return `CASE WHEN ${qAlias} IS NULL THEN NULL ELSE ARRAY(SELECT (jsonb_array_elements_text(${qAlias}))::int4) END`;
  }
  if (col.kind === "enum[]") {
    return `CASE WHEN ${qAlias} IS NULL THEN ARRAY[]::${col.enumType}[] ELSE ARRAY(SELECT (jsonb_array_elements_text(${qAlias}))::${col.enumType}) END`;
  }
  return qAlias;
}

/** Builds parameterized SQL + column-wise array values for a single UNNEST INSERT ... ON CONFLICT DO NOTHING. */
export function buildUnnestInsertSql(table, columns, rows, conflictTarget = '("id")') {
  const aliases = columns.map((_, idx) => `c_${idx}`);
  const colNamesSql = columns.map((c) => quoteIdent(c.name)).join(", ");
  const unnestArgsSql = columns
    .map((c, idx) => `$${idx + 1}::${unnestTypeFor(c)}`)
    .join(", ");
  const selectSql = columns.map((c, idx) => selectExprFor(c, aliases[idx])).join(", ");

  const params = columns.map((col) => {
    const arr = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      arr[i] = serializeValue(rows[i][col.name], col);
    }
    return arr;
  });

  const sql = `
    INSERT INTO ${quoteIdent(table)} (${colNamesSql})
    SELECT ${selectSql}
    FROM UNNEST(${unnestArgsSql}) AS t(${aliases.join(", ")})
    ON CONFLICT ${conflictTarget} DO NOTHING
  `;
  return { sql, params };
}

/** Verifies actual row presence in DB matches expected keys of the batch. */
async function countBatchInDb(client, table, rows, keyMode) {
  if (keyMode === "gym_amenities") {
    const gymIds = rows.map((r) => r.gym_id);
    const amenityIds = rows.map((r) => r.amenity_id);
    const { rows: out } = await client.query(
      `SELECT count(*)::int AS n
       FROM gym_amenities g
       JOIN UNNEST($1::text[], $2::text[]) AS t(gym_id, amenity_id)
         ON g.gym_id = t.gym_id AND g.amenity_id = t.amenity_id`,
      [gymIds, amenityIds]
    );
    return out[0].n;
  }
  const ids = rows.map((r) => r.id);
  const { rows: out } = await client.query(
    `SELECT count(*)::int AS n FROM ${quoteIdent(table)} WHERE id = ANY($1::text[])`,
    [ids]
  );
  return out[0].n;
}

async function findMissingBatchRows(client, table, rows, keyMode) {
  if (keyMode === "gym_amenities") {
    const gymIds = rows.map((r) => r.gym_id);
    const amenityIds = rows.map((r) => r.amenity_id);
    const { rows: present } = await client.query(
      `SELECT g.gym_id, g.amenity_id
       FROM gym_amenities g
       JOIN UNNEST($1::text[], $2::text[]) AS t(gym_id, amenity_id)
         ON g.gym_id = t.gym_id AND g.amenity_id = t.amenity_id`,
      [gymIds, amenityIds]
    );
    const seen = new Set(present.map((p) => `${p.gym_id}:${p.amenity_id}`));
    return rows.filter((r) => !seen.has(`${r.gym_id}:${r.amenity_id}`));
  }
  const ids = rows.map((r) => r.id);
  const { rows: present } = await client.query(
    `SELECT id FROM ${quoteIdent(table)} WHERE id = ANY($1::text[])`,
    [ids]
  );
  const seen = new Set(present.map((p) => p.id));
  return rows.filter((r) => !seen.has(r.id));
}

/**
 * Inserts one batch (up to batchSize rows) inside a transaction, runs expected-vs-actual reconciliation,
 * performs one targeted backfill insert if partial rows were missed (e.g. crash window), and fails fast if still mismatched.
 */
export async function writeBatchWithReconciliation({
  pool,
  table,
  columns,
  rows,
  batchIndex,
  setCompatWriter = false,
  conflictTarget = '("id")',
  keyMode = "id",
}) {
  if (!rows.length) return { expected: 0, actual: 0, inserted: 0, backfilled: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (setCompatWriter) {
      await client.query("SET LOCAL gymini.compat_writer = 'seed'");
    }
    const { sql, params } = buildUnnestInsertSql(table, columns, rows, conflictTarget);
    const res = await client.query(sql, params);
    let actual = await countBatchInDb(client, table, rows, keyMode);
    let backfilled = 0;

    if (actual !== rows.length) {
      const missing = await findMissingBatchRows(client, table, rows, keyMode);
      if (missing.length > 0) {
        const bf = buildUnnestInsertSql(table, columns, missing, conflictTarget);
        const bfRes = await client.query(bf.sql, bf.params);
        backfilled = bfRes.rowCount ?? 0;
        actual = await countBatchInDb(client, table, rows, keyMode);
      }
      if (actual !== rows.length) {
        throw new BatchReconciliationError({
          table,
          batchIndex,
          expected: rows.length,
          actual,
          sampleMissing: missing.slice(0, 5).map((r) => r.id ?? `${r.gym_id}:${r.amenity_id}`),
        });
      }
    }

    await client.query("COMMIT");
    return { expected: rows.length, actual, inserted: res.rowCount ?? 0, backfilled };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Standalone batch reconciliation checker (used by --resume to re-verify last recorded batch). */
export async function reconcileBatchCounts({ pool, table, rows, batchIndex, keyMode = "id" }) {
  if (!rows.length) return { expected: 0, actual: 0 };
  const client = await pool.connect();
  try {
    const actual = await countBatchInDb(client, table, rows, keyMode);
    if (actual !== rows.length) {
      throw new BatchReconciliationError({ table, batchIndex, expected: rows.length, actual });
    }
    return { expected: rows.length, actual };
  } finally {
    client.release();
  }
}

