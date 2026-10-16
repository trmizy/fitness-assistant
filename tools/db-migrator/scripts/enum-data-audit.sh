#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

# Detects enum VALUE drift that schema-only diffing can miss: a value that
# exists in a dump's literal COPY data but not in Aurora's live enum type —
# regardless of whether the current repo migrations still know about that
# value. This is what actually made pg_restore fail before (`invalid input
# value for enum ... "WORKOUT_UPCOMING"`), so it's checked against real dump
# bytes and Aurora's real pg_enum, not inferred from migrations.
#
# Usage: enum-data-audit.sh <dbname> <dump_path> <shadow_db_url> <safe_patch_file> <evidence_file>

dbname="$1"
dump_path="$2"
shadow_url="$3"
safe_patch="$4"
evidence_file="$5"

# This runs as its own process (invoked, not sourced, by schema-audit.sh) —
# DB_BASE/DB_QUERY from the parent's derive_db_base() call do NOT carry over
# to a child process even though both source the same lib.sh. Must derive it
# again here. (Confirmed the hard way: without this, db_url_for() throws
# "DB_BASE: unbound variable" under set -u, which the `|| true` guards below
# then silently swallowed — Aurora's enum query came back empty every time,
# so EVERY dump value looked "missing", including baseline enums like Role.)
derive_db_base

if [ ! -f "$dump_path" ]; then
  log "enum-data-audit(${dbname}): dump not found at ${dump_path} — skipping"
  exit 0
fi

# Enum columns as the REAL migrations define them (shadow DB), independent of
# whatever Aurora currently has — this also covers a brand-new table's enum
# columns before apply-prepatch has even created that table.
enum_cols=$(psql "$shadow_url" -v ON_ERROR_STOP=1 -Atqc "
  select c.table_name || '|' || c.column_name || '|' || t.typname
  from information_schema.columns c
  join pg_type t on t.typname = c.udt_name
  where c.table_schema = 'public' and t.typtype = 'e'
  order by 1;
")

if [ -z "$enum_cols" ]; then
  exit 0
fi

WORK_TMP=$(mktemp -d)
trap 'rm -rf "$WORK_TMP"' EXIT

while IFS='|' read -r table column enumtype; do
  [ -z "$table" ] && continue
  pg_restore -t "$table" -f - "$dump_path" 2>/dev/null \
    | awk -f "$DIR/extract-copy-column.awk" -v col="$column" \
    >> "$WORK_TMP/${enumtype}.values" || true
  echo "${table}.${column}" >> "$WORK_TMP/${enumtype}.evidence"
done <<< "$enum_cols"

for values_file in "$WORK_TMP"/*.values; do
  [ -f "$values_file" ] || continue
  enumtype=$(basename "$values_file" .values)
  dump_values=$(sort -u "$values_file")
  [ -z "$dump_values" ] && continue

  # No `|| true` here: an empty result must mean "queried fine, enum type has
  # zero values" (e.g. it doesn't exist on Aurora yet), never "the query
  # itself failed" — those two cases produce the same empty string and would
  # otherwise both look like "every dump value is missing", which is exactly
  # the false-positive flood caused by the DB_BASE bug this file used to have.
  if ! aurora_values=$(psql "$(db_url_for "$dbname")" -v ON_ERROR_STOP=1 -Atqc "
    select e.enumlabel
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = '${enumtype}';
  " 2>&1); then
    log "enum-data-audit(${dbname}): WARNING — could not query pg_enum for \"${enumtype}\", skipping (${aurora_values})"
    continue
  fi
  aurora_values=$(printf '%s\n' "$aurora_values" | sort -u)

  missing=$(comm -23 <(printf '%s\n' "$dump_values") <(printf '%s\n' "$aurora_values"))
  [ -z "$missing" ] && continue

  evidence_cols=$(paste -sd, "$WORK_TMP/${enumtype}.evidence" 2>/dev/null || echo "?")
  missing_csv=$(printf '%s' "$missing" | paste -sd, -)

  log "enum-data-audit(${dbname}): \"${enumtype}\" missing from dump data: ${missing_csv} (evidence: ${evidence_cols})"

  {
    echo "-- [${dbname}] Enum data drift: \"${enumtype}\" — value(s) found in dump COPY data"
    echo "-- (columns: ${evidence_cols}) but absent from Aurora's live enum. This is data"
    echo "-- drift, not schema drift — the value may predate the current migrations."
    echo "-- Additive and required for pg_restore of this dump to succeed."
  } >> "$safe_patch"
  while IFS= read -r val; do
    [ -z "$val" ] && continue
    escaped=${val//\'/\'\'}
    echo "ALTER TYPE \"${enumtype}\" ADD VALUE IF NOT EXISTS '${escaped}';" >> "$safe_patch"
  done <<< "$missing"
  echo >> "$safe_patch"

  printf '| %s | %s | %s | %s |\n' "$dbname" "$enumtype" "$missing_csv" "$evidence_cols" >> "$evidence_file"
done
