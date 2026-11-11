#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

log "=== RESTORE (destructive: truncates + reloads public tables, except _prisma_migrations) ==="

require_env AWS_REGION
require_env DUMP_S3_PREFIX
derive_db_base

mkdir -p /work/dumps /work/lists

log "--- downloading dumps ---"
aws s3 cp "${DUMP_S3_PREFIX}/" /work/dumps/ --recursive --only-show-errors --region "$AWS_REGION"
ls -lh /work/dumps

log "--- applying schema prepatch first ---"
"$DIR/apply-prepatch.sh"

restore_one() {
  local dbname="$1" dumpfile="$2" svc="$3"
  local url dump_path list_path tables

  url="$(db_url_for "$dbname")"
  dump_path="/work/dumps/${dumpfile}"
  list_path="/work/lists/${dbname}.list"

  if [ ! -f "$dump_path" ]; then
    echo "ERROR: dump not found for ${dbname}: ${dump_path}" >&2
    exit 1
  fi

  log "--- ${dbname}: truncating public tables except _prisma_migrations ---"
  tables=$(psql "$url" -v ON_ERROR_STOP=1 -Atqc "
    select coalesce(string_agg(format('%I.%I', schemaname, tablename), ','), '')
    from pg_tables
    where schemaname = 'public'
      and tablename <> '_prisma_migrations';
  ")

  if [ -n "$tables" ]; then
    psql "$url" -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;"
  else
    log "--- ${dbname}: no tables to truncate ---"
  fi

  log "--- ${dbname}: building restore list (excluding TABLE DATA public _prisma_migrations) ---"
  pg_restore -l "$dump_path" | grep -v -E 'TABLE DATA public _prisma_migrations' > "$list_path"

  log "--- ${dbname}: restoring data-only from ${dumpfile} ---"
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --data-only \
    --use-list="$list_path" \
    --dbname="$url" \
    "$dump_path"

  log "--- ${dbname}: restore OK ---"
}

for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  restore_one "$dbname" "$dumpfile" "$svc"
done

log "=== RESTORE: ALL 7 DATABASES DONE ==="
