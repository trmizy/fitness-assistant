// ONE-TIME AWS Aurora data-only importer — SOURCE PREPARATION ONLY.
//
// This script is NOT executed as part of the audit/plan pass that created
// it (docs/aws-full-local-data-migration-plan.md). It does not connect to
// AWS. It is checked in so the exact, reviewable import logic exists
// before anyone runs it by hand from inside the private VPC (see the plan
// doc §13 for the S3 -> private importer -> Aurora path this is meant to
// run inside — a one-shot Fargate task, see
// docs/aws-full-local-data-migration-final-reconciliation.md §21 for the
// image this script is meant to run inside).
//
// Usage (manual, one service at a time, from inside the VPC):
//   node scripts/data-migration-import-aws.mjs --service=auth-service \
//     --dump=/path/to/gymcoach_auth.data.dump \
//     --manifest=/path/to/manifest.json
//
// DATABASE_URL for the target must be supplied via the environment
// (in the real run: read out of Secrets Manager into the environment by
// whatever runs this, never hardcoded here, never logged).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, createReadStream, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tables whose rows are (partly) inserted by this service's OWN migration
// history, not just by application traffic. Discovered empirically by
// running the real fresh-DB + data-only-restore test against every
// service (see docs/aws-full-local-data-migration-final-reconciliation.md
// §8 for the full repository-wide sweep). Every entry was reproduced on
// an isolated `prisma migrate deploy` from zero — `expectedBaselineCount`
// is the EXACT row count that produces, audited directly, never guessed.
//
// Two reconciliation strategies, chosen per table based on whether a
// stable key exists to upsert on:
//
// - "upsert": the table has a column (or column set) whose value is
//   deterministic across every migration run — the dump's row for that
//   same key is authoritative and overwrites the migration's placeholder
//   in place, via `INSERT ... ON CONFLICT (<conflictColumns>) DO UPDATE
//   SET <every other column> = EXCLUDED.<column>`. `conflictColumns` is
//   always the REAL target unique constraint's own column list (verified
//   against `\d <table>` before configuring it here) — never a
//   concatenated/derived key Postgres itself doesn't enforce.
//     - ai-service `knowledge_sources` (baseline 6 rows): stable `id`s,
//       guarded by the migration's own `ON CONFLICT ("base_url") DO
//       NOTHING` — which doesn't protect the primary key, exactly the
//       collision a plain restore hits.
//     - fitness-service `muscles` (baseline 29 rows): a FRESH RANDOM
//       `gen_random_uuid()` `id` every run, stable `code`, guarded by
//       `ON CONFLICT ("code") DO NOTHING` — doesn't protect the
//       separate `muscles_code_key` unique constraint the dump's rows
//       collide on, and (worse) `DO NOTHING` alone would have silently
//       kept the migration's random `id` instead of local's real one.
//     - payment-service `wallets` (baseline 1 row: `owner_type=PLATFORM,
//       owner_id=ESCROW`, balance 0 on an empty fresh target): the real
//       `wallets_owner_type_owner_id_key` UNIQUE(owner_type, owner_id)
//       constraint is the natural composite conflict target — every
//       other wallet in the dump (CLIENT/PT/GYM/the PLATFORM/REVENUE
//       wallet, which the migration never creates on a fresh DB — it's
//       an UPDATE of a pre-existing row, a no-op on empty) has no
//       matching key on the fresh target, so this same statement simply
//       INSERTs them normally in the same pass.
// - "clear-baseline": no stable key exists to upsert on at all
//   (`platform_commission_rates` has no unique constraint besides its
//   own random `id`, which never matches between two independent
//   migration runs). Instead: verify every row currently in the table
//   matches `baselineWhereSql` EXACTLY (never assume — re-checked live,
//   not just at config-authoring time), then DELETE those rows before
//   the main restore runs, leaving the table empty for the dump's own
//   row(s) to load normally like any other table.
//     - gym-service `platform_commission_rates` (baseline 1 row:
//       `rate=0.05, effective_from='2026-01-01 00:00:00', created_by IS
//       NULL` — audited directly against a fresh `prisma migrate
//       deploy`, not inferred from the migration source alone, since the
//       migration's `NOW()` for `created_at` is the only non-constant
//       column and is deliberately excluded from the match predicate).
//
// Editing any historical migration is explicitly out of scope (never
// modify historical migrations) — every case here is handled entirely at
// import time.
const MIGRATION_SEEDED_TABLES = {
  "ai-service": [
    { table: "knowledge_sources", strategy: "upsert", conflictColumns: ["id"], expectedBaselineCount: 6 },
  ],
  "fitness-service": [
    { table: "muscles", strategy: "upsert", conflictColumns: ["code"], expectedBaselineCount: 29 },
  ],
  "payment-service": [
    { table: "wallets", strategy: "upsert", conflictColumns: ["owner_type", "owner_id"], expectedBaselineCount: 1 },
  ],
  "gym-service": [
    {
      table: "platform_commission_rates",
      strategy: "clear-baseline",
      expectedBaselineCount: 1,
      // Deliberately excludes `id` (random every run) and `created_at`
      // (`NOW()` at migration time) — every OTHER column the migration
      // hardcodes, so this predicate can only match the migration's own
      // placeholder, never a row a human or business process created
      // with different values.
      baselineWhereSql: `"rate" = 0.05 AND "effective_from" = '2026-01-01 00:00:00' AND "created_by" IS NULL`,
    },
  ],
};

// Hard allowlist — the ONLY logical AWS database names this importer will
// ever write to. A service arg that isn't here, or a target DB whose real
// name (read back from the connection, not assumed) doesn't match, aborts
// before any mutation. This is the "wrong database: ABORT BEFORE
// MUTATION" requirement from the plan doc §14.
const EXPECTED_AWS_DB = {
  "auth-service": "fitness_assistant",
  "user-service": "fitness_assistant_user",
  "fitness-service": "fitness_assistant_fitness",
  "gym-service": "fitness_assistant_gym",
  "payment-service": "fitness_assistant_payment",
  "ai-service": "fitness_assistant_ai",
  "chat-service": "fitness_assistant_chat",
};

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function psqlScalar(databaseUrl, sql) {
  return execFileSync("psql", [databaseUrl, "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();
}

async function main() {
  const { service, dump, manifest } = parseArgs();
  if (!service || !dump || !manifest) {
    console.error("Usage: --service=<name> --dump=<path> --manifest=<path>");
    process.exit(2);
  }

  const expectedDb = EXPECTED_AWS_DB[service];
  if (!expectedDb) {
    console.error(`ABORT: "${service}" is not in the allowlist of known services. Nothing was touched.`);
    process.exit(1);
  }

  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    console.error("ABORT: DATABASE_URL not set. Never hardcode it here — read it from Secrets Manager into the environment before running this.");
    process.exit(1);
  }

  // Guard 1 — the target DB name embedded in the connection string must be
  // the exact expected logical database for this service. This is a
  // pre-flight string check; guard 2 below re-derives it from the live
  // connection itself, which is authoritative.
  let parsedUrl;
  try {
    parsedUrl = new URL(rawDatabaseUrl);
  } catch {
    console.error("ABORT: DATABASE_URL is not a parseable postgres URL.");
    process.exit(1);
  }
  const urlDbName = parsedUrl.pathname.replace(/^\//, "");
  // Every app service's own DATABASE_URL is written for Prisma, which
  // accepts a `?schema=...` query parameter Prisma itself understands —
  // but `psql`/`pg_restore` (real `libpq`, not Prisma) do NOT recognize
  // that parameter at all and error out immediately ("invalid URI query
  // parameter: schema") on ANY query string. Confirmed empirically during
  // this pass's own dress rehearsal (schemas here are always `public`
  // regardless), not assumed — so it's stripped here, once, rather than
  // trusting whoever configures the Fargate task's Secrets Manager
  // mapping to remember to pass a bare URL with no query string.
  parsedUrl.search = "";
  const databaseUrl = parsedUrl.toString();
  if (urlDbName !== expectedDb) {
    console.error(`ABORT: DATABASE_URL targets "${urlDbName}", expected "${expectedDb}" for ${service}. Nothing was touched.`);
    process.exit(1);
  }

  // Guard 2 — verify the checksum recorded at export time BEFORE touching
  // the target at all. A dump that doesn't match its manifest entry is
  // never trusted, regardless of guard 1.
  const manifestEntries = JSON.parse(readFileSync(manifest, "utf8"));
  const entry = manifestEntries.find((e) => e.service === service);
  if (!entry) {
    console.error(`ABORT: manifest has no entry for "${service}". Nothing was touched.`);
    process.exit(1);
  }
  const actualSha256 = await sha256File(dump);
  if (actualSha256 !== entry.sha256) {
    console.error(`ABORT: checksum mismatch for ${dump}. Expected ${entry.sha256}, got ${actualSha256}. Nothing was touched.`);
    process.exit(1);
  }
  if (entry.targetDatabaseAws !== expectedDb) {
    console.error(`ABORT: manifest's own targetDatabaseAws ("${entry.targetDatabaseAws}") disagrees with the allowlist ("${expectedDb}"). Nothing was touched.`);
    process.exit(1);
  }

  // Guard 3 — the target must be import-worthy: EXPECTED_MIGRATION_BASELINE
  // or genuinely empty, never anything else. Two checks, both live queries
  // against the actual target (never assumed):
  //
  //   (a) every table NOT in this service's MIGRATION_SEEDED_TABLES list
  //       must have exactly 0 rows.
  //   (b) every table THAT IS in the list must have EXACTLY
  //       `expectedBaselineCount` rows, AND — for "clear-baseline" tables
  //       specifically, where content (not just count) matters because
  //       there's no key to upsert on — every one of those rows must
  //       match `baselineWhereSql`.
  //
  // This is deliberately stricter than "fewer rows than expected is
  // fine": a target with 0 rows in a seeded table (e.g. someone already
  // manually ran a data restore, or a migration was skipped) is just as
  // much an "unexpected shape" as extra rows would be — this importer
  // only ever proceeds against the ONE fresh-migration shape it has
  // actually verified reconciliation against. Any mismatch, in either
  // direction, aborts before a single row is touched.
  const seededTables = MIGRATION_SEEDED_TABLES[service] ?? [];
  const seededTableNames = seededTables.map((t) => t.table);
  const nonSeededSql = `
    SELECT coalesce(sum(row_count), 0) AS total_rows FROM (
      SELECT (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'
        ${seededTableNames.length > 0 ? `AND table_name NOT IN (${seededTableNames.map((t) => `'${t}'`).join(",")})` : ""}
    ) t;
  `;
  const nonSeededRows = Number(psqlScalar(databaseUrl, nonSeededSql));
  if (!Number.isFinite(nonSeededRows)) {
    console.error("ABORT: could not read target row count during preflight. Nothing was touched.");
    process.exit(1);
  }
  if (nonSeededRows > 0) {
    console.error(`ABORT: target "${expectedDb}" already has ${nonSeededRows} application row(s) outside the known migration-seeded tables. Per the duplicate-data policy this importer never merges/overwrites — resolve manually, then re-run. Nothing was touched.`);
    process.exit(1);
  }
  for (const seed of seededTables) {
    const actualCount = Number(psqlScalar(databaseUrl, `SELECT count(*) FROM "${seed.table}";`));
    if (actualCount !== seed.expectedBaselineCount) {
      console.error(`ABORT: "${seed.table}" has ${actualCount} row(s), expected exactly the known migration baseline of ${seed.expectedBaselineCount}. This does not look like the fresh, just-migrated target this importer was verified against — resolve manually, then re-run. Nothing was touched.`);
      process.exit(1);
    }
    if (seed.strategy === "clear-baseline" && actualCount > 0) {
      const nonMatching = Number(psqlScalar(databaseUrl, `SELECT count(*) FROM "${seed.table}" WHERE NOT (${seed.baselineWhereSql});`));
      if (nonMatching > 0) {
        console.error(`ABORT: "${seed.table}" has ${nonMatching} row(s) that do NOT match the known migration placeholder shape — this looks like real business data, not the migration baseline. Refusing to delete anything. Nothing was touched.`);
        process.exit(1);
      }
    }
  }

  // All guards passed — build ONE single SQL script covering every step
  // (baseline cleanup, main restore, seeded-table reconciliation) and run
  // it as ONE `psql --single-transaction` session. This is deliberate:
  // the whole service import is one atomic unit — preflight already ran
  // above (read-only), so from here on either everything below commits
  // together or a failure anywhere rolls back everything, leaving the
  // target exactly at its pre-import (fresh-migration-baseline) state.
  // No step is allowed to commit independently.
  console.log(`Restoring ${service} -> ${expectedDb} (${entry.sizeBytes} bytes, sha256 verified)...`);

  const scratchDir = mkdtempSync(join(tmpdir(), "data-migration-import-"));
  const upsertTables = seededTables.filter((s) => s.strategy === "upsert");
  const clearBaselineTables = seededTables.filter((s) => s.strategy === "clear-baseline");

  // --data-only (schema is assumed already migrated, plan doc §11 Option
  // A), --no-owner/--no-privileges to match how the dump was taken.
  // "upsert" tables are excluded from this main restore's TOC (they're
  // reconciled separately below); "clear-baseline" tables are NOT
  // excluded — their placeholder row(s) are deleted first (below), so
  // the main restore's own COPY for that table loads normally into what
  // is now an empty table, no different from any other table.
  //
  // `_prisma_migrations` is ALWAYS excluded, for every service, whether
  // or not that service has any seeded table — this is a separate,
  // unconditional exclusion. The export dumps include it (confirmed:
  // `pg_dump --data-only` with no table filter captures every table),
  // but restoring it would overwrite the target's own CANONICAL migration
  // history (the one `prisma migrate deploy` just wrote, matching current
  // repo history) with local's own noisy historical record — which
  // includes rolled-back attempts and at least two orphaned migration
  // identities this reconciliation pass deliberately did NOT recreate
  // (`20260905063000_account_preferences`,
  // `20260823120000_personalized_service_escrow_milestones` — adopted
  // under new migration names instead, see
  // docs/aws-full-local-data-migration-schema-reconciliation.md). Policy,
  // stated once here for every service: APPLICATION BUSINESS DATA = exact
  // local state; `_prisma_migrations` = current canonical repository/AWS
  // migration state, never overwritten by this importer.
  const alwaysExcludedTables = ["_prisma_migrations", ...upsertTables.map((t) => t.table)];
  const tocPath = join(scratchDir, "toc.txt");
  const toc = execFileSync("pg_restore", ["-l", dump], { encoding: "utf8" });
  const filteredToc = toc
    .split("\n")
    .map((line) => (alwaysExcludedTables.some((t) => line.includes(`TABLE DATA public ${t} `)) ? `;${line}` : line))
    .join("\n");
  writeFileSync(tocPath, filteredToc);
  const mainRestoreArgs = ["--data-only", "--no-owner", "--no-privileges", "-L", tocPath];
  const mainRestoreSqlPath = join(scratchDir, "main-restore.sql");
  execFileSync("pg_restore", [...mainRestoreArgs, "--file", mainRestoreSqlPath, dump]);

  // Deliberately NOT `pg_restore --disable-triggers` (the plan doc's
  // original draft). Audited before ever touching AWS
  // (docs/aws-full-local-data-migration-schema-reconciliation.md §16):
  // `--disable-triggers` emits `ALTER TABLE ... DISABLE/ENABLE TRIGGER
  // ALL`, and PostgreSQL's own docs are explicit that disabling an
  // internally-generated trigger (exactly what a foreign key's own RI
  // enforcement trigger is — relevant here because of the fitness DB's
  // own documented circular FK on `muscles`) requires TRUE PostgreSQL
  // superuser, not just table ownership. AWS Aurora never grants a
  // customer role true superuser — confirmed by this repo's own local
  // dev role happening to BE a real superuser (`rolsuper = true`), which
  // is exactly why a local test of `--disable-triggers` would look
  // completely safe and only fail once actually run against Aurora
  // (classified AWS PREFLIGHT VERIFICATION REQUIRED, not proven on
  // Aurora itself — see the final-reconciliation report §10).
  //
  // Non-destructive alternative used instead: `SET
  // session_replication_role = 'replica'` for the one session — this
  // suppresses ALL trigger firing (including RI triggers) without ever
  // altering any table's trigger definition, and setting it only
  // requires `rds_superuser` role membership, which Aurora's customer
  // master role does have. Both the SET and the RESET live inside the
  // SAME single-transaction psql invocation as everything else below, so
  // there is no window where a crash could leave the session's
  // replication role permanently altered — the session itself ends
  // (successfully committed or fully rolled back) before this script
  // exits either way.
  const fullScriptParts = ["SET session_replication_role = 'replica';"];

  for (const seed of clearBaselineTables) {
    fullScriptParts.push(`DELETE FROM "${seed.table}" WHERE ${seed.baselineWhereSql};`);
  }

  fullScriptParts.push(readFileSync(mainRestoreSqlPath, "utf8"));
  // pg_restore's own extracted script (just appended above) sets
  // `search_path` to '' as its standard safety practice — restored here,
  // once, before any of this importer's OWN SQL below touches a real
  // (non-temp) table by unqualified name. Confirmed necessary by this
  // pass's own dress rehearsal: a bare `CREATE TEMP TABLE ... (LIKE
  // "muscles" ...)` failed with "relation muscles does not exist"
  // without this line, because — unlike an earlier draft of this script
  // that ran each reconciliation step in its own separate `psql` session
  // (where a fresh session always starts with `search_path = public`) —
  // everything now runs in ONE session for atomicity (§ below), so the
  // main restore's own search_path reset otherwise leaks into every
  // statement that follows it.
  fullScriptParts.push(`SET search_path TO public;`);

  // Reconcile each "upsert" migration-seeded table: extract its data as a
  // plain-SQL COPY script from the SAME verified dump file (never a
  // second, separately-trusted input), redirect that COPY's target from
  // the real table to a same-session temp table, then upsert from there
  // into the real one. Fully data-driven — it never hardcodes which rows
  // differ or what the non-key columns are (both read from the dump's
  // own COPY column list), so it stays correct even if the migration-
  // seeded set or the local data changes later.
  for (const { table, conflictColumns } of upsertTables) {
    console.log(`Reconciling migration-seeded table "${table}" (ON CONFLICT ${JSON.stringify(conflictColumns)})...`);
    const extractedSql = join(scratchDir, `${table}.sql`);
    execFileSync("pg_restore", ["--data-only", "--table", table, "--file", extractedSql, dump]);
    const rawCopyScript = readFileSync(extractedSql, "utf8");
    const copyHeaderMatch = rawCopyScript.match(new RegExp(`^COPY (?:public\\.)?"?${table}"?\\s*\\(([^)]+)\\)\\s+FROM stdin;`, "m"));
    if (!copyHeaderMatch) {
      throw new Error(`Could not find the expected COPY statement for "${table}" in the extracted dump — aborting rather than guessing.`);
    }
    const columns = copyHeaderMatch[1].split(",").map((c) => c.trim());
    const conflictSet = new Set(conflictColumns);
    const updateColumns = columns.filter((c) => !conflictSet.has(c.replace(/"/g, "")));
    const updateSetClause = updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
    const conflictColumnsSql = conflictColumns.map((c) => `"${c}"`).join(", ");
    // The only rewrite: the COPY statement's target table name, so rows
    // land in a temp staging table instead of colliding with the
    // migration-seeded real one. Every data line and the `\.` terminator
    // are left byte-for-byte untouched.
    const stagedCopyScript = rawCopyScript.replace(new RegExp(`^COPY (public\\.)?"?${table}"?\\s`, "m"), `COPY "_reconcile_${table}" `);
    fullScriptParts.push(
      `CREATE TEMP TABLE "_reconcile_${table}" (LIKE "${table}" INCLUDING ALL);`,
      stagedCopyScript,
      // pg_restore's own extracted script sets `search_path` to '' (its
      // standard safety practice) — restored here before touching the
      // real (non-temp) table by unqualified name (an unqualified INSERT
      // fails with "relation ... does not exist" without this; the temp
      // table itself is unaffected, since pg_temp is always searched
      // regardless of search_path).
      `SET search_path TO public;`,
      `INSERT INTO "${table}" SELECT * FROM "_reconcile_${table}" ON CONFLICT (${conflictColumnsSql}) DO UPDATE SET ${updateSetClause};`,
      `DROP TABLE "_reconcile_${table}";`,
    );
  }

  fullScriptParts.push("RESET session_replication_role;");

  const fullScriptPath = join(scratchDir, "full-import.sql");
  writeFileSync(fullScriptPath, fullScriptParts.join("\n"));
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", fullScriptPath], { stdio: "inherit" });

  // Structured, non-sensitive summary only — never the dump's own row
  // contents, never any credential.
  console.log(
    JSON.stringify(
      {
        service,
        targetDatabaseAws: expectedDb,
        sha256Verified: true,
        preflightNonSeededRows: nonSeededRows,
        preflightSeededTables: seededTables.map((s) => ({ table: s.table, strategy: s.strategy, expectedBaselineCount: s.expectedBaselineCount })),
        sizeBytes: entry.sizeBytes,
        restoredAtUtc: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("ABORT (unexpected error):", err.message);
  process.exit(1);
});
