#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

log "=== APPLY CONSTRAINTS (writes: ADD CONSTRAINT FOREIGN KEY, ONLY from safe-constraints.<db>.sql) ==="

require_env AWS_REGION
derive_db_base

GEN_DIR=/work/generated
REPORT_DIR=/work/reports
REPORT="$REPORT_DIR/apply-constraints-report.md"
mkdir -p "$GEN_DIR" "$REPORT_DIR"

OUT_PREFIX="$(migrator_output_prefix)"
log "--- fetching safe-constraints.<db>.sql from ${OUT_PREFIX}/generated/ ---"
aws s3 cp "${OUT_PREFIX}/generated/" "$GEN_DIR/" --recursive \
  --exclude "*" --include "safe-constraints.*.sql" \
  --only-show-errors --region "$AWS_REGION"

q() { psql "$(db_url_for "$dbname")" -v ON_ERROR_STOP=1 -Atqc "$1"; }
table_exists() { [ "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='$1';")" = "1" ]; }
col_exists()   { [ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='$1' and column_name='$2';")" = "1" ]; }
fk_exists()    { [ "$(q "select count(*) from information_schema.table_constraints where constraint_schema='public' and table_name='$1' and constraint_name='$2' and constraint_type='FOREIGN KEY';")" = "1" ]; }

fk_regex="^ALTER[[:space:]]+TABLE[[:space:]]+\"([A-Za-z0-9_]+)\"[[:space:]]+ADD[[:space:]]+CONSTRAINT[[:space:]]+\"([A-Za-z0-9_]+)\"[[:space:]]+FOREIGN[[:space:]]+KEY[[:space:]]*\(([^)]+)\)[[:space:]]+REFERENCES[[:space:]]+\"([A-Za-z0-9_]+)\"[[:space:]]*\(([^)]+)\)"

TOTAL_ATTEMPTED=0; TOTAL_APPLIED=0; TOTAL_SKIPPED=0; TOTAL_FAILED_DB=0; TOTAL_VALIDATED=0
ROWS_FILE="$GEN_DIR/apply-rows.tmp"; : > "$ROWS_FILE"

for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  safe_file="$GEN_DIR/safe-constraints.${dbname}.sql"
  [ -s "$safe_file" ] || { log "--- ${dbname}: no safe-constraints file / empty — skipping ---"; continue; }

  mapfile -t stmts < <(grep -E '^ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY' "$safe_file" || true)
  [ "${#stmts[@]}" -eq 0 ] && { log "--- ${dbname}: safe file has no FK statements — skipping ---"; continue; }

  log "--- ${dbname}: re-verifying ${#stmts[@]} FK statement(s) against LIVE Aurora before executing ---"

  tx_file="$GEN_DIR/apply-tx.${dbname}.sql"
  echo "BEGIN;" > "$tx_file"
  declare -a to_apply_names=() to_apply_child=() to_apply_ccols=() to_apply_parent=() to_apply_pcols=() to_apply_stmt=()

  for stmt in "${stmts[@]}"; do
    TOTAL_ATTEMPTED=$((TOTAL_ATTEMPTED+1))
    [[ "$stmt" =~ $fk_regex ]] || { log "SKIP (unparsable, not touched): $stmt"; TOTAL_SKIPPED=$((TOTAL_SKIPPED+1)); continue; }
    child="${BASH_REMATCH[1]}"; cname="${BASH_REMATCH[2]}"
    ccols_raw="${BASH_REMATCH[3]}"; parent="${BASH_REMATCH[4]}"; pcols_raw="${BASH_REMATCH[5]}"
    child_cols=(); parent_cols=()
    IFS=',' read -ra tmp <<< "$ccols_raw"; for c in "${tmp[@]}"; do c="${c//\"/}"; c="${c// /}"; child_cols+=("$c"); done
    IFS=',' read -ra tmp <<< "$pcols_raw"; for c in "${tmp[@]}"; do c="${c//\"/}"; c="${c// /}"; parent_cols+=("$c"); done
    ccols_disp=$(IFS=,; echo "${child_cols[*]}"); pcols_disp=$(IFS=,; echo "${parent_cols[*]}")
    path="${child}(${ccols_disp}) -> ${parent}(${pcols_disp})"

    skip_reason=""
    if ! table_exists "$child";  then skip_reason="child table ${child} missing"; fi
    if [ -z "$skip_reason" ] && ! table_exists "$parent"; then skip_reason="parent table ${parent} missing"; fi
    if [ -z "$skip_reason" ]; then
      for c in "${child_cols[@]}";  do col_exists "$child" "$c"  || skip_reason="${skip_reason:-}${skip_reason:+; }column ${child}.${c} missing"; done
      for c in "${parent_cols[@]}"; do col_exists "$parent" "$c" || skip_reason="${skip_reason:-}${skip_reason:+; }column ${parent}.${c} missing"; done
    fi
    if [ -z "$skip_reason" ] && fk_exists "$child" "$cname"; then
      skip_reason="constraint already exists (ALREADY_APPLIED)"
    fi
    if [ -z "$skip_reason" ]; then
      notnull_pred=""; join_pred=""; i=0
      for c in "${child_cols[@]}"; do
        notnull_pred+="${notnull_pred:+ AND }c.\"${c}\" IS NOT NULL"
        join_pred+="${join_pred:+ AND }p.\"${parent_cols[$i]}\" = c.\"${c}\""
        i=$((i+1))
      done
      orphan_now=$(q "select count(*) from public.\"${child}\" c where ${notnull_pred} and not exists (select 1 from public.\"${parent}\" p where ${join_pred});")
      if [ "$orphan_now" != "0" ]; then
        skip_reason="orphan count changed since audit: now ${orphan_now} (was 0) — data changed between audit and apply"
      fi
    fi

    if [ -n "$skip_reason" ]; then
      log "SKIP ${cname}: ${skip_reason}"
      TOTAL_SKIPPED=$((TOTAL_SKIPPED+1))
      printf '| %s | `%s` | %s | SKIPPED | %s |\n' "$dbname" "$cname" "$path" "$skip_reason" >> "$ROWS_FILE"
      continue
    fi

    echo "$stmt" >> "$tx_file"
    to_apply_names+=("$cname"); to_apply_child+=("$child"); to_apply_ccols+=("$ccols_disp")
    to_apply_parent+=("$parent"); to_apply_pcols+=("$pcols_disp"); to_apply_stmt+=("$stmt")
  done

  echo "COMMIT;" >> "$tx_file"

  if [ "${#to_apply_names[@]}" -eq 0 ]; then
    log "--- ${dbname}: nothing left to apply after re-verification ---"
    declare -a to_apply_names=() to_apply_child=() to_apply_ccols=() to_apply_parent=() to_apply_pcols=() to_apply_stmt=()
    continue
  fi

  log "--- ${dbname}: executing ${#to_apply_names[@]} FK(s) in ONE transaction (ON_ERROR_STOP=1) ---"
  tx_log="$GEN_DIR/apply-tx.${dbname}.log"
  if psql "$(db_url_for "$dbname")" -v ON_ERROR_STOP=1 -f "$tx_file" > "$tx_log" 2>&1; then
    log "--- ${dbname}: transaction COMMITTED (${#to_apply_names[@]} FK) ---"
    for idx in "${!to_apply_names[@]}"; do
      cname="${to_apply_names[$idx]}"; child="${to_apply_child[$idx]}"
      path="${child}(${to_apply_ccols[$idx]}) -> ${to_apply_parent[$idx]}(${to_apply_pcols[$idx]})"
      # Post-apply verification: constraint exists, is VALIDATED, and its real
      # definition matches what we intended to create (source of truth: the
      # statement itself, already proven against live data pre-execution).
      def=$(q "select pg_get_constraintdef(oid) from pg_constraint where conname = '${cname}' and conrelid = 'public.\"${child}\"'::regclass;" 2>/dev/null || echo "")
      # No ::text cast: psql -A (unaligned) already renders a raw boolean
      # column as bare "t"/"f". Casting to ::text instead yields "true"/"false"
      # (SQL standard form) — comparing that against "t" silently always failed,
      # so every successful apply was misreported as merely "applied", never
      # "validated" (confirmed by testing: report said "convalidated=true" while
      # the counter stayed 0).
      validated=$(q "select convalidated from pg_constraint where conname = '${cname}' and conrelid = 'public.\"${child}\"'::regclass;" 2>/dev/null || echo "")
      if [ -n "$def" ] && [ "$validated" = "t" ]; then
        TOTAL_APPLIED=$((TOTAL_APPLIED+1)); TOTAL_VALIDATED=$((TOTAL_VALIDATED+1))
        printf '| %s | `%s` | %s | APPLIED + VALIDATED | %s |\n' "$dbname" "$cname" "$path" "$def" >> "$ROWS_FILE"
      elif [ -n "$def" ]; then
        TOTAL_APPLIED=$((TOTAL_APPLIED+1))
        printf '| %s | `%s` | %s | APPLIED (convalidated=%s) | %s |\n' "$dbname" "$cname" "$path" "$validated" "$def" >> "$ROWS_FILE"
      else
        printf '| %s | `%s` | %s | APPLIED but NOT FOUND on re-query (investigate) | - |\n' "$dbname" "$cname" "$path" >> "$ROWS_FILE"
      fi
    done
  else
    TOTAL_FAILED_DB=$((TOTAL_FAILED_DB+1))
    log "!!! ${dbname}: transaction FAILED — Postgres rolled back automatically (nothing committed for this database). See apply-tx.${dbname}.log"
    err=$(tail -5 "$tx_log" | tr '\n' ' ')
    for idx in "${!to_apply_names[@]}"; do
      cname="${to_apply_names[$idx]}"; child="${to_apply_child[$idx]}"
      path="${child}(${to_apply_ccols[$idx]}) -> ${to_apply_parent[$idx]}(${to_apply_pcols[$idx]})"
      printf '| %s | `%s` | %s | ROLLED BACK (batch failed) | %s |\n' "$dbname" "$cname" "$path" "$err" >> "$ROWS_FILE"
    done
  fi

  declare -a to_apply_names=() to_apply_child=() to_apply_ccols=() to_apply_parent=() to_apply_pcols=() to_apply_stmt=()
done

{
  echo "# Apply Constraints Report"
  echo
  echo "Generated (UTC): $(date -u +%FT%TZ)"
  echo
  echo "Applies ONLY \`ADD CONSTRAINT ... FOREIGN KEY\` statements already present in"
  echo "\`generated/safe-constraints.<db>.sql\` (produced by a prior live constraint-audit"
  echo "run — every one already proven zero-orphan). Immediately before executing, each"
  echo "statement is re-verified against LIVE Aurora (table/column existence, constraint"
  echo "not already present, orphan count recomputed to still be zero) — this catches any"
  echo "data change between audit time and apply time instead of trusting a stale report."
  echo "All FKs for one database run inside a single transaction (\`ON_ERROR_STOP=1\`); if"
  echo "any statement in that transaction fails, the whole batch for that database rolls"
  echo "back automatically (Postgres rolls back any uncommitted transaction on error/exit)"
  echo "— no partial set of constraints is ever left for one database."
  echo
  echo "The MANUAL item (\`gym_membership_plans.brand_id SET NOT NULL\`) is not a"
  echo "\`FOREIGN KEY\` statement and never appears in \`safe-constraints.*.sql\` in the"
  echo "first place — this mode has no code path that could execute it."
  echo
  echo "## Summary"
  echo
  echo "| Metric | Count |"
  echo "|---|---|"
  echo "| Attempted (from safe-constraints files) | ${TOTAL_ATTEMPTED} |"
  echo "| Applied | ${TOTAL_APPLIED} |"
  echo "| Applied + confirmed VALIDATED | ${TOTAL_VALIDATED} |"
  echo "| Skipped (re-verification failed, not executed) | ${TOTAL_SKIPPED} |"
  echo "| Database batches rolled back (transaction failure) | ${TOTAL_FAILED_DB} |"
  echo
  echo "## Detail"
  echo
  echo "| Database | Constraint | Child -> Parent | Result | Detail |"
  echo "|---|---|---|---|---|"
  cat "$ROWS_FILE"
} > "$REPORT"

rm -f "$ROWS_FILE"

log "--- publishing report to ${OUT_PREFIX} ---"
aws s3 cp "$REPORT" "${OUT_PREFIX}/reports/apply-constraints-report.md" --only-show-errors --region "$AWS_REGION"

log "SUMMARY attempted=${TOTAL_ATTEMPTED} applied=${TOTAL_APPLIED} validated=${TOTAL_VALIDATED} skipped=${TOTAL_SKIPPED} failed_db_batches=${TOTAL_FAILED_DB}"
if [ "$TOTAL_FAILED_DB" -gt 0 ]; then
  log "=== APPLY CONSTRAINTS DONE WITH FAILURES — see ${REPORT} ==="
  exit 1
fi
log "=== APPLY CONSTRAINTS DONE ==="
