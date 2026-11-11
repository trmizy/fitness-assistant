#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

log "=== VERIFY ROW COUNTS (read-only) ==="

require_env AWS_REGION
require_env DUMP_S3_PREFIX
derive_db_base

REPORT_DIR=/work/reports
REPORT="$REPORT_DIR/restore-row-counts.md"
mkdir -p "$REPORT_DIR" /work/dumps

# Runs as its own ECS task with a fresh filesystem, so dumps are re-downloaded
# here purely to read each dump's table list (pg_restore -l) for the
# missing-vs-empty distinction below — no data is written anywhere.
log "--- downloading dumps (read-only use: pg_restore -l table lists) ---"
aws s3 cp "${DUMP_S3_PREFIX}/" /work/dumps/ --recursive --only-show-errors --region "$AWS_REGION"

{
  echo "# Restore Row Counts"
  echo
  echo "Generated (UTC): $(date -u +%FT%TZ)"
  echo
  echo "\"MISSING\" = the table is present in the source dump but does not exist in Aurora."
  echo "\"EMPTY\" = the table exists in Aurora with 0 rows. Both are reported explicitly"
  echo "so an empty-but-present table is never confused with a table that never restored."
  echo
} > "$REPORT"

for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  log "--- ${dbname} ---"
  url="$(db_url_for "$dbname")"
  dump_path="/work/dumps/${dumpfile}"

  {
    echo "## ${dbname} (${svc})"
    echo
    echo "| Table | Rows | Status |"
    echo "|---|---|---|"
  } >> "$REPORT"

  aurora_tables=$(psql "$url" -v ON_ERROR_STOP=1 -Atqc "
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename;
  ")

  if [ -n "$aurora_tables" ]; then
    while IFS= read -r table; do
      [ -z "$table" ] && continue
      count=$(psql "$url" -v ON_ERROR_STOP=1 -Atqc "select count(*) from public.\"${table}\";")
      status="OK"
      [ "$count" = "0" ] && status="EMPTY"
      echo "| ${table} | ${count} | ${status} |" >> "$REPORT"
    done <<< "$aurora_tables"
  fi

  if [ -f "$dump_path" ]; then
    dump_tables=$(pg_restore -l "$dump_path" \
      | grep -E ' TABLE DATA public ' \
      | awk '{print $(NF-1)}' \
      | grep -v '^_prisma_migrations$' || true)

    while IFS= read -r dtable; do
      [ -z "$dtable" ] && continue
      if ! grep -qx "$dtable" <<< "$aurora_tables"; then
        echo "| ${dtable} | - | MISSING (in dump, not in Aurora) |" >> "$REPORT"
      fi
    done <<< "$dump_tables"
  fi

  echo >> "$REPORT"
done

OUT_PREFIX="$(migrator_output_prefix)"
aws s3 cp "$REPORT" "${OUT_PREFIX}/reports/restore-row-counts.md" --only-show-errors --region "$AWS_REGION"

log "=== VERIFY DONE — ${REPORT} (also published to ${OUT_PREFIX}/reports/) ==="
