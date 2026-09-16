#!/usr/bin/env bash
# LOCAL-ONLY data export for the AWS full-data-migration plan
# (docs/aws-full-local-data-migration-plan.md). This script:
#   - reads ONLY the local dev Postgres (gymcoach-postgres, port 5433)
#   - never connects to AWS, never uses the AWS CLI
#   - never modifies local data (pg_dump is read-only against its source)
#   - writes data-only, custom-format dumps + a non-sensitive manifest
#     into artifacts/data-migration/ (gitignored — see .gitignore's
#     `**/artifacts/` rule)
#
# Data-only (not schema+data) by design: AWS Aurora already has the
# service schemas from prior manual migration deploys (see plan doc §12);
# restoring schema on top of that risks CREATE TABLE/CREATE TYPE conflicts
# with objects that already exist. The importer applies these dumps with
# `pg_restore --data-only` against an already-migrated target schema.
#
# Usage: POSTGRES_PASSWORD=... bash scripts/data-migration-export.sh
# (POSTGRES_PASSWORD is read from the environment only — never written to
# any file this script produces.)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/artifacts/data-migration"
CONTAINER="gymcoach-postgres"
DB_USER="gymcoach"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  # Fall back to the repo-root .env used by docker-compose, same value the
  # running containers already use — never echoed, never written to disk.
  POSTGRES_PASSWORD="$(grep -oP '^POSTGRES_PASSWORD=\K.*' "$REPO_ROOT/.env")"
fi

# service -> logical local database name (source of truth: docker-compose
# DATABASE_URL values audited in the migration plan, §2 — NOT the
# ai-service .env's stale "gym_coach_auth" typo, which the running
# container does not actually use).
declare -A SERVICE_DB=(
  [auth-service]=gymcoach_auth
  [user-service]=gymcoach_user
  [fitness-service]=gymcoach_fitness
  [gym-service]=gymcoach_gym
  [payment-service]=gymcoach_payment
  [ai-service]=gymcoach_ai
  [chat-service]=gymcoach_chat
)

# AWS target logical DB names. Chat has no name in the owner's original
# assumed list (plan doc §1/§2 finding) — "fitness_assistant_chat" is this
# script's own proposed naming, consistent with the other five, not yet
# confirmed against any existing AWS resource.
declare -A SERVICE_AWS_DB=(
  [auth-service]=fitness_assistant
  [user-service]=fitness_assistant_user
  [fitness-service]=fitness_assistant_fitness
  [gym-service]=fitness_assistant_gym
  [payment-service]=fitness_assistant_payment
  [ai-service]=fitness_assistant_ai
  [chat-service]=fitness_assistant_chat
)

mkdir -p "$OUT_DIR"
MANIFEST="$OUT_DIR/manifest.json"
echo "[" > "$MANIFEST"
first=1

for service in "${!SERVICE_DB[@]}"; do
  db="${SERVICE_DB[$service]}"
  svc_dir="$OUT_DIR/$service"
  mkdir -p "$svc_dir"
  dump_file="$svc_dir/${db}.data.dump"
  echo "== Exporting $service ($db) -> $dump_file"

  # MSYS_NO_PATHCONV avoids Git-Bash-on-Windows mangling the in-container
  # /tmp path into a host Windows path before docker even sees it.
  MSYS_NO_PATHCONV=1 docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
    pg_dump -U "$DB_USER" -d "$db" \
      --data-only \
      --format=custom \
      --no-owner \
      --no-privileges \
      --file="/tmp/${db}.data.dump"
  docker cp "$CONTAINER:/tmp/${db}.data.dump" "$dump_file"
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" rm -f "/tmp/${db}.data.dump"

  size_bytes=$(stat -c%s "$dump_file" 2>/dev/null || stat -f%z "$dump_file")
  sha256=$(sha256sum "$dump_file" | awk '{print $1}')

  # Repo migration head (most recent migration folder name) — recorded so
  # the importer can sanity-check it is restoring into a target whose
  # schema was migrated to at least this point.
  migrations_dir="$REPO_ROOT/backend/services/$service/prisma/migrations"
  migration_head=$(ls "$migrations_dir" 2>/dev/null | grep -v migration_lock | sort | tail -1)

  row_count_json=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$db" -t -A -c "
    SELECT json_agg(json_build_object('table', table_name, 'rows', row_count))
    FROM (
      SELECT table_name,
        (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
    ) t;
  ")

  [ $first -eq 0 ] && echo "," >> "$MANIFEST"
  first=0
  cat >> "$MANIFEST" <<EOF
  {
    "service": "$service",
    "sourceDatabase": "$db",
    "targetDatabaseAws": "${SERVICE_AWS_DB[$service]}",
    "dumpFile": "$service/${db}.data.dump",
    "dumpFormat": "postgresql-custom-data-only",
    "sha256": "$sha256",
    "sizeBytes": $size_bytes,
    "repoMigrationHead": "${migration_head:-null}",
    "tableRowCounts": $row_count_json,
    "createdAtUtc": "$STAMP"
  }
EOF
done

echo "]" >> "$MANIFEST"
echo "Manifest written: $MANIFEST"
