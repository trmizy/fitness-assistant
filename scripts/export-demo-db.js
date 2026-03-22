const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const OUTPUT_PATH = path.join(ROOT_DIR, 'demo-db-export.json');

const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'password_hash',
  'token',
  'refresh_token',
  'secret',
  'otp',
];

function loadEnvironment() {
  if (fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH });
    console.log(`[env] Loaded .env from ${ENV_PATH}`);
  } else {
    console.warn('[env] .env not found at project root, using process env variables only.');
  }
}

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is missing. Please set it in .env at project root.');
  }
  return url;
}

function escapeIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function isSensitiveField(columnName) {
  const normalized = String(columnName || '').toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some(
    (pattern) => normalized === pattern || normalized.includes(pattern),
  );
}

function maskRow(row) {
  const masked = { ...row };
  for (const key of Object.keys(masked)) {
    if (isSensitiveField(key)) {
      masked[key] = '***MASKED***';
    }
  }
  return masked;
}

async function getTables(client) {
  const query = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const result = await client.query(query);
  return result.rows.map((r) => r.table_name);
}

async function getPrimaryKeys(client, tableName) {
  const query = `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = $1
    ORDER BY kcu.ordinal_position;
  `;
  const result = await client.query(query, [tableName]);
  return result.rows.map((r) => r.column_name);
}

async function getForeignKeys(client, tableName) {
  const query = `
    SELECT
      kcu.column_name,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = $1
    ORDER BY kcu.column_name;
  `;
  const result = await client.query(query, [tableName]);
  return result.rows;
}

async function getColumns(client, tableName, primaryKeys, foreignKeys) {
  const fkByColumn = new Map(foreignKeys.map((fk) => [fk.column_name, fk]));
  const pkSet = new Set(primaryKeys);

  const query = `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position;
  `;

  const result = await client.query(query, [tableName]);
  return result.rows.map((col) => {
    const fk = fkByColumn.get(col.column_name);
    return {
      columnName: col.column_name,
      dataType: col.data_type,
      isNullable: col.is_nullable === 'YES',
      isPrimaryKey: pkSet.has(col.column_name),
      foreignKey: fk
        ? {
            referencedTable: fk.referenced_table,
            referencedColumn: fk.referenced_column,
          }
        : null,
    };
  });
}

async function getSampleRows(client, tableName) {
  const query = `SELECT * FROM public.${escapeIdentifier(tableName)} LIMIT 50;`;
  const result = await client.query(query);
  return result.rows.map(maskRow);
}

async function exportDatabase() {
  loadEnvironment();
  const databaseUrl = getDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl });

  const output = {
    databaseType: 'postgresql',
    exportedAt: new Date().toISOString(),
    tables: [],
  };

  let successCount = 0;

  try {
    await client.connect();
    console.log('[db] Connected to PostgreSQL');

    const tables = await getTables(client);
    console.log(`[db] Found ${tables.length} tables in schema public`);

    for (const tableName of tables) {
      console.log(`[export] Processing table: ${tableName}`);

      try {
        const primaryKeys = await getPrimaryKeys(client, tableName);
        const foreignKeys = await getForeignKeys(client, tableName);
        const columns = await getColumns(client, tableName, primaryKeys, foreignKeys);
        const sampleRows = await getSampleRows(client, tableName);

        output.tables.push({
          tableName,
          columns,
          primaryKeys,
          foreignKeys: foreignKeys.map((fk) => ({
            columnName: fk.column_name,
            referencedTable: fk.referenced_table,
            referencedColumn: fk.referenced_column,
          })),
          sampleRows,
        });

        successCount += 1;
        console.log(
          `[export] Done: ${tableName} (${columns.length} columns, ${sampleRows.length} sample rows)`,
        );
      } catch (tableError) {
        console.error(
          `[export] Failed table ${tableName}: ${tableError.message || tableError}`,
        );
      }
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`[export] Wrote output file: ${OUTPUT_PATH}`);
    console.log(`[export] Total tables exported successfully: ${successCount}`);
  } catch (error) {
    console.error(`[export] Fatal error: ${error.message || error}`);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
      console.log('[db] Connection closed');
    } catch (closeError) {
      console.warn(`[db] Failed to close connection cleanly: ${closeError.message || closeError}`);
    }
  }
}

exportDatabase();
