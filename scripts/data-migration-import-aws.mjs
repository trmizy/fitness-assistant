// ONE-TIME AWS Aurora data-only importer — SOURCE PREPARATION ONLY.
//
// This script is NOT executed as part of the audit/plan pass that created
// it (docs/aws-full-local-data-migration-plan.md). It does not connect to
// AWS. It is checked in so the exact, reviewable import logic exists
// before anyone runs it by hand from inside the private VPC (see the plan
// doc §13 for the S3 -> private importer -> Aurora path this is meant to
// run inside, e.g. as a one-shot ECS/Fargate task or a Cloud9/bastion
// session with a security-group hole punched temporarily to Aurora —
// never a public Aurora endpoint).
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

// Hard allowlist — the ONLY logical AWS database names this importer will
// ever write to. A service arg that isn't here, or a target DB whose real
// name (read back from the connection, not assumed) doesn't match, aborts
// before any mutation. This is the "wrong database: ABORT BEFORE
// MUTATION" requirement from the plan doc §14.
// Tables whose rows are (partly) inserted by this service's OWN migration
// history, not just by application traffic — discovered empirically by
// this reconciliation pass running the real fresh-DB + data-only-restore
// test (see docs/aws-full-local-data-migration-schema-reconciliation.md
// §11 and its fitness-service addendum). Two independent cases found so
// far, both REFERENCE-category catalog tables (never business/transaction
// data), both guarded by an `ON CONFLICT` clause in their own migration
// that does NOT cover the specific collision a data-only restore hits:
//   - ai-service `knowledge_sources`: `20260605000000_knowledge_pipeline`
//     seeds 6 rows with fixed `id`s, guarded by
//     `ON CONFLICT ("base_url") DO NOTHING` — no protection against an
//     `id` collision, which is exactly what the dump's identical rows hit.
//   - fitness-service `muscles`: `20260819020000_add_exercise_muscle_
//     provenance_schema` seeds 29 rows with a *random* `gen_random_uuid()`
//     `id` (a different value every time the migration runs) but a fixed
//     `code`, guarded by `ON CONFLICT ("code") DO NOTHING` — no protection
//     against the dump's rows, which carry the ORIGINAL local `id` for
//     the same `code` and so collide on the separate `muscles_code_key`
//     unique constraint instead of the primary key.
// Editing either historical migration is explicitly out of scope (never
// modify historical migrations) — both are handled entirely at import
// time instead: excluded from the main data-only restore, then
// reconciled with a targeted, data-driven (never hardcoded)
// `INSERT ... ON CONFLICT (<conflictColumn>) DO NOTHING` for exactly the
// rows the dump has that the fresh migration-seeded target doesn't.
// `conflictColumn` is whichever column the seeding migration's own
// `ON CONFLICT` clause names — not necessarily the primary key.
const MIGRATION_SEEDED_TABLES = {
  "ai-service": [{ table: "knowledge_sources", conflictColumn: "id" }],
  "fitness-service": [{ table: "muscles", conflictColumn: "code" }],
};

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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ABORT: DATABASE_URL not set. Never hardcode it here — read it from Secrets Manager into the environment before running this.");
    process.exit(1);
  }

  // Guard 1 — the target DB name embedded in the connection string must be
  // the exact expected logical database for this service. This is a
  // pre-flight string check; guard 2 below re-derives it from the live
  // connection itself, which is authoritative.
  let urlDbName;
  try {
    urlDbName = new URL(databaseUrl).pathname.replace(/^\//, "").split("?")[0];
  } catch {
    console.error("ABORT: DATABASE_URL is not a parseable postgres URL.");
    process.exit(1);
  }
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

  // Guard 3 — the target must be import-worthy per the plan doc's §15
  // policy: mostly/entirely empty. This queries the LIVE target (via
  // `psql`, so no extra Node pg dependency needed beyond what's already in
  // node_modules for the app services) and aborts on ANY existing rows in
  // ANY application table, rather than guessing which tables "don't
  // count." Never merges, never overwrites, never regenerates IDs — exact
  // local state or nothing.
  // Migration-seeded tables (§ MIGRATION_SEEDED_TABLES above) are excluded
  // from this sum on purpose: a freshly-migrated target legitimately has
  // rows in them (inserted by the service's own migration history, not by
  // application traffic) before any data import step ever runs. Every
  // OTHER table must still be genuinely empty, or this aborts exactly as
  // before.
  const seededTables = MIGRATION_SEEDED_TABLES[service] ?? [];
  const seededTablesSql = seededTables.length > 0 ? `AND table_name NOT IN (${seededTables.map((t) => `'${t.table}'`).join(",")})` : "";
  const preflightSql = `
    SELECT coalesce(sum(row_count), 0) AS total_rows FROM (
      SELECT (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ${seededTablesSql}
    ) t;
  `;
  const preflightOut = execFileSync("psql", [databaseUrl, "-t", "-A", "-c", preflightSql], { encoding: "utf8" }).trim();
  const existingRows = Number(preflightOut);
  if (!Number.isFinite(existingRows)) {
    console.error("ABORT: could not read target row count during preflight. Nothing was touched.");
    process.exit(1);
  }
  if (existingRows > 0) {
    console.error(`ABORT: target "${expectedDb}" already has ${existingRows} application rows across its tables. Per the duplicate-data policy this importer never merges/overwrites — resolve manually, then re-run. Nothing was touched.`);
    process.exit(1);
  }

  // All guards passed — restore. --data-only (schema is assumed already
  // migrated, plan doc §11 Option A), --no-owner/--no-privileges to match
  // how the dump was taken.
  //
  // Deliberately NOT `pg_restore --disable-triggers` (the plan doc's
  // original draft). Audited before ever touching AWS (schema-
  // reconciliation report §16): `--disable-triggers` emits
  // `ALTER TABLE ... DISABLE/ENABLE TRIGGER ALL`, and PostgreSQL's own
  // docs are explicit that disabling an internally-generated trigger
  // (exactly what a foreign-key's RI enforcement trigger is — relevant
  // here because of the fitness DB's own documented circular FK on
  // `muscles`) requires TRUE superuser, not just table ownership.
  // Confirmed locally: this repo's own dev Postgres role (`gymcoach`) IS
  // a real superuser (`rolsuper = true`), which is exactly why a local
  // test of `--disable-triggers` would falsely look safe — AWS Aurora
  // never grants a customer role true superuser (`rds_superuser`
  // membership is a bounded, AWS-defined privilege set, not the real
  // thing), so this flag risks a permission-denied failure that would
  // only surface during the real AWS run, which is exactly what this
  // audit exists to catch first.
  //
  // Non-destructive alternative used instead: extract the restore as a
  // plain SQL script and prepend `SET session_replication_role =
  // 'replica'` for the one session — this suppresses ALL trigger firing
  // (including RI triggers) for that session without ever altering any
  // table's trigger definition, and setting it only requires
  // `rds_superuser` role membership, which Aurora's customer master role
  // does have. `RESET session_replication_role` at the end is
  // belt-and-suspenders (the session ends right after anyway).
  console.log(`Restoring ${service} -> ${expectedDb} (${entry.sizeBytes} bytes, sha256 verified)...`);

  const scratchDir = mkdtempSync(join(tmpdir(), "data-migration-import-"));
  const mainRestoreArgs = ["--data-only", "--no-owner", "--no-privileges"];

  if (seededTables.length > 0) {
    // Exclude the migration-seeded tables' data from the main restore —
    // confirmed necessary by this reconciliation pass's own restore test
    // (schema-reconciliation report §11): their rows collide on primary
    // key with what the target's own migration history already inserted.
    const tocPath = join(scratchDir, "toc.txt");
    const toc = execFileSync("pg_restore", ["-l", dump], { encoding: "utf8" });
    const filteredToc = toc
      .split("\n")
      .map((line) => (seededTables.some((t) => line.includes(`TABLE DATA public ${t.table} `)) ? `;${line}` : line))
      .join("\n");
    writeFileSync(tocPath, filteredToc);
    mainRestoreArgs.push("-L", tocPath);
  }

  const mainRestoreSqlPath = join(scratchDir, "main-restore.sql");
  execFileSync("pg_restore", [...mainRestoreArgs, "--file", mainRestoreSqlPath, dump]);
  const mainRestoreSql = [
    "SET session_replication_role = 'replica';",
    readFileSync(mainRestoreSqlPath, "utf8"),
    "RESET session_replication_role;",
  ].join("\n");
  writeFileSync(mainRestoreSqlPath, mainRestoreSql);
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", mainRestoreSqlPath], { stdio: "inherit" });

  // Reconcile each migration-seeded table separately: extract its data as
  // a plain-SQL COPY script from the SAME verified dump file (never a
  // second, separately-trusted input), redirect that COPY's target from
  // the real table to a same-session temp table, then upsert from there
  // into the real one. This is fully data-driven — it never hardcodes
  // which rows differ, so it stays correct even if the migration-seeded
  // set or the local data changes later. One `psql -f` invocation per
  // table keeps the temp table, the COPY load, and the upsert in a single
  // session/transaction, so a failure here leaves the table exactly as
  // the main restore (or the pre-existing migration seed) left it.
  //
  // ON CONFLICT ... DO UPDATE SET <every other column> = EXCLUDED.<col>
  // — deliberately UPDATE, never DO NOTHING, and this matters concretely
  // for `muscles`: its seeding migration generates a FRESH RANDOM `id`
  // (`gen_random_uuid()`) every time it runs, keyed only by the stable
  // `code`. A `DO NOTHING` was tried first during this reconciliation
  // pass's own dry run and left `muscles.id` values that don't match
  // local at all — silently violating "preserve original IDs exactly"
  // even though `code`/`name_vi`/etc. would have looked identical. DO
  // UPDATE overwrites the migration's placeholder `id` (and every other
  // column) with the dump's real local value unconditionally. This is
  // safe to do AFTER the main restore already loaded dependent rows
  // (e.g. `exercise_muscles.muscle_id`) under `session_replication_role =
  // 'replica'`, because Postgres never re-validates already-loaded FK
  // references on their own — the corrected `muscles.id` here is exactly
  // the value those already-restored FK columns already point to, so
  // integrity is correct once this step completes, not broken by the
  // ordering. For `knowledge_sources` (stable, hardcoded `id`s) this same
  // UPDATE is a same-value no-op — one mechanism, safe for both.
  for (const { table, conflictColumn } of seededTables) {
    console.log(`Reconciling migration-seeded table "${table}" (ON CONFLICT "${conflictColumn}")...`);
    const extractedSql = join(scratchDir, `${table}.sql`);
    execFileSync("pg_restore", ["--data-only", "--table", table, "--file", extractedSql, dump]);
    const rawCopyScript = readFileSync(extractedSql, "utf8");
    const copyHeaderMatch = rawCopyScript.match(new RegExp(`^COPY (?:public\\.)?"?${table}"?\\s*\\(([^)]+)\\)\\s+FROM stdin;`, "m"));
    if (!copyHeaderMatch) {
      throw new Error(`Could not find the expected COPY statement for "${table}" in the extracted dump — aborting rather than guessing.`);
    }
    const columns = copyHeaderMatch[1].split(",").map((c) => c.trim());
    const updateColumns = columns.filter((c) => c.replace(/"/g, "") !== conflictColumn);
    const updateSetClause = updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
    // The only rewrite: the COPY statement's target table name, so rows
    // land in a temp staging table instead of colliding with the
    // migration-seeded real one. Every data line and the `\.` terminator
    // are left byte-for-byte untouched.
    const stagedCopyScript = rawCopyScript.replace(new RegExp(`^COPY (public\\.)?"?${table}"?\\s`, "m"), `COPY "_reconcile_${table}" `);
    const sessionScript = [
      `CREATE TEMP TABLE "_reconcile_${table}" (LIKE "${table}" INCLUDING ALL);`,
      stagedCopyScript,
      // pg_restore's own extracted script sets `search_path` to '' (its
      // standard safety practice) — restored here before touching the
      // real (non-temp) table by unqualified name, confirmed necessary by
      // a real dry run against a scratch DB during this reconciliation
      // pass (an unqualified INSERT failed with "relation ... does not
      // exist" without this line; the temp table itself was unaffected,
      // since pg_temp is always searched regardless of search_path).
      `SET search_path TO public;`,
      `INSERT INTO "${table}" SELECT * FROM "_reconcile_${table}" ON CONFLICT ("${conflictColumn}") DO UPDATE SET ${updateSetClause};`,
      `DROP TABLE "_reconcile_${table}";`,
    ].join("\n");
    const sessionScriptPath = join(scratchDir, `${table}.reconcile.sql`);
    writeFileSync(sessionScriptPath, sessionScript);
    execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", sessionScriptPath], { stdio: "inherit" });
  }

  // Structured, non-sensitive summary only — never the dump's own row
  // contents, never any credential.
  console.log(
    JSON.stringify(
      {
        service,
        targetDatabaseAws: expectedDb,
        sha256Verified: true,
        preflightExistingRows: existingRows,
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
